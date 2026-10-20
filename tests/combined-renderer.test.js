import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createOverlay } from "../scripts/core/schema.js";
import { createWidgetPreset } from "../scripts/core/widget-presets.js";
import { createWidgetInstance } from "../scripts/core/layers.js";
import { OverlayRenderer } from "../scripts/render/renderer.js";

let holdAnimations;
class Element {
  constructor(tag) {
    this.tagName = tag; this.style = {}; this.children = []; this.dataset = {}; this.animations = [];
    this.classList = { add() {} };
  }
  append(...children) {
    for (const child of children) { child.remove?.(); child.parentNode = this; this.children.push(child); }
  }
  replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this.append(...children); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  setAttribute() {} addEventListener() {} removeEventListener() {}
  getBoundingClientRect() { return { width: 960, height: 540 }; }
  animate(frames, options) {
    let finish, reject;
    const animation = { frames, options, cancelled: false,
      finished: new Promise((resolve, fail) => { finish = resolve; reject = fail; }),
      finish, cancel() { this.cancelled = true; reject(Error("cancelled")); } };
    this.animations.push(animation);
    if (!holdAnimations && options.iterations !== Infinity) finish();
    return animation;
  }
}
beforeEach(() => {
  holdAnimations = false;
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});
const settle = () => new Promise(resolve => setImmediate(resolve));
const HP = "character.hp.current", NAME = "character.name", PORTRAIT = "character.portrait", LEVEL = "character.level";
const finishAll = element => { for (const animation of element.animations) animation.finish(); for (const child of element.children) finishAll(child); };

function fixture(t, { enabled = true, mode = "combined", skip = false, actors = ["Actor.a", "Actor.b"] } = {}) {
  const preset = createWidgetPreset("Combined character card");
  preset.layers = [{ id: "name", type: "character-name" }, { id: "portrait", type: "character-portrait" },
    { id: "frame", type: "image", src: "assets/frame.webp" }];
  preset.pages = [
    { id: "basic", name: "Basic", duration: 5000, skipIfUnavailable: skip,
      layers: [{ id: "hp", type: "dynamic-number", binding: HP, fallback: "—" }] },
    { id: "resources", name: "Resources", duration: 8000, skipIfUnavailable: skip,
      layers: [{ id: "level", type: "dynamic-number", binding: LEVEL, fallback: "—" }] }
  ];
  preset.cycling = { enabled, mode, duration: 5000, transition: "slide-left", transitionDuration: 300,
    characterTransition: "fade", characterTransitionDuration: 500, loop: true, startPageId: "basic" };
  const values = new Map([
    ["Actor.a", { [NAME]: "Alpha", [PORTRAIT]: "actors/alpha.webp", [HP]: 20, [LEVEL]: 3 }],
    ["Actor.b", { [NAME]: "Bravo", [PORTRAIT]: "actors/bravo.webp", [HP]: 30, [LEVEL]: 7 }]
  ]);
  const permitted = new Set(values.keys()), subscribers = new Map();
  const service = {
    async resolveActor(uuid) { if (!permitted.has(uuid) || !values.has(uuid)) throw Error("The overlay viewer needs Observer permission for this Actor."); return { uuid }; },
    listActors() { return [...values].filter(([uuid]) => permitted.has(uuid)).map(([uuid, value]) => ({ uuid, name: value[NAME], portrait: value[PORTRAIT] })); },
    async resolve(uuid, fields) {
      if (!permitted.has(uuid) || !values.has(uuid)) return { values: Object.fromEntries(fields.map(field => [field, null])), warning: "The overlay viewer needs Observer permission for this Actor." };
      const current = values.get(uuid);
      return { values: Object.fromEntries(fields.map(field => [field, current[field] ?? null])), warning: null };
    },
    subscribe(uuid, callback) {
      const listeners = subscribers.get(uuid) ?? new Set(); listeners.add(callback); subscribers.set(uuid, listeners);
      return () => { listeners.delete(callback); if (!listeners.size) subscribers.delete(uuid); };
    }
  };
  const preferences = { enabled: true, reduced: false };
  const context = { characterData: service, widgetPresets: { list: () => [structuredClone(preset)] },
    animationsEnabled: () => preferences.enabled, reducedMotion: () => preferences.reduced };
  const renderer = new OverlayRenderer(new Element("main"), { context });
  const overlay = createOverlay();
  const instance = createWidgetInstance(preset, { actorUuid: "Actor.a" }); instance.actorUuids = actors;
  instance.carousel = { mode, enabled };
  overlay.layers = [instance];
  t.after(() => renderer.destroy());
  return { preset, overlay, instance, renderer, context, values, permitted, subscribers, preferences,
    composition: () => renderer.compositions.get(instance.id),
    async emit(uuid, patch = {}) {
      if (patch !== null) values.set(uuid, { ...values.get(uuid), ...patch });
      for (const callback of [...subscribers.get(uuid) ?? []]) callback();
      await settle(); await settle();
    } };
}

