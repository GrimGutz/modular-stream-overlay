import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createOverlay } from "../scripts/core/schema.js";
import { createLayer, createWidgetInstance } from "../scripts/core/layers.js";
import { createWidgetPreset } from "../scripts/core/widget-presets.js";
import { OverlayRenderer } from "../scripts/render/renderer.js";
import { LayerMotion } from "../scripts/render/motion.js";

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.classList = { add() {} }; this.animations = []; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener() {}
  getBoundingClientRect() { return { width: 960, height: 540 }; }
  animate() {
    let finish, reject;
    const animation = { finished: new Promise((resolve, fail) => { finish = resolve; reject = fail; }),
      finish() { finish(); }, cancel() { reject(Error("cancelled")); } };
    this.animations.push(animation); return animation;
  }
}
beforeEach(() => {
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});
const HP = "character.hp.current";
const warning = { id: "warning", event: "field-changed", field: HP, condition: { operator: "lt", value: 25 },
  action: { type: "play-animation", animation: { type: "pulse", duration: 1000 } }, continuous: true };

function fixture({ hiddenGroup = false } = {}) {
  let hp = 20;
  const callbacks = new Set();
  const service = { resolve: async (_uuid, fields) => ({ values: Object.fromEntries(fields.map(field => [field, hp])) }),
    subscribe(_uuid, callback) { callbacks.add(callback); return () => callbacks.delete(callback); } };
  const preset = createWidgetPreset("Visibility test");
  preset.layers = [
    { ...createLayer("image", preset.canvas), id: "warning-component", triggers: [warning,
      { id: "shown-once", event: "visible", action: { type: "play-animation", animation: { type: "glow" } } }] },
    { ...createLayer("image", preset.canvas), id: "saved-hidden", visible: false, triggers: [warning] }
  ];
  const instance = createWidgetInstance(preset, { actorUuid: "Actor.alpha" }); instance.visible = !hiddenGroup;
  const overlay = createOverlay(); overlay.layers = [instance];
  const renderer = new OverlayRenderer(new Element("main"), { context: { characterData: service,
    widgetPresets: { list: () => [preset] }, reducedMotion: () => false } });
  return { renderer, overlay, instance, preset, callbacks, async change(value) {
    hp = value; for (const callback of callbacks) callback(); await new Promise(resolve => setImmediate(resolve));
  } };
}

test("saved-hidden layers remain invisible but are addressable by declarative show and hide actions", async () => {
  const overlay = createOverlay();
  const hidden = { ...createLayer("image", overlay.canvas), id: "hidden", visible: false };
  const source = { ...createLayer("text", overlay.canvas), id: "source", triggers: [
    { id: "show-hidden", event: "manual", action: { type: "show", target: hidden.id } },
    { id: "hide-again", event: "manual", action: { type: "hide", target: hidden.id } }
  ] };
  overlay.layers = [source, hidden];
  const renderer = new OverlayRenderer(new Element("main")); await renderer.render(overlay);
  const target = renderer.motions.get(hidden.id);
  assert.ok(target); assert.equal(target.element.style.visibility, "hidden");
  renderer.motions.get(source.id).manual("show-hidden");
  assert.equal(target.visible, true); assert.equal(target.element.style.visibility, "visible");
  renderer.motions.get(source.id).manual("hide-again");
  assert.equal(target.visible, false); assert.equal(target.element.style.visibility, "hidden");
  assert.equal(renderer.overlay.layers[1].visible, false, "Runtime actions do not rewrite the saved design");
  renderer.destroy();
});

test("a saved-hidden widget still observes data and can show itself through its own trigger", async () => {
  const f = fixture({ hiddenGroup: true });
  f.instance.triggers = [{ id: "show-on-damage", event: "decreased", field: HP, action: { type: "show" } }];
  f.instance.animationOverrides = true;
  await f.renderer.render(f.overlay);
  const group = f.renderer.motions.get(f.instance.id);
  assert.equal(group.element.style.visibility, "hidden");
  await f.change(10);
  assert.equal(group.visible, true); assert.equal(group.element.style.visibility, "visible");
  assert.equal(f.instance.visible, false, "Actor-triggered visibility is presentation state only");
  f.renderer.destroy(); assert.equal(f.callbacks.size, 0);
});

