import test from "node:test";
import assert from "node:assert/strict";
import { WidgetPresetStore, createWidgetPresetState } from "../scripts/core/widget-presets.js";
import { createLayer } from "../scripts/core/layers.js";
import { LayerCanvas } from "../scripts/editor/layer-canvas.js";

class Element {
  constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = new Map(); this.listeners = new Map(); this.value = ""; this.type = ""; this.validationMessage = ""; this._text = ""; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this._text = ""; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  removeAttribute(key) { this.attributes.delete(key); }
  getAttribute(key) { return this.attributes.get(key); }
  setCustomValidity(message) { this.validationMessage = message; }
  checkValidity() { return !this.validationMessage; }
  reportValidity() { return this.checkValidity(); }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  querySelectorAll(selector) {
    const selectors = selector.split(",").map(entry => entry.trim());
    const matches = element => selectors.some(entry => {
      const attr = entry.match(/^\[data-([a-z-]+)\]$/);
      return attr ? Object.hasOwn(element.dataset, attr[1].replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())) : false;
    });
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
class ApplicationStub {
  constructor() { this.rendered = false; }
  _canRender() {} async _prepareContext() { return {}; } async _onRender() {}
  async render() { return this; } async close() { return this; }
}
globalThis.foundry = {
  applications: { api: { ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: base => base, DialogV2: {} } },
  utils: { deepClone: structuredClone }
};
const { configureEditor } = await import("../scripts/ui/editor.js");
const { WidgetPresetEditor, configureWidgetEditor } = await import("../scripts/ui/widget-editor.js");

async function fixture() {
  let state = createWidgetPresetState(), writes = 0;
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.game = { user: { isGM: true }, users: [], modules: new Map() };
  globalThis.ui = { notifications: { info() {}, error() {}, warn() {} } };
  const store = new WidgetPresetStore({ settings: { get: () => structuredClone(state), async set(_module, _key, value) { state = structuredClone(value); writes++; } } });
  const characterData = { fieldDefinitions: () => [{ id: "character.hp.current", label: "Health", type: "number" }] };
  configureEditor({ widgetPresets: store, characterData }); configureWidgetEditor({ widgetPresets: store, characterData });
  const editor = new WidgetPresetEditor({ presetId: state.presets[0].id });
  editor.element = new Element();
  const pagesHost = new Element(); pagesHost.dataset.widgetPages = ""; editor.element.append(pagesHost);
  editor._renderLayerProperties = () => {};
  editor._renderSharedWidgetAnimations = () => {};
  editor._name = async (_title, initial) => initial;
  editor._confirm = async () => true;
  await editor._prepareContext({});
  return { editor, store, pagesHost, writes: () => writes };
}
const descendants = host => host.children.flatMap(child => [child, ...descendants(child)]);
const field = (host, label) => descendants(host).find(entry => entry.getAttribute("aria-label") === label);
function input(value, type = "number") { const element = new Element("input"); element.type = type; element.value = String(value); return element; }

test("three visually editable pages save with shared content and independent Actor-free bindings", async () => {
  const { editor, store, writes } = await fixture();
  const sharedCount = editor._draft.layers.length;
  const pageIds = [];
  for (const binding of ["character.hp.current", "character.level", "character.focus"]) {
    await editor._pageCommand("add"); pageIds.push(editor._pageScope);
    await editor._addComponent({ dataset: { componentType: "dynamic-number" } });
    const layer = editor._selectedLayer(); layer.binding = binding; layer.text = `{${binding}}`; layer.x = 37;
    assert.equal(editor._editingLayers().length, 1);
  }
  assert.equal(editor._draft.layers.length, sharedCount);
  assert.equal(editor._draft.pages.length, 3);
  assert.equal(writes(), 0, "All page changes remain private until Save");
  await editor._selectPageScope(pageIds[0]);
  assert.equal(editor._editingLayers()[0].binding, "character.hp.current");
  assert.equal(editor._editingOverlay(), editor._editingOverlay(), "Canvas gestures keep one stable editing document");
  await editor._layerCommand("duplicate", editor._editingLayers()[0].id);
  assert.equal(editor._draft.pages[0].layers.length, 2);
  assert.equal(editor._draft.pages[1].layers.length, 1);
  await editor._selectPageScope("shared");
  assert.equal(editor._editingLayers().length, sharedCount);
  editor._previewActorUuid = "Actor.private-preview";
  await editor._saveOverlay();
  const saved = store.list().find(entry => entry.id === editor._draft.id);
  assert.equal(saved.layers.length, sharedCount); assert.equal(saved.pages.length, 3);
  assert.deepEqual(saved.pages.map(page => page.layers[0].binding), ["character.hp.current", "character.level", "character.focus"]);
  assert(!JSON.stringify(saved).includes("Actor.private-preview")); assert.equal(writes(), 1);
});

test("page library operations preserve other pages, shared elements, and starting-page validity", async () => {
  const { editor } = await fixture();
  const shared = structuredClone(editor._draft.layers);
  await editor._pageCommand("add"); const first = editor._pageScope;
  await editor._addText(); editor._selectedLayer().text = "First page";
  await editor._pageCommand("duplicate"); const duplicate = editor._pageScope;
  assert.notEqual(duplicate, first);
  assert.notEqual(editor._draft.pages[0].layers[0].id, editor._draft.pages[1].layers[0].id);
  editor._name = async () => "Resources"; await editor._pageCommand("rename");
  assert.equal(editor._draft.pages[1].name, "Resources");
  await editor._pageCommand("up"); assert.equal(editor._draft.pages[0].id, duplicate);
  editor._draft.cycling.startPageId = duplicate;
  await editor._pageCommand("delete");
  assert.equal(editor._draft.cycling.startPageId, null); assert.equal(editor._pageScope, "shared");
  assert.equal(editor._draft.pages.length, 1); assert.equal(editor._draft.pages[0].id, first);
  assert.deepEqual(editor._draft.layers, shared);
});

test("invalid timing entries survive scope changes and block Save until corrected", async () => {
  const { editor, pagesHost } = await fixture();
  await editor._pageCommand("add"); const page = editor._draft.pages[0];
  editor._onCarouselInput(input(-2), { page, field: "duration" });
  assert.equal(page.duration, null);
  await editor._selectPageScope("shared"); await editor._selectPageScope(page.id);
  const unfinished = field(pagesHost, "This page duration (seconds; blank uses default)");
  assert.equal(unfinished.value, "-2"); assert.equal(unfinished.checkValidity(), false);
  assert.throws(() => editor._validateInputs(), /highlighted page|invalid property/);
  editor._onCarouselInput(unfinished, { page, field: "duration" });
  unfinished.value = "8"; editor._onCarouselInput(unfinished, { page, field: "duration" });
  assert.equal(page.duration, 8000);
  const invalidDefault = input(0); editor._onCarouselInput(invalidDefault, { field: "duration" });
  assert.equal(editor._draft.cycling.duration, 5000);
  invalidDefault.value = "6"; editor._onCarouselInput(invalidDefault, { field: "duration" });
  assert.equal(editor._draft.cycling.duration, 6000);
  const transition = input("slide-left", "select-one"); editor._onCarouselInput(transition, { field: "transition" });
  const enabled = input("", "checkbox"); enabled.checked = true; editor._onCarouselInput(enabled, { field: "enabled" });
  assert.equal(editor._draft.cycling.transition, "slide-left"); assert.equal(editor._draft.cycling.enabled, true);
  assert.doesNotThrow(() => editor._validateInputs());
  await editor._saveOverlay();
});

test("carousel controls preview the complete draft, keep runtime state local, and block canvas gestures", async () => {
  const { editor, writes } = await fixture();
  await editor._pageCommand("add"); const pageId = editor._pageScope;
  const rendered = [], scopes = [], commands = [];
  const state = { activePageId: pageId, paused: true };
  editor._preview = {
    renderer: { setPageEditing: scope => scopes.push(scope), carousel: { getState: () => state,
      resume() { state.paused = false; commands.push("resume"); }, pause() { state.paused = true; commands.push("pause"); },
      next() { commands.push("next"); }, previous() { commands.push("previous"); }, select(id) { state.activePageId = id; commands.push(id); } } },
    async render(draft) { rendered.push(draft); }, select() {}, cancelGesture() {}
  };
  editor._dirty = false;
  await editor._updatePreview(); assert.equal(scopes.at(-1), pageId);
  await editor._previewCarousel("resume"); assert.equal(scopes.at(-1), null); assert.equal(editor._canvasBlocked(), true);
  await editor._previewCarousel("pause"); await editor._previewCarousel("next");
  await editor._previewCarousel("previous"); await editor._previewCarousel("select", pageId);
  assert.deepEqual(commands, ["pause", "resume", "pause", "next", "previous", pageId]);
  assert(rendered.every(draft => draft === editor._draft && draft.pages.length === 1 && draft.layers.length > 0));
  assert.equal(editor._dirty, false); assert.equal(writes(), 0);
  await editor._previewCarousel("edit"); assert.equal(editor._canvasBlocked(), false); assert.equal(scopes.at(-1), pageId);
});

test("component limits count all pages and canvas selection uses the active editing scope", async () => {
  const { editor } = await fixture(); await editor._pageCommand("add");
  const page = editor._draft.pages[0];
  for (let index = editor._draft.layers.length; index < 100; index++) page.layers.push(createLayer("text", editor._draft.canvas));
  await assert.rejects(editor._addText(), /100 components/);
  await assert.rejects(editor._layerCommand("duplicate", page.layers[0].id), /100 components/);
  assert.equal(editor._allLayers().length, 100);
  const canvas = Object.create(LayerCanvas.prototype);
  canvas.overlay = editor._draft;
  canvas.getOverlay = () => editor._editingOverlay();
  canvas.renderControls = () => {};
  canvas.onSelect = () => {};
  canvas.select(page.layers[0].id); assert.equal(canvas.selectedId, page.layers[0].id);
  canvas.select(editor._draft.layers[0].id); assert.equal(canvas.selectedId, null, "Shared context stays visible without capturing page-editing gestures");
});

test("entering playback preserves the edited page and keeps Next paused until Resume", async () => {
  const { editor, writes } = await fixture();
  await editor._pageCommand("add"); const first = editor._pageScope;
  await editor._pageCommand("add"); const second = editor._pageScope;
  const commands = [], state = { activePageId: second, paused: true, availablePageIds: [first, second] };
  editor._preview = {
    renderer: { setPageEditing() {}, carousel: {
      getState: () => state, pause() { state.paused = true; commands.push("pause"); },
      select(id) { state.activePageId = id; commands.push(id); },
      next() { assert.equal(state.activePageId, second); assert.equal(state.paused, true); state.activePageId = first; commands.push("next"); }
    } },
    async render() { state.activePageId = first; state.paused = false; }, cancelGesture() {}
  };
  await editor._previewCarousel("next");
  assert.deepEqual(commands, ["pause", second, "next"]);
  assert.equal(state.paused, true); assert.equal(writes(), 0);
});
