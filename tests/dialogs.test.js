import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createOverlay, createState } from "../scripts/core/schema.js";
import { createWidgetPreset } from "../scripts/core/widget-presets.js";

/** A dialog-focused DOM double: HTML reconstruction copies attributes/content, never listeners or input.value. */
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.attrs = new Map(); this.listeners = new Map(); this._text = "";
  }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this._text = ""; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  set value(value) { if (this.tagName === "OPTION") this.setAttribute("value", value); else this._value = String(value); }
  get value() { return this._value ?? this.getAttribute("value") ?? (this.tagName === "SELECT" ? this.children[0]?.value : "") ?? ""; }
  addEventListener(type, callback) { const list = this.listeners.get(type) ?? []; list.push(callback); this.listeners.set(type, list); }
  dispatch(type) { for (const callback of this.listeners.get(type) ?? []) callback({ target: this, currentTarget: this }); }
  focus() { this.focused = true; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const matches = element => {
      if (selector.startsWith(".")) return element.className.split(" ").includes(selector.slice(1));
      const attribute = selector.match(/^(\w+)?\[([^=]+)="([^"]+)"\]$/);
      if (attribute) return (!attribute[1] || element.tagName === attribute[1].toUpperCase()) && element.getAttribute(attribute[2]) === attribute[3];
      return element.tagName === selector.toUpperCase();
    };
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  cloneHTML() {
    const copy = new Element(this.tagName);
    for (const [name, value] of this.attrs) copy.setAttribute(name, value);
    copy._text = this._text; copy.append(...this.children.map(child => child.cloneHTML()));
    return copy;
  }
}
for (const property of ["className", "name", "type", "placeholder", "alt", "src", "maxLength", "required", "autofocus"]) {
  const attribute = property === "className" ? "class" : property.toLowerCase();
  Object.defineProperty(Element.prototype, property, {
    get() { return this.getAttribute(attribute) ?? ""; }, set(value) { this.setAttribute(attribute, value); }
  });
}

const dialogs = {};
globalThis.foundry = {
  applications: { api: { ApplicationV2: class { constructor() { this.rendered = false; } }, HandlebarsApplicationMixin: Base => Base, DialogV2: dialogs } },
  utils: { deepClone: structuredClone, getRoute: value => `/prefix/${value}` }
};
const { OverlayEditor, configureEditor } = await import("../scripts/ui/editor.js");

beforeEach(() => {
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  globalThis.game = { modules: new Map() };
});

function fixture() {
  const overlay = createOverlay();
  const preset = createWidgetPreset("Shared card");
  const state = { ...createState(), revision: 5, overlays: [overlay] };
  const actors = [
    { uuid: "Actor.alpha", name: '<img src=x onerror=alert(1)>', portrait: "portraits/alpha.webp" },
    { uuid: "Actor.bravo", name: "Bravo", portrait: "https://images.example.test/bravo.webp" }
  ];
  const resolved = [];
  configureEditor({ store: { getState: () => structuredClone(state), listPresets: () => [] },
    widgetPresets: { list: () => [preset] }, characterData: {
      listActors: () => actors,
      async resolveActor(reference) { resolved.push(reference); return actors.find(actor => actor.uuid === reference); }
    } });
  const editor = new OverlayEditor(); editor._loadDraft(overlay, 5);
  editor.element = { querySelector: () => null, querySelectorAll: () => [] };
  return { editor, actors, resolved, state, preset };
}

/** Match Foundry v14 DialogV2's attribute-free DIV and innerHTML reconstruction contract. */
function reconstruct(options) {
  assert.equal(options.content.tagName, "DIV", "DialogV2 requires a DIV container");
  assert.equal(options.content.attributes.length, 0, "DialogV2 rejects attributes on its content root");
  const element = new Element("dialog");
  element.append(...options.content.children.map(child => child.cloneHTML()));
  options.render?.({}, { element });
  return element;
}

test("Actor picker survives DialogV2 HTML reconstruction with working search, portraits and row selection", async () => {
  const f = fixture();
  dialogs.input = async options => {
    const element = reconstruct(options);
    const search = element.querySelector('input[type="search"]');
    const list = element.querySelector(".mso-actor-list");
    assert.equal(list.children.length, 2);
    assert.equal(list.children[0].children[1].textContent, f.actors[0].name);
    assert.equal(list.children[0].children[1].children.length, 0, "Actor names stay literal text");
    assert.equal(list.children[0].children[0].src, "/prefix/portraits/alpha.webp");
    assert.equal(list.children[1].children[0].src, f.actors[1].portrait);
    search.value = "No matching actor"; search.dispatch("input");
    assert.match(list.textContent, /No matching permitted Actors/);
    search.value = "bRaVo"; search.dispatch("input");
    assert.equal(list.children.length, 1); assert.equal(list.children[0].textContent, "Bravo");
    list.children[0].dispatch("click");
    const reference = element.querySelector('[name="actorReference"]');
    assert.equal(reference.value, "Actor.bravo"); assert.equal(reference.focused, true);
    return { actorReference: reference.value };
  };
  assert.equal(await f.editor._chooseActor(), f.actors[1]);
  assert.deepEqual(f.resolved, ["Actor.bravo"]);
});

test("Actor picker cancellation and an empty assignment remain distinct and never resolve an Actor", async () => {
  const f = fixture();
  dialogs.input = async options => { reconstruct(options); return null; };
  assert.equal(await f.editor._chooseActor(), undefined);
  dialogs.input = async options => { const element = reconstruct(options); return { actorReference: element.querySelector('[name="actorReference"]').value }; };
  assert.equal(await f.editor._chooseActor(), null);
  assert.deepEqual(f.resolved, []); assert.equal(f.editor._dirty, false);
});

test("Add widget completes both reconstructed dialogs and keeps the assigned character in the draft until Save", async () => {
  const f = fixture(); const titles = [];
  dialogs.input = async options => {
    titles.push(options.window.title);
    const element = reconstruct(options);
    const preset = element.querySelector('[name="presetId"]');
    if (preset) return { presetId: preset.value };
    const rows = element.querySelector(".mso-actor-list"); rows.children[1].dispatch("click");
    return { actorReference: element.querySelector('[name="actorReference"]').value };
  };
  await f.editor._addWidget();
  assert.deepEqual(titles, ["Add widget · Choose preset", "Assign character"]);
  assert.equal(f.editor._draft.layers.length, 1);
  assert.equal(f.editor._draft.layers[0].actorUuid, "Actor.bravo");
  assert.equal(f.editor._draft.layers[0].presetId, f.preset.id);
  assert.equal(f.state.overlays[0].layers.length, 0);
  assert.equal(f.editor._dirty, true);
});
