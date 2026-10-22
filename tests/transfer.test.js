import test from "node:test";
import assert from "node:assert/strict";
import { createOverlay, createState } from "../scripts/core/schema.js";
import { createLayer, createWidgetInstance } from "../scripts/core/layers.js";
import { createWidgetPreset } from "../scripts/core/widget-presets.js";
import { exportBundle, exportFragment, exportFilename, readTransferFile, planImport } from "../scripts/authoring/transfer.js";
import { FRAGMENTS_SETTING } from "../scripts/core/fragments.js";

class ApplicationStub {
  constructor() { this.rendered = false; }
  _canRender() { return undefined; }
  async _prepareContext() { return {}; }
  async render() { return this; }
  async close() { return this; }
}
globalThis.foundry ??= {
  applications: { api: { ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: base => base, DialogV2: {} } },
  utils: { deepClone: structuredClone, getRoute: path => `/foundry/${path}` }
};
const { OverlayEditor, configureEditor } = await import("../scripts/ui/editor.js");

function design(id = "plate-design") {
  const preset = createWidgetPreset("Plate");
  preset.id = id;
  return preset;
}
function overlayWithWidget(preset, actors = ["Actor.known", "Actor.missing"]) {
  const overlay = createOverlay("Dossier");
  const widget = createWidgetInstance(preset);
  Object.assign(widget, { id: "card", actorUuids: actors, actorUuid: actors[0] });
  overlay.layers.push(widget, Object.assign(createLayer("text", overlay.canvas), { id: "title" }));
  return overlay;
}

test("exports carry the widget designs they use and read back; other files are refused", () => {
  const preset = design(), unused = design("unused");
  const bundle = exportBundle({ overlays: [overlayWithWidget(preset)], library: [preset, unused] });
  assert.deepEqual(bundle.widgetPresets.map(item => item.id), ["plate-design"]);
  const back = readTransferFile(JSON.stringify(bundle));
  assert.equal(back.kind, "bundle"); assert.equal(back.bundle.overlays[0].layers.length, 2);
  const fragment = exportFragment({ name: "Plate", layers: [createWidgetInstance(preset), createLayer("color")] }, [preset, unused]);
  const fragmentBack = readTransferFile(JSON.stringify(fragment));
  assert.deepEqual([fragmentBack.kind, fragmentBack.name, fragmentBack.layers.length, fragmentBack.widgetPresets.length], ["fragment", "Plate", 2, 1]);
  for (const text of ["not json", "{}", JSON.stringify({ format: "mso-layer-fragment", version: 1, moduleId: "modular-stream-overlay", layers: [] })]) assert.throws(() => readTransferFile(text));
  assert.equal(exportFilename("Досье «Мой» КАИН", "overlay"), "Досье-Мой-КАИН.overlay.json");
});

test("an import plan never overwrites: taken IDs are renamed, identical designs reused, unknown Actors dropped", async () => {
  const preset = design(), changed = { ...design(), name: "Plate v2" };
  const bundle = exportBundle({ overlays: [overlayWithWidget(changed)], library: [changed] });
  const same = await planImport(exportBundle({ overlays: [overlayWithWidget(preset)], library: [preset] }), { presets: [preset] });
  assert.equal(same.widgetPresets.length, 0, "An identical design is reused");
  const plan = await planImport(bundle, { overlayIds: [bundle.overlays[0].id], presets: [preset], actorExists: async uuid => uuid === "Actor.known" });
  assert.notEqual(plan.overlays[0].id, bundle.overlays[0].id);
  assert.notEqual(plan.widgetPresets[0].id, "plate-design");
  const widget = plan.overlays[0].layers.find(layer => layer.id === "card");
  assert.equal(widget.presetId, plan.widgetPresets[0].id, "The widget follows its renamed design");
  assert.deepEqual(widget.actorUuids, ["Actor.known"]); assert.equal(plan.droppedActors, 1);
});

