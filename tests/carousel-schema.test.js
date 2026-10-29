import test from "node:test";
import assert from "node:assert/strict";
import { clone, createOverlay, createState, SCHEMA_VERSION, WIDGET_PRESET_SCHEMA_VERSION, validateOverlay, validateState, validateWidgetPreset } from "../scripts/core/schema.js";
import { createLayer, createWidgetInstance } from "../scripts/core/layers.js";
import { createWidgetPreset, widgetPresetToOverlay, overlayToWidgetPreset, WidgetPresetStore, validateWidgetPresetState } from "../scripts/core/widget-presets.js";
import { PAGE_TRANSITIONS, PAGE_LIMIT, COMPONENT_LIMIT, createPage, addPage, duplicatePage, renamePage, deletePage, reorderPage, validateCycling } from "../scripts/carousel/schema.js";

function card() {
  const preset = createWidgetPreset("Fantasy card");
  preset.layers = [
    { ...createLayer("character-portrait", preset.canvas), id: "portrait", src: "worlds/example/fallback.webp" },
    { ...createLayer("character-name", preset.canvas), id: "name" }
  ];
  preset.pages = ["Basic Information", "Attributes", "Resources"].map((name, index) => ({
    ...createPage(name), id: `page-${index}`, duration: index === 1 ? 8000 : null,
    layers: [{ ...createLayer("dynamic-number", preset.canvas), id: `number-${index}`, binding: index === 0 ? "character.hp.current" : index === 1 ? "character.attributes.strength" : "character.custom_resource.current", fallback: "Unavailable" }]
  }));
  preset.cycling = { ...preset.cycling, enabled: true, startPageId: "page-1" };
  return preset;
}

test("information pages and all transition settings round trip through reusable designs and overlay presets", () => {
  const source = card();
  source.pages[1].skipIfUnavailable = true;
  source.pages[0].layers[0].animations.emphasis = { type: "pulse", duration: 500, delay: 0, easing: "ease-out", direction: "normal", intensity: 1, repeat: 1 };
  source.pages[0].layers[0].triggers = [{ id: "manual", name: "Flash", enabled: true, event: "manual", field: "", condition: null, continuous: false, action: { type: "show", target: "number-0" } }];
  for (const { id: transition } of PAGE_TRANSITIONS) {
    source.cycling.transition = transition;
    const normalized = validateWidgetPreset(source);
    assert.deepEqual(overlayToWidgetPreset(widgetPresetToOverlay(JSON.parse(JSON.stringify(normalized)))), normalized);
    const state = { ...createState(), overlays: [widgetPresetToOverlay(source)] };
    assert.deepEqual(validateState(state).overlays[0].pages, normalized.pages);
    assert.deepEqual(normalized.layers, source.layers);
  }
  assert.equal(SCHEMA_VERSION, 6);
  assert.equal(WIDGET_PRESET_SCHEMA_VERSION, 4);
  assert.equal(PAGE_TRANSITIONS.length, 21);
  assert(PAGE_TRANSITIONS.some(entry => entry.id === "fade-over"));
  assert.equal(Object.isFrozen(PAGE_TRANSITIONS[0]), true);
});

test("legacy widget and overlay schemas normalize single-page behavior without mutating stored input", () => {
  for (const schemaVersion of [1, 2]) {
    const source = createWidgetPreset("Old card");
    source.schemaVersion = schemaVersion;
    source.layers = [{ ...createLayer("character-name"), id: "old-name" }];
    delete source.pages;
    delete source.cycling;
    const before = clone(source);
    const result = validateWidgetPreset(source);
    assert.deepEqual(source, before);
    assert.deepEqual(result.pages, []);
    assert.deepEqual(result.cycling, { enabled: false, mode: "information", traversal: "pages-first", duration: 5000, transition: "fade", transitionDuration: 400, characterTransition: "fade", characterTransitionDuration: 500, loop: true, startPageId: null });
    assert.deepEqual(result.layers, source.layers);
    const state = { schemaVersion, revision: 7, presets: [source] };
    assert.equal(validateWidgetPresetState(state).schemaVersion, 4);
    assert.equal(state.schemaVersion, schemaVersion);
  }
  for (const schemaVersion of [1, 2, 3, 4, 5]) {
    const overlay = createOverlay();
    overlay.schemaVersion = schemaVersion;
    delete overlay.pages;
    delete overlay.cycling;
    assert.equal(validateOverlay(overlay).cycling.enabled, false);
    assert.deepEqual(validateOverlay(overlay).pages, []);
  }
});

test("page validation bounds timing, transitions, page references, count and aggregate components", () => {
  const source = card();
  for (const patch of [
    { duration: 99 }, { duration: 3600001 }, { duration: 500.5 }, { duration: Infinity }, { duration: "5000" },
    { transitionDuration: -1 }, { transitionDuration: 10001 }, { transitionDuration: 2.5 },
    { enabled: "true" }, { loop: 1 }, { transition: "url(script)" }, { startPageId: "missing" }
  ]) assert.throws(() => validateWidgetPreset({ ...source, cycling: { ...source.cycling, ...patch } }), TypeError, JSON.stringify(patch));
  for (const duration of [100, 3600000]) assert.equal(validateCycling({ duration }, []).duration, duration);
  for (const patch of [{ duration: 99 }, { duration: 3600001 }, { duration: NaN }, { duration: "5000" }, { skipIfUnavailable: 1 }, { name: "" }, { name: "a".repeat(81) }, { id: "bad id" }]) {
    assert.throws(() => validateWidgetPreset({ ...source, pages: [{ ...source.pages[0], ...patch }] }), TypeError);
  }
  assert.throws(() => validateWidgetPreset({ ...source, pages: Array.from({ length: PAGE_LIMIT + 1 }, (_, index) => ({ ...createPage(), id: `p-${index}` })) }), /20/);
  const max = createWidgetPreset();
  max.pages = [{ ...createPage(), layers: Array.from({ length: COMPONENT_LIMIT }, (_, index) => ({ ...createLayer("text"), id: `item-${index}` })) }];
  assert.doesNotThrow(() => validateWidgetPreset(max));
  max.layers = [{ ...createLayer("text"), id: "shared-extra" }];
  assert.throws(() => validateWidgetPreset(max), /100 components/);
});

