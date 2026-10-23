import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { createOverlay, validateLayer } from "../scripts/core/schema.js";
import { createLayer } from "../scripts/core/layers.js";
import { validateVoiceRoster, validateVoiceState } from "../scripts/core/voice.js";
import { VoiceHub, connectVoice, VOICE_PATH } from "../scripts/integration/voice.js";
import { CONNECTOR_HEADER } from "../scripts/integration/obs.js";
import { bindVoice, rgbTriplet } from "../scripts/render/voice.js";
import { OverlayRenderer } from "../scripts/render/renderer.js";
import { WidgetRegistry } from "../scripts/core/registry.js";

const GM = "100000000000000001", ANNA = "100000000000000002", BOB = "100000000000000003", GUEST = "100000000000000004", KENKU = "100000000000000005", BOT = "100000000000000006";

class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = new Map();
    const classes = this.classes = new Set(), properties = this.properties = new Map();
    this.style = { setProperty: (name, value) => properties.set(name, value) };
    this.classList = { add: (...names) => names.forEach(name => classes.add(name)), contains: name => classes.has(name),
      toggle: (name, on) => { if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name); } };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  getBoundingClientRect() { return { width: 1920, height: 1080 }; }
}

beforeEach(() => {
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});

const roster = () => ({ speakers: [{ userId: ANNA, name: "Anna", actorUuid: "Actor.alpha", color: "#aa50ff" }, { userId: BOB, name: "Bob", actorUuid: "Actor.bravo" }],
  ignored: [{ userId: KENKU, name: "KenkuFM" }] });
const member = (id, name, extra = {}) => ({ id, name, speaking: false, muted: false, deafened: false, bot: false, ...extra });
const channel = (...members) => ({ connected: true, channel: { id: "200000000000000001", name: "Table", guildId: "200000000000000002" }, members });

test("voice fields are optional, validated and kept only where their target uses them", () => {
  const base = createLayer("color");
  assert.equal(Object.hasOwn(validateLayer(base), "voiceTarget"), false, "Older layouts keep their exact form");
  const user = validateLayer({ ...base, voiceTarget: "user", voiceUser: GM, voiceSlot: 3, voiceColor: "#ffffff", voiceShow: "present", voiceEffect: "glow" });
  assert.deepEqual([user.voiceTarget, user.voiceUser, user.voiceSlot, user.voiceShow], ["user", GM, undefined, "present"]);
  const unfinished = validateLayer({ ...base, voiceTarget: "user" });
  assert.equal(Object.hasOwn(unfinished, "voiceUser"), false, "A user target without an ID follows nobody");
  const slot = validateLayer({ ...base, voiceTarget: "slot", voiceUser: GM });
  assert.deepEqual([slot.voiceSlot, Object.hasOwn(slot, "voiceUser")], [1, false]);
  assert.equal(Object.hasOwn(validateLayer({ ...base, voiceColor: "#fff" }), "voiceColor"), false, "No target, no voice styles");
  for (const bad of [{ voiceTarget: "everyone" }, { voiceTarget: "user", voiceUser: "Anna#1234" }, { voiceTarget: "slot", voiceSlot: 21 },
    { voiceTarget: "actor", voiceShow: "sometimes" }, { voiceTarget: "actor", voiceEffect: "spin" }, { voiceTarget: "actor", voiceColor: "purple" }]) {
    assert.throws(() => validateLayer({ ...base, ...bad }));
  }
});

