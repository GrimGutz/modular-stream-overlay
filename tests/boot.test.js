import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { createOverlay } from "../scripts/core/schema.js";
import { SOCKET_NAME } from "../scripts/animation/transport.js";

// A bounded client harness tests real hook/setting wiring; this is not a Foundry runtime.
class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.style = {}; this.dataset = {};
    this.classes = new Set(); this.classList = { add: name => this.classes.add(name) }; this.animations = [];
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  addEventListener() {} setAttribute() {}
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  querySelector(selector) { return this.children.find(node => `.${node.className}` === selector) ?? null; }
  getBoundingClientRect() { return { width: 1920, height: 1080 }; }
  animate(frames, options) { const entry = { frames, options, cancelled: false, cancel() { this.cancelled = true; }, finished: Promise.resolve() }; this.animations.push(entry); return entry; }
}

async function boot({ stream = true, characters = false, configureOverlay = () => {} } = {}) {
  const listeners = new Map();
  function add(name, fn, once) { const values = listeners.get(name) ?? []; values.push({ fn, once }); listeners.set(name, values); }
  globalThis.Hooks = {
    once: (name, fn) => add(name, fn, true), on: (name, fn) => add(name, fn, false),
    callAll(name, ...args) {
      const callbacks = [...(listeners.get(name) ?? [])];
      listeners.set(name, callbacks.filter(entry => !entry.once));
      for (const { fn } of callbacks) fn(...args);
    }
  };
  const values = new Map(); const settings = new Map(); const menus = new Map();
  const overlay = createOverlay("Live"); overlay.background.src = "assets/original.webp";
  const actors = ["alpha", "bravo"].map((id, index) => ({ uuid: `Actor.${id}`, documentName: "Actor", name: id,
    img: `portraits/${id}.webp`, type: "character", allowed: true,
    testUserPermission() { return this.allowed; }, system: { health: { value: 20 + index * 10, max: 40 } } }));
  if (characters) overlay.layers = actors.map((actor, index) => ({ id: `card-${index}`, type: "character-widget",
    presetId: "widget-basic-character-card", actorUuid: actor.uuid, x: index * 450, width: 400, height: 180 }));
  configureOverlay(overlay);
  values.set("state", { schemaVersion: 1, revision: 1, activeOverlayId: overlay.id, overlays: [overlay], presets: [] });
  values.set("viewerUserId", "viewer");
  const player = { id: "viewer", role: 1, isGM: false };
  const socket = new EventEmitter();
  const state = { reloads: 0, errors: [] };
  globalThis.game = {
    view: stream ? "stream" : "game", user: player, userId: player.id, socket,
    system: { id: "cain" }, actors: { contents: actors },
    users: new Map([[player.id, player]]), modules: new Map([["modular-stream-overlay", {}]]),
    settings: {
      register(_id, key, config) { settings.set(key, config); if (!values.has(key)) values.set(key, config.default); },
      registerMenu(_id, key, config) { menus.set(key, config); },
      get(_id, key) { return values.get(key); },
      async set(_id, key, value) { values.set(key, value); settings.get(key)?.onChange?.(value); return value; }
    }
  };
  globalThis.ui = { notifications: { error: value => state.errors.push(value), info() {}, warn() {} } };
  globalThis.foundry = {
    applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base, DialogV2: {} } },
    utils: { getRoute: route => `/prefix/${route}`, deepClone: structuredClone, fromUuid: async uuid => actors.find(actor => actor.uuid === uuid) }
  };
  globalThis.document = { documentElement: new Element("html"), body: new Element("body"), createElement: tag => new Element(tag) };
  globalThis.HTMLElement = Element;
  globalThis.CONFIG = { queries: {} };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const location = new URL(`https://example.invalid/prefix/${stream ? "stream?mso=1" : "game"}`);
  location.reload = () => state.reloads++;
  const windowListeners = new Map();
  globalThis.window = { location, addEventListener: (name, callback) => windowListeners.set(name, callback) };
  await import(`../scripts/main.js?test=${Math.random()}`);
  Hooks.callAll("init");
  if (stream) Hooks.callAll("streamReady"); else Hooks.callAll("ready");
  await setImmediate();
  return { ...state, state, values, settings, menus, overlay, player, socket, actors,
    api: game.modules.get("modular-stream-overlay").api, windowListeners,
    output: document.body.children.find(child => child.id === "mso-output") };
}