function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  return { timers, async install(carousel, running = true) {
    carousel.pause();
    const scheduler = carousel.controller.controller;
    scheduler.remaining = scheduler.dwell(); scheduler.now = () => now;
    scheduler.setTimer = (callback, ms) => { const key = ++id; timers.set(key, { callback, due: now + ms }); return key; };
    scheduler.clearTimer = key => timers.delete(key);
    if (running) await carousel.resume();
  }, async advance(ms) {
    now += ms;
    for (const [key, timer] of [...timers]) if (timer.due <= now) { timers.delete(key); timer.callback(); }
    await settle(); await settle();
  } };
}
const pair = view => [view.getState().activeActorUuid, view.getState().activePageId];
const pageView = (view, pageId) => view.activeSlot.renderer.carousel.views.get(pageId);
const text = (view, pageId, id) => pageView(view, pageId).renderer.layerElements.get(id).children[0].textContent;
const sharedText = view => view.activeSlot.renderer.layerElements.get("name").children[0].textContent;
const portrait = view => view.activeSlot.renderer.layerElements.get("portrait").children[0].src;

test("combined widget presents A/basic, A/resources, B/basic, B/resources with one owned timer", async t => {
  const f = fixture(t); await f.renderer.render(f.overlay); const view = f.composition(), timer = clock();
  assert.equal(view.carousel, view);
  await timer.install(view);
  const sequence = [pair(view)];
  for (const duration of [5000, 8000, 5000, 8000]) { await timer.advance(duration); sequence.push(pair(view)); }
  assert.deepEqual(sequence, [["Actor.a", "basic"], ["Actor.a", "resources"], ["Actor.b", "basic"], ["Actor.b", "resources"], ["Actor.a", "basic"]]);
  assert.equal(timer.timers.size, 1);
  assert.ok(view.slots.size <= 2);
  for (const slot of view.slots.values()) {
    assert.equal(slot.renderer.carousel.controller.paused, true);
    assert.equal(slot.renderer.carousel.controller.timer, null, "Nested page presentation never owns a competing timer");
  }
  f.renderer.destroy(); assert.equal(timer.timers.size, 0); assert.equal(f.subscribers.size, 0);
});

test("visible and off-screen Actor updates keep current position, dwell, and independent bindings", async t => {
  const f = fixture(t); await f.renderer.render(f.overlay); const view = f.composition(), timer = clock();
  await timer.install(view); await timer.advance(1400);
  const slot = view.activeSlot, remaining = view.getState().remaining, before = structuredClone([...f.values]);
  await f.emit("Actor.b", { [HP]: 12, [LEVEL]: 9, [NAME]: "Bravo updated" });
  assert.equal(view.activeSlot, slot); assert.deepEqual(pair(view), ["Actor.a", "basic"]);
  assert.equal(text(view, "basic", "hp"), "20"); assert.equal(sharedText(view), "Alpha");
  assert.equal(view.getState().remaining, remaining);
  await f.emit("Actor.a", { [HP]: 15 });
  assert.equal(view.activeSlot, slot); assert.equal(text(view, "basic", "hp"), "15"); assert.equal(view.getState().remaining, remaining);
  await view.select("basic", "Actor.b");
  assert.equal(text(view, "basic", "hp"), "12"); assert.equal(text(view, "resources", "level"), "9");
  assert.equal(sharedText(view), "Bravo updated"); assert.equal(portrait(view), "actors/bravo.webp");
  assert.equal(f.values.get("Actor.a")[HP], 15); assert.equal(before[0][1][HP], 20);
});

