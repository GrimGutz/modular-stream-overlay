import test from "node:test";
import assert from "node:assert/strict";
import { createState, createOverlay, validateLayer, validateState } from "../scripts/core/schema.js";
import { OverlayStore } from "../scripts/core/store.js";
import { WidgetPresetStore } from "../scripts/core/widget-presets.js";
import { AdapterRegistry } from "../scripts/core/registry.js";
import { CharacterDataService } from "../scripts/data/character-data.js";
import { genericAdapter } from "../scripts/adapters/generic.js";
import { cainAdapter } from "../scripts/adapters/cain.js";
import { DEMO_ACTOR_UUIDS } from "../scripts/demo/data.js";
import { installDemo, createDemoPreset, createDemoOverlay, DEMO_PRESET_ID, DEMO_OVERLAY_ID, DEMO_WIDGET_ID } from "../scripts/demo/install.js";
import { OverlayRenderer } from "../scripts/render/renderer.js";

function fixture({ empty = false, system = "cain" } = {}) {
  const gm = { id: "gm", isGM: true }, viewer = { id: "viewer", role: 1, isGM: false };
  const state = createState();
  if (!empty) { const original = createOverlay("Existing user overlay"); original.layers = [{ id: "user-text", type: "text", text: "Keep my overlay" }]; state.overlays.push(original); state.activeOverlayId = original.id; }
  const values = new Map([["state", state]]), writes = [];
  const settings = { get: (_id, key) => structuredClone(values.get(key)), async set(_id, key, value) { values.set(key, structuredClone(value)); writes.push(key); } };
  const store = new OverlayStore({ settings, getUser: () => gm }), widgetPresets = new WidgetPresetStore({ settings, getUser: () => gm });
  const adapters = new AdapterRegistry(); adapters.register(genericAdapter); adapters.register(cainAdapter);
  let realReads = 0;
  const characterData = new CharacterDataService({ adapters, getUser: () => viewer, getSystemId: () => system,
    resolveUuid: async () => { realReads++; throw Error("No real documents in demo test"); }, hooks: null, debounceMs: 0 });
  return { store, widgetPresets, characterData, settings, values, writes, realReads: () => realReads };
}

test("demo installation preserves all existing overlays, designs and the active selection; reopening preserves edits", async () => {
  const f = fixture(), original = f.store.getState(), originalPresets = f.widgetPresets.list();
  const first = await installDemo(f);
  assert.equal(first.created, true); assert.equal(first.overlayId, DEMO_OVERLAY_ID); assert.equal(first.presetId, DEMO_PRESET_ID);
  assert.deepEqual(f.store.getState().overlays.filter(item => item.id !== DEMO_OVERLAY_ID), original.overlays);
  assert.deepEqual(f.widgetPresets.list().filter(item => item.id !== DEMO_PRESET_ID), originalPresets);
  assert.equal(f.store.getState().activeOverlayId, original.activeOverlayId);
  const preset = f.widgetPresets.list().find(item => item.id === DEMO_PRESET_ID); preset.name = "My edited demo card";
  await f.widgetPresets.save(preset);
  const overlay = f.store.getState().overlays.find(item => item.id === DEMO_OVERLAY_ID); overlay.layers.find(item => item.id === "demo-title").text = "My edited title";
  await f.store.saveOverlay(overlay);
  const count = f.writes.length;
  const second = await installDemo({ ...f, characterData: { fieldDefinitions() { throw Error("Broken mapping must not prevent opening an existing demo"); } } });
  assert.equal(second.created, false); assert.equal(f.writes.length, count);
  assert.equal(f.widgetPresets.list().find(item => item.id === DEMO_PRESET_ID).name, "My edited demo card");
  assert.equal(f.store.getState().overlays.find(item => item.id === DEMO_OVERLAY_ID).layers.find(item => item.id === "demo-title").text, "My edited title");
  await installDemo({ ...f, reset: true });
  assert.equal(f.widgetPresets.list().find(item => item.id === DEMO_PRESET_ID).name, "Demo — Animated Character Card");
  assert.deepEqual(f.store.getState().overlays.filter(item => item.id !== DEMO_OVERLAY_ID), original.overlays);
  assert.equal(f.realReads(), 0);
});

