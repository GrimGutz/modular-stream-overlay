import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createOverlay } from "../scripts/core/schema.js";
import { createWidgetPreset } from "../scripts/core/widget-presets.js";
import { createWidgetInstance } from "../scripts/core/layers.js";
import { OverlayRenderer } from "../scripts/render/renderer.js";

/** Track attachment and hold effects until the test explicitly completes them. */
class Element {
  constructor(tag) {
    this.tagName = tag; this.style = {}; this.children = []; this.dataset = {}; this.animations = [];
    this.parentNode = null; this.attached = false; this.classList = { add() {} };
  }
  get isConnected() { return this.attached || Boolean(this.parentNode?.isConnected); }
  append(...children) {
    for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = []; this.append(...children);
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  setAttribute() {} addEventListener() {}
  getBoundingClientRect() { return { width: 960, height: 540 }; }
  animate(frames, options) {
    let finish, reject;
    const animation = { frames, options, cancelled: false,
      finished: new Promise((resolve, fail) => { finish = resolve; reject = fail; }),
      finish: () => finish(), cancel() { this.cancelled = true; reject(new Error("cancelled")); } };
    this.animations.push(animation); return animation;
  }
}

beforeEach(() => {
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(t) {
  const preset = createWidgetPreset("Animation feedback card");
  preset.layers = [{ id: "caption", type: "text", text: "Visible content" }];
  preset.animations.entrance = { type: "fade-in", duration: 1200 };
  preset.animations.exit = { type: "fade-out", duration: 1200 };
  const overlay = createOverlay();
  const instance = createWidgetInstance(preset, { actorUuid: "Actor.alpha", x: 135, y: 180, rotation: 17, opacity: 0.8 });
  overlay.layers = [instance];
  const preferences = { enabled: true, reduced: false }, container = new Element("main");
  container.attached = true;
  const renderer = new OverlayRenderer(container, { context: {
    deferEntrances: true, widgetPresets: { list: () => [structuredClone(preset)] },
    animationsEnabled: () => preferences.enabled, reducedMotion: () => preferences.reduced
  } });
  t.after(() => renderer.destroy());
  return { renderer, container, preset, overlay, instance, preferences,
    state: () => renderer.getAnimationTestState(instance.id),
    motion: () => renderer.motions.get(instance.id),
    command: kind => renderer.handleAnimationCommand({ kind, layerId: instance.id, overlayId: overlay.id }) };
}

test("test feedback uses inherited slots and honors an explicitly empty instance override", async t => {
  const f = fixture(t); await f.renderer.render(f.overlay);
  assert.deepEqual(f.state(), { blockedReason: null, entrance: true, exit: true });
  assert.equal(f.motion().settings.entrance.duration, 1200);
  assert.equal(f.motion().settings.exit.duration, 1200);
  f.instance.animationOverrides = true;
  await f.renderer.render(f.overlay);
  assert.deepEqual(f.state(), { blockedReason: null, entrance: false, exit: false }, "None in an instance override must not silently inherit the design's effects");
});

test("test feedback identifies animation-disabled and reduced-motion preferences without changing them", async t => {
  const f = fixture(t); await f.renderer.render(f.overlay);
  f.preferences.enabled = false;
  assert.equal(f.state().blockedReason, "animations-disabled");
  f.command("entrance"); assert.equal(f.motion().element.animations.length, 0);
  f.preferences.enabled = true; f.preferences.reduced = true;
  assert.equal(f.state().blockedReason, "reduced-motion");
  f.command("entrance"); assert.equal(f.motion().element.animations.length, 0);
  assert.deepEqual(f.preferences, { enabled: true, reduced: true });
  f.preferences.reduced = false;
  assert.equal(f.state().blockedReason, null);
});

test("an exit remains attached and visible until completion, then entrance restores the same widget", async t => {
  const f = fixture(t); await f.renderer.render(f.overlay);
  const motion = f.motion(), element = motion.element, stage = f.renderer.root;
  const original = structuredClone(f.overlay), geometry = { ...element.style };
  assert.equal(f.command("exit"), true);
  const exit = element.animations.at(-1);
  assert.equal(exit.options.duration, 1200);
  assert.equal(element.isConnected, true);
  assert.equal(f.renderer.root, stage);
  assert.notEqual(element.style.visibility, "hidden", "The outgoing target remains painted while its fade runs");
  assert.equal(f.state().blockedReason, null);
  exit.finish(); await settle();
  assert.equal(element.isConnected, true);
  assert.equal(element.style.visibility, "hidden");
  assert.equal(f.state().blockedReason, "hidden");
  assert.equal(f.state().entrance, true, "The configured entrance remains available to restore a completed test exit");
  assert.equal(f.command("entrance"), true);
  const entrance = element.animations.at(-1);
  assert.equal(entrance.options.duration, 1200);
  assert.equal(element.style.visibility, "visible");
  entrance.finish(); await settle();
  assert.equal(f.state().blockedReason, null);
  for (const key of ["left", "top", "width", "height", "opacity", "transform"]) assert.equal(element.style[key], geometry[key]);
  assert.deepEqual(f.overlay, original, "Test playback never rewrites stored geometry or visibility");
});

test("repeated entrance replaces the old effect and stale completion cannot hide the restored target", async t => {
  const f = fixture(t); await f.renderer.render(f.overlay);
  const motion = f.motion(), element = motion.element;
  const exiting = motion.exit(), exit = element.animations.at(-1);
  const exitGeneration = motion.visibilityGeneration;
  assert.equal(f.command("entrance"), true);
  const first = element.animations.at(-1);
  assert.equal(exit.cancelled, true);
  assert.ok(motion.visibilityGeneration > exitGeneration);
  assert.equal(f.command("entrance"), true);
  const second = element.animations.at(-1);
  assert.notEqual(first, second); assert.equal(first.cancelled, true);
  exit.finish(); first.finish(); await exiting; await settle();
  assert.equal(element.style.visibility, "visible", "A superseded exit must not hide a newer entrance");
  second.finish(); await settle();
  assert.equal(element.isConnected, true);
  assert.equal(element.style.visibility, "visible");
  assert.equal(motion.controller.channels.size, 0);
  assert.equal(f.state().blockedReason, null);
});

test("test feedback reports a detached target instead of claiming visible playback", async t => {
  const f = fixture(t); await f.renderer.render(f.overlay);
  assert.equal(f.motion().element.isConnected, true);
  f.container.attached = false;
  assert.equal(f.motion().element.isConnected, false);
  assert.equal(f.state().blockedReason, "detached");
});

test("a logically hidden layer needs its visibility control rather than a test entrance", async t => {
  const f = fixture(t); f.instance.visible = false;
  await f.renderer.render(f.overlay);
  assert.equal(f.state().blockedReason, "layer-hidden");
  f.command("entrance");
  assert.equal(f.motion().element.animations.length, 0);
  assert.equal(f.motion().element.style.visibility, "hidden");
});

test("rerender diagnostics preserve the interruption cause through parent visibility gating", async t => {
  const f = fixture(t), events = [];
  f.renderer.context.debug = () => true;
  f.renderer.context.onDiagnostic = event => events.push(event);
  await f.renderer.render(f.overlay);
  f.renderer.handleAnimationCommand({ kind: "play", animation: { type: "pulse", duration: 1200 }, layerId: f.instance.id, overlayId: f.overlay.id });
  // An unchanged layer keeps running across renders; a changed one is rebuilt and interrupted.
  await f.renderer.render({ ...f.overlay, layers: f.overlay.layers.map(layer => layer.id === f.instance.id ? { ...layer, borderWidth: 1 } : layer) });
  const cancelled = events.find(event => event.layerId === f.instance.id && event.phase === "cancelled");
  assert.equal(cancelled.reason, "render-interrupted");
});