test("Actor preparation keeps portrait and statistics together during an asynchronous character transition", async t => {
  const f = fixture(t, { enabled: false }); await f.renderer.render(f.overlay); const view = f.composition();
  holdAnimations = true;
  const changing = view.select("basic", "Actor.b"); await settle();
  const coherent = () => {
    if (!view.activeSlot) return;
    const actorUuid = view.activeSlot.actorUuid;
    assert.equal(sharedText(view), actorUuid === "Actor.a" ? "Alpha" : "Bravo");
    assert.equal(text(view, "basic", "hp"), actorUuid === "Actor.a" ? "20" : "30");
    assert.equal(portrait(view), actorUuid === "Actor.a" ? "actors/alpha.webp" : "actors/bravo.webp");
  };
  coherent(); finishAll(f.renderer.root); await settle(); coherent();
  finishAll(f.renderer.root); await settle(); coherent();
  finishAll(f.renderer.root); await changing;
  assert.deepEqual(pair(view), ["Actor.b", "basic"]); coherent();
});

test("a delayed incoming Actor read holds the previous complete card until every new binding is ready", async t => {
  const f = fixture(t, { enabled: false }); await f.renderer.render(f.overlay); const view = f.composition();
  const original = f.context.characterData.resolve; let release;
  const blocked = new Promise(resolve => { release = resolve; });
  f.context.characterData.resolve = async (uuid, fields) => { if (uuid === "Actor.b") await blocked; return original(uuid, fields); };
  const pending = view.select("resources", "Actor.b"); await settle();
  assert.equal(view.activeSlot.actorUuid, "Actor.a"); assert.equal(sharedText(view), "Alpha");
  assert.equal(portrait(view), "actors/alpha.webp"); assert.equal(text(view, "basic", "hp"), "20");
  release(); await pending;
  assert.equal(view.activeSlot.actorUuid, "Actor.b"); assert.equal(sharedText(view), "Bravo");
  assert.equal(portrait(view), "actors/bravo.webp"); assert.equal(text(view, "resources", "level"), "7");
});

test("whole-widget Actor triggers react to visible live changes without replaying off-screen damage on selection", async t => {
  const f = fixture(t, { enabled: false });
  f.preset.triggers = [{ id: "damage", event: "decreased", field: HP,
    action: { type: "play-animation", target: "self", animation: { type: "flash", duration: 200 } } }];
  await f.renderer.render(f.overlay); const view = f.composition(), firstMotion = view.activeSlot.renderer.rootMotion;
  assert.equal(firstMotion.element.animations.length, 0);
  await f.emit("Actor.a", { [HP]: 18 }); assert.equal(firstMotion.element.animations.length, 1);
  await f.emit("Actor.b", { [HP]: 24 }); assert.equal(firstMotion.element.animations.length, 1);
  await view.select("basic", "Actor.b"); const secondMotion = view.activeSlot.renderer.rootMotion;
  assert.equal(secondMotion.element.animations.length, 0, "A newly prepared Actor gets a current baseline");
  await f.emit("Actor.a", { [HP]: 17 }); assert.equal(firstMotion.element.animations.length, 1);
  await f.emit("Actor.b", { [HP]: 22 }); assert.equal(secondMotion.element.animations.length, 1);
  await view.select("basic", "Actor.a"); assert.equal(firstMotion.element.animations.length, 1);
});

test("page and character transitions use their configured effects without duplicate root entrances", async t => {
  const f = fixture(t, { enabled: false }); await f.renderer.render(f.overlay); const view = f.composition();
  assert.equal(view.activeSlot.element.animations.length, 0);
  await view.next();
  const pageAnimations = pageView(view, "resources").element.animations;
  assert.ok(pageAnimations.length > 0);
  assert.ok(pageAnimations.some(animation => animation.options.duration === 300));
  assert.ok(pageAnimations.some(animation => animation.frames.some(frame => String(frame.transform ?? "").includes("translate"))));
  await view.next();
  assert.deepEqual(pair(view), ["Actor.b", "basic"]);
  assert.ok(view.activeSlot.element.animations.some(animation => animation.options.duration === 250), "Character fade shares its 500 ms total between exit and entrance");
  assert.ok(view.activeSlot.element.animations.every(animation => animation.frames.every(frame => frame.transform === undefined)));
});

test("parent hide preserves dwell, pauses the single scheduler, and clears descendant effects", async t => {
  const f = fixture(t); await f.renderer.render(f.overlay); const view = f.composition(), timer = clock();
  await timer.install(view); await timer.advance(1700);
  await f.renderer.motions.get(f.instance.id).setVisible(false);
  assert.equal(timer.timers.size, 0); assert.equal(view.getState().remaining, 3300);
  await timer.advance(60000); assert.deepEqual(pair(view), ["Actor.a", "basic"]);
  await f.renderer.motions.get(f.instance.id).setVisible(true);
  await timer.advance(3299); assert.deepEqual(pair(view), ["Actor.a", "basic"]);
  await timer.advance(1); assert.deepEqual(pair(view), ["Actor.a", "resources"]);
});