// Model the native /stream transport: module events carry a server-stamped sender
// ID, and there is deliberately no incoming core userQuery listener.
async function deliverCommand(client, command, user) {
  game.users.set(user.id, user);
  let acknowledgement;
  const capture = payload => {
    if (payload.type === "ack" && payload.id === command.id) acknowledgement = payload;
  };
  client.socket.on(SOCKET_NAME, capture);
  client.socket.emit(SOCKET_NAME, { type: "command", viewerId: client.player.id, command }, user.id);
  await setImmediate();
  client.socket.off(SOCKET_NAME, capture);
  return acknowledgement ?? { accepted: false };
}

test("native stream hook renders and receives saved configuration changes without a restart", async () => {
  const { output, values, overlay, state } = await boot();
  assert(document.documentElement.classes.has("mso-broadcast"));
  assert.equal(output.children[0].children[0].src, "/prefix/assets/original.webp");
  const saved = structuredClone(values.get("state"));
  saved.revision++; saved.overlays[0].background.src = "assets/changed.webp";
  await game.settings.set("modular-stream-overlay", "state", saved);
  await setImmediate();
  assert.equal(output.children[0].children[0].src, "/prefix/assets/changed.webp");
  assert.equal(state.reloads, 0);
  saved.revision++; saved.activeOverlayId = null;
  await game.settings.set("modular-stream-overlay", "state", saved);
  await setImmediate();
  assert.equal(output.children.length, 0, "None is fully transparent, including status messages");
  assert.equal(overlay.name, "Live");
});

test("native stream module socket plays a manual rule once and rejects invalid identities or rules", async () => {
  const f = await boot({ characters: true, configureOverlay(overlay) {
    Object.assign(overlay.layers[0], { animationOverrides: true, triggers: [
      { id: "salute", event: "manual", action: { type: "play-animation", animation: { type: "bounce", duration: 350 } } },
      { id: "off", event: "manual", enabled: false, action: { type: "play-animation" } }
    ] });
  } });
  const query = (command, { user }) => deliverCommand(f, command, user);
  const card = f.output.children[0].children.find(element => element.dataset.instanceId === "card-0");
  const now = Date.now();
  const command = { id: "test-command", overlayId: f.overlay.id, layerId: "card-0", kind: "manual", ruleId: "salute", createdAt: now, expiresAt: now + 10000 };
  const gm = { id: "gm", isGM: true, role: 4 };
  assert.equal((await query(command, { user: f.player })).accepted, false);
  assert.equal((await query(command, { user: gm })).accepted, true);
  assert.equal(card.animations.length, 1);
  assert.equal(card.animations[0].options.duration, 350);
  assert.equal((await query(command, { user: gm })).accepted, false);
  assert.equal((await query({ ...command, id: "invalid-rule", ruleId: "absent" }, { user: gm })).accepted, false);
  assert.equal((await query({ ...command, id: "disabled-rule", ruleId: "off" }, { user: gm })).accepted, false);
  assert.equal((await query({ ...command, id: "stale", expiresAt: now - 1 }, { user: gm })).accepted, false);
  assert.equal(card.animations.length, 1);
  assert.equal(f.values.get("state").revision, 1, "Playback never writes settings");
  f.socket.emit("disconnect");
});

test("live panel persists GM visibility while ordinary sessions ignore ephemeral stream commands", async () => {
  const f = await boot({ stream: false, characters: true });
  assert.equal(f.menus.get("liveControls").restricted, true);
  assert.equal(f.settings.get("animationsEnabled").default, true);
  await assert.rejects(f.api.liveControls.setVisibility("card-0", false), /Only a GM/);
  const gm = { id: "gm", isGM: true, role: 4 }; game.user = gm;
  await f.api.liveControls.setVisibility("card-0", false);
  assert.equal(f.values.get("state").overlays[0].layers[0].visible, false);
  await f.api.liveControls.setActive(null);
  assert.equal(f.values.get("state").activeOverlayId, null);
  assert.equal((await deliverCommand(f, { id: "not-a-stream-command" }, gm)).accepted, false);
  assert.equal(f.socket.listenerCount("userQuery"), 0, "The replacement needs no core query receiver");
  f.windowListeners.get("pagehide")();
  assert.equal(f.socket.listenerCount(SOCKET_NAME), 0, "Only the module's listener is removed on close");
});

