import test from "node:test";
import assert from "node:assert/strict";
import { WidgetPresetStore, createWidgetPresetState } from "../scripts/core/widget-presets.js";

class ApplicationStub {
  constructor() { this.rendered = false; this.renderCount = 0; }
  _canRender() {} async _prepareContext() { return {}; } async _onRender() {}
  async render() { this.renderCount++; return this; } async close() { this.rendered = false; return this; }
}
globalThis.foundry = {
  applications: { api: { ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: base => base, DialogV2: {} } },
  utils: { deepClone: structuredClone, getRoute: value => value }
};
const { configureEditor } = await import("../scripts/ui/editor.js");
const { WidgetPresetEditor, WidgetPresetManager, configureWidgetEditor } = await import("../scripts/ui/widget-editor.js");

function fixture() {
  let state = createWidgetPresetState();
  const notices = [];
  globalThis.ui = { notifications: { info: value => notices.push(value), error: value => notices.push(value), warn: value => notices.push(value) } };
  globalThis.game = { user: { isGM: true }, users: [], modules: new Map() };
  const settings = { get: () => structuredClone(state), async set(_module, _key, value) { state = structuredClone(value); } };
  const store = new WidgetPresetStore({ settings });
  const characterData = { fieldDefinitions: () => [{ id: "character.name", label: "Name", type: "string" }, { id: "character.hp.current", label: "HP", type: "number" }] };
  configureEditor({ widgetPresets: store, characterData }); configureWidgetEditor({ widgetPresets: store, characterData });
  const editor = new WidgetPresetEditor({ presetId: state.presets[0].id });
  editor.element = { querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, removeAttribute() {} };
  editor._renderLayerProperties = () => {};
  return { store, editor, notices, getState: () => state };
}

test("widget designer reuses layer editing and writes only a reusable Actor-free design", async () => {
  const { editor, store } = fixture();
  const context = await editor._prepareContext({});
  assert.equal(context.widgetMode, true);
  assert(context.componentDefinitions.some(definition => definition.type === "resource-bar"));
  assert.equal(editor._draft.canvas.width, 400);
  await editor._addComponent({ dataset: { componentType: "dynamic-text" } });
  const layer = editor._selectedLayer(); layer.x = 92; layer.text = "Name: {character.name}";
  editor._previewActorUuid = "Actor.temporary";
  assert.equal(store.list()[0].layers.length, 5, "Design changes remain a private draft");
  await editor._saveOverlay();
  const saved = store.list().find(preset => preset.id === editor._draft.id);
  assert.equal(saved.layers.at(-1).x, 92); assert.equal(saved.layers.at(-1).text, "Name: {character.name}");
  assert(!JSON.stringify(saved).includes("Actor.temporary")); assert.equal(editor._dirty, false);
  await assert.rejects(editor._addComponent({ dataset: { componentType: "character-widget" } }), /available/);
});

test("widget designer preserves dirty drafts and rejects stale shared preset writes", async () => {
  const { editor, store } = fixture(); await editor._prepareContext({}); editor.rendered = true;
  editor._draft.name = "Local draft"; editor._dirty = true;
  await store.rename(editor._draft.id, "Remote rename");
  await editor.refresh({ external: true });
  assert.equal(editor._draft.name, "Local draft"); assert.equal(editor._conflict, true);
  await assert.rejects(editor._saveOverlay(), /changed in another editor/);
  assert.equal(store.list()[0].name, "Remote rename");
});

test("whole-widget and component animation rules save together while the preview Actor remains temporary", async () => {
  const { editor, store } = fixture(); await editor._prepareContext({});
  editor._draft.animations.entrance = { type: "fade-in", duration: 650 };
  editor._draft.triggers.push({ id: "damage", name: "Damage", event: "decreased", field: "character.hp.current", action: { type: "color-flash", target: "portrait", animation: { type: "color-flash", duration: 400, color: "#ff4444" } } });
  editor._draft.layers.find(layer => layer.id === "hp-bar").animations.transition.duration = 300;
  editor._previewActorUuid = "Actor.preview-only";
  assert.equal(store.list()[0].animations.entrance, null);
  await editor._saveOverlay();
  const saved = store.list().find(preset => preset.id === editor._draft.id);
  assert.equal(saved.animations.entrance.duration, 650); assert.equal(saved.triggers[0].action.target, "portrait");
  assert.equal(saved.layers.find(layer => layer.id === "hp-bar").animations.transition.duration, 300);
  assert(!JSON.stringify(saved).includes("Actor.preview-only"));
});