test("unavailable pages are skipped per Actor and current valid data updates do not restart playback", async t => {
  const f = fixture(t, { skip: true }); f.values.get("Actor.b")[HP] = null;
  await f.renderer.render(f.overlay); const view = f.composition();
  assert.deepEqual(view.getState().sequence.map(value => [value.actorUuid, value.pageId]), [["Actor.a", "basic"], ["Actor.a", "resources"], ["Actor.b", "resources"]]);
  await view.next(); await view.next(); assert.deepEqual(pair(view), ["Actor.b", "resources"]);
  await f.emit("Actor.b", { [HP]: 25 });
  assert.deepEqual(pair(view), ["Actor.b", "resources"]);
  await view.next(); assert.deepEqual(pair(view), ["Actor.a", "basic"]);
});

test("missing or unauthorized Actors are omitted and restored only after an authorized refresh", async t => {
  const f = fixture(t); f.permitted.delete("Actor.a");
  await f.renderer.render(f.overlay); const view = f.composition();
  assert.deepEqual(pair(view), ["Actor.b", "basic"]);
  assert.deepEqual(view.getState().availableActorUuids, ["Actor.b"]);
  f.permitted.delete("Actor.b"); await f.emit("Actor.b");
  assert.deepEqual(pair(view), [null, null]); assert.equal(view.controller.controller.timer, null);
  assert.equal(view.activeSlot, null, "Lost permission removes stale on-air Actor content");
  f.permitted.add("Actor.a"); await f.emit("Actor.a");
  assert.deepEqual(pair(view), ["Actor.a", "basic"]);
  assert.equal(sharedText(view), "Alpha");
});

test("empty Actor lists and zero enabled pages remain idle without competing timers", async t => {
  for (const empty of ["actors", "pages"]) {
    const f = fixture(t, { actors: empty === "actors" ? [] : ["Actor.a", "Actor.b"] });
    if (empty === "pages") for (const page of f.preset.pages) page.enabled = false;
    await f.renderer.render(f.overlay); const view = f.composition();
    assert.deepEqual(pair(view), [null, null]); assert.equal(view.controller.controller.timer, null);
    await view.resume(); await view.next(); assert.equal(view.controller.controller.timer, null);
    f.renderer.destroy(); assert.equal(f.subscribers.size, 0);
  }
});

test("multiple instances using the same preset keep independent Actor/page positions", async t => {
  const f = fixture(t); const other = createWidgetInstance(f.preset, { actorUuid: "Actor.b" });
  other.actorUuids = ["Actor.b", "Actor.a"]; other.carousel = { enabled: true, mode: "combined" };
  f.overlay.layers.push(other); await f.renderer.render(f.overlay);
  const first = f.composition(), second = f.renderer.compositions.get(other.id), timer = clock();
  await timer.install(first); await timer.install(second);
  assert.deepEqual(pair(first), ["Actor.a", "basic"]); assert.deepEqual(pair(second), ["Actor.b", "basic"]);
  await first.select("resources", "Actor.b"); first.pause();
  await timer.advance(5000);
  assert.deepEqual(pair(first), ["Actor.b", "resources"]); assert.deepEqual(pair(second), ["Actor.b", "resources"]);
  assert.equal(timer.timers.size, 1); assert.equal(sharedText(first), "Bravo"); assert.equal(sharedText(second), "Bravo");
});

test("reduced motion changes Actor/page information immediately and cold reload resets runtime position", async t => {
  const f = fixture(t); f.preferences.reduced = true;
  await f.renderer.render(f.overlay); const old = f.composition();
  await old.select("resources", "Actor.b");
  assert.deepEqual(pair(old), ["Actor.b", "resources"]);
  assert.equal(old.activeSlot.element.animations.length, 0);
  await f.renderer.render(null); assert.equal(f.subscribers.size, 0);
  await f.renderer.render(f.overlay); const reloaded = f.composition();
  assert.notEqual(reloaded, old); assert.deepEqual(pair(reloaded), ["Actor.a", "basic"]);
  assert.equal(reloaded.getState().paused, false);
  assert.deepEqual(f.instance.actorUuids, ["Actor.a", "Actor.b"]);
  assert.equal(Object.hasOwn(f.instance.carousel, "activePageId"), false);
});

