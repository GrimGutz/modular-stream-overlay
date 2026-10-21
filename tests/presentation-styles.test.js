import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createOverlay, validateLayer, parseValueLabels, OPTIONAL_LAYER_KEYS } from "../scripts/core/schema.js";
import { WidgetRegistry, AdapterRegistry } from "../scripts/core/registry.js";
import { OverlayRenderer } from "../scripts/render/renderer.js";
import { mountCharacterComponent } from "../scripts/render/character-components.js";
import { ACCENT_FIELD, requestedFields, renderTemplate, renderTemplateLines } from "../scripts/data/bindings.js";
import { validateCharacterProfiles } from "../scripts/data/profiles.js";
import { genericAdapter } from "../scripts/adapters/generic.js";
import { CharacterDataService } from "../scripts/data/character-data.js";

class Element {
  constructor(tag) {
    this.tagName = tag; this.style = {}; this.children = []; this.dataset = {}; this.attributes = {}; this.textContent = "";
    this.classList = { add() {} }; this.listeners = new Map();
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  getBoundingClientRect() { return { width: 1920, height: 1080 }; }
}
const text = element => element.children.length ? element.children.map(text).join("") : element.textContent;

beforeEach(() => {
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});

test("optional presentation properties are omitted by default, validated when set and cleared when empty", () => {
  const plain = validateLayer({ id: "plain", type: "dynamic-text" });
  for (const key of OPTIONAL_LAYER_KEYS) assert.equal(Object.hasOwn(plain, key), false, key);
  const styled = validateLayer({ id: "styled", type: "dynamic-text", lineHeight: 1.3, verticalAlign: "middle", richText: true,
    strongColor: "#000000", strongFontSize: 28, accent: true, emptyText: "ЧИСТ", hideEmptyLines: true, valueLabels: "1=Чёрт",
    borderWidth: 3, borderColor: "#111111", cornerRadius: 4, boxShadowY: 3, boxShadowBlur: 6, boxShadowColor: "#00000059" });
  assert.equal(styled.lineHeight, 1.3); assert.equal(styled.emptyText, "ЧИСТ"); assert.equal(styled.boxShadowColor, "#00000059");
  assert.equal(Object.hasOwn(validateLayer({ id: "cleared", type: "text", lineHeight: "" }), "lineHeight"), false);
  const dots = validateLayer({ id: "dots", type: "resource-bar", display: "dots", maxValue: 3, dotSize: 19, dotGap: 19.07, dotBorderWidth: 0 });
  assert.deepEqual([dots.maxValue, dots.dotSize, dots.dotGap, dots.dotBorderWidth], [3, 19, 19.07, 0]);
  assert.equal(validateLayer({ id: "art", type: "character-portrait", imagePosition: "top" }).imagePosition, "top");
  for (const bad of [{ type: "text", verticalAlign: "sideways" }, { type: "color", borderWidth: 100 }, { type: "resource-bar", maxValue: 1.5 },
    { type: "dynamic-text", valueLabels: Array.from({ length: 101 }, (_, index) => `${index}=x`).join("\n") }, { type: "text", highlightColor: "black" }]) {
    assert.throws(() => validateLayer({ id: "bad", ...bad }));
  }
});

test("templates resolve value labels and bold lines without interpreting Actor text as markup", () => {
  const labels = parseValueLabels("1=1 - Чёрт\n2=2 - Дух\nmalformed");
  assert.deepEqual([...labels], [["1", "1 - Чёрт"], ["2", "2 - Дух"]]);
  assert.equal(renderTemplate("{character.cain.cat|label} / {character.cain.cat}", { "character.cain.cat": 2 }, "—", { labels }), "2 - Дух / 2");
  assert.equal(renderTemplate("{character.cain.cat|label}", { "character.cain.cat": 5 }, "—", { labels }), "5");
  const values = { "character.name": "**Змей**", "character.a": "", "character.b": null };
  const lines = renderTemplateLines("Позывной\n**{character.name}**\nA:**{character.a}**\nB:{character.b}", values, { richText: true, hideEmptyLines: true });
  assert.deepEqual(lines, [[{ text: "Позывной", strong: false }], [{ text: "**Змей**", strong: true }], [{ text: "B:—", strong: false }]]);
  assert.deepEqual(requestedFields({ type: "dynamic-text", binding: "character.name", text: "{character.name}", accent: true }), ["character.name", ACCENT_FIELD]);
});

test("box styles and static bold markup render on layer elements", async () => {
  const container = new Element("main");
  const renderer = new OverlayRenderer(container, { widgets: new WidgetRegistry() });
  const overlay = createOverlay();
  overlay.layers = [
    { id: "box", type: "color", color: "#ffffff", borderWidth: 3, borderColor: "#111111", cornerRadius: 6, boxShadowX: 1, boxShadowY: 3, boxShadowBlur: 6, boxShadowColor: "#00000059" },
    { id: "label", type: "text", text: "МИССИЯ **важно**", richText: true, strongColor: "#ff0000", lineHeight: 1.3, verticalAlign: "bottom" }
  ];
  await renderer.render(overlay);
  const box = renderer.layerElements.get("box");
  assert.equal(box.style.border, "3px solid #111111"); assert.equal(box.style.borderRadius, "6px");
  assert.equal(box.style.boxShadow, "1px 3px 6px #00000059");
  const content = renderer.layerElements.get("label").children[0];
  assert.equal(content.style.lineHeight, "1.3"); assert.equal(content.style.justifyContent, "flex-end");
  const [plain, strong] = content.children[0].children;
  assert.equal(plain.textContent, "МИССИЯ "); assert.equal(strong.tagName, "strong");
  assert.equal(strong.textContent, "важно"); assert.equal(strong.style.color, "#ff0000");
  renderer.destroy();
});

function service(values) {
  return { resolve: async (_uuid, fields) => ({ values: Object.fromEntries(fields.map(field => [field, values[field] ?? null])), warning: null }),
    subscribe: () => () => {} };
}
async function mount(layer, values) {
  const element = new Element("div");
  const binding = mountCharacterComponent({ element, layer: validateLayer(layer), context: { actorUuid: "Actor.one", characterData: service(values) } });
  await binding.ready;
  return element;
}

test("character accents, empty captions and markup apply to live text", async () => {
  const accent = await mount({ id: "name", type: "character-name", text: "", color: "#ffc000", accent: true, highlightColor: "#000000" },
    { "character.name": "Глист", [ACCENT_FIELD]: "#0070c0" });
  assert.equal(accent.children[0].style.color, "#0070c0");
  const highlight = accent.children[0].children[0].children[0];
  assert.equal(highlight.textContent, "Глист"); assert.equal(highlight.style.backgroundColor, "#000000");
  const fallback = await mount({ id: "name2", type: "character-name", text: "", color: "#ffc000", accent: true }, { "character.name": "Дед", [ACCENT_FIELD]: "" });
  assert.equal(fallback.children[0].style.color, "#ffc000");
  const empty = await mount({ id: "sin", type: "dynamic-text", text: "{character.cain.sinMarks.summary}", emptyText: "ЧИСТ" }, { "character.cain.sinMarks.summary": "" });
  assert.equal(empty.children[0].textContent, "ЧИСТ");
  const unavailable = await mount({ id: "sin2", type: "dynamic-text", text: "{character.cain.sinMarks.summary}", emptyText: "ЧИСТ" }, {});
  assert.equal(unavailable.children[0].textContent, "—", "Unavailable data never becomes the empty caption");
  const rich = await mount({ id: "powers", type: "dynamic-text", richText: true, hideEmptyLines: true, strongAccent: true, strongColor: "#f79646",
    text: "**{character.cain.blasphemy.label} – {character.p1}**\n{character.d1}\n**{character.cain.blasphemy.label} – {character.p2}**" },
  { "character.cain.blasphemy.label": "Шепот", "character.p1": "Дрожь", "character.d1": "Знать", "character.p2": "", [ACCENT_FIELD]: "#0070c0" });
  const wrapper = rich.children[0].children[0];
  assert.equal(text(wrapper), "Шепот – Дрожь\nЗнать");
  assert.equal(wrapper.children[0].style.color, "#0070c0");
});

test("circle indicators support a fixed count, explicit metrics and an accent fill", async () => {
  const element = await mount({ id: "skill", type: "resource-bar", display: "dots", showValue: false, binding: "character.s", maxBinding: "character.smax",
    maxValue: 3, dotSize: 19, dotGap: 19, dotBorderWidth: 0, foregroundColor: "#f79646", backgroundColor: "#00000000", accent: true },
  { "character.s": 2, "character.smax": 4, [ACCENT_FIELD]: "#ff0000" });
  const dots = element.children[0].children[1].children;
  assert.equal(dots.length, 3);
  assert.deepEqual(dots.map(dot => dot.style.width), ["19px", "19px", "19px"]);
  assert.equal(element.children[0].children[1].style.gap, "19px");
  assert.equal(dots[0].style.borderWidth, "0px");
  assert.deepEqual(dots.map(dot => dot.style.backgroundColor), ["#ff0000", "#ff0000", "transparent"]);
  const portrait = await mount({ id: "art", type: "character-portrait", binding: "character.profile.art", imagePosition: "top" }, { "character.profile.art": "assets/a.png" });
  assert.equal(portrait.children[0].style.objectPosition, "center top");
});

test("character profiles validate and resolve as shared fields with empty defaults and portrait fallback", async () => {
  assert.deepEqual(validateCharacterProfiles({ "Actor.one": { accent: "#F79646", fullName: " Хикару Флекс ", art: "" }, "Actor.two": { accent: "" } }),
    { "Actor.one": { accent: "#f79646", fullName: "Хикару Флекс" } });
  for (const bad of [{ "Token.x": {} }, { "Actor.one": { accent: "orange" } }, { "Actor.one": { art: "../secret.png" } }, { "Actor.one": { art: "https://user:pw@example.com/a.png" } }]) {
    assert.throws(() => validateCharacterProfiles(bad));
  }
  const user = { id: "viewer" };
  const actors = ["one", "two"].map(id => ({ uuid: `Actor.${id}`, documentName: "Actor", type: "character", name: id, img: `assets/${id}.png`, system: {},
    testUserPermission: (viewer, permission) => viewer?.id === user.id && permission === "OBSERVER" }));
  const registry = new AdapterRegistry(); registry.register(genericAdapter);
  let profiles = { "Actor.one": { accent: "#f79646", fullName: "Хикару Флекс", art: "assets/full.png" } };
  const data = new CharacterDataService({ adapters: registry, getUser: () => user, getSystemId: () => "test", getActors: () => ({ contents: actors }),
    resolveUuid: async uuid => actors.find(actor => actor.uuid === uuid), hooks: null, getProfiles: () => profiles });
  const fields = ["character.profile.accent", "character.profile.fullName", "character.profile.art"];
  assert.deepEqual((await data.resolve("Actor.one", fields)).values, { "character.profile.accent": "#f79646", "character.profile.fullName": "Хикару Флекс", "character.profile.art": "assets/full.png" });
  const unset = await data.resolve("Actor.two", fields);
  assert.deepEqual(unset.values, { "character.profile.accent": "", "character.profile.fullName": "", "character.profile.art": "assets/two.png" });
  assert.equal(unset.warning, null);
  profiles = { broken: true };
  assert.equal((await data.resolve("Actor.one", ["character.profile.accent"])).values["character.profile.accent"], "", "Invalid settings expose no stale values");
  assert.equal(new CharacterDataService({ adapters: registry, hooks: null }).fieldDefinitions().some(field => field.id === "character.profile.accent"), false);
});