test("static and dynamic sources retain native geometry and typography", async () => {
  const { editor } = fixture(); await editor._prepareContext({});
  await editor._addText(); const layer = editor._selectedLayer();
  Object.assign(layer, { x: 70, y: 40, width: 210, fontSize: 28, color: "#aabbcc" });
  await editor._setContentSource("dynamic");
  assert.equal(layer.type, "dynamic-text"); assert.equal(layer.binding, "character.name"); assert.equal(layer.text, "{character.name}");
  assert.equal(layer.x, 70); assert.equal(layer.width, 210); assert.equal(layer.fontSize, 28); assert.equal(layer.color, "#aabbcc");
  await editor._setContentSource("static"); assert.equal(layer.type, "text"); assert.equal(layer.x, 70);
  await editor._addImage(); const portrait = editor._selectedLayer(); portrait.width = 100;
  await editor._setContentSource("dynamic"); assert.equal(portrait.type, "character-portrait"); assert.equal(portrait.width, 100);
});

test("binding field selection updates a simple token while preserving a custom text template", async () => {
  const { editor } = fixture(); await editor._prepareContext({});
  await editor._addComponent({ dataset: { componentType: "dynamic-text" } });
  const layer = editor._selectedLayer();
  const input = { type: "select-one", value: "character.hp.current", dataset: { layerField: "binding" }, setCustomValidity() {} };
  editor._onLayerInput({ currentTarget: input });
  assert.equal(layer.binding, "character.hp.current"); assert.equal(layer.text, "{character.hp.current}");
  layer.text = "Health: {character.hp.current} / {character.hp.max}";
  input.value = "character.level"; editor._onLayerInput({ currentTarget: input });
  assert.equal(layer.binding, "character.level"); assert.equal(layer.text, "Health: {character.hp.current} / {character.hp.max}");
});

test("widget manager duplicates, renames and deletes dedicated presets without overlay writes", async () => {
  const { store } = fixture(); const manager = new WidgetPresetManager();
  manager._name = async (_title, initial) => `${initial} edited`; manager._confirm = async () => true;
  const original = store.list()[0];
  await manager._command("duplicate", original.id);
  assert.equal(store.list().length, 3); assert.equal(store.list()[0].name, original.name);
  const copy = store.list().at(-1); assert.notEqual(copy.id, original.id);
  await manager._command("rename", copy.id); assert.equal(store.list().at(-1).name, `${copy.name} edited`);
  await manager._command("delete", copy.id); assert.equal(store.list().length, 2);
});

test("widget manager reports failed refreshes without rejecting unobserved action promises", async t => {
  const { notices } = fixture(); const manager = new WidgetPresetManager(); manager.rendered = true;
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  manager.render = async () => { throw Error("Template failed"); };
  await assert.doesNotReject(manager._perform(async () => {}));
  assert.equal(manager._busy, false); assert.deepEqual(notices, ["Template failed"]);
  assert.equal(errors.length, 1);
  notices.length = 0; errors.length = 0;
  await assert.doesNotReject(manager._perform(async () => { throw Error("Save failed"); }));
  assert.equal(manager._busy, false); assert.deepEqual(notices, ["Save failed"], "The original operation failure remains the single user notification");
  assert.equal(errors.length, 2, "Both failures are logged for diagnosis");
  assert.match(errors[0][0], /refresh failed/); assert.equal(errors[0][1].message, "Template failed");
  assert.equal(errors[1][1].message, "Save failed");
});

test("field mapping dialog retains saved JSON through DialogV2 HTML serialization", async t => {
  fixture();
  const mappings = [{ id: "character.focus", label: "Focus", type: "number", path: "system.resources.focus.value" }];
  let saved;
  game.modules.set("modular-stream-overlay", { api: { getFieldMappings: () => mappings, setFieldMappings: async value => { saved = value; } } });
  const previousDocument = globalThis.document;
  // DialogV2 rebuilds a form from content.innerHTML. Textarea .value is intentionally
  // separate from the serialized default, matching the browser's textarea contract.
  class ContentElement {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ""; this.value = ""; this.style = {}; }
    setAttribute() {}
    append(...children) { this.children.push(...children); }
    get innerHTML() { return this.children.map(child => child.outerHTML).join(""); }
    get outerHTML() { return `<${this.tag}>${this.children.length ? this.innerHTML : this.textContent}</${this.tag}>`; }
  }
  globalThis.document = { createElement: tag => new ContentElement(tag) };
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
  const previousInput = foundry.applications.api.DialogV2.input;
  t.after(() => { if (previousInput === undefined) delete foundry.applications.api.DialogV2.input; else foundry.applications.api.DialogV2.input = previousInput; });
  foundry.applications.api.DialogV2.input = async ({ content }) => {
    const serializedValue = content.innerHTML.match(/<textarea>([\s\S]*?)<\/textarea>/)?.[1] ?? "";
    assert.deepEqual(JSON.parse(serializedValue), mappings, "Saved mappings must survive conversion to HTML and rebuilding the form");
    return { mappings: serializedValue };
  };
  await new WidgetPresetManager()._fieldMappings();
  assert.deepEqual(saved, mappings, "Submitting unchanged defaults must retain every configured field");
});
