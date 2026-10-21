import english from "../../lang/en.json" with { type: "json" };
import russian from "../../lang/ru.json" with { type: "json" };
import { MODULE_ID } from "../core/schema.js";

export const LANGUAGE_SETTING = "interfaceLanguage";
const dictionaries = { en: english, ru: russian };
const listeners = new Set();
const textNodes = new WeakMap();
const settingsMetadata = [];

function flatten(value, prefix = "", result = new Map()) {
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === "string") result.set(path, entry);
    else if (entry && typeof entry === "object") flatten(entry, path, result);
  }
  return result;
}
const englishEntries = flatten(english);
const reverse = new Map([...englishEntries].map(([key, value]) => [value, key]));
const patternEntries = [...englishEntries].filter(([key, value]) => key.startsWith(`${MODULE_ID}.Validation.`) && /\{\w+\}/.test(value)).map(([key, value]) => {
  const names = [];
  let source = "", offset = 0;
  for (const match of value.matchAll(/\{(\w+)\}/g)) {
    source += value.slice(offset, match.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([\\s\\S]+?)";
    names.push(match[1]); offset = match.index + match[0].length;
  }
  source += value.slice(offset).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { key, names, regex: new RegExp(`^${source}$`) };
});

/** Foundry exposes the selected interface language as game.i18n.lang. */
export function normalizeLanguage(value) {
  return /^ru(?:[-_.]|$)/i.test(String(value ?? "")) ? "ru" : "en";
}
export function getLanguagePreference() {
  let value;
  try { value = globalThis.game?.settings?.get(MODULE_ID, LANGUAGE_SETTING); } catch { /* Before init. */ }
  return ["en", "ru"].includes(value) ? value : "auto";
}
export function getLanguage() {
  const preference = getLanguagePreference();
  return preference === "auto" ? normalizeLanguage(globalThis.game?.i18n?.lang) : preference;
}
function lookup(dictionary, key) {
  return key.split(".").reduce((value, part) => Object.hasOwn(value ?? {}, part) ? value[part] : undefined, dictionary);
}
export function translate(key, parameters = {}, language = getLanguage()) {
  const fullKey = key.startsWith(`${MODULE_ID}.`) ? key : `${MODULE_ID}.${key}`;
  const value = lookup(dictionaries[language] ?? english, fullKey) ?? lookup(english, fullKey) ?? fullKey;
  return String(value).replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(parameters, name) ? String(parameters[name]) : match);
}
export const t = translate;

/** For module-owned schema labels only. Never pass user-authored text here. */
export function uiText(value) {
  const key = reverse.get(String(value));
  return key ? t(key) : String(value ?? "");
}
export function setUIText(element, literal) {
  const key = reverse.get(String(literal));
  if (key) return setText(element, key);
  element.textContent = String(literal ?? "");
  return element;
}
export function setUIAttr(element, attribute, literal) {
  const key = reverse.get(String(literal));
  if (key) return setAttr(element, attribute, key);
  element.setAttribute(attribute, String(literal ?? ""));
  return element;
}

/** Translate errors at the UI boundary; validators and broadcast strings stay unchanged. */
export function errorText(error, depth = 0) {
  const message = String(error?.message ?? error ?? "");
  if (getLanguage() === "en") return message;
  const key = reverse.get(message);
  if (key) return t(key);
  if (depth > 2) return message;
  for (const entry of patternEntries) {
    const match = message.match(entry.regex);
    if (!match) continue;
    const params = Object.fromEntries(entry.names.map((name, index) => [name,
      name === "reason" || name === "error" ? errorText(match[index + 1], depth + 1)
        : ["label", "kind", "suffix"].includes(name) ? uiText(match[index + 1]) : match[index + 1]]));
    return t(entry.key, params);
  }
  return message;
}