test("hiding a parent stops nested continuous effects and showing restores only eligible effects", async () => {
  const f = fixture(); await f.renderer.render(f.overlay);
  const group = f.renderer.motions.get(f.instance.id), child = f.renderer.compositions.get(f.instance.id);
  const warningMotion = child.motions.get("warning-component"), hidden = child.motions.get("saved-hidden");
  const events = [], onAction = warningMotion.runtime.onAction;
  warningMotion.runtime.onAction = (rule, event) => { events.push(rule.id); return onAction(rule, event); };
  assert.equal(warningMotion.controller.channels.size, 1); assert.equal(hidden.controller.channels.size, 0);
  await group.setVisible(false);
  assert.equal(warningMotion.visible, true, "Parent gating preserves the child's own state");
  assert.equal(warningMotion.element.style.visibility, "hidden"); assert.equal(warningMotion.controller.channels.size, 0);
  await f.change(15); assert.equal(warningMotion.controller.channels.size, 0);
  await group.setVisible(true);
  assert.equal(warningMotion.element.style.visibility, "visible"); assert.equal(warningMotion.controller.channels.size, 1);
  assert.deepEqual(events, ["warning"], "Parent reappearance restores continuous state without replaying visibility one-shots");
  assert.equal(hidden.visible, false); assert.equal(hidden.element.style.visibility, "hidden"); assert.equal(hidden.controller.channels.size, 0);
  await warningMotion.setVisible(false); await group.setVisible(false); await group.setVisible(true);
  assert.equal(warningMotion.visible, false); assert.equal(warningMotion.controller.channels.size, 0);
  await warningMotion.setVisible(true); assert.equal(warningMotion.controller.channels.size, 2, "An explicit child show may fire its own visible event");
  f.renderer.destroy(); assert.equal(f.callbacks.size, 0); assert.equal(group.children.size, 0);
});

test("initially hidden parent groups keep nested effects stopped until first shown", async () => {
  const f = fixture({ hiddenGroup: true }); await f.renderer.render(f.overlay);
  const group = f.renderer.motions.get(f.instance.id), child = f.renderer.compositions.get(f.instance.id);
  const warningMotion = child.motions.get("warning-component");
  assert.equal(warningMotion.visible, true); assert.equal(warningMotion.element.style.visibility, "hidden");
  assert.equal(warningMotion.controller.channels.size, 0);
  await group.setVisible(true);
  assert.equal(warningMotion.element.style.visibility, "visible"); assert.equal(warningMotion.controller.channels.size, 1);
  await f.change(40); assert.equal(warningMotion.controller.channels.size, 0);
  await group.setVisible(false); await group.setVisible(true);
  assert.equal(warningMotion.controller.channels.size, 0, "A recovered resource does not restore an obsolete warning");
  f.renderer.destroy(); assert.equal(f.callbacks.size, 0);
});

test("completed exits remain hidden while the replacement scene is still loading", async () => {
  const layer = createLayer("image"); layer.animations.exit = { type: "fade-out", duration: 400 };
  const element = new Element("div");
  const motion = new LayerMotion({ element, layer, context: { reducedMotion: () => false } });
  const exiting = motion.exit();
  assert.notEqual(element.style.visibility, "hidden", "Exit content remains visible until its animation finishes");
  element.animations[0].finish(); await exiting;
  assert.equal(element.style.visibility, "hidden", "A released WAAPI effect cannot reveal the departing content again");
  motion.destroy();
});

test("hidden groups settle numeric updates immediately and never schedule invisible interpolation", async t => {
  const previousRequest = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame;
  const frames = new Map(); let sequence = 0;
  globalThis.requestAnimationFrame = callback => { frames.set(++sequence, callback); return sequence; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  t.after(() => { globalThis.requestAnimationFrame = previousRequest; globalThis.cancelAnimationFrame = previousCancel; });
  const f = fixture({ hiddenGroup: true });
  const component = createLayer("dynamic-number", f.preset.canvas);
  component.id = "number"; component.binding = HP;
  component.animations.transition = { duration: 1000, easing: "linear", numeric: true, bar: true, color: false, opacity: false };
  f.preset.layers = [component];
  await f.renderer.render(f.overlay);
  const group = f.renderer.motions.get(f.instance.id), child = f.renderer.compositions.get(f.instance.id);
  const number = child.motions.get(component.id);
  const text = () => number.element.children[0].textContent;
  await f.change(10); assert.equal(text(), "10"); assert.equal(frames.size, 0);
  await group.setVisible(true); await f.change(5);
  assert.ok(frames.size > 0, "Visible updates use the configured numeric transition");
  await group.setVisible(false);
  assert.equal(text(), "5"); assert.equal(frames.size, 0, "Hiding cancels frames and settles the latest target");
  number.refreshPreferences();
  await f.change(3); assert.equal(text(), "3"); assert.equal(frames.size, 0, "An enabled preference cannot override hidden-parent gating");
  await group.setVisible(true); assert.equal(text(), "3"); assert.equal(frames.size, 0);
  f.renderer.destroy(); assert.equal(f.callbacks.size, 0); assert.equal(frames.size, 0);
});
