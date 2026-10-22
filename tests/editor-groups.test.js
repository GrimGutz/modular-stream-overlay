import test from "node:test";
import assert from "node:assert/strict";
import { createOverlay, createState } from "../scripts/core/schema.js";
import { createLayer, layerOrder } from "../scripts/core/layers.js";

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

function editorFixture(services = {}) {
  const state = { ...createState(), revision: 1, overlays: [createOverlay("Draft")] };
  const store = { getState: () => structuredClone(state), listPresets: () => [] };
  const notes = [];
  globalThis.game = { user: { isGM: true }, modules: new Map([["modular-stream-overlay", { api: { store } }]]), users: [] };
  globalThis.ui = { notifications: { info: message => notes.push(message), warn() {}, error() {} } };
  configureEditor({ store, ...services });
  const editor = new OverlayEditor();
  editor.element = { querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, removeAttribute() {} };
  editor._updatePreview = async () => {};
  editor._loadDraft(state.overlays[0], 1);
  for (const [index, name] of ["Back", "Middle", "Front"].entries()) {
    editor._draft.layers.push(Object.assign(createLayer("text", editor._draft.canvas), { id: name.toLowerCase(), name, x: index * 100, z: index }));
  }
  editor._commitHistory();
  return { editor, notes };
}
const order = editor => layerOrder(editor._draft).map(layer => layer.id);
const layer = (editor, id) => editor._draft.layers.find(entry => entry.id === id);

test("Ctrl+G groups the selection, the group hides and locks together, and Ctrl+Shift+G ungroups", async () => {
  const { editor, notes } = editorFixture();
  editor._selectLayers(["back"]);
  await editor._canvasCommand("group");
  assert.match(notes.at(-1), /two/, "One layer cannot be grouped");
  editor._selectLayers(["back", "front"]);
  await editor._canvasCommand("group");
  const groupId = layer(editor, "front").groupId;
  assert.equal(layer(editor, "back").groupId, groupId); assert.equal(layer(editor, "front").groupName, "Group 1");
  assert.deepEqual(order(editor), ["front", "back", "middle"], "Members form one block");
  await editor._groupCommand(groupId, "visible");
  assert.deepEqual(["front", "back"].map(id => layer(editor, id).visible), [false, false]);
  await editor._groupCommand(groupId, "locked");
  assert.deepEqual(["front", "back"].map(id => layer(editor, id).locked), [true, true]);
  assert.equal(await editor._renameGroup(groupId, "  Header  "), true);
  assert.equal(layer(editor, "back").groupName, "Header");
  assert.equal(await editor._renameGroup(groupId, " "), false);
  editor._selectLayers(["front"]);
  await editor._canvasCommand("ungroup");
  assert(editor._draft.layers.every(entry => !entry.groupId));
  await editor._canvasCommand("undo");
  assert.equal(layer(editor, "front").groupId, groupId, "Ungrouping is one undo step");
});

test("grouped layers duplicate into their group or into a new group, and restack inside their group", async () => {
  const { editor } = editorFixture();
  editor._selectLayers(["back", "middle"]);
  await editor._canvasCommand("group");
  const groupId = layer(editor, "back").groupId;
  editor._selectLayers(["back"]);
  await editor._canvasCommand("duplicate");
  const copy = editor._draft.layers.at(-1);
  assert.equal(copy.groupId, groupId);
  assert.deepEqual(order(editor), ["front", "middle", copy.id, "back"], "The copy sits just above its original, inside the group");
  editor._selectLayers(["back"]);
  await editor._layerCommand("front");
  assert.deepEqual(order(editor), ["front", "back", "middle", copy.id], "Front means the front of its group");
  editor._selectLayers(["back", "middle", copy.id]);
  await editor._canvasCommand("duplicate");
  const copies = editor._draft.layers.slice(-3);
  assert.equal(new Set(copies.map(entry => entry.groupId)).size, 1);
  assert.notEqual(copies[0].groupId, groupId, "A copied group is a new group");
  assert.equal(order(editor).indexOf("front"), 3, "Copies go on top");
  editor._selectLayers(["front"]);
  await editor._layerCommand("down");
  assert.equal(order(editor).indexOf("front"), 6, "An ungrouped layer steps over a whole group of three");
});

