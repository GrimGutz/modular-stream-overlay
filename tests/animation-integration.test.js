import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createOverlay } from "../scripts/core/schema.js";
import { createWidgetInstance } from "../scripts/core/layers.js";
import { createWidgetPreset } from "../scripts/core/widget-presets.js";
import { createAnimationExamples } from "../scripts/animation/schema.js";
import { OverlayRenderer } from "../scripts/render/renderer.js";
import { refreshAnimationPreferences } from "../scripts/render/motion.js";

class Element {
  constructor(tag) { this.tagName = tag; this.style = {}; this.children = []; this.dataset = {}; this.classList = { add() {} }; this.animations = []; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {} addEventListener() {}
  getBoundingClientRect() { return { width: 960, height: 540 }; }
  animate(frames, options) {
    let finish, reject;
    const entry = { frames, options, cancelled: false, finished: new Promise((resolve, fail) => { finish = resolve; reject = fail; }),
      finish: () => finish(), cancel() { this.cancelled = true; reject(Error("cancelled")); } };
    this.animations.push(entry); return entry;
  }
}
beforeEach(() => {
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const preset = createWidgetPreset("Card");
  preset.layers = [{ id: "name", type: "character-name", fallback: "Character" }];
  preset.animations.entrance = { type: "fade-in", duration: 500 };
  preset.triggers = createAnimationExamples().filter(example => example.trigger).map(example => example.trigger);
  const values = new Map([["Actor.a", { "character.hp.current": 20, "character.hp.percent": 50 }],
    ["Actor.b", { "character.hp.current": 30, "character.hp.percent": 75 }]]);
  const subscriptions = new Map();
  const service = {
    async resolve(uuid, fields) { const current = values.get(uuid) ?? {}; return { values: Object.fromEntries(fields.filter(field => field in current).map(field => [field, current[field]])), warnings: [] }; },
    subscribe(uuid, callback) { const list = subscriptions.get(uuid) ?? new Set(); list.add(callback); subscriptions.set(uuid, list); return () => { list.delete(callback); if (!list.size) subscriptions.delete(uuid); }; }
  };
  const overlay = createOverlay();
  const a = createWidgetInstance(preset, { actorUuid: "Actor.a", rotation: 20, opacity: 0.6 });
  const b = createWidgetInstance(preset, { actorUuid: "Actor.b" });
  overlay.layers = [a, b];
  const preferences = { enabled: true, reduced: false };
  const context = { characterData: service, widgetPresets: { list: () => [structuredClone(preset)] },
    animationsEnabled: () => preferences.enabled, reducedMotion: () => preferences.reduced };
  const renderer = new OverlayRenderer(new Element("main"), { context });
  const emit = async (uuid, hp) => {
    values.set(uuid, { "character.hp.current": hp, "character.hp.percent": hp / 40 * 100 });
    for (const callback of subscriptions.get(uuid) ?? []) callback(); await settle();
  };
  return { preset, overlay, a, b, values, subscriptions, context, renderer, emit, preferences };
}

test("Actor-specific damage, healing and continuous conditions reconstruct without historical one-shots", async () => {
  const f = fixture(); const original = structuredClone(f.overlay);
  await f.renderer.render(f.overlay);
  const a = f.renderer.layerElements.get(f.a.id), b = f.renderer.layerElements.get(f.b.id);
  assert.equal(a.animations.length, 1, "A configured cold entrance plays without inventing historical damage");
  assert.equal(a.animations[0].options.duration, 500);
  await f.emit("Actor.a", 4);
  assert.equal(a.animations.length, 3, "Entrance, low-health pulse and new damage flash");
  assert.equal(b.animations.length, 1);
  assert.equal(a.animations[1].options.iterations, Infinity);
  assert.match(a.animations[2].frames[1].filter, /#ff4444/);
  assert.equal(a.style.transform, "rotate(20deg)"); assert.equal(a.style.opacity, "0.6");
  f.renderer.destroy();
  assert(a.animations.every(animation => animation.cancelled)); assert.equal(f.subscriptions.size, 0);
  const reopened = new OverlayRenderer(new Element("main"), { context: f.context });
  await reopened.render(f.overlay);
  const restored = reopened.layerElements.get(f.a.id);
  assert.equal(restored.animations.length, 2, "Entrance and current continuous condition are restored without stale damage");
  assert.equal(restored.animations[0].options.iterations, Infinity);
  await f.emit("Actor.a", 16);
  assert.equal(restored.animations[0].cancelled, true, "Recovery stops the warning");
  assert.match(restored.animations[2].frames[1].filter, /#55cc88/);
  assert.deepEqual(f.overlay, original, "Runtime cannot mutate the saved layout");
  reopened.destroy(); assert.equal(f.subscriptions.size, 0);
});

test("shared animation edits and explicit empty instance overrides preserve Actor assignment", async () => {
  const f = fixture(); f.a.animationOverrides = true; f.a.triggers = [];
  await f.renderer.render(f.overlay);
  await f.emit("Actor.a", 4); await f.emit("Actor.b", 4);
  assert.equal(f.renderer.layerElements.get(f.a.id).animations.length, 0);
  assert.equal(f.renderer.layerElements.get(f.b.id).animations.length, 3);
  f.preset.triggers.find(rule => rule.id === "low-health").action.animation.type = "glow";
  await f.renderer.render(f.overlay);
  assert.equal(f.renderer.motions.get(f.b.id).rules.find(rule => rule.id === "low-health").action.animation.type, "glow");
  assert.equal(f.renderer.motions.get(f.a.id).rules.length, 0);
  assert.equal(f.renderer.overlay.layers[0].actorUuid, "Actor.a"); assert.equal(f.renderer.overlay.layers[0].rotation, 20);
  f.renderer.destroy();
});

test("global disable and reduced motion stop mounted effects and restore only eligible continuous warnings", async () => {
  const f = fixture(); await f.renderer.render(f.overlay); await f.emit("Actor.a", 4);
  const element = f.renderer.layerElements.get(f.a.id);
  f.preferences.enabled = false; refreshAnimationPreferences();
  assert(element.animations.every(animation => animation.cancelled));
  await f.emit("Actor.a", 3); assert.equal(element.animations.length, 3);
  f.preferences.enabled = true; refreshAnimationPreferences();
  assert.equal(element.animations.length, 4, "One continuous warning, no historical damage");
  f.preferences.reduced = true; refreshAnimationPreferences();
  assert.equal(element.animations[3].cancelled, true);
  f.renderer.destroy();
});

test("intentional None activation plays entrance and exits await completion; immediate disconnect clears", async () => {
  const overlay = createOverlay();
  overlay.layers = [{ id: "caption", type: "text", text: "Live", rotation: 30, opacity: 0.5,
    animations: { entrance: { type: "fade-in", duration: 100 }, exit: { type: "fade-out", duration: 100 } } }];
  const container = new Element("main"), renderer = new OverlayRenderer(container);
  await renderer.render(null); await renderer.render(overlay);
  const element = renderer.layerElements.get("caption");
  assert.equal(element.animations.length, 1);
  assert.deepEqual(element.animations[0].frames, [{ opacity: 0 }, { opacity: 0.5 }]);
  const old = renderer.root, clearing = renderer.render(null, { animateExit: true });
  assert.equal(renderer.root, old);
  assert.equal(element.animations.length, 2);
  element.animations[1].finish(); await clearing;
  assert.equal(container.children.length, 0);
  await renderer.render(overlay);
  const active = renderer.layerElements.get("caption");
  await renderer.render(null);
  assert.equal(active.animations.length, 1, "Disconnect never delays clearing for an exit");
  assert.equal(container.children.length, 0);
  renderer.destroy();
});

test("local preview and reset restore geometry and saved visibility without changing data", async () => {
  const f = fixture(); await f.renderer.render(f.overlay);
  const state = structuredClone([...f.values]);
  const element = f.renderer.layerElements.get(f.a.id);
  const playing = f.renderer.previewAnimation(f.a.id, { type: "shake", duration: 250 });
  assert.equal(element.animations[1].frames[1].transform, "rotate(20deg) translateX(-7px)");
  f.renderer.motions.get(f.a.id).setVisible(false);
  assert.equal(element.style.visibility, "hidden");
  f.renderer.resetAnimations(f.a.id);
  await playing;
  assert.equal(element.style.visibility, "visible");
  assert.equal(element.style.transform, "rotate(20deg)");
  assert.equal(f.renderer.root.style.transform, "scale(0.5)");
  assert.deepEqual([...f.values], state);
  f.renderer.destroy();
});

test("whole-design continuous transforms compose with initial fit and later preview zoom", async () => {
  const f = fixture();
  const overlay = createOverlay(); overlay.layers = [];
  overlay.triggers = [{ id: "warning", event: "field-changed", field: "character.hp.percent", condition: { operator: "lt", value: 25 },
    action: { type: "play-animation", animation: { type: "scale-pulse", duration: 1000 } }, continuous: true }];
  f.values.set("Actor.a", { "character.hp.percent": 10 });
  const renderer = new OverlayRenderer(new Element("main"), { preview: true, context: { ...f.context, previewActorUuid: "Actor.a" } });
  await renderer.render(overlay);
  assert.equal(renderer.root.animations.length, 1);
  assert.equal(renderer.root.animations[0].frames[1].transform, "scale(0.5) scale(1.06)");
  const preview = renderer.previewAnimation("self", { type: "shake", duration: 500 });
  renderer.setScale(2);
  await preview;
  assert.equal(renderer.root.animations[0].cancelled, true);
  assert.equal(renderer.root.animations[1].cancelled, true, "A preview cannot hold the previous zoom transform");
  assert.equal(renderer.root.animations[2].frames[1].transform, "scale(2) scale(1.06)");
  renderer.destroy();
});
