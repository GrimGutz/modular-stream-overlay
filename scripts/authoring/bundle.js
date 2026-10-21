/** Small authoring envelope around the existing schemas and stores; no renderer or DB access. */
import { MODULE_ID, SCHEMA_VERSION, WIDGET_PRESET_SCHEMA_VERSION, WIDGET_DEFINITIONS, clone,
  createOverlay, validateOverlay, validateWidgetPreset, validateLayer, validateActorUuid, validateState } from "../core/schema.js";
import { createLayer } from "../core/layers.js";
import { createWidgetPreset, validateWidgetPresetState } from "../core/widget-presets.js";
import { t, errorText, localizeDOM, setText, setAttr } from "../ui/i18n.js";

const TYPES = new Set(["color", "image", "text", "character-widget", ...WIDGET_DEFINITIONS.map(item => item.type)]);
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const slot = value => typeof value === "string" && value.startsWith("$actor:") ? value.slice(7) : null;
const fail = message => { throw new TypeError(message); };
function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value) || ["constructor", "prototype", "__proto__"].includes(value)) fail(`${label} is invalid.`);
  return value;
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}
function list(value, label, limit = 100) {
  if (!Array.isArray(value) || value.length > limit) fail(`${label} must be a list of at most ${limit} entries.`);
  return value;
}
function unique(values, label) {
  if (new Set(values).size !== values.length) fail(`${label} contains duplicates.`);
}
/** Core validators deliberately strip unknown fields. Authoring reports such typos instead. */
function known(input, normalized, path) {
  if (!input || typeof input !== "object") return;
  for (const key of Object.keys(input)) {
    if (!normalized || !Object.hasOwn(normalized, key)) fail(`Unsupported field: ${path}.${key}`);
    known(input[key], normalized[key], `${path}.${key}`);
  }
}
function actorEntry(value, names) {
  const name = slot(value);
  if (name !== null) {
    if (!names.includes(identifier(name, "Actor slot"))) fail(`Undeclared Actor slot: ${name}`);
  } else if (!validateActorUuid(value)) fail("An Actor entry cannot be empty.");
  return value;
}

