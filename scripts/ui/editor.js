import { LayerCanvas } from "../editor/layer-canvas.js";
import { DraftHistory, HISTORY_DELAY } from "../editor/history.js";
import { serializeLayers, parseLayers, rememberLayers, rememberedLayers } from "../editor/clipboard.js";
import { alignPositions, boundsOf, distributePositions } from "../editor/arrange.js";
import { moveGeometry } from "../editor/geometry.js";
import { uploadBackground } from "../core/background-upload.js";
import { loadFoundryFonts } from "../integration/fonts.js";
import { createOverlay, validateAssetPath, validateLayer, validateOverlay } from "../core/schema.js";
import { VersionStore } from "../core/saved-versions.js";
import { listFragments, saveFragment, deleteFragment } from "../core/fragments.js";
import { rescaleOverlay, rescaleTransform } from "../core/rescale.js";
import { overlayToWidgetPreset } from "../core/widget-presets.js";
import { OverlayRenderer } from "../render/renderer.js";
import { exportBundle, exportFragment, exportFilename, readTransferFile, needsActorChoices, planImport, missingActors } from "../authoring/transfer.js";
import { importOverlayBundle } from "../authoring/bundle.js";
import { createLayer, createWidgetInstance, duplicateLayer, deleteLayer, pasteLayers, reorderLayer, reorderInGroup, stepLayer,
  moveLayers, groupLayers, layerOrder, dissolveSmallGroups } from "../core/layers.js";
import { isCharacterComponent } from "../render/character-components.js";
import { renderAnimationTestControls } from "./animation-controls.js";
import { DEMO_ACTOR_UUIDS } from "../demo/data.js";
import { fieldLabel, sortedFields } from "./field-settings.js";
import { t, uiText, errorText, localizeDOM, setText, setAttr, onLanguageChange } from "./i18n.js";
import { L, S, labelText, editorError, writeText, writeAttr, writeError, setValidity, markDialog, relabelEditorText } from "./editor-text.js";
import { LayerInspector } from "./editor-inspector.js";
import { CharacterPanels } from "./editor-characters.js";
import { LayerList } from "./editor-layers.js";

const MODULE_ID = "modular-stream-overlay";
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
let services = {};
const editors = new Set();
// Every open overlay editor and widget designer shows the shared fragment library.
const fragmentViews = new Set();
let defaultVersions;
const VIEWER_ROLES = { 1: "Template.RolePlayer", 2: "Template.RoleTrusted", 3: "Template.RoleAssistant", 4: "Template.RoleGamemaster" };
const GRID_STEPS = [10, 20, 25, 50, 100];
onLanguageChange(() => { for (const editor of editors) editor.refreshLanguage(); });

/** Supply dependencies without coupling the editor to storage or renderer internals. */
export function configureEditor(configuration) {
  services = { ...services, ...configuration };
}

/** The fragment library changed (here or by another GM). */
export function refreshFragmentLists() {
  for (const editor of fragmentViews) editor._renderFragments();
}

/** Refresh API-opened and Foundry Settings menu instances alike. */
export async function refreshEditors(options = {}) {
  await Promise.all([...editors].map(editor => editor.refresh(options)));
}

const clone = value => foundry.utils.deepClone(value);

