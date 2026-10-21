import test from "node:test";
import assert from "node:assert/strict";
import { createOverlay, createState } from "../scripts/core/schema.js";
import { createLayer } from "../scripts/core/layers.js";
import { createWidgetPreset } from "../scripts/core/widget-presets.js";

// Only the public ApplicationV2 lifecycle surface used by the editor is stubbed.
// These tests run in plain Node without Foundry, a browser, or installed packages.
class ApplicationStub {
  constructor() { this.rendered = false; this.renderCount = 0; }
  _canRender() { return undefined; }
  async _prepareContext() { return {}; }
  async _onRender() {}
  async render() { this.renderCount += 1; return this; }
  async close() { this.rendered = false; return this; }
}
globalThis.foundry = {
  applications: { api: { ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: base => base, DialogV2: {} } },
  utils: { deepClone: structuredClone, getRoute: path => `/foundry/${path}` }
};
const { OverlayEditor, configureEditor, refreshEditors } = await import("../scripts/ui/editor.js");

function fixture() {
  const state = { ...createState(), revision: 5, overlays: [createOverlay("Saved overlay")] };
  state.activeOverlayId = state.overlays[0].id;
  let corrupt = false;
  const notices = { warn: [], info: [], error: [] };
  const store = {
    getState() { if (corrupt) throw new Error("Saved state is corrupt"); return structuredClone(state); },
    listPresets: () => [{ id: "builtin-transparent", name: "Empty", builtin: true, overlay: state.overlays[0] }]
  };
  const api = { store, getViewerUserId: () => "viewer", getOBSUrl: () => "http://localhost/stream?mso=1" };
  globalThis.game = {
    user: { isGM: true },
    modules: new Map([["modular-stream-overlay", { api }]]),
    users: [
      { id: "viewer", name: "OBS", role: 1, isGM: false },
      { id: "other-player", name: "Player", role: 1, isGM: false },
      { id: "trusted", name: "Trusted", role: 2, isGM: false },
      { id: "assistant", name: "Assistant GM", role: 3, isGM: false },
      { id: "gm", name: "GM", role: 4, isGM: true },
      { id: "bad-role", name: "Inconsistent GM", role: 1, isGM: true }
    ]
  };
  globalThis.ui = { notifications: Object.fromEntries(Object.keys(notices).map(key => [key, message => notices[key].push(message)])) };
  configureEditor({ store, uploadBackground: undefined });
  const editor = new OverlayEditor();
  editor.element = { querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, removeAttribute() {} };
  return { state, store, editor, notices, corruptState: () => { corrupt = true; } };
}

test("editor keeps dirty drafts and their original revision after an external update", async () => {
  const { state, editor } = fixture();
  await editor._prepareContext({});
  editor._draft.background.opacity = 0.35;
  editor._dirty = true;
  editor.rendered = true;
  state.revision += 1;
  state.overlays[0].name = "Changed remotely";
  await editor.refresh({ external: true });
  assert.equal(editor._draft.name, "Saved overlay");
  assert.equal(editor._draft.background.opacity, 0.35);
  assert.equal(editor._loadedRevision, 5);
  assert.equal(editor._conflict, true);
  assert.equal(editor.renderCount, 1);
});

test("preset and active mutations cannot bypass a stale overlay draft revision", async () => {
  const { state, editor } = fixture();
  await editor._prepareContext({});
  editor._dirty = true;
  state.revision += 1;
  const result = await editor._sideMutation(async options => {
    assert.deepEqual(options, { expectedRevision: 6 });
    state.revision += 1;
    return "preset result";
  });
  assert.equal(result, "preset result");
  assert.equal(editor._loadedRevision, 5);
  assert.equal(editor._conflict, true);
});