test("demo installation into an empty world leaves output transparent and survives store recreation", async () => {
  const f = fixture({ empty: true }); await installDemo(f);
  assert.equal(f.store.getState().activeOverlayId, null);
  const restored = new OverlayStore({ settings: f.settings, getUser: () => ({ isGM: true }) });
  assert.equal(restored.getState().overlays[0].name, "Demo — Animated Character Showcase");
  assert.equal(f.widgetPresets.list().find(item => item.id === DEMO_PRESET_ID).pages.length, 3);
});

test("demo uses actual adapter fields and ordinary editable pages with authored timings and transitions", () => {
  const f = fixture(); const preset = createDemoPreset({ fields: f.characterData.fieldDefinitions() });
  assert.equal(preset.pages.length, 3); assert.deepEqual(preset.pages.map(page => page.duration), [4000, 4000, 4000]);
  assert.equal(preset.animations.entrance.type, "fade-in"); assert.equal(preset.animations.entrance.duration, 600);
  assert.equal(preset.animations.emphasis.type, "pulse"); assert.equal(preset.animations.emphasis.duration, 800);
  assert.equal(preset.cycling.transitionDuration, 400); assert.equal(preset.cycling.characterTransitionDuration, 600);
  assert.equal(preset.cycling.mode, "combined"); assert.equal(preset.cycling.traversal, "pages-first"); assert.equal(preset.cycling.enabled, true);
  const allowed = new Set(f.characterData.fieldDefinitions().map(field => field.id));
  for (const layer of [...preset.layers, ...preset.pages.flatMap(page => page.layers)]) if (layer.binding) assert(allowed.has(layer.binding), layer.binding);
  assert(!JSON.stringify(preset).includes("Demo.warrior")); assert(!JSON.stringify(preset).includes("Actor."));
  const basic = createDemoPreset({ fields: fixture({ system: "unknown" }).characterData.fieldDefinitions() });
  assert.equal(basic.pages.length, 3); assert(!basic.pages[0].layers.some(layer => layer.type === "resource-bar"));
  assert(!JSON.stringify(basic).includes("character.hp"));
});

test("synthetic source is explicit and cannot be mixed into real Actor assignments", () => {
  const overlay = createDemoOverlay(), instance = overlay.layers.find(layer => layer.id === DEMO_WIDGET_ID);
  assert.equal(instance.dataSource, "demo"); assert.deepEqual(instance.actorUuids, DEMO_ACTOR_UUIDS);
  assert.throws(() => validateLayer({ ...instance, dataSource: "actors" }), /Actor/);
  assert.throws(() => validateLayer({ ...instance, actorUuid: "Actor.real", actorUuids: ["Actor.real"] }), /DEMO DATA/);
  const real = validateLayer({ ...instance, dataSource: "actors", actorUuid: "Actor.real", actorUuids: ["Actor.real"] });
  assert.equal(real.presetId, instance.presetId);
  assert.equal(validateState({ ...createState(), overlays: [overlay] }).overlays[0].layers.find(layer => layer.id === DEMO_WIDGET_ID).dataSource, "demo");
});

