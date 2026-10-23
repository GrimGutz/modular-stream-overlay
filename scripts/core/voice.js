/**
 * Discord voice data shared by the stream page, the editor and the OBS connector: the world's
 * list of players (Discord ID, name, character and glow color), Discord accounts to ignore
 * such as music bots, and the live state of the streamer's voice channel.
 */
import { validateActorUuid, validateDiscordId } from "./schema.js";

export const VOICE_ROSTER_SETTING = "voiceRoster";
export const VOICE_ROSTER_LIMIT = 50;
const MEMBER_LIMIT = 100;
const HEX = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;

function plainObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(message);
  return value;
}

function label(value, max = 80) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "";
}

/** Players and ignored accounts; every Discord ID appears at most once in the whole list. */
export function validateVoiceRoster(input = {}) {
  plainObject(input, "The Discord player list must be an object.");
  const speakers = Array.isArray(input.speakers) ? input.speakers : [];
  const ignored = Array.isArray(input.ignored) ? input.ignored : [];
  if (speakers.length > VOICE_ROSTER_LIMIT || ignored.length > VOICE_ROSTER_LIMIT) throw new TypeError("The Discord player list holds at most 50 players and 50 ignored accounts.");
  const seen = new Set();
  const unique = userId => {
    if (seen.has(userId)) throw new TypeError("Each Discord user ID may appear only once in the player list.");
    seen.add(userId);
    return userId;
  };
  return {
    speakers: speakers.map(entry => {
      plainObject(entry, "Each Discord player must be an object.");
      const color = typeof entry.color === "string" ? entry.color.trim() : "";
      if (color && !HEX.test(color)) throw new TypeError("A player's glow color must be a hexadecimal color such as #aa50ff.");
      return { userId: unique(validateDiscordId(entry.userId)), name: label(entry.name), actorUuid: validateActorUuid(entry.actorUuid ?? ""), color };
    }),
    ignored: ignored.map(entry => {
      plainObject(entry, "Each ignored Discord account must be an object.");
      return { userId: unique(validateDiscordId(entry.userId)), name: label(entry.name) };
    })
  };
}

export const EMPTY_VOICE_STATE = Object.freeze({ connected: false, channel: null, members: Object.freeze([]) });

/**
 * The connector's report: whether Discord is connected, the channel and its members in
 * Discord's order. Anything malformed is dropped rather than shown.
 */
export function validateVoiceState(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return EMPTY_VOICE_STATE;
  const id = value => typeof value === "string" && /^\d{1,25}$/.test(value) ? value : null;
  const channel = input.channel && typeof input.channel === "object" && id(input.channel.id)
    ? { id: input.channel.id, name: label(input.channel.name, 100), guildId: id(input.channel.guildId) } : null;
  const members = [], seen = new Set();
  for (const entry of Array.isArray(input.members) ? input.members.slice(0, MEMBER_LIMIT) : []) {
    const userId = entry && typeof entry === "object" ? id(entry.id) : null;
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    members.push({ id: userId, name: label(entry.name, 100) || userId, speaking: entry.speaking === true, muted: entry.muted === true,
      deafened: entry.deafened === true, bot: entry.bot === true });
  }
  return { connected: input.connected === true, channel, members: channel ? members : [] };
}
