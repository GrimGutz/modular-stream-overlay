import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createOverlay } from "../scripts/core/schema.js";
import { createWidgetPreset, widgetPresetToOverlay } from "../scripts/core/widget-presets.js";
import { createWidgetInstance } from "../scripts/core/layers.js";
import { OverlayRenderer } from "../scripts/render/renderer.js";
import { pageHasInformation } from "../scripts/render/carousel.js";

let holdTransitions;
class Element {
  constructor(tag) { this.tagName = tag; this.style = {}; this.children = []; this.dataset = {}; this.classList = { add() {} }; this.animations = []; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {} addEventListener() {}
  getBoundingClientRect() { return { width: 960, height: 540 }; }
  animate(frames, options) {
    let finish, reject;
    const entry = { frames, options, cancelled: false,
      finished: new Promise((resolve, fail) => { finish = resolve; reject = fail; }),
      finish: () => finish(), cancel() { this.cancelled = true; reject(Error("cancelled")); } };
    this.animations.push(entry);
    if (!holdTransitions && options.iterations !== Infinity) finish();
    return entry;
  }
}
beforeEach(() => {
  holdTransitions = false;
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});
const settle = () => new Promise(resolve => setImmediate(resolve));
const HP = "character.hp.current", MAX = "character.hp.max", PERCENT = "character.hp.percent";
const warning = target => ({ id: "warning", event: "field-changed", field: PERCENT, condition: { operator: "lt", value: 25 }, continuous: true,
  action: { type: "play-animation", target, animation: { type: "pulse", duration: 1000 } } });

function fixture(t, { enabled = true, skip = false } = {}) {
  const preset = createWidgetPreset("Three pages");
  preset.layers = [{ id: "shared-name", type: "character-name" }, { id: "shared-frame", type: "image", src: "assets/frame.webp" }];
  preset.pages = [
    { id: "basic", name: "Basic", duration: 5000, skipIfUnavailable: skip, layers: [{ id: "hp", type: "dynamic-number", binding: HP }] },
    { id: "attributes", name: "Attributes", duration: 8000, skipIfUnavailable: skip, layers: [{ id: "level", type: "dynamic-text", text: "Level {character.level}", fallback: "Unknown level" }] },
    { id: "resources", name: "Resources", duration: null, skipIfUnavailable: skip, layers: [{ id: "focus", type: "resource-bar", binding: "character.focus.current", maxBinding: "character.focus.max" }] }
  ];
  preset.cycling = { enabled, duration: 5000, transition: "fade", transitionDuration: 400, loop: true, startPageId: "basic" };
  const values = new Map([ ["Actor.a", { "character.name": "Alpha", [HP]: 20, [MAX]: 40, [PERCENT]: 50, "character.level": 3, "character.focus.current": 2, "character.focus.max": 5 }],
    ["Actor.b", { "character.name": "Bravo", [HP]: 30, [MAX]: 40, [PERCENT]: 75, "character.level": 7, "character.focus.current": 4, "character.focus.max": 6 }] ]);
  const subscribers = new Map();
  const service = {
    async resolve(uuid, fields) { const current = values.get(uuid) ?? {}; return { values: Object.fromEntries(fields.filter(field => field in current).map(field => [field, current[field]])), warning: null }; },
    subscribe(uuid, callback) { const listeners = subscribers.get(uuid) ?? new Set(); listeners.add(callback); subscribers.set(uuid, listeners);
      return () => { listeners.delete(callback); if (!listeners.size) subscribers.delete(uuid); }; }
  };
  const preferences = { enabled: true, reduced: false };
  const context = { characterData: service, widgetPresets: { list: () => [structuredClone(preset)] },
    animationsEnabled: () => preferences.enabled, reducedMotion: () => preferences.reduced };
  const renderer = new OverlayRenderer(new Element("main"), { context });
  const overlay = createOverlay();
  const a = createWidgetInstance(preset, { actorUuid: "Actor.a" }), b = createWidgetInstance(preset, { actorUuid: "Actor.b" });
  overlay.layers = [a, b];
  const extraRenderers = [];
  t.after(() => { renderer.destroy(); for (const value of extraRenderers) value.destroy(); });
  return { preset, overlay, renderer, a, b, values, subscribers, context, preferences, extraRenderers,
    child: instance => renderer.compositions.get(instance.id), carousel: instance => renderer.compositions.get(instance.id).carousel,
    async emit(uuid, patch) {
      values.set(uuid, patch === null ? {} : { ...values.get(uuid), ...patch });
      for (const callback of subscribers.get(uuid) ?? []) callback(); await settle();
    } };
}

function clock() {
  let now = 0, sequence = 0;
  const timers = new Map();
  return { timers, async install(view, running = true) {
    const controller = view.controller; controller.pause(); controller.remaining = controller.dwell();
    controller.now = () => now;
    controller.setTimer = (callback, ms) => { const id = ++sequence; timers.set(id, { callback, due: now + ms }); return id; };
    controller.clearTimer = id => timers.delete(id);
    if (running) await controller.resume();
  }, async advance(ms) {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.callback(); }
    await settle();
  } };
}
const active = carousel => [...carousel.views].filter(([, view]) => view.element.style.display !== "none").map(([id]) => id);
const text = (carousel, page, id) => carousel.views.get(page).renderer.layerElements.get(id).children[0].textContent;

