import test from "node:test";
import assert from "node:assert/strict";
import { createOverlay, createState } from "../scripts/core/schema.js";
import { createLayer, pasteLayer } from "../scripts/core/layers.js";
import { shortcutCommand } from "../scripts/editor/geometry.js";

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

const key = (values = {}) => ({ key: "c", code: "KeyC", ctrlKey: true, target: { closest: () => null }, ...values });

test("editing shortcuts follow physical keys, so a Russian layout works, and leave text fields alone", () => {
  assert.deepEqual(shortcutCommand(key()), { action: "copy" });
  assert.deepEqual(shortcutCommand(key({ key: "с" })), { action: "copy" }, "Cyrillic с on the C key still copies");
  assert.deepEqual(shortcutCommand(key({ key: "ч", code: "KeyX" })), { action: "cut" });
  assert.deepEqual(shortcutCommand(key({ key: "м", code: "KeyV", ctrlKey: false, metaKey: true })), { action: "paste" });
  assert.deepEqual(shortcutCommand(key({ key: "я", code: "KeyZ" })), { action: "undo" });
  assert.deepEqual(shortcutCommand(key({ key: "Я", code: "KeyZ", shiftKey: true })), { action: "redo" });
  assert.deepEqual(shortcutCommand(key({ key: "н", code: "KeyY" })), { action: "redo" });
  assert.deepEqual(shortcutCommand(key({ key: "в", code: "KeyD" })), { action: "duplicate" });
  assert.equal(shortcutCommand(key({ code: "KeyS" })), null);
  assert.equal(shortcutCommand(key({ target: { closest: () => ({}) } })), null, "Inputs keep their own undo and clipboard");
});

test("pasted layers get a fresh ID, go on top and fan out instead of stacking", () => {
  const overlay = createOverlay();
  const source = createLayer("text", overlay.canvas); Object.assign(source, { x: 100, y: 50, z: 3, name: "Title" });
  overlay.layers.push(source);
  const first = pasteLayer(overlay, source), second = pasteLayer(overlay, source);
  assert.notEqual(first.id, source.id); assert.equal(first.name, "Title");
  assert.deepEqual([first.x, first.y, first.z], [120, 70, 4]);
  assert.deepEqual([second.x, second.y, second.z], [140, 90, 5]);
  const elsewhere = pasteLayer(createOverlay(), source);
  assert.deepEqual([elsewhere.x, elsewhere.y], [100, 50], "Pasted into another overlay it keeps its position");
});

function editorFixture() {
  const state = { ...createState(), revision: 1, overlays: [createOverlay("Draft")] };
  const store = { getState: () => structuredClone(state), listPresets: () => [] };
  globalThis.game = { user: { isGM: true }, modules: new Map([["modular-stream-overlay", { api: { store } }]]), users: [] };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  configureEditor({ store });
  const editor = new OverlayEditor();
  editor.element = { querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, removeAttribute() {} };
  editor._updatePreview = async () => {};
  editor._selectLayer = id => { editor._selectedLayerId = id; };
  editor._loadDraft(state.overlays[0], 1);
  return editor;
}

test("copy, cut and paste work on the selected layer and undo/redo step through every change", async () => {
  const editor = editorFixture();
  const layer = createLayer("text", editor._draft.canvas); layer.x = 10; layer.y = 10;
  editor._draft.layers.push(layer); editor._markDirty(); editor._selectedLayerId = layer.id;
  await editor._canvasCommand("copy");
  await editor._canvasCommand("paste");
  assert.equal(editor._draft.layers.length, 2);
  const pasted = editor._draft.layers[1];
  assert.equal(editor._selectedLayerId, pasted.id); assert.deepEqual([pasted.x, pasted.y], [30, 30]);
  await editor._canvasCommand("cut");
  assert.deepEqual(editor._draft.layers.map(entry => entry.id), [layer.id], "Cut removes the selected layer");
  await editor._canvasCommand("undo");
  assert.equal(editor._draft.layers.length, 2, "Undo brings the cut layer back");
  await editor._canvasCommand("undo");
  assert.equal(editor._draft.layers.length, 1, "Undo removes the paste");
  await editor._canvasCommand("undo");
  assert.equal(editor._draft.layers.length, 0); assert.equal(editor._dirty, false, "Back at the loaded version");
  await editor._canvasCommand("undo");
  assert.equal(editor._draft.layers.length, 0, "Nothing earlier to undo");
  await editor._canvasCommand("redo"); await editor._canvasCommand("redo");
  assert.equal(editor._draft.layers.length, 2); assert.equal(editor._dirty, true);
  layer.x = 999; editor._draft.layers[0].x = 500; editor._markDirty();
  await editor._canvasCommand("redo");
  assert.equal(editor._draft.layers.length, 2, "A new edit clears the redo steps");
  await editor._canvasCommand("undo");
  assert.equal(editor._draft.layers[0].x, 10);
});

test("pasting refuses layers the target editor cannot hold", async () => {
  const editor = editorFixture();
  const component = createLayer("character-name", editor._draft.canvas);
  editor._draft.layers.push(component); editor._selectedLayerId = component.id;
  await editor._canvasCommand("copy");
  await assert.rejects(editor._canvasCommand("paste"), /cannot be pasted/);
});

test("undo keeps only the last 100 steps", async () => {
  const editor = editorFixture();
  const layer = createLayer("text", editor._draft.canvas);
  editor._draft.layers.push(layer); editor._selectedLayerId = layer.id;
  editor._commitHistory();
  for (let step = 1; step <= 105; step++) { layer.x = step; editor._markDirty(); editor._commitHistory(); }
  let undone = 0;
  while (editor._history.undo.length) { await editor._canvasCommand("undo"); undone++; }
  assert.equal(undone, 100);
  assert.equal(editor._draft.layers[0].x, 5, "The oldest steps beyond 100 are dropped");
});

test("several undo steps in a row keep the keyboard focus on the canvas after each re-render", async () => {
  const editor = editorFixture();
  const focused = [];
  editor.rendered = true;
  editor.render = async () => { editor._previewElement = { focus: () => focused.push(editor._draft.layers.length) }; };
  const layer = createLayer("text", editor._draft.canvas);
  for (let count = 1; count <= 3; count++) { editor._draft.layers.push({ ...layer, id: `layer-${count}` }); editor._markDirty(); editor._commitHistory(); }
  await editor._canvasCommand("undo"); await editor._canvasCommand("undo"); await editor._canvasCommand("undo");
  assert.equal(editor._draft.layers.length, 0, "Three Ctrl+Z steps undo three changes");
  assert.deepEqual(focused, [2, 1, 0], "Focus returns to the canvas after every step");
});