test("destroy during a character transition disposes pending presentations and all subscriptions", async t => {
  const f = fixture(t, { enabled: false }); await f.renderer.render(f.overlay); const view = f.composition();
  holdAnimations = true; const pending = view.select("basic", "Actor.b"); await settle();
  await f.renderer.render(null); await pending;
  assert.equal(f.subscribers.size, 0); assert.equal(view.slots.size, 0); assert.equal(view.controller.getState().destroyed, true);
  assert.equal(f.renderer.compositions.size, 0); assert.equal(f.renderer.root, null);
});

test("selecting an existing Actor page supersedes an incoming Actor read without a stale commit", async t => {
  const f = fixture(t, { enabled: false }); await f.renderer.render(f.overlay); const view = f.composition();
  const original = f.context.characterData.resolve; let release;
  const blocked = new Promise(resolve => { release = resolve; });
  f.context.characterData.resolve = async (uuid, fields) => { if (uuid === "Actor.b") await blocked; return original(uuid, fields); };
  const incoming = view.select("basic", "Actor.b"); await settle();
  await view.select("resources", "Actor.a");
  assert.deepEqual(pair(view), ["Actor.a", "resources"]); assert.equal(view.activeSlot.actorUuid, "Actor.a");
  release(); await incoming;
  assert.deepEqual(pair(view), ["Actor.a", "resources"]); assert.equal(view.activeSlot.actorUuid, "Actor.a");
  assert.ok(pageView(view, "resources").element.animations.some(animation => animation.options.duration === 300), "Cancelling a pending Actor change still uses the page transition for the Actor already displayed");
  assert.equal(sharedText(view), "Alpha");
  assert.ok([...view.slots.values()].filter(slot => slot.element.style.display !== "none").every(slot => slot.actorUuid === "Actor.a"));
});

test("rapid Actor replacement disposes obsolete preparation and bounds the prepared card cache", async t => {
  const f = fixture(t, { enabled: false, actors: ["Actor.a", "Actor.b", "Actor.c"] });
  f.values.set("Actor.c", { [NAME]: "Charlie", [PORTRAIT]: "actors/charlie.webp", [HP]: 40, [LEVEL]: 11 }); f.permitted.add("Actor.c");
  await f.renderer.render(f.overlay); const view = f.composition(), original = f.context.characterData.resolve;
  const releases = new Map(), gates = new Map(["Actor.b", "Actor.c"].map(uuid => [uuid, new Promise(resolve => releases.set(uuid, resolve))]));
  f.context.characterData.resolve = async (uuid, fields) => { if (gates.has(uuid)) await gates.get(uuid); return original(uuid, fields); };
  const first = view.select("basic", "Actor.b"); await settle(); const obsolete = view.slots.get("Actor.b");
  const second = view.select("resources", "Actor.c"); await settle();
  assert.equal(obsolete.disposed, true); assert.equal(view.slots.size, 2);
  releases.get("Actor.c")(); await second;
  assert.deepEqual(pair(view), ["Actor.c", "resources"]); assert.equal(sharedText(view), "Charlie");
  releases.get("Actor.b")(); await first;
  assert.deepEqual(pair(view), ["Actor.c", "resources"]); assert.equal(view.activeSlot.actorUuid, "Actor.c");
  assert.equal(text(view, "resources", "level"), "11"); assert.equal(view.slots.has("Actor.b"), false);
});

test("changing the page for the same incoming Actor shares preparation and commits the latest requested pair", async t => {
  const f = fixture(t, { enabled: false }); await f.renderer.render(f.overlay); const view = f.composition();
  const original = f.context.characterData.resolve; let release;
  const blocked = new Promise(resolve => { release = resolve; });
  f.context.characterData.resolve = async (uuid, fields) => { if (uuid === "Actor.b") await blocked; return original(uuid, fields); };
  const first = view.select("resources", "Actor.b"); await settle(); const pendingSlot = view.slots.get("Actor.b");
  const latest = view.select("basic", "Actor.b"); await settle();
  assert.equal(view.slots.get("Actor.b"), pendingSlot);
  release(); await Promise.all([first, latest]);
  assert.deepEqual(pair(view), ["Actor.b", "basic"]); assert.equal(view.activeSlot, pendingSlot);
  assert.equal(text(view, "basic", "hp"), "30");
  assert.deepEqual([...view.activeSlot.renderer.carousel.views].filter(([, slot]) => slot.element.style.display !== "none").map(([id]) => id), ["basic"]);
});