test("the player list and the connector's state are validated before use", () => {
  assert.deepEqual(validateVoiceRoster(roster()).speakers[1], { userId: BOB, name: "Bob", actorUuid: "Actor.bravo", color: "" });
  assert.deepEqual(validateVoiceRoster({}), { speakers: [], ignored: [] });
  for (const bad of [{ speakers: [{ userId: ANNA }, { userId: ANNA }] }, { speakers: [{ userId: ANNA }], ignored: [{ userId: ANNA }] },
    { speakers: [{ userId: ANNA, color: "purple" }] }, { speakers: [{ userId: "12" }] }, { speakers: [{ userId: ANNA, actorUuid: "Token.x" }] },
    { speakers: Array.from({ length: 51 }, (_, index) => ({ userId: String(10n ** 17n + BigInt(index)) })) }]) assert.throws(() => validateVoiceRoster(bad));
  const state = validateVoiceState({ connected: true, channel: { id: "1", name: "A\u0007B" }, members: [member(ANNA, "Anna", { speaking: true }), { id: "x" }, member(ANNA, "dup"), member(BOB, "")] });
  assert.deepEqual(state.members.map(entry => [entry.id, entry.name, entry.speaking]), [[ANNA, "Anna", true], [BOB, BOB, false]]);
  assert.equal(state.channel.name, "AB");
  assert.deepEqual(validateVoiceState("nonsense"), { connected: false, channel: null, members: [] });
});

test("the hub resolves users, characters' players and free slots, in each preview mode", async () => {
  const hub = new VoiceHub({ roster: roster() });
  hub.setState(channel(member(GM, "GrimGutz", { speaking: true }), member(BOT, "Music", { bot: true }), member(KENKU, "KenkuFM"),
    member(ANNA, "Anna"), member(GUEST, "Guest", { speaking: true }), member("500000000000000001", "Second guest")));
  const release = hub.claim(GM);
  assert.deepEqual(hub.resolve({ voiceTarget: "user", voiceUser: GM }), { userId: GM, color: "#ffffff", present: true, speaking: true, ignoreShow: false });
  assert.deepEqual(hub.resolve({ voiceTarget: "actor" }, "Actor.alpha"), { userId: ANNA, color: "#aa50ff", present: true, speaking: false, ignoreShow: false });
  assert.equal(hub.resolve({ voiceTarget: "actor", voiceColor: "#00ff00" }, "Actor.alpha").color, "#00ff00", "The layer's color wins");
  assert.equal(hub.resolve({ voiceTarget: "actor" }, "Actor.bravo").present, false, "Bob is listed but not in the channel");
  assert.equal(hub.resolve({ voiceTarget: "actor" }, "Actor.unlisted").userId, "");
  // Slots skip the claimed GM, the bot, the ignored Kenku and the listed Anna.
  assert.deepEqual([1, 2, 3].map(voiceSlot => hub.resolve({ voiceTarget: "slot", voiceSlot }).userId), [GUEST, "500000000000000001", ""]);
  assert.equal(hub.resolve({ voiceTarget: "slot", voiceSlot: 1 }).speaking, true);
  release();
  assert.equal(hub.resolve({ voiceTarget: "slot", voiceSlot: 1 }).userId, GM, "Once no layer names the GM, a slot may take them");
  hub.setMode("design");
  assert.deepEqual(hub.resolve({ voiceTarget: "actor" }, "Actor.bravo"), { userId: BOB, color: "#ffffff", present: true, speaking: false, ignoreShow: true });
  hub.setMode("speaking");
  assert.deepEqual([hub.resolve({ voiceTarget: "slot", voiceSlot: 9 }).present, hub.resolve({ voiceTarget: "slot", voiceSlot: 9 }).speaking], [true, true]);
  assert.throws(() => hub.setMode("loud"));
  let calls = 0;
  hub.subscribe(() => calls++);
  hub.setMode("live"); hub.claim(ANNA); hub.setRoster(roster());
  await setImmediate();
  assert.equal(calls, 1, "Changes in one turn notify once");
});

