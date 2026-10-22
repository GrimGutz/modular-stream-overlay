/**
 * The fragment library: a group or selection of layers saved by name and inserted into any
 * overlay or widget design. It lives in a world setting, so every GM shares it; fragments are
 * small, unlike saved versions. Layers are validated like a saved layout.
 */
import { MODULE_ID, clone, validateLayer } from "./schema.js";

export const FRAGMENTS_SETTING = "layerFragments";
const MAX_FRAGMENTS = 100;
const MAX_LAYERS = 100;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function fragmentName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new TypeError("A fragment name must contain 1–80 printable characters.");
  return name;
}

export function validateFragment(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("A fragment must be an object.");
  if (typeof input.id !== "string" || !ID.test(input.id)) throw new TypeError("A fragment ID is invalid.");
  if (!Array.isArray(input.layers) || !input.layers.length || input.layers.length > MAX_LAYERS) throw new TypeError(`A fragment holds 1–${MAX_LAYERS} layers.`);
  return {
    id: input.id, name: fragmentName(input.name),
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : 0,
    layers: input.layers.map(layer => validateLayer(layer))
  };
}

/** The saved library; an unreadable entry is skipped rather than hiding the rest. */
export function listFragments(settings = globalThis.game?.settings) {
  let value = [];
  try { value = settings?.get(MODULE_ID, FRAGMENTS_SETTING) ?? []; }
  catch { return []; }
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => { try { return [validateFragment(entry)]; } catch { return []; } });
}

export function createFragment(name, layers, { now = Date.now() } = {}) {
  const random = globalThis.crypto?.randomUUID?.() ?? `${now.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return validateFragment({ id: `fragment-${random}`, name, createdAt: now, layers: layers.map(layer => clone(layer)) });
}

export async function saveFragment(name, layers, settings = globalThis.game?.settings) {
  const library = listFragments(settings);
  if (library.length >= MAX_FRAGMENTS) throw new RangeError(`The fragment library holds at most ${MAX_FRAGMENTS} fragments.`);
  const fragment = createFragment(name, layers);
  await settings.set(MODULE_ID, FRAGMENTS_SETTING, [...library, fragment]);
  return fragment;
}

export async function deleteFragment(id, settings = globalThis.game?.settings) {
  await settings.set(MODULE_ID, FRAGMENTS_SETTING, listFragments(settings).filter(fragment => fragment.id !== id));
}

export async function renameFragment(id, name, settings = globalThis.game?.settings) {
  const value = fragmentName(name);
  await settings.set(MODULE_ID, FRAGMENTS_SETTING, listFragments(settings).map(fragment => fragment.id === id ? { ...fragment, name: value } : fragment));
}