test("permission revocation while an incoming Actor is preparing prevents its stale presentation from becoming visible", async t => {
  const f = fixture(t, { enabled: false }); await f.renderer.render(f.overlay); const view = f.composition();
  const original = f.context.characterData.resolve; let release;
  const blocked = new Promise(resolve => { release = resolve; });
  f.context.characterData.resolve = async (uuid, fields) => { if (uuid === "Actor.b") await blocked; return original(uuid, fields); };
  const incoming = view.select("basic", "Actor.b"); await settle();
  f.permitted.delete("Actor.b");
  const refresh = f.emit("Actor.b"); await settle();
  release(); await incoming; await refresh; await settle();
  assert.deepEqual(pair(view), ["Actor.a", "basic"]); assert.equal(view.activeSlot.actorUuid, "Actor.a");
  assert.equal(sharedText(view), "Alpha");
  assert.ok([...view.slots.values()].filter(slot => slot.element.style.display !== "none").every(slot => slot.actorUuid === "Actor.a"));
});

test("whole-widget continuous warnings follow the active Actor and resume after parent visibility changes", async t => {
  const f = fixture(t, { enabled: false });
  f.preset.triggers = [{ id: "warning", event: "field-changed", field: HP, continuous: true,
    condition: { operator: "lt", value: 25 }, action: { type: "play-animation", target: "self", animation: { type: "pulse", duration: 1000 } } }];
  await f.renderer.render(f.overlay); const view = f.composition(), alpha = view.activeSlot.renderer.rootMotion;
  assert.equal(alpha.controller.channels.size, 1);
  await view.select("basic", "Actor.b"); const bravo = view.activeSlot.renderer.rootMotion;
  assert.equal(alpha.controller.channels.size, 0); assert.equal(bravo.controller.channels.size, 0);
  await f.emit("Actor.b", { [HP]: 12 }); assert.equal(bravo.controller.channels.size, 1);
  await view.select("basic", "Actor.a"); assert.equal(alpha.controller.channels.size, 1); assert.equal(bravo.controller.channels.size, 0);
  await f.renderer.motions.get(f.instance.id).setVisible(false); assert.equal(alpha.controller.channels.size, 0);
  await f.renderer.motions.get(f.instance.id).setVisible(true); assert.equal(alpha.controller.channels.size, 1);
  f.renderer.destroy(); assert.equal(alpha.controller.channels.size, 0); assert.equal(bravo.controller.channels.size, 0);
});

test("character-only legacy layouts use one virtual page and newly prepared Actors honor resized geometry", async t => {
  const f = fixture(t, { mode: "character" }); f.preset.pages = []; f.preset.cycling.startPageId = null;
  await f.renderer.render(f.overlay); const view = f.composition(), timer = clock(); await timer.install(view);
  assert.deepEqual(pair(view), ["Actor.a", "shared-content"]); assert.equal(view.activeSlot.renderer.carousel, null);
  f.renderer.updateLayer({ ...f.instance, width: 600, height: 270 });
  assert.equal(view.activeSlot.renderer.root.style.transform, "scale(1.5, 1.5)");
  await timer.advance(5000);
  assert.deepEqual(pair(view), ["Actor.b", "shared-content"]); assert.equal(sharedText(view), "Bravo");
  assert.equal(view.activeSlot.renderer.root.style.transform, "scale(1.5, 1.5)");
  assert.equal(timer.timers.size, 1);
});

test("information mode can manually select another assigned Actor while preserving one pinned Actor sequence", async t => {
  const f = fixture(t, { mode: "information", enabled: false }); await f.renderer.render(f.overlay); const view = f.composition();
  assert.deepEqual(view.getState().availableActorUuids, ["Actor.a", "Actor.b"]);
  assert.equal(f.renderer.handleAnimationCommand({ overlayId: f.overlay.id, layerId: f.instance.id, kind: "carousel", action: "select-actor", actorUuid: "Actor.b" }), true);
  await settle(); await settle();
  assert.equal(view.activeSlot.actorUuid, "Actor.b"); assert.equal(sharedText(view), "Bravo");
  assert.ok(view.getState().sequence.every(step => step.actorUuid === "Actor.b"));
  await view.next(); assert.deepEqual(pair(view), ["Actor.b", "resources"]);
  await view.reset(); assert.deepEqual(pair(view), ["Actor.a", "basic"]);
});

