import { clone, validateLayer, validateWidgetPreset } from "./schema.js";

function newId() {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `layer-${random}`;
}

/** Ordered low-to-high exactly as the shared renderer orders legacy widgets and layers. */
function stack(overlay) {
  return [...(overlay.layers ?? []), ...(overlay.widgets ?? [])]
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (a.entry.z ?? a.index) - (b.entry.z ?? b.index) || a.index - b.index)
    .map(({ entry }) => entry);
}

/** Create a standalone layer; the editor decides when to insert it into a draft. */
export function createLayer(type, canvas = { width: 1920, height: 1080 }) {
  const defaults = {
    id: newId(), type, x: 0, y: 0, width: Math.min(canvas.width, 640),
    height: Math.min(canvas.height, 360), z: 0
  };
  if (type === "image") Object.assign(defaults, { name: "Image layer", src: "", fit: "contain", lockAspectRatio: true });
  if (type === "text") Object.assign(defaults, { name: "Text layer", text: "New text", width: Math.min(canvas.width, 640), height: Math.min(canvas.height, 120) });
  if (type === "character-portrait") Object.assign(defaults, { name: "Character portrait", width: Math.min(canvas.width, 160), height: Math.min(canvas.height, 160) });
  if (["character-name", "dynamic-text", "dynamic-number"].includes(type)) Object.assign(defaults, {
    height: Math.min(canvas.height, 64), fontSize: type === "dynamic-text" ? 24 : 32
  });
  if (type === "resource-bar") Object.assign(defaults, {
    name: "Health / resource bar", width: Math.min(canvas.width, 300), height: Math.min(canvas.height, 36), fontSize: 20, align: "center"
  });
  return validateLayer(defaults, canvas);
}

/** Instances reference a shared design; their Actor binding and overrides remain independent. */
export function createWidgetInstance(input, options = {}) {
  const preset = validateWidgetPreset(input);
  return validateLayer({
    name: preset.name, x: 0, y: 0,
    width: preset.canvas.width, height: preset.canvas.height, z: 0,
    ...options, id: newId(), type: "character-widget", presetId: preset.id
  });
}

/** Duplicate only ordinary layers, preserving extension configuration and stable source IDs. */
export function duplicateLayer(overlay, id) {
  const source = (overlay.layers ?? []).find(entry => entry.id === id);
  if (!source) return null;
  if (overlay.layers.length >= 100) throw new RangeError("An overlay supports at most 100 layers.");
  const copy = clone(source);
  const ordered = stack(overlay);
  const ids = new Set(ordered.map(entry => entry.id));
  do { copy.id = newId(); } while (ids.has(copy.id));
  copy.name = `${(source.name ?? "Layer").slice(0, 75)} copy`;
  copy.x = Math.min(32768, (source.x ?? 0) + 20);
  copy.y = Math.min(32768, (source.y ?? 0) + 20);
  const highest = Math.max(-1, ...ordered.map(entry => entry.z ?? 0));
  // Existing maximum-z layouts still allow a copy above all rendered elements.
  copy.z = highest >= 10000 ? ordered.length : highest + 1;
  const result = validateLayer(copy, overlay.canvas);
  if (highest >= 10000) ordered.forEach((entry, index) => { entry.z = index; });
  overlay.layers.push(result);
  return result;
}

/**
 * Insert a copied layer above everything with a fresh ID. While another layer already sits at
 * the same position it is offset by 20 px, so repeated pastes fan out instead of stacking.
 */
export function pasteLayer(overlay, source) {
  if ((overlay.layers ?? []).length >= 100) throw new RangeError("An overlay supports at most 100 layers.");
  const copy = clone(source);
  const ordered = stack(overlay);
  const ids = new Set(ordered.map(entry => entry.id));
  do { copy.id = newId(); } while (ids.has(copy.id));
  for (let step = 0; step < 50 && ordered.some(entry => entry.x === copy.x && entry.y === copy.y); step++) {
    copy.x = Math.min(32768, (copy.x ?? 0) + 20);
    copy.y = Math.min(32768, (copy.y ?? 0) + 20);
  }
  const highest = Math.max(-1, ...ordered.map(entry => entry.z ?? 0));
  copy.z = highest >= 10000 ? ordered.length : highest + 1;
  const result = validateLayer(copy, overlay.canvas);
  if (highest >= 10000) ordered.forEach((entry, index) => { entry.z = index; });
  overlay.layers.push(result);
  return result;
}

/** Remove a layer from a draft without changing unrelated layers or widgets. */
export function deleteLayer(overlay, id) {
  const index = (overlay.layers ?? []).findIndex(entry => entry.id === id);
  if (index < 0) return false;
  overlay.layers.splice(index, 1);
  return true;
}

/** Move a layer relative to both ordinary layers and existing legacy widgets. */
export function reorderLayer(overlay, id, action) {
  if (!["up", "down", "front", "back"].includes(action)) throw new TypeError("Layer order action must be up, down, front, or back.");
  const target = (overlay.layers ?? []).find(entry => entry.id === id);
  if (!target) return false;
  const ordered = stack(overlay);
  const index = ordered.indexOf(target);
  const next = action === "front" ? ordered.length - 1 : action === "back" ? 0 : index + (action === "up" ? 1 : -1);
  if (next < 0 || next >= ordered.length || next === index) return false;
  ordered.splice(index, 1);
  ordered.splice(next, 0, target);
  ordered.forEach((entry, order) => { entry.z = order; });
  return true;
}
