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
 * Insert copied layers above everything with fresh IDs, in their own stacking order and with
 * their relative positions. While a copy would sit exactly on an existing layer the group is
 * offset by 20 px, so repeated pastes fan out instead of stacking.
 */
export function pasteLayers(overlay, sources) {
  if ((overlay.layers ?? []).length + sources.length > 100) throw new RangeError("An overlay supports at most 100 layers.");
  const copies = [...sources].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)).map(clone);
  const ordered = stack(overlay);
  const ids = new Set(ordered.map(entry => entry.id));
  // Copies of a group form a new group rather than joining the original.
  const groups = new Map();
  for (const copy of copies) {
    do { copy.id = newId(); } while (ids.has(copy.id));
    ids.add(copy.id);
    if (copy.groupId) { if (!groups.has(copy.groupId)) groups.set(copy.groupId, newGroupId()); copy.groupId = groups.get(copy.groupId); }
  }
  let shift = 0;
  const collides = offset => copies.some(copy => ordered.some(entry => entry.x === (copy.x ?? 0) + offset && entry.y === (copy.y ?? 0) + offset));
  for (let step = 0; step < 50 && collides(shift); step++) shift += 20;
  const highest = Math.max(-1, ...ordered.map(entry => entry.z ?? 0));
  const results = copies.map((copy, index) => {
    copy.x = Math.min(32768, (copy.x ?? 0) + shift);
    copy.y = Math.min(32768, (copy.y ?? 0) + shift);
    copy.z = highest + copies.length > 10000 ? ordered.length + index : highest + 1 + index;
    return validateLayer(copy, overlay.canvas);
  });
  if (highest + copies.length > 10000) ordered.forEach((entry, index) => { entry.z = index; });
  overlay.layers.push(...results);
  dissolveSmallGroups(overlay);
  return results;
}

export function pasteLayer(overlay, source) { return pasteLayers(overlay, [source])[0]; }

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

/** The overlay's own layers, top first, as the Layers panel lists them. */
export function layerOrder(overlay) {
  const own = new Set(overlay.layers ?? []);
  return stack(overlay).filter(entry => own.has(entry)).reverse();
}

/** Give `ordered` (top first) the layers' own z values, so legacy widgets keep their places. */
function restack(ordered) {
  let values = ordered.map(layer => layer.z ?? 0).sort((a, b) => b - a);
  if (new Set(values).size !== values.length) values = ordered.map((_layer, index) => ordered.length - 1 - index);
  ordered.forEach((layer, index) => { layer.z = values[index]; });
}

function newGroupId() {
  return `group-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`;
}

/** A group needs two members; a lone member becomes an ordinary layer again. */
export function dissolveSmallGroups(overlay) {
  const counts = new Map();
  for (const layer of overlay.layers ?? []) if (layer.groupId) counts.set(layer.groupId, (counts.get(layer.groupId) ?? 0) + 1);
  for (const layer of overlay.layers ?? []) if (layer.groupId && counts.get(layer.groupId) < 2) { delete layer.groupId; delete layer.groupName; }
}

/**
 * Group layers under a fresh group ID. The members leave other groups and become one block in
 * the stack where the top-most of them was. Returns the group ID, or null for fewer than two.
 */
export function groupLayers(overlay, ids, name) {
  const members = new Set(ids);
  const order = layerOrder(overlay);
  const chosen = order.filter(layer => members.has(layer.id));
  if (chosen.length < 2) return null;
  const groupId = newGroupId(), top = order.indexOf(chosen[0]);
  const rest = order.filter(layer => !members.has(layer.id));
  for (const layer of chosen) Object.assign(layer, { groupId, groupName: name });
  restack([...rest.slice(0, top), ...chosen, ...rest.slice(top)]);
  dissolveSmallGroups(overlay);
  return groupId;
}

export function ungroupLayers(overlay, groupIds) {
  for (const layer of overlay.layers ?? []) if (groupIds.has(layer.groupId)) { delete layer.groupId; delete layer.groupName; }
}

export function renameGroup(overlay, groupId, name) {
  for (const layer of overlay.layers ?? []) if (layer.groupId === groupId) layer.groupName = name;
}

/**
 * Move layers to `index` among the other layers (top first), keeping their own order. `groupId`
 * joins that group, null leaves groups and undefined keeps each layer's group.
 */
export function moveLayers(overlay, ids, index, groupId) {
  const moving = new Set(ids), order = layerOrder(overlay);
  const chosen = order.filter(layer => moving.has(layer.id));
  if (!chosen.length) return false;
  const rest = order.filter(layer => !moving.has(layer.id));
  const at = Math.max(0, Math.min(rest.length, index));
  restack([...rest.slice(0, at), ...chosen, ...rest.slice(at)]);
  if (groupId) {
    const name = order.find(layer => layer.groupId === groupId)?.groupName;
    for (const layer of chosen) Object.assign(layer, { groupId, groupName: name });
  } else if (groupId === null) for (const layer of chosen) { delete layer.groupId; delete layer.groupName; }
  dissolveSmallGroups(overlay);
  return true;
}

/** Up, down, front and back for a grouped layer stay inside its group. */
export function reorderInGroup(overlay, id, action) {
  const order = layerOrder(overlay), layer = order.find(entry => entry.id === id);
  if (!layer?.groupId) return false;
  const block = order.filter(entry => entry.groupId === layer.groupId), position = block.indexOf(layer);
  const target = action === "front" ? 0 : action === "back" ? block.length - 1 : position + (action === "up" ? -1 : 1);
  if (target < 0 || target >= block.length || target === position) return false;
  const reordered = block.filter(entry => entry !== layer);
  reordered.splice(target, 0, layer);
  const at = order.indexOf(block[0]), rest = order.filter(entry => entry.groupId !== layer.groupId);
  restack([...rest.slice(0, at), ...reordered, ...rest.slice(at)]);
  return true;
}

/** Up or down by one step for an ungrouped layer, stepping over a whole group at a time. */
export function stepLayer(overlay, id, action) {
  const order = layerOrder(overlay), layer = order.find(entry => entry.id === id), at = order.indexOf(layer);
  if (!layer || !["up", "down"].includes(action)) return false;
  const rest = order.filter(entry => entry !== layer);
  if (action === "up") {
    if (at <= 0) return false;
    const above = order[at - 1];
    const start = above.groupId ? rest.findIndex(entry => entry.groupId === above.groupId) : rest.indexOf(above);
    restack([...rest.slice(0, start), layer, ...rest.slice(start)]);
  } else {
    if (at >= order.length - 1) return false;
    const below = order[at + 1];
    const end = below.groupId ? rest.findLastIndex(entry => entry.groupId === below.groupId) : rest.indexOf(below);
    restack([...rest.slice(0, end + 1), layer, ...rest.slice(end + 1)]);
  }
  return true;
}