test("GM live API sends a temporary command through the stream transport and accepts the viewer acknowledgement", async () => {
  const f = await boot({ stream: false, characters: true });
  const gm = { id: "gm", isGM: true, role: 4 };
  game.user = gm; game.users.set(gm.id, gm); f.player.active = true;
  const before = structuredClone(f.values.get("state"));
  let packet, recipients;
  const accept = (payload, options) => {
    if (payload.type !== "command") return;
    packet = payload; recipients = options.recipients;
    f.socket.emit(SOCKET_NAME, { type: "ack", gmId: gm.id, id: payload.command.id, accepted: true }, f.player.id);
  };
  f.socket.on(SOCKET_NAME, accept);
  assert.deepEqual(await f.api.liveControls.play("card-0"), { accepted: true });
  assert.deepEqual(recipients, [f.player.id]);
  assert.equal(packet.viewerId, f.player.id);
  assert.equal(packet.command.layerId, "card-0"); assert.equal(packet.command.kind, "play");
  assert.deepEqual(f.values.get("state"), before, "Manual playback never saves state");
  assert.deepEqual(CONFIG.queries, {}, "No incoming User.query listener is required in OBS");
  f.socket.off(SOCKET_NAME, accept); f.windowListeners.get("pagehide")();
});

test("viewer changes, disconnects and corrupt state clear the previous stage", async t => {
  t.mock.method(console, "error", () => {});
  const { output, player, socket, state, values } = await boot();
  await game.settings.set("modular-stream-overlay", "viewerUserId", "another-account");
  await setImmediate();
  assert.equal(output.children[0].className, "mso-message");
  await game.settings.set("modular-stream-overlay", "viewerUserId", player.id);
  await setImmediate();
  assert.equal(output.children[0].className, "mso-stage");
  const saved = structuredClone(values.get("state"));
  await game.settings.set("modular-stream-overlay", "state", { ...saved, schemaVersion: 999 });
  await setImmediate();
  assert.equal(output.children[0].className, "mso-message");
  await game.settings.set("modular-stream-overlay", "state", saved);
  await setImmediate();
  socket.emit("disconnect");
  assert.equal(output.children.length, 0);
  await game.settings.set("modular-stream-overlay", "state", saved);
  await setImmediate();
  assert.equal(output.children.length, 0, "Settings cannot restore output while offline");
  socket.emit("connect");
  assert.equal(state.reloads, 1);
});

test("normal game boot registers settings and API without replacing the interface", async () => {
  const { api, menus, output } = await boot({ stream: false });
  assert.equal(output, undefined);
  assert.equal(document.documentElement.classes.has("mso-broadcast"), false);
  assert.equal(menus.get("editor").restricted, true);
  assert.equal(api.getOBSUrl(), "https://example.invalid/prefix/stream?mso=1");
  await assert.rejects(api.setViewerUserId("viewer"), /Only a GM/);
  game.user = { id: "gm", role: 4, isGM: true };
  await assert.rejects(api.setViewerUserId("missing-account"), /existing user account/);
  await api.setViewerUserId("");
  assert.equal(api.getViewerUserId(), "");
});

test("stream wiring initializes current character cards and updates Actor content without replacing the overlay", async () => {
  const f = await boot({ characters: true });
  const stage = f.output.children[0];
  const card = index => stage.children.find(element => element.dataset.instanceId === `card-${index}`);
  const component = (index, id) => card(index).children[0].children.find(element => element.dataset.instanceId === id);
  assert.equal(component(0, "name").children[0].textContent, "alpha");
  assert.equal(component(1, "name").children[0].textContent, "bravo");
  f.actors[0].name = "Updated character"; f.actors[0].system.health.value = 8;
  Hooks.callAll("updateActor", f.actors[0]);
  await new Promise(resolve => setTimeout(resolve, 65));
  assert.equal(f.output.children[0], stage);
  assert.equal(component(0, "name").children[0].textContent, "Updated character");
  assert.equal(component(0, "hp-text").children[0].textContent, "HP: 8/40");
  assert.equal(component(1, "name").children[0].textContent, "bravo");
  assert.equal(f.state.reloads, 0);
  assert.equal(f.values.get("state").revision, 1, "Actor events never persist presentation snapshots");
  f.actors[0].allowed = false; Hooks.callAll("updateActor", f.actors[0]);
  await new Promise(resolve => setTimeout(resolve, 65));
  assert.equal(component(0, "name").children[0].textContent, "Character");
  assert.equal(component(0, "hp-bar").children.length, 0);
  f.socket.emit("disconnect");
  assert.equal(f.output.children.length, 0);
  assert.equal(f.api.characterData.subscriptions.size, 0);
});

