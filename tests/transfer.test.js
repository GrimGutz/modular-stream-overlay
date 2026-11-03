import test from "node:test";
import assert from "node:assert/strict";
import { createOverlay, createState } from "../scripts/core/schema.js";
import { createLayer, createWidgetInstance } from "../scripts/core/layers.js";
import { createWidgetPreset } from "../scripts/core/widget-presets.js";
import { exportBundle, exportFragment, exportFilename, readTransferFile, planImport, missingActors } from "../scripts/authoring/transfer.js";
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
function layerWithActors(preset, actors) {
  const widget = createWidgetInstance(preset);
  return Object.assign(widget, { id: "card", actorUuids: actors, actorUuid: actors[0] });
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

test("exports name the characters their widgets show, and imports match them by name or choice", async () => {
  const preset = design();
  const actors = [{ uuid: "Actor.known", name: "Пиротехник" }, { uuid: "Actor.missing", name: "Клептоман" }, { uuid: "Actor.unused", name: "Unused" }];
  const bundle = exportBundle({ overlays: [overlayWithWidget(preset)], library: [preset], actors });
  assert.deepEqual(bundle.actorNames, { "Actor.known": "Пиротехник", "Actor.missing": "Клептоман" }, "Only the characters the widgets show");
  assert.deepEqual(readTransferFile(JSON.stringify(bundle)).bundle.actorNames, bundle.actorNames);
  assert.equal(Object.hasOwn(exportBundle({ overlays: [overlayWithWidget(preset)], library: [preset] }), "actorNames"), false, "Older readers see the same shape");
  assert.throws(() => readTransferFile(JSON.stringify({ ...bundle, actorNames: { "Token.x": "x" } })));
  const fragment = readTransferFile(JSON.stringify(exportFragment({ name: "Card", layers: [layerWithActors(preset, ["Actor.missing"])] }, [preset], actors)));
  assert.deepEqual(fragment.actorNames, { "Actor.missing": "Клептоман" });
  // Another world: Клептоман exists under another ID (and in another case), Пиротехник twice, so neither is guessed.
  const here = [{ uuid: "Actor.local", name: "клептоман" }, { uuid: "Actor.p1", name: "Пиротехник" }, { uuid: "Actor.p2", name: "Пиротехник" }];
  const missing = missingActors(bundle, { exists: uuid => here.some(actor => actor.uuid === uuid), actors: here });
  assert.deepEqual(missing, [{ uuid: "Actor.known", name: "Пиротехник", suggestion: "" }, { uuid: "Actor.missing", name: "Клептоман", suggestion: "Actor.local" }]);
  const plan = await planImport(bundle, { presets: [preset], actorExists: async uuid => here.some(actor => actor.uuid === uuid),
    actorMap: { "Actor.known": "", "Actor.missing": "Actor.local" } });
  const widget = plan.overlays[0].layers.find(layer => layer.id === "card");
  assert.deepEqual([widget.actorUuids, widget.actorUuid], [["Actor.local"], "Actor.local"]);
  assert.deepEqual([plan.droppedActors, plan.droppedActorUuids], [1, ["Actor.known"]]);
  const twice = await planImport(bundle, { presets: [preset], actorExists: async () => true, actorMap: { "Actor.known": "Actor.p1", "Actor.missing": "Actor.p1" } });
  assert.deepEqual(twice.overlays[0].layers.find(layer => layer.id === "card").actorUuids, ["Actor.p1"], "Two characters mapped to one appear once");
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

class FakeElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.textContent = ""; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
}

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
    modules: new Map([["modular-stream-overlay", { api: { store } }]]), users: [], actors: { contents: [{ uuid: "Actor.known", name: "Known" }] } };
  globalThis.document = { createElement: tag => new FakeElement(tag) };
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
  await editor._exportFile();
  assert.equal(downloads[0].name, "Dossier.overlay.json"); assert.equal(downloads[0].type, "application/json");
  editor._loadDraft(state.overlays[0], 1);
  // This world has other characters too, so the import asks; leaving the missing one unassigned.
  foundry.applications.api.DialogV2.input = async () => ({ actor0: "" });
  await editor._importFile({ text: async () => downloads[0].text });
  delete foundry.applications.api.DialogV2.input;
  const imported = state.overlays.at(-1);
  assert.equal(imported.name, "Dossier"); assert.equal(presets.list.length, 1, "The identical design is reused");
  assert.deepEqual(imported.layers.find(layer => layer.id === "card").actorUuids, ["Actor.known"]);
  assert(notes.some(note => /Actor.missing/.test(note) && /character/i.test(note)), "The dropped character is named");
  const fragment = exportFragment({ name: "Plate", layers: [createLayer("color")] });
  await editor._importFile({ text: async () => JSON.stringify(fragment) });
  assert.deepEqual(game.settings.get("modular-stream-overlay", FRAGMENTS_SETTING).map(entry => entry.name), ["Plate"]);
  await assert.rejects(editor._importFile({ text: async () => "{}" }), /not a Modular Stream Overlay/);
});