test("own unrelated mutations advance a current draft baseline exactly once", async () => {
  const { state, editor } = fixture();
  await editor._prepareContext({});
  editor._dirty = true;
  await editor._sideMutation(async options => {
    assert.equal(options.expectedRevision, 5);
    state.revision += 1;
  });
  assert.equal(editor._loadedRevision, 6);
  assert.equal(editor._conflict, false);
  await editor._sideMutation(async () => { state.revision += 2; });
  assert.equal(editor._loadedRevision, 6, "Concurrent changes cannot be absorbed into a safe baseline");
  assert.equal(editor._conflict, true);
});

test("viewer choices include every account that can log in, labelled with its role", async () => {
  const { editor } = fixture();
  game.users.push({ id: "no-role", name: "Disabled", role: 0, isGM: false });
  const context = await editor._prepareContext({});
  assert.deepEqual(context.viewerUsers.map(user => user.id), ["viewer", "other-player", "trusted", "assistant", "gm", "bad-role"]);
  assert(context.viewerUsers.every(user => typeof user.role === "string" && user.role));
  assert.equal(context.viewerUsers[0].selected, true);
  assert.equal(context.viewerUsers[1].selected, false);
});

test("editor render guard permits GMs and rejects other or absent users", () => {
  const { editor, notices } = fixture();
  assert.notEqual(editor._canRender({}), false);
  game.user = { isGM: false };
  assert.equal(editor._canRender({}), false);
  game.user = null;
  assert.equal(editor._canRender({}), false);
  assert.equal(notices.warn.length, 2);
});

test("operation error recovery preserves a draft when persistent state becomes unreadable", async t => {
  const { editor, notices, corruptState } = fixture();
  await editor._prepareContext({});
  editor._draft.background.opacity = 0.2;
  editor._dirty = true;
  editor.rendered = true;
  t.mock.method(console, "error", () => {});
  corruptState();
  await assert.doesNotReject(editor._perform(async () => { throw new Error("Save failed"); }));
  assert.equal(editor._draft.background.opacity, 0.2);
  assert.equal(editor._loadedRevision, 5);
  assert.equal(editor._busy, false);
  assert.equal(editor._conflict, true);
  assert.equal(editor.renderCount, 0);
  assert.deepEqual(notices.error, ["Save failed"]);
  editor._dirty = false;
  await assert.doesNotReject(editor.close());
});

test("re-render failures are reported without rejecting the click action", async t => {
  const { editor, notices } = fixture();
  await editor._prepareContext({});
  editor.rendered = true;
  editor.render = async () => { throw new Error("Template failed"); };
  t.mock.method(console, "error", () => {});
  await assert.doesNotReject(editor._perform(async () => {}));
  assert.equal(editor._busy, false);
  assert.deepEqual(notices.error, ["Template failed"]);
});

test("invalid canvas text survives re-render while preview retains its last valid dimensions", async () => {
  const { editor } = fixture();
  await editor._prepareContext({});
  const input = {
    dataset: { draftField: "canvas.width" }, value: "9", validityMessage: "",
    setCustomValidity(message) { this.validityMessage = message; }, addEventListener() {}
  };
  editor._onDraftInput({ currentTarget: input });
  assert.equal(editor._draft.canvas.width, 1920);
  assert.equal(editor._invalidInputs.get("canvas.width"), "9");
  input.value = "1920"; // Simulate the template's replacement field.
  editor.element.querySelectorAll = () => [input];
  await editor._onRender({}, {});
  assert.equal(input.value, "9");
  assert.match(input.validityMessage, /64 to 7680/);
  input.value = "1280";
  editor._onDraftInput({ currentTarget: input });
  assert.equal(editor._draft.canvas.width, 1280);
  assert.equal(editor._invalidInputs.size, 0);
  editor._dirty = false;
  await editor.close();
});

test("refreshEditors includes directly constructed Settings-menu applications", async () => {
  const { editor } = fixture();
  await editor._prepareContext({});
  editor.rendered = true;
  await editor._onRender({}, {});
  await refreshEditors({ external: true });
  assert.equal(editor.renderCount, 1);
  await editor.close();
  await refreshEditors({ external: true });
  assert.equal(editor.renderCount, 1, "Closed applications are unregistered");
});