test("widget design settings refresh linked stream instances and mapping changes require a GM", async () => {
  const f = await boot({ characters: true });
  await assert.rejects(f.api.setFieldMappings([]), /Only a GM/);
  const library = f.api.widgetPresets.getState();
  const design = library.presets[0];
  design.layers.find(layer => layer.id === "name").fontSize = 40;
  library.revision++;
  // Simulate the authoritative settings notification from a separate GM client.
  await game.settings.set("modular-stream-overlay", "widgetPresets", library);
  await setImmediate();
  const stage = f.output.children[0];
  for (let index = 0; index < 2; index++) {
    const card = stage.children.find(element => element.dataset.instanceId === `card-${index}`);
    const name = card.children[0].children.find(element => element.dataset.instanceId === "name");
    assert.equal(name.children[0].style.fontSize, "40px");
    assert.equal(name.children[0].textContent, f.actors[index].name);
  }
  assert.deepEqual(f.api.store.getState().overlays[0].layers.map(layer => layer.actorUuid), f.actors.map(actor => actor.uuid));
  assert.equal(f.api.store.getState().overlays[0].layers[1].x, 450);
  f.socket.emit("disconnect");
});

test("native stream builds independent widget carousels and accepts only authenticated ephemeral page commands", async () => {
  const f = await boot({ characters: true });
  const library = f.api.widgetPresets.getState(), preset = library.presets[0];
  preset.pages = [
    { id: "health-page", name: "Health", layers: [{ id: "page-health", type: "dynamic-number", binding: "character.hp.current" }] },
    { id: "name-page", name: "Name", layers: [{ id: "page-name", type: "character-name" }] },
    { id: "extra-page", name: "Extra", layers: [{ id: "page-extra", type: "text", text: "More information" }] }
  ];
  preset.cycling = { enabled: false, transition: "fade", transitionDuration: 100, duration: 5000, loop: true, startPageId: "health-page" };
  library.revision++;
  await game.settings.set("modular-stream-overlay", "widgetPresets", library); await setImmediate();
  const stage = f.output.children[0];
  const card = index => stage.children.find(element => element.dataset.instanceId === `card-${index}`);
  const pages = index => card(index).children[0].children.filter(element => element.className === "mso-carousel-page");
  const visiblePage = index => pages(index).find(element => element.style.display !== "none")?.dataset.pageId;
  assert.equal(visiblePage(0), "health-page"); assert.equal(visiblePage(1), "health-page");
  assert.equal(pages(0)[0].children[0].children[0].children[0].textContent, "20");
  assert.equal(pages(1)[0].children[0].children[0].children[0].textContent, "30");
  await assert.rejects(f.api.liveControls.carousel("card-0", "next"), /Only a Game Master/);
  const gm = { id: "gm", role: 4, isGM: true }, now = Date.now();
  const command = { id: "pages-1", overlayId: f.overlay.id, layerId: "card-0", createdAt: now, expiresAt: now + 10000, kind: "carousel", action: "next" };
  assert.equal((await deliverCommand(f, command, f.player)).accepted, false);
  assert.equal((await deliverCommand(f, command, gm)).accepted, true);
  await setImmediate();
  assert.equal(visiblePage(0), "name-page"); assert.equal(visiblePage(1), "health-page");
  assert.equal((await deliverCommand(f, command, gm)).accepted, false, "A duplicate cannot advance twice");
  assert.equal((await deliverCommand(f, { ...command, id: "pages-2", action: "select", pageId: "missing" }, gm)).accepted, false);
  assert.equal((await deliverCommand(f, { ...command, id: "pages-3", action: "select", pageId: "extra-page" }, gm)).accepted, true);
  await setImmediate();
  assert.equal(visiblePage(0), "extra-page");
  assert.equal(f.values.get("state").revision, 1, "Transient page state is never persisted");
  f.actors[0].system.health.value = 11; Hooks.callAll("updateActor", f.actors[0]);
  await new Promise(resolve => setTimeout(resolve, 65));
  assert.equal(f.output.children[0], stage, "Actor updates do not interrupt the carousel");
  assert.equal(visiblePage(0), "extra-page");
  assert.equal(pages(0)[0].children[0].children[0].children[0].textContent, "11", "Hidden pages retain current permitted values");
  f.socket.emit("disconnect"); assert.equal(f.api.characterData.subscriptions.size, 0);
});

