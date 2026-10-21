import { FIELD_ID } from "./bindings.js";
import { validateCharacterBinding } from "../core/schema.js";
import { validateAdapterScope } from "../core/registry.js";

const PRIVATE_SEGMENT = /(?:^_|__|prototype|constructor|biography|description|notes?|secret|private|password|ownership|permission|flags|^gm$|gmnotes)/i;

/** Explicit GM configuration, never arbitrary expressions or document traversal. */
export function validateMappings(input = [], { fields } = {}) {
  if (!Array.isArray(input) || input.length > 64) throw new TypeError("Field mappings must contain at most 64 entries.");
  const ids = new Set();
  const result = input.map(mapping => {
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(mapping))) throw new TypeError("Each field mapping must be an object.");
    const { id, label, type, path } = mapping;
    if (typeof id !== "string" || !FIELD_ID.test(id) || ids.has(id)) throw new TypeError("Each mapping needs a unique character field ID.");
    validateCharacterBinding(id);
    if (["character.name", "character.portrait", "character.uuid", "character.type", "character.tokenPortrait"].includes(id)) throw new TypeError("Mappings cannot replace standard Actor fields.");
    if (typeof label !== "string" || !label.trim() || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label)) throw new TypeError("A mapped field needs a printable label of at most 80 characters.");
    if (type !== "number" && type !== "string") throw new TypeError("Mapped fields must be numeric or text values.");
    if (typeof path !== "string" || path.length > 240 || !/^system(?:\.[A-Za-z][A-Za-z0-9_]{0,47}){1,6}$/.test(path)
      || path.split(".").some(segment => PRIVATE_SEGMENT.test(segment))) throw new TypeError("A mapping must use a public system field path; private fields and expressions are unavailable.");
    ids.add(id);
    const result = { id, label: label.trim(), type, path, ...validateAdapterScope(mapping, { systemId: true }) };
    if (mapping.maxField !== undefined) {
      if (type !== "number") throw new TypeError("Only numeric mappings can have a maximum field.");
      result.maxField = validateCharacterBinding(mapping.maxField);
    }
    return result;
  });
  const definitions = new Map((fields ?? []).map(field => [field.id, field]));
  for (const mapping of result) definitions.set(mapping.id, mapping);
  for (const mapping of result) if (mapping.maxField !== undefined) {
    const target = definitions.get(mapping.maxField);
    // A referenced adapter field may be validated later against the selected catalog.
    if (target ? target.type !== "number" : fields !== undefined) throw new TypeError("Mapping maximum fields must reference an existing numeric field.");
  }
  return result;
}

export function readMappedField(actor, mapping) {
  let value = actor;
  for (const segment of mapping.path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, segment)) return null;
    value = value[segment];
  }
  if (mapping.type === "number") return typeof value === "number" && Number.isFinite(value) ? value : null;
  return typeof value === "string" ? value.slice(0, 10000) : null;
}