/** Accept partial layer/design defaults, then emit ordinary schema 6/4 records. */
export function generateOverlayBundle(source, { actors = {}, refs = {} } = {}) {
  const input = clone(source);
  object(input, "Authoring input");
  const headers = { format: true, version: true, actors: true, presetRefs: true, widgetPresets: true, overlays: true };
  for (const key of Object.keys(input)) if (!Object.hasOwn(headers, key)) fail(`Unsupported authoring field: ${key}`);
  if (input.format !== "mso-authoring" || input.version !== 1) fail("Expected mso-authoring version 1.");
  const declarations = object(input.actors ?? {}, "Actor declarations");
  const actorSlots = Object.keys(declarations).map(name => identifier(name, "Actor slot"));
  list(actorSlots, "Actor slots");
  const presetRefs = object(input.presetRefs ?? {}, "Preset reference declarations");
  for (const [name, label] of [...Object.entries(declarations), ...Object.entries(presetRefs)]) {
    identifier(name, "Slot name");
    if (typeof label !== "string" || !label.trim() || label.length > 200) fail(`Slot ${name} needs a short description.`);
  }
  actors = clone(object(actors, "Actor arguments")); refs = clone(object(refs, "Preset reference arguments"));
  for (const [name, uuid] of Object.entries(actors)) {
    if (!actorSlots.includes(name)) fail(`Unknown Actor argument: ${name}`);
    if (!validateActorUuid(uuid)) fail(`Actor ${name} needs a world Actor UUID.`);
  }
  for (const [name, id] of Object.entries(refs)) {
    if (!Object.hasOwn(presetRefs, name)) fail(`Unknown preset reference argument: ${name}`);
    identifier(id, "Referenced widget preset ID");
  }
  const bindings = [], presets = new Map();
  const replaceActor = value => {
    actorEntry(value, actorSlots);
    return slot(value) !== null && Object.hasOwn(actors, slot(value)) ? actors[slot(value)] : value;
  };
  function layers(entries = [], canvas, prefix, overlayId = null) {
    return list(entries, "Layers").map((entry, index) => {
      const patch = clone(object(entry, "Layer"));
      if (!TYPES.has(patch.type)) fail(`Unsupported authoring layer type: ${patch.type}`);
      patch.id ??= `${prefix}-${index + 1}`;
      let defaults;
      if (patch.type === "character-widget") {
        if (!overlayId) fail("Reusable presets/pages cannot contain character-widget instances.");
        if (typeof patch.presetId === "string" && patch.presetId.startsWith("$preset:")) {
          const name = patch.presetId.slice(8);
          if (!Object.hasOwn(presetRefs, name) || !Object.hasOwn(refs, name)) fail(`Supply --ref ${name}=existing-preset-id.`);
          patch.presetId = refs[name];
        }
        const design = presets.get(patch.presetId);
        defaults = { width: design?.canvas.width ?? 400, height: design?.canvas.height ?? 180, z: index };
        const entries = Object.hasOwn(patch, "actorUuids") ? list(patch.actorUuids, "Assigned Actors", 20)
          : patch.actorUuid ? [patch.actorUuid] : [];
        const start = patch.carousel?.actorStartUuid;
        const ordered = entries.map(value => slot(value) !== null ? replaceActor(value) : value);
        const startActor = start != null ? (slot(start) !== null ? replaceActor(start) : start) : undefined;
        if (ordered.some(value => slot(value) !== null) || slot(startActor) !== null) {
          if ((patch.dataSource ?? "actors") !== "actors") fail("Actor slots require the actors data source.");
          bindings.push({ overlayId, layerId: patch.id, actors: ordered, ...(startActor !== undefined ? { startActor } : {}) });
        }
        patch.actorUuids = ordered.filter(value => slot(value) === null);
        patch.actorUuid = patch.actorUuids[0] ?? "";
        if (slot(startActor) !== null) patch.carousel = { ...patch.carousel, actorStartUuid: null };
        else if (startActor !== undefined) patch.carousel = { ...patch.carousel, actorStartUuid: startActor };
      } else defaults = { ...createLayer(patch.type, canvas), z: index };
      const raw = { ...defaults, ...patch }, result = validateLayer(raw, canvas, index);
      known(raw, result, `layer ${patch.id}`);
      return result;
    });
  }
  function design(entry, widget) {
    const raw = clone(object(entry, widget ? "Widget preset" : "Overlay"));
    identifier(raw.id, "Design ID");
    const base = widget ? createWidgetPreset(raw.name) : createOverlay(raw.name);
    const canvas = { ...base.canvas, ...object(raw.canvas ?? {}, "Canvas") };
    const pages = list(raw.pages ?? [], "Pages", 20).map((page, index) => {
      object(page, "Page");
      const id = page.id ?? `page-${index + 1}`;
      return { ...page, id, layers: layers(page.layers, canvas, `${id}-layer`) };
    });
    const complete = { ...base, ...raw, canvas, background: { ...base.background, ...object(raw.background ?? {}, "Background") },
      layers: layers(raw.layers, canvas, "layer", widget ? null : raw.id), pages };
    const result = widget ? validateWidgetPreset(complete) : validateOverlay(complete);
    known(complete, result, `design ${raw.id}`);
    return result;
  }
  const widgetPresets = list(input.widgetPresets ?? [], "Widget presets").map(entry => {
    const value = design(entry, true); presets.set(value.id, value); return value;
  });
  const overlays = list(input.overlays ?? [], "Overlays").map(entry => design(entry, false));
  return validateOverlayBundle({ format: "mso-overlay-bundle", version: 1, moduleId: MODULE_ID,
    overlaySchemaVersion: SCHEMA_VERSION, widgetPresetSchemaVersion: WIDGET_PRESET_SCHEMA_VERSION,
    actorSlots, widgetPresets, overlays, actorBindings: bindings });
}