test("a bound element glows while its person speaks and hides by its show rule", async () => {
  const hub = new VoiceHub({ roster: roster() });
  const element = new Element("div");
  const binding = bindVoice(element, { voiceTarget: "actor", voiceShow: "present" }, hub, () => "Actor.alpha");
  assert(element.classes.has("mso-voice") && element.classes.has("mso-voice-glow"));
  assert.equal(element.properties.get("--mso-voice-rgb"), "170, 80, 255");
  assert(element.classes.has("mso-voice-away"), "Not in the channel yet");
  hub.setState(channel(member(ANNA, "Anna", { speaking: true })));
  await setImmediate();
  assert.deepEqual([element.classes.has("mso-voice-away"), element.classes.has("mso-speaking")], [false, true]);
  hub.setState(channel(member(ANNA, "Anna")));
  await setImmediate();
  assert.equal(element.classes.has("mso-speaking"), false);
  binding.destroy();
  hub.setState(channel(member(ANNA, "Anna", { speaking: true })));
  await setImmediate();
  assert.equal(element.classes.has("mso-speaking"), false, "A destroyed binding no longer follows");
  const plain = new Element("div");
  bindVoice(plain, { voiceTarget: "user", voiceUser: GM, voiceEffect: "none", voiceShow: "speaking" }, hub);
  assert.deepEqual([plain.classes.has("mso-voice-glow"), plain.classes.has("mso-voice-away")], [false, true]);
  assert.equal(bindVoice(new Element("div"), { type: "color" }, hub), null);
  assert.equal(bindVoice(new Element("div"), { voiceTarget: "user" }, null), null);
  assert.deepEqual([rgbTriplet("#fff"), rgbTriplet("#00ff0080"), rgbTriplet("nope")], ["255, 255, 255", "0, 255, 0", "255, 255, 255"]);
});

test("a layer showing a character glows in the character's accent unless the layer or player sets a color", async () => {
  const hub = new VoiceHub({ roster: { speakers: [{ userId: ANNA, actorUuid: "Actor.alpha", color: "" }, { userId: BOB, actorUuid: "Actor.bravo", color: "#00ff00" }] } });
  const accents = { "Actor.alpha": "#e8a000", "Actor.bravo": "#0064ff" }, listeners = new Map();
  const characterData = {
    resolve: async (uuid, fields) => ({ values: { [fields[0]]: accents[uuid] ?? null } }),
    subscribe: (uuid, callback) => { listeners.set(uuid, callback); return () => listeners.delete(uuid); }
  };
  const element = new Element("div");
  let actor = "Actor.alpha";
  const binding = bindVoice(element, { voiceTarget: "actor" }, hub, () => actor, characterData);
  await setImmediate();
  assert.equal(element.properties.get("--mso-voice-rgb"), "232, 160, 0", "Anna's character's blasphemy color");
  accents["Actor.alpha"] = "#ff0000";
  listeners.get("Actor.alpha")();
  await setImmediate();
  assert.equal(element.properties.get("--mso-voice-rgb"), "255, 0, 0", "It follows a changed accent");
  actor = "Actor.bravo";
  binding.refresh();
  await setImmediate();
  assert.equal(element.properties.get("--mso-voice-rgb"), "0, 255, 0", "A player's own color wins over the character's");
  assert.equal(listeners.has("Actor.alpha"), false, "The previous character is no longer watched");
  binding.destroy();
  assert.equal(listeners.size, 0);
  const fixed = new Element("div");
  bindVoice(fixed, { voiceTarget: "actor", voiceColor: "#123456" }, hub, () => "Actor.alpha", characterData);
  await setImmediate();
  assert.equal(fixed.properties.get("--mso-voice-rgb"), "18, 52, 86");
});

test("the renderer binds voice layers, including components that follow their card's character", async () => {
  const hub = new VoiceHub({ roster: roster() });
  const container = new Element("main");
  const renderer = new OverlayRenderer(container, { widgets: new WidgetRegistry(), context: { voice: hub, actorUuid: "Actor.alpha" } });
  const overlay = createOverlay("Voice");
  overlay.layers = [
    { ...createLayer("color", overlay.canvas), id: "frame", voiceTarget: "actor" },
    { ...createLayer("color", overlay.canvas), id: "gm", voiceTarget: "user", voiceUser: GM, voiceShow: "present" },
    { ...createLayer("color", overlay.canvas), id: "plain" }
  ];
  await renderer.render(overlay);
  const element = id => renderer.layerElements.get(id);
  assert.equal(element("plain").classes.has("mso-voice"), false);
  assert(element("gm").classes.has("mso-voice-away"));
  hub.setState(channel(member(GM, "GrimGutz"), member(ANNA, "Anna", { speaking: true })));
  await setImmediate();
  assert.deepEqual([element("frame").classes.has("mso-speaking"), element("gm").classes.has("mso-voice-away")], [true, false]);
  assert.equal(hub.claims.get(GM), 1);
  renderer.destroy();
  assert.equal(hub.claims.has(GM), false, "Destroying the scene releases its claims");
  assert.equal(hub.listeners.size, 0);
});