function backgroundControls(editor) {
  const field = {
    value: editor._draft?.background.src ?? "", disabled: false,
    dataset: { draftField: "background.src" }, checkValidity: () => true,
    addEventListener() {}, setCustomValidity() {}
  };
  const image = { hidden: true, removeAttribute(name) { delete this[name]; } };
  const imageStatus = { textContent: "", hidden: false };
  const path = { textContent: "" };
  const progress = { textContent: "", hidden: true };
  const listeners = {};
  const fileInput = {
    files: [], value: "", disabled: false, clicks: 0,
    click() { this.clicks += 1; },
    addEventListener(event, callback) { listeners[event] = callback; }
  };
  const save = { disabled: !editor._dirty, removeAttribute() { this.disabled = false; } };
  const preset = { disabled: false };
  const browse = { disabled: false };
  const remove = { disabled: false };
  const elements = {
    '[data-draft-field="background.src"]': field,
    "[data-background-upload]": fileInput,
    "[data-background-thumbnail]": image,
    "[data-background-thumbnail-status]": imageStatus,
    "[data-background-path]": path,
    "[data-upload-status]": progress,
    '[data-action="saveOverlay"]': save,
    "[data-save-status]": { textContent: "" }
  };
  const controls = [fileInput, field, save, preset, browse, remove];
  editor.element = {
    querySelector: selector => elements[selector] ?? null,
    querySelectorAll: selector => selector === "[data-draft-field]" || selector === "[data-draft-field], [data-layer-field]" ? [field] : controls,
    setAttribute() {}, removeAttribute() {}
  };
  const previews = [];
  editor._preview = { async render(overlay) { previews.push(structuredClone(overlay)); }, destroy() {} };
  return { field, image, imageStatus, path, progress, fileInput, controls, listeners, previews, save };
}

test("uploaded images update draft, thumbnail and live preview without publishing until Save", async () => {
  const { editor, state, store, notices } = fixture();
  state.overlays[0].background.src = "worlds/test/previous.webp";
  await editor._prepareContext({});
  editor.rendered = true;
  const dom = backgroundControls(editor);
  const file = { name: "New image.png" };
  const uploadedPath = "modules/modular-stream-overlay/storage/background-test.png";
  configureEditor({ uploadBackground: async selected => { assert.equal(selected, file); return uploadedPath; } });
  let saves = 0;
  store.saveOverlay = async (overlay, options) => {
    assert.equal(options.expectedRevision, state.revision);
    saves += 1;
    state.overlays[0] = structuredClone(overlay);
    state.revision += 1;
    return overlay;
  };
  await editor._perform(() => editor._uploadBackgroundFile(file));
  assert.equal(editor._draft.background.src, uploadedPath);
  assert.equal(editor._dirty, true);
  assert.equal(state.overlays[0].background.src, "worlds/test/previous.webp");
  assert.equal(saves, 0);
  assert.equal(dom.field.value, uploadedPath);
  assert.equal(dom.path.textContent, uploadedPath);
  assert.equal(dom.image.src, `/foundry/${uploadedPath}`);
  dom.image.onload();
  assert.equal(dom.image.hidden, false);
  assert.equal(dom.imageStatus.hidden, true);
  assert.equal(dom.previews.at(-1).background.src, uploadedPath);
  assert.equal(editor._uploading, false);
  assert.equal(dom.progress.hidden, true);
  assert.equal(dom.save.disabled, false);
  assert.match(notices.info.at(-1), /Save overlay/);
  await editor._saveOverlay();
  assert.equal(saves, 1);
  assert.equal(state.overlays[0].background.src, uploadedPath);
  assert.equal(editor._dirty, false);
  await editor.close();
});

