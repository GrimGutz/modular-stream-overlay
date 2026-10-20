import test from "node:test";
import assert from "node:assert/strict";
import { createOverlay, createState } from "../scripts/core/schema.js";
import { OverlayStore } from "../scripts/core/store.js";
import { createWidgetInstance } from "../scripts/core/layers.js";
import { createWidgetPreset, WidgetPresetStore, createWidgetPresetState } from "../scripts/core/widget-presets.js";
import { addPage } from "../scripts/carousel/schema.js";

class Element {
  constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = new Map(); this.listeners = new Map(); this.value = ""; this._text = ""; this.type = ""; this.classList = { toggle() {}, add() {} }; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this._text = ""; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key); }
  removeAttribute(key) { this.attributes.delete(key); }
  setCustomValidity(message) { this.validationMessage = message; }
  checkValidity() { return !this.validationMessage; }
  reportValidity() { return this.checkValidity(); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type) { this.listeners.get(type)?.({ currentTarget: this, preventDefault() {} }); }
  querySelectorAll(selector) {
    const names = selector.split(",").map(value => value.trim());
    const matches = child => names.some(name => {
      const match = name.match(/^\[data-([\w-]+)\]$/);
      return match ? Object.hasOwn(child.dataset, match[1].replace(/-([a-z])/g, (_all, value) => value.toUpperCase())) : false;
    });
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
class ApplicationStub {
  constructor() { this.rendered = false; }
  _canRender() {} async _prepareContext() { return {}; } async _onRender() {} async render() { return this; } async close() { return this; }
}
globalThis.foundry = { applications: { api: { ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: base => base, DialogV2: {} } }, utils: { deepClone: structuredClone } };
const { OverlayEditor, configureEditor } = await import("../scripts/ui/editor.js");
const { WidgetPresetEditor, configureWidgetEditor } = await import("../scripts/ui/widget-editor.js");
const descendants = host => host.children.flatMap(child => [child, ...descendants(child)]);
const field = (host, label) => descendants(host).find(node => node.getAttribute("aria-label") === label);
const flush = () => new Promise(resolve => setImmediate(resolve));
function edit(input, value) { assert(input, "Expected the setting to be visible"); input.value = String(value); input.dispatch(input.tagName === "SELECT" ? "change" : "input"); }

async function fixture() {
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.game = { user: { isGM: true }, users: [], modules: new Map() };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  const preset = createWidgetPreset("Reusable card");
  addPage(preset, "Health").id = "health"; addPage(preset, "Resources").id = "resources";
  preset.cycling = { ...preset.cycling, enabled: true, mode: "combined" };
  let saved = createState(), writes = 0;
  const overlay = createOverlay("Stream");
  const instance = createWidgetInstance(preset); instance.actorUuid = "Actor.a"; instance.actorUuids = ["Actor.a"];
  overlay.layers.push(instance); saved.overlays = [overlay]; saved.activeOverlayId = overlay.id;
  const store = new OverlayStore({ settings: { get: () => structuredClone(saved), async set(_module, _key, state) { saved = structuredClone(state); writes++; } } });
  const names = new Map([["Actor.a", "Aria"], ["Actor.b", "Borin"], ["Actor.c", "Cyra"]]);
  const characterData = {
    fieldDefinitions: () => [], resolveActor: async uuid => { if (!names.has(uuid)) throw new Error("Actor unavailable"); return { uuid, name: names.get(uuid) }; },
    resolve: async uuid => names.has(uuid) ? { values: { "character.name": names.get(uuid) } } : { warning: "Unavailable", values: {} }
  };
  configureEditor({ store, widgetPresets: { list: () => [structuredClone(preset)] }, characterData });
  const editor = new OverlayEditor(); editor.element = new Element();
  const host = new Element(); editor.element.append(host);
  editor._renderLayerProperties = () => {
    editor._carouselLabelsGeneration = (editor._carouselLabelsGeneration ?? 0) + 1;
    host.replaceChildren(); if (editor._selectedLayer()) editor._renderInstanceCarousel(host, editor._selectedLayer(), preset);
  };
  editor._updatePreview = async () => { editor._syncInstanceCarouselPreview(); };
  await editor._prepareContext({}); editor._selectedLayerId = instance.id; editor._renderLayerProperties(); await flush();
  return { editor, host, preset, characterData, layer: editor._selectedLayer(), store, writes: () => writes, saved: () => saved };
}

test("multiple assigned characters and combined settings remain a private instance draft until Save", async () => {
  const { editor, layer, store, writes, preset } = await fixture(); const originalPreset = structuredClone(preset);
  await editor._addCarouselActor("Actor.b"); await editor._addCarouselActor("Actor.c");
  edit(field(editor.element, "Cycling Mode"), "combined"); await flush();
  assert.deepEqual(layer.actorUuids, ["Actor.a", "Actor.b", "Actor.c"]);
  assert.deepEqual(store.getState().overlays[0].layers[0].actorUuids, ["Actor.a"]); assert.equal(writes(), 0);
  await editor._saveOverlay();
  const saved = store.getState().overlays[0].layers[0];
  assert.deepEqual(saved.actorUuids, ["Actor.a", "Actor.b", "Actor.c"]); assert.equal(saved.carousel.mode, "combined"); assert.equal(writes(), 1);
  assert.deepEqual(preset, originalPreset); assert(!JSON.stringify(preset).includes("Actor."));
});

test("sequence preview explains pages-first traversal, Actor order, and page order using permitted names", async () => {
  const { editor, host, layer, preset } = await fixture(); await editor._addCarouselActor("Actor.b"); await flush();
  const sequence = () => field(host, "Preview Sequence").children.map(entry => entry.textContent);
  assert.deepEqual(sequence(), ["Aria / Health", "Aria / Resources", "Borin / Health", "Borin / Resources"]);
  await editor._carouselCharacterCommand(layer, "Actor.b", "up"); await flush();
  assert.deepEqual(sequence().slice(0, 2), ["Borin / Health", "Borin / Resources"]);
  await editor._instancePageOrder(layer, preset, "resources", -1); await flush();
  assert.deepEqual(sequence(), ["Borin / Resources", "Borin / Health", "Aria / Resources", "Aria / Health"]);
  edit(field(host, "Traversal Order"), "characters-first"); await flush(); editor._renderLayerProperties(); await flush();
  assert.deepEqual(sequence(), ["Borin / Resources", "Aria / Resources", "Borin / Health", "Aria / Health"]);
});

test("Actor drops append only inside Assigned Characters and primary rebinding preserves the remaining list", async () => {
  const { editor, layer } = await fixture();
  foundry.applications.ux = { TextEditor: { implementation: { getDragEventData: () => ({ type: "Actor", uuid: "Actor.b" }) } } };
  const event = assigned => ({ target: { closest: selector => selector === "[data-assigned-characters]" && assigned ? { dataset: { assignedCharacters: "" } } : null }, preventDefault() {}, stopPropagation() {} });
  await editor._dropActor(event(true)); assert.deepEqual(layer.actorUuids, ["Actor.a", "Actor.b"]);
  await editor._dropActor(event(true)); assert.deepEqual(layer.actorUuids, ["Actor.a", "Actor.b"], "Repeated drops do not duplicate a character");
  await editor._assignActor("Actor.a"); assert.deepEqual(layer.actorUuids, ["Actor.a", "Actor.b"], "Rebinding the same primary must retain the second Actor");
  foundry.applications.ux.TextEditor.implementation.getDragEventData = () => ({ type: "Actor", uuid: "Actor.c" });
  await editor._dropActor(event(false)); assert.deepEqual(layer.actorUuids, ["Actor.c", "Actor.b"]); assert.equal(layer.actorUuid, "Actor.c");
});

test("local navigation and playback controls never save configuration or alter draft settings", async () => {
  const { editor, layer, writes, saved } = await fixture(); await editor._addCarouselActor("Actor.b"); await editor._saveOverlay();
  const selected = editor._selectedLayer(), original = structuredClone(editor._draft), persistent = structuredClone(saved()), calls = [];
  const carousel = { getState: () => ({ paused: true, activeActorUuid: "Actor.a", activePageId: "health", sequence: [{ actorUuid: "Actor.a", pageId: "health" }] }) };
  for (const command of ["pause", "resume", "next", "previous", "reset"]) carousel[command] = async () => { calls.push(command); };
  editor._preview = { renderer: { compositions: new Map([[layer.id, { carousel }]]) } };
  for (const command of ["pause", "resume", "next", "previous", "reset"]) await editor._instanceCarouselPreview(selected.id, command);
  assert.deepEqual(calls, ["pause", "resume", "next", "previous", "reset"]);
  assert.deepEqual(editor._draft, original); assert.deepEqual(saved(), persistent); assert.equal(writes(), 1); assert.equal(editor._dirty, false);
});

test("invalid duration overrides survive selection and block Save; blank restores inheritance", async () => {
  const { editor, host, layer, writes } = await fixture();
  edit(field(host, "Health duration (seconds; blank inherits)"), "8"); await flush();
  assert.equal(layer.carousel.pageDurations.health, 8000);
  edit(field(host, "Health duration (seconds; blank inherits)"), "-2");
  editor._renderLayerProperties();
  assert.equal(field(host, "Health duration (seconds; blank inherits)").value, "-2");
  assert.equal(layer.carousel.pageDurations.health, 8000);
  await assert.rejects(editor._saveOverlay(), /invalid property|highlighted/); assert.equal(writes(), 0);
  edit(field(host, "Health duration (seconds; blank inherits)"), ""); await flush();
  assert.equal(Object.hasOwn(layer.carousel.pageDurations, "health"), false); assert.doesNotThrow(() => editor._validateInputs());
});

test("initial Actor removal and empty disabled-page sequences remain valid without invented data", async () => {
  const { editor, layer, preset, host } = await fixture(); await editor._addCarouselActor("Actor.b");
  edit(field(host, "Initial Actor"), "Actor.b"); await flush();
  await editor._carouselCharacterCommand(layer, "Actor.b", "remove");
  assert.equal(layer.carousel.actorStartUuid, null); assert.equal(layer.actorUuid, "Actor.a");
  preset.pages.forEach(page => { page.enabled = false; }); editor._renderLayerProperties();
  assert.equal(field(host, "Preview Sequence").children.length, 0); assert.match(host.textContent, /No available character\/page steps/);
  await editor._assignActor(""); assert.deepEqual(layer.actorUuids, []); assert.equal(layer.actorUuid, "");
});

test("a late Add Character result cannot change a replacement overlay draft", async () => {
  const { editor, layer, characterData } = await fixture(); let finish;
  characterData.resolveActor = () => new Promise(resolve => { finish = resolve; });
  const pending = editor._addCarouselActor("Actor.b"); editor._loadDraft(createOverlay("Replacement"), 0);
  finish({ uuid: "Actor.b" }); await pending;
  assert.deepEqual(layer.actorUuids, ["Actor.a"]); assert.equal(editor._draft.layers.length, 0); assert.equal(editor._dirty, false);
});

test("designer saves default combined traversal and character transitions without saving its preview Actor", async () => {
  await fixture(); let saved = createWidgetPresetState();
  const store = new WidgetPresetStore({ settings: { get: () => structuredClone(saved), async set(_module, _key, state) { saved = structuredClone(state); } } });
  configureWidgetEditor({ widgetPresets: store, characterData: { fieldDefinitions: () => [] } });
  const editor = new WidgetPresetEditor({ presetId: saved.presets[0].id }); editor.element = new Element();
  await editor._prepareContext({}); const page = addPage(editor._draft, "Enabled page");
  const input = (value, type = "text") => ({ value: String(value), type, checked: value, setCustomValidity() {} });
  editor._onCarouselInput(input("combined"), { field: "mode" });
  editor._onCarouselInput(input("pages-first"), { field: "traversal" });
  editor._onCarouselInput(input("slide-left"), { field: "characterTransition" });
  editor._onCarouselInput(input(650, "number"), { field: "characterTransitionDuration" });
  editor._onCarouselInput(input(false, "checkbox"), { field: "enabled", page }); editor._previewActorUuid = "Actor.private-preview";
  await editor._saveOverlay(); const preset = store.list()[0];
  assert.equal(preset.cycling.mode, "combined"); assert.equal(preset.cycling.traversal, "pages-first");
  assert.equal(preset.cycling.characterTransition, "slide-left"); assert.equal(preset.cycling.characterTransitionDuration, 650); assert.equal(preset.pages[0].enabled, false);
  assert(!JSON.stringify(preset).includes("Actor.private-preview")); assert.equal(Object.hasOwn(preset, "actorUuids"), false);
});
