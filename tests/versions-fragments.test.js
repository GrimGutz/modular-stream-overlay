import test from "node:test";
import assert from "node:assert/strict";
import { createOverlay, createState } from "../scripts/core/schema.js";
import { createLayer } from "../scripts/core/layers.js";
import { VersionStore } from "../scripts/core/saved-versions.js";
import { listFragments, saveFragment, deleteFragment, renameFragment, FRAGMENTS_SETTING } from "../scripts/core/fragments.js";

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

function memorySettings(values = {}) {
  const store = new Map(Object.entries(values));
  return { get: (scope, key) => store.get(`${scope}.${key}`), set: async (scope, key, value) => { store.set(`${scope}.${key}`, structuredClone(value)); return value; } };
}

function editorFixture() {
  const overlay = createOverlay("Draft");
  overlay.layers.push(Object.assign(createLayer("text", overlay.canvas), { id: "title", name: "Title", z: 0 }));
  const state = { ...createState(), revision: 1, overlays: [overlay] };
  const store = {
    getState: () => structuredClone(state), listPresets: () => [],
    saveOverlay: async (input, { expectedRevision }) => {
      assert.equal(expectedRevision, state.revision);
      state.overlays = [structuredClone(input)]; state.revision++;
      return structuredClone(input);
    }
  };
  const settings = memorySettings();
  globalThis.game = { user: { isGM: true }, world: { id: "test-world" }, settings, i18n: { lang: "en" },
    modules: new Map([["modular-stream-overlay", { api: { store } }]]), users: [] };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  const versions = new VersionStore({ indexedDB: null, now: (() => { let time = 1000; return () => (time += 1000); })() });
  configureEditor({ store, versions });
  const editor = new OverlayEditor();
  editor.element = { querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, removeAttribute() {} };
  editor._updatePreview = async () => {};
  editor._validateInputs = () => {};
  editor._loadDraft(state.overlays[0], 1);
  return { editor, state, versions, settings };
}
const title = editor => editor._draft.layers.find(layer => layer.id === "title");

test("the version store keeps the newest versions per document and skips repeats", async () => {
  const store = new VersionStore({ indexedDB: null, limit: 3, now: (() => { let time = 0; return () => ++time; })() });
  for (const name of ["a", "a", "b", "c", "d"]) await store.add("world/overlay/x", { name });
  await store.add("world/overlay/y", { name: "other" });
  assert.deepEqual((await store.list("world/overlay/x")).map(entry => entry.document.name), ["d", "c", "b"]);
  assert.equal((await store.list("world/overlay/y")).length, 1);
});

test("every save keeps a version, the first save also keeps the one before, and restoring is one undoable change", async () => {
  const { editor, versions } = editorFixture();
  title(editor).text = "Second"; editor._markDirty();
  await editor._saveOverlay();
  title(editor).text = "Third"; editor._markDirty();
  await editor._saveOverlay();
  const saved = await versions.list("test-world/overlay/" + editor._draft.id);
  assert.deepEqual(saved.map(entry => entry.document.layers[0].text), ["Third", "Second", "New text"]);
  assert.equal(editor._dirty, false);
  await editor._restoreVersion(saved[2]);
  assert.equal(title(editor).text, "New text"); assert.equal(editor._dirty, true, "Restored as unsaved changes");
  await editor._canvasCommand("undo");
  assert.equal(title(editor).text, "Third"); assert.equal(editor._dirty, false, "Undo goes back to the saved version");
});

test("the fragment library validates, renames and deletes saved layers", async () => {
  const settings = memorySettings();
  const plate = [Object.assign(createLayer("color"), { id: "a", groupId: "group-1", groupName: "Plate" }), Object.assign(createLayer("text"), { id: "b", groupId: "group-1", groupName: "Plate" })];
  const fragment = await saveFragment(" Plate ", plate, settings);
  assert.equal(fragment.name, "Plate"); assert.equal(fragment.layers.length, 2);
  await assert.rejects(saveFragment("", plate, settings), /name/);
  await assert.rejects(saveFragment("Empty", [], settings), /layers/);
  await renameFragment(fragment.id, "Character plate", settings);
  assert.deepEqual(listFragments(settings).map(entry => entry.name), ["Character plate"]);
  const broken = memorySettings({ [`modular-stream-overlay.${FRAGMENTS_SETTING}`]: [{ id: "bad id", name: "x", layers: [] }, fragment] });
  assert.equal(listFragments(broken).length, 1, "An unreadable entry is skipped");
  await deleteFragment(fragment.id, settings);
  assert.deepEqual(listFragments(settings), []);
});

test("a saved fragment inserts into a draft as a new group, as one undo step", async () => {
  const { editor } = editorFixture();
  const plate = [Object.assign(createLayer("color", editor._draft.canvas), { id: "plate", name: "Plate", z: 1 }), Object.assign(createLayer("text", editor._draft.canvas), { id: "label", name: "Label", z: 2 })];
  editor._draft.layers.push(...plate); editor._commitHistory();
  editor._selectLayers(["plate", "label"]);
  await editor._canvasCommand("group");
  editor._name = async () => "Character plate";
  await editor._saveFragment();
  const [fragment] = listFragments();
  assert.equal(fragment.name, "Character plate");
  await editor._insertFragment(fragment.id);
  const inserted = editor._draft.layers.slice(-2);
  assert.deepEqual(inserted.map(layer => layer.name), ["Plate", "Label"]);
  assert(inserted[0].groupId && inserted[0].groupId === inserted[1].groupId && inserted[0].groupId !== editor._draft.layers.find(layer => layer.id === "plate").groupId, "A new group");
  assert.deepEqual(editor._selectedLayerIds, inserted.map(layer => layer.id));
  await editor._canvasCommand("undo");
  assert.equal(editor._draft.layers.length, 3);
});

test("layers rename by name and the list filters by layer or group name", async () => {
  const { editor } = editorFixture();
  assert.equal(await editor._renameLayer("title", "  Callsign  "), true);
  assert.equal(title(editor).name, "Callsign");
  assert.equal(await editor._renameLayer("title", ""), false);
  await editor._canvasCommand("undo");
  assert.equal(title(editor).name, "Title");
  const rows = [];
  const list = { replaceChildren() { rows.length = 0; }, append(...nodes) { rows.push(...nodes); } };
  const count = { textContent: "" };
  editor.element = { querySelector: selector => selector === "[data-layer-list]" ? list : selector === "[data-layer-count]" ? count : null, querySelectorAll: () => [] };
  globalThis.document = { createElement: () => ({ dataset: {}, style: {}, classList: { add() {}, toggle() {}, remove() {} }, append() {}, addEventListener() {}, setAttribute() {}, getAttribute() {}, removeAttribute() {} }) };
  editor._draft.layers.push(Object.assign(createLayer("color", editor._draft.canvas), { id: "plate", name: "Plate", z: 1 }));
  editor._layerFilter = "pla";
  editor._renderLayerList();
  assert.deepEqual(rows.map(row => row.dataset.layerId), ["plate"]);
  assert.equal(count.textContent, "1/2");
  editor._layerFilter = "zzz";
  editor._renderLayerList();
  assert.equal(rows.length, 1, "A message instead of rows"); assert.equal(rows[0].dataset.layerId, undefined);
  delete globalThis.document;
});
