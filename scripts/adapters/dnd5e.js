import { permittedActor } from "./generic.js";
import { versionCompatible } from "../core/versions.js";

// Prepared public Actor data, checked against installed D&D5e 5.3.3.
// Version 6.0.6 was researched separately; it is not verified runtime support.
const ACTOR_TYPES = Object.freeze(["character"]);
const TESTED_VERSIONS = Object.freeze(["5.3.3"]);
const readers = new Map();
const fields = [];
const number = value => typeof value === "number" && Number.isFinite(value) ? value : null;
const readPath = (actor, path) => path.reduce((value, key) => value?.[key], actor.system);

function field(id, label, path, { type = "number", ...metadata } = {}) {
  fields.push({ id, label, type, actorTypes: ACTOR_TYPES, testedSystemVersions: TESTED_VERSIONS, ...metadata });
  readers.set(id, actor => {
    const value = readPath(actor, path);
    return type === "string" ? typeof value === "string" ? value.slice(0, 80) : null : number(value);
  });
}

field("character.hp.current", "Hit points", ["attributes", "hp", "value"], {
  group: "Health", unit: "hp", role: "current", maxField: "character.hp.max", format: "integer"
});
field("character.hp.max", "Effective maximum hit points", ["attributes", "hp", "effectiveMax"], {
  group: "Health", unit: "hp", role: "maximum", format: "integer"
});
field("character.hp.baseMax", "Base maximum hit points", ["attributes", "hp", "max"], {
  group: "Health", unit: "hp", role: "base-maximum", format: "integer"
});
field("character.hp.temp", "Temporary hit points", ["attributes", "hp", "temp"], {
  group: "Health", unit: "hp", role: "temporary", format: "integer"
});
fields.push({ id: "character.hp.percent", label: "Hit points percent", type: "number", group: "Health",
  unit: "percent", role: "percentage", format: "percent", actorTypes: ACTOR_TYPES, testedSystemVersions: TESTED_VERSIONS });
readers.set("character.hp.percent", actor => {
  const current = readers.get("character.hp.current")(actor);
  const maximum = readers.get("character.hp.max")(actor);
  return current !== null && maximum > 0 ? Math.max(0, Math.min(100, current / maximum * 100)) : null;
});
field("character.ac", "Armor class", ["attributes", "ac", "value"], {
  group: "Statistics", role: "value", format: "integer"
});
field("character.level", "Character level", ["details", "level"], {
  group: "Statistics", unit: "level", role: "value", format: "integer"
});

for (const [id, label] of [["str", "Strength"], ["dex", "Dexterity"], ["con", "Constitution"],
  ["int", "Intelligence"], ["wis", "Wisdom"], ["cha", "Charisma"]]) {
  field(`character.abilities.${id}.score`, `${label} score`, ["abilities", id, "value"], {
    group: "Abilities", unit: "score", role: "score", format: "integer"
  });
  field(`character.abilities.${id}.modifier`, `${label} modifier`, ["abilities", id, "mod"], {
    group: "Abilities", unit: "modifier", role: "modifier", format: "integer"
  });
}

for (const [id, label] of [["primary", "Primary"], ["secondary", "Secondary"], ["tertiary", "Tertiary"]]) {
  field(`character.resources.${id}.current`, `${label} resource`, ["resources", id, "value"], {
    group: "Resources", role: "current", maxField: `character.resources.${id}.max`, format: "integer"
  });
  field(`character.resources.${id}.max`, `${label} resource maximum`, ["resources", id, "max"], {
    group: "Resources", role: "maximum", format: "integer"
  });
  field(`character.resources.${id}.label`, `${label} resource label`, ["resources", id, "label"], {
    type: "string", group: "Resources", role: "label"
  });
}

export const dnd5eAdapter = {
  interfaceVersion: 1, id: "dnd5e", label: "D&D5e player character", systemId: "dnd5e",
  actorTypes: ACTOR_TYPES, testedSystemVersions: TESTED_VERSIONS,
  fields,
  resources: [
    { id: "health", label: "Hit points", currentField: "character.hp.current", maxField: "character.hp.max", polarity: "lower-is-worse" },
    ...["primary", "secondary", "tertiary"].map(id => ({
      id, label: `${id[0].toUpperCase()}${id.slice(1)} resource`, currentField: `character.resources.${id}.current`,
      maxField: `character.resources.${id}.max`, polarity: "neutral"
    }))
  ],
  normalize(actor, { user, fields: requested = [], systemVersion } = {}) {
    const version = systemVersion === undefined ? (globalThis.game?.system?.id === "dnd5e" ? globalThis.game.system.version : undefined) : systemVersion;
    if (!Array.isArray(requested) || !permittedActor(actor, user) || !ACTOR_TYPES.includes(actor.type)
      || !versionCompatible(TESTED_VERSIONS, version)) return null;
    const values = {};
    for (const id of requested) {
      if (typeof id !== "string") continue;
      const read = readers.get(id);
      if (read) values[id] = read(actor);
    }
    return values;
  }
};
