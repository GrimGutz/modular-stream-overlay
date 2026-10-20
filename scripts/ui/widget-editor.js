import { OverlayEditor } from "./editor.js";
import { OverlayRenderer } from "../render/renderer.js";
import { WIDGET_DEFINITIONS, widgetPresetToOverlay, overlayToWidgetPreset } from "../core/widget-presets.js";
import { PAGE_TRANSITIONS, addPage, duplicatePage, renamePage, deletePage, reorderPage, validateCycling } from "../carousel/schema.js";
import { DEMO_CHARACTERS } from "../demo/data.js";

const MODULE_ID = "modular-stream-overlay";
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
let services = {};
const applications = new Set();
let manager;
const presetEditors = new Map();

export function configureWidgetEditor(configuration) { services = { ...services, ...configuration }; }
export async function refreshWidgetEditors(options = {}) {
  await Promise.all([...applications].map(application => application.refresh(options)));
}
export async function openWidgetManager(options = {}) {
  manager ??= new WidgetPresetManager(options);
  await manager.render({ force: true });
  return manager;
}
export async function openWidgetPreset(id) {
  let editor = presetEditors.get(id);
  if (!editor) { editor = new WidgetPresetEditor({ presetId: id }); presetEditors.set(id, editor); }
  if (editor._draft && editor._draft.id !== id) await editor._editOverlay({ dataset: { overlayId: id } });
  await editor.render({ force: true });
  return editor;
}

/** Reuses the full overlay layer editor and its interaction controller in local design coordinates. */
export class WidgetPresetEditor extends OverlayEditor {
  static DEFAULT_OPTIONS = {
    ...OverlayEditor.DEFAULT_OPTIONS,
    id: "modular-stream-overlay-widget-editor",
    window: { title: "Character Widget Designer", icon: "fa-solid fa-id-card", resizable: true },
    actions: { ...OverlayEditor.DEFAULT_OPTIONS.actions, addComponent: OverlayEditor.onAction, choosePreviewActor: OverlayEditor.onAction, chooseDemoPreviewActor: OverlayEditor.onAction }
  };

  constructor({ presetId, ...options } = {}) {
    super({ id: `modular-stream-overlay-widget-editor-${presetId ?? globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`, ...options });
    this.widgetMode = true;
    this._initialPresetId = presetId;
    this._previewActorUuid = "";
    this._previewActorLabel = "No character — safe placeholder preview";
    this._pageScope = "shared";
    this._previewRunning = false;
  }

  get widgetPresets() { return services.widgetPresets ?? super.widgetPresets; }
  get characterData() { return services.characterData ?? super.characterData; }
  // The adapter presents the existing draft/conflict lifecycle with no writes to overlay settings.
  get store() {
    return {
      getState: () => {
        const state = this.widgetPresets.getState();
        return { revision: state.revision, activeOverlayId: null, overlays: this.widgetPresets.list().map(widgetPresetToOverlay) };
      },
      listPresets: () => []
    };
  }

  _initialOverlay(state) { return state.overlays.find(overlay => overlay.id === this._initialPresetId) ?? state.overlays[0] ?? null; }
  _loadDraft(overlay, revision) {
    this._scopeProjection = null;
    if (!(overlay?.pages ?? []).some(page => page.id === this._pageScope)) this._pageScope = "shared";
    this._previewRunning = false;
    super._loadDraft(overlay, revision);
  }
  _allLayers() { return [...(this._draft?.layers ?? []), ...(this._draft?.pages ?? []).flatMap(page => page.layers)]; }
  _animationTargets(_target, { wholeDesign = false } = {}) {
    return wholeDesign ? this._allLayers() : [...(this._draft?.layers ?? []), ...(this._draft?.pages?.find(page => page.id === this._pageScope)?.layers ?? [])];
  }
  _editingOverlay() {
    const page = this._draft?.pages?.find(entry => entry.id === this._pageScope);
    if (!page) return this._draft;
    if (this._scopeProjection?.source !== this._draft || this._scopeProjection.page !== page) {
      this._scopeProjection = { source: this._draft, page, view: { ...this._draft, layers: page.layers, widgets: [], pages: [], cycling: { ...this._draft.cycling, startPageId: null } } };
    }
    // Keep canvas dimensions current without replacing the stable gesture document.
    this._scopeProjection.view.canvas = this._draft.canvas;
    return this._scopeProjection.view;
  }
  _canvasBlocked() { return super._canvasBlocked() || this._previewRunning; }
  async _updatePreview() {
    this._preview?.renderer?.setPageEditing?.(this._previewRunning ? null : this._pageScope);
    await super._updatePreview();
    this._syncCarouselPreview();
  }
  _previewContext() { return { ...super._previewContext(), previewActorUuid: this._previewActorUuid, onCarouselChange: state => this._syncCarouselPreview(state) }; }
  async _prepareContext(options) {
    return { ...await super._prepareContext(options), widgetMode: true, previewActorLabel: this._previewActorLabel,
      componentDefinitions: [...WIDGET_DEFINITIONS.filter(definition => !["image", "text", "character-widget"].includes(definition.type)), { type: "color", label: "Color background" }] };
  }
  async _onRender(context, options) { await super._onRender(context, options); this._renderPagesPanel(); applications.add(this); }