test("unsafe, recursive, duplicate and nested widget page records are rejected", () => {
  const source = card();
  const isolated = pages => ({ ...source, pages, cycling: { ...source.cycling, startPageId: null } });
  for (const pages of [null, {}, [new Date()], [JSON.parse('{"id":"bad","__proto__":{}}')], [source.pages[0], source.pages[0]], [{ ...source.pages[0], pages: [] }], [{ ...source.pages[0], cycling: {} }], [{ ...source.pages[0], widgets: [{ id: "legacy", type: "legacy" }] }]]) {
    assert.throws(() => validateWidgetPreset(isolated(pages)), TypeError);
  }
  const duplicateShared = { ...source.pages[0], layers: [{ ...source.pages[0].layers[0], id: "portrait" }] };
  assert.throws(() => validateWidgetPreset(isolated([duplicateShared])), /duplicate IDs/);
  const duplicatePageComponent = { ...source.pages[1], layers: [{ ...source.pages[1].layers[0], id: "number-0" }] };
  assert.throws(() => validateWidgetPreset(isolated([source.pages[0], duplicatePageComponent])), /duplicate IDs/);
  for (const layer of [createWidgetInstance(source), { ...createLayer("text"), pages: [] }, { ...createLayer("text"), widgets: [] }]) {
    assert.throws(() => validateWidgetPreset(isolated([{ ...createPage(), layers: [layer] }])), /nested widget|recursive pages/);
  }
});

test("page draft operations preserve shared design and remap duplicate page trigger targets", () => {
  const source = card();
  const first = source.pages[0];
  const second = { ...createLayer("text"), id: "detail" };
  first.layers.push(second);
  first.layers[0].triggers = [
    { id: "inside", action: { type: "show", target: "detail" } },
    { id: "shared", action: { type: "show", target: "portrait" } },
    { id: "self", action: { type: "hide", target: "self" } }
  ];
  const before = clone(source);
  const duplicate = duplicatePage(source, first.id);
  assert.equal(source.pages.indexOf(duplicate), 1);
  assert.notEqual(duplicate.id, first.id);
  assert.notEqual(duplicate.layers[0].id, first.layers[0].id);
  assert.equal(duplicate.layers[0].triggers[0].action.target, duplicate.layers[1].id);
  assert.equal(duplicate.layers[0].triggers[1].action.target, "portrait");
  assert.equal(duplicate.layers[0].triggers[2].action.target, "self");
  duplicate.layers[0].fallback = "Changed";
  assert.deepEqual(first, before.pages[0]);
  assert.deepEqual(source.layers, before.layers);
  assert.equal(renamePage(source, duplicate.id, "  Copy page  "), true);
  assert.equal(duplicate.name, "Copy page");
  assert.equal(reorderPage(source, duplicate.id, "last"), true);
  assert.equal(source.pages.at(-1).id, duplicate.id);
  const added = addPage(source, "Another page");
  assert.equal(added.layers.length, 0);
  source.cycling.startPageId = added.id;
  assert.equal(deletePage(source, added.id), true);
  assert.equal(source.cycling.startPageId, null);
  assert.equal(deletePage(source, "absent"), false);
  assert.equal(renamePage(source, "absent", "Anything"), false);
  assert.equal(duplicatePage(source, "absent"), null);
  assert.throws(() => reorderPage(source, first.id, "around"), TypeError);
});

test("presets store layouts and binding identifiers only; reads and page editing never write Actor documents", async () => {
  const source = card();
  source.actorUuid = "Actor.design-must-not-bind";
  source.pages[0].actor = { system: { private: "secret" }, update: "must not store" };
  source.pages[0].layers[0].actorUuid = "Actor.do-not-bind";
  source.pages[0].layers[0].actor = { system: { private: "secret" } };
  let state = { schemaVersion: 2, revision: 0, presets: [source] };
  let writes = 0;
  const store = new WidgetPresetStore({ settings: { get: () => state, set: async (_id, _key, next) => { writes++; state = next; } }, getUser: () => ({ isGM: true }) });
  const loaded = store.list()[0];
  assert.equal(writes, 0);
  assert.equal(loaded.actorUuid, undefined);
  assert.equal(loaded.pages[0].actor, undefined);
  assert.equal(loaded.pages[0].layers[0].actorUuid, undefined);
  assert.equal(loaded.pages[0].layers[0].actor, undefined);
  assert.equal(loaded.pages[0].layers[0].binding, "character.hp.current");
  addPage(loaded);
  assert.equal(writes, 0);
  await store.save(loaded);
  assert.equal(writes, 1);
  assert.equal(JSON.stringify(state).includes("Actor."), false);
  assert.equal(JSON.stringify(state).includes("secret"), false);
});
