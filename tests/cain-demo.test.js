import test from "node:test";
import assert from "node:assert/strict";
import { createState, createOverlay, validateOverlay, validateWidgetPreset } from "../scripts/core/schema.js";
import { OverlayStore } from "../scripts/core/store.js";
import { WidgetPresetStore, widgetPresetToOverlay, overlayToWidgetPreset } from "../scripts/core/widget-presets.js";
import { AdapterRegistry } from "../scripts/core/registry.js";
import { CharacterDataService } from "../scripts/data/character-data.js";
import { genericAdapter } from "../scripts/adapters/generic.js";
import { cainAdapter } from "../scripts/adapters/cain.js";
import { OverlayRenderer } from "../scripts/render/renderer.js";
import { createCainCharacter, CAIN_VIEWER } from "./fixtures/cain-1.3.26.js";
import { requestedFields } from "../scripts/data/bindings.js";
import { createCainCardPreset, createCainCompactPreset, createCainExampleOverlay, installCainPresets, CAIN_CARD_ID, CAIN_COMPACT_ID, CAIN_OVERLAY_ID, CAIN_WIDGET_ID } from "../scripts/demo/cain.js";

function fixture({ empty = false } = {}) {
  const initial = createState();
  if (!empty) { const overlay = createOverlay("Existing user overlay"); initial.overlays.push(overlay); initial.activeOverlayId = overlay.id; }
  const values = new Map([["state", initial]]), writes = [];
  const settings = { get: (_id, key) => structuredClone(values.get(key)), async set(_id, key, value) { values.set(key, structuredClone(value)); writes.push(key); } };
  const getUser = () => ({ isGM: true });
  const store = new OverlayStore({ settings, getUser }), widgetPresets = new WidgetPresetStore({ settings, getUser });
  return { store, widgetPresets, values, writes };
}

test("CAIN examples install only by explicit invocation and preserve existing presets, active output and later edits", async () => {
  const f = fixture(), before = f.store.getState(), oldPresets = f.widgetPresets.list();
  assert.equal(f.writes.length, 0);
  const installed = await installCainPresets(f);
  assert.equal(installed.created, true); assert.deepEqual(installed.createdPresetIds, [CAIN_CARD_ID, CAIN_COMPACT_ID]);
  assert.equal(f.store.getState().activeOverlayId, before.activeOverlayId);
  assert.deepEqual(f.store.getState().overlays.filter(item => item.id !== CAIN_OVERLAY_ID), before.overlays);
  assert.deepEqual(f.widgetPresets.list().filter(item => !installed.presetIds.includes(item.id)), oldPresets);
  const card = f.widgetPresets.list().find(item => item.id === CAIN_CARD_ID); card.name = "My CAIN design";
  await f.widgetPresets.save(card);
  const overlay = f.store.getState().overlays.find(item => item.id === CAIN_OVERLAY_ID);
  overlay.layers[0].actorUuids = ["Actor.myCharacter"]; overlay.layers[0].actorUuid = "Actor.myCharacter";
  await f.store.saveOverlay(overlay);
  const count = f.writes.length;
  assert.equal((await installCainPresets(f)).created, false); assert.equal(f.writes.length, count);
  assert.equal(f.widgetPresets.list().find(item => item.id === CAIN_CARD_ID).name, "My CAIN design");
  assert.deepEqual(f.store.getState().overlays.find(item => item.id === CAIN_OVERLAY_ID).layers[0].actorUuids, ["Actor.myCharacter"]);
});

test("empty-world installation stays off air, is Actor-free and repairs only a missing example", async () => {
  const f = fixture({ empty: true }); await installCainPresets(f);
  assert.equal(f.store.getState().activeOverlayId, null);
  const saved = f.store.getState().overlays.find(item => item.id === CAIN_OVERLAY_ID);
  assert.deepEqual(saved.layers[0].actorUuids, []); assert.equal(saved.layers[0].dataSource, "actors");
  for (const preset of f.widgetPresets.list().filter(item => [CAIN_CARD_ID, CAIN_COMPACT_ID].includes(item.id))) assert(!JSON.stringify(preset).includes("Actor."));
  await f.widgetPresets.delete(CAIN_COMPACT_ID); const count = f.writes.length;
  const repaired = await installCainPresets(f);
  assert.deepEqual(repaired.createdPresetIds, [CAIN_COMPACT_ID]); assert.equal(repaired.createdOverlay, false);
  assert.equal(f.writes.length, count + 1); assert.equal(f.store.getState().activeOverlayId, null);
});