test("dropping rows in the Layers list restacks and moves layers into or out of groups", async () => {
  const { editor } = editorFixture();
  editor._selectLayers(["back", "middle"]);
  await editor._canvasCommand("group");
  const groupId = layer(editor, "middle").groupId;
  await editor._dropInList({ ids: ["front"], groupId: null }, { layerId: "back", after: true });
  assert.deepEqual(order(editor), ["middle", "back", "front"]); assert.equal(layer(editor, "front").groupId, groupId, "Dropped on a member, it joins");
  await editor._dropInList({ ids: ["front"], groupId: null }, { groupId, after: false });
  assert.deepEqual(order(editor), ["front", "middle", "back"]); assert.equal(layer(editor, "front").groupId, undefined, "Above the group's row, it leaves");
  await editor._dropInList({ ids: ["middle", "back"], groupId }, { layerId: "front", after: false });
  assert.deepEqual(order(editor), ["middle", "back", "front"]); assert.equal(layer(editor, "back").groupId, groupId, "A dragged group stays whole");
  await editor._dropInList({ ids: ["front"], groupId: null }, { layerId: "front", after: true });
  assert.deepEqual(order(editor), ["middle", "back", "front"], "Dropping a row on itself changes nothing");
});

test("shared properties change every selected layer that has them, and invalid values change none", async () => {
  const { editor } = editorFixture();
  const color = Object.assign(createLayer("color", editor._draft.canvas), { id: "fill", color: "#000000", z: 5 });
  editor._draft.layers.push(color);
  const layers = ["back", "front", "fill"].map(id => layer(editor, id));
  const input = (value, type = "text") => ({ type, value, checked: value === true, setCustomValidity(message) { this.message = message; } });
  editor._onSharedInput(input("0.5"), layers, "opacity");
  assert.deepEqual(layers.map(entry => entry.opacity), [0.5, 0.5, 0.5]);
  editor._onSharedInput(input("Signika"), layers.slice(0, 2), "fontFamily");
  assert.deepEqual(layers.map(entry => entry.fontFamily), ["Signika", "Signika", undefined]);
  const bad = input("red");
  editor._onSharedInput(bad, layers, "color");
  assert.match(bad.message, /color/i); assert.equal(color.color, "#000000");
  editor._onSharedInput(input(true, "checkbox"), layers, "locked");
  assert(layers.every(entry => entry.locked));
  assert.equal(editor._dirty, true);
});

test("pasted or dropped images upload and become image layers scaled to the canvas", async () => {
  const uploads = [];
  const { editor, notes } = editorFixture({ uploadBackground: async file => { uploads.push(file.name); return `modules/modular-stream-overlay/storage/${file.name}`; } });
  globalThis.createImageBitmap = async file => ({ width: file.name.startsWith("wide") ? 3840 : 300, height: file.name.startsWith("wide") ? 1080 : 200, close() {} });
  const files = [{ name: "wide-screenshot.png", type: "image/png" }, { name: "notes.txt", type: "text/plain" }, { name: "logo.webp", type: "image/webp" }];
  await editor._canvasCommand("paste", { text: "", files });
  assert.deepEqual(uploads, ["wide-screenshot.png", "logo.webp"], "Only images are uploaded");
  const [wide, logo] = editor._draft.layers.slice(-2);
  assert.deepEqual([wide.type, wide.name, wide.src, wide.width, wide.height, wide.lockAspectRatio], ["image", "wide-screenshot", "modules/modular-stream-overlay/storage/wide-screenshot.png", 1728, 486, true]);
  assert.deepEqual([wide.x, wide.y], [96, 297], "Centered on the canvas");
  assert.deepEqual([logo.width, logo.height, logo.x, logo.y], [300, 200, 830, 460], "Small images keep their size, offset from the previous one");
  assert.deepEqual(editor._selectedLayerIds, [wide.id, logo.id]);
  assert.match(notes.at(-1), /2/);
  editor._preview = { nativeAt: () => ({ x: 100, y: 100 }), setSelection() {} };
  await editor._dropImages({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0, dataTransfer: { files: [{ name: "logo.png", type: "image/png" }] } });
  assert.deepEqual([editor._draft.layers.at(-1).x, editor._draft.layers.at(-1).y], [-50, 0], "Dropped where the pointer is");
  await editor._canvasCommand("undo");
  assert.equal(editor._draft.layers.filter(entry => entry.type === "image").length, 2, "Each paste or drop is one undo step");
  delete globalThis.createImageBitmap;
});