test("failed background uploads preserve prior image, edits and persisted settings", async t => {
  const { editor, state, notices } = fixture();
  state.overlays[0].background.src = "worlds/test/previous.webp";
  await editor._prepareContext({});
  editor.rendered = true;
  editor._draft.background.opacity = 0.65;
  editor._dirty = true;
  const dom = backgroundControls(editor);
  const before = structuredClone(state);
  configureEditor({ uploadBackground: async () => { throw new Error("Upload permission denied"); } });
  t.mock.method(console, "error", () => {});
  await assert.doesNotReject(editor._perform(() => editor._uploadBackgroundFile({ name: "image.webp" })));
  assert.equal(editor._draft.background.src, "worlds/test/previous.webp");
  assert.equal(editor._draft.background.opacity, 0.65);
  assert.equal(editor._dirty, true);
  assert.equal(editor._loadedRevision, 5);
  assert.deepEqual(state, before);
  assert.equal(dom.previews.length, 0);
  assert.equal(editor._uploading, false);
  assert.equal(dom.progress.hidden, true);
  assert(dom.controls.every(control => !control.disabled));
  assert.match(notices.error.at(-1), /Background upload failed: Upload permission denied/);
  editor._dirty = false;
  await editor.close();
});

test("file chooser opens synchronously; cancellation is unchanged and the same file can be retried", async t => {
  const { editor, state } = fixture();
  await editor._prepareContext({});
  editor.rendered = true;
  const dom = backgroundControls(editor);
  await editor._onRender({}, {});
  const before = structuredClone(state);
  let calls = 0;
  const selectedFile = { name: "same.png" };
  configureEditor({ uploadBackground: async file => {
    assert.equal(file, selectedFile);
    calls += 1;
    if (calls === 1) throw new Error("Temporary failure");
    return "modules/modular-stream-overlay/storage/retry.png";
  } });
  t.mock.method(console, "error", () => {});
  let task;
  const perform = editor._perform.bind(editor);
  editor._perform = operation => { task = perform(operation); return task; };
  OverlayEditor.onAction.call(editor, { preventDefault() {} }, { dataset: { action: "uploadBackground" } });
  assert.equal(dom.fileInput.clicks, 1, "No asynchronous work precedes the trusted file chooser click");
  dom.listeners.change({ currentTarget: dom.fileInput });
  assert.equal(task, undefined);
  assert.equal(calls, 0);
  assert.equal(editor._dirty, false);
  assert.deepEqual(state, before);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    editor._uploadBackground();
    assert.equal(dom.fileInput.value, "");
    dom.fileInput.files = [selectedFile];
    dom.fileInput.value = "C:\\fakepath\\same.png";
    dom.listeners.change({ currentTarget: dom.fileInput });
    await task;
    assert.equal(dom.fileInput.value, "");
  }
  assert.equal(calls, 2);
  assert.equal(editor._draft.background.src, "modules/modular-stream-overlay/storage/retry.png");
  assert.deepEqual(state, before);
  editor._dirty = false;
  await editor.close();
});

test("uploads lock controls and closing, ignore external refresh, and discard a late result for another draft", async () => {
  const { editor, state, notices } = fixture();
  state.overlays[0].background.src = "worlds/test/previous.webp";
  await editor._prepareContext({});
  editor.rendered = true;
  const dom = backgroundControls(editor);
  let finish;
  configureEditor({ uploadBackground: () => new Promise(resolve => { finish = resolve; }) });
  const task = editor._perform(() => editor._uploadBackgroundFile({ name: "pending.jpg" }));
  assert.equal(editor._uploading, true);
  assert.equal(dom.progress.textContent, "Uploading background…");
  assert.equal(dom.progress.hidden, false);
  assert(dom.controls.every(control => control.disabled));
  await editor.close();
  assert.equal(editor.rendered, true);
  const originalId = editor._draft.id;
  await editor._editOverlay({ dataset: { overlayId: "other" } });
  assert.equal(editor._draft.id, originalId);
  let ran = false;
  await editor._perform(async () => { ran = true; });
  assert.equal(ran, false);
  state.revision += 1;
  await editor.refresh({ external: true });
  assert.equal(editor.renderCount, 0);
  editor._draft = createOverlay("Programmatic replacement");
  finish("modules/modular-stream-overlay/storage/late.jpg");
  await task;
  assert.equal(editor._draft.background.src, "worlds/test/previous.webp");
  assert.equal(state.overlays[0].background.src, "worlds/test/previous.webp");
  assert.equal(editor._uploading, false);
  assert.equal(dom.progress.hidden, true);
  assert.match(notices.warn.at(-1), /overlay changed/);
  await editor.close();
});