test("three pages cycle independently without rebuilding shared content or interrupting live data", async t => {
  const f = fixture(t); await f.renderer.render(f.overlay);
  const a = f.carousel(f.a), b = f.carousel(f.b), shared = f.child(f.a).layerElements.get("shared-name");
  const timer = clock(); await timer.install(a); await timer.install(b);
  assert.deepEqual(active(a), ["basic"]); assert.equal(a.views.get("basic").element.animations.length, 0, "Initial reconstruction has no transition");
  assert.equal(text(a, "basic", "hp"), "20"); assert.equal(text(b, "basic", "hp"), "30");
  await a.next(); assert.deepEqual(active(a), ["attributes"]); assert.deepEqual(active(b), ["basic"]);
  const beforeRemaining = a.getState().remaining;
  await f.emit("Actor.a", { [HP]: 11, "character.level": 4 });
  assert.equal(text(a, "basic", "hp"), "11"); assert.equal(text(a, "attributes", "level"), "Level 4");
  assert.equal(text(b, "basic", "hp"), "30"); assert.equal(a.getState().remaining, beforeRemaining);
  assert.equal(f.child(f.a).layerElements.get("shared-name"), shared);
  await timer.advance(5000); assert.deepEqual(active(b), ["attributes"]); assert.deepEqual(active(a), ["attributes"]);
  await timer.advance(3000); assert.deepEqual(active(a), ["resources"]);
  assert.equal(shared.children[0].textContent, "Alpha"); assert.equal(timer.timers.size, 2);
  f.renderer.destroy(); assert.equal(timer.timers.size, 0); assert.equal(f.subscribers.size, 0);
});

test("skip policy uses actual template/resource fields, keeps fallbacks, and recovers all-unavailable pages", async t => {
  const f = fixture(t, { skip: true });
  f.values.set("Actor.a", { "character.name": "Alpha", [HP]: 20, "character.focus.current": 2, "character.focus.max": 0 });
  await f.renderer.render(f.overlay); const a = f.carousel(f.a);
  assert.deepEqual(a.getState().availablePageIds, ["basic"], "An unused default name binding cannot make a level template available");
  await f.emit("Actor.a", null); assert.equal(a.getState().activePageId, null); assert.deepEqual(active(a), []); assert.equal(a.controller.timer, null);
  await f.emit("Actor.a", { "character.level": 9 }); assert.deepEqual(active(a), ["attributes"]);
  assert.equal(text(a, "attributes", "level"), "Level 9");
  f.preset.pages[2].skipIfUnavailable = false;
  await f.renderer.render(f.overlay);
  const withFallback = f.carousel(f.a); assert(withFallback.getState().availablePageIds.includes("resources"));
  await withFallback.select("resources"); assert.deepEqual(active(withFallback), ["resources"]);
  assert.equal(withFallback.views.get("resources").renderer.layerElements.get("focus").children.length, 0, "Missing data never fabricates a bar");
  assert.equal(pageHasInformation({ layers: [{ visible: false, type: "dynamic-number", binding: HP }] }, { [HP]: 10 }), false);
});

