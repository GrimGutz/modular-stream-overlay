import { CHARACTER_FIELD_PATTERN } from "../core/schema.js";

/** Templates contain field references only. The renderer assigns the result as textContent. */
export const FIELD_ID = CHARACTER_FIELD_PATTERN;
/** Per-character presentation values from the module's own Character profiles setting. */
export const ACCENT_FIELD = "character.profile.accent";
// `{field|label}` displays the layer's value label for that field's value.
const TOKEN = /\{(character(?:\.[A-Za-z][A-Za-z0-9_]{0,47}){1,5})(\|label)?\}/g;

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
    if (layer.accent === true || layer.strongAccent === true) fields.add(ACCENT_FIELD);
  }
  return [...fields];
}

const blank = value => typeof value === "string" && !value.trim();

/**
 * Lines of {text, strong} segments. `**` markup is split from the template before
 * substitution, so Actor text is never interpreted as markup. Bold does not span lines.
 * Hidden lines are those whose fields resolve to an empty text; unavailable values
 * still show the fallback rather than disappearing.
 */
export function renderTemplateLines(template, values = {}, { fallback = "—", labels, richText = false, hideEmptyLines = false } = {}) {
  const source = typeof template === "string" ? template.slice(0, 10000) : "";
  const lines = [];
  for (const line of source.split("\n")) {
    const tokens = [...line.matchAll(TOKEN)];
    if (hideEmptyLines && tokens.some(match => blank(values?.[match[1]]))) continue;
    const parts = richText ? line.split("**") : [line];
    const segments = parts.map((part, index) => ({ text: renderTemplate(part, values, fallback, { labels }), strong: index % 2 === 1 }))
      .filter(segment => segment.text);
    // A value label can also blank a field line, e.g. mapping a system's "—" to nothing.
    if (hideEmptyLines && tokens.length && segments.every(segment => !segment.text.trim())) continue;
    lines.push(segments);
  }
  return lines;
}

export function renderTemplate(template, values = {}, fallback = "—", { labels } = {}) {
  const replacement = typeof fallback === "string" ? fallback.slice(0, 10000) : "—";
  if (typeof template !== "string") return replacement;
  const source = template.slice(0, 10000);
  let result = "", cursor = 0;
  for (const match of source.matchAll(TOKEN)) {
    result += source.slice(cursor, match.index).slice(0, 10000 - result.length);
    if (result.length === 10000) return result;
    const value = values && typeof values === "object" && Object.hasOwn(values, match[1]) ? values[match[1]] : null;
    const available = (typeof value === "number" && Number.isFinite(value)) || typeof value === "string";
    let content = available ? String(value) : replacement;
    if (match[2] && available && labels?.has(content)) content = labels.get(content);
    result += content.slice(0, 10000 - result.length);
    cursor = match.index + match[0].length;
    if (result.length === 10000) return result;
  }
  return result + source.slice(cursor).slice(0, 10000 - result.length);
}
