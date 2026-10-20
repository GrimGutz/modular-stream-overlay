import { clone, CHARACTER_FIELD_PATTERN, validateCharacterBinding } from "./schema.js";

const REGISTRY_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;

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
    result.normalize = definition.normalize;
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
    return this._register(result);
  }
}