test("animation test controls use the real entrance, exit, pulse and independent Actor/page controllers", async t => {
  const f = fixture(t, { enabled: false });
  f.preset.animations.entrance = { type: "fade-in", duration: 600 };
  f.preset.animations.exit = { type: "fade-out", duration: 600 };
  await f.renderer.render(f.overlay); const view = f.composition(), outer = f.renderer.motions.get(f.instance.id);
  assert.equal(outer.element.animations[0].options.duration, 600, "Initial widget entrance executes after mounting");
  assert.equal(view.activeSlot.renderer.root.animations.length, 0, "Prepared Actor roots do not duplicate the widget entrance");
  const command = (kind, extra = {}) => f.renderer.handleAnimationCommand({ id: `test-${kind}`, overlayId: f.overlay.id, layerId: f.instance.id, kind, ...extra });
  assert.equal(command("exit"), true); await settle();
  assert.equal(outer.element.style.visibility, "hidden"); assert.equal(view.getState().visible, false);
  assert.equal(command("entrance"), true); await settle();
  assert.equal(outer.element.style.visibility, "visible"); assert.equal(view.getState().visible, true);
  assert.equal(command("play", { animation: { type: "pulse", duration: 800 } }), true);
  assert.equal(outer.element.animations.at(-1).options.duration, 800);
  assert.equal(outer.element.animations.at(-1).frames[1].transform, "rotate(0deg) scale(1.12)", "Whole-widget Pulse enlarges outside the fitted Actor stage");
  assert.equal(command("carousel", { action: "next-page" }), true); await settle(); await settle();
  assert.deepEqual(pair(view), ["Actor.a", "resources"]);
  assert.equal(command("carousel", { action: "next-page" }), true); await settle(); await settle();
  assert.deepEqual(pair(view), ["Actor.a", "basic"], "Next Page wraps within the current Actor");
  assert.equal(command("carousel", { action: "next-actor" }), true); await settle(); await settle();
  assert.deepEqual(pair(view), ["Actor.b", "basic"], "Next Character keeps the current page");
  assert.equal(command("carousel", { action: "previous-page" }), true); await settle(); await settle();
  assert.deepEqual(pair(view), ["Actor.b", "resources"]);
  assert.equal(command("carousel", { action: "previous-actor" }), true); await settle(); await settle();
  assert.deepEqual(pair(view), ["Actor.a", "resources"]);
  assert.equal(view.getState().paused, true, "Manual test actions preserve pause state");
  assert.equal(command("demo", { action: "damage" }), false, "Test controls cannot mutate a real Actor");
});

test("optional runtime diagnostics contain identifiers and missing bindings without Actor values", async t => {
  const f = fixture(t, { enabled: false });
  f.renderer.context.debug = () => true;
  f.preset.triggers = [{ id: "damage", event: "decreased", field: HP,
    action: { type: "color-flash", animation: { type: "color-flash", color: "#ff4444", duration: 300 } } }];
  f.values.get("Actor.a")[LEVEL] = null;
  await f.renderer.render(f.overlay); await f.emit("Actor.a", { [HP]: 17 });
  const [diagnostic] = f.renderer.getDiagnostics();
  assert.equal(diagnostic.instanceId, f.instance.id); assert.equal(diagnostic.presetId, f.preset.id);
  assert.equal(diagnostic.actorUuid, "Actor.a"); assert.equal(diagnostic.pageId, "basic");
  assert.equal(diagnostic.mode, "combined"); assert.equal(diagnostic.paused, true);
  assert.equal(diagnostic.nextTransitionInMs, null);
  assert.equal(diagnostic.lastTrigger.type, "decreased"); assert.equal(diagnostic.lastAnimation.type, "color-flash");
  assert.ok(diagnostic.missingBindings.includes(LEVEL));
  const serialized = JSON.stringify(diagnostic);
  for (const secret of ["Alpha", "actors/alpha.webp", '"values"', '"current"', '"previous"']) assert.ok(!serialized.includes(secret), `Diagnostics exclude ${secret}`);
  f.renderer.context.debug = () => false; assert.deepEqual(f.renderer.getDiagnostics(), []);
});