test("thumbnail failures and invalid asset paths show Image unavailable without exposing a broken image", async () => {
  const { editor } = fixture();
  await editor._prepareContext({});
  const dom = backgroundControls(editor);
  editor._draft.background.src = "worlds/test/missing.png";
  editor._updateBackgroundThumbnail();
  dom.image.onerror();
  assert.equal(dom.image.hidden, true);
  assert.equal(dom.imageStatus.hidden, false);
  assert.equal(dom.imageStatus.textContent, "Image unavailable");
  editor._draft.background.src = "javascript:alert(1)";
  editor._updateBackgroundThumbnail();
  assert.equal(dom.image.src, undefined);
  assert.equal(dom.image.hidden, true);
  assert.equal(dom.imageStatus.textContent, "Image unavailable");
  editor._draft.background.src = "";
  editor._updateBackgroundThumbnail();
  assert.equal(dom.path.textContent, "No image selected");
  assert.equal(dom.imageStatus.textContent, "No background image");
});

function layerField(field, value, type = "text") {
  return {
    dataset: { layerField: field }, type, value: String(value), checked: !!value,
    message: "", setCustomValidity(message) { this.message = message; },
    checkValidity() { return !this.message; }, reportValidity() { this.reported = true; }
  };
}

test("layer selection, creation, duplication, ordering and deletion stay in the private draft", async () => {
  const { editor, state } = fixture();
  await editor._prepareContext({});
  const saved = structuredClone(state);
  await editor._addImage();
  const image = editor._selectedLayer();
  assert.equal(image.type, "image");
  assert.equal(image.lockAspectRatio, true);
  await editor._addText();
  const text = editor._selectedLayer();
  assert.equal(text.type, "text");
  assert(text.z > image.z);
  editor._dirty = false;
  editor._selectLayer(image.id);
  assert.equal(editor._dirty, false, "Selection alone does not change the layout");
  await editor._layerCommand("duplicate");
  const copy = editor._selectedLayer();
  assert.notEqual(copy.id, image.id);
  assert.equal(copy.src, image.src);
  assert.equal(copy.x, image.x + 20);
  await editor._layerCommand("back");
  assert(copy.z < image.z && copy.z < text.z);
  await editor._layerCommand("locked");
  await editor._layerCommand("delete");
  assert.equal(editor._draft.layers.length, 3, "Locked deletion leaves the draft intact");
  await editor._layerCommand("locked");
  await editor._layerCommand("delete");
  assert.equal(editor._draft.layers.length, 2);
  assert.equal(editor._selectedLayerId, null);
  assert.deepEqual(state, saved);
  assert.equal(editor.renderCount, 0, "Layer actions do not rebuild the Foundry application");
});

test("layer properties retain invalid entries, synchronize geometry and preserve text weight and color", async () => {
  const { editor } = fixture();
  await editor._prepareContext({});
  await editor._addText();
  const layer = editor._selectedLayer();
  const width = layerField("width", "");
  const x = layerField("x", 0);
  const weight = layerField("fontWeight", "700");
  const color = layerField("color", "#fff8");
  const locked = layerField("locked", true, "checkbox");
  const remove = { disabled: false };
  const fields = [width, x, weight, color, locked];
  editor.element.querySelectorAll = selector => selector === '[data-layer-command="delete"]' ? [remove] : fields;
  editor._dirty = false;
  editor._onLayerInput({ currentTarget: width });
  assert.equal(layer.width, 640);
  assert.equal(editor._dirty, true, "Invalid input participates in discard protection");
  assert.match(width.message, /Width/i);
  weight.value = "700";
  editor._onLayerInput({ currentTarget: weight });
  assert.equal(layer.fontWeight, "700");
  assert.equal(width.value, "", "Editing another field preserves the unfinished width");
  assert(editor._invalidInputs.has(`layer.${layer.id}.width`));
  assert.throws(() => editor._validateInputs(), /Correct/);
  width.value = "800";
  editor._onLayerInput({ currentTarget: width });
  assert.equal(layer.width, 800);
  assert.equal(width.message, "");
  color.value = "#fff8";
  editor._onLayerInput({ currentTarget: color });
  assert.equal(layer.color, "#fff8");
  locked.checked = true;
  editor._onLayerInput({ currentTarget: locked });
  assert.equal(remove.disabled, true);
  locked.checked = false;
  editor._onLayerInput({ currentTarget: locked });
  assert.equal(remove.disabled, false, "Unlocking immediately enables deletion");
  layer.x = 123.5;
  editor._syncLayerFields(layer);
  assert.equal(x.value, "123.5");
  assert.equal(editor._invalidInputs.size, 0);
  assert.equal(editor.renderCount, 0);
});