  async _selectPageScope(id) {
    if (id !== "shared" && !this._draft?.pages.some(page => page.id === id)) return;
    this._preview?.cancelGesture?.();
    this._pageScope = id;
    this._previewRunning = false;
    this._scopeProjection = null;
    this._selectedLayerId = null;
    await this._updatePreview();
    this._preview?.select(null, { notify: false });
    this._renderLayerPanel();
    this._renderPagesPanel();
  }

  async _pageCommand(command, id = this._pageScope) {
    if (!this._draft) return;
    const page = this._draft.pages.find(entry => entry.id === id);
    let scope = id;
    if (command === "add") {
      const name = await this._name("Add information page", `Information page ${this._draft.pages.length + 1}`);
      if (!name) return;
      scope = addPage(this._draft, name).id;
    } else if (!page) return;
    else if (command === "rename") {
      const name = await this._name("Rename information page", page.name);
      if (!name) return;
      renamePage(this._draft, id, name);
    } else if (command === "duplicate") scope = duplicatePage(this._draft, id).id;
    else if (command === "delete") {
      if (!await this._confirm("Delete information page", `Delete “${page.name}” and its components? Shared elements remain in the design.`, "Delete page")) return;
      deletePage(this._draft, id);
      for (const key of this._invalidInputs.keys()) {
        if (key.startsWith(`page.${id}.`) || page.layers.some(layer => key.startsWith(`layer.${layer.id}.`) || key === `animation.${layer.id}`)) this._invalidInputs.delete(key);
      }
      for (const layer of page.layers) this._animationEdits.delete(`animation.${layer.id}`);
      scope = "shared";
    } else if (["up", "down", "first", "last"].includes(command)) reorderPage(this._draft, id, command);
    else return;
    this._markDirty();
    await this._selectPageScope(scope);
    this._renderSharedWidgetAnimations();
  }

  /** Page and timer controls change only this editor's private draft. */
  _onCarouselInput(input, { page = null, field }) {
    if (!this._draft || this._busy || this._uploading) return;
    const key = page ? `page.${page.id}.${field}` : `cycling.${field}`;
    let value = input.type === "checkbox" ? input.checked : input.value;
    try {
      if (["duration", "transitionDuration", "characterTransitionDuration"].includes(field)) {
        value = page && input.value.trim() === "" ? null : Number(input.value) * (field === "duration" ? 1000 : 1);
        if (value !== null && (!Number.isSafeInteger(value) || value < (field === "duration" ? 100 : 0) || value > (field === "duration" ? 3600000 : 10000))) throw new Error(field === "duration" ? "Enter a duration from 0.1 to 3600 seconds." : "Enter a transition duration from 0 to 10000 milliseconds.");
        if (!page && input.value.trim() === "") throw new Error("Enter a default page duration.");
      }
      if (field === "startPageId") value ||= null;
      if (page) page[field] = value;
      else this._draft.cycling = validateCycling({ ...this._draft.cycling, [field]: value }, this._draft.pages);
      input.setCustomValidity("");
      this._invalidInputs.delete(key);
      this._markDirty();
      void this._updatePreview();
    } catch (error) {
      input.setCustomValidity(error.message);
      this._invalidInputs.set(key, input.type === "checkbox" ? input.checked : input.value);
      this._markDirty();
    }
  }

