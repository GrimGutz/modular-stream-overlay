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

test("undo and redo refresh the open window in place, so the canvas, focus and panels stay put", async () => {
  const editor = editorFixture();
  let renders = 0;
  editor.rendered = true;
  editor.render = async () => { renders++; };
  const layer = createLayer("text", editor._draft.canvas);
  for (let count = 1; count <= 3; count++) { editor._draft.layers.push({ ...layer, id: `layer-${count}` }); editor._markDirty(); editor._commitHistory(); }
  await editor._canvasCommand("undo"); await editor._canvasCommand("undo"); await editor._canvasCommand("undo");
  assert.equal(editor._draft.layers.length, 0, "Three Ctrl+Z steps undo three changes");
  await editor._canvasCommand("redo");
  assert.equal(editor._draft.layers.length, 1);
  assert.equal(renders, 0, "The window is never re-rendered");
});

function twoLayers(editor) {
  const first = createLayer("text", editor._draft.canvas), second = createLayer("color", editor._draft.canvas);
  Object.assign(first, { x: 10, y: 10, width: 100, height: 40, z: 1, name: "First" });
  Object.assign(second, { x: 300, y: 200, width: 50, height: 50, z: 2, name: "Second" });
  editor._draft.layers.push(first, second); editor._commitHistory();
  editor._selectLayers([first.id, second.id]);
  return [first, second];
}

test("several selected layers copy and paste together, keeping their spacing and order", async () => {
  const editor = editorFixture();
  const [first, second] = twoLayers(editor);
  assert.deepEqual(editor._selectedLayerIds, [first.id, second.id]); assert.equal(editor._selectedLayerId, second.id);
  await editor._canvasCommand("copy");
  await editor._canvasCommand("paste");
  const pasted = editor._draft.layers.slice(2);
  assert.deepEqual(pasted.map(layer => [layer.name, layer.x, layer.y]), [["First", 30, 30], ["Second", 320, 220]]);
  assert(pasted[0].z < pasted[1].z && pasted[0].z > second.z, "Pasted above everything in their own order");
  assert.deepEqual(editor._selectedLayerIds, pasted.map(layer => layer.id), "The pasted layers become the selection");
  await editor._canvasCommand("undo");
  assert.equal(editor._draft.layers.length, 2, "One undo step removes the whole paste");
});

test("clipboard text carries layers to another editor or world; other text becomes a text layer", async () => {
  const source = editorFixture();
  twoLayers(source);
  const text = source._copySelection();
  assert.match(text, /"format":"modular-stream-overlay\/layers"/);
  const target = editorFixture();
  await target._canvasCommand("paste", { text });
  assert.deepEqual(target._draft.layers.map(layer => [layer.name, layer.x]), [["First", 10], ["Second", 300]], "Another overlay keeps the positions");
  await target._canvasCommand("paste", { text: "  ПОЗЫВНОЙ\nSecond line" });
  const note = target._draft.layers.at(-1);
  assert.deepEqual([note.type, note.name, note.text], ["text", "ПОЗЫВНОЙ", "  ПОЗЫВНОЙ\nSecond line"]);
  await target._canvasCommand("paste", { text: '{"format":"modular-stream-overlay/layers","version":1,"layers":[{"type":"text","x":"bad"}]}' }).then(
    () => assert.fail("Invalid clipboard layers are rejected"), error => assert.match(error.message, /X|number|position/i));
  const widget = { ...createLayer("text", target._draft.canvas), type: "character-widget", presetId: "design-elsewhere" };
  await assert.rejects(target._canvasCommand("paste", { text: JSON.stringify({ format: "modular-stream-overlay/layers", version: 1, layers: [widget] }) }), /design/);
});

test("delete, duplicate and stacking apply to every selected layer, and locked layers stay", async () => {
  const editor = editorFixture();
  const [first, second] = twoLayers(editor);
  await editor._canvasCommand("duplicate");
  assert.equal(editor._draft.layers.length, 4);
  assert.deepEqual(editor._selectedLayers().map(layer => layer.name), ["First copy", "Second copy"]);
  editor._selectLayers([first.id, second.id]);
  await editor._canvasCommand("back");
  assert(first.z < second.z && second.z < Math.min(...editor._draft.layers.slice(2).map(layer => layer.z)), "Sent back together, still in order");
  second.locked = true; editor._commitHistory();
  await editor._canvasCommand("delete");
  assert.deepEqual(editor._draft.layers.map(layer => layer.name), ["Second", "First copy", "Second copy"]);
  assert.deepEqual(editor._selectedLayerIds, [second.id], "The locked layer stays selected");
  await editor._canvasCommand("undo");
  assert.equal(editor._draft.layers.length, 4, "One undo brings the deleted layers back");
});

test("align and distribute move the selected layers; one layer aligns to the canvas", async () => {
  const editor = editorFixture();
  const [first, second] = twoLayers(editor);
  await editor._arrange("top");
  assert.deepEqual([first.y, second.y], [10, 10]);
  const third = createLayer("color", editor._draft.canvas); Object.assign(third, { x: 100, y: 10, width: 20, height: 20, z: 3 });
  editor._draft.layers.push(third); editor._selectLayers([first.id, second.id, third.id]);
  await editor._arrange("distribute-x");
  assert.deepEqual([first.x, third.x, second.x], [10, 195, 300], "Equal 85 px gaps between 10..350");
  second.locked = true;
  await editor._arrange("left");
  assert.deepEqual([first.x, third.x, second.x], [10, 10, 300], "A locked layer counts for the bounds but stays");
  editor._selectLayers([third.id]);
  await editor._arrange("center"); await editor._arrange("bottom");
  assert.deepEqual([third.x, third.y], [950, 1060], "One layer aligns to the 1920 × 1080 canvas");
  await editor._canvasCommand("undo");
  assert.deepEqual(Object.values((({ x, y }) => ({ x, y }))(editor._draft.layers.find(layer => layer.id === third.id))), [950, 10], "Each arrangement is one undo step");
});
