import { validateAssetPath } from "../core/schema.js";

/**
 * Per-character presentation the game system does not store: an accent color, a full
 * name and separate full-body art. Kept in one GM-only world setting keyed by world
 * Actor UUID, so every overlay and widget showing that character shares it.
 */
export const PROFILE_FIELDS = Object.freeze([
  { id: "character.profile.accent", key: "accent", label: "Accent color", type: "string", group: "Character profile", role: "color" },
  { id: "character.profile.fullName", key: "fullName", label: "Full name", type: "string", group: "Character profile", role: "label" },
  { id: "character.profile.art", key: "art", label: "Full-body art", type: "image", group: "Character profile", role: "image" }
].map(Object.freeze));

const ACTOR_UUID = /^Actor\.[A-Za-z0-9_-]{1,64}$/;
const COLOR = /^#(?:[\da-f]{6}|[\da-f]{8})$/i;
const PROFILE_LIMIT = 200;

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

/** Normalized profiles drop blank properties and empty entries. */
export function validateCharacterProfiles(input = {}) {
  plain(input, "Character profiles");
  const entries = Object.entries(input);
  if (entries.length > PROFILE_LIMIT) throw new TypeError(`Character profiles support at most ${PROFILE_LIMIT} characters.`);
  const result = {};
  for (const [uuid, profile] of entries) {
    if (!ACTOR_UUID.test(uuid)) throw new TypeError("Character profiles must use world Actor UUIDs such as Actor.abc123.");
    plain(profile, "A character profile");
    const entry = {};
    const accent = typeof profile.accent === "string" ? profile.accent.trim() : profile.accent;
    if (accent) {
      if (typeof accent !== "string" || !COLOR.test(accent)) throw new TypeError("Accent colors must be hexadecimal colors such as #f79646.");
      entry.accent = accent.toLowerCase();
    }
    const fullName = typeof profile.fullName === "string" ? profile.fullName.trim() : profile.fullName;
    if (fullName) {
      if (typeof fullName !== "string" || fullName.length > 200 || /[\u0000-\u001f\u007f]/.test(fullName)) throw new TypeError("A full name must contain at most 200 printable characters.");
      entry.fullName = fullName;
    }
    const art = typeof profile.art === "string" ? profile.art.trim() : profile.art;
    if (art) {
      if (typeof art !== "string") throw new TypeError("Full-body art must be an image path.");
      if (/^https?:\/\//i.test(art)) {
        const url = new URL(art);
        if (url.username || url.password) throw new TypeError("Full-body art URLs cannot contain credentials.");
        entry.art = url.href;
      } else entry.art = validateAssetPath(art);
    }
    if (Object.keys(entry).length) result[uuid] = entry;
  }
  return result;
}

/** Unset values are empty text, so layouts can hide or replace them without a warning. */
export function profileValue(profiles, uuid, field) {
  const definition = PROFILE_FIELDS.find(entry => entry.id === field);
  if (!definition) return null;
  const value = profiles?.[uuid]?.[definition.key];
  return typeof value === "string" ? value : "";
}
