import { CHARACTER_FIELD_PATTERN } from "../core/schema.js";

/** Templates contain field references only. The renderer assigns the result as textContent. */
export const FIELD_ID = CHARACTER_FIELD_PATTERN;
const TOKEN = /\{(character(?:\.[A-Za-z][A-Za-z0-9_]{0,47}){1,5})\}/g;

export function templateFields(template) {
  if (typeof template !== "string") return [];
  return [...new Set([...template.slice(0, 10000).matchAll(TOKEN)].map(match => match[1]))];
}

export function requestedFields(layer) {
  if (!layer || typeof layer !== "object") return [];
  const fields = new Set();
  if (["character-portrait", "character-name", "dynamic-text", "dynamic-number", "resource-bar"].includes(layer.type)) {
    if (FIELD_ID.test(layer.binding)) fields.add(layer.binding);
    if (layer.type === "resource-bar" && FIELD_ID.test(layer.maxBinding)) fields.add(layer.maxBinding);
    if (layer.type !== "character-portrait" && layer.type !== "resource-bar") {
      for (const field of templateFields(layer.text)) fields.add(field);
    }
  }
  return [...fields];
}

export function renderTemplate(template, values = {}, fallback = "—") {
  const replacement = typeof fallback === "string" ? fallback.slice(0, 10000) : "—";
  if (typeof template !== "string") return replacement;
  const source = template.slice(0, 10000);
  let result = "", cursor = 0;
  for (const match of source.matchAll(TOKEN)) {
    result += source.slice(cursor, match.index).slice(0, 10000 - result.length);
    if (result.length === 10000) return result;
    const value = values && typeof values === "object" && Object.hasOwn(values, match[1]) ? values[match[1]] : null;
    const content = (typeof value === "number" && Number.isFinite(value)) || typeof value === "string" ? String(value) : replacement;
    result += content.slice(0, 10000 - result.length);
    cursor = match.index + match[0].length;
    if (result.length === 10000) return result;
  }
  return result + source.slice(cursor).slice(0, 10000 - result.length);
}