/** Portable envelope metadata never reaches a saved overlay or preset. */
export function validateOverlayBundle(source) {
  const input = clone(source);
  object(input, "Bundle");
  if (input.format !== "mso-overlay-bundle" || input.version !== 1 || input.moduleId !== MODULE_ID
    || input.overlaySchemaVersion !== SCHEMA_VERSION || input.widgetPresetSchemaVersion !== WIDGET_PRESET_SCHEMA_VERSION) {
    fail(`Expected an mso-overlay-bundle v1 for overlay schema ${SCHEMA_VERSION} / widget schema ${WIDGET_PRESET_SCHEMA_VERSION}.`);
  }
  const actorSlots = list(input.actorSlots ?? [], "Actor slots").map(value => identifier(value, "Actor slot"));
  unique(actorSlots, "Actor slots");
  const normalize = (entries, validator, version, label) => list(entries ?? [], label).map(entry => {
    if (entry?.schemaVersion !== version) fail(`${label} must use schema ${version}.`);
    const result = validator(entry); known(entry, result, label); return result;
  });
  const widgetPresets = normalize(input.widgetPresets, validateWidgetPreset, WIDGET_PRESET_SCHEMA_VERSION, "Widget presets");
  const overlays = normalize(input.overlays, validateOverlay, SCHEMA_VERSION, "Overlays");
  if (!widgetPresets.length && !overlays.length) fail("A bundle needs at least one overlay or widget preset.");
  unique(widgetPresets.map(item => item.id), "Widget preset IDs"); unique(overlays.map(item => item.id), "Overlay IDs");
  const actorBindings = list(input.actorBindings ?? [], "Actor binding targets", 10000).map(binding => {
    object(binding, "Actor binding");
    const overlay = overlays.find(item => item.id === binding.overlayId);
    const layer = overlay?.layers.find(item => item.id === binding.layerId);
    if (layer?.type !== "character-widget" || layer.dataSource !== "actors") fail("An Actor binding must target an actors character-widget layer.");
    const actors = list(binding.actors, "Ordered Actor bindings", 20).map(value => actorEntry(value, actorSlots));
    unique(actors, "Ordered Actor bindings");
    const result = { overlayId: overlay.id, layerId: layer.id, actors,
      ...(binding.startActor !== undefined ? { startActor: actorEntry(binding.startActor, actorSlots) } : {}) };
    known(binding, result, "Actor binding"); return result;
  });
  unique(actorBindings.map(binding => `${binding.overlayId}/${binding.layerId}`), "Actor binding targets");
  const result = { format: input.format, version: 1, moduleId: MODULE_ID, overlaySchemaVersion: SCHEMA_VERSION,
    widgetPresetSchemaVersion: WIDGET_PRESET_SCHEMA_VERSION, actorSlots, widgetPresets, overlays, actorBindings };
  known(input, result, "Bundle");
  return result;
}

export function unresolvedActorSlots(bundle) {
  return [...new Set(bundle.actorBindings.flatMap(binding => [...binding.actors, binding.startActor])
    .map(slot).filter(value => value !== null))];
}

/** Records of a bundle that already exist in the world: designs that would be replaced and overlays that are kept. */
export function existingBundleRecords(source, api = globalThis.game?.modules?.get(MODULE_ID)?.api) {
  const bundle = validateOverlayBundle(source);
  const overlays = new Set(api.store.getState().overlays.map(item => item.id)), presets = new Set(api.widgetPresets.getState().presets.map(item => item.id));
  return { widgetPresets: bundle.widgetPresets.filter(item => presets.has(item.id)), overlays: bundle.overlays.filter(item => overlays.has(item.id)) };
}

/**
 * Preflight the whole batch; existing stores remain the only writers. Active output is preserved.
 * `updateExisting` explicitly replaces widget designs that share an ID with the bundle and keeps
 * same-ID overlays untouched, so their layers, text and Actor assignments survive a design update.
 */
