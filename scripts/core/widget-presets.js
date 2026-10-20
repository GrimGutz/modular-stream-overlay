import {
  MODULE_ID, SCHEMA_VERSION, WIDGET_PRESET_SCHEMA_VERSION, clone, createOverlay,
  validateOverlay, validateWidgetPreset
} from "./schema.js";
import { createLayer } from "./layers.js";

export { WIDGET_DEFINITIONS, WIDGET_PRESET_SCHEMA_VERSION, validateWidgetPreset } from "./schema.js";
export { PAGE_TRANSITIONS, CAROUSEL_MODES, CAROUSEL_TRAVERSALS, createPage, addPage, duplicatePage, renamePage, deletePage, reorderPage, resolveCarouselSettings } from "../carousel/schema.js";
export const WIDGET_SETTINGS_KEY = "widgetPresets";

export function createWidgetPreset(name = "New character widget") {
  const base = createOverlay(name);
  return validateWidgetPreset({
    schemaVersion: WIDGET_PRESET_SCHEMA_VERSION, id: base.id.replace(/^overlay-/, "widget-preset-"), name: base.name,
    canvas: { width: 400, height: 180 }, background: base.background, layers: []
  });
}

/** Use the existing canvas editor and renderer without giving designs a persistent Actor binding. */
export function widgetPresetToOverlay(input) {
  const preset = validateWidgetPreset(input);
  return validateOverlay({
    ...preset, schemaVersion: SCHEMA_VERSION, widgets: [], adapter: { id: "generic", config: {} }
  });
}

export function overlayToWidgetPreset(input, { id = input?.id, name = input?.name } = {}) {
  const overlay = validateOverlay(input);
  if (overlay.widgets.length) throw new TypeError("Widget preset designs cannot contain legacy widgets.");
  return validateWidgetPreset({
    schemaVersion: WIDGET_PRESET_SCHEMA_VERSION, id, name,
    canvas: overlay.canvas, background: overlay.background, layers: overlay.layers,
    animations: overlay.animations, triggers: overlay.triggers, pages: overlay.pages, cycling: overlay.cycling
  });
}

function examplePreset(id, name, compact) {
  const preset = createWidgetPreset(name);
  preset.id = id;
  preset.canvas = { width: 400, height: compact ? 100 : 180 };
  const canvas = preset.canvas;
  const component = (type, componentId, patch) => ({ ...createLayer(type, canvas), id: componentId, ...patch });
  preset.layers = [
    component("color", "card-background", { color: "#161d27", width: 400, height: canvas.height, z: 0 }),
    component("character-portrait", "portrait", { x: 12, y: 12, width: compact ? 76 : 128, height: compact ? 76 : 128, circular: compact, borderRadius: 8, z: 1 }),
    component("character-name", "name", { x: compact ? 100 : 152, y: compact ? 14 : 18, width: compact ? 288 : 236, height: 42, fontSize: compact ? 25 : 28, fontWeight: "600", fallback: "Character", z: 2 }),
    ...(!compact ? [component("dynamic-text", "hp-text", { x: 152, y: 68, width: 236, height: 38, fontSize: 20, text: "HP: {character.hp.current}/{character.hp.max}", fallback: "—", z: 3 })] : []),
    component("resource-bar", "hp-bar", { x: compact ? 100 : 152, y: compact ? 60 : 120, width: compact ? 288 : 236, height: 26, fontSize: 16, z: compact ? 3 : 4 })
  ];
  return validateWidgetPreset(preset);
}

/** These are ordinary initial records: users may edit, rename, or delete either example. */
export function createWidgetPresetState() {
  return {
    schemaVersion: WIDGET_PRESET_SCHEMA_VERSION, revision: 0,
    presets: [
      examplePreset("widget-basic-character-card", "Basic Character Card", false),
      examplePreset("widget-compact-character-card", "Compact Character Card", true)
    ]
  };
}

export function validateWidgetPresetState(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new TypeError("Widget preset settings must be a plain object.");
  if (![1, 2, 3, WIDGET_PRESET_SCHEMA_VERSION].includes(input.schemaVersion)) throw new TypeError(`Widget preset settings schema version is unsupported. Expected 1, 2, 3, or ${WIDGET_PRESET_SCHEMA_VERSION}.`);
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new TypeError("Widget preset revision must be a non-negative safe integer.");
  if (!Array.isArray(input.presets) || input.presets.length > 100) throw new TypeError("At most 100 widget presets are supported.");
  const presets = input.presets.map(validateWidgetPreset);
  if (new Set(presets.map(preset => preset.id)).size !== presets.length) throw new TypeError("Widget presets contain duplicate IDs.");
  const result = { schemaVersion: WIDGET_PRESET_SCHEMA_VERSION, revision: input.revision, presets };
  if (JSON.stringify(result).length > 2000000) throw new TypeError("Widget preset settings exceed the supported size.");
  return result;
}