test("the stream page follows the connector's feed only when it is served through the connector", async () => {
  const sources = [], timers = [];
  class FakeEventSource { constructor(url) { this.url = url; this.closed = false; sources.push(this); } close() { this.closed = true; } }
  const behind = async () => ({ ok: true, headers: { get: name => name === CONNECTOR_HEADER ? "1" : null } });
  const fakeTimers = { setTimer: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; }, clearTimer: timer => { timer.cleared = true; } };
  const hub = new VoiceHub();
  const seen = [];
  const stop = connectVoice({ hub, fetch: behind, EventSourceClass: FakeEventSource, onState: state => seen.push(state), ...fakeTimers });
  await setImmediate();
  assert.equal(sources[0].url, VOICE_PATH);
  sources[0].onmessage({ data: JSON.stringify(channel(member(GM, "GrimGutz", { speaking: true }))) });
  assert.equal(hub.state.members[0].speaking, true);
  sources[0].onmessage({ data: "not json" });
  assert.equal(seen.length, 1);
  sources[0].onerror();
  assert.deepEqual([hub.state.connected, hub.state.members.length, sources[0].closed], [false, 0, true], "While the feed is away nobody is present");
  assert.equal(timers.length, 1, "It probes again instead of letting EventSource retry every few seconds");
  timers[0].callback();
  await setImmediate();
  assert.equal(sources.length, 2, "A restarted connector is followed again");
  stop();
  assert(sources[1].closed);
  connectVoice({ hub, fetch: async () => ({ ok: false, headers: { get: () => null } }), EventSourceClass: FakeEventSource, ...fakeTimers });
  await setImmediate();
  assert.deepEqual([sources.length, timers.length], [2, 1], "Pages opened without the connector make no event stream and do not ask again");
});

test("a GM's editor reads the connector directly, waiting for it only once it has answered", async () => {
  const timers = [], sources = [];
  class FakeEventSource { constructor(url) { this.url = url; sources.push(this); } close() { this.closed = true; } }
  const fakeTimers = { setTimer: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; }, clearTimer() {} };
  let up = false, gaveUp = 0;
  const fetch = async url => {
    assert.equal(url, "http://localhost:30001/mso-connector/voice");
    if (!up) throw new TypeError("Failed to fetch");
    return { ok: true, headers: { get: name => name === CONNECTOR_HEADER ? "1" : null } };
  };
  const options = { hub: new VoiceHub(), url: "http://localhost:30001/mso-connector/voice", fetch, EventSourceClass: FakeEventSource, waitForConnector: false,
    retryAfter: 15000, maxRetry: 60000, onGiveUp: () => gaveUp++, ...fakeTimers };
  connectVoice(options);
  await setImmediate();
  assert.deepEqual([gaveUp, timers.length], [1, 0], "No connector on this PC: one quiet try");
  up = true;
  connectVoice(options);
  await setImmediate();
  assert.equal(sources.length, 1);
  up = false;
  sources[0].onerror();
  for (let index = 0; index < 4; index++) { timers.at(-1).callback(); await setImmediate(); }
  assert.deepEqual(timers.map(timer => timer.delay), [15000, 30000, 60000, 60000, 60000], "Once it answered, it is awaited with growing pauses");
  assert.equal(gaveUp, 1);
});
