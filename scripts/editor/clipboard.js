/**
 * Layer clipboard. Copied layers go to the system clipboard as JSON text, so they move between
 * editor windows, worlds and browsers; a copy kept in memory covers browsers that refuse
 * clipboard access. Clipboard text is untrusted: pasted layers are validated again on insertion.
 */
export const CLIPBOARD_FORMAT = "modular-stream-overlay/layers";
const MAX_TEXT = 4 * 1024 * 1024;
const MAX_LAYERS = 100;
let remembered = null;

export function serializeLayers(layers) {
  return JSON.stringify({ format: CLIPBOARD_FORMAT, version: 1, layers });
}

/** Layers from clipboard text, or null when the text holds something else. */
export function parseLayers(text) {
  if (typeof text !== "string" || text.length > MAX_TEXT || !text.trimStart().startsWith("{")) return null;
  let data;
  try { data = JSON.parse(text); }
  catch { return null; }
  if (data?.format !== CLIPBOARD_FORMAT || !Array.isArray(data.layers) || !data.layers.length || data.layers.length > MAX_LAYERS) return null;
  return data.layers.every(layer => layer && typeof layer === "object" && !Array.isArray(layer) && typeof layer.type === "string") ? data.layers : null;
}

export function rememberLayers(layers) { remembered = layers?.length ? structuredClone(layers) : null; }
export function rememberedLayers() { return remembered ? structuredClone(remembered) : null; }
