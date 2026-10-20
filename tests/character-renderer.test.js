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
import { mountCharacterComponent, safePortraitURL } from "../scripts/render/character-components.js";
import { AnimationController } from "../scripts/animation/playback.js";
import { validateAnimationSettings } from "../scripts/animation/schema.js";

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.attributes = {};
    this.classList = { add() {} }; this.listeners = new Map(); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  getBoundingClientRect() { return { width: 960, height: 540 }; }
}
beforeEach(() => {
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

function fixture({ preview = false } = {}) {
  const callbacks = new Map();
  const hooks = {
    on(name, callback) { const list = callbacks.get(name) ?? new Set(); list.add(callback); callbacks.set(name, list); return callback; },
    off(name, callback) { callbacks.get(name)?.delete(callback); }
  };
  const emit = (name, actor) => { for (const callback of callbacks.get(name) ?? []) callback(actor); };
  const actor = (id, name, hp) => ({ uuid: `Actor.${id}`, documentName: "Actor", name, img: `portraits/${id}.webp`, type: "character",
    allowed: true, testUserPermission() { return this.allowed; }, system: { health: { value: hp, max: 40 } } });
  const a = actor("alpha", "Alpha", 20), b = actor("bravo", "Bravo", 32);
  const actors = new Map([[a.uuid, a], [b.uuid, b]]);
  const adapters = new AdapterRegistry(); adapters.register(genericAdapter); adapters.register(cainAdapter);
  const service = new CharacterDataService({ adapters, getUser: () => ({ id: "viewer" }), getSystemId: () => "cain",
    resolveUuid: async uuid => actors.get(uuid), hooks, debounceMs: 0 }); service.start();
  const preset = createWidgetPreset("Reusable");
  preset.layers = [
    { ...createLayer("character-name"), id: "name", width: 250, height: 40, fontSize: 24, fallback: "Unavailable" },
    { ...createLayer("character-portrait"), id: "portrait", width: 80, height: 80, circular: true },
    { ...createLayer("resource-bar"), id: "health", x: 90, y: 60, width: 250, height: 24 },
    { ...createLayer("dynamic-text"), id: "caption", y: 100, text: "HP: {character.hp.current}/{character.hp.max}" }
  ];
  const widgetPresets = { list: () => [structuredClone(preset)] };
  const overlay = createOverlay();
  const first = createWidgetInstance(preset, { actorUuid: a.uuid, x: 10, width: 600, height: 270 });
  const second = createWidgetInstance(preset, { actorUuid: b.uuid, x: 900 });
  overlay.layers = [first, second];
  const renderer = new OverlayRenderer(new Element("main"), { preview, context: { characterData: service, widgetPresets }, resolveAsset: value => `/prefix/${value}` });
  const child = instance => renderer.compositions.get(instance.id);
  const text = (instance, id = "name") => child(instance).layerElements.get(id).children[0].textContent;
  return { a, b, actors, service, emit, preset, overlay, first, second, renderer, child, text };
}

test("shared widget designs render independent current Actors and scale as one logical layer", async () => {
  const f = fixture(); await f.renderer.render(f.overlay);
  assert.equal(f.text(f.first), "Alpha"); assert.equal(f.text(f.second), "Bravo");
  assert.equal(f.text(f.first, "caption"), "HP: 20/40");
  assert.equal(f.child(f.first).root.style.transform, "scale(1.5, 1.5)");
  const portrait = f.child(f.first).layerElements.get("portrait").children[0];
  assert.equal(portrait.src, "/prefix/portraits/alpha.webp"); assert.equal(portrait.style.borderRadius, "50%");
  const track = f.child(f.first).layerElements.get("health").children[0];
  assert.equal(track.children[0].style.width, "50%");
  assert.equal(f.renderer.root.children.length, 2, "No editor controls enter shared output");
  f.renderer.updateLayer({ ...f.first, width: 800, height: 360 });
  assert.equal(f.child(f.first).root.style.transform, "scale(2, 2)");
  f.renderer.destroy(); assert.equal(f.service.subscriptions.size, 0); f.service.stop();
});

test("Actor events patch only affected presentation and reconstruct initial state after reopening", async () => {
  const f = fixture(); await f.renderer.render(f.overlay);
  const root = f.renderer.root, firstRoot = f.child(f.first).root, secondRoot = f.child(f.second).root;
  f.a.name = '<img src=x onerror=alert(1)>'; f.a.system.health.value = 4; f.a.img = "portraits/new.webp";
  f.emit("updateActor", f.a); await settle();
  assert.equal(f.renderer.root, root); assert.equal(f.child(f.first).root, firstRoot); assert.equal(f.child(f.second).root, secondRoot);
  assert.equal(f.text(f.first), f.a.name); assert.equal(f.text(f.second), "Bravo");
  assert.equal(f.text(f.first, "caption"), "HP: 4/40");
  assert.equal(f.child(f.first).layerElements.get("health").children[0].children[0].style.width, "10%");
  assert.equal(f.child(f.first).layerElements.get("name").children[0].children.length, 0);
  await f.renderer.render(null); assert.equal(f.service.subscriptions.size, 0);
  await f.renderer.render(f.overlay); assert.equal(f.text(f.first, "caption"), "HP: 4/40");
  f.renderer.destroy(); f.service.stop();
});

test("shared preset edits preserve independent Actors, geometry and supported instance style overrides", async () => {
  const f = fixture(); f.first.overrides = { name: { color: "#ffcc00" } };
  await f.renderer.render(f.overlay);
  f.preset.layers[0].fontSize = 35; f.preset.layers[0].color = "#22ffaa";
  await f.renderer.render(f.overlay);
  assert.equal(f.text(f.first), "Alpha"); assert.equal(f.text(f.second), "Bravo");
  assert.equal(f.child(f.first).layerElements.get("name").children[0].style.fontSize, "35px");
  assert.equal(f.child(f.first).layerElements.get("name").children[0].style.color, "#ffcc00");
  assert.equal(f.child(f.second).layerElements.get("name").children[0].style.color, "#22ffaa");
  assert.equal(f.overlay.layers[0].actorUuid, f.a.uuid); assert.equal(f.overlay.layers[1].actorUuid, f.b.uuid);
  assert.equal(f.overlay.layers[0].x, 10); assert.equal(f.overlay.layers[1].x, 900);
  f.renderer.destroy(); f.service.stop();
});

test("revoked or missing Actors clear live values without affecting other cards or leaking warnings on air", async () => {
  const f = fixture(); await f.renderer.render(f.overlay);
  f.a.allowed = false; f.emit("updateActor", f.a); await settle();
  assert.equal(f.text(f.first), "Unavailable"); assert.equal(f.text(f.second), "Bravo");
  assert.equal(f.child(f.first).layerElements.get("health").children.length, 0);
  assert.equal(f.child(f.first).layerElements.get("name").dataset.characterWarning, undefined);
  f.actors.delete(f.b.uuid); f.emit("deleteActor", f.b); await settle();
  assert.equal(f.text(f.second), "Unavailable");
  f.renderer.destroy(); f.service.stop();
});

test("zero maximum HP never renders a false live bar and editor warnings remain preview-only", async () => {
  const f = fixture({ preview: true }); f.a.system.health.max = 0; await f.renderer.render(f.overlay);
  const health = f.child(f.first).layerElements.get("health");
  assert.equal(health.children[0].children[0].style.width, "0%");
  assert.equal(health.children[0].children[1].textContent, "—");
  f.a.allowed = false; f.emit("updateActor", f.a); await settle();
  assert.match(f.child(f.first).layerElements.get("name").dataset.characterWarning, /permission|Observer/i);
  f.renderer.destroy(); f.service.stop();
});

test("late Actor reads cannot restore disposed widget content or retain subscriptions", async () => {
  const f = fixture(); let finish;
  f.service.resolveUuid = () => new Promise(resolve => { finish = resolve; });
  const rendering = f.renderer.render(f.overlay);
  await f.renderer.render(null);
  assert.equal(f.service.subscriptions.size, 0);
  finish(f.a); await rendering;
  assert.equal(f.renderer.root, null);
  assert.equal(f.service.subscriptions.size, 0);
  f.renderer.destroy(); f.service.stop();
});

test("portrait URLs preserve managed routing and reject script, credentials and external Actor references", () => {
  assert.equal(safePortraitURL("portraits/hero.webp", value => `/prefix/${value}`), "/prefix/portraits/hero.webp");
  assert.equal(safePortraitURL("https://example.test/hero.webp"), "https://example.test/hero.webp");
  for (const value of ["javascript:alert(1)", "data:image/svg+xml,evil", "https://user:pass@example.test/hero", "../secret", "file:///image.png"]) assert.equal(safePortraitURL(value), "");
});

test("a broken widget library cannot clear unrelated static output or leak pending subscriptions", async t => {
  t.mock.method(console, "error", () => {});
  const f = fixture();
  f.overlay.background.src = "assets/frame.webp";
  f.renderer.context.widgetPresets = { list() { throw Error("Invalid saved widget library"); } };
  await assert.doesNotReject(f.renderer.render(f.overlay));
  assert.equal(f.renderer.root.children[0].src, "/prefix/assets/frame.webp");
  assert.equal(f.renderer.root.children.length, 3);
  assert.equal(f.service.subscriptions.size, 0);
  assert.equal(f.renderer.pendingScenes.size, 0);
  f.renderer.destroy(); f.service.stop();
});

async function motionFixture(type, values, { transition = { duration: 100, easing: "linear", bar: true, numeric: true }, preview = false, controllerOptions = {}, patch = {} } = {}) {
  const element = new Element("div"), frames = new Map();
  let time = 0, sequence = 0, notify = null, current = { ...values }, subscribed = true;
  const controller = new AnimationController(element, { now: () => time, reducedMotion: false,
    requestFrame: callback => { const id = ++sequence; frames.set(id, callback); return id; },
    cancelFrame: id => frames.delete(id), ...controllerOptions });
  const layer = { ...createLayer(type), ...patch };
  const binding = mountCharacterComponent({ element, layer, resolveAsset: value => `/prefix/${value}`,
    context: { actorUuid: "Actor.test", mode: preview ? "preview" : "broadcast", characterData: {
      async resolve() { return { values: { ...current } }; },
      subscribe(_actor, callback) { notify = callback; return () => { subscribed = false; }; }
    } }, motion: { controller, settings: validateAnimationSettings({ transition }) } });
  await binding.ready;
  return { element, layer, binding, controller, frames,
    async update(values) { current = { ...values }; notify(); await settle(); },
    advance(ms) { time += ms; const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(time); },
    destroy() { binding.destroy(); controller.destroy(); },
    get subscribed() { return subscribed; }
  };
}

test("live bars keep stable nodes and interpolate rapid changes from the visible percentage", async () => {
  const f = await motionFixture("resource-bar", { "character.hp.current": 80, "character.hp.max": 100 }, { transition: { duration: 100, easing: "linear", bar: true, numeric: false } });
  const track = f.element.children[0], fill = track.children[0], label = track.children[1];
  assert.equal(fill.style.width, "80%");
  assert.equal(f.frames.size, 0, "First paint uses current Actor values without an old transition");
  await f.update({ "character.hp.current": 45, "character.hp.max": 100 });
  assert.equal(f.element.children[0], track); assert.equal(track.children[0], fill); assert.equal(track.children[1], label);
  assert.equal(fill.style.width, "80%"); assert.equal(label.textContent, "45 / 100");
  f.advance(50); assert.equal(fill.style.width, "62.5%");
  await f.update({ "character.hp.current": 10, "character.hp.max": 100 });
  assert.equal(fill.style.width, "62.5%", "A new update starts at the visible midpoint");
  assert.equal(f.frames.size, 1);
  f.advance(50); assert.equal(fill.style.width, "36.25%");
  f.advance(50); assert.equal(fill.style.width, "10%"); assert.equal(f.frames.size, 0);
  f.destroy(); assert.equal(f.subscribed, false);
});

test("numeric text templates interpolate independently and retain literal strings and latest exact numbers", async () => {
  const f = await motionFixture("dynamic-text", { "character.name": "Alpha", "character.hp.current": 80, "character.hp.max": 100 }, { patch: { text: "{character.name}: {character.hp.current}/{character.hp.max}" } });
  const node = f.element.children[0];
  await f.update({ "character.name": "<img onerror=alert(1)>", "character.hp.current": 45, "character.hp.max": 120 });
  f.advance(50);
  assert.equal(node.textContent, "<img onerror=alert(1)>: 63/110");
  assert.equal(node.children.length, 0);
  await f.update({ "character.name": "Updated name", "character.hp.current": 45, "character.hp.max": 120 });
  assert.equal(node.textContent, "Updated name: 63/110", "An unrelated update does not restart numeric channels");
  f.advance(50); assert.equal(node.textContent, "Updated name: 45/120");
  assert.equal(f.element.children[0], node); assert.equal(f.frames.size, 0);
  f.destroy();
  const decimal = await motionFixture("dynamic-number", { "character.hp.current": 1.234 });
  await decimal.update({ "character.hp.current": 3.456 }); decimal.advance(50);
  assert.equal(decimal.element.children[0].textContent, "2.35");
  decimal.advance(50); assert.equal(decimal.element.children[0].textContent, "3.456", "The final value preserves the actual precision");
  decimal.destroy();
});

test("missing data and zero maxima cancel old transitions and valid recovery snaps current values", async () => {
  const f = await motionFixture("resource-bar", { "character.hp.current": 80, "character.hp.max": 100 }, { preview: true });
  const track = f.element.children[0], fill = track.children[0];
  await f.update({ "character.hp.current": 40, "character.hp.max": 100 });
  const stale = [...f.frames.values()]; f.advance(25);
  await f.update({ "character.hp.current": 40, "character.hp.max": 0 });
  assert.equal(f.frames.size, 0); assert.equal(fill.style.width, "0%"); assert.equal(track.children[1].textContent, "—");
  for (const callback of stale) callback(1000);
  assert.equal(fill.style.width, "0%", "Stale callbacks cannot restore invalid resource values");
  await f.update({ "character.hp.current": 30, "character.hp.max": 100 });
  assert.equal(f.element.children[0], track); assert.equal(fill.style.width, "30%"); assert.equal(f.frames.size, 0);
  f.destroy();
  const number = await motionFixture("dynamic-number", { "character.hp.current": 80 });
  await number.update({ "character.hp.current": 20 }); number.advance(25);
  await number.update({ "character.hp.current": null });
  assert.equal(number.element.children[0].textContent, "—"); assert.equal(number.frames.size, 0);
  number.advance(1000); assert.equal(number.element.children[0].textContent, "—");
  number.destroy();
});

test("numeric actions can interpolate a matching field independently of optional default transitions", async () => {
  const actual = { "character.hp.current": 80 };
  const f = await motionFixture("dynamic-number", actual, { transition: { duration: 0, numeric: false } });
  assert.equal(f.binding.animateNumber({ field: "character.private", previous: 80, current: 10 }, { duration: 100 }), false);
  assert.equal(f.binding.animateNumber({ field: "character.hp.current", previous: "80", current: 10 }, { duration: 100 }), false);
  assert.equal(f.binding.animateNumber({ field: "character.hp.current", previous: 80, current: 40 }, { duration: 100, easing: "linear" }), true);
  f.advance(50); assert.equal(f.element.children[0].textContent, "60");
  await f.update({ "character.hp.current": 40 });
  assert.equal(f.element.children[0].textContent, "60", "An arriving matching Actor snapshot preserves the explicit visual action");
  f.advance(50); assert.equal(f.element.children[0].textContent, "40");
  assert.deepEqual(actual, { "character.hp.current": 80 }, "Visual actions never alter source data");
  f.destroy();
});

test("disable, reduced motion and removal immediately settle or cancel numeric channels", async () => {
  for (const controllerOptions of [{ enabled: false }, { reducedMotion: true }]) {
    const f = await motionFixture("resource-bar", { "character.hp.current": 80, "character.hp.max": 100 }, { controllerOptions });
    await f.update({ "character.hp.current": 20, "character.hp.max": 100 });
    assert.equal(f.element.children[0].children[0].style.width, "20%");
    assert.equal(f.element.children[0].children[1].textContent, "20 / 100");
    assert.equal(f.frames.size, 0); f.destroy();
  }
  const f = await motionFixture("dynamic-number", { "character.hp.current": 80 });
  await f.update({ "character.hp.current": 20 }); f.advance(25);
  const node = f.element.children[0], lastValue = node.textContent, stale = [...f.frames.values()];
  f.binding.destroy(); assert.equal(f.frames.size, 0); assert.equal(f.subscribed, false);
  for (const callback of stale) callback(500);
  assert.equal(node.textContent, lastValue); assert.equal(f.controller.numbers.size, 0);
  f.controller.destroy();
});

test("portrait updates reuse the artwork node and recover visibility after a failed source", async () => {
  const f = await motionFixture("character-portrait", { "character.portrait": "portraits/first.webp" });
  const image = f.element.children[0];
  image.listeners.get("error")(); assert.equal(image.style.visibility, "hidden");
  await f.update({ "character.portrait": "portraits/latest.webp" });
  assert.equal(f.element.children[0], image); assert.equal(image.src, "/prefix/portraits/latest.webp");
  assert.equal(image.style.visibility, "");
  await f.update({ "character.portrait": null }); assert.equal(f.element.children.length, 0);
  await f.update({ "character.portrait": "portraits/recovered.webp" }); assert.equal(f.element.children[0], image);
  f.destroy();
});