/** Save JSON as a file through Foundry's helper, or a plain download link without it. */
function downloadJson(data, filename) {
  const text = JSON.stringify(data, null, 2);
  if (typeof foundry.utils?.saveDataToFile === "function") return foundry.utils.saveDataToFile(text, "application/json", filename);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** This world's Actors, for naming exported characters and matching imported ones; a GM sees them all. */
function worldActors() {
  const actors = globalThis.game?.actors?.contents ?? [];
  return actors.map(actor => ({ uuid: actor.uuid, name: String(actor.name ?? "") })).sort((left, right) => left.name.localeCompare(right.name));
}

/** A fragment drawn on its own small canvas, for its thumbnail. */
function fragmentOverlay(fragment) {
  const bounds = boundsOf(fragment.layers);
  const overlay = createOverlay(fragment.name);
  overlay.canvas = { width: Math.min(7680, Math.max(64, Math.ceil(bounds.width))), height: Math.min(7680, Math.max(64, Math.ceil(bounds.height))) };
  overlay.layers = fragment.layers.map(layer => ({ ...layer, x: layer.x - bounds.x, y: layer.y - bounds.y }));
  return overlay;
}

/** Natural pixel size of an image file; a fallback box when the browser cannot decode it here. */
async function imageSize(file) {
  try {
    const bitmap = await globalThis.createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    if (size.width > 0 && size.height > 0) return size;
  } catch { /* The uploader already checked the file; keep a default box. */ }
  return { width: 640, height: 360 };
}

/**
 * The GM-only visual editor. Unsaved drafts are private to this application. The Layers panel,
 * layer properties and character widget panels come from the LayerList, LayerInspector and
 * CharacterPanels mixins.
 */
export class OverlayEditor extends CharacterPanels(LayerInspector(LayerList(HandlebarsApplicationMixin(ApplicationV2)))) {
  static DEFAULT_OPTIONS = {
    id: "modular-stream-overlay-editor",
    classes: ["mso-editor"],
    window: { title: "modular-stream-overlay.Editor.Title", icon: "fa-solid fa-tv", resizable: true },
    position: { width: 1380, height: 900 },
    actions: Object.fromEntries([
      "editOverlay", "createOverlay", "renameOverlay", "deleteOverlay", "saveOverlay", "reloadOverlay",
      "uploadBackground", "browseBackground", "removeBackground", "savePreset", "loadPreset", "renamePreset", "duplicatePreset",
      "deletePreset", "saveViewer", "copyURL", "addImage", "addText", "selectTool", "addWidget", "manageWidgets", "liveControls", "characterColors", "installDemo", "resetDemo",
      "toggleCanvasFullscreen", "showVersions", "rescaleCanvas", "exportFile", "importFile"
    ].map(action => [action, OverlayEditor.onAction]))
  };

  // Scroll positions survive full renders, so panels do not jump back to the top.
  static PARTS = { editor: { template: `modules/${MODULE_ID}/templates/editor.hbs`,
    scrollable: [".mso-overlay-list", ".mso-main", ".mso-inspector", ".mso-layer-list"] } };

  constructor(options = {}) {
    super(options);
    this._draft = null;
    this._loadedRevision = null;
    this._dirty = false;
    this._conflict = false;
    this._busy = false;
    this._preview = null;
    this._previewElement = null;
    this._selectedPresetId = "builtin-transparent";
    this._invalidInputs = new Map();
    this._animationEdits = new Map();
    this._uploading = false;
    this._uploadControls = new Map();
    this._thumbnailGeneration = 0;
    this._selectedLayerId = null;
    this._zoom = "fit";
    this._imageUploadTarget = null;
    this._testLayerId = null;
    this._testTarget = "preview";
    this._realActorAssignments = new Map();
  }

  get api() { return game.modules.get(MODULE_ID)?.api; }
  get title() { return t("Editor.Title"); }
  get store() { return services.store ?? this.api?.store; }
  get characterData() { return services.characterData ?? this.api?.characterData; }
  get widgetPresets() { return services.widgetPresets ?? this.api?.widgetPresets; }
  /** Discord voice for previews: who is in the channel (from the stream page) and the preview mode. */
  get voice() { return services.voice ?? services.context?.voice ?? null; }
  _openVoiceRoster() { return (services.openVoiceRoster ?? this.api?.openVoiceRoster)?.(); }
  _previewContext() { return { ...(services.context ?? {}), characterData: this.characterData, widgetPresets: this.widgetPresets,
    onCarouselChange: () => this._syncInstanceCarouselPreview() }; }
  /** A design may expose one editable scope while retaining its complete saved document. */
  _editingOverlay() { return this._draft; }
  _editingLayers() { return this._editingOverlay()?.layers ?? []; }
  /** Canvas snapping, rulers, grid and guides are per-browser preferences. */
  _canvasSetting(key, fallback) {
    try { return game.settings.get(MODULE_ID, key) ?? fallback; }
    catch { return fallback; }
  }
  _snapping() { return this._canvasSetting("canvasSnapping", true) !== false; }
  _rulers() { return this._canvasSetting("canvasRulers", true) !== false; }
  _grid() { const step = Number(this._canvasSetting("canvasGrid", 0)); return GRID_STEPS.includes(step) ? step : 0; }
  _saveCanvasSetting(key, value) { void Promise.resolve(game.settings?.set?.(MODULE_ID, key, value)).catch(() => {}); }
  /** Guides belong to the overlay or design being edited. */
  _guides() { return this._canvasSetting("canvasGuides", {})?.[this._draft?.id] ?? { x: [], y: [] }; }
  _saveGuides(guides) {
    if (!this._draft?.id) return;
    const all = { ...(this._canvasSetting("canvasGuides", {}) ?? {}) };
    if (guides.x.length || guides.y.length) all[this._draft.id] = guides; else delete all[this._draft.id];
    this._saveCanvasSetting("canvasGuides", all);
  }
  _allLayers() { return this._draft?.layers ?? []; }
  _canvasBlocked() { return this._busy || this._uploading; }
  _animationTargets(_target, { wholeDesign = false, preset = null } = {}) {
    return wholeDesign || this.widgetMode ? this._allLayers() : [...(preset?.layers ?? []), ...(preset?.pages ?? []).flatMap(page => page.layers)];
  }
  _fieldDefinitions(target) {
    const dataSource = target?.dataSource ?? (this.widgetMode && DEMO_ACTOR_UUIDS.includes(this._previewActorUuid) ? "demo" : "actors");
    const reference = this.widgetMode ? this._previewActorUuid : target?.actorUuid ?? target?.actorUuids?.[0];
    const actorType = reference && dataSource === "actors" ? this.characterData?.listActors?.().find(actor => actor.uuid === reference)?.type : undefined;
    return sortedFields(this.characterData?.fieldDefinitions?.({ dataSource, actorType }) ?? []);
  }

  _canRender(options) {
    if (!game.user?.isGM) {
      ui.notifications.warn(t("Editor.GMOnly"));
      return false;
    }
    return super._canRender(options);
  }

  _loadDraft(overlay, revision = this.store.getState().revision) {
    this._commitHistory();
    const previousId = this._draft?.id;
    if (this._draft?.id !== overlay?.id) this._realActorAssignments.clear();
    this._carouselPanel = null;
    this._carouselLabelsGeneration = (this._carouselLabelsGeneration ?? 0) + 1;
    this._draft = overlay ? clone(overlay) : null;
    this._loadedRevision = revision;
    this._dirty = false;
    this._conflict = false;
    this._invalidInputs.clear();
    this._animationEdits.clear();
    this._pruneSelection(this._editingLayers());
    const snapshot = this._draft ? JSON.stringify(this._draft) : null;
    // Saving the edited document keeps its undo history; anything else starts a new one.
    if (this._history && previousId === this._draft?.id && snapshot === this._history.current) this._history.baseline = snapshot;
    else this._history = new DraftHistory(snapshot);
  }

  /**
   * One undo step per discrete action (add, paste, delete, reorder, …): earlier pending edits
   * become their own step first, and the action is recorded as soon as it finishes.
   */
  async _historyStep(action) {
    this._commitHistory();
    try { return await action(); }
    finally { this._commitHistory(); }
  }

  /** Record the draft once edits pause, so a drag or a typed value is one undo step. */
  _scheduleHistory() {
    clearTimeout(this._historyTimer);
    this._historyTimer = setTimeout(() => this._commitHistory(), HISTORY_DELAY);
    this._historyTimer?.unref?.();
  }

  _commitHistory() {
    clearTimeout(this._historyTimer);
    this._historyTimer = null;
    if (this._history && this._draft) this._history.record(JSON.stringify(this._draft));
  }

  async _undo() { return this._stepHistory("undo"); }
  async _redo() { return this._stepHistory("redo"); }

  async _stepHistory(direction) {
    this._commitHistory();
    const history = this._history;
    const snapshot = this._draft ? history?.step(direction) : null;
    if (!snapshot) return;
    // Keep the draft object: the canvas and open panels hold references to it.
    const restored = JSON.parse(snapshot);
    for (const key of Object.keys(this._draft)) delete this._draft[key];
    Object.assign(this._draft, restored);
    this._scopeProjection = null;
    this._invalidInputs.clear();
    this._animationEdits.clear();
    this._pruneSelection(this._allLayers());
    this._dirty = history.dirty;
    if (!this.rendered) return;
    // Refresh in place: re-rendering the window would restart the preview and move the panels.
    await this._refreshDraftViews();
    // Any normalization while refreshing must not become a phantom step for the next undo.
    if (this._draft) history.current = JSON.stringify(this._draft);
  }

  /** Show a replaced draft (undo, redo) in the open window without re-rendering it. */
  async _refreshDraftViews() {
    await this._updatePreview();
    this._selectLayers(this._selectedLayerIds, this._selectedLayerId);
    this._renderSharedWidgetAnimations();
    this._renderPagesPanel?.();
    const draft = this._draft;
    if (!draft || !this.element) return;
    for (const input of this.element.querySelectorAll("[data-draft-field]")) {
      if (input === document.activeElement) continue;
      const [group, key] = input.dataset.draftField.split(".");
      input.value = String(draft[group]?.[key] ?? "");
      this._invalidInputs.delete(input.dataset.draftField);
      setValidity(input, "");
    }
    const heading = this.element.querySelector(".mso-document-heading h2");
    if (heading) heading.textContent = draft.name;
    const output = this.element.querySelector("[data-opacity-output]");
    if (output) output.textContent = `${Math.round(draft.background.opacity * 100)}%`;
    const resolution = this.element.querySelector("[data-resolution]");
    if (resolution) resolution.textContent = `${draft.canvas.width} × ${draft.canvas.height}`;
    this._updateBackgroundThumbnail();
    const status = this.element.querySelector("[data-save-status]");
    if (status) writeText(status, L(this._dirty ? "Editor.UnsavedChanges" : "Template.AllSaved"));
    const save = this.element.querySelector('[data-action="saveOverlay"]');
    if (save) save.disabled = !this._dirty || this._uploading;
  }

  /**
   * Canvas shortcuts. Copy and cut apply to every selected layer; `payload.copied` says the
   * canvas already wrote the system clipboard, and `payload.text` is pasted clipboard text.
   */
  async _canvasCommand(command, payload = {}) {
    if (command === "undo" || command === "redo") return this[`_${command}`]();
    if (command === "copy" || command === "cut") {
      if (!this._selectedLayers().length) return;
      if (!payload.copied) this._copySelection({ system: true });
      if (command === "cut") return this._selectionCommand("delete");
      return;
    }
    if (command === "paste") return payload.files?.length ? this._historyStep(() => this._insertImages(payload.files)) : this._pasteLayer(payload.text);
    if (command === "group") return this._groupSelection();
    if (command === "ungroup") return this._ungroupSelection();
    return this._selectionCommand(command);
  }

  /** Copy the selected layers; returns the clipboard text. Without a clipboard event, `system` writes it asynchronously. */
  _copySelection({ system = false } = {}) {
    const layers = this._selectedLayers().map(layer => clone(layer));
    if (!layers.length) return null;
    rememberLayers(layers);
    const text = serializeLayers(layers);
    if (system) void Promise.resolve(globalThis.navigator?.clipboard?.writeText?.(text)).catch(() => {});
    return text;
  }

  async _pasteLayer(text) { return this._historyStep(() => this._pasteClipboard(text)); }

  /**
   * Paste copied layers, from clipboard text when the browser provides it, otherwise from this
   * browser's last copy. Other text becomes a new text layer.
   */
  async _pasteClipboard(text) {
    if (!this._draft) return;
    const content = typeof text === "string" ? text : "";
    const layers = parseLayers(content) ?? (content.trim() ? [this._textLayerFor(content)] : rememberedLayers());
    return this._insertLayersData(layers);
  }

  /** Insert copied, pasted or fragment layers on top, checked like a paste. */
  async _insertLayersData(layers) {
    if (!layers?.length || !this._draft) return;
    const designs = new Set((this.widgetPresets?.list?.() ?? []).map(preset => preset.id));
    for (const layer of layers) {
      // Widget designs cannot hold widget instances; overlays have no character components.
      if (this.widgetMode ? layer.type === "character-widget" : isCharacterComponent(layer.type)) throw editorError("Editor.PasteUnsupported");
      if (layer.type === "character-widget" && !designs.has(layer.presetId)) throw editorError("Editor.PasteMissingDesign");
    }
    if (this._allLayers().length + layers.length > 100) throw new Error(t("Editor.ComponentLimit"));
    const pasted = pasteLayers(this._editingOverlay(), layers);
    this._markDirty();
    await this._updatePreview();
    this._selectLayers(pasted.map(layer => layer.id));
  }

  /**
   * Upload pasted or dropped image files through the module's validated storage (PNG, JPEG or
   * WebP) and add each as an image layer, scaled to fit the canvas, at `point` or its center.
   */
  async _insertImages(files, point = null) {
    const images = [...files].filter(file => /^image\//.test(file?.type ?? "") || /\.(?:png|jpe?g|webp)$/i.test(file?.name ?? "")).slice(0, 10);
    if (!images.length || !this._draft) return;
    if (this._allLayers().length + images.length > 100) throw new Error(t("Editor.ComponentLimit"));
    const draft = this._draft, added = [];
    this._uploading = true;
    this._uploadKind = "image";
    this._setUploadState();
    try {
      for (const file of images) {
        const path = validateAssetPath(await (services.uploadBackground ?? uploadBackground)(file));
        if (!path) throw new Error(t("Editor.NoUploadedPath"));
        added.push(this._imageLayerFor(path, file.name, await imageSize(file), point, added.length));
      }
    }
    catch (error) { throw new Error(t("Editor.ImageUploadError", { error: errorText(error) || t("Editor.RetryImage") }), { cause: error }); }
    finally {
      this._uploading = false;
      this._uploadKind = null;
      this._setUploadState();
    }
    if (this._draft !== draft) { ui.notifications.warn(t("Editor.UploadedLayerChanged")); return; }
    const composition = this._editingOverlay();
    let top = Math.max(-1, ...[...composition.layers, ...(composition.widgets ?? [])].map(entry => entry.z));
    for (const layer of added) { layer.z = Math.min(10000, ++top); composition.layers.push(layer); }
    this._markDirty();
    await this._updatePreview();
    this._selectLayers(added.map(layer => layer.id));
    ui.notifications.info(t("Editor.ImagesAdded", { count: added.length }));
  }

  _imageLayerFor(path, filename, size, point, index) {
    const canvas = this._draft.canvas, layer = createLayer("image", canvas);
    // Large images start at most 90% of the canvas; small ones keep their pixel size.
    const scale = Math.min(1, canvas.width * 0.9 / size.width, canvas.height * 0.9 / size.height);
    const width = Math.max(1, Math.round(size.width * scale)), height = Math.max(1, Math.round(size.height * scale));
    const center = point ?? { x: canvas.width / 2, y: canvas.height / 2 };
    const name = String(filename ?? "").replace(/\.[^.]+$/, "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
    return validateLayer({ ...layer, src: path, width, height, fit: "contain", lockAspectRatio: true,
      x: Math.round(center.x - width / 2 + index * 20), y: Math.round(center.y - height / 2 + index * 20), ...(name ? { name } : {}) }, canvas);
  }

  async _dropImages(event) {
    event.preventDefault(); event.stopPropagation();
    const files = [...(event.dataTransfer?.files ?? [])];
    const point = this._preview?.nativeAt?.(event.clientX, event.clientY) ?? null;
    await this._draftOperation(() => this._historyStep(() => this._insertImages(files, point)));
  }

  _textLayerFor(text) {
    const layer = createLayer("text", this._draft.canvas);
    layer.text = text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 10000);
    const name = layer.text.split("\n").find(line => line.trim())?.trim().slice(0, 80);
    if (name) layer.name = name;
    return layer;
  }

  /** Call after persistent settings change. Never silently replace an edited draft. */
  async refresh({ external = true } = {}) {
    if (!this.rendered || this._busy || this._uploading) return;
    const state = this.store.getState();
    const selected = state.overlays.find(overlay => overlay.id === this._draft?.id);
    if (this._dirty && external && state.revision !== this._loadedRevision) this._conflict = true;
    else if (!this._dirty) this._loadDraft(selected ?? this._initialOverlay(state), state.revision);
    await this.render({ force: true });
  }

  /** Relabel controls in place, preserving native input buffers, focus, drafts and playback. */
  refreshLanguage() {
    if (!this.rendered || !this.element) return;
    const heading = this.element.querySelector(".window-title");
    if (heading && !this.widgetMode) setText(heading, "Editor.Title");
    localizeDOM(this.element);
    relabelEditorText(this.element);
    const fields = new Map(this._fieldDefinitions(this._selectedLayer()).map(field => [field.id, field]));
    for (const option of this.element.querySelectorAll("[data-editor-field-id]")) {
      const field = fields.get(option.dataset.editorFieldId);
      if (field) option.textContent = fieldLabel(field);
    }
    this._syncInstanceCarouselPreview();
    this._syncPreviewActorLabel?.();
    this._syncCarouselPreview?.();
  }

  _initialOverlay(state) {
    return state.overlays.find(overlay => overlay.id === state.activeOverlayId) ?? state.overlays[0] ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = this.store.getState();
    if (!this._draft && !this._dirty) this._loadDraft(this._initialOverlay(state), state.revision);
    const presets = this.store.listPresets();
    if (!presets.some(preset => preset.id === this._selectedPresetId)) this._selectedPresetId = presets[0]?.id;
    const selectedPreset = presets.find(preset => preset.id === this._selectedPresetId);
    const viewerId = this.api?.getViewerUserId?.() ?? "";
    return {
      ...context,
      draft: this._draft,
      overlays: state.overlays.map(overlay => ({
        id: overlay.id, name: overlay.name,
        selected: overlay.id === this._draft?.id,
        active: overlay.id === state.activeOverlayId
      })),
      presets: presets.map(preset => ({ ...preset, selected: preset.id === this._selectedPresetId })),
      customPreset: selectedPreset && !selectedPreset.builtin,
      hasPreset: !!selectedPreset,
      dirty: this._dirty,
      uploading: this._uploading,
      snapping: this._snapping(),
      rulers: this._rulers(),
      gridOptions: [0, ...GRID_STEPS].map(value => ({ value, label: value ? `${value} px` : t("Editor.GridOff"), selected: value === this._grid() })),
      canvasFullscreen: this._canvasFullscreen === true,
      zoomOptions: [
        { value: "fit", label: t("Editor.Fit") }, { value: "0.5", label: "50%" },
        { value: "1", label: "100%" }, { value: "2", label: "200%" }
      ].map(option => ({ ...option, selected: String(this._zoom) === option.value })),
      conflict: this._conflict,
      fitOptions: ["cover", "contain", "stretch"].map(value => ({
        value, label: uiText(value[0].toUpperCase() + value.slice(1)), selected: value === this._draft?.background.fit
      })),
      opacityPercent: Math.round((this._draft?.background.opacity ?? 1) * 100),
      // Any account that can log in may be the viewer; its role decides what it can read.
      viewerUsers: [...game.users].filter(user => user.role >= 1).map(user => ({
        id: user.id, name: user.name, role: t(VIEWER_ROLES[user.role] ?? "Template.RolePlayer"), selected: user.id === viewerId
      })),
      viewerConfigured: !!viewerId,
      demoInstalled: state.overlays.some(overlay => overlay.id === "demo-animated-character-showcase"),
      obsURL: this.api?.getOBSUrl?.() ?? "",
      joinURL: this.api?.getJoinUrl?.() ?? ""
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const heading = this.element.querySelector(".window-title");
    if (heading && !this.widgetMode) setText(heading, "Editor.Title");
    if (!this.widgetMode) editors.add(this);
    // A full window render keeps the live canvas: its carousels, images, animations, scroll
    // and rulers go on, and only layers that changed are rebuilt.
    const placeholder = this.element.querySelector("[data-preview]");
    const keep = !!(this._preview && !this._preview.disposed && this._previewElement && placeholder && placeholder !== this._previewElement);
    if (keep) placeholder.replaceWith(this._previewElement);
    else {
      this._preview?.destroy();
      this._preview = null;
      this._previewElement = placeholder;
    }
    // Foundry fonts load with its game canvas, which may be off; text re-renders once they arrive.
    void loadFoundryFonts().catch(() => {});
    const hasFiles = event => [...(event.dataTransfer?.types ?? [])].includes("Files");
    if (keep) {
      this._preview.setGuides(this._guides());
      await this._updatePreview();
      this._preview.setSelection(this._selectedLayerIds, this._selectedLayerId, { notify: false });
    }
    else if (this._previewElement) {
      this._preview = new LayerCanvas({
        host: this._previewElement,
        keyboardRoot: this.element,
        widgets: services.widgets ?? this.api?.widgets,
        context: this._previewContext(),
        getOverlay: () => this._editingOverlay(),
        onChange: layer => { this._markDirty(); this._syncLayerFields(layer); },
        onSelect: (id, ids) => this._selectLayers(ids ?? (id ? [id] : []), id, { canvas: false }),
        onCommand: (command, payload) => { void this._draftOperation(() => this._canvasCommand(command, payload)); },
        copyText: () => this._copySelection(),
        onGuides: guides => this._saveGuides(guides),
        isBlocked: () => this._canvasBlocked()
      });
      this._preview.setZoom(this._zoom);
      this._preview.setSnapping(this._snapping());
      this._preview.setGuides(this._guides());
      this._preview.setRulers(this._rulers());
      this._preview.setGrid(this._grid());
      await this._updatePreview();
      this._preview.setSelection(this._selectedLayerIds, this._selectedLayerId, { notify: false });
      this._listenForDrops(this._previewElement, { files: hasFiles });
    }
    this._renderLayerPanel();
    this._bindLayerSearch();
    fragmentViews.add(this);
    this._renderFragments();
    this._renderSharedWidgetAnimations();
    this._renderAnimationTestPanel();
    this._listenForDrops(this.element.querySelector("[data-layer-properties]"));
    this.element.querySelectorAll("[data-draft-field]").forEach(input => {
      if (this._invalidInputs.has(input.dataset.draftField)) {
        input.value = this._invalidInputs.get(input.dataset.draftField);
        setValidity(input, L("Editor.CanvasNumber"));
      }
      input.addEventListener("input", event => this._onDraftInput(event));
    });
    this.element.querySelector("[data-background-upload]")?.addEventListener("change", event => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = ""; // Permit choosing the same file again after cancellation or failure.
      if (file) void this._perform(() => this._uploadBackgroundFile(file));
    });
    this.element.querySelector("[data-transfer-file]")?.addEventListener("change", event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (file) void this._draftOperation(() => this._importFile(file));
    });
    this.element.querySelector("[data-image-upload]")?.addEventListener("change", event => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      const target = this._imageUploadTarget;
      this._imageUploadTarget = null;
      input.value = "";
      if (file && target) void this._draftOperation(() => this._uploadImageFile(file, target));
    });
    this._updateBackgroundThumbnail();
    this._setUploadState();
    this.element.querySelector('[name="activeOverlayId"]')?.addEventListener("change", event => {
      const selectedId = event.currentTarget.value;
      void this._perform(async () => {
        await this._sideMutation(options => this.store.setActive(selectedId || null, options));
        ui.notifications.info(selectedId ? t("Editor.NowLive") : t("Editor.NowTransparent"));
      });
    });
    this.element.querySelector('[name="presetId"]')?.addEventListener("change", event => {
      if (this._uploading) return;
      this._selectedPresetId = event.currentTarget.value;
      void this.render({ force: true });
    });
    this.element.querySelector("[data-canvas-snap]")?.addEventListener("change", event => {
      const enabled = event.currentTarget.checked;
      this._preview?.setSnapping(enabled);
      this._saveCanvasSetting("canvasSnapping", enabled);
    });
    this.element.querySelector("[data-canvas-rulers]")?.addEventListener("change", event => {
      const enabled = event.currentTarget.checked;
      this._preview?.setRulers(enabled);
      this._saveCanvasSetting("canvasRulers", enabled);
    });
    this.element.querySelector("[data-canvas-grid]")?.addEventListener("change", event => {
      const step = Number(event.currentTarget.value);
      this._preview?.setGrid(step);
      this._saveCanvasSetting("canvasGrid", step);
    });
    const voicePreview = this.element.querySelector("[data-voice-preview]");
    if (voicePreview) {
      voicePreview.value = this.voice?.mode ?? "design";
      voicePreview.disabled = !this.voice;
      voicePreview.addEventListener("change", event => {
        try { this.voice?.setMode(event.currentTarget.value); } catch (error) { ui.notifications.error(errorText(error)); }
        if (event.currentTarget.value === "live") services.requestVoice?.();
      });
    }
    this.element.querySelector("[data-canvas-zoom]")?.addEventListener("change", event => {
      const value = event.currentTarget.value;
      this._zoom = value === "fit" ? "fit" : Number(value);
      this._preview?.setZoom(this._zoom);
    });
    const fit = this.element.querySelector('[data-canvas-zoom] option[value="fit"]');
    if (fit) setText(fit, "Editor.Fit");
    const gridOff = this.element.querySelector('[data-canvas-grid] option[value="0"]');
    if (gridOff) setText(gridOff, "Editor.GridOff");
    for (const option of this.element.querySelectorAll('[data-draft-field="background.fit"] option')) {
      if (["cover", "contain", "stretch"].includes(option.value)) writeText(option, S(option.value[0].toUpperCase() + option.value.slice(1)));
    }
    localizeDOM(this.element);
  }

  /** Actors dropped on a widget assign it; image files dropped on the canvas become layers. */
  _listenForDrops(host, { files } = {}) {
    host?.addEventListener("dragover", event => {
      if (files?.(event)) { event.preventDefault(); return; }
      const id = event.target.closest?.("[data-layer-id]")?.dataset.layerId;
      if ((this._editingLayers().find(layer => layer.id === id) ?? this._selectedLayer())?.type === "character-widget") event.preventDefault();
    });
    host?.addEventListener("drop", event => {
      if (files?.(event)) { void this._dropImages(event); return; }
      void this._dropActor(event);
    });
  }

  /**
   * The primary selected layer: the last one clicked, shown in Properties. Assigning it selects
   * only that layer; `_selectedLayerIds` lists every selected layer.
   */
  get _selectedLayerId() { return this._primaryLayerId ?? null; }
  set _selectedLayerId(id) {
    this._primaryLayerId = id ?? null;
    this._selectedLayerIds = id ? [id] : [];
  }

  _selectedLayer() { return this._editingLayers().find(layer => layer.id === this._selectedLayerId) ?? null; }
  _selectedLayers() {
    const ids = new Set(this._selectedLayerIds ?? []);
    return this._editingLayers().filter(layer => ids.has(layer.id));
  }

  /** Drop selected IDs that are not among `layers`. */
  _pruneSelection(layers) {
    const present = new Set(layers.map(layer => layer.id));
    const ids = (this._selectedLayerIds ?? []).filter(id => present.has(id));
    this._primaryLayerId = ids.includes(this._primaryLayerId) ? this._primaryLayerId : ids.at(-1) ?? null;
    this._selectedLayerIds = ids;
  }

  /** Selection and property edits update their own DOM, leaving pointer capture and focus intact. */
  _selectLayer(id, { canvas = true } = {}) { this._selectLayers(id ? [id] : [], id, { canvas }); }

  _selectLayers(ids, primary = ids.at(-1), { canvas = true } = {}) {
    const present = new Set(this._editingLayers().map(layer => layer.id));
    const chosen = [...new Set(ids)].filter(id => present.has(id));
    this._selectedLayerIds = chosen;
    this._primaryLayerId = chosen.includes(primary) ? primary : chosen.at(-1) ?? null;
    if (canvas) this._preview?.setSelection(chosen, this._primaryLayerId, { notify: false });
    this._renderLayerPanel();
    if (this._selectedLayer()?.type === "character-widget") this._testLayerId = this._selectedLayerId;
    this._renderAnimationTestPanel();
  }

  /** Shift/Ctrl/Cmd+click in the layer list adds or removes one layer. */
  _toggleSelection(id) {
    const ids = this._selectedLayerIds.includes(id) ? this._selectedLayerIds.filter(entry => entry !== id) : [...this._selectedLayerIds, id];
    this._selectLayers(ids, ids.includes(id) ? id : undefined);
  }

  async _draftOperation(operation) {
    if (this._busy || this._uploading) return;
    this._busy = true;
    try { await operation(); }
    catch (error) {
      console.error(`${MODULE_ID} | Layer edit failed`, error);
      ui.notifications.error(errorText(error) || t("Editor.LayerUpdateFailed"));
    }
    finally { this._busy = false; }
  }

  _addImage() { return this._addLayer("image"); }
  _addText() { return this._addLayer("text"); }
  _selectTool() { this._previewElement?.focus?.(); }

  async _manageWidgets() { return services.openWidgetManager?.(); }
  async _openWidgetPreset(id) { return services.openWidgetPreset?.(id); }
  async _liveControls() { return (services.openLiveControls ?? this.api?.openLiveControls)?.(); }
  async _characterColors() { return (services.openCharacterColors ?? this.api?.openCharacterColors)?.(); }

  async _installDemo({ reset = false } = {}) {
    if (!await this._discardDraft()) return;
    if (reset && !await this._confirm(L("Editor.ResetDemo"), L("Editor.ResetDemoConfirm"), L("Editor.ResetDemo"))) return;
    const install = services.installDemo ?? this.api?.installDemo;
    if (!install) throw new Error(t("Editor.DemoNotReady"));
    const result = await install({ reset });
    const state = this.store.getState();
    const overlay = state.overlays.find(entry => entry.id === result.overlayId);
    if (!overlay) throw new Error(t("Editor.DemoMissing"));
    this._loadDraft(overlay, state.revision);
    this._selectedLayerId = overlay.layers.find(layer => layer.type === "character-widget")?.id ?? null;
    this._testLayerId = this._selectedLayerId;
    ui.notifications.info(t("Editor.DemoOpened"));
  }

  async _resetDemo() { return this._installDemo({ reset: true }); }

  _renderAnimationTestPanel() {
    const host = this.element?.querySelector("[data-animation-tests]");
    if (!host || this.widgetMode) return;
    this._animationTestPanel = renderAnimationTestControls(host, {
      layers: this._draft?.layers.filter(layer => layer.type === "character-widget") ?? [],
      layerId: this._testLayerId, target: this._testTarget, disabled: this._uploading,
      debug: (services.getDebug ?? this.api?.getDebug)?.() ?? false,
      onSelection: ({ layerId, target }) => { this._testLayerId = layerId; this._testTarget = target; },
      onCommand: (id, command, target) => this._runAnimationTest(id, command, target),
      onDebug: value => (services.setDebug ?? this.api?.setDebug)?.(value),
      getPlaybackState: id => this._preview?.renderer?.getAnimationTestState?.(id),
      getDiagnostics: () => this._preview?.renderer?.getDiagnostics?.() ?? []
    });
  }

  async _runAnimationTest(layerId, command, target = "preview") {
    if (!game.user?.isGM) throw new Error(t("Editor.TestGMOnly"));
    if (this._uploading || this._busy) throw new Error(t("Editor.WaitEditor"));
    const layer = this._draft?.layers.find(entry => entry.id === layerId && entry.type === "character-widget");
    if (!layer) throw new Error(t("Editor.ChooseWidget"));
    if (command.kind === "demo" && layer.dataSource !== "demo") throw new Error(t("Editor.DemoOnly"));
    if (target === "obs") {
      if (this._dirty) throw new Error(t("Editor.SaveBeforeOBS"));
      if (this.store.getState().activeOverlayId !== this._draft.id) throw new Error(t("Editor.SelectBeforeOBS"));
      const publish = services.publishTestCommand ?? this.api?.liveControls?.testCommand;
      if (!publish) throw new Error(t("Editor.LiveControlsNotReady"));
      await publish(layerId, command);
    } else {
      await this._animationPreviewUpdate;
      const accepted = await this._preview?.renderer?.handleAnimationCommand?.({ ...command, overlayId: this._draft.id, layerId });
      if (!accepted) throw new Error(t("Editor.PreviewActionFailed"));
    }
    this._syncInstanceCarouselPreview();
  }

  async _addWidget() {
    if (!this._draft) return;
    const presets = this.widgetPresets?.list() ?? [];
    if (!presets.length) { await this._manageWidgets(); return; }
    const content = document.createElement("div");
    const label = document.createElement("label");
    setText(label, "Editor.WidgetDesign");
    const select = document.createElement("select");
    select.name = "presetId";
    for (const preset of presets) {
      const option = document.createElement("option");
      option.value = preset.id; option.textContent = preset.name; select.append(option);
    }
    label.append(select); content.append(label);
    const result = await DialogV2.input({ window: { title: t("Editor.ChoosePreset") }, content, modal: true, rejectClose: false,
      render: (_event, dialog) => markDialog(dialog, L("Editor.ChoosePreset")) });
    if (!result?.presetId) return;
    const preset = presets.find(entry => entry.id === result.presetId);
    if (!preset) throw new Error(t("Editor.WidgetPresetMissing"));
    const actor = await this._chooseActor();
    if (actor === undefined) return;
    await this._insertWidget(preset, actor?.uuid ?? "");
  }

  async _insertWidget(preset, actorUuid = "") {
    if (!this._draft || this._allLayers().length >= 100) throw new Error(t("Editor.ComponentLimit"));
    const composition = this._editingOverlay();
    const layer = createWidgetInstance(preset);
    layer.actorUuid = actorUuid;
    layer.actorUuids = actorUuid ? [actorUuid] : [];
    const ordered = [...composition.layers, ...(composition.widgets ?? [])].sort((a, b) => a.z - b.z);
    layer.z = Math.max(-1, ...ordered.map(entry => entry.z)) + 1;
    if (layer.z > 10000) { ordered.forEach((entry, index) => { entry.z = index; }); layer.z = ordered.length; }
    composition.layers.push(layer);
    this._markDirty();
    await this._updatePreview();
    this._selectLayer(layer.id);
    return layer;
  }

  async _addLayer(type) { return this._historyStep(() => this._insertLayer(type)); }

  async _insertLayer(type) {
    if (!this._draft) return;
    if (this._allLayers().length >= 100) throw new Error(t("Editor.ComponentLimit"));
    const composition = this._editingOverlay();
    const layer = createLayer(type, this._draft.canvas);
    const ordered = [...composition.layers, ...(composition.widgets ?? [])].sort((a, b) => a.z - b.z);
    layer.z = Math.max(-1, ...ordered.map(entry => entry.z)) + 1;
    // Normalize orders before appending when an imported composition uses the maximum order.
    if (layer.z > 10000) {
      ordered.forEach((entry, index) => { entry.z = index; });
      layer.z = ordered.length;
    }
    composition.layers.push(layer);
    this._markDirty();
    await this._updatePreview();
    this._selectLayer(layer.id);
  }

  async _layerCommand(command, id = this._selectedLayerId) { return this._historyStep(() => this._applyLayerCommand(command, id)); }

  async _applyLayerCommand(command, id) {
    const composition = this._editingOverlay();
    const layer = composition?.layers?.find(entry => entry.id === id);
    if (!layer) return;
    if (command === "select") {
      // Clicking the only selected layer again changes nothing, so a double-click can rename it.
      if (!(this._selectedLayerIds.length === 1 && this._selectedLayerId === id)) this._selectLayer(id);
      return;
    }
    if (command === "duplicate") {
      if (this._allLayers().length >= 100) throw new Error(t("Editor.ComponentLimit"));
      const copy = duplicateLayer(composition, id);
      // A grouped layer's copy stays in its group, just above the original.
      if (layer.groupId) moveLayers(composition, [copy.id], layerOrder(composition).filter(entry => entry !== copy).indexOf(layer), layer.groupId);
      this._selectedLayerId = copy.id;
    }
    else if (command === "delete") {
      if (layer.locked) { ui.notifications.info(t("Editor.UnlockBeforeDelete")); return; }
      this._removeLayer(composition, id);
    }
    else if (command === "visible") layer.visible = !layer.visible;
    else if (command === "locked") layer.locked = !layer.locked;
    else if (["up", "down", "front", "back"].includes(command)) {
      // Grouped layers restack inside their group; other layers step over whole groups.
      if (layer.groupId) reorderInGroup(composition, id, command);
      else if (["up", "down"].includes(command) && composition.layers.some(entry => entry.groupId)) stepLayer(composition, id, command);
      else reorderLayer(composition, id, command);
    }
    else return;
    this._markDirty();
    await this._updatePreview();
    this._selectLayers(this._selectedLayerIds, this._selectedLayerId);
  }

  _removeLayer(composition, id) {
    deleteLayer(composition, id);
    dissolveSmallGroups(composition);
    for (const key of this._invalidInputs.keys()) if (key.startsWith(`layer.${id}.`) || key.startsWith(`carousel.${id}.`)) this._invalidInputs.delete(key);
    this._invalidInputs.delete(`animation.${id}`); this._animationEdits.delete(`animation.${id}`);
    this._pruneSelection(composition.layers);
  }

  /** Delete, duplicate and stacking commands apply to every selected layer. */
  async _selectionCommand(command) {
    const layers = this._selectedLayers();
    if (layers.length <= 1) return this._layerCommand(command);
    return this._historyStep(() => this._applySelectionCommand(command, layers));
  }

  async _applySelectionCommand(command, layers) {
    const composition = this._editingOverlay();
    // Visiting layers in the right order keeps the selected layers' own stacking when they move.
    const ordered = [...layers].sort((a, b) => a.z - b.z);
    let selection = layers.map(layer => layer.id);
    if (command === "duplicate") {
      if (this._allLayers().length + layers.length > 100) throw new Error(t("Editor.ComponentLimit"));
      const copies = ordered.map(layer => duplicateLayer(composition, layer.id));
      // Copies of grouped layers form new groups instead of joining the originals.
      for (const groupId of new Set(copies.map(copy => copy.groupId).filter(Boolean))) {
        const members = copies.filter(copy => copy.groupId === groupId);
        if (members.length > 1) groupLayers(composition, members.map(copy => copy.id), members[0].groupName);
        else { delete members[0].groupId; delete members[0].groupName; }
      }
      selection = copies.map(copy => copy.id);
    }
    else if (command === "delete") {
      const locked = layers.filter(layer => layer.locked);
      if (locked.length) ui.notifications.info(t("Editor.LockedLayersKept"));
      for (const layer of layers) if (!layer.locked) this._removeLayer(composition, layer.id);
      selection = locked.map(layer => layer.id);
    }
    else if (["front", "down"].includes(command)) for (const layer of ordered) reorderLayer(composition, layer.id, command);
    else if (["back", "up"].includes(command)) for (const layer of [...ordered].reverse()) reorderLayer(composition, layer.id, command);
    else return;
    this._markDirty();
    await this._updatePreview();
    this._selectLayers(selection, selection.includes(this._selectedLayerId) ? this._selectedLayerId : undefined);
  }

  /**
   * Align (left, center, right, top, middle, bottom) or distribute ("distribute-x"/"-y") the
   * selected layers. Several layers align to their combined bounds, one layer to the canvas.
   * Locked layers count for the bounds but stay where they are.
   */
  async _arrange(action) { return this._historyStep(() => this._applyArrangement(action)); }

  async _applyArrangement(action) {
    const layers = this._selectedLayers(), movable = layers.filter(layer => !layer.locked);
    if (!movable.length || !this._draft) return;
    let positions;
    if (action === "distribute-x" || action === "distribute-y") {
      if (movable.length < 3) return;
      positions = distributePositions(movable, action.at(-1));
    }
    else positions = alignPositions(movable, action, layers.length > 1 ? boundsOf(layers) : { x: 0, y: 0, width: this._draft.canvas.width, height: this._draft.canvas.height });
    for (const layer of movable) {
      const { x, y } = positions.get(layer.id);
      Object.assign(layer, moveGeometry(layer, { x: x - layer.x, y: y - layer.y }));
    }
    this._markDirty();
    await this._updatePreview();
    this._selectLayers(this._selectedLayerIds, this._selectedLayerId);
  }

  _onDraftInput(event) {
    if (!this._draft || this._uploading) return;
    const input = event.currentTarget;
    const field = input.dataset.draftField;
    let value = input.value;
    if (field === "canvas.width" || field === "canvas.height") {
      value = Number(value);
      // Keep the last valid dimensions while a number is being entered.
      if (!Number.isInteger(value) || value < 64 || value > 7680) {
        this._invalidInputs.set(field, input.value);
        setValidity(input, L("Editor.CanvasNumber"));
        this._markDirty();
        return;
      }
      this._invalidInputs.delete(field);
      setValidity(input, "");
    }
    else if (field === "background.opacity") value = Number(value);
    const [group, key] = field.split(".");
    this._draft[group][key] = value;
    if (field === "background.src") this._updateBackgroundThumbnail();
    this._markDirty();
    const output = this.element.querySelector("[data-opacity-output]");
    if (output) output.textContent = `${Math.round(this._draft.background.opacity * 100)}%`;
    const resolution = this.element.querySelector("[data-resolution]");
    if (resolution) resolution.textContent = `${this._draft.canvas.width} × ${this._draft.canvas.height}`;
    void this._updatePreview();
  }

  _markDirty() {
    this._dirty = true;
    this._scheduleHistory();
    const status = this.element.querySelector("[data-save-status]");
    if (status) writeText(status, L("Editor.UnsavedChanges"));
    if (!this._uploading) this.element.querySelector('[data-action="saveOverlay"]')?.removeAttribute("disabled");
  }

  async _updatePreview() {
    const preview = this._preview;
    if (!preview) return;
    try {
      await preview.render(this._draft);
      this._syncInstanceCarouselPreview();
      if (preview === this._preview) this.element.querySelector("[data-preview-error]")?.setAttribute("hidden", "");
    }
    catch (error) {
      if (preview !== this._preview) return;
      const message = this.element.querySelector("[data-preview-error]");
      if (message) {
        writeError(message, error, "Editor.PreviewError");
        message.removeAttribute("hidden");
      }
    }
  }

  static onAction(event, target) {
    event.preventDefault();
    // Browser full screen needs the click's own synchronous stack; it never waits for other work.
    if (target.dataset.action === "toggleCanvasFullscreen") {
      this._toggleCanvasFullscreen();
      return;
    }
    // Keep the local file chooser inside the trusted click's synchronous stack.
    // The file chooser also needs the trusted click's own stack.
    if (target.dataset.action === "importFile") {
      this._chooseImportFile();
      return;
    }
    if (target.dataset.action === "uploadBackground") {
      this._uploadBackground();
      return;
    }
    if (["addImage", "addText", "selectTool", "addWidget", "manageWidgets", "liveControls", "addComponent", "choosePreviewActor", "chooseDemoPreviewActor", "showVersions", "rescaleCanvas", "exportFile"].includes(target.dataset.action)) {
      void this._draftOperation(() => this[`_${target.dataset.action}`](target));
      return;
    }
    void this._perform(() => this[`_${target.dataset.action}`](target));
  }

  async _perform(operation) {
    if (this._uploading) {
      ui.notifications.info(t("Editor.WaitUpload"));
      return;
    }
    if (this._busy) return;
    this._busy = true;
    this.element?.setAttribute("aria-busy", "true");
    let failure;
    try { await operation(); }
    catch (error) { failure = error; }
    finally {
      this._busy = false;
      this.element?.removeAttribute("aria-busy");
      // Corrupt saved settings or a failed re-render must not discard the draft or
      // reject a click handler's unobserved promise during error recovery.
      try {
        const state = this.store.getState();
        if (this._dirty && state.revision !== this._loadedRevision) this._conflict = true;
        if (!this._dirty) {
          this._loadDraft(state.overlays.find(overlay => overlay.id === this._draft?.id) ?? this._initialOverlay(state), state.revision);
        }
        if (this.rendered) await this.render({ force: true });
      }
      catch (error) {
        if (this._dirty) this._conflict = true;
        if (failure && failure !== error) console.error(`${MODULE_ID} | Editor refresh failed`, error);
        failure ??= error;
      }
    }
    if (failure) {
      console.error(`${MODULE_ID} | Editor operation failed`, failure);
      ui.notifications.error(errorText(failure) || t("Editor.OverlayUpdateFailed"));
    }
  }

  async _sideMutation(operation) {
    const before = this.store.getState().revision;
    const currentDraft = before === this._loadedRevision && !this._conflict;
    const result = await operation({ expectedRevision: before });
    const after = this.store.getState().revision;
    if (currentDraft && after === before + 1) this._loadedRevision = after;
    else if (this._dirty) this._conflict = true;
    return result;
  }

  async _name(title, initial = "") {
    const content = document.createElement("div");
    const label = document.createElement("label");
    setText(label, "Editor.Name");
    const input = document.createElement("input");
    input.type = "text";
    input.name = "name";
    input.required = true;
    input.maxLength = 80;
    input.setAttribute("value", initial);
    input.autofocus = true;
    label.append(input);
    content.append(label);
    const result = await DialogV2.input({ window: { title: labelText(title) }, content, modal: true, rejectClose: false,
      render: (_event, dialog) => markDialog(dialog, title) });
    if (!result) return null;
    const name = result.name?.trim();
    if (!name) throw new Error(t("Editor.EnterName"));
    return name;
  }

  async _confirm(title, text, label = L("Editor.Continue")) {
    const content = document.createElement("div");
    const paragraph = document.createElement("p");
    writeText(paragraph, text);
    content.append(paragraph);
    return DialogV2.confirm({ window: { title: labelText(title) }, content, yes: { label: labelText(label) }, modal: true, rejectClose: false,
      render: (_event, dialog) => markDialog(dialog, title, label) });
  }

  async _discardDraft() {
    if (this._uploading) {
      ui.notifications.info(t("Editor.WaitUpload"));
      return false;
    }
    return !this._dirty || await this._confirm(L("Editor.UnsavedTitle"), L("Editor.DiscardPrompt"), L("Editor.Discard"));
  }

  async _editOverlay(target) {
    if (target.dataset.overlayId === this._draft?.id || !await this._discardDraft()) return;
    const state = this.store.getState();
    this._loadDraft(state.overlays.find(overlay => overlay.id === target.dataset.overlayId), state.revision);
  }

  async _createOverlay() {
    if (!await this._discardDraft()) return;
    const name = await this._name(L("Editor.CreateOverlay"), "New overlay");
    if (!name) return;
    this._loadDraft(await this.store.createOverlay(name));
  }

  async _renameOverlay() {
    if (!this._draft) return;
    const name = await this._name(L("Editor.RenameOverlay"), this._draft.name);
    if (!name) return;
    // Renaming is part of the draft; Save publishes all changes together.
    this._draft.name = name;
    this._markDirty();
  }

  async _deleteOverlay() {
    if (!this._draft) return;
    if (!await this._confirm(L("Editor.DeleteOverlay"), L("Editor.ConfirmDeleteOverlay", { name: this._draft.name }), L("Editor.DeleteOverlay"))) return;
    await this.store.deleteOverlay(this._draft.id);
    const state = this.store.getState();
    this._loadDraft(this._initialOverlay(state), state.revision);
  }

  _validateInputs() {
    const invalid = [...this.element.querySelectorAll("[data-draft-field], [data-layer-field], [data-instance-carousel-field]")].find(input => input.checkValidity?.() === false);
    if (invalid) {
      invalid.reportValidity();
      throw new Error(t("Editor.CorrectHighlighted"));
    }
    if (this._invalidInputs.size) throw new Error(t("Editor.CorrectInvalid"));
  }

  async _saveOverlay() {
    if (!this._draft) return;
    this._validateInputs();
    const before = this._savedDocument();
    const saved = await this.store.saveOverlay(clone(this._draft), { expectedRevision: this._loadedRevision });
    this._loadDraft(saved);
    await this._recordVersions(before, saved);
    ui.notifications.info(t("Editor.Saved"));
  }

  _versions() { return services.versions ?? (defaultVersions ??= new VersionStore()); }
  _versionKey(id = this._draft?.id) { return `${game.world?.id ?? "world"}/${this.widgetMode ? "design" : "overlay"}/${id}`; }
  /** The saved form of the document being edited, as the editor loads it. */
  _savedDocument() { return this.store.getState().overlays.find(overlay => overlay.id === this._draft?.id) ?? null; }

  /**
   * Keep a version of each save in this browser. The first time, the version saved before is
   * kept too, so there is always something to go back to. Saving never fails because of this.
   */
  async _recordVersions(before, saved) {
    try {
      const store = this._versions(), key = this._versionKey(saved.id);
      if (before && !(await store.list(key)).length) await store.add(key, before);
      await store.add(key, saved);
    } catch (error) { console.warn(`${MODULE_ID} | Could not keep a saved version`, error); }
  }

  /** Choose a saved version; restoring it makes it the draft, as one undoable unsaved change. */
  async _showVersions() {
    if (!this._draft) return;
    const versions = await this._versions().list(this._versionKey());
    const saved = JSON.stringify(this._savedDocument());
    const content = document.createElement("div");
    const root = document.createElement("div"); root.className = "mso-version-list";
    const help = document.createElement("p"); help.className = "mso-help"; setText(help, versions.length ? "Editor.VersionsHelp" : "Editor.NoVersions"); root.append(help);
    versions.forEach((version, index) => {
      const label = document.createElement("label"); label.className = "mso-version";
      const input = document.createElement("input"); input.type = "radio"; input.name = "version"; input.value = String(version.id);
      if (index === Math.min(1, versions.length - 1)) input.setAttribute("checked", "");
      const caption = document.createElement("span");
      setText(caption, "Editor.VersionEntry", { date: new Date(version.savedAt).toLocaleString(game.i18n?.lang), count: version.document.layers?.length ?? 0 });
      label.append(input, caption);
      if (JSON.stringify(version.document) === saved) { const current = document.createElement("em"); setText(current, "Editor.VersionCurrent"); label.append(current); }
      root.append(label);
    });
    content.append(root);
    if (!versions.length) {
      await DialogV2.prompt({ window: { title: t("Editor.VersionsTitle") }, content, modal: true, rejectClose: false,
        render: (_event, dialog) => markDialog(dialog, L("Editor.VersionsTitle")) });
      return;
    }
    const result = await DialogV2.input({ window: { title: t("Editor.VersionsTitle") }, content, modal: true, rejectClose: false,
      ok: { label: t("Editor.RestoreVersion") }, render: (_event, dialog) => markDialog(dialog, L("Editor.VersionsTitle")) });
    const version = versions.find(entry => String(entry.id) === String(result?.version));
    if (version) await this._restoreVersion(version);
  }

  async _restoreVersion(version) {
    const restored = validateOverlay({ ...version.document, id: this._draft.id });
    await this._historyStep(async () => {
      // Keep the draft object: the canvas and open panels hold references to it.
      for (const key of Object.keys(this._draft)) delete this._draft[key];
      Object.assign(this._draft, clone(restored));
      this._scopeProjection = null;
      this._invalidInputs.clear();
      this._animationEdits.clear();
      this._pruneSelection(this._allLayers());
      this._markDirty();
      await this._refreshDraftViews();
    });
    ui.notifications.info(t("Editor.VersionRestored", { date: new Date(version.savedAt).toLocaleString(game.i18n?.lang) }));
  }

  async _reloadOverlay() {
    if (!await this._discardDraft()) return;
    const state = this.store.getState();
    this._loadDraft(state.overlays.find(overlay => overlay.id === this._draft?.id) ?? this._initialOverlay(state), state.revision);
  }

  async _browseBackground() {
    if (!this._draft) return;
    const overlayId = this._draft.id;
    const picker = new foundry.applications.apps.FilePicker.implementation({
      type: "image", current: this._draft.background.src, allowUpload: false,
      callback: path => {
        if (this._draft?.id !== overlayId || !this.rendered || this._uploading) return;
        void this._perform(async () => this._applyBackground(validateAssetPath(path)));
      }
    });
    await picker.render({ force: true });
  }

  async _removeBackground() {
    if (!this._draft) return;
    await this._applyBackground("");
  }

  _uploadBackground() {
    if (this._uploading || this._busy) {
      ui.notifications.info(t("Editor.WaitOperation"));
      return;
    }
    if (!this._draft) return;
    const input = this.element.querySelector("[data-background-upload]");
    if (!input) return;
    input.value = "";
    input.click();
  }

  async _uploadBackgroundFile(file) {
    if (!file || !this._draft || !this.rendered || this._uploading) return;
    const draft = this._draft;
    const overlayId = draft.id;
    this._uploading = true;
    this._setUploadState();
    try {
      const path = validateAssetPath(await (services.uploadBackground ?? uploadBackground)(file));
      if (!path) throw new Error(t("Editor.NoUploadedPath"));
      if (!this.rendered || this._draft !== draft || this._draft.id !== overlayId) {
        ui.notifications.warn(t("Editor.UploadedOverlayChanged"));
        return;
      }
      await this._applyBackground(path);
      ui.notifications.info(t("Editor.BackgroundUploaded"));
    }
    catch (error) {
      throw new Error(t("Editor.BackgroundUploadError", { error: errorText(error) || t("Editor.RetryImage") }), { cause: error });
    }
    finally {
      this._uploading = false;
      this._setUploadState();
    }
  }

  async _applyBackground(path) {
    this._draft.background.src = path;
    this._markDirty();
    const input = this.element.querySelector('[data-draft-field="background.src"]');
    if (input) input.value = path;
    this._updateBackgroundThumbnail();
    await this._updatePreview();
  }

  _uploadImage() {
    if (this._uploading || this._busy) {
      ui.notifications.info(t("Editor.WaitOperation"));
      return;
    }
    const layer = this._selectedLayer();
    if (!layer || layer.type !== "image") return;
    const input = this.element.querySelector("[data-image-upload]");
    if (!input) return;
    this._imageUploadTarget = { draft: this._draft, overlayId: this._draft.id, layerId: layer.id };
    input.value = "";
    input.click();
  }

  async _uploadImageFile(file, target) {
    if (!file || !target || !this.rendered || this._uploading || this._draft !== target.draft) return;
    this._uploading = true;
    this._uploadKind = "image";
    this._setUploadState();
    try {
      // The Phase 1 uploader owns validation, permissions, storage, and managed paths.
      const path = validateAssetPath(await (services.uploadBackground ?? uploadBackground)(file));
      if (!path) throw new Error(t("Editor.NoUploadedPath"));
      const layer = this._allLayers().find(entry => entry.id === target.layerId && entry.type === "image");
      if (!this.rendered || this._draft !== target.draft || this._draft.id !== target.overlayId || !layer) {
        ui.notifications.warn(t("Editor.UploadedLayerChanged"));
        return;
      }
      await this._applyImage(layer, path);
      ui.notifications.info(t("Editor.ImageUploaded"));
    }
    catch (error) { throw new Error(t("Editor.ImageUploadError", { error: errorText(error) || t("Editor.RetryImage") }), { cause: error }); }
    finally {
      this._uploading = false;
      this._uploadKind = null;
      this._setUploadState();
    }
  }

  async _browseImage() {
    const layer = this._selectedLayer();
    if (!layer || layer.type !== "image") return;
    const draft = this._draft;
    const layerId = layer.id;
    const picker = new foundry.applications.apps.FilePicker.implementation({
      type: "image", current: layer.src, allowUpload: false,
      callback: path => {
        if (this._draft !== draft || !this.rendered || this._uploading) return;
        const target = this._allLayers().find(entry => entry.id === layerId && entry.type === "image");
        if (!target) return;
        void this._draftOperation(async () => {
          await this._applyImage(target, validateAssetPath(path));
        });
      }
    });
    await picker.render({ force: true });
  }

  async _applyImage(layer, path) {
    layer.src = validateAssetPath(path);
    this._invalidInputs.delete(`layer.${layer.id}.src`);
    this._markDirty();
    this._syncLayerFields(layer);
    await this._updatePreview();
  }

  _setUploadState() {
    const status = this.element?.querySelector("[data-upload-status]");
    if (status) {
      status.hidden = !this._uploading;
      writeText(status, this._uploading ? L(this._uploadKind === "image" ? "Editor.UploadingImage" : "Editor.UploadingBackground") : "");
    }
    if (this._uploading) {
      this.element?.querySelectorAll("button, select, [data-draft-field], [data-layer-field], [data-instance-carousel-field], [data-animation-control], [data-background-upload], [data-image-upload]").forEach(control => {
        if (!this._uploadControls.has(control)) this._uploadControls.set(control, control.disabled);
        control.disabled = true;
      });
    }
    else {
      for (const [control, disabled] of this._uploadControls) control.disabled = disabled;
      this._uploadControls.clear();
      const save = this.element?.querySelector('[data-action="saveOverlay"]');
      if (save) save.disabled = !this._dirty;
    }
  }

  _updateBackgroundThumbnail() {
    const image = this.element?.querySelector("[data-background-thumbnail]");
    const message = this.element?.querySelector("[data-background-thumbnail-status]");
    const path = this._draft?.background.src ?? "";
    const pathLabel = this.element?.querySelector("[data-background-path]");
    if (pathLabel) writeText(pathLabel, path || L("Editor.NoImage"));
    if (!image || !message) return;
    const generation = ++this._thumbnailGeneration;
    image.hidden = true;
    image.removeAttribute("src");
    message.hidden = false;
    writeText(message, path ? L("Editor.LoadingImage") : L("Editor.NoBackground"));
    if (!path) return;
    try {
      const src = validateAssetPath(path);
      image.onload = () => {
        if (generation !== this._thumbnailGeneration) return;
        image.hidden = false;
        message.hidden = true;
      };
      image.onerror = () => {
        if (generation !== this._thumbnailGeneration) return;
        image.hidden = true;
        setText(message, "Editor.ImageUnavailable");
        message.hidden = false;
      };
      image.src = foundry.utils.getRoute(src);
    }
    catch {
      setText(message, "Editor.ImageUnavailable");
    }
  }

  async _savePreset() {
    if (!this._draft) return;
    this._validateInputs();
    const name = await this._name(L("Editor.SavePreset"), this._draft.name);
    if (!name) return;
    const preset = await this._sideMutation(options => this.store.savePreset(clone(this._draft), name, options));
    this._selectedPresetId = preset.id;
    // The preset save does not modify the persisted overlay; preserve its private draft.
    ui.notifications.info(t("Editor.PresetSaved"));
  }

  async _loadPreset() {
    if (!this._selectedPresetId || !await this._discardDraft()) return;
    const saved = await this.store.loadPreset(this._selectedPresetId, this._draft?.id ?? null);
    this._loadDraft(saved);
    ui.notifications.info(t("Editor.PresetLoaded"));
  }

  _selectedPreset() { return this.store.listPresets().find(preset => preset.id === this._selectedPresetId); }

  async _renamePreset() {
    const preset = this._selectedPreset();
    if (!preset || preset.builtin) return;
    const name = await this._name(L("Editor.RenamePreset"), preset.name);
    if (name) await this._sideMutation(options => this.store.renamePreset(preset.id, name, options));
  }

  async _duplicatePreset() {
    const preset = this._selectedPreset();
    if (!preset) return;
    const name = await this._name(L("Editor.DuplicatePreset"), `${preset.name.slice(0, 75)} copy`);
    if (!name) return;
    const copy = await this._sideMutation(options => this.store.duplicatePreset(preset.id, name, options));
    this._selectedPresetId = copy.id;
  }

  async _deletePreset() {
    const preset = this._selectedPreset();
    if (!preset || preset.builtin) return;
    if (!await this._confirm(L("Editor.DeletePreset"), L("Editor.ConfirmDeletePreset", { name: preset.name }), L("Editor.DeletePreset"))) return;
    await this._sideMutation(options => this.store.deletePreset(preset.id, options));
    this._selectedPresetId = "builtin-transparent";
  }

  async _saveViewer() {
    const value = this.element.querySelector('[name="viewerUserId"]')?.value ?? "";
    await this.api.setViewerUserId(value);
    ui.notifications.info(t("Editor.ViewerSaved"));
  }

  async _copyURL() {
    const input = this.element.querySelector('[name="obsURL"]');
    if (!input?.value) return;
    try {
      await navigator.clipboard.writeText(input.value);
      ui.notifications.info(t("Editor.URLCopied"));
    }
    catch {
      input.focus();
      input.select();
      ui.notifications.info(t("Editor.URLSelected"));
    }
  }

  /**
   * Full-screen canvas: the window fills the screen and the canvas takes the space of the
   * sidebar and settings panels, keeping tools, Layers/Properties and Save beside it.
   * Foundry dialogs stay usable because the window, not the canvas element, is enlarged.
   */
  _toggleCanvasFullscreen(enabled = !this._canvasFullscreen) {
    if (!this.element || enabled === (this._canvasFullscreen === true)) return;
    this._canvasFullscreen = enabled;
    this.element.classList.toggle("mso-canvas-fullscreen", enabled);
    if (enabled) {
      const { left, top, width, height } = this.position;
      this._restorePosition = { left, top, width, height };
      this._fitToScreen = () => this.setPosition({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
      window.addEventListener("resize", this._fitToScreen);
      this._fitToScreen();
      // Leaving browser full screen (Esc, F11) also leaves this mode.
      this._onFullscreenChange = () => { if (this._documentFullscreen && !document.fullscreenElement) { this._documentFullscreen = false; this._toggleCanvasFullscreen(false); } };
      document.addEventListener("fullscreenchange", this._onFullscreenChange);
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().then(() => { this._documentFullscreen = true; }, () => {});
      }
    } else {
      window.removeEventListener("resize", this._fitToScreen);
      document.removeEventListener("fullscreenchange", this._onFullscreenChange);
      if (this._documentFullscreen && document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
      this._documentFullscreen = false;
      if (this._restorePosition) this.setPosition(this._restorePosition);
    }
    const button = this.element.querySelector('[data-action="toggleCanvasFullscreen"]');
    if (button) {
      button.querySelector("i")?.classList.replace(enabled ? "fa-expand" : "fa-compress", enabled ? "fa-compress" : "fa-expand");
      setAttr(button, "title", enabled ? "Template.ExitFullscreen" : "Template.CanvasFullscreen");
      setAttr(button, "aria-label", enabled ? "Template.ExitFullscreen" : "Template.CanvasFullscreen");
    }
  }

  /** The tools panel's fragment list: insert with a click, save the selection, delete. */
  _renderFragments() {
    const host = this.element?.querySelector("[data-fragments]");
    if (!host) return;
    for (const preview of this._fragmentPreviews ?? []) preview.destroy();
    this._fragmentPreviews = [];
    host.replaceChildren();
    const heading = document.createElement("h4"); setText(heading, "Editor.Fragments"); host.append(heading);
    const store = document.createElement("button");
    store.type = "button"; store.className = "mso-fragment-save"; store.disabled = this._uploading;
    setText(store, "Editor.SaveFragment"); setAttr(store, "title", "Editor.SaveFragmentHelp");
    store.addEventListener("click", () => { void this._draftOperation(() => this._saveFragment()); });
    host.append(store);
    const fragments = listFragments();
    if (!fragments.length) { const help = document.createElement("p"); help.className = "mso-help"; setText(help, "Editor.NoFragments"); host.append(help); }
    for (const fragment of fragments) {
      const row = document.createElement("div"); row.className = "mso-fragment-row";
      const insert = document.createElement("button"); insert.type = "button"; insert.className = "mso-fragment-insert"; insert.disabled = this._uploading;
      const thumb = document.createElement("span"); thumb.className = "mso-fragment-thumb"; thumb.setAttribute("aria-hidden", "true");
      const caption = document.createElement("span"); caption.textContent = fragment.name;
      insert.append(thumb, caption);
      this._fragmentThumb(thumb, fragment);
      setAttr(insert, "title", "Editor.InsertFragment", { name: fragment.name, count: fragment.layers.length });
      insert.addEventListener("click", () => { void this._draftOperation(() => this._insertFragment(fragment.id)); });
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "mso-icon-button"; remove.disabled = this._uploading;
      remove.textContent = "✕"; setAttr(remove, "title", "Editor.DeleteFragment"); setAttr(remove, "aria-label", "Editor.DeleteFragment");
      remove.addEventListener("click", () => { void this._draftOperation(() => this._deleteFragment(fragment.id)); });
      const save = document.createElement("button"); save.type = "button"; save.className = "mso-icon-button"; save.disabled = this._uploading;
      save.innerHTML = '<i class="fa-solid fa-file-export" aria-hidden="true"></i>'; setAttr(save, "title", "Editor.ExportFragment"); setAttr(save, "aria-label", "Editor.ExportFragment");
      save.addEventListener("click", () => { void this._draftOperation(async () => this._exportFragment(fragment.id)); });
      row.append(insert, save, remove); host.append(row);
    }
  }

  /** A small static drawing of the fragment's layers. */
  _fragmentThumb(host, fragment) {
    try {
      const preview = new OverlayRenderer(host, { widgets: services.widgets ?? this.api?.widgets, preview: true,
        context: { ...this._previewContext(), animationsEnabled: () => false, deferEntrances: true } });
      this._fragmentPreviews.push(preview);
      void preview.render(fragmentOverlay(fragment)).catch(() => {});
    } catch { /* A thumbnail is decoration; the fragment still inserts. */ }
  }

  _exportFragment(id) {
    const fragment = listFragments().find(entry => entry.id === id);
    if (!fragment) return;
    downloadJson(exportFragment(fragment, this.widgetPresets?.list?.() ?? [], worldActors()), exportFilename(fragment.name, "fragment"));
  }

  async _saveFragment() {
    const layers = this._selectedLayers();
    if (!layers.length) { ui.notifications.info(t("Editor.SelectForFragment")); return; }
    const groups = new Set(layers.map(layer => layer.groupId));
    const suggested = groups.size === 1 && layers[0].groupName ? layers[0].groupName : t("Editor.FragmentName", { index: listFragments().length + 1 });
    const name = await this._name(L("Editor.SaveFragment"), suggested);
    if (!name) return;
    await saveFragment(name, layers);
    ui.notifications.info(t("Editor.FragmentSaved", { name }));
  }

  async _insertFragment(id) {
    const fragment = listFragments().find(entry => entry.id === id);
    if (!fragment) return;
    await this._historyStep(() => this._insertLayersData(clone(fragment.layers)));
  }

  async _deleteFragment(id) {
    const fragment = listFragments().find(entry => entry.id === id);
    if (!fragment || !await this._confirm(L("Editor.DeleteFragment"), L("Editor.DeleteFragmentPrompt", { name: fragment.name }), L("Editor.DeleteFragment"))) return;
    await deleteFragment(id);
  }

  /**
   * Rescale everything to a new canvas size: "fit" keeps proportions and centers, "stretch"
   * fills both axes. Guides move with the layout. One undoable change.
   */
  async _rescaleCanvas() {
    if (!this._draft) return;
    const content = document.createElement("div");
    const root = document.createElement("div"); root.className = "mso-rescale";
    const help = document.createElement("p"); help.className = "mso-help"; setText(help, "Editor.RescaleHelp"); root.append(help);
    const sizes = document.createElement("div"); sizes.className = "mso-dimensions";
    for (const [name, key] of [["width", "Template.Width"], ["height", "Template.Height"]]) {
      const label = document.createElement("label"); const caption = document.createElement("span"); setText(caption, key);
      const input = document.createElement("input"); input.type = "number"; input.name = name; input.min = "64"; input.max = "7680"; input.step = "1"; input.required = true;
      input.setAttribute("value", String(this._draft.canvas[name]));
      label.append(caption, input); sizes.append(label);
    }
    root.append(sizes);
    for (const [mode, key] of [["fit", "Editor.RescaleFit"], ["stretch", "Editor.RescaleStretch"]]) {
      const label = document.createElement("label"); label.className = "mso-version";
      const input = document.createElement("input"); input.type = "radio"; input.name = "mode"; input.value = mode; if (mode === "fit") input.setAttribute("checked", "");
      const caption = document.createElement("span"); setText(caption, key);
      label.append(input, caption); root.append(label);
    }
    content.append(root);
    const result = await DialogV2.input({ window: { title: t("Editor.RescaleTitle") }, content, modal: true, rejectClose: false,
      ok: { label: t("Editor.RescaleApply") }, render: (_event, dialog) => markDialog(dialog, L("Editor.RescaleTitle")) });
    if (!result) return;
    const width = Number(result.width), height = Number(result.height);
    if (![width, height].every(value => Number.isInteger(value) && value >= 64 && value <= 7680)) throw editorError("Editor.CanvasNumber");
    await this._applyRescale(width, height, result.mode === "stretch" ? "stretch" : "fit");
  }

  async _applyRescale(width, height, mode = "fit") {
    if (!this._draft) return;
    const before = { ...this._draft.canvas };
    const scaled = rescaleOverlay(this._draft, width, height, { mode });
    await this._historyStep(async () => {
      this._replaceDraft(scaled);
      const guides = this._guides();
      if (guides.x.length || guides.y.length) {
        const transform = rescaleTransform(before, { width, height }, mode);
        const moved = { x: guides.x.map(value => Math.round(value * transform.sx + transform.ox)), y: guides.y.map(value => Math.round(value * transform.sy + transform.oy)) };
        this._saveGuides(moved);
        this._preview?.setGuides(moved);
      }
      this._markDirty();
      await this._refreshDraftViews();
    });
  }

  /** Replace the draft's contents, keeping the object the canvas and panels refer to. */
  _replaceDraft(next) {
    for (const key of Object.keys(this._draft)) delete this._draft[key];
    Object.assign(this._draft, clone(next));
    this._scopeProjection = null;
    this._invalidInputs.clear();
    this._animationEdits.clear();
    this._pruneSelection(this._allLayers());
  }

  /** Save this overlay (with the widget designs it uses) or this widget design as a file. */
  _exportFile() {
    if (!this._draft) return;
    const library = this.widgetPresets?.list?.() ?? [];
    const bundle = this.widgetMode
      ? exportBundle({ widgetPresets: [overlayToWidgetPreset(this._draft, { id: this._draft.id, name: this._draft.name })] })
      : exportBundle({ overlays: [this._draft], library, actors: worldActors() });
    downloadJson(bundle, exportFilename(this._draft.name, this.widgetMode ? "widget" : "overlay"));
    ui.notifications.info(t("Editor.Exported", { name: this._draft.name }));
  }

  _chooseImportFile() {
    if (this._uploading || this._busy) { ui.notifications.info(t("Editor.WaitOperation")); return; }
    const input = this.element?.querySelector("[data-transfer-file]");
    if (!input) return;
    input.value = "";
    input.click();
  }

  /**
   * Import an exported overlay, widget design or fragment. Nothing is overwritten: taken IDs get
   * new ones, identical designs are reused, and Actors this world lacks are left unassigned.
   */
  async _importFile(file) {
    const data = readTransferFile(await file.text());
    const library = this.widgetPresets?.list?.() ?? [];
    const overlayStore = services.store ?? this.api?.store;
    if (data.kind === "bundle" && needsActorChoices(data.bundle)) { await importOverlayBundle({ bundle: data.bundle }); return; }
    // Characters are matched against this world's Actors, whoever the overlay viewer is.
    const actors = worldActors(), present = new Set(actors.map(actor => actor.uuid));
    const source = data.kind === "bundle" ? data.bundle : { widgetPresets: data.widgetPresets, layers: data.layers, actorNames: data.actorNames };
    const missing = missingActors(source, { exists: uuid => present.has(uuid), actors });
    let actorMap = {};
    if (missing.length && actors.length) {
      actorMap = await this._chooseImportActors(missing, actors);
      if (!actorMap) return;
    }
    const plan = await planImport(source, { overlayIds: overlayStore?.getState?.().overlays.map(overlay => overlay.id) ?? [], presets: library,
      actorExists: async uuid => present.has(uuid), actorMap });
    // Widget designs come first, so imported widgets find them.
    for (const preset of plan.widgetPresets) {
      const write = options => this.widgetPresets.save(preset, options);
      if (this.widgetMode) await this._sideMutation(write);
      else await write({ expectedRevision: this.widgetPresets.getState().revision });
    }
    const saved = [];
    for (const overlay of plan.overlays) {
      const write = options => overlayStore.saveOverlay(overlay, { ...options, activateIfEmpty: false });
      saved.push(this.widgetMode ? await write({ expectedRevision: overlayStore.getState().revision }) : await this._sideMutation(write));
    }
    if (data.kind === "fragment") {
      await saveFragment(data.name, plan.layers);
      ui.notifications.info(t("Editor.FragmentImported", { name: data.name }));
    } else ui.notifications.info(t("Editor.Imported", { overlays: plan.overlays.length, designs: plan.widgetPresets.length }));
    // A fresh world shows nothing on stream until it has a viewer account and an active overlay.
    if (!this.api?.getViewerUserId?.()) ui.notifications.warn(t("Editor.ImportNoViewer"), { permanent: true });
    else if (saved.length && !overlayStore.getState().activeOverlayId) ui.notifications.info(t("Editor.ImportNotActive", { name: saved[0].name }));
    if (plan.droppedActorUuids.length) {
      const names = plan.droppedActorUuids.map(uuid => source.actorNames?.[uuid] || uuid).join(", ");
      ui.notifications.warn(t("Editor.ImportDroppedActors", { names }), { permanent: true });
    }
    // Open what was imported when nothing unsaved would be lost.
    const opened = this.widgetMode ? plan.widgetPresets[0] : saved[0];
    if (opened && !this._dirty) {
      const state = this.store.getState();
      this._loadDraft(state.overlays.find(overlay => overlay.id === opened.id) ?? this._draft, state.revision);
    }
    if (this.rendered) await this.render({ force: true });
  }

  /**
   * Which of this world's Actors stands in for each character of the file; a character with
   * the same name is preselected. Returns a UUID map, or null when cancelled.
   */
  async _chooseImportActors(missing, actors) {
    const content = document.createElement("div");
    const help = document.createElement("p"); help.className = "mso-help"; setText(help, "Editor.ImportActorsHelp"); content.append(help);
    for (const [index, entry] of missing.entries()) {
      const label = document.createElement("label"); label.className = "mso-layer-field";
      const caption = document.createElement("span"); setText(caption, "Editor.ImportActorFrom", { name: entry.name || entry.uuid });
      const select = document.createElement("select"); select.name = `actor${index}`;
      setAttr(select, "aria-label", "Editor.ImportActorFrom", { name: entry.name || entry.uuid });
      const skip = document.createElement("option"); skip.value = ""; setText(skip, "Editor.ImportActorSkip"); select.append(skip);
      for (const actor of actors) {
        const option = document.createElement("option"); option.value = actor.uuid; option.textContent = actor.name;
        option.selected = actor.uuid === entry.suggestion; select.append(option);
      }
      label.append(caption, select); content.append(label);
    }
    const result = await DialogV2.input({ window: { title: t("Editor.ImportActorsTitle") }, content, modal: true, rejectClose: false,
      render: (_event, dialog) => markDialog(dialog, L("Editor.ImportActorsTitle")) });
    if (!result) return null;
    return Object.fromEntries(missing.map((entry, index) => [entry.uuid, String(result[`actor${index}`] ?? "")]));
  }

  async close(options = {}) {
    if (!await this._discardDraft()) return this;
    fragmentViews.delete(this);
    for (const preview of this._fragmentPreviews ?? []) preview.destroy();
    this._fragmentPreviews = [];
    this._toggleCanvasFullscreen(false);
    this._actorStatusUnsubscribe?.();
    this._actorStatusUnsubscribe = null;
    this._preview?.destroy();
    this._preview = null;
    this._loadDraft(null, null);
    editors.delete(this);
    return super.close(options);
  }
}
