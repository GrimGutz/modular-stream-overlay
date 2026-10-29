import { permittedActor } from "./generic.js";
import { versionCompatible } from "../core/versions.js";

// Prepared public Actor data, read from the PF2e 8.6.1 source (the Foundry 14 release line).
// Creature statistics also suit NPCs, such as a boss's hit point bar; character-only fields say so.
const ACTOR_TYPES = Object.freeze(["character", "npc"]);
const CHARACTER = Object.freeze(["character"]);
const TESTED_VERSIONS = Object.freeze(["8.6.1"]);
const readers = new Map(), scopes = new Map();
const fields = [];
const number = value => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value, limit = 80) => typeof value === "string" ? value.slice(0, limit) : null;
const readPath = (actor, path) => path.reduce((value, key) => value?.[key], actor.system);

function field(id, label, path, { type = "number", actorTypes = ACTOR_TYPES, ...metadata } = {}) {
  fields.push({ id, label, type, actorTypes, testedSystemVersions: TESTED_VERSIONS, ...metadata });
  scopes.set(id, actorTypes);
  readers.set(id, actor => {
    const value = readPath(actor, path);
    return type === "string" ? text(value) : number(value);
  });
}
function derived(id, label, read, { type = "number", actorTypes = ACTOR_TYPES, ...metadata } = {}) {
  fields.push({ id, label, type, actorTypes, testedSystemVersions: TESTED_VERSIONS, ...metadata });
  scopes.set(id, actorTypes);
  readers.set(id, read);
}

field("character.hp.current", "Hit points", ["attributes", "hp", "value"], {
  group: "Health", unit: "hp", role: "current", maxField: "character.hp.max", format: "integer"
});
field("character.hp.max", "Maximum hit points", ["attributes", "hp", "max"], {
  group: "Health", unit: "hp", role: "maximum", format: "integer"
});
field("character.hp.temp", "Temporary hit points", ["attributes", "hp", "temp"], {
  group: "Health", unit: "hp", role: "temporary", format: "integer"
});
derived("character.hp.percent", "Hit points percent", actor => {
  const current = readers.get("character.hp.current")(actor), maximum = readers.get("character.hp.max")(actor);
  return current !== null && maximum > 0 ? Math.max(0, Math.min(100, current / maximum * 100)) : null;
}, { group: "Health", unit: "percent", role: "percentage", format: "percent" });

field("character.ac", "Armor class", ["attributes", "ac", "value"], { group: "Statistics", role: "value", format: "integer" });
field("character.level", "Level", ["details", "level", "value"], { group: "Statistics", unit: "level", role: "value", format: "integer" });
field("character.pf2e.perception", "Perception modifier", ["perception", "totalModifier"], {
  group: "Statistics", unit: "modifier", role: "modifier", format: "integer"
});
for (const [id, label] of [["fortitude", "Fortitude save"], ["reflex", "Reflex save"], ["will", "Will save"]]) {
  field(`character.pf2e.saves.${id}`, label, ["saves", id, "totalModifier"], { group: "Statistics", unit: "modifier", role: "modifier", format: "integer" });
}
for (const [id, label] of [["str", "Strength"], ["dex", "Dexterity"], ["con", "Constitution"],
  ["int", "Intelligence"], ["wis", "Wisdom"], ["cha", "Charisma"]]) {
  field(`character.abilities.${id}.modifier`, `${label} modifier`, ["abilities", id, "mod"], {
    group: "Abilities", unit: "modifier", role: "modifier", format: "integer"
  });
}

for (const [id, label] of [["dying", "Dying"], ["wounded", "Wounded"], ["doomed", "Doomed"]]) {
  field(`character.pf2e.${id}.current`, label, ["attributes", id, "value"], {
    group: "Conditions", role: "current", maxField: `character.pf2e.${id}.max`, format: "integer"
  });
  field(`character.pf2e.${id}.max`, `Maximum ${label.toLowerCase()}`, ["attributes", id, "max"], {
    group: "Conditions", role: "maximum", format: "integer"
  });
}
// Condition Items such as "Frightened 2", one per line, as the system names them.
derived("character.pf2e.conditions", "Active conditions", actor => {
  const items = actor.items?.contents ?? (actor.items ? [...actor.items] : []);
  const lines = items.filter(item => item?.type === "condition" && typeof item.name === "string").slice(0, 30).map(item => {
    const value = item.system?.value?.isValued ? number(item.system.value.value) : null;
    return value === null ? item.name.slice(0, 60) : `${item.name.slice(0, 60)} ${value}`;
  });
  return lines.join("\n").slice(0, 1000);
}, { type: "string", group: "Conditions", role: "summary" });