export async function installOverlayBundle(source, { api = globalThis.game?.modules?.get(MODULE_ID)?.api, actors = {}, dryRun = false, updateExisting = false } = {}) {
  if (!globalThis.game?.user?.isGM) throw new Error("Install overlay bundles as a GM in Foundry.");
  if (typeof dryRun !== "boolean") fail("dryRun must be true or false.");
  if (typeof updateExisting !== "boolean") fail("updateExisting must be true or false.");
  if (api?.schemaVersion !== SCHEMA_VERSION || !api.store?.saveOverlay || !api.widgetPresets?.save) throw new Error("The compatible overlay module API is not ready.");
  const bundle = validateOverlayBundle(source);
  const existing = existingBundleRecords(bundle, api);
  const keptOverlayIds = updateExisting ? existing.overlays.map(item => item.id) : [];
  const replacedPresetIds = updateExisting ? existing.widgetPresets.map(item => item.id) : [];
  if (updateExisting) {
    bundle.overlays = bundle.overlays.filter(item => !keptOverlayIds.includes(item.id));
    bundle.actorBindings = bundle.actorBindings.filter(binding => !keptOverlayIds.includes(binding.overlayId));
  }
  actors = clone(object(actors, "Actor choices"));
  const needed = unresolvedActorSlots(bundle);
  for (const key of Object.keys(actors)) if (!bundle.actorSlots.includes(key)) fail(`Unknown Actor choice: ${key}`);
  const resolve = entry => {
    if (slot(entry) === null) return entry;
    const value = actors[slot(entry)];
    if (!value) fail(`Choose a world Actor UUID for ${slot(entry)}.`);
    actorEntry(value, []); return value;
  };
  for (const binding of bundle.actorBindings) {
    const layer = bundle.overlays.find(item => item.id === binding.overlayId).layers.find(item => item.id === binding.layerId);
    layer.actorUuids = binding.actors.map(resolve); layer.actorUuid = layer.actorUuids[0] ?? "";
    if (binding.startActor !== undefined) layer.carousel.actorStartUuid = resolve(binding.startActor);
  }
  bundle.overlays = bundle.overlays.map(validateOverlay);
  const state = api.store.getState(), presets = api.widgetPresets.getState();
  for (const overlay of bundle.overlays) if (state.overlays.some(item => item.id === overlay.id)) fail(`Overlay ID already exists: ${overlay.id}. Choose a new ID; nothing was installed.`);
  for (const preset of bundle.widgetPresets) if (!replacedPresetIds.includes(preset.id) && presets.presets.some(item => item.id === preset.id)) fail(`Widget preset ID already exists: ${preset.id}. Choose a new ID; nothing was installed.`);
  validateState({ ...state, overlays: [...state.overlays, ...bundle.overlays] });
  validateWidgetPresetState({ ...presets, presets: [...presets.presets.filter(item => !replacedPresetIds.includes(item.id)), ...bundle.widgetPresets] });
  const designs = new Map([...presets.presets, ...bundle.widgetPresets].map(item => [item.id, item]));
  const uuids = new Set();
  for (const overlay of bundle.overlays) for (const layer of overlay.layers) if (layer.type === "character-widget") {
    if (!designs.has(layer.presetId)) fail(`Widget preset is missing: ${layer.presetId}. Nothing was installed.`);
    if (layer.dataSource === "actors") for (const uuid of layer.actorUuids) uuids.add(uuid);
  }
  for (const uuid of uuids) {
    if (!api.characterData?.resolveActor) throw new Error("The viewer-aware Character data service is not ready.");
    await api.characterData.resolveActor(uuid);
  }
  const summary = { overlayIds: bundle.overlays.map(item => item.id), widgetPresetIds: bundle.widgetPresets.map(item => item.id),
    replacedWidgetPresetIds: replacedPresetIds, keptOverlayIds, actorSlotsResolved: needed, activeOverlayId: state.activeOverlayId, dryRun };
  if (dryRun) return summary;
  let presetRevision = presets.revision, overlayRevision = state.revision, added = 0;
  try {
    for (const preset of bundle.widgetPresets) { await api.widgetPresets.save(preset, { expectedRevision: presetRevision++ }); added++; }
    for (const overlay of bundle.overlays) { await api.store.saveOverlay(overlay, { expectedRevision: overlayRevision++, activateIfEmpty: false }); added++; }
  } catch (error) {
    throw new Error(`Installation stopped after ${added} acknowledged saves; writes are not atomic. Inspect new records before retrying. ${error.message}`, { cause: error });
  }
  return summary;
}