test("damage and healing use selected scalar subscriptions without resolving or writing real Actors", async () => {
  const f = fixture(), fields = ["character.name", "character.hp.current", "character.hp.max"];
  const initial = await f.characterData.resolve(DEMO_ACTOR_UUIDS[0], fields);
  assert.deepEqual(initial.values, { "character.name": "Demo Warrior", "character.hp.current": 75, "character.hp.max": 100 });
  let changed; const update = new Promise(resolve => { changed = resolve; });
  const unsubscribe = f.characterData.subscribe(DEMO_ACTOR_UUIDS[0], changed);
  f.characterData.simulateDemo(DEMO_ACTOR_UUIDS[0], "damage"); await update;
  assert.equal((await f.characterData.resolve(DEMO_ACTOR_UUIDS[0], fields)).values["character.hp.current"], 65);
  assert.equal((await f.characterData.resolve(DEMO_ACTOR_UUIDS[1], fields)).values["character.hp.current"], 40);
  f.characterData.simulateDemo(DEMO_ACTOR_UUIDS[0], "healing");
  assert.throws(() => f.characterData.simulateDemo("Actor.real", "damage"), /DEMO DATA/);
  assert.equal(f.realReads(), 0); assert.equal(f.writes.length, 0);
  unsubscribe(); f.characterData.stop();
});

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.animations = []; this.classList = { add() {} }; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute() {} addEventListener() {} getBoundingClientRect() { return { width: 1920, height: 1080 }; }
  animate(frames, options) { const animation = { frames, options, finished: options.iterations === Infinity ? new Promise(() => {}) : Promise.resolve(), cancel() {} }; this.animations.push(animation); return animation; }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test("the persisted demo exercises the production renderer, real bindings, independent axes and trigger engine", async t => {
  globalThis.document = { createElement: tag => new Element(tag) }; globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const f = fixture(); await installDemo(f);
  const overlay = f.store.getState().overlays.find(item => item.id === DEMO_OVERLAY_ID);
  const renderer = new OverlayRenderer(new Element("main"), { context: { widgetPresets: f.widgetPresets, characterData: f.characterData, debug: () => true, reducedMotion: () => false } });
  t.after(() => { renderer.destroy(); f.characterData.stop(); });
  await renderer.render(overlay); const view = renderer.compositions.get(DEMO_WIDGET_ID); view.pause();
  const mainPage = view.activeSlot.renderer.carousel.views.get("demo-main").renderer;
  assert.equal(mainPage.motions.get("demo-hp-text").settings.transition.duration, 600, "Page text inherits the grouped value transition");
  assert.equal(mainPage.motions.get("demo-hp-text").settings.transition.numeric, true);
  const send = async (kind, extra = {}) => { assert.equal(renderer.handleAnimationCommand({ overlayId: overlay.id, layerId: DEMO_WIDGET_ID, kind, ...extra }), true); await settle(); await settle(); };
  assert.equal(view.getState().activeActorUuid, "Demo.warrior"); assert.equal(view.getState().activePageId, "demo-main");
  const pairs = [];
  for (let index = 0; index < 6; index++) { pairs.push([view.getState().activeActorUuid, view.getState().activePageId]); await send("carousel", { action: "next" }); }
  assert.deepEqual(pairs, [["Demo.warrior", "demo-main"], ["Demo.warrior", "demo-additional"], ["Demo.warrior", "demo-visual"], ["Demo.mage", "demo-main"], ["Demo.mage", "demo-additional"], ["Demo.mage", "demo-visual"]]);
  assert.equal(view.getState().activeActorUuid, "Demo.warrior"); assert.equal(view.getState().activePageId, "demo-main");
  await send("demo", { action: "damage" }); await new Promise(resolve => setTimeout(resolve, 5)); await settle();
  assert.equal(renderer.getDiagnostics()[0].lastTrigger.ruleId, "demo-damage-flash");
  await send("demo", { action: "healing" }); await new Promise(resolve => setTimeout(resolve, 5)); await settle();
  assert.equal(renderer.getDiagnostics()[0].lastTrigger.ruleId, "demo-healing-flash");
  await send("exit"); assert.equal(renderer.motions.get(DEMO_WIDGET_ID).element.style.visibility, "hidden");
  await send("entrance"); assert.equal(renderer.motions.get(DEMO_WIDGET_ID).element.style.visibility, "visible");
  await send("carousel", { action: "next-actor" }); assert.equal(view.getState().activeActorUuid, "Demo.mage");
  await send("carousel", { action: "next-page" }); assert.equal(view.getState().activePageId, "demo-additional");
  assert.equal(view.getState().paused, true); assert.equal(f.realReads(), 0);
});