test("hiding a widget suspends its timer and showing resumes remaining dwell without a backlog", async t => {
  const f = fixture(t); await f.renderer.render(f.overlay); const a = f.carousel(f.a), timer = clock();
  await timer.install(a); await timer.advance(2000);
  await f.renderer.motions.get(f.a.id).setVisible(false);
  assert.equal(timer.timers.size, 0); assert.equal(a.getState().remaining, 3000);
  await timer.advance(100000); assert.equal(a.getState().activePageId, "basic");
  await f.renderer.motions.get(f.a.id).setVisible(true); await timer.advance(2999);
  assert.equal(a.getState().activePageId, "basic"); await timer.advance(1); assert.equal(a.getState().activePageId, "attributes");
  f.renderer.destroy(); assert.equal(timer.timers.size, 0);
});

test("rapid page transitions cancel old work and leave no effects running on hidden pages", async t => {
  const f = fixture(t, { enabled: false });
  f.preset.pages[0].layers[0].triggers = [warning("self")];
  f.values.get("Actor.a")[PERCENT] = 10;
  await f.renderer.render(f.overlay); const a = f.carousel(f.a);
  const source = a.findMotion("hp"); assert.equal(source.controller.channels.size, 1);
  holdTransitions = true;
  const first = a.next(); const second = a.select("resources");
  for (const view of a.views.values()) for (const animation of view.element.animations) animation.finish();
  await Promise.all([first, second]);
  assert.deepEqual(active(a), ["resources"]);
  assert.equal(source.parentVisible, false); assert.equal(source.controller.channels.size, 0);
  assert.equal(a.views.get("attributes").gate.presentationVisible, false);
  f.renderer.destroy(); assert.equal(f.subscribers.size, 0);
});

test("whole-widget continuous rules resume when their target page becomes visible", async t => {
  const f = fixture(t, { enabled: false }); f.preset.triggers = [warning("level")];
  f.values.get("Actor.a")[PERCENT] = 10;
  await f.renderer.render(f.overlay); const a = f.carousel(f.a), target = a.findMotion("level");
  assert.equal(target.controller.channels.size, 0);
  await a.select("attributes"); assert.equal(target.controller.channels.size, 1);
  await a.select("resources"); assert.equal(target.controller.channels.size, 0);
  await a.select("attributes"); assert.equal(target.controller.channels.size, 1);
  await f.emit("Actor.a", { [PERCENT]: 60 }); assert.equal(target.controller.channels.size, 0);
  f.renderer.destroy(); assert.equal(target.visibilityListeners.size, 0);
});

test("editing a nonstarting unavailable page freezes it without transitions and patches its geometry", async t => {
  const f = fixture(t, { skip: true }); f.values.set("Actor.a", {});
  const renderer = new OverlayRenderer(new Element("main"), { preview: true, context: { ...f.context, previewActorUuid: "Actor.a" } });
  f.extraRenderers.push(renderer); renderer.setPageEditing("attributes");
  await renderer.render(widgetPresetToOverlay(f.preset));
  const carousel = renderer.carousel; assert.deepEqual(active(carousel), ["attributes"]); assert.equal(carousel.getState().paused, true);
  assert.equal(carousel.views.get("attributes").element.animations.length, 0);
  const layer = carousel.views.get("attributes").renderer.overlay.layers[0];
  renderer.updateLayer({ ...layer, x: 87, rotation: 14 });
  assert.equal(renderer.findMotion("level").element.style.left, "87px"); assert.equal(renderer.findMotion("level").element.style.transform, "rotate(14deg)");
  assert.equal(renderer.overlay.pages[1].layers[0].x, 87);
});

