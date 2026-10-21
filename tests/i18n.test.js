import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import english from "../lang/en.json" with { type: "json" };
import russian from "../lang/ru.json" with { type: "json" };
import { normalizeLanguage, getLanguage, getLanguagePreference, t, errorText,
  registerLocalization, setLanguagePreference, onLanguageChange, localizeDOM, setText, setAttr } from "../scripts/ui/i18n.js";
import { fieldLabel } from "../scripts/ui/field-settings.js";
import { CAIN_COLLECTION_FIELDS } from "../scripts/adapters/cain-collections.js";

const MODULE_ID = "modular-stream-overlay";
function client(language = "en-US", stored = new Map()) {
  const definitions = new Map(), writes = [];
  globalThis.game = { i18n: { lang: language, setLanguage: () => assert.fail("Global language must not change") }, settings: {
    settings: definitions,
    register(id, key, data) { data.id = `${id}.${key}`; definitions.set(data.id, data); if (!stored.has(data.id)) stored.set(data.id, data.default); },
    get(id, key) { return stored.get(`${id}.${key}`); },
    async set(id, key, value) { const name = `${id}.${key}`; writes.push(name); stored.set(name, value); definitions.get(name)?.onChange?.(value); return value; }
  } };
  registerLocalization();
  return { stored, definitions, writes };
}
function entries(value, prefix = "", result = {}) {
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === "string") result[path] = entry;
    else entries(entry, path, result);
  }
  return result;
}

test("Auto uses public Foundry language, regional variants and English fallback", () => {
  for (const [input, expected] of [["ru", "ru"], ["ru-RU", "ru"], ["RU_ru", "ru"], ["ru.ru-ru", "ru"], ["en-US", "en"], ["de", "en"], [undefined, "en"]]) {
    client(input); assert.equal(normalizeLanguage(input), expected); assert.equal(getLanguagePreference(), "auto"); assert.equal(getLanguage(), expected);
  }
});

test("manual overrides are client-scoped, persist on a new client initialization and never set core language", async () => {
  const first = client("en-US");
  assert.equal(first.definitions.get(`${MODULE_ID}.interfaceLanguage`).scope, "client");
  assert.equal(first.definitions.get(`${MODULE_ID}.interfaceLanguage`).requiresReload, undefined);
  let changes = 0; const unsubscribe = onLanguageChange(() => changes++);
  await setLanguagePreference("ru");
  assert.equal(getLanguage(), "ru"); assert.equal(game.i18n.lang, "en-US");
  client("en-US", first.stored); assert.equal(getLanguage(), "ru");
  const second = client("ru-RU"); await setLanguagePreference("en");
  assert.equal(getLanguage(), "en"); assert.equal(game.i18n.lang, "ru-RU");
  assert.equal(changes, 2); unsubscribe();
  assert.deepEqual(first.writes, [`${MODULE_ID}.interfaceLanguage`]);
  assert.deepEqual(second.writes, [`${MODULE_ID}.interfaceLanguage`]);
  assert.throws(() => setLanguagePreference("de"), /auto, en, or ru/);
});

test("dictionaries use manifest namespace, cover the same keys and preserve parameter names", async () => {
  const en = entries(english), ru = entries(russian);
  assert(Object.keys(en).length > 300);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  for (const [key, value] of Object.entries(en)) {
    assert(key.startsWith(`${MODULE_ID}.`)); assert(ru[key].trim(), key);
    const params = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(params(value), params(ru[key]), key);
  }
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url)));
  assert.deepEqual(manifest.languages.map(({ lang, path }) => [lang, path]), [["en", "lang/en.json"], ["ru", "lang/ru.json"]]);
});

test("parameter substitution preserves user content and a missing Russian key falls back to English", () => {
  client("ru-RU");
  const name = 'Alice <script> & Русское имя';
  assert.equal(t("Widgets.PreviewActorName", { name }), name);
  const settings = russian[MODULE_ID].Settings, value = settings.LanguageHint;
  try { delete settings.LanguageHint; assert.equal(t("Settings.LanguageHint"), english[MODULE_ID].Settings.LanguageHint); }
  finally { settings.LanguageHint = value; }
  assert.equal(t("Settings.LanguageHint", {}, "unsupported"), english[MODULE_ID].Settings.LanguageHint);
  assert.equal(errorText("External error: custom asset.webp"), "External error: custom asset.webp");
});