test("authenticated combined commands advance Actor/page pairs, select assigned Actors and reset without saving playback", async () => {
  const f = await boot({ characters: true, configureOverlay(overlay) {
    overlay.layers[0].actorUuids = ["Actor.alpha", "Actor.bravo"];
    overlay.layers[0].carousel = { mode: "combined", enabled: false };
  } });
  const library = f.api.widgetPresets.getState(), preset = library.presets[0];
  preset.pages = [
    { id: "hp-page", name: "Health", layers: [{ id: "page-hp", type: "dynamic-number", binding: "character.hp.current" }] },
    { id: "percent-page", name: "Percent", layers: [{ id: "page-percent", type: "dynamic-number", binding: "character.hp.percent" }] }
  ];
  preset.cycling.transitionDuration = 100; preset.cycling.characterTransitionDuration = 100;
  preset.triggers = [{ id: "salute", event: "manual", action: { type: "play-animation", animation: { type: "pulse", duration: 200 } } }];
  library.revision++; await game.settings.set("modular-stream-overlay", "widgetPresets", library); await setImmediate();
  const stage = f.output.children[0], card = stage.children.find(element => element.dataset.instanceId === "card-0");
  const active = () => card.children.find(element => element.className === "mso-actor-presentation" && element.style.display !== "none");
  const activePage = () => active().children[0].children.find(element => element.className === "mso-carousel-page" && element.style.display !== "none")?.dataset.pageId;
  const name = () => active().children[0].children.find(element => element.dataset.instanceId === "name").children[0].textContent;
  const gm = { id: "gm", role: 4, isGM: true }; let sequence = 0;
  const command = extra => ({ id: `combined-${++sequence}`, overlayId: f.overlay.id, layerId: "card-0", kind: "carousel",
    createdAt: Date.now(), expiresAt: Date.now() + 10000, ...extra });
  const send = async extra => { const response = await deliverCommand(f, command(extra), gm); await setImmediate(); return response; };
  assert.equal(active().dataset.actorUuid, "Actor.alpha"); assert.equal(activePage(), "hp-page"); assert.equal(name(), "alpha");
  assert.equal((await send({ action: "next" })).accepted, true); assert.equal(activePage(), "percent-page");
  assert.equal((await send({ action: "next" })).accepted, true); assert.equal(activePage(), "hp-page"); assert.equal(name(), "bravo");
  assert.equal((await send({ action: "select-actor", actorUuid: "Actor.alpha" })).accepted, true); assert.equal(name(), "alpha");
  assert.equal((await send({ action: "select-actor", actorUuid: "Actor.unassigned" })).accepted, false);
  assert.equal((await send({ action: "select", pageId: "percent-page", actorUuid: "Actor.bravo" })).accepted, true);
  assert.equal(name(), "bravo"); assert.equal(activePage(), "percent-page");
  assert.equal((await send({ kind: "manual", ruleId: "salute" })).accepted, true);
  assert.equal(active().children[0].animations.length, 1, "Manual widget rules use the displayed Actor's motion");
  assert.equal((await send({ action: "reset" })).accepted, true); assert.equal(name(), "alpha"); assert.equal(activePage(), "hp-page");
  assert.equal((await deliverCommand(f, command({ action: "next" }), f.player)).accepted, false);
  assert.equal(f.values.get("state").revision, 1); assert.equal(f.api.liveControls.getState().layers[0].characters.length, 2);
  f.socket.emit("disconnect"); assert.equal(f.api.characterData.subscriptions.size, 0);
});