  _carouselField(host, label, field, { page = null, type = "text", options, min, max, step } = {}) {
    const wrapper = document.createElement("label"); wrapper.className = `mso-layer-field${type === "checkbox" ? " mso-checkbox-field" : ""}`;
    const title = document.createElement("span"); title.textContent = label;
    const input = document.createElement(options ? "select" : "input");
    if (!options) input.type = type;
    input.dataset.carouselField = field; input.setAttribute("aria-label", label);
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    if (step !== undefined) input.step = String(step);
    for (const option of options ?? []) { const entry = document.createElement("option"); entry.value = option.id; entry.textContent = option.label; input.append(entry); }
    const source = page ?? this._draft.cycling;
    let value = source[field];
    if (field === "duration" && value !== null) value /= 1000;
    if (type === "checkbox") input.checked = !!value;
    else input.value = String(value ?? "");
    const key = page ? `page.${page.id}.${field}` : `cycling.${field}`;
    if (this._invalidInputs.has(key)) { input.value = this._invalidInputs.get(key); input.setCustomValidity("Correct this page or cycling setting before saving."); }
    input.disabled = this._uploading;
    input.addEventListener(type === "checkbox" || options ? "change" : "input", () => this._onCarouselInput(input, { page, field }));
    if (type === "checkbox") wrapper.append(input, title); else wrapper.append(title, input);
    host.append(wrapper);
    return input;
  }

