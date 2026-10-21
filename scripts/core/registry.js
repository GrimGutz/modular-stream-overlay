import { clone, CHARACTER_FIELD_PATTERN, validateCharacterBinding } from "./schema.js";

const REGISTRY_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const VERSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$/;
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);

/** Shared declarative scope validation; versions are exact tested versions, not expressions. */
export function validateAdapterScope(value = {}, { systemId = false } = {}) {
  const result = {};
  if (systemId && value.systemId !== undefined) {
    if (typeof value.systemId !== "string" || !REGISTRY_ID.test(value.systemId) || RESERVED.has(value.systemId)) throw new TypeError("Mapping systemId is invalid.");
    result.systemId = value.systemId;
  }
  for (const [key, pattern] of [["actorTypes", REGISTRY_ID], ["testedSystemVersions", VERSION_ID]]) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key]) || !value[key].length || value[key].length > 32
      || value[key].some(entry => typeof entry !== "string" || !pattern.test(entry) || RESERVED.has(entry))
      || new Set(value[key]).size !== value[key].length) throw new TypeError(`${key} must contain 1–32 unique supported identifiers.`);
    result[key] = [...value[key]];
  }
  return result;
}

function metadataLabel(value, key) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`Adapter ${key} must be printable text of at most 80 characters.`);
  return value.trim();
}

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function base(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new TypeError("A registration must be an object.");
  const { id, label } = definition;
  if (typeof id !== "string" || !REGISTRY_ID.test(id)) throw new TypeError("Registration ID is invalid.");
  if (typeof label !== "string" || !label.trim() || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label)) throw new TypeError("A registration needs a printable label of at most 80 characters.");
  return { id, label: label.trim() };
}

class Registry {
  #definitions = new Map();

  _register(definition) {
    if (this.#definitions.has(definition.id)) throw new Error(`Registration '${definition.id}' already exists.`);
    const result = Object.freeze(definition);
    this.#definitions.set(result.id, result);
    return result;
  }

  get(id) { return this.#definitions.get(id); }
  list() { return [...this.#definitions.values()]; }
}

/** Widget callbacks receive {element, config, context, overlay}; they may return promises. */
export class WidgetRegistry extends Registry {
  register(definition) {
    const result = base(definition);
    if (typeof definition.render !== "function") throw new TypeError("Widgets require a render callback.");
    result.render = definition.render;
    for (const name of ["update", "destroy"]) {
      if (definition[name] !== undefined) {
        if (typeof definition[name] !== "function") throw new TypeError(`Widget ${name} must be a function.`);
        result[name] = definition[name];
      }
    }
    for (const name of ["configSchema", "defaults"]) {
      if (definition[name] !== undefined) {
        if (!definition[name] || typeof definition[name] !== "object" || Array.isArray(definition[name])) throw new TypeError(`Widget ${name} must be a JSON object.`);
        result[name] = freeze(clone(definition[name]));
      }
    }
    return this._register(result);
  }
}

/** Adapters normalize permitted Actor data; callers retain responsibility for permissions. */
export class AdapterRegistry extends Registry {
  register(definition) {
    const result = base(definition);
    if (typeof definition.normalize !== "function") throw new TypeError("Adapters require a normalize callback.");
    if (definition.systemId !== undefined && definition.systemId !== null && (typeof definition.systemId !== "string" || !REGISTRY_ID.test(definition.systemId))) {
      throw new TypeError("Adapter systemId must be a system ID or null.");
    }
    result.systemId = definition.systemId ?? null;
    if (definition.interfaceVersion !== undefined && definition.interfaceVersion !== 1) throw new TypeError("Only adapter interfaceVersion 1 is supported.");
    result.interfaceVersion = 1;
    Object.assign(result, freeze(validateAdapterScope(definition)));
    result.normalize = definition.normalize;
    if (definition.affectsChange !== undefined) {
      if (typeof definition.affectsChange !== "function") throw new TypeError("Adapter affectsChange must be a synchronous boolean callback.");
      result.affectsChange = definition.affectsChange;
    }
    if (definition.fields !== undefined) {
      if (!Array.isArray(definition.fields) || definition.fields.length > 128) throw new TypeError("Adapter fields must be a list with at most 128 entries.");
      const ids = new Set();
      result.fields = freeze(definition.fields.map(field => {
        if (!field || typeof field !== "object" || typeof field.id !== "string"
          || !CHARACTER_FIELD_PATTERN.test(field.id) || ids.has(field.id)) throw new TypeError("Adapter fields need unique normalized character IDs.");
        validateCharacterBinding(field.id);
        if (typeof field.label !== "string" || !field.label.trim() || field.label.length > 80 || /[\u0000-\u001f\u007f]/.test(field.label)) throw new TypeError("An adapter field needs a printable label.");
        if (!["string", "number", "image"].includes(field.type)) throw new TypeError("Adapter field type must be string, number, or image.");
        ids.add(field.id);
        const result = { id: field.id, label: field.label.trim(), type: field.type };
        Object.assign(result, validateAdapterScope(field));
        for (const key of ["group", "unit", "role"]) if (field[key] !== undefined) result[key] = metadataLabel(field[key], key);
        if (field.maxField !== undefined) {
          if (typeof field.maxField !== "string" || !CHARACTER_FIELD_PATTERN.test(field.maxField)) throw new TypeError("Adapter maximum field is invalid.");
          validateCharacterBinding(field.maxField);
          result.maxField = field.maxField;
        }
        if (field.format !== undefined) {
          if (!["integer", "decimal", "percent"].includes(field.format)) throw new TypeError("Adapter display format is invalid.");
          result.format = field.format;
        }
        return result;
      }));
    }
    const fields = new Map((result.fields ?? []).map(field => [field.id, field]));
    if (definition.accentField !== undefined) {
      if (fields.get(definition.accentField)?.type !== "string") throw new TypeError("Adapter accentField must name one of its text fields.");
      result.accentField = definition.accentField;
    }
    // A legacy adapter may pair with a mapping or another catalog field. Validate unresolved
    // targets against the complete selected catalog, while rejecting known wrong types here.
    for (const field of fields.values()) if (field.maxField !== undefined
      && (field.type !== "number" || fields.has(field.maxField) && fields.get(field.maxField).type !== "number")) throw new TypeError("Adapter maximum fields must reference a numeric field.");
    if (definition.resources !== undefined) {
      if (!Array.isArray(definition.resources) || definition.resources.length > 64) throw new TypeError("Adapter resources must contain at most 64 entries.");
      const ids = new Set();
      result.resources = freeze(definition.resources.map(resource => {
        if (!resource || typeof resource !== "object" || Array.isArray(resource)
          || typeof resource.id !== "string" || !REGISTRY_ID.test(resource.id) || RESERVED.has(resource.id) || ids.has(resource.id)) throw new TypeError("Adapter resources need unique supported IDs.");
        const label = metadataLabel(resource.label, "resource label");
        for (const key of ["currentField", "maxField"]) {
          validateCharacterBinding(resource[key]);
          if (fields.get(resource[key])?.type !== "number") throw new TypeError("Adapter resource targets must be existing numeric fields.");
        }
        if (!["lower-is-worse", "higher-is-worse", "neutral"].includes(resource.polarity)) throw new TypeError("Choose a supported resource polarity.");
        ids.add(resource.id);
        return { id: resource.id, label, currentField: resource.currentField, maxField: resource.maxField, polarity: resource.polarity };
      }));
    }
    return this._register(result);
  }
}
