import { permittedActor } from "./generic.js";
import { versionCompatible } from "../core/versions.js";

// Public Actor data from the Cyberpunk RED Core 0.92.4 data models (characters and mooks share
// the common schema; wealth belongs to characters). The 0.93 development line keeps these paths.
const ACTOR_TYPES = Object.freeze(["character", "mook"]);
const CHARACTER = Object.freeze(["character"]);
const TESTED_VERSIONS = Object.freeze(["0.92.4"]);
const WOUND_STATES = Object.freeze({ notWounded: "Not wounded", lightlyWounded: "Lightly wounded",
  seriouslyWounded: "Seriously wounded", mortallyWounded: "Mortally wounded", dead: "Dead" });
const readers = new Map(), scopes = new Map();
const fields = [];
const number = value => typeof value === "number" && Number.isFinite(value) ? value : null;
const readPath = (actor, path) => path.reduce((value, key) => value?.[key], actor.system);

function field(id, label, path, { type = "number", actorTypes = ACTOR_TYPES, ...metadata } = {}) {
  derived(id, label, actor => {
    const value = readPath(actor, path);
    return type === "string" ? typeof value === "string" ? value.slice(0, 80) : null : number(value);
  }, { type, actorTypes, ...metadata });
}
function derived(id, label, read, { type = "number", actorTypes = ACTOR_TYPES, ...metadata } = {}) {
  fields.push({ id, label, type, actorTypes, testedSystemVersions: TESTED_VERSIONS, ...metadata });
  scopes.set(id, actorTypes);
  readers.set(id, read);
}

field("character.hp.current", "Hit points", ["derivedStats", "hp", "value"], {
  group: "Health", unit: "hp", role: "current", maxField: "character.hp.max", format: "integer"
});
field("character.hp.max", "Maximum hit points", ["derivedStats", "hp", "max"], { group: "Health", unit: "hp", role: "maximum", format: "integer" });
derived("character.hp.percent", "Hit points percent", actor => {
  const current = readers.get("character.hp.current")(actor), maximum = readers.get("character.hp.max")(actor);
  return current !== null && maximum > 0 ? Math.max(0, Math.min(100, current / maximum * 100)) : null;
}, { group: "Health", unit: "percent", role: "percentage", format: "percent" });
// The system's own wound state names, in the Foundry language when the system translates them.
derived("character.cpr.woundState", "Wound state", actor => {
  const state = readPath(actor, ["derivedStats", "currentWoundState"]);
  if (!Object.hasOwn(WOUND_STATES, state)) return null;
  const key = `CPR.global.woundState.${state}`, translated = globalThis.game?.i18n?.localize?.(key);
  return typeof translated === "string" && translated && translated !== key ? translated.slice(0, 80) : WOUND_STATES[state];
}, { type: "string", group: "Health", role: "label" });
field("character.cpr.deathSave", "Death save", ["derivedStats", "deathSave", "value"], { group: "Health", role: "value", format: "integer" });
field("character.cpr.deathSavePenalty", "Death save penalty", ["derivedStats", "deathSave", "penalty"], { group: "Health", role: "value", format: "integer" });
field("character.cpr.humanity.current", "Humanity", ["derivedStats", "humanity", "value"], {
  group: "Health", role: "current", maxField: "character.cpr.humanity.max", format: "integer"
});
field("character.cpr.humanity.max", "Maximum humanity", ["derivedStats", "humanity", "max"], { group: "Health", role: "maximum", format: "integer" });

for (const [id, label] of [["int", "INT"], ["ref", "REF"], ["dex", "DEX"], ["tech", "TECH"], ["cool", "COOL"],
  ["will", "WILL"], ["luck", "LUCK"], ["move", "MOVE"], ["body", "BODY"], ["emp", "EMP"]]) {
  field(`character.cpr.stats.${id}`, label, ["stats", id, "value"], {
    group: "Statistics", role: "value", format: "integer", ...["luck", "emp"].includes(id) ? { maxField: `character.cpr.stats.${id}Max` } : {}
  });
}
field("character.cpr.stats.luckMax", "Maximum LUCK", ["stats", "luck", "max"], { group: "Statistics", role: "maximum", format: "integer" });
field("character.cpr.stats.empMax", "Maximum EMP", ["stats", "emp", "max"], { group: "Statistics", role: "maximum", format: "integer" });

for (const [id, key, label] of [["body", "currentArmorBody", "Body armor"], ["head", "currentArmorHead", "Head armor"], ["shield", "currentArmorShield", "Shield"]]) {
  field(`character.cpr.armor.${id}.current`, `${label} SP`, ["externalData", key, "value"], {
    group: "Armor", unit: "sp", role: "current", maxField: `character.cpr.armor.${id}.max`, format: "integer"
  });
  field(`character.cpr.armor.${id}.max`, `Maximum ${label.toLowerCase()} SP`, ["externalData", key, "max"], {
    group: "Armor", unit: "sp", role: "maximum", format: "integer"
  });
}

field("character.cpr.role", "Active role", ["roleInfo", "activeRole"], { type: "string", group: "Identity", role: "label" });
field("character.cpr.reputation", "Reputation", ["reputation", "value"], { group: "Identity", role: "value", format: "integer" });
field("character.cpr.wealth", "Eurobucks", ["wealth", "value"], { actorTypes: CHARACTER, group: "Identity", unit: "eb", role: "value", format: "integer" });

export const cyberpunkRedAdapter = {
  interfaceVersion: 1, id: "cyberpunk-red", label: "Cyberpunk RED characters and mooks", systemId: "cyberpunk-red-core",
  actorTypes: ACTOR_TYPES, testedSystemVersions: TESTED_VERSIONS,
  fields,
  // Character color rules pick a color per role by default.
  accentKeyField: "character.cpr.role",
  resources: [
    { id: "health", label: "Hit points", currentField: "character.hp.current", maxField: "character.hp.max", polarity: "lower-is-worse" },
    { id: "humanity", label: "Humanity", currentField: "character.cpr.humanity.current", maxField: "character.cpr.humanity.max", polarity: "lower-is-worse" },
    { id: "luck", label: "LUCK", currentField: "character.cpr.stats.luck", maxField: "character.cpr.stats.luckMax", polarity: "lower-is-worse" },
    ...["body", "head", "shield"].map(id => ({ id: `armor-${id}`, label: `${id === "shield" ? "Shield" : `${id[0].toUpperCase()}${id.slice(1)} armor`} SP`,
      currentField: `character.cpr.armor.${id}.current`, maxField: `character.cpr.armor.${id}.max`, polarity: "lower-is-worse" }))
  ],
  normalize(actor, { user, fields: requested = [], systemVersion } = {}) {
    const version = systemVersion === undefined ? (globalThis.game?.system?.id === "cyberpunk-red-core" ? globalThis.game.system.version : undefined) : systemVersion;
    if (!Array.isArray(requested) || !permittedActor(actor, user) || !ACTOR_TYPES.includes(actor.type)
      || !versionCompatible(TESTED_VERSIONS, version)) return null;
    const values = {};
    for (const id of requested) {
      if (typeof id !== "string") continue;
      const read = readers.get(id);
      // A mook carries no eurobucks; that character field stays empty.
      if (read) values[id] = scopes.get(id).includes(actor.type) ? read(actor) : null;
    }
    return values;
  }
};