/** Entry point for the generated GM Script Macro. Cancel never writes settings. */
export async function importOverlayBundle({ bundle: source, actors = {}, api = globalThis.game?.modules?.get(MODULE_ID)?.api } = {}) {
  if (!globalThis.game?.user?.isGM) throw new Error(t("Authoring.GMOnly"));
  const bundle = validateOverlayBundle(source), content = document.createElement("div");
  // A newer version of an installed bundle updates its designs; nothing is replaced without this dialog.
  const existing = existingBundleRecords(bundle, api);
  const update = existing.widgetPresets.length > 0 || existing.overlays.length > 0;
  const replaced = new Set(existing.widgetPresets.map(item => item.id)), kept = new Set(existing.overlays.map(item => item.id));
  const summary = document.createElement("p");
  if (update) setText(summary, "Authoring.UpdateSummary", { presets: replaced.size });
  else setText(summary, "Authoring.ImportSummary", { overlays: bundle.overlays.length, presets: bundle.widgetPresets.length });
  content.append(summary);
  const records = document.createElement("ul");
  for (const [entries, key] of [[bundle.overlays, entry => kept.has(entry.id) ? "Authoring.KeepRecord" : "Authoring.OverlayRecord"],
    [bundle.widgetPresets, entry => replaced.has(entry.id) ? "Authoring.ReplaceRecord" : "Authoring.WidgetRecord"]]) for (const entry of entries) {
    const item = document.createElement("li"); setText(item, key(entry), { name: entry.name, id: entry.id }); records.append(item);
  }
  content.append(records);
  const names = unresolvedActorSlots({ ...bundle, actorBindings: bundle.actorBindings.filter(binding => !kept.has(binding.overlayId)) });
  for (const [index, name] of names.entries()) {
    const label = document.createElement("label"), caption = document.createElement("span"); setText(caption, "Authoring.ActorSlot", { name }); label.append(caption);
    const input = document.createElement("input"); input.name = `actor${index}`; input.type = "text"; input.required = true;
    setAttr(input, "placeholder", "Authoring.ActorPlaceholder"); input.defaultValue = actors[name] ?? ""; label.append(input); content.append(label);
  }
  const result = await globalThis.foundry.applications.api.DialogV2.input({ window: { title: t("Authoring.ImportTitle") },
    content, modal: true, rejectClose: false, ok: { label: t(update ? "Authoring.Update" : "Authoring.Install") }, render: (_event, dialog) => {
      const root = dialog.element, title = root?.querySelector(".window-title");
      if (title) setText(title, "Authoring.ImportTitle");
      const install = root?.querySelector('[data-action="ok"]'); if (install) setText(install, update ? "Authoring.Update" : "Authoring.Install");
      localizeDOM(root);
    } });
  if (!result) return { cancelled: true };
  const choices = { ...actors, ...Object.fromEntries(names.map((name, index) => [name, result[`actor${index}`]?.trim()])) };
  let installed;
  try { installed = await installOverlayBundle(bundle, { api, actors: choices, updateExisting: update }); }
  catch (error) { globalThis.ui?.notifications?.error(errorText(error)); throw error; }
  globalThis.ui?.notifications?.info(t(update ? "Authoring.Updated" : "Authoring.Installed"));
  return installed;
}