test("importing into a world that has the characters under other IDs asks which ones take their places", async () => {
  const { editor, state, presets, downloads, notes } = editorFixture();
  const preset = design();
  presets.list.push(preset);
  game.actors.contents.push({ uuid: "Actor.missing", name: "Klepto" });
  editor._loadDraft(overlayWithWidget(preset), 1);
  await editor._exportFile();
  // The other world: Known kept its ID, Klepto exists as a new Actor with the same name.
  game.actors.contents = [{ uuid: "Actor.known", name: "Known" }, { uuid: "Actor.copy", name: "Klepto" }, { uuid: "Actor.other", name: "Other" }];
  let asked = null;
  foundry.applications.api.DialogV2.input = async ({ content }) => {
    const select = content.children.find(child => child.tagName === "label").children.find(child => child.tagName === "select");
    asked = { name: select.name, chosen: select.children.find(option => option.selected)?.value, options: select.children.map(option => option.value) };
    return { [select.name]: select.children.find(option => option.selected).value };
  };
  editor._loadDraft(state.overlays[0], 1);
  await editor._importFile({ text: async () => downloads.at(-1).text });
  assert.deepEqual(asked, { name: "actor0", chosen: "Actor.copy", options: ["", "Actor.copy", "Actor.known", "Actor.other"] }, "Only the missing character is asked, same name preselected");
  assert.deepEqual(state.overlays.at(-1).layers.find(layer => layer.id === "card").actorUuids, ["Actor.known", "Actor.copy"]);
  assert.equal(notes.some(note => /not in this world/.test(note)), false);
  foundry.applications.api.DialogV2.input = async () => null;
  const before = state.overlays.length;
  await editor._importFile({ text: async () => downloads.at(-1).text });
  assert.equal(state.overlays.length, before, "Cancelling the choice imports nothing");
  delete foundry.applications.api.DialogV2.input;
});

test("an overlay moves to another server with its images, an SVG as a PNG; on its own server nothing is copied", async () => {
  const { editor, state, downloads, notes } = editorFixture();
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const DRAWN = new Uint8Array([...PNG, 7, 7]), SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const overlay = createOverlay("Scene");
  overlay.background.src = "worlds/old/paper.svg";
  overlay.layers.push(Object.assign(createLayer("image", overlay.canvas), { id: "logo", src: "worlds/old/logo.png" }),
    Object.assign(createLayer("image", overlay.canvas), { id: "clip", src: "worlds/old/clip.webm" }));
  const source = new Map([["worlds/old/paper.svg", SVG], ["worlds/old/logo.png", PNG], ["worlds/old/clip.webm", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]]);
  const boxes = [];
  const sourceIO = { readFile: async path => source.get(path) ?? null, exists: async path => source.has(path),
    rasterize: async (_bytes, box) => { boxes.push(box); return DRAWN; }, canStore: true, store: async () => assert.fail("Nothing is copied on its own server") };
  configureEditor({ assetIO: sourceIO });
  editor._loadDraft(overlay, 1);
  await editor._exportFile();
  const file = JSON.parse(downloads.at(-1).text);
  assert.deepEqual(file.assets.map(asset => [asset.path, asset.type, Boolean(asset.original)]), [["worlds/old/paper.svg", "image/png", true], ["worlds/old/logo.png", "image/png", false]]);
  assert.deepEqual(boxes, [{ width: 1920, height: 1080 }], "The SVG is drawn at the canvas it covers");
  assert(notes.some(note => /Scene saved to a file with 2 images/.test(note)));
  assert(notes.some(note => /not images the export can carry/.test(note) && note.includes("worlds/old/clip.webm")));
  // Back into the same server: every image is already there.
  editor._loadDraft(state.overlays[0], 1);
  await editor._importFile({ text: async () => downloads.at(-1).text });
  assert.deepEqual([state.overlays.at(-1).background.src, state.overlays.at(-1).layers.find(layer => layer.id === "logo").src], ["worlds/old/paper.svg", "worlds/old/logo.png"]);
  assert(notes.some(note => /0 saved to this module's storage, 2 already on this server/.test(note)));
  // Another server, where none of the files exist.
  const stored = [];
  configureEditor({ assetIO: { readFile: async () => null, exists: async () => false, canStore: true,
    store: async (bytes, extension) => { stored.push(bytes); return `modules/modular-stream-overlay/storage/image-${stored.length}.${extension}`; } } });
  editor._loadDraft(state.overlays[0], 1);
  await editor._importFile({ text: async () => downloads.at(-1).text });
  const imported = state.overlays.at(-1);
  assert.equal(imported.background.src, "modules/modular-stream-overlay/storage/image-1.png");
  assert.equal(imported.layers.find(layer => layer.id === "logo").src, "modules/modular-stream-overlay/storage/image-2.png");
  assert.equal(imported.layers.find(layer => layer.id === "clip").src, "worlds/old/clip.webm");
  assert.deepEqual(stored, [DRAWN, PNG]);
  assert(notes.some(note => /2 saved to this module's storage, 0 already/.test(note)));
  assert(notes.some(note => note.includes("neither in the file nor on this server: worlds/old/clip.webm")));
  configureEditor({ assetIO: undefined });
});

test("importing the same file with images twice on another server reuses the design it brought the first time", async () => {
  const { editor, state, presets, downloads } = editorFixture();
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const preset = design();
  preset.layers.push(Object.assign(createLayer("image", preset.canvas), { id: "frame", src: "worlds/old/frame.png" }));
  presets.list.push(preset);
  configureEditor({ assetIO: { readFile: async path => path === "worlds/old/frame.png" ? PNG : null } });
  editor._loadDraft(overlayWithWidget(preset, ["Actor.known"]), 1);
  await editor._exportFile();
  presets.list.length = 0;
  configureEditor({ assetIO: { readFile: async path => path.startsWith("modules/") ? PNG : null, exists: async () => false, canStore: true,
    store: async (_bytes, extension) => `modules/modular-stream-overlay/storage/image-frame.${extension}` } });
  for (let round = 0; round < 2; round++) {
    editor._loadDraft(state.overlays[0], 1);
    await editor._importFile({ text: async () => downloads.at(-1).text });
  }
  assert.equal(presets.list.length, 1, "The second import finds the design identical");
  assert.equal(presets.list[0].layers.find(layer => layer.id === "frame").src, "modules/modular-stream-overlay/storage/image-frame.png");
  configureEditor({ assetIO: undefined });
});
