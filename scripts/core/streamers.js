/**
 * Players the GM allowed to stream from their own account. Such a player runs their own stream
 * like a GM does: a studio saved under their account (overlays, widget designs, fragments and
 * Discord players), the overlay editor, live controls and the OBS connector on their PC. Their
 * stream reads characters with their own account's permissions. The world's library and the main
 * viewer stream stay the GM's. The list is a GM-only world setting.
 */
export const STREAMERS_SETTING = "streamers";
export const STREAMER_LIMIT = 64;
/** Library settings a studio keeps under the player's account in place of the world's. */
export const STUDIO_SETTINGS = Object.freeze({
  state: "studioState", widgetPresets: "studioWidgetPresets", layerFragments: "studioFragments", voiceRoster: "studioVoiceRoster"
});

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

/** Settings access with the library keys swapped for the studio's while `inStudio()` holds. */
export function studioSettings(settings, inStudio) {
  const key = name => inStudio() ? STUDIO_SETTINGS[name] ?? name : name;
  return Object.freeze({
    get: (namespace, name, options) => settings.get(namespace, key(name), options),
    set: (namespace, name, value, options) => settings.set(namespace, key(name), value, options)
  });
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
