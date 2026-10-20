import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createOverlay } from "../scripts/core/schema.js";
import { createLayer, createWidgetInstance } from "../scripts/core/layers.js";
import { createWidgetPreset } from "../scripts/core/widget-presets.js";
import { AdapterRegistry } from "../scripts/core/registry.js";
import { genericAdapter } from "../scripts/adapters/generic.js";
import { cainAdapter } from "../scripts/adapters/cain.js";
import { CharacterDataService } from "../scripts/data/character-data.js";
import { OverlayRenderer } from "../scripts/render/renderer.js";

/** Minimal DOM/WAAPI surface; effects remain active until their owner cancels them. */
class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.attributes = {};
    this.classList = { add() {} }; this.listeners = new Map(); this.animationCalls = []; this.activeAnimations = new Set();
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  getBoundingClientRect() { return { width: 960, height: 540 }; }
  animate(keyframes, options) {
    let reject;
    const animation = {
      finished: new Promise((_resolve, failure) => { reject = failure; }),
      cancel: () => { if (this.activeAnimations.delete(animation)) reject(new Error("Animation cancelled")); }
    };
    this.animationCalls.push({ keyframes, options }); this.activeAnimations.add(animation);
    return animation;
  }
}

beforeEach(() => {
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});
const settle = () => new Promise(resolve => setTimeout(resolve, 10));
const warning = target => ({
  id: "low-health", name: "Low health", enabled: true, event: "field-changed", field: "character.hp.percent",
  condition: { operator: "lt", value: 25 }, continuous: true,
  action: { type: "play-animation", target, animation: { type: "pulse", duration: 900, intensity: .3 } }
});

function fixture(t) {
  const callbacks = new Map();
  const hooks = {
    on(name, callback) { const list = callbacks.get(name) ?? new Set(); list.add(callback); callbacks.set(name, list); return callback; },
    off(name, callback) { callbacks.get(name)?.delete(callback); }
  };
  const actor = (id, hp) => ({
    uuid: `Actor.${id}`, documentName: "Actor", name: id, img: "", type: "character", allowed: true,
    testUserPermission() { return this.allowed; }, system: { health: { value: hp, max: 40 } }
  });
  const alpha = actor("alpha", 4), bravo = actor("bravo", 32), actors = new Map([[alpha.uuid, alpha], [bravo.uuid, bravo]]);
  const adapters = new AdapterRegistry(); adapters.register(genericAdapter); adapters.register(cainAdapter);
  const service = new CharacterDataService({ adapters, getUser: () => ({ id: "viewer" }), getSystemId: () => "cain",
    resolveUuid: async uuid => actors.get(uuid), hooks, debounceMs: 0 });
  service.start();
  const renderers = [];
  const renderer = context => {
    const result = new OverlayRenderer(new Element("main"), { context: { characterData: service, ...context } });
    renderers.push(result); return result;
  };
  t.after(() => { for (const value of renderers) value.destroy(); service.stop(); });
  const update = async (actor, hp) => {
    actor.system.health.value = hp;
    for (const callback of callbacks.get("updateActor") ?? []) callback(actor);
    await settle();
  };
  const components = canvas => {
    const source = { ...createLayer("dynamic-number", canvas), id: "source", z: 0 };
    const target = { ...createLayer("text", canvas), id: "target", z: 1, text: "Warning target", rotation: 18 };
    return { source, target };
  };
  return { alpha, bravo, service, renderer, update, components };
}

test("a top-level component's initial continuous effect reaches a later sibling and stops when data recovers", async t => {
  const f = fixture(t), overlay = createOverlay(), { source, target } = f.components(overlay.canvas);
  source.triggers = [warning(target.id)]; overlay.layers = [source, target];
  const renderer = f.renderer({ actorUuid: f.alpha.uuid });
  await renderer.render(overlay);
  const targetElement = renderer.layerElements.get(target.id);
  assert.equal(targetElement.animationCalls.length, 1, "The initially matching condition reaches a target built later in the scene");
  assert.equal(targetElement.activeAnimations.size, 1);
  assert.equal(targetElement.style.transform, "rotate(18deg)");
  assert.equal(renderer.layerElements.get(source.id).animationCalls.length, 0, "Only the declared target animates");
  await f.update(f.alpha, 16);
  assert.equal(targetElement.activeAnimations.size, 0, "Recovery stops the continuous effect");
  await f.update(f.alpha, 4);
  assert.equal(targetElement.animationCalls.length, 2, "A later matching change restarts one owned effect");
  renderer.destroy();
  assert.equal(targetElement.activeAnimations.size, 0); assert.equal(f.service.subscriptions.size, 0);
});

test("preset component effects reach later siblings on cold mount independently for each assigned Actor", async t => {
  const f = fixture(t), preset = createWidgetPreset("Sibling warning"), { source, target } = f.components(preset.canvas);
  source.triggers = [warning(target.id)]; preset.layers = [source, target];
  const overlay = createOverlay(), first = createWidgetInstance(preset, { actorUuid: f.alpha.uuid }), second = createWidgetInstance(preset, { actorUuid: f.bravo.uuid });
  first.z = 0; second.z = 1; overlay.layers = [first, second];
  const renderer = f.renderer({ widgetPresets: { list: () => [structuredClone(preset)] } });
  await renderer.render(overlay);
  const firstTarget = renderer.compositions.get(first.id).layerElements.get(target.id);
  const secondTarget = renderer.compositions.get(second.id).layerElements.get(target.id);
  assert.equal(firstTarget.animationCalls.length, 1, "The low-health Actor's sibling target animates on initial data");
  assert.equal(secondTarget.animationCalls.length, 0, "The other Actor's copy remains unchanged");
  await f.update(f.alpha, 20);
  assert.equal(firstTarget.activeAnimations.size, 0); assert.equal(secondTarget.animationCalls.length, 0);
  renderer.destroy();
  assert.equal(f.service.subscriptions.size, 0); assert.equal(firstTarget.activeAnimations.size, 0);
});

test("a shared group-level continuous rule reaches its mounted component during cold initialization", async t => {
  const f = fixture(t), preset = createWidgetPreset("Whole card warning"), { source, target } = f.components(preset.canvas);
  preset.layers = [source, target]; preset.triggers = [warning(target.id)];
  const instance = createWidgetInstance(preset, { actorUuid: f.alpha.uuid, x: 75, width: 600, height: 270 });
  const overlay = createOverlay(); overlay.layers = [instance];
  const renderer = f.renderer({ widgetPresets: { list: () => [structuredClone(preset)] } });
  await renderer.render(overlay);
  const child = renderer.compositions.get(instance.id), targetElement = child.layerElements.get(target.id);
  assert.equal(targetElement.animationCalls.length, 1, "The shared grouped rule finds its child component on the first render");
  assert.equal(targetElement.activeAnimations.size, 1);
  assert.equal(renderer.layerElements.get(instance.id).animationCalls.length, 0, "The grouped wrapper is not the configured action target");
  assert.equal(child.root.style.transform, "scale(1.5, 1.5)");
  await f.update(f.alpha, 40);
  assert.equal(targetElement.activeAnimations.size, 0);
  renderer.destroy();
  assert.equal(f.service.subscriptions.size, 0);
});
