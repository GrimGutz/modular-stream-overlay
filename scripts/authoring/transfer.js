/**
 * Files for moving overlays, widget designs and fragments to another world or GM. Overlays and
 * designs use the authoring toolkit's mso-overlay-bundle; fragments use a small envelope that
 * carries the widget designs they need. Both carry the names of the characters their widgets
 * show, so the receiving world can match its own. Importing never overwrites: records whose ID
 * exists get a new one, and Actor assignments the receiving world lacks are matched or dropped.
 * Image files are referenced by path and are not included.
 */
import { MODULE_ID, SCHEMA_VERSION, WIDGET_PRESET_SCHEMA_VERSION, clone, validateLayer, validateOverlay, validateWidgetPreset } from "../core/schema.js";
import { validateActorNames, validateOverlayBundle, unresolvedActorSlots } from "./bundle.js";

export const FRAGMENT_FORMAT = "mso-layer-fragment";
const MAX_FILE = 16 * 1024 * 1024;

const newId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`;
const designsUsedBy = (layers, presets) => {
  const ids = new Set(layers.filter(layer => layer.type === "character-widget").map(layer => layer.presetId));
  return presets.filter(preset => ids.has(preset.id)).map(preset => validateWidgetPreset(preset));
};

/** World Actors that character widgets in these layers show, in first-use order. */
export function referencedActors(layers) {
  const uuids = new Set();
  for (const layer of layers) {
    if (layer.type !== "character-widget" || layer.dataSource !== "actors") continue;
    for (const uuid of [...(layer.actorUuids ?? []), layer.actorUuid, layer.carousel?.actorStartUuid]) if (uuid) uuids.add(uuid);
  }
  return [...uuids];
}

/** Names for the given UUIDs from `actors` ({ uuid, name } entries), for the receiving world to match. */
function namesFor(uuids, actors) {
  const names = new Map(actors.map(actor => [actor.uuid, String(actor.name ?? "")]));
  return Object.fromEntries(uuids.filter(uuid => names.get(uuid)).map(uuid => [uuid, names.get(uuid)]));
}

/** A bundle of overlays and widget designs; overlays bring the designs their widgets use and their characters' names. */
export function exportBundle({ overlays = [], widgetPresets = [], library = [], actors = [] } = {}) {
  const normalized = overlays.map(overlay => validateOverlay(overlay));
  const designs = new Map(widgetPresets.map(preset => [preset.id, validateWidgetPreset(preset)]));
  for (const preset of designsUsedBy(normalized.flatMap(overlay => overlay.layers), library)) designs.set(preset.id, preset);
  const actorNames = namesFor(referencedActors(normalized.flatMap(overlay => overlay.layers)), actors);
  return validateOverlayBundle({ format: "mso-overlay-bundle", version: 1, moduleId: MODULE_ID, overlaySchemaVersion: SCHEMA_VERSION,
    widgetPresetSchemaVersion: WIDGET_PRESET_SCHEMA_VERSION, actorSlots: [], widgetPresets: [...designs.values()], overlays: normalized, actorBindings: [],
    ...(Object.keys(actorNames).length ? { actorNames } : {}) });
}

export function exportFragment(fragment, library = [], actors = []) {
  const layers = fragment.layers.map(layer => validateLayer(layer));
  const actorNames = namesFor(referencedActors(layers), actors);
  return { format: FRAGMENT_FORMAT, version: 1, moduleId: MODULE_ID, name: fragment.name, layers, widgetPresets: designsUsedBy(layers, library),
    ...(Object.keys(actorNames).length ? { actorNames } : {}) };
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
      widgetPresets: (Array.isArray(data.widgetPresets) ? data.widgetPresets : []).slice(0, 100).map(preset => validateWidgetPreset(preset)),
      actorNames: validateActorNames(data.actorNames) ?? {} };
  }
  throw new TypeError("This file is not a Modular Stream Overlay export.");
}

/** Bundles from the authoring toolkit can ask for Actors by slot; those go through its import dialog. */
export function needsActorChoices(bundle) { return unresolvedActorSlots(bundle).length > 0; }

const normalizedName = value => String(value ?? "").trim().toLocaleLowerCase();

/**
 * Characters a file's widgets show that this world lacks, each with its name from the file and
 * this world's Actor of the same name, if exactly one has it.
 */
export function missingActors({ overlays = [], layers = null, actorNames = {} }, { exists = () => false, actors = [] } = {}) {
  return referencedActors(layers ?? overlays.flatMap(overlay => overlay.layers)).filter(uuid => !exists(uuid)).map(uuid => {
    const name = actorNames?.[uuid] ?? "";
    const same = name ? actors.filter(actor => normalizedName(actor.name) === normalizedName(name)) : [];
    return { uuid, name, suggestion: same.length === 1 ? same[0].uuid : "" };
  });
}

/**
 * Plan an import into this world without overwriting anything. Identical designs are reused;
 * a design or overlay whose ID is taken gets a new ID, and widgets follow renamed designs.
 * `actorMap` replaces the file's Actor UUIDs with this world's (an empty value leaves one out);
 * `actorExists(uuid)` decides which remaining assignments survive.
 */
export async function planImport({ overlays = [], widgetPresets = [], layers = null }, { overlayIds = [], presets = [], actorExists = async () => false, actorMap = {} } = {}) {
  const existing = new Map(presets.map(preset => [preset.id, JSON.stringify(validateWidgetPreset(preset))]));
  const renamed = new Map(), designs = [];
  for (const preset of widgetPresets) {
    const value = clone(validateWidgetPreset(preset));
    if (existing.get(value.id) === JSON.stringify(value)) continue;
    if (existing.has(value.id)) { renamed.set(value.id, newId("widget")); value.id = renamed.get(preset.id); }
    designs.push(value);
  }
  const taken = new Set(overlayIds), checked = new Map(), droppedActors = new Set();
  let dropped = 0;
  const known = async uuid => {
    if (!checked.has(uuid)) checked.set(uuid, await actorExists(uuid).catch(() => false));
    return checked.get(uuid);
  };
  const target = uuid => Object.hasOwn(actorMap, uuid) ? actorMap[uuid] : uuid;
  const adapt = async layer => {
    if (layer.type !== "character-widget") return layer;
    const result = { ...layer, presetId: renamed.get(layer.presetId) ?? layer.presetId };
    if (result.dataSource === "actors") {
      const kept = [];
      for (const uuid of result.actorUuids ?? []) {
        const chosen = target(uuid);
        if (chosen && await known(chosen)) { if (!kept.includes(chosen)) kept.push(chosen); }
        else { dropped++; droppedActors.add(uuid); }
      }
      result.actorUuids = kept; result.actorUuid = kept[0] ?? "";
      const start = result.carousel?.actorStartUuid ? target(result.carousel.actorStartUuid) : null;
      if (result.carousel?.actorStartUuid) result.carousel = { ...result.carousel, actorStartUuid: start && kept.includes(start) ? start : null };
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
  return { overlays: plannedOverlays, widgetPresets: designs, layers: plannedLayers, renamedDesigns: renamed.size, droppedActors: dropped,
    droppedActorUuids: [...droppedActors] };
}

/** A file name from a record name: letters, digits and dashes. */
export function exportFilename(name, suffix) {
  const base = String(name ?? "").replace(/[^\p{L}\p{N}\p{M}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "export";
  return `${base}.${suffix}.json`;
}