for (const [id, path, label] of [["heroPoints", ["resources", "heroPoints"], "Hero points"], ["focus", ["resources", "focus"], "Focus points"],
  ["shield", ["attributes", "shield", "hp"], "Shield hit points"]]) {
  field(`character.pf2e.${id}.current`, label, [...path, "value"], {
    actorTypes: CHARACTER, group: "Resources", role: "current", maxField: `character.pf2e.${id}.max`, format: "integer"
  });
  field(`character.pf2e.${id}.max`, `Maximum ${label.toLowerCase()}`, [...path, "max"], {
    actorTypes: CHARACTER, group: "Resources", role: "maximum", format: "integer"
  });
}
field("character.pf2e.xp.current", "Experience points", ["details", "xp", "value"], {
  actorTypes: CHARACTER, group: "Progression", unit: "xp", role: "current", maxField: "character.pf2e.xp.max", format: "integer"
});
field("character.pf2e.xp.max", "Experience for next level", ["details", "xp", "max"], {
  actorTypes: CHARACTER, group: "Progression", unit: "xp", role: "maximum", format: "integer"
});
for (const [id, label] of [["class", "Class"], ["ancestry", "Ancestry"], ["heritage", "Heritage"]]) {
  field(`character.pf2e.${id}`, label, ["details", id, "name"], { type: "string", actorTypes: CHARACTER, group: "Identity", role: "label" });
}

export const pf2eAdapter = {
  interfaceVersion: 1, id: "pf2e", label: "PF2e characters and NPCs", systemId: "pf2e",
  actorTypes: ACTOR_TYPES, testedSystemVersions: TESTED_VERSIONS,
  fields,
  // Character color rules pick a color per class by default.
  accentKeyField: "character.pf2e.class",
  resources: [
    { id: "health", label: "Hit points", currentField: "character.hp.current", maxField: "character.hp.max", polarity: "lower-is-worse" },
    { id: "hero-points", label: "Hero points", currentField: "character.pf2e.heroPoints.current", maxField: "character.pf2e.heroPoints.max", polarity: "lower-is-worse" },
    { id: "focus", label: "Focus points", currentField: "character.pf2e.focus.current", maxField: "character.pf2e.focus.max", polarity: "lower-is-worse" },
    { id: "shield", label: "Shield hit points", currentField: "character.pf2e.shield.current", maxField: "character.pf2e.shield.max", polarity: "lower-is-worse" },
    ...["dying", "wounded", "doomed"].map(id => ({ id, label: `${id[0].toUpperCase()}${id.slice(1)}`,
      currentField: `character.pf2e.${id}.current`, maxField: `character.pf2e.${id}.max`, polarity: "higher-is-worse" })),
    { id: "experience", label: "Experience points", currentField: "character.pf2e.xp.current", maxField: "character.pf2e.xp.max", polarity: "neutral" }
  ],
  normalize(actor, { user, fields: requested = [], systemVersion } = {}) {
    const version = systemVersion === undefined ? (globalThis.game?.system?.id === "pf2e" ? globalThis.game.system.version : undefined) : systemVersion;
    if (!Array.isArray(requested) || !permittedActor(actor, user) || !ACTOR_TYPES.includes(actor.type)
      || !versionCompatible(TESTED_VERSIONS, version)) return null;
    const values = {};
    for (const id of requested) {
      if (typeof id !== "string") continue;
      const read = readers.get(id);
      // An NPC has no hero points or class; those character fields stay empty.
      if (read) values[id] = scopes.get(id).includes(actor.type) ? read(actor) : null;
    }
    return values;
  }
};
