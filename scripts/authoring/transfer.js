/**
 * Files for moving overlays, widget designs and fragments to another world or GM. Overlays and
 * designs use the authoring toolkit's mso-overlay-bundle; fragments use a small envelope that
 * carries the widget designs they need. Importing never overwrites: records whose ID exists get
 * a new one, and Actor assignments the receiving world lacks are dropped. Image files are
 * referenced by path and are not included.
 */
import { MODULE_ID, SCHEMA_VERSION, WIDGET_PRESET_SCHEMA_VERSION, clone, validateLayer, validateOverlay, validateWidgetPreset } from "../core/schema.js";
import { validateOverlayBundle, unresolvedActorSlots } from "./bundle.js";

export const FRAGMENT_FORMAT = "mso-layer-fragment";
const MAX_FILE = 16 * 1024 * 1024;

const newId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`;
const designsUsedBy = (layers, presets) => {
  const ids = new Set(layers.filter(layer => layer.type === "character-widget").map(layer => layer.presetId));
  return presets.filter(preset => ids.has(preset.id)).map(preset => validateWidgetPreset(preset));
};

/** A bundle of overlays and widget designs; overlays bring the designs their widgets use. */
export function exportBundle({ overlays = [], widgetPresets = [], library = [] } = {}) {
  const normalized = overlays.map(overlay => validateOverlay(overlay));
  const designs = new Map(widgetPresets.map(preset => [preset.id, validateWidgetPreset(preset)]));
  for (const preset of designsUsedBy(normalized.flatMap(overlay => overlay.layers), library)) designs.set(preset.id, preset);
  return validateOverlayBundle({ format: "mso-overlay-bundle", version: 1, moduleId: MODULE_ID, overlaySchemaVersion: SCHEMA_VERSION,
    widgetPresetSchemaVersion: WIDGET_PRESET_SCHEMA_VERSION, actorSlots: [], widgetPresets: [...designs.values()], overlays: normalized, actorBindings: [] });
}

export function exportFragment(fragment, library = []) {
  const layers = fragment.layers.map(layer => validateLayer(layer));
  return { format: FRAGMENT_FORMAT, version: 1, moduleId: MODULE_ID, name: fragment.name, layers, widgetPresets: designsUsedBy(layers, library) };
}

/** Read a chosen file: { kind: "bundle", bundle } or { kind: "fragment", name, layers, widgetPresets }. */
export function readTransferFile(text) {
  if (typeof text !== "string" || text.length > MAX_FILE) throw new TypeError("Choose a Modular Stream Overlay file of at most 16 MiB.");
  let data;
  try { data = JSON.parse(text); }
  catch { throw new TypeError("This file is not a Modular Stream Overlay export."); }
  if (data?.format === "mso-overlay-bundle") return { kind: "bundle", bundle: validateOverlayBundle(data) };
  if (data?.format === FRAGMENT_FORMAT && data.version === 1 && data.moduleId === MODULE_ID) {
    if (!Array.isArray(data.layers) || !data.layers.length || data.layers.length > 100) throw new TypeError("A fragment holds 1–100 layers.");
    return { kind: "fragment", name: String(data.name ?? "").trim().slice(0, 80) || "Fragment", layers: data.layers.map(layer => validateLayer(layer)),
      widgetPresets: (Array.isArray(data.widgetPresets) ? data.widgetPresets : []).slice(0, 100).map(preset => validateWidgetPreset(preset)) };
  }
  throw new TypeError("This file is not a Modular Stream Overlay export.");
}

/** Bundles from the authoring toolkit can ask for Actors by slot; those go through its import dialog. */
export function needsActorChoices(bundle) { return unresolvedActorSlots(bundle).length > 0; }

/**
 * Plan an import into this world without overwriting anything. Identical designs are reused;
 * a design or overlay whose ID is taken gets a new ID, and widgets follow renamed designs.
 * `actorExists(uuid)` decides which Actor assignments survive.
 */
export async function planImport({ overlays = [], widgetPresets = [], layers = null }, { overlayIds = [], presets = [], actorExists = async () => false } = {}) {
  const existing = new Map(presets.map(preset => [preset.id, JSON.stringify(validateWidgetPreset(preset))]));
  const renamed = new Map(), designs = [];
  for (const preset of widgetPresets) {
    const value = clone(validateWidgetPreset(preset));
    if (existing.get(value.id) === JSON.stringify(value)) continue;
    if (existing.has(value.id)) { renamed.set(value.id, newId("widget")); value.id = renamed.get(preset.id); }
    designs.push(value);
  }
  const taken = new Set(overlayIds), checked = new Map();
  let dropped = 0;
  const known = async uuid => {
    if (!checked.has(uuid)) checked.set(uuid, await actorExists(uuid).catch(() => false));
    return checked.get(uuid);
  };
  const adapt = async layer => {
    if (layer.type !== "character-widget") return layer;
    const result = { ...layer, presetId: renamed.get(layer.presetId) ?? layer.presetId };
    if (result.dataSource === "actors") {
      const kept = [];
      for (const uuid of result.actorUuids ?? []) if (await known(uuid)) kept.push(uuid); else dropped++;
      result.actorUuids = kept; result.actorUuid = kept[0] ?? "";
      if (result.carousel?.actorStartUuid && !kept.includes(result.carousel.actorStartUuid)) result.carousel = { ...result.carousel, actorStartUuid: null };
    }
    return validateLayer(result);
  };
  const plannedOverlays = [];
  for (const overlay of overlays) {
    const value = clone(validateOverlay(overlay));
    if (taken.has(value.id)) value.id = newId("overlay");
    taken.add(value.id);
    value.layers = await Promise.all(value.layers.map(adapt));
    plannedOverlays.push(validateOverlay(value));
  }
  const plannedLayers = layers ? await Promise.all(layers.map(adapt)) : null;
  return { overlays: plannedOverlays, widgetPresets: designs, layers: plannedLayers, renamedDesigns: renamed.size, droppedActors: dropped };
}

/** A file name from a record name: letters, digits and dashes. */
export function exportFilename(name, suffix) {
  const base = String(name ?? "").replace(/[^\p{L}\p{N}\p{M}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "export";
  return `${base}.${suffix}.json`;
}