function memorySettings() {
  const values = new Map();
  return { get: (scope, key) => values.get(`${scope}.${key}`), set: async (scope, key, value) => { values.set(`${scope}.${key}`, structuredClone(value)); return value; } };
}

function editorFixture() {
  const state = { ...createState(), revision: 1, overlays: [createOverlay("Draft")] };
  const store = {
    getState: () => structuredClone(state), listPresets: () => [],
    saveOverlay: async input => { state.overlays.push(structuredClone(input)); state.revision++; return structuredClone(input); }
  };
  const presets = { revision: 1, list: [] };
  const widgetPresets = { list: () => structuredClone(presets.list), getState: () => ({ revision: presets.revision, presets: structuredClone(presets.list) }),
    save: async preset => { presets.list.push(structuredClone(preset)); presets.revision++; return preset; } };
  const downloads = [], notes = [];
  globalThis.foundry.utils.saveDataToFile = (text, type, name) => downloads.push({ text, type, name });
  globalThis.game = { user: { isGM: true }, world: { id: "w" }, settings: memorySettings(), i18n: { lang: "en" },
    modules: new Map([["modular-stream-overlay", { api: { store } }]]), users: [] };
  globalThis.ui = { notifications: { info: message => notes.push(message), warn: message => notes.push(message), error() {} } };
  configureEditor({ store, widgetPresets, characterData: { resolveActor: async uuid => uuid === "Actor.known" ? { uuid } : null } });
  const editor = new OverlayEditor();
  editor.element = { querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, removeAttribute() {} };
  editor._updatePreview = async () => {};
  editor._loadDraft(state.overlays[0], 1);
  return { editor, state, presets, downloads, notes };
}

test("the editor rescales its draft as one undo step, moving guides with it", async () => {
  const { editor } = editorFixture();
  editor._draft.layers.push(Object.assign(createLayer("text", editor._draft.canvas), { id: "title", x: 960, y: 540, width: 200, height: 100, fontSize: 30 }));
  editor._commitHistory();
  game.settings.get = (scope, key) => key === "canvasGuides" ? { [editor._draft.id]: { x: [960], y: [] } } : undefined;
  let saved; game.settings.set = async (scope, key, value) => { saved = value; };
  await editor._applyRescale(2560, 1440, "fit");
  const title = editor._draft.layers.find(layer => layer.id === "title");
  assert.deepEqual([editor._draft.canvas.width, title.x, title.fontSize], [2560, 1280, 40]);
  assert.deepEqual(saved[editor._draft.id], { x: [1280], y: [] });
  await editor._canvasCommand("undo");
  assert.deepEqual([editor._draft.canvas.width, editor._draft.layers[0].x], [1920, 960]);
});

test("export saves a file; import adds overlays, designs and fragments without replacing anything", async () => {
  const { editor, state, presets, downloads, notes } = editorFixture();
  const preset = design();
  presets.list.push(preset);
  const overlay = overlayWithWidget(preset);
  editor._loadDraft(overlay, 1);
  editor._exportFile();
  assert.equal(downloads[0].name, "Dossier.overlay.json"); assert.equal(downloads[0].type, "application/json");
  editor._loadDraft(state.overlays[0], 1);
  await editor._importFile({ text: async () => downloads[0].text });
  const imported = state.overlays.at(-1);
  assert.equal(imported.name, "Dossier"); assert.equal(presets.list.length, 1, "The identical design is reused");
  assert.deepEqual(imported.layers.find(layer => layer.id === "card").actorUuids, ["Actor.known"]);
  assert(notes.some(note => /1/.test(note) && /Actor|character/i.test(note)), "The dropped assignment is reported");
  const fragment = exportFragment({ name: "Plate", layers: [createLayer("color")] });
  await editor._importFile({ text: async () => JSON.stringify(fragment) });
  assert.deepEqual(game.settings.get("modular-stream-overlay", FRAGMENTS_SETTING).map(entry => entry.name), ["Plate"]);
  await assert.rejects(editor._importFile({ text: async () => "{}" }), /not a Modular Stream Overlay/);
});