test("module demo API installs safely and the native stream route renders its synthetic pages through authenticated commands", async t => {
  t.mock.method(console, "debug", () => {});
  const f = await boot({ characters: true });
  assert.throws(() => f.api.installDemo(), /Only a GM/);
  assert.equal(f.settings.get("debugAnimations").default, false);
  const gm = { id: "gm", role: 4, isGM: true }; game.users.set(gm.id, gm); game.user = gm;
  const original = f.api.store.getState().overlays, originalActive = f.values.get("state").activeOverlayId;
  const result = await f.api.installDemo();
  assert.equal(f.values.get("state").activeOverlayId, originalActive);
  assert.deepEqual(f.api.store.getState().overlays.filter(item => item.id !== result.overlayId), original);
  assert.equal((await f.api.installDemo()).created, false);
  await f.api.liveControls.setActive(result.overlayId); await f.api.setDebug(true);
  game.user = f.player; Hooks.callAll("updateUser", f.player); await setImmediate(); await setImmediate();
  const [diagnostic] = f.api.getDiagnostics();
  assert.equal(diagnostic.actorUuid, "Demo.warrior"); assert.equal(diagnostic.pageId, "demo-main"); assert.equal(diagnostic.mode, "combined");
  const command = { id: "demo-live-pause", overlayId: result.overlayId, layerId: "demo-character-widget", kind: "carousel", action: "pause", createdAt: Date.now(), expiresAt: Date.now() + 10000 };
  assert.equal((await deliverCommand(f, command, gm)).accepted, true);
  assert.equal(f.api.getDiagnostics()[0].paused, true);
  assert.equal((await deliverCommand(f, { ...command, id: "demo-live-damage", kind: "demo", action: "damage" }, gm)).accepted, true);
  assert.equal((await f.api.characterData.resolve("Demo.warrior", ["character.hp.current"])).values["character.hp.current"], 65);
  assert.deepEqual(f.actors.map(actor => actor.system.health.value), [20, 30]);
  f.socket.emit("disconnect"); assert.equal(f.api.characterData.subscriptions.size, 0);
});

test("system providers are wired to world preferences, refresh values and require a GM to change selection", async () => {
  const f = await boot({ stream: false });
  assert.equal(f.settings.get("adapterPreferences").restricted, true);
  assert.deepEqual(f.api.getAdapterPreferences(), {});
  assert.equal(f.api.adapters.get("dnd5e").systemId, "dnd5e");
  await assert.rejects(f.api.setAdapterPreferences({ cain: "alternate" }), /Only a GM/);
  game.user = { id: "gm", isGM: true, role: 4 };
  game.system.version = "1.3.26"; f.actors[0].system.CATLEVEL = { value: 3 };
  assert.equal((await f.api.characterData.resolve(f.actors[0].uuid, ["character.cain.cat"])).values["character.cain.cat"], 3);
  f.api.registerAdapter({ id: "alternate", label: "Alternate CAIN", systemId: "cain", fields: [{ id: "character.cain.cat", label: "Custom CAT", type: "number" }], normalize: () => ({ "character.cain.cat": 9 }) });
  await f.api.setAdapterPreferences({ cain: "alternate" });
  assert.equal(f.api.characterData.getAdapterState().adapterId, "alternate");
  assert.equal((await f.api.characterData.resolve(f.actors[0].uuid, ["character.cain.cat"])).values["character.cain.cat"], 9);
  await assert.rejects(f.api.setAdapterPreferences(JSON.parse('{"__proto__":"alternate"}')), /supported system/);
  await f.api.setAdapterPreferences({ cain: "missing" });
  assert.deepEqual((await f.api.characterData.resolve(f.actors[0].uuid, ["character.name", "character.cain.cat"])).values, { "character.name": "alpha" });
  f.api.characterData.stop();
});

test("CAIN examples are opt-in, GM-only and leave real Actor assignments and active output alone", async () => {
  const f = await boot({ stream: false });
  const before = f.api.store.getState(), actors = structuredClone(f.actors.map(actor => actor.system));
  assert(!f.api.widgetPresets.list().some(preset => preset.id === "cain-exorcist-card"));
  assert.throws(() => f.api.installCainPresets(), /Only a GM/);
  game.user = { id: "gm", isGM: true, role: 4 };
  const installed = await f.api.installCainPresets();
  assert.equal(installed.createdPresetIds.length, 2);
  assert.equal(f.api.store.getState().activeOverlayId, before.activeOverlayId);
  const overlay = f.api.store.getState().overlays.find(overlay => overlay.id === installed.overlayId);
  assert.deepEqual(overlay.layers[0].actorUuids, []);
  assert.deepEqual(f.actors.map(actor => actor.system), actors);
  assert.equal((await f.api.installCainPresets()).created, false);
  f.api.characterData.stop();
});
