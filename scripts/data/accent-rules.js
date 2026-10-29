import { validateCharacterBinding } from "../core/schema.js";

/**
 * Character colors by the value of one character field, for any game system: for example a
 * color per CAIN blasphemy or per D&D class. A world GM setting; a character's own profile
 * color still wins, and values without a color keep the system's own color.
 */
export const ACCENT_RULES_SETTING = "accentRules";
export const ACCENT_RULE_LIMIT = 200;
const COLOR = /^#[\da-f]{6}$/i;

const key = value => String(value ?? "").trim().toLocaleLowerCase();

/** `{ field, colors }`: field "" means the system's suggestion; colors map a field value to "#rrggbb". */
export function validateAccentRules(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Character color rules must be an object.");
  const field = typeof input.field === "string" && input.field.trim() ? validateCharacterBinding(input.field.trim()) : "";
  const source = input.colors ?? {};
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new TypeError("Character color rules must map values to colors.");
  const entries = Object.entries(source);
  if (entries.length > ACCENT_RULE_LIMIT) throw new TypeError("Character color rules hold at most 200 values.");
  const colors = {}, seen = new Set();
  for (const [rawValue, rawColor] of entries) {
    const value = String(rawValue).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
    const color = typeof rawColor === "string" ? rawColor.trim().toLowerCase() : "";
    if (!value || !color) continue;
    if (!COLOR.test(color)) throw new TypeError("Character colors must be hexadecimal colors such as #9966ff.");
    if (seen.has(key(value))) throw new TypeError("Each value may have only one character color.");
    seen.add(key(value));
    colors[value] = color;
  }
  return { field, colors };
}

/**
 * The color set for a field value, ignoring case and surrounding spaces; "" when none is set.
 * A value listing several names one per line (two blasphemies) takes its first listed match.
 */
export function ruleColor(rules, value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const colors = new Map(Object.entries(rules?.colors ?? {}).map(([entry, color]) => [key(entry), color]));
  for (const candidate of [value, ...value.split(/\r?\n/)]) {
    const color = colors.get(key(candidate));
    if (color) return color;
  }
  return "";
}