test("image layer uploads reuse the background uploader and publish a complete layer only on Save", async () => {
  const { editor, store, state } = fixture();
  await editor._prepareContext({});
  editor.rendered = true;
  await editor._addImage();
  const image = editor._selectedLayer();
  image.rotation = 20;
  const file = { name: "portrait.webp" };
  const path = "modules/modular-stream-overlay/storage/layer-test.webp";
  let uploads = 0, saves = 0;
  configureEditor({ uploadBackground: async value => { assert.equal(value, file); uploads++; return path; } });
  const target = { draft: editor._draft, overlayId: editor._draft.id, layerId: image.id };
  await editor._draftOperation(() => editor._uploadImageFile(file, target));
  assert.equal(image.src, path);
  assert.equal(editor._uploading, false);
  assert.equal(editor._dirty, true);
  assert.equal(state.overlays[0].layers.length, 0);
  store.saveOverlay = async (overlay, options) => {
    saves++; assert.equal(options.expectedRevision, 5);
    state.overlays[0] = structuredClone(overlay); state.revision++;
    return overlay;
  };
  await editor._saveOverlay();
  assert.equal(saves, 1);
  assert.equal(uploads, 1);
  assert.equal(state.overlays[0].layers[0].src, path);
  assert.equal(state.overlays[0].layers[0].rotation, 20);
  assert.equal(editor._dirty, false);
});

test("failed and late image uploads preserve the original layer and unrelated drafts", async () => {
  const { editor, notices } = fixture();
  await editor._prepareContext({});
  editor.rendered = true;
  const image = createLayer("image", editor._draft.canvas);
  image.src = "worlds/example/old.png";
  editor._draft.layers.push(image);
  const target = { draft: editor._draft, overlayId: editor._draft.id, layerId: image.id };
  configureEditor({ uploadBackground: async () => { throw Error("Permission denied"); } });
  await assert.rejects(editor._uploadImageFile({ name: "bad.png" }, target), /Image upload failed/);
  assert.equal(image.src, "worlds/example/old.png");
  assert.equal(editor._uploading, false);
  let finish;
  configureEditor({ uploadBackground: () => new Promise(resolve => { finish = resolve; }) });
  const pending = editor._uploadImageFile({ name: "late.png" }, target);
  editor._draft = createOverlay("Replacement");
  finish("modules/modular-stream-overlay/storage/late.png");
  await pending;
  assert.equal(editor._draft.layers.length, 0);
  assert.equal(image.src, "worlds/example/old.png");
  assert.match(notices.warn.at(-1), /layer changed/);
  assert.equal(editor._uploading, false);
});

