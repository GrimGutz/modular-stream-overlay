import { validateAssetPath } from "../core/schema.js";

export const GENERIC_FIELDS = Object.freeze([
  { id: "character.name", label: "Character name", type: "string" },
  { id: "character.callsign", label: "Callsign (name before parentheses)", type: "string" },
  { id: "character.realName", label: "Name in parentheses", type: "string" },
  { id: "character.portrait", label: "Profile portrait", type: "image" },
  { id: "character.tokenPortrait", label: "Prototype token artwork", type: "image" },
  { id: "character.playerAvatar", label: "Player avatar", type: "image" },
  { id: "character.uuid", label: "Actor UUID", type: "string" },
  { id: "character.type", label: "Actor type", type: "string" }
].map(Object.freeze));

/** "Змей (Хикару Флекс)" → callsign "Змей", real name "Хикару Флекс". Other names are all callsign. */
export function splitCharacterName(name) {
  if (typeof name !== "string") return { callsign: null, realName: null };
  const value = name.slice(0, 10000).trim(), match = /^(.*\S)\s*\(([^()]*)\)$/.exec(value);
  return match ? { callsign: match[1].trim(), realName: match[2].trim() } : { callsign: value, realName: "" };
}

const DEFAULT_AVATAR = "icons/svg/mystery-man.svg";
/**
 * The avatar of the player playing this Actor: the non-GM user whose assigned character it
 * is, otherwise a non-GM owner. Foundry's placeholder avatar counts as none.
 */
export function playerAvatar(actor, users = globalThis.game?.users) {
  const players = (users?.contents ?? (users ? [...users] : [])).filter(user => user && !user.isGM);
  const player = players.find(user => (user.character?.id ?? user.character) === actor?.id)
    ?? players.find(user => actor?.testUserPermission?.(user, "OWNER"));
  const avatar = player?.avatar;
  return typeof avatar === "string" && avatar !== DEFAULT_AVATAR ? safePortrait(avatar) : null;
}

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
        case "character.callsign": values[field] = splitCharacterName(actor.name).callsign; break;
        case "character.realName": values[field] = splitCharacterName(actor.name).realName; break;
        case "character.uuid": values[field] = typeof actor.uuid === "string" ? actor.uuid.slice(0, 128) : null; break;
        case "character.type": values[field] = typeof actor.type === "string" ? actor.type.slice(0, 128) : null; break;
        case "character.portrait": values[field] = (portraitSource === "token" ? safePortrait(actor.prototypeToken?.texture?.src) : null) ?? safePortrait(actor.img); break;
        case "character.tokenPortrait": values[field] = safePortrait(actor.prototypeToken?.texture?.src); break;
        case "character.playerAvatar": values[field] = playerAvatar(actor); break;
      }
    }
    return values;
  }
};