test("CAIN designs use only registered scalar bindings and ordinary components and survive export/import round trips", () => {
  const allowed = new Set([...genericAdapter.fields, ...cainAdapter.fields].map(field => field.id));
  const card = createCainCardPreset(), compact = createCainCompactPreset();
  for (const preset of [card, compact]) {
    assert.deepEqual(validateWidgetPreset(JSON.parse(JSON.stringify(preset))), preset);
    assert.deepEqual(overlayToWidgetPreset(widgetPresetToOverlay(preset)), preset);
    for (const layer of [...preset.layers, ...preset.pages.flatMap(page => page.layers)]) {
      for (const id of requestedFields(layer)) assert(allowed.has(id), id);
      assert(!["character-widget"].includes(layer.type));
    }
    assert(!JSON.stringify(preset).includes("system."));
    assert(!JSON.stringify(preset).includes("character.hp")); assert(!JSON.stringify(preset).includes("character.power"));
  }
  assert.equal(card.pages.length, 4); assert.equal(card.cycling.mode, "combined");
  assert(card.pages.every(page => page.skipIfUnavailable));
  assert.equal(card.animations.entrance.type, "fade-in"); assert.equal(card.animations.exit.type, "fade-out");
  const stress = card.pages[0].layers.find(layer => layer.id === "cain-stress");
  assert.equal(stress.triggers[0].event, "increased"); assert.equal(stress.triggers[0].field, "character.stress.current");
});

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.animations = []; this.classList = { add() {} }; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute() {} addEventListener() {} getBoundingClientRect() { return { width: 1920, height: 1080 }; }
  animate(frames, options) { const animation = { frames, options, finished: Promise.resolve(), cancel() {} }; this.animations.push(animation); return animation; }
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("two synthetic CAIN Characters traverse all four production pages and live updates preserve the mounted design", async t => {
  globalThis.document = { createElement: tag => new Element(tag) }; globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const f = fixture(); await installCainPresets(f);
  const one = createCainCharacter(), two = createCainCharacter(); two.uuid = "Actor.secondCain"; two.id = "secondCain"; two.name = "Second synthetic CAIN"; two.system.stress.value = 4;
  const actors = [one, two], adapters = new AdapterRegistry(); adapters.register(genericAdapter); adapters.register(cainAdapter);
  const data = new CharacterDataService({ adapters, getUser: () => CAIN_VIEWER, getSystemId: () => "cain", getSystemVersion: () => "1.3.26",
    resolveUuid: async uuid => actors.find(actor => actor.uuid === uuid), getActors: () => ({ contents: actors }), hooks: null, debounceMs: 0 });
  const overlay = createCainExampleOverlay(); overlay.layers[0].actorUuids = actors.map(actor => actor.uuid); overlay.layers[0].actorUuid = one.uuid;
  const renderer = new OverlayRenderer(new Element("main"), { context: { widgetPresets: f.widgetPresets, characterData: data,
    reducedMotion: () => false, debug: () => true } });
  t.after(() => { renderer.destroy(); data.stop(); });
  await renderer.render(validateOverlay(overlay)); const view = renderer.compositions.get(CAIN_WIDGET_ID); view.pause();
  const pairs = [];
  for (let i = 0; i < 8; i++) { pairs.push([view.getState().activeActorUuid, view.getState().activePageId]); await view.next(); }
  assert.deepEqual(pairs, actors.flatMap(actor => createCainCardPreset().pages.map(page => [actor.uuid, page.id])));
  const page = view.activeSlot.renderer.carousel.views.get("cain-condition-page").renderer;
  const stress = page.layerElements.get("cain-stress"), scene = renderer.root;
  one.system.stress.value = 3; data.refresh(); await new Promise(resolve => setTimeout(resolve, 10)); await settle();
  assert.equal(renderer.root, scene); assert.equal(page.layerElements.get("cain-stress"), stress);
  assert.equal(renderer.getDiagnostics()[0].lastTrigger.ruleId, "cain-stress-increase");
  await renderer.render(null, { animateExit: true }); assert.equal(renderer.root, null); assert.equal(data.subscriptions.size, 0);
});
