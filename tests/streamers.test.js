import test from "node:test";
import assert from "node:assert/strict";
import { STREAMER_LIMIT, STUDIO_SETTINGS, isPlayerStreamer, overlayActorUuids, studioSettings, validateStreamers } from "../scripts/core/streamers.js";
import { viewerAccessMessage } from "../scripts/integration/obs.js";
import { AnimationCommands } from "../scripts/animation/commands.js";
import { OverlayStore } from "../scripts/core/store.js";
import { WidgetPresetStore } from "../scripts/core/widget-presets.js";
import { listFragments, saveFragment } from "../scripts/core/fragments.js";
import { createOverlay, createState } from "../scripts/core/schema.js";
import { createLayer } from "../scripts/core/layers.js";

const PLAYER = "PlayerAccount001", OTHER = "PlayerAccount002", VIEWER = "ViewerAccount001", GM = "GameMaster000001";
const player = { id: PLAYER, role: 1, isGM: false }, viewer = { id: VIEWER, role: 1, isGM: false }, gm = { id: GM, role: 4, isGM: true };

function memorySettings() {
  const values = new Map();
  return { values, get: (_namespace, key) => values.get(key), async set(_namespace, key, value) { values.set(key, structuredClone(value)); return value; } };
}

test("player streams keep a list of Foundry user IDs, each once", () => {
  assert.deepEqual(validateStreamers([]), []);
  assert.deepEqual(validateStreamers([PLAYER, OTHER, PLAYER]), [PLAYER, OTHER]);
  for (const invalid of [null, {}, "x", [5], ["short"], [PLAYER, null], { [PLAYER]: {} }]) assert.throws(() => validateStreamers(invalid), TypeError);
  const many = Array.from({ length: STREAMER_LIMIT + 1 }, (_, index) => `Player${String(index).padStart(10, "0")}`);
  assert.throws(() => validateStreamers(many), /At most 64 players/);
});

test("only a listed player streams from a studio; GMs and the main viewer keep the world library", () => {
  const streamers = [PLAYER, VIEWER, GM];
  assert.equal(isPlayerStreamer(player, streamers, VIEWER), true);
  assert.equal(isPlayerStreamer(viewer, streamers, VIEWER), false, "The viewer account is the main stream");
  assert.equal(isPlayerStreamer(gm, streamers, VIEWER), false, "A GM already edits the world library");
  assert.equal(isPlayerStreamer({ id: OTHER, isGM: false }, streamers, VIEWER), false);
  assert.equal(isPlayerStreamer(null, streamers, VIEWER), false);
});

test("studio settings swap only the library keys, and only while the player streams", async () => {
  const settings = memorySettings();
  let studio = true;
  const library = studioSettings(settings, () => studio);
  for (const [key, studioKey] of Object.entries(STUDIO_SETTINGS)) {
    await library.set("modular-stream-overlay", key, { from: key });
    assert.deepEqual(settings.values.get(studioKey), { from: key });
    assert.equal(settings.values.has(key), false);
  }
  await library.set("modular-stream-overlay", "fieldMappings", ["shared"]);
  assert.deepEqual(settings.values.get("fieldMappings"), ["shared"], "Character fields stay the world's");
  studio = false;
  assert.equal(library.get("modular-stream-overlay", "state"), undefined, "Revoked streaming reads the world again");
});

test("a studio is an ordinary library the streaming player writes, without touching the world's", async () => {
  const settings = memorySettings();
  let studio = true;
  const library = studioSettings(settings, () => studio);
  const canEdit = user => user?.isGM || (user === player && studio);
  const store = new OverlayStore({ settings: library, getUser: () => player, canEdit });
  const overlay = await store.createOverlay("My stream");
  assert.equal(settings.values.get("studioState").activeOverlayId, overlay.id);
  const designs = new WidgetPresetStore({ settings: library, getUser: () => player, canEdit });
  const design = await designs.create("My card");
  assert(settings.values.get("studioWidgetPresets").presets.some(preset => preset.id === design.id));
  await saveFragment("Corner", [createLayer("text", overlay.canvas)], library);
  assert.equal(listFragments(library).length, 1);
  assert.deepEqual(["state", "widgetPresets", "layerFragments"].filter(key => settings.values.has(key)), [], "The world's library is untouched");
  studio = false;
  await assert.rejects(store.createOverlay("World"), /Only a Game Master/);
  await assert.rejects(new OverlayStore({ settings, getUser: () => player }).createOverlay("Default"), /Only a Game Master/, "Stores stay GM-only by default");
});

test("the stream page renders for the viewer and for listed players, with a clear message for anyone else", () => {
  const streamers = [PLAYER];
  assert.equal(viewerAccessMessage(player, VIEWER, streamers), "");
  assert.equal(viewerAccessMessage(player, "", streamers), "", "A player streams without any viewer account");
  assert.equal(viewerAccessMessage(viewer, VIEWER, streamers), "");
  assert.match(viewerAccessMessage({ id: OTHER }, VIEWER, streamers), /viewer account or a player the GM allowed to stream/);
  assert.match(viewerAccessMessage({ id: OTHER }, "", streamers), /disabled/);
  assert.match(viewerAccessMessage(player, VIEWER), /viewer account/, "Without the setting nothing changes");
});

test("an overlay's world characters are listed once; demo widgets and empty slots are skipped", () => {
  const overlay = { layers: [
    { type: "character-widget", dataSource: "actors", actorUuids: ["Actor.a", "Actor.b"], actorUuid: "Actor.a" },
    { type: "character-widget", dataSource: "demo", actorUuids: ["Demo.x"], actorUuid: "Demo.x" },
    { type: "character-name", actorUuid: "Actor.c" }, { type: "text" }, { type: "character-widget", dataSource: "actors", actorUuids: [], actorUuid: "" }
  ] };
  assert.deepEqual(overlayActorUuids(overlay), ["Actor.a", "Actor.b", "Actor.c"]);
  assert.deepEqual(overlayActorUuids(null), []);
});

test("a streaming player publishes to their own stream page, which obeys only that player", async () => {
  const state = createState(), overlay = createOverlay(), target = createLayer("image", overlay.canvas);
  overlay.layers.push(target); state.overlays.push(overlay); state.activeOverlayId = overlay.id;
  const played = [], sent = [];
  // As main.js wires a studio: the player is both the controller and the stream's account.
  const canControl = user => user?.id === PLAYER;
  const commands = new AnimationCommands({ getState: () => state, getUser: () => ({ ...player, active: true }), getViewer: () => ({ ...player, active: true }),
    canControl, isReceiver: () => true, now: () => 100000, createId: () => `command-${sent.length + 1}`,
    send: async command => { sent.push(command); return { accepted: true }; },
    getRenderer: () => ({ handleAnimationCommand: command => { played.push(command.id); return true; } }) });
  assert.deepEqual(await commands.publish(target.id), { accepted: true });
  assert.equal(sent[0].overlayId, overlay.id);
  const command = id => ({ id, overlayId: overlay.id, layerId: target.id, createdAt: 100000, expiresAt: 110000, kind: "play" });
  assert.equal((await commands.receive(command("from-gm"), { user: gm })).accepted, false, "The GM does not run a player's stream");
  assert.equal((await commands.receive(command("from-other"), { user: { id: OTHER, isGM: false } })).accepted, false);
  assert.equal((await commands.receive(command("own"), { user: player })).accepted, true);
  assert.deepEqual(played, ["own"]);
});