export function registerWidgetSettings(onChange = () => {}) {
  if (!globalThis.game?.settings?.register) throw new Error("Foundry settings are unavailable.");
  if (typeof onChange !== "function") throw new TypeError("Widget settings onChange must be a function.");
  game.settings.register(MODULE_ID, WIDGET_SETTINGS_KEY, {
    name: "Character widget presets", scope: "world", config: false, type: Object,
    default: createWidgetPresetState(), restricted: true,
    onChange: value => {
      let state;
      try { state = validateWidgetPresetState(value); }
      catch (error) { onChange(null, error); return; }
      onChange(state, null);
    }
  });
}

export class WidgetPresetConflictError extends Error {
  constructor() {
    super("Widget presets changed in another editor. Reload the saved preset before saving again.");
    this.name = "WidgetPresetConflictError";
    this.code = "WIDGET_PRESET_REVISION_CONFLICT";
  }
}

export class WidgetPresetStore {
  #settings;
  #getUser;
  #onChange;
  #pending = Promise.resolve();

  constructor({ settings = globalThis.game?.settings, getUser = () => globalThis.game?.user, onChange = () => {} } = {}) {
    if (!settings?.get || !settings?.set) throw new Error("Foundry settings are unavailable.");
    if (typeof getUser !== "function" || typeof onChange !== "function") throw new TypeError("Widget store callbacks must be functions.");
    this.#settings = settings;
    this.#getUser = getUser;
    this.#onChange = onChange;
  }

  getState() { return validateWidgetPresetState(this.#settings.get(MODULE_ID, WIDGET_SETTINGS_KEY) ?? createWidgetPresetState()); }
  list() { return this.getState().presets; }

  #mutate(operation, { expectedRevision } = {}) {
    const write = this.#pending.then(async () => {
      if (!this.#getUser()?.isGM) throw new Error("Only a Game Master can change character widget presets.");
      const state = this.getState();
      if (expectedRevision !== undefined) {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError("Expected revision must be a non-negative safe integer.");
        if (state.revision !== expectedRevision) throw new WidgetPresetConflictError();
      }
      if (state.revision >= Number.MAX_SAFE_INTEGER) throw new Error("Widget preset revision limit reached.");
      const result = operation(state);
      state.revision += 1;
      const validated = validateWidgetPresetState(state);
      await this.#settings.set(MODULE_ID, WIDGET_SETTINGS_KEY, validated);
      this.#onChange(clone(validated));
      return clone(result === undefined ? validated : result);
    });
    this.#pending = write.catch(() => {});
    return write;
  }

  #preset(state, id) {
    const preset = state.presets.find(entry => entry.id === id);
    if (!preset) throw new Error("The selected widget preset no longer exists.");
    return preset;
  }

  save(input, options = {}) {
    return this.#mutate(state => {
      const preset = validateWidgetPreset(input);
      const index = state.presets.findIndex(entry => entry.id === preset.id);
      if (index < 0) state.presets.push(preset);
      else state.presets[index] = preset;
      return preset;
    }, options);
  }

  create(name = "New character widget", options = {}) {
    return this.#mutate(state => {
      const preset = createWidgetPreset(name);
      state.presets.push(preset);
      return preset;
    }, options);
  }

  rename(id, name, options = {}) {
    return this.#mutate(state => {
      const preset = this.#preset(state, id);
      preset.name = validateWidgetPreset({ ...preset, name }).name;
      return preset;
    }, options);
  }

  duplicate(id, name, options = {}) {
    return this.#mutate(state => {
      const source = this.#preset(state, id);
      const copy = validateWidgetPreset({ ...source, id: createWidgetPreset().id, name: name ?? `${source.name.slice(0, 75)} copy` });
      state.presets.push(copy);
      return copy;
    }, options);
  }

  delete(id, options = {}) {
    return this.#mutate(state => {
      this.#preset(state, id);
      state.presets = state.presets.filter(entry => entry.id !== id);
    }, options);
  }
}