test("core validation errors translate only at the interface boundary", () => {
  client("ru");
  assert(!errorText("Canvas width must be an integer between 64 and 7680.").includes("must be"));
  assert(!errorText("Only a Game Master can change stream overlays.").includes("Only"));
  assert.equal(t("Editor.ResourceDots"), "Кружки");
  assert.equal(errorText("Choose bar or dots for resource display."), "Выберите полосу или кружки для индикатора ресурса.");
  client("en"); assert.equal(errorText(new Error("Only a Game Master can change stream overlays.")), "Only a Game Master can change stream overlays.");
});

test("marked label refresh preserves nested controls, user values and unmarked content", async () => {
  const attrs = new Map();
  const input = { value: 'Unsaved custom text', nodeType: 1 };
  const text = { nodeType: 3, textContent: "English label" };
  const element = { childNodes: [text, input], querySelectorAll: () => [],
    get attributes() { return [...attrs].map(([name, value]) => ({ name, value })); },
    setAttribute: (name, value) => attrs.set(name, value), getAttribute: name => attrs.get(name), removeAttribute: name => attrs.delete(name), matches: () => true };
  text.parentNode = element;
  client("en"); setText(element, "Settings.Editor.Label");
  await setLanguagePreference("ru"); localizeDOM(element);
  assert.equal(text.textContent, t("Settings.Editor.Label"));
  assert.equal(element.childNodes[1], input); assert.equal(input.value, "Unsaved custom text");
});

test("parameterized attributes retain independent values when another caption is marked", async () => {
  const attrs = new Map();
  const element = { querySelectorAll: () => [], matches: () => true,
    get attributes() { return [...attrs].map(([name, value]) => ({ name, value })); },
    setAttribute: (name, value) => attrs.set(name, value), getAttribute: name => attrs.get(name) };
  client("ru");
  setAttr(element, "title", "Canvas.LockedLayer", { name: "First user name" });
  setAttr(element, "aria-label", "Canvas.LockedLayer", { name: "Second user name" });
  setAttr(element, "placeholder", "Buttons.Save");
  await setLanguagePreference("en"); localizeDOM(element);
  assert.equal(attrs.get("title"), "First user name (locked)");
  assert.equal(attrs.get("aria-label"), "Second user name (locked)");
  assert.equal(attrs.get("placeholder"), "Save");
});

test("built-in field captions translate while mappings and external provider captions stay authored", () => {
  client("ru");
  const definition = { label: "Health percent", group: "Resources", status: "available" };
  assert(!fieldLabel({ ...definition, providerId: "derived" }).includes("Health percent"));
  assert.equal(fieldLabel({ ...definition, providerId: "mapping" }), "Resources · Health percent");
  assert.equal(fieldLabel({ ...definition, providerId: "third-party" }), "Resources · Health percent");
});

test("CAIN collection field captions translate without translating their normalized IDs or stream data", () => {
  client("ru");
  for (const field of CAIN_COLLECTION_FIELDS) {
    const label = fieldLabel({ ...field, providerId: "cain", status: "available" });
    assert(!label.includes(field.label), field.id);
    assert(label.startsWith("Подробности персонажа · "));
    assert(field.id.startsWith("character.cain."));
  }
  client("en");
  for (const field of CAIN_COLLECTION_FIELDS) assert.equal(fieldLabel({ ...field, providerId: "cain", status: "available" }), `Character details · ${field.label}`);
});

test("document refresh ignores translation markers belonging to other modules", async () => {
  const previousDocument = globalThis.document;
  const foreign = { textContent: "Another module's caption", querySelectorAll: () => [],
    getAttribute: name => name === "data-i18n" ? "OtherModule.Title" : null };
  globalThis.document = { querySelectorAll: selector => selector === ".mso-editor, [data-mso-i18n]" ? [] : [foreign] };
  try { client("en"); await setLanguagePreference("ru"); assert.equal(foreign.textContent, "Another module's caption"); }
  finally { globalThis.document = previousDocument; }
});