test("widget instances share a preset while independent character rebinding remains a private draft", async () => {
  const { editor, state, store } = fixture();
  const preset = createWidgetPreset("Shared character card");
  const calls = [];
  configureEditor({ widgetPresets: { list: () => [preset] }, characterData: {
    async resolveActor(reference) { calls.push(reference); if (reference === "bad") throw Error("Actor unavailable"); return { uuid: reference, name: reference }; }
  } });
  await editor._prepareContext({});
  const first = await editor._insertWidget(preset, "Actor.first");
  first.x = 120; first.opacity = .5;
  await editor._layerCommand("duplicate");
  const second = editor._selectedLayer();
  await editor._assignActor("Actor.second");
  assert.equal(first.actorUuid, "Actor.first");
  assert.equal(second.actorUuid, "Actor.second");
  assert.equal(first.presetId, second.presetId);
  assert.notEqual(first.id, second.id);
  assert.equal(second.x, 140); assert.equal(second.opacity, .5);
  assert.equal(state.overlays[0].layers.length, 0, "No persistent write before Save");
  await assert.rejects(editor._assignActor("bad"), /unavailable/);
  assert.equal(second.actorUuid, "Actor.second");
  store.saveOverlay = async (overlay, options) => { assert.equal(options.expectedRevision, 5); state.overlays[0] = structuredClone(overlay); state.revision++; return overlay; };
  await editor._saveOverlay();
  assert.deepEqual(state.overlays[0].layers.map(layer => layer.actorUuid), ["Actor.first", "Actor.second"]);
  assert.deepEqual(calls, ["Actor.second", "bad"]);
});

test("late Actor resolution cannot bind a different overlay draft", async () => {
  const { editor } = fixture(); await editor._prepareContext({});
  const preset = createWidgetPreset("Card");
  const instance = await editor._insertWidget(preset, "Actor.original");
  let finish;
  configureEditor({ characterData: { resolveActor: () => new Promise(resolve => { finish = resolve; }) } });
  const pending = editor._assignActor("Actor.late");
  editor._loadDraft(createOverlay("Replacement"), 5);
  finish({ uuid: "Actor.late" }); await pending;
  assert.equal(instance.actorUuid, "Actor.original");
  assert.equal(editor._draft.layers.length, 0); assert.equal(editor._dirty, false);
});

test("Actor Directory drops bind their target widget using public document drag data", async () => {
  const { editor } = fixture(); await editor._prepareContext({});
  const preset = createWidgetPreset("Card");
  const first = await editor._insertWidget(preset, "Actor.one");
  const second = await editor._insertWidget(preset, "Actor.two");
  configureEditor({ characterData: { resolveActor: async uuid => ({ uuid }) } });
  foundry.applications.ux = { TextEditor: { implementation: { getDragEventData: () => ({ type: "Actor", uuid: "Actor.dropped" }) } } };
  let prevented = false;
  await editor._dropActor({ target: { closest: () => ({ dataset: { layerId: first.id } }) }, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(first.actorUuid, "Actor.dropped"); assert.equal(second.actorUuid, "Actor.two"); assert.equal(prevented, true);
  assert.equal(editor._selectedLayerId, first.id);
});

test("optional box and text styles apply from the designer and clear back to defaults", async () => {
  const { editor } = fixture();
  await editor._prepareContext({});
  await editor._addText();
  const layer = editor._selectedLayer();
  const border = layerField("borderWidth", "3");
  const lineHeight = layerField("lineHeight", "1.3");
  const rich = layerField("richText", true, "checkbox");
  const fields = [border, lineHeight, rich];
  editor.element.querySelectorAll = selector => selector === '[data-layer-command="delete"]' ? [] : fields;
  for (const [field, value] of [[border, "3"], [lineHeight, "1.3"], [rich, true]]) {
    // Each accepted input re-synchronizes the other mounted fields from the layer.
    if (field.type === "checkbox") field.checked = value; else field.value = value;
    editor._onLayerInput({ currentTarget: field });
  }
  assert.deepEqual([layer.borderWidth, layer.lineHeight, layer.richText], [3, 1.3, true]);
  border.value = "";
  editor._onLayerInput({ currentTarget: border });
  assert.equal(Object.hasOwn(layer, "borderWidth"), false, "An empty optional field restores the default look");
  lineHeight.value = "9";
  editor._onLayerInput({ currentTarget: lineHeight });
  assert.equal(layer.lineHeight, 1.3); assert.match(lineHeight.message, /Line height/);
});