test("reduced motion and global animation disable keep automatic information changes immediate", async t => {
  const f = fixture(t); f.preferences.reduced = true; await f.renderer.render(f.overlay);
  const a = f.carousel(f.a), timer = clock(); await timer.install(a);
  await timer.advance(5000); assert.deepEqual(active(a), ["attributes"]);
  assert.equal([...a.views.values()].reduce((sum, view) => sum + view.element.animations.length, 0), 0);
  f.preferences.reduced = false; f.preferences.enabled = false;
  await timer.advance(8000); assert.deepEqual(active(a), ["resources"]);
  assert.equal([...a.views.values()].reduce((sum, view) => sum + view.element.animations.length, 0), 0);
});

test("cold reopening chooses the configured starting page and restores saved automatic policy", async t => {
  const f = fixture(t); f.preset.cycling.startPageId = "attributes"; await f.renderer.render(f.overlay);
  const a = f.carousel(f.a); assert.deepEqual(active(a), ["attributes"]);
  await a.pause(); await a.select("resources"); assert.equal(a.getState().paused, true);
  await f.renderer.render(null); assert.equal(f.subscribers.size, 0);
  await f.renderer.render(f.overlay); const reopened = f.carousel(f.a);
  assert.deepEqual(active(reopened), ["attributes"]); assert.equal(reopened.getState().paused, false);
  assert.equal(reopened.views.get("attributes").element.animations.length, 0);
  assert.equal(f.overlay.layers[0].actorUuid, "Actor.a"); assert.equal(f.overlay.layers[1].actorUuid, "Actor.b");
});

test("clearing output during an availability read destroys every pending page and subscription", async t => {
  const f = fixture(t, { skip: true });
  const resolve = f.context.characterData.resolve; let release;
  f.context.characterData.resolve = (uuid, fields) => fields.length === 4
    ? new Promise(finish => { release = () => { void resolve(uuid, fields).then(finish); }; }) : resolve(uuid, fields);
  const pending = f.renderer.render(f.overlay); await settle();
  assert.equal(typeof release, "function");
  await f.renderer.render(null); assert.equal(f.subscribers.size, 0);
  release(); await pending;
  assert.equal(f.renderer.root, null); assert.equal(f.renderer.carousel, null); assert.equal(f.renderer.compositions.size, 0);
  assert.equal(f.subscribers.size, 0);
});

test("reassigning an instance replaces all page bindings without changing another instance", async t => {
  const f = fixture(t, { enabled: false }); await f.renderer.render(f.overlay);
  const before = structuredClone([...f.values]); const old = f.carousel(f.a);
  f.overlay.layers[0].actorUuid = "Actor.b";
  f.overlay.layers[0].actorUuids = ["Actor.b"];
  await f.renderer.render(f.overlay);
  const rebound = f.carousel(f.a);
  assert.equal(old.disposed, true); assert.equal(old.views.size, 0);
  assert.equal(text(rebound, "basic", "hp"), "30"); assert.equal(text(rebound, "attributes", "level"), "Level 7");
  assert.equal(text(f.carousel(f.b), "basic", "hp"), "30");
  assert.deepEqual([...f.values], before, "Presentation never writes character data");
});

test("live page commands acknowledge acceptance before a long transition completes", async t => {
  const f = fixture(t, { enabled: false }); f.preset.cycling.transitionDuration = 10000;
  await f.renderer.render(f.overlay); holdTransitions = true;
  const accepted = f.renderer.handleAnimationCommand({ overlayId: f.overlay.id, layerId: f.a.id, kind: "carousel", action: "next" });
  assert.equal(accepted, true, "A long animation cannot cause a valid command to time out");
  assert.equal(f.carousel(f.a).getState().transitioning, true);
  assert.equal(f.carousel(f.a).getState().activePageId, "attributes");
  f.renderer.destroy(); assert.equal(f.subscribers.size, 0);
});
