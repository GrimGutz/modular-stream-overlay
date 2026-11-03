/**
 * Players the GM allowed to stream. Such a player runs their own stream like a GM does: a studio
 * saved under their account (overlays, widget designs, fragments, Discord players, character
 * colors and profiles), the overlay editor, live controls and the OBS connector on their PC.
 * Their stream signs in with their own account or a free account they choose, and reads
 * characters with that account's permissions. The world's library, character fields and the main
 * viewer stream stay the GM's. The list is a GM-only world setting.
 */
export const STREAMERS_SETTING = "streamers";
export const STREAMER_LIMIT = 64;
/** The account a streaming player's stream signs in with (a user setting; empty: their own). */
export const STUDIO_ACCOUNT_SETTING = "studioViewer";
/** Library settings a studio keeps under the player's account in place of the world's. */
export const STUDIO_SETTINGS = Object.freeze({
  state: "studioState", widgetPresets: "studioWidgetPresets", layerFragments: "studioFragments", voiceRoster: "studioVoiceRoster",
  accentRules: "studioAccentRules", characterProfiles: "studioProfiles"
});
/** Studio settings that follow the world's until the player saves their own. */
const INHERITED = new Set(["accentRules", "characterProfiles"]);

const USER_ID = /^[A-Za-z0-9]{16}$/;

/** A list of Foundry user IDs, each once. */
export function validateStreamers(input = []) {
  if (!Array.isArray(input)) throw new TypeError("Player streams must be a list of user IDs.");
  if (input.length > STREAMER_LIMIT) throw new TypeError(`At most ${STREAMER_LIMIT} players can stream.`);
  if (input.some(id => typeof id !== "string" || !USER_ID.test(id))) throw new TypeError("Player streams must use Foundry user IDs.");
  return [...new Set(input)];
}

/** A player the GM allowed to stream. GMs and the main viewer account use the world library. */
export function isPlayerStreamer(user, streamers = [], viewerUserId = "") {
  return Boolean(user?.id && !user.isGM && user.id !== viewerUserId && streamers.includes(user.id));
}

/**
 * Settings access with the library keys swapped for a studio's. `owner()` names the streaming
 * player whose studio this client works with: `{ id, own: true }` on that player's own clients,
 * which read and write it, `{ id, own: false }` on the account their stream signs in with, which
 * only reads it (Foundry sends every user's settings to every client), or null for the world's.
 */
export function studioSettings(settings, owner) {
  const studio = name => {
    const who = Object.hasOwn(STUDIO_SETTINGS, name) ? owner() : null;
    return who ? { key: STUDIO_SETTINGS[name], own: who === true || who.own === true, id: who.id } : null;
  };
  return Object.freeze({
    get(namespace, name, options) {
      const target = studio(name);
      if (!target) return settings.get(namespace, name, options);
      const storage = settings.storage?.get?.("world");
      if (!storage?.getSetting) {
        const value = settings.get(namespace, target.key, options);
        return value === undefined && INHERITED.has(name) ? settings.get(namespace, name, options) : value;
      }
      const saved = storage.getSetting(`${namespace}.${target.key}`, target.id ?? globalThis.game?.userId);
      if (saved) return saved.value;
      if (INHERITED.has(name)) return settings.get(namespace, name, options);
      return target.own ? settings.get(namespace, target.key, options) : structuredClone(settings.settings?.get?.(`${namespace}.${target.key}`)?.default);
    },
    set(namespace, name, value, options) {
      const target = studio(name);
      if (!target) return settings.set(namespace, name, value, options);
      if (!target.own) throw new Error("Only the streaming player changes their studio.");
      return settings.set(namespace, target.key, value, options);
    }
  });
}

const isStreamer = (id, { streamers = [], viewerUserId = "", getUser }) => isPlayerStreamer(getUser(id), streamers, viewerUserId);
/** An account that can carry a studio's stream: it exists, is no GM, not the main viewer and not a streaming player. */
function servable(id, { streamers = [], viewerUserId = "", getUser }) {
  const account = getUser(id);
  return Boolean(account && !account.isGM && id !== viewerUserId && !streamers.includes(id));
}

/**
 * The account a streaming player's stream signs in with. `context` is { streamers, viewerUserId,
 * getUser(id), chosenBy(playerId) }. It is the account they chose while it can serve and no studio
 * listed before theirs chose it too, else their own.
 */
export function studioAccountId(playerId, context) {
  const choice = context.chosenBy(playerId);
  if (!choice || choice === playerId || !servable(choice, context)) return playerId;
  const streamers = context.streamers ?? [], index = streamers.indexOf(playerId);
  return streamers.slice(0, Math.max(0, index)).some(id => isStreamer(id, context) && context.chosenBy(id) === choice) ? playerId : choice;
}

/** The streaming player whose stream signs in with this account, when it is not their own. */
export function studioServedBy(accountId, context) {
  return (context.streamers ?? []).find(id => id !== accountId && isStreamer(id, context) && studioAccountId(id, context) === accountId) ?? null;
}

/** Accounts a streaming player may choose for their stream besides their own: free ones no other studio uses. */
export function studioAccountChoices(playerId, context, users = []) {
  const taken = new Set((context.streamers ?? []).filter(id => id !== playerId && isStreamer(id, context)).map(id => studioAccountId(id, context)));
  return users.filter(user => user.id !== playerId && servable(user.id, context) && !taken.has(user.id));
}

/** World Actors an overlay shows, so a streamer and the GM can see which ones the account cannot read. */
export function overlayActorUuids(overlay) {
  const uuids = new Set();
  for (const layer of overlay?.layers ?? []) {
    if (layer.type === "character-widget" && layer.dataSource === "demo") continue;
    for (const uuid of [...layer.actorUuids ?? [], layer.actorUuid]) if (typeof uuid === "string" && uuid.startsWith("Actor.")) uuids.add(uuid);
  }
  return [...uuids];
}
