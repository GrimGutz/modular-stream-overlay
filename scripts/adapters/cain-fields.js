import { CAIN_COLLECTION_FIELDS } from "./cain-collections.js";

/**
 * Verified installed/public CAIN 1.3.26 TypeDataModels. Paths stay in the adapter,
 * never in saved widget bindings. See docs/internal/PHASE6_CAIN_FIELD_MAP_RU.md for sources.
 */
export const CAIN_SYSTEM_VERSION = "1.3.26";

export const CAIN_LEGACY_PATHS = Object.freeze({
  "character.hp.current": ["health", "value"], "character.hp.max": ["health", "max"],
  "character.level": ["attributes", "level", "value"],
  "character.power.current": ["power", "value"], "character.power.max": ["power", "max"],
  "character.stress.current": ["stress", "value"], "character.stress.max": ["stress", "max"],
  "character.psyche": ["psyche"]
});

// These nine existing IDs keep their labels, types, paths and applicability.
const legacy = [
  { id: "character.hp.current", label: "Health", type: "number", maxField: "character.hp.max", group: "Legacy", unit: "points", role: "current" },
  { id: "character.hp.max", label: "Maximum health", type: "number", group: "Legacy", unit: "points", role: "maximum" },
  { id: "character.hp.percent", label: "Health percent", type: "number", format: "percent", group: "Legacy", unit: "percent", role: "percentage" },
  { id: "character.level", label: "Level", type: "number", format: "integer", group: "Legacy", unit: "level", role: "value" },
  { id: "character.power.current", label: "Power", type: "number", maxField: "character.power.max", group: "Legacy", unit: "points", role: "current" },
  { id: "character.power.max", label: "Maximum power", type: "number", group: "Legacy", unit: "points", role: "maximum" },
  { id: "character.stress.current", label: "Stress", type: "number", maxField: "character.stress.max", group: "Resources", unit: "stress", role: "current" },
  { id: "character.stress.max", label: "Maximum stress", type: "number", group: "Resources", unit: "stress", role: "maximum" },
  { id: "character.psyche", label: "Psyche", type: "number", group: "Statistics", unit: "dice", role: "rating" }
];

const fields = [], paths = {}, resources = [
  { id: "cain.stress", label: "Stress", currentField: "character.stress.current", maxField: "character.stress.max", polarity: "higher-is-worse" }
];
function field(suffix, label, path, { type = "number", group = "Resources", unit, role = "value", maxField, format } = {}) {
  const id = `character.cain.${suffix}`;
  paths[id] = Object.freeze(path);
  fields.push({ id, label, type, group, role, ...(unit ? { unit } : {}), ...(maxField ? { maxField } : {}), ...(format ? { format } : {}),
    actorTypes: Object.freeze(["character"]), testedSystemVersions: Object.freeze([CAIN_SYSTEM_VERSION]) });
}
function resource(key, label, { unit, group = "Resources", polarity = "neutral" } = {}) {
  const currentField = `character.cain.${key}.current`, maxField = `character.cain.${key}.max`;
  field(`${key}.current`, label, [key, "value"], { unit, group, role: "current", maxField });
  field(`${key}.max`, `Maximum ${label.toLowerCase()}`, [key, "max"], { unit, group, role: "maximum" });
  resources.push({ id: `cain.${key}`, label, currentField, maxField, polarity });
}

field("cat", "CAT", ["CATLEVEL", "value"], { group: "Progression", unit: "cat" });
resource("psycheBurst", "Psyche Bursts", { unit: "bursts", polarity: "lower-is-worse" });
resource("injuries", "Injuries", { unit: "injuries", polarity: "higher-is-worse" });
resource("divineAgony", "Divine Agony", { unit: "agony" });
resource("sinOverflow", "Sin Overflow", { unit: "sin", polarity: "higher-is-worse" });
field("sinOverflow.min", "Minimum sin overflow", ["sinOverflow", "min"], { unit: "sin", role: "minimum" });
resource("kitPoints", "Kit Points", { unit: "kit-points", polarity: "lower-is-worse" });
resource("xp", "XP", { unit: "xp", group: "Progression" });
resource("advancements", "Advancements", { unit: "advancements", group: "Progression" });
field("scrip", "Scrip", ["scrip"], { unit: "scrip" });

const skills = ["force", "conditioning", "coordination", "covert", "interfacing", "investigation", "surveillance", "negotiation", "authority", "connection"];
for (const skill of skills) {
  const label = skill[0].toUpperCase() + skill.slice(1);
  field(`skills.${skill}.rating`, label, ["skills", skill, "value"], { group: "Skills", unit: "dice", role: "rating", format: "integer", maxField: `character.cain.skills.${skill}.max` });
  field(`skills.${skill}.max`, `Maximum ${skill}`, ["skills", skill, "max"], { group: "Skills", unit: "dice", role: "maximum", format: "integer" });
}
field("extraDice", "Extra d6", ["extraDice", "value"], { group: "Roll modifiers", unit: "dice", role: "modifier" });
field("restDiceModifier", "Rest dice modifier", ["restDiceModifier"], { group: "Roll modifiers", unit: "dice", role: "modifier" });
for (const [suffix, label, path] of [
  ["xid", "XID", "XID"], ["agenda", "Agenda text", "agenda"], ["blasphemy", "Blasphemy text", "blasphemy"],
  ["appearance.sex", "Sex", "sex"], ["appearance.height", "Height", "height"], ["appearance.weight", "Weight", "weight"], ["appearance.hair", "Hair", "hair"], ["appearance.eyes", "Eyes", "eyes"]
]) field(suffix, label, [path], { type: "string", group: "Identity", role: "label" });

export const CAIN_NATIVE_PATHS = Object.freeze(paths);
export const CAIN_FIELDS = Object.freeze([...legacy, ...fields, ...CAIN_COLLECTION_FIELDS].map(Object.freeze));
export const CAIN_RESOURCES = Object.freeze([
  ...resources,
  { id: "cain.legacyHealth", label: "Health (legacy)", currentField: "character.hp.current", maxField: "character.hp.max", polarity: "neutral" },
  { id: "cain.legacyPower", label: "Power (legacy)", currentField: "character.power.current", maxField: "character.power.max", polarity: "neutral" }
].map(Object.freeze));
