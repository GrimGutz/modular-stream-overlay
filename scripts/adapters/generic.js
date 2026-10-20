import { validateAssetPath } from "../core/schema.js";

export const GENERIC_FIELDS = Object.freeze([
  { id: "character.name", label: "Character name", type: "string" },
  { id: "character.portrait", label: "Profile portrait", type: "image" },
  { id: "character.tokenPortrait", label: "Prototype token artwork", type: "image" },
  { id: "character.uuid", label: "Actor UUID", type: "string" },
  { id: "character.type", label: "Actor type", type: "string" }
].map(Object.freeze));

export function permittedActor(actor, user) {
  return Boolean(actor && user && typeof actor.testUserPermission === "function" && actor.testUserPermission(user, "OBSERVER"));
}

export function safePortrait(value) {
  try { return validateAssetPath(value ?? "") || null; }
  catch {
    if (typeof value !== "string" || value !== value.trim() || value.length > 4096 || /[\u0000-\u001f\u007f\\]/.test(value)) return null;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
}

export const genericAdapter = {
  id: "generic",
  label: "System-independent Actor basics",
  systemId: null,
  fields: GENERIC_FIELDS,
  normalize(actor, { user, fields = [], portraitSource = "profile" } = {}) {
    if (!Array.isArray(fields) || !fields.length || !permittedActor(actor, user)) return null;
    // Keep the original public adapter contract for integrations requesting legacy field names.
    if (!fields.some(field => typeof field === "string" && field.startsWith("character."))) return {
      id: String(actor.uuid ?? actor.id), name: fields.includes("name") ? String(actor.name ?? "") : null,
      portrait: fields.includes("portrait") ? safePortrait(actor.img) : null, resources: [], statistics: {}, conditions: []
    };
    const values = {};
    for (const field of fields) {
      switch (field) {
        case "character.name": values[field] = typeof actor.name === "string" ? actor.name.slice(0, 10000) : null; break;
        case "character.uuid": values[field] = typeof actor.uuid === "string" ? actor.uuid.slice(0, 128) : null; break;
        case "character.type": values[field] = typeof actor.type === "string" ? actor.type.slice(0, 128) : null; break;
        case "character.portrait": values[field] = (portraitSource === "token" ? safePortrait(actor.prototypeToken?.texture?.src) : null) ?? safePortrait(actor.img); break;
        case "character.tokenPortrait": values[field] = safePortrait(actor.prototypeToken?.texture?.src); break;
      }
    }
    return values;
  }
};