function storeParams(element, params, target) {
  element.setAttribute?.(`data-i18n-params-${target}`, JSON.stringify(params));
}
function readParams(element, target) {
  const common = Object.fromEntries([...(element.attributes ?? [])].filter(attr => attr.name.startsWith("data-i18n-param-")).map(attr => [
    attr.name.slice(16).replace(/-([a-z])/g, (_match, char) => char.toUpperCase()), attr.value
  ]));
  const serialized = element.getAttribute?.(`data-i18n-params-${target}`);
  if (!serialized) return common;
  try { return { ...common, ...JSON.parse(serialized) }; } catch { return common; }
}
function updateText(element, key, params) {
  let node = textNodes.get(element);
  if (!node || node.parentNode !== element) {
    node = [...(element.childNodes ?? [])].find(child => child.nodeType === 3 && child.textContent.trim());
    if (!node && element.ownerDocument?.createTextNode) {
      node = element.ownerDocument.createTextNode(""); element.prepend(node);
    }
    if (node) textNodes.set(element, node);
  }
  if (node) node.textContent = t(key, params);
  else element.textContent = t(key, params);
}
export function setText(element, key, params = {}) {
  element.setAttribute?.("data-mso-i18n", "");
  element.setAttribute?.("data-i18n", key);
  storeParams(element, params, "text");
  updateText(element, key, params);
  return element;
}
export function setAttr(element, attribute, key, params = {}) {
  element.setAttribute?.("data-mso-i18n", "");
  element.setAttribute?.(`data-i18n-${attribute}`, key);
  storeParams(element, params, attribute);
  element.setAttribute(attribute, t(key, params));
  return element;
}
/** Only marked configuration UI is touched; user content and renderer trees are excluded. */
export function localizeDOM(root) {
  if (!root?.querySelectorAll) return;
  if (root === globalThis.document) {
    for (const scope of root.querySelectorAll(".mso-editor, [data-mso-i18n]")) localizeDOM(scope);
    return;
  }
  const selector = "[data-i18n], [data-i18n-title], [data-i18n-aria-label], [data-i18n-placeholder], [data-i18n-alt]";
  const nodes = [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
  for (const element of nodes) {
    const key = element.getAttribute?.("data-i18n");
    if (key) updateText(element, key, readParams(element, "text"));
    for (const attr of ["title", "aria-label", "placeholder", "alt"]) {
      const attrKey = element.getAttribute?.(`data-i18n-${attr}`);
      if (attrKey) element.setAttribute(attr, t(attrKey, readParams(element, attr)));
    }
  }
}
export function onLanguageChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
export function refreshLanguage() {
  for (const { data, keys } of settingsMetadata) for (const [field, key] of Object.entries(keys)) data[field] = t(key);
  localizeSettingsDOM(globalThis.document);
  localizeDOM(globalThis.document);
  for (const listener of listeners) listener();
}
/** Foundry's own settings form keeps its values; update only our registered captions. */
export function localizeSettingsDOM(root) {
  if (!root?.querySelector) return;
  for (const { data, keys } of settingsMetadata) {
    const id = data.id ?? (String(data.key ?? "").startsWith(`${MODULE_ID}.`) ? data.key : `${MODULE_ID}.${data.key}`);
    const input = root.querySelector(`[name="${id}"], button[data-key="${id}"]`);
    const group = input?.closest?.(".form-group");
    if (!group) continue;
    const caption = group.querySelector("label");
    if (caption && keys.name) setText(caption, keys.name);
    const hint = group.querySelector(".hint");
    if (hint && keys.hint) setText(hint, keys.hint);
    const buttonLabel = input.matches?.("button") ? input.querySelector("span") : null;
    if (buttonLabel && keys.label) setText(buttonLabel, keys.label);
  }
}
export function setLanguagePreference(value) {
  if (!["auto", "en", "ru"].includes(value)) throw new TypeError("Choose auto, en, or ru.");
  return game.settings.set(MODULE_ID, LANGUAGE_SETTING, value);
}
export function localizeSetting(data, keys) {
  settingsMetadata.push({ data, keys });
  for (const [field, key] of Object.entries(keys)) data[field] = t(key);
  return data;
}
export function registerLocalization() {
  game.settings.register(MODULE_ID, LANGUAGE_SETTING, {
    name: "Interface Language / Язык интерфейса", hint: t("Settings.LanguageHint"),
    scope: "client", config: true, type: String, default: "auto",
    choices: { auto: "Auto / Автоматически", en: "English", ru: "Русский" },
    onChange: refreshLanguage
  });
  const definition = game.settings.settings?.get(`${MODULE_ID}.${LANGUAGE_SETTING}`);
  if (definition) localizeSetting(definition, { hint: "Settings.LanguageHint" });
  registerHandlebars();
}
export function registerHandlebars() {
  globalThis.Handlebars?.registerHelper("msoT", (key, options) => t(key, options?.hash ?? {}));
}
registerHandlebars();
