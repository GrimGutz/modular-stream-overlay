import { permittedActor } from "./generic.js";

// Verified against installed CAIN 1.3.26 public TypeDataModel definitions:
// module/data/base-actor.mjs and module/data/actor-character.mjs.
const PATHS = Object.freeze({
  "character.hp.current": ["health", "value"], "character.hp.max": ["health", "max"],
  "character.level": ["attributes", "level", "value"],
  "character.power.current": ["power", "value"], "character.power.max": ["power", "max"],
  "character.stress.current": ["stress", "value"], "character.stress.max": ["stress", "max"],
  "character.psyche": ["psyche"]
});
const number = value => typeof value === "number" && Number.isFinite(value) ? value : null;
function read(actor, field) { return number(PATHS[field]?.reduce((value, key) => value?.[key], actor.system)); }

export const cainAdapter = {
  id: "cain", label: "CAIN character resources", systemId: "cain",
  fields: [
    { id: "character.hp.current", label: "Health", type: "number", maxField: "character.hp.max" },
    { id: "character.hp.max", label: "Maximum health", type: "number" },
    { id: "character.hp.percent", label: "Health percent", type: "number", format: "percent" },
    { id: "character.level", label: "Level", type: "number", format: "integer" },
    { id: "character.power.current", label: "Power", type: "number", maxField: "character.power.max" },
    { id: "character.power.max", label: "Maximum power", type: "number" },
    { id: "character.stress.current", label: "Stress", type: "number", maxField: "character.stress.max" },
    { id: "character.stress.max", label: "Maximum stress", type: "number" },
    { id: "character.psyche", label: "Psyche", type: "number" }
  ],
  normalize(actor, { user, fields = [] } = {}) {
    if (!Array.isArray(fields) || !permittedActor(actor, user)) return null;
    const result = {};
    for (const field of fields) {
      if (Object.hasOwn(PATHS, field)) result[field] = read(actor, field);
      else if (field === "character.hp.percent") {
        const current = read(actor, "character.hp.current"), maximum = read(actor, "character.hp.max");
        result[field] = current !== null && maximum > 0 ? Math.max(0, Math.min(100, current / maximum * 100)) : null;
      }
    }
    return result;
  }
};
