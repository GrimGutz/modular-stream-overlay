import { MODULE_ID, SCHEMA_VERSION, BUILTIN_PRESETS, clone, createOverlay, createState, validateOverlay, validateState } from "./schema.js";

export const SETTINGS_KEY = "state";

/** Register once during Foundry's init hook; Foundry broadcasts world-setting changes. */
export function registerSettings(onChange = () => {}) {
  if (!globalThis.game?.settings?.register) throw new Error("Foundry settings are unavailable.");
  if (typeof onChange !== "function") throw new TypeError("Settings onChange must be a function.");
  globalThis.game.settings.register(MODULE_ID, SETTINGS_KEY, {
    name: "Stream overlay configuration", scope: "world", config: false, type: Object,
    default: createState(), restricted: true,
    onChange: value => {
      let state;
      try { state = validateState(value); }
      catch (error) { onChange(null, error); return; }
      onChange(state, null);
    }
  });
}

export class OverlayConflictError extends Error {
  constructor() {
    super("Overlay settings changed in another editor. Reload the saved configuration before saving again.");
    this.name = "OverlayConflictError";
    this.code = "OVERLAY_REVISION_CONFLICT";
  }
}

/** The settings/user injection points also permit isolated tests without a Foundry runtime. */
export class OverlayStore {
  #settings;
  #getUser;
  #onChange;
  #pending = Promise.resolve();

  constructor({ settings = globalThis.game?.settings, getUser = () => globalThis.game?.user, onChange = () => {} } = {}) {
    if (!settings?.get || !settings?.set) throw new Error("Foundry settings are unavailable.");
    if (typeof getUser !== "function" || typeof onChange !== "function") throw new TypeError("Store callbacks must be functions.");
    this.#settings = settings;
    this.#getUser = getUser;
    this.#onChange = onChange;
  }

  getState() {
    const value = this.#settings.get(MODULE_ID, SETTINGS_KEY);
    return validateState(value ?? createState());
  }

  #assertGM() {
    if (!this.#getUser()?.isGM) throw new Error("Only a Game Master can change stream overlays.");
  }

  #mutate(operation, { expectedRevision } = {}) {
    const write = this.#pending.then(async () => {
      this.#assertGM();
      const state = this.getState();
      if (expectedRevision !== undefined) {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError("Expected revision must be a non-negative safe integer.");
        if (state.revision !== expectedRevision) throw new OverlayConflictError();
      }
      if (state.revision >= Number.MAX_SAFE_INTEGER) throw new Error("Overlay settings revision limit reached.");
      const result = operation(state);
      state.revision += 1;
      const validated = validateState(state);
      await this.#settings.set(MODULE_ID, SETTINGS_KEY, validated);
      this.#onChange(clone(validated));
      return clone(result === undefined ? validated : result);
    });
    this.#pending = write.catch(() => {});
    return write;
  }

  saveOverlay(input, options = {}) {
    if (options.activateIfEmpty !== undefined && typeof options.activateIfEmpty !== "boolean") throw new TypeError("Initial overlay activation must be true or false.");
    return this.#mutate(state => {
      const overlay = validateOverlay(input);
      const wasEmpty = state.overlays.length === 0;
      const index = state.overlays.findIndex(entry => entry.id === overlay.id);
      if (index < 0) state.overlays.push(overlay);
      else state.overlays[index] = overlay;
      if (wasEmpty && options.activateIfEmpty !== false) state.activeOverlayId = overlay.id;
      return overlay;
    }, options);
  }

  createOverlay(name = "New overlay", options = {}) {
    return this.#mutate(state => {
      const overlay = createOverlay(name);
      const wasEmpty = state.overlays.length === 0;
      state.overlays.push(overlay);
      if (wasEmpty) state.activeOverlayId = overlay.id;
      return overlay;
    }, options);
  }

  renameOverlay(id, name, options = {}) {
    return this.#mutate(state => {
      const overlay = this.#overlay(state, id);
      overlay.name = validateOverlay({ ...overlay, name }).name;
      return overlay;
    }, options);
  }

  deleteOverlay(id, options = {}) {
    return this.#mutate(state => {
      this.#overlay(state, id);
      state.overlays = state.overlays.filter(entry => entry.id !== id);
      if (state.activeOverlayId === id) state.activeOverlayId = null;
    }, options);
  }

  setActive(id, options = {}) {
    return this.#mutate(state => {
      if (id !== null) this.#overlay(state, id);
      state.activeOverlayId = id;
    }, options);
  }

  listPresets() {
    return this.#presets(this.getState());
  }

  savePreset(input, name = input?.name, options = {}) {
    return this.#mutate(state => {
      const overlay = validateOverlay(input);
      const preset = {
        schemaVersion: SCHEMA_VERSION, id: createOverlay().id.replace(/^overlay-/, "preset-"),
        name: validateOverlay({ ...overlay, name }).name, overlay
      };
      state.presets.push(preset);
      return preset;
    }, options);
  }

  loadPreset(id, targetOverlayId = null, options = {}) {
    return this.#mutate(state => {
      const preset = this.#presets(state).find(entry => entry.id === id);
      if (!preset) throw new Error("The selected preset no longer exists.");
      const wasEmpty = state.overlays.length === 0;
      const target = targetOverlayId === null ? createOverlay(preset.name) : this.#overlay(state, targetOverlayId);
      const overlay = validateOverlay({ ...clone(preset.overlay), id: target.id, name: target.name });
      const index = state.overlays.findIndex(entry => entry.id === overlay.id);
      if (index < 0) state.overlays.push(overlay);
      else state.overlays[index] = overlay;
      if (wasEmpty) state.activeOverlayId = overlay.id;
      return overlay;
    }, options);
  }

  renamePreset(id, name, options = {}) {
    return this.#mutate(state => {
      const preset = this.#customPreset(state, id);
      preset.name = validateOverlay({ ...preset.overlay, name }).name;
      return preset;
    }, options);
  }

  duplicatePreset(id, name, options = {}) {
    return this.#mutate(state => {
      const source = this.#presets(state).find(entry => entry.id === id);
      if (!source) throw new Error("The selected preset no longer exists.");
      const defaultName = `${source.name.slice(0, 75)} copy`;
      const preset = {
        schemaVersion: SCHEMA_VERSION, id: createOverlay().id.replace(/^overlay-/, "preset-"),
        name: validateOverlay({ ...source.overlay, name: name ?? defaultName }).name,
        overlay: clone(source.overlay)
      };
      state.presets.push(preset);
      return preset;
    }, options);
  }

  deletePreset(id, options = {}) {
    return this.#mutate(state => {
      this.#customPreset(state, id);
      state.presets = state.presets.filter(entry => entry.id !== id);
    }, options);
  }

  #overlay(state, id) {
    const overlay = state.overlays.find(entry => entry.id === id);
    if (!overlay) throw new Error("The selected overlay no longer exists.");
    return overlay;
  }

  #customPreset(state, id) {
    if (BUILTIN_PRESETS.some(entry => entry.id === id)) throw new Error("Built-in presets cannot be changed. Duplicate the preset first.");
    const preset = state.presets.find(entry => entry.id === id);
    if (!preset) throw new Error("The selected preset no longer exists.");
    return preset;
  }

  #presets(state) {
    return [...clone(BUILTIN_PRESETS), ...state.presets.map(entry => ({ ...clone(entry), builtin: false }))];
  }
}