  _pageButton(host, label, operation, { disabled = false } = {}) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.disabled = disabled || this._uploading;
    button.addEventListener("click", () => { void this._draftOperation(operation); }); host.append(button); return button;
  }

  _renderPagesPanel() {
    const host = this.element?.querySelector("[data-widget-pages]");
    if (!host || !this._draft) return;
    host.replaceChildren();
    const scopeLabel = document.createElement("label"); scopeLabel.className = "mso-layer-field";
    const caption = document.createElement("span"); caption.textContent = "Edit content";
    const scope = document.createElement("select"); scope.setAttribute("aria-label", "Edit shared elements or an information page");
    for (const entry of [{ id: "shared", name: "Shared elements — visible on every page" }, ...this._draft.pages]) {
      const option = document.createElement("option"); option.value = entry.id; option.textContent = entry.name; scope.append(option);
    }
    scope.value = this._pageScope; scope.disabled = this._uploading;
    scope.addEventListener("change", () => { void this._draftOperation(() => this._selectPageScope(scope.value)); });
    scopeLabel.append(caption, scope); host.append(scopeLabel);
    const buttons = document.createElement("div"); buttons.className = "mso-page-actions"; host.append(buttons);
    this._pageButton(buttons, "Add page", () => this._pageCommand("add"), { disabled: this._draft.pages.length >= 20 });
    const page = this._draft.pages.find(entry => entry.id === this._pageScope);
    if (page) {
      for (const [label, command] of [["Rename page", "rename"], ["Duplicate page", "duplicate"], ["Earlier", "up"], ["Later", "down"], ["Delete page", "delete"]]) this._pageButton(buttons, label, () => this._pageCommand(command));
      const pageFields = document.createElement("div"); pageFields.className = "mso-cycling-grid"; host.append(pageFields);
      this._carouselField(pageFields, "Enable this information page", "enabled", { page, type: "checkbox" });
      this._carouselField(pageFields, "This page duration (seconds; blank uses default)", "duration", { page, type: "number", min: .1, max: 3600, step: .1 });
      this._carouselField(pageFields, "Skip this page when no dynamic information is available", "skipIfUnavailable", { page, type: "checkbox" });
    }
    const hint = document.createElement("p"); hint.className = "mso-help"; hint.textContent = page ? `Editing “${page.name}”. Shared elements remain visible and can be edited by choosing Shared elements.` : "Shared elements remain visible while pages change. Put the portrait, name, and frame here. To replace the entire card, put all components inside pages."; host.append(hint);
    const heading = document.createElement("h4"); heading.textContent = "Cycling settings"; host.append(heading);
    const settings = document.createElement("div"); settings.className = "mso-cycling-grid"; host.append(settings);
    this._carouselField(settings, "Enable automatic cycling", "enabled", { type: "checkbox" });
    this._carouselField(settings, "Default cycling mode", "mode", { options: [{ id: "static", label: "Static — one character and page" }, { id: "information", label: "Information Only — one character, all pages" }, { id: "character", label: "Character Only — all characters, one page" }, { id: "combined", label: "Combined — all pages for each character" }] });
    this._carouselField(settings, "Traversal order", "traversal", { options: [{ id: "pages-first", label: "Pages First — A/1, A/2, B/1, B/2" }, { id: "characters-first", label: "Characters First — A/1, B/1, A/2, B/2" }] });
    this._carouselField(settings, "Default page duration (seconds)", "duration", { type: "number", min: .1, max: 3600, step: .1 });
    this._carouselField(settings, "Page transition", "transition", { options: PAGE_TRANSITIONS });
    this._carouselField(settings, "Transition duration (milliseconds)", "transitionDuration", { type: "number", min: 0, max: 10000, step: 1 });
    this._carouselField(settings, "Character transition", "characterTransition", { options: PAGE_TRANSITIONS });
    this._carouselField(settings, "Character transition duration (milliseconds)", "characterTransitionDuration", { type: "number", min: 0, max: 10000, step: 1 });
    this._carouselField(settings, "Loop pages", "loop", { type: "checkbox" });
    this._carouselField(settings, "Starting page", "startPageId", { options: [{ id: "", label: "First available page" }, ...this._draft.pages.map(entry => ({ id: entry.id, label: entry.name }))] });
    const preview = document.createElement("div"); preview.className = "mso-carousel-preview"; host.append(preview);
    const status = document.createElement("p"); status.dataset.carouselPreviewStatus = ""; status.className = "mso-help"; status.setAttribute("role", "status"); preview.append(status);
    const actions = document.createElement("div"); actions.className = "mso-page-actions"; preview.append(actions);
    for (const [label, command] of [["Previous page", "previous"], ["Next page", "next"], ["Pause preview", "pause"], ["Resume preview", "resume"], ["Edit selected content", "edit"]]) this._pageButton(actions, label, () => this._previewCarousel(command), { disabled: command !== "edit" && !this._draft.pages.length });
    const selectLabel = document.createElement("label"); selectLabel.className = "mso-layer-field"; selectLabel.textContent = "Preview page";
    const select = document.createElement("select"); select.dataset.carouselPreviewPage = ""; select.setAttribute("aria-label", "Manually preview information page");
    for (const entry of this._draft.pages) { const option = document.createElement("option"); option.value = entry.id; option.textContent = entry.name; select.append(option); }
    select.disabled = this._uploading || !this._draft.pages.length;
    select.addEventListener("change", () => { void this._draftOperation(() => this._previewCarousel("select", select.value)); }); selectLabel.append(select); preview.append(selectLabel);
    const policy = document.createElement("p"); policy.className = "mso-help"; policy.textContent = "Pause preserves the remaining time; Resume continues it. Display duration starts after each transition completes. Manual changes keep the current pause state. Preview controls stay private. Assign character lists and preview the complete combined sequence in an overlay instance's Carousel Settings. Canvas editing pauses during playback preview."; preview.append(policy);
    this._syncCarouselPreview();
  }

  async _previewCarousel(command, pageId) {
    if (command === "edit") return this._selectPageScope(this._pageScope);
    if (!this._previewRunning) {
      const current = this._preview?.renderer?.carousel?.getState?.().activePageId;
      this._previewRunning = true; this._preview?.cancelGesture?.(); await this._updatePreview();
      const carousel = this._preview?.renderer?.carousel;
      carousel?.pause();
      if (current && carousel?.getState?.().availablePageIds?.includes(current)) await carousel.select(current);
    }
    const carousel = this._preview?.renderer?.carousel;
    if (command === "select") await carousel?.select(pageId);
    else await carousel?.[command]?.();
    this._syncCarouselPreview();
  }
  _syncCarouselPreview(state = this._preview?.renderer?.carousel?.getState?.()) {
    const status = this.element?.querySelector("[data-carousel-preview-status]");
    const page = this._draft?.pages?.find(entry => entry.id === state?.activePageId);
    if (status) status.textContent = this._previewRunning ? `Playback preview${page ? `: ${page.name}` : ""} — ${state?.paused ? "paused" : "running"}. Choose Edit selected content to adjust the canvas.` : `Editing ${this._pageScope === "shared" ? "shared elements" : this._draft?.pages?.find(entry => entry.id === this._pageScope)?.name ?? "page"}.`;
    const select = this.element?.querySelector("[data-carousel-preview-page]"); if (select && state?.activePageId) select.value = state.activePageId;
    this._previewElement?.classList?.toggle("mso-carousel-playing", this._previewRunning);
  }
  async _createOverlay() {
    if (!await this._discardDraft()) return;
    const name = await this._name("Create widget preset", "New character widget");
    if (!name) return;
    const preset = await this.widgetPresets.create(name);
    this._loadDraft(widgetPresetToOverlay(preset));
  }
  async _deleteOverlay() {
    if (!this._draft || !await this._confirm("Delete widget design", `Delete “${this._draft.name}”? Linked instances keep their Actor assignments, but will show a missing-design placeholder.`, "Delete design")) return;
    await this.widgetPresets.delete(this._draft.id, { expectedRevision: this._loadedRevision });
    const state = this.store.getState(); this._loadDraft(this._initialOverlay(state), state.revision);
  }
  _validateInputs() {
    const invalid = [...this.element.querySelectorAll("[data-carousel-field]")].find(input => !input.checkValidity());
    if (invalid) { invalid.reportValidity(); throw new Error("Correct the highlighted page or cycling setting before saving."); }
    super._validateInputs();
  }
  async _saveOverlay() {
    if (!this._draft) return;
    this._validateInputs();
    const preset = overlayToWidgetPreset(this._draft, { id: this._draft.id, name: this._draft.name });
    const saved = await this.widgetPresets.save(preset, { expectedRevision: this._loadedRevision });
    this._loadDraft(widgetPresetToOverlay(saved));
    ui.notifications.info("Widget design saved. Linked instances retain their characters and positions.");
  }
  async _addComponent(target) {
    const type = target.dataset.componentType;
    if (type !== "color" && !WIDGET_DEFINITIONS.some(definition => definition.type === type) || type === "character-widget") throw new Error("Choose an available widget component.");
    return this._addLayer(type);
  }
  async _choosePreviewActor() {
    const actor = await this._chooseActor(); if (actor === undefined) return;
    this._previewActorUuid = actor?.uuid ?? "";
    this._previewActorLabel = actor?.name ?? "No character — safe placeholder preview";
    if (this._preview?.renderer) this._preview.renderer.context.previewActorUuid = this._previewActorUuid;
    const label = this.element.querySelector("[data-preview-actor]"); if (label) label.textContent = this._previewActorLabel;
    await this._updatePreview();
    this._renderLayerProperties(); this._renderSharedWidgetAnimations();
  }
  async _chooseDemoPreviewActor() {
    this._previewActorUuid = DEMO_CHARACTERS[0].uuid;
    this._previewActorLabel = `${DEMO_CHARACTERS[0].name} — DEMO DATA`;
    if (this._preview?.renderer) this._preview.renderer.context.previewActorUuid = this._previewActorUuid;
    const label = this.element.querySelector("[data-preview-actor]"); if (label) label.textContent = this._previewActorLabel;
    await this._updatePreview();
    this._renderLayerProperties(); this._renderSharedWidgetAnimations();
  }
  async close(options) {
    const result = await super.close(options);
    if (!this.rendered) { applications.delete(this); for (const [id, editor] of presetEditors) if (editor === this) presetEditors.delete(id); }
    return result;
  }
}

/** Separate library for reusable character designs; full-overlay presets remain in the overlay editor. */
export class WidgetPresetManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "modular-stream-overlay-widget-manager", classes: ["mso-editor", "mso-widget-manager"],
    window: { title: "Widget Preset Manager", icon: "fa-solid fa-id-card", resizable: true }, position: { width: 1000, height: 740 },
    actions: Object.fromEntries(["createWidgetPreset", "fieldMappings"].map(action => [action, WidgetPresetManager.onAction]))
  };
  static PARTS = { manager: { template: `modules/${MODULE_ID}/templates/widget-manager.hbs` } };
  constructor(options) { super(options); this._previews = []; this._busy = false; }
  get api() { return game.modules.get(MODULE_ID)?.api; }
  get store() { return services.widgetPresets ?? this.api?.widgetPresets; }
  _canRender(options) { return game.user?.isGM ? super._canRender(options) : false; }
  async _prepareContext(options) { return { ...await super._prepareContext(options), presets: this.store.list() }; }
  async refresh() { if (this.rendered && !this._busy) await this.render({ force: true }); }
  _destroyPreviews() { this._previews.forEach(preview => preview.destroy()); this._previews = []; }
  async _onRender(context, options) {
    await super._onRender(context, options); applications.add(this); this._destroyPreviews();
    const presets = this.store.list();
    for (const host of this.element.querySelectorAll("[data-widget-preview]")) {
      const preset = presets.find(entry => entry.id === host.dataset.widgetPreview); if (!preset) continue;
      const preview = new OverlayRenderer(host, { preview: true, widgets: services.widgets, context: { ...(services.context ?? {}), widgetPresets: this.store, characterData: services.characterData } });
      this._previews.push(preview); await preview.render(widgetPresetToOverlay(preset));
    }
    this.element.querySelectorAll("[data-widget-command]").forEach(button => button.addEventListener("click", () => {
      void this._perform(() => this._command(button.dataset.widgetCommand, button.dataset.presetId));
    }));
  }
  static onAction(event, target) { event.preventDefault(); void this._perform(() => this[`_${target.dataset.action}`]()); }
  async _perform(operation) {
    if (this._busy) return; this._busy = true;
    let failure;
    try { await operation(); }
    catch (error) { failure = error; }
    finally {
      this._busy = false;
      try { if (this.rendered) await this.render({ force: true }); }
      catch (error) {
        if (failure && failure !== error) console.error(`${MODULE_ID} | Widget manager refresh failed`, error);
        failure ??= error;
      }
    }
    if (failure) {
      console.error(`${MODULE_ID} | Widget preset operation failed`, failure);
      ui.notifications.error(failure.message || "The widget preset could not be updated.");
    }
  }
  async _name(title, initial) { return OverlayEditor.prototype._name.call(this, title, initial); }
  async _confirm(title, text, label) { return OverlayEditor.prototype._confirm.call(this, title, text, label); }
  async _createWidgetPreset() {
    const name = await this._name("Create widget preset", "New character widget"); if (!name) return;
    const preset = await this.store.create(name); await openWidgetPreset(preset.id);
  }
  async _command(command, id) {
    const preset = this.store.list().find(entry => entry.id === id); if (!preset) throw new Error("This widget preset no longer exists.");
    const options = { expectedRevision: this.store.getState().revision };
    if (command === "edit") return openWidgetPreset(id);
    if (command === "rename") { const name = await this._name("Rename widget preset", preset.name); if (name) await this.store.rename(id, name, options); }
    else if (command === "duplicate") { const name = await this._name("Duplicate widget preset", `${preset.name.slice(0, 75)} copy`); if (name) await this.store.duplicate(id, name, options); }
    else if (command === "delete" && await this._confirm("Delete widget preset", `Delete “${preset.name}”? Existing instances will show a missing-design placeholder.`, "Delete preset")) await this.store.delete(id, options);
  }
  async _fieldMappings() {
    const content = document.createElement("div");
    const help = document.createElement("p"); help.textContent = "Advanced system fields: add mappings with id, label, type (number or string), and a system.* path from your system's documented Actor schema. Only fields explicitly used by a widget are read. Example: character.resource, Resource, number, system.resources.focus.value.";
    const textarea = document.createElement("textarea"); textarea.name = "mappings"; textarea.rows = 14; textarea.style.width = "100%"; textarea.setAttribute("aria-label", "Character field mappings JSON");
    // DialogV2 serializes the supplied DIV to HTML before constructing its form.
    // Textarea content is its persisted default; a .value-only assignment would be lost.
    textarea.textContent = JSON.stringify(this.api?.getFieldMappings?.() ?? [], null, 2);
    content.append(help, textarea);
    const result = await DialogV2.input({ window: { title: "Character field mappings" }, content, modal: true, rejectClose: false });
    if (!result) return;
    let mappings;
    try { mappings = JSON.parse(result.mappings); } catch { throw new Error("Field mappings must be a JSON array. Reopen mappings to correct it."); }
    if (!Array.isArray(mappings)) throw new Error("Field mappings must be a JSON array.");
    if (!this.api?.setFieldMappings) throw new Error("Character mappings are not ready.");
    await this.api.setFieldMappings(mappings); ui.notifications.info("Character field mappings saved.");
  }
  async close(options) { this._destroyPreviews(); applications.delete(this); manager = undefined; return super.close(options); }
}
