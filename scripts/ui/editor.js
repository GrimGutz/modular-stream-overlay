import { LayerCanvas } from "../editor/layer-canvas.js";
import { uploadBackground } from "../core/background-upload.js";
import { validateAssetPath, validateLayer, FONT_FAMILIES, FONT_WEIGHTS } from "../core/schema.js";
import { createLayer, createWidgetInstance, duplicateLayer, deleteLayer, reorderLayer } from "../core/layers.js";
import { safePortraitURL } from "../render/character-components.js";
import { renderAnimationControls, renderAnimationTestControls } from "./animation-controls.js";
import { DEMO_ACTOR_UUIDS } from "../demo/data.js";
import { validateAnimationSettings, validateTriggerRules } from "../animation/schema.js";
import { PAGE_TRANSITIONS, resolveCarouselSettings } from "../carousel/schema.js";
import { fieldLabel, sortedFields } from "./field-settings.js";
import { t, uiText, errorText, localizeDOM, setText, setAttr, onLanguageChange } from "./i18n.js";

const MODULE_ID = "modular-stream-overlay";
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
let services = {};
const editors = new Set();
const L = (key, params = {}) => ({ key, params });
const S = literal => ({ literal });
const labelText = label => label?.key ? t(label.key, label.params) : label?.literal !== undefined ? uiText(label.literal) : String(label ?? "");
const errorNodes = new WeakMap();
const validityMessages = new WeakMap();
const editorErrors = new WeakMap();
function editorError(key) {
  const error = new Error(t(key));
  editorErrors.set(error, L(key));
  return error;
}
function writeText(element, label) {
  if (label?.key) {
    element.textContent = "";
    setText(element, label.key, label.params);
  }
  else {
    element.removeAttribute?.("data-i18n");
    element.textContent = labelText(label);
  }
  if (element.dataset) {
    if (label?.literal !== undefined) element.dataset.editorUiText = label.literal;
    else delete element.dataset.editorUiText;
  }
}
function writeAttr(element, attribute, label) {
  if (label?.key) setAttr(element, attribute, label.key, label.params);
  else element.setAttribute(attribute, labelText(label));
}
function writeError(element, error, prefixKey) {
  errorNodes.set(element, { error, prefixKey });
  if (element.dataset) element.dataset.editorError = "";
  const message = editorErrors.has(error) ? labelText(editorErrors.get(error)) : errorText(error);
  writeText(element, prefixKey ? L(prefixKey, { error: message }) : message);
}
function setValidity(input, message) {
  validityMessages.set(input, message);
  if (input.dataset) input.dataset.editorValidity = "";
  input.setCustomValidity(message?.key ? labelText(message) : editorErrors.has(message) ? labelText(editorErrors.get(message)) : errorText(message));
}
function markDialog(dialog, title, affirmative) {
  const heading = dialog.element?.querySelector(".window-title");
  if (heading) writeText(heading, title);
  const button = affirmative && dialog.element?.querySelector('[data-action="yes"]');
  if (button) writeText(button, affirmative);
  const ok = dialog.element?.querySelector('[data-action="ok"]');
  if (ok) setText(ok, "Buttons.Confirm");
  const no = dialog.element?.querySelector('[data-action="no"]');
  if (no) setText(no, "Buttons.Cancel");
  localizeDOM(dialog.element);
}
onLanguageChange(() => { for (const editor of editors) editor.refreshLanguage(); });

/** Supply dependencies without coupling the editor to storage or renderer internals. */
export function configureEditor(configuration) {
  services = { ...services, ...configuration };
}

/** Refresh API-opened and Foundry Settings menu instances alike. */
export async function refreshEditors(options = {}) {
  await Promise.all([...editors].map(editor => editor.refresh(options)));
}

const clone = value => foundry.utils.deepClone(value);

/** The GM-only visual editor. Unsaved drafts are private to this application. */
export class OverlayEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "modular-stream-overlay-editor",
    classes: ["mso-editor"],
    window: { title: "modular-stream-overlay.Editor.Title", icon: "fa-solid fa-tv", resizable: true },
    position: { width: 1380, height: 900 },
    actions: Object.fromEntries([
      "editOverlay", "createOverlay", "renameOverlay", "deleteOverlay", "saveOverlay", "reloadOverlay",
      "uploadBackground", "browseBackground", "removeBackground", "savePreset", "loadPreset", "renamePreset", "duplicatePreset",
      "deletePreset", "saveViewer", "copyURL", "addImage", "addText", "selectTool", "addWidget", "manageWidgets", "liveControls", "installDemo", "resetDemo"
    ].map(action => [action, OverlayEditor.onAction]))
  };

  static PARTS = { editor: { template: `modules/${MODULE_ID}/templates/editor.hbs` } };

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
  _previewContext() { return { ...(services.context ?? {}), characterData: this.characterData, widgetPresets: this.widgetPresets,
    onCarouselChange: () => this._syncInstanceCarouselPreview() }; }
  /** A design may expose one editable scope while retaining its complete saved document. */
  _editingOverlay() { return this._draft; }
  _editingLayers() { return this._editingOverlay()?.layers ?? []; }
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
    if (this._draft?.id !== overlay?.id) this._realActorAssignments.clear();
    this._carouselPanel = null;
    this._carouselLabelsGeneration = (this._carouselLabelsGeneration ?? 0) + 1;
    this._draft = overlay ? clone(overlay) : null;
    this._loadedRevision = revision;
    this._dirty = false;
    this._conflict = false;
    this._invalidInputs.clear();
    this._animationEdits.clear();
    if (!this._editingLayers().some(layer => layer.id === this._selectedLayerId)) this._selectedLayerId = null;
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
    for (const node of this.element.querySelectorAll("[data-editor-ui-text]")) node.textContent = uiText(node.dataset.editorUiText);
    const fields = new Map(this._fieldDefinitions(this._selectedLayer()).map(field => [field.id, field]));
    for (const option of this.element.querySelectorAll("[data-editor-field-id]")) {
      const field = fields.get(option.dataset.editorFieldId);
      if (field) option.textContent = fieldLabel(field);
    }
    for (const node of this.element.querySelectorAll("[data-editor-error]")) {
      const source = errorNodes.get(node);
      if (source) writeError(node, source.error, source.prefixKey);
    }
    for (const input of this.element.querySelectorAll("[data-editor-validity]")) {
      if (validityMessages.has(input)) setValidity(input, validityMessages.get(input));
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
      zoomOptions: [
        { value: "fit", label: t("Editor.Fit") }, { value: "0.5", label: "50%" },
        { value: "1", label: "100%" }, { value: "2", label: "200%" }
      ].map(option => ({ ...option, selected: String(this._zoom) === option.value })),
      conflict: this._conflict,
      fitOptions: ["cover", "contain", "stretch"].map(value => ({
        value, label: uiText(value[0].toUpperCase() + value.slice(1)), selected: value === this._draft?.background.fit
      })),
      opacityPercent: Math.round((this._draft?.background.opacity ?? 1) * 100),
      viewerUsers: [...game.users].filter(user => !user.isGM && user.role === 1).map(user => ({
        id: user.id, name: user.name, selected: user.id === viewerId
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
    this._preview?.destroy();
    this._previewElement = this.element.querySelector("[data-preview]");
    if (this._previewElement) {
      this._preview = new LayerCanvas({
        host: this._previewElement,
        keyboardRoot: this.element,
        widgets: services.widgets ?? this.api?.widgets,
        context: this._previewContext(),
        getOverlay: () => this._editingOverlay(),
        onChange: layer => { this._markDirty(); this._syncLayerFields(layer); },
        onSelect: id => this._selectLayer(id, { canvas: false }),
        onCommand: command => { void this._draftOperation(() => this._layerCommand(command)); },
        isBlocked: () => this._canvasBlocked()
      });
      this._preview.setZoom(this._zoom);
      await this._updatePreview();
      this._preview.select(this._selectedLayerId, { notify: false });
    }
    this._renderLayerPanel();
    this._renderSharedWidgetAnimations();
    this._renderAnimationTestPanel();
    for (const host of [this._previewElement, this.element.querySelector("[data-layer-properties]")]) {
      host?.addEventListener("dragover", event => {
        const id = event.target.closest?.("[data-layer-id]")?.dataset.layerId;
        if ((this._editingLayers().find(layer => layer.id === id) ?? this._selectedLayer())?.type === "character-widget") event.preventDefault();
      });
      host?.addEventListener("drop", event => { void this._dropActor(event); });
    }
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
    this.element.querySelector("[data-canvas-zoom]")?.addEventListener("change", event => {
      const value = event.currentTarget.value;
      this._zoom = value === "fit" ? "fit" : Number(value);
      this._preview?.setZoom(this._zoom);
    });
    const fit = this.element.querySelector('[data-canvas-zoom] option[value="fit"]');
    if (fit) setText(fit, "Editor.Fit");
    for (const option of this.element.querySelectorAll('[data-draft-field="background.fit"] option')) {
      if (["cover", "contain", "stretch"].includes(option.value)) writeText(option, S(option.value[0].toUpperCase() + option.value.slice(1)));
    }
    localizeDOM(this.element);
  }

  _selectedLayer() { return this._editingLayers().find(layer => layer.id === this._selectedLayerId) ?? null; }

  /** Selection and property edits update their own DOM, leaving pointer capture and focus intact. */
  _selectLayer(id, { canvas = true } = {}) {
    this._selectedLayerId = this._editingLayers().some(layer => layer.id === id) ? id : null;
    if (canvas) this._preview?.select(this._selectedLayerId, { notify: false });
    this._renderLayerPanel();
    if (this._selectedLayer()?.type === "character-widget") this._testLayerId = this._selectedLayerId;
    this._renderAnimationTestPanel();
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
  async _liveControls() { return (services.openLiveControls ?? this.api?.openLiveControls)?.(); }

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

  async _chooseActor() {
    if (!this.characterData) throw new Error(t("Editor.CharacterDataNotReady"));
    // DialogV2 accepts an attribute-free DIV, serializes its children, then rebuilds the form.
    const content = document.createElement("div");
    const picker = document.createElement("div"); picker.className = "mso-actor-picker";
    const search = document.createElement("input"); search.type = "search"; setAttr(search, "placeholder", "Editor.SearchCharacters"); setAttr(search, "aria-label", "Editor.SearchCharacters");
    const list = document.createElement("div"); list.className = "mso-actor-list"; list.setAttribute("role", "list");
    const label = document.createElement("label"); setText(label, "Editor.ActorUUIDFoundryLink");
    const reference = document.createElement("input"); reference.type = "text"; reference.name = "actorReference"; setAttr(reference, "placeholder", "Editor.ActorReferenceExample");
    label.append(reference);
    const help = document.createElement("p"); setText(help, "Editor.ChooseActorHelp");
    picker.append(search, list, label, help); content.append(picker);
    const entries = this.characterData.listActors?.() ?? this.characterData.accessibleActors?.() ?? [];
    const actors = await Promise.resolve(entries);
    const result = await DialogV2.input({ window: { title: t("Editor.AssignCharacter") }, content, modal: true, rejectClose: false,
      render: (_event, dialog) => {
        markDialog(dialog, L("Editor.AssignCharacter"));
        const root = dialog.element.querySelector(".mso-actor-picker");
        const search = root.querySelector('input[type="search"]');
        const list = root.querySelector(".mso-actor-list");
        const reference = root.querySelector('[name="actorReference"]');
        const draw = () => {
          list.replaceChildren();
          for (const actor of actors.filter(entry => String(entry.name).toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))) {
            const button = document.createElement("button"); button.type = "button"; button.className = "mso-actor-choice"; button.setAttribute("role", "listitem");
            const image = document.createElement("img"); image.alt = ""; image.src = safePortraitURL(actor.img ?? actor.portrait ?? "", path => foundry.utils.getRoute(path));
            const name = document.createElement("span"); name.textContent = actor.name;
            button.append(image, name);
            button.addEventListener("click", () => { reference.value = actor.uuid; reference.focus(); });
            list.append(button);
          }
          if (!list.children.length) { const empty = document.createElement("p"); setText(empty, "Editor.NoMatchingActors"); list.append(empty); }
        };
        search.addEventListener("input", draw); draw();
      }
    });
    if (!result) return undefined;
    if (!result.actorReference?.trim()) return null;
    return this.characterData.resolveActor(result.actorReference.trim());
  }

  async _assignActor(reference) {
    const layer = this._selectedLayer();
    if (!layer || layer.type !== "character-widget") return;
    const draft = this._draft;
    const actor = reference === undefined ? await this._chooseActor() : reference ? await this.characterData.resolveActor(reference) : null;
    if (actor === undefined) return;
    if (this._draft !== draft || !this._allLayers().includes(layer)) return;
    if (actor && layer.dataSource === "demo") this._changeCharacterDataSource(layer, "actors");
    const remaining = this._assignedCharacters(layer).slice(1);
    this._setCarouselCharacters(layer, actor ? [actor.uuid, ...remaining.filter(uuid => uuid !== actor.uuid)] : []);
    await this._updatePreview(); this._renderLayerProperties();
  }

  async _dropActor(event) {
    const id = event.target.closest?.("[data-layer-id]")?.dataset.layerId;
    if (this._editingLayers().some(layer => layer.id === id && layer.type === "character-widget")) this._selectLayer(id);
    const layer = this._selectedLayer();
    if (!layer || layer.type !== "character-widget" || this._busy || this._uploading) return;
    event.preventDefault(); event.stopPropagation();
    await this._draftOperation(async () => {
      const implementation = foundry.applications.ux?.TextEditor?.implementation;
      const data = implementation?.getDragEventData(event) ?? {};
      if (data.type !== "Actor" || !data.uuid) throw new Error(t("Editor.DragActor"));
      if (event.target.closest?.("[data-assigned-characters]")?.dataset.assignedCharacters !== undefined) await this._addCarouselActor(data.uuid);
      else await this._assignActor(data.uuid);
    });
  }

  async _addLayer(type) {
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

  async _layerCommand(command, id = this._selectedLayerId) {
    const composition = this._editingOverlay();
    const layer = composition?.layers?.find(entry => entry.id === id);
    if (!layer) return;
    if (command === "select") { this._selectLayer(id); return; }
    if (command === "duplicate") {
      if (this._allLayers().length >= 100) throw new Error(t("Editor.ComponentLimit"));
      const copy = duplicateLayer(composition, id);
      this._selectedLayerId = copy.id;
    }
    else if (command === "delete") {
      if (layer.locked) { ui.notifications.info(t("Editor.UnlockBeforeDelete")); return; }
      deleteLayer(composition, id);
      for (const key of this._invalidInputs.keys()) if (key.startsWith(`layer.${id}.`) || key.startsWith(`carousel.${id}.`)) this._invalidInputs.delete(key);
      this._invalidInputs.delete(`animation.${id}`); this._animationEdits.delete(`animation.${id}`);
      if (this._selectedLayerId === id) this._selectedLayerId = null;
    }
    else if (command === "visible") layer.visible = !layer.visible;
    else if (command === "locked") layer.locked = !layer.locked;
    else if (["up", "down", "front", "back"].includes(command)) reorderLayer(composition, id, command);
    else return;
    this._markDirty();
    await this._updatePreview();
    this._selectLayer(this._selectedLayerId);
  }

  _layerButton(label, command, id, { disabled = false, pressed } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    writeText(button, label);
    writeAttr(button, "title", label);
    writeAttr(button, "aria-label", label);
    button.dataset.layerCommand = command;
    button.disabled = disabled || this._uploading;
    if (pressed !== undefined) button.setAttribute("aria-pressed", String(pressed));
    button.addEventListener("click", event => {
      event.preventDefault();
      void this._draftOperation(() => this._layerCommand(command, id));
    });
    return button;
  }

  _renderLayerPanel() {
    const list = this.element?.querySelector("[data-layer-list]");
    if (!list) return;
    list.replaceChildren();
    const sorted = [...this._editingLayers()].sort((a, b) => b.z - a.z);
    if (!sorted.length) {
      const message = document.createElement("p");
      message.className = "mso-help";
      setText(message, "Editor.EmptyLayers");
      list.append(message);
    }
    for (const layer of sorted) {
      const row = document.createElement("div");
      row.className = `mso-layer-row${layer.id === this._selectedLayerId ? " selected" : ""}`;
      row.dataset.layerId = layer.id;
      const select = this._layerButton(layer.name, "select", layer.id, { pressed: layer.id === this._selectedLayerId });
      select.className = "mso-layer-select";
      select.textContent = "";
      const icon = document.createElement("span");
      icon.className = "mso-layer-type";
      icon.textContent = layer.type === "text" ? "T" : layer.type === "image" ? "▧" : "■";
      icon.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.dataset.layerName = "";
      name.textContent = layer.name;
      select.append(icon, name);
      const visible = this._layerButton(layer.visible ? L("Editor.Visible") : L("Editor.Hidden"), "visible", layer.id, { pressed: layer.visible });
      visible.className = "mso-layer-toggle";
      const locked = this._layerButton(layer.locked ? L("Editor.Locked") : L("Editor.Unlocked"), "locked", layer.id, { pressed: !!layer.locked });
      locked.className = "mso-layer-toggle";
      row.append(select, visible, locked);
      list.append(row);
    }
    const count = this.element.querySelector("[data-layer-count]");
    if (count) count.textContent = String(sorted.length);
    this._renderLayerProperties();
  }

  _layerField(host, layer, field, label, { type = "text", min, max, step, options, maxLength } = {}) {
    const wrapper = document.createElement("label");
    wrapper.className = `mso-layer-field${type === "checkbox" ? " mso-checkbox-field" : ""}`;
    const title = document.createElement("span");
    writeText(title, label);
    const input = document.createElement(options ? "select" : type === "textarea" ? "textarea" : "input");
    if (!options && type !== "textarea") input.type = type;
    input.dataset.layerField = field;
    writeAttr(input, "aria-label", label);
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    if (step !== undefined) input.step = String(step);
    if (maxLength !== undefined) input.maxLength = maxLength;
    if (options) {
      for (const option of options) {
        const entry = document.createElement("option");
        entry.value = String(option.value ?? option);
        writeText(entry, option.label ?? option);
        if (option.fieldId) entry.dataset.editorFieldId = option.fieldId;
        input.append(entry);
      }
    }
    if (type === "checkbox") input.checked = !!layer[field];
    else input.value = String(layer[field] ?? "");
    const invalidKey = `layer.${layer.id}.${field}`;
    if (this._invalidInputs.has(invalidKey)) {
      if (type === "checkbox") input.checked = this._invalidInputs.get(invalidKey);
      else input.value = this._invalidInputs.get(invalidKey);
      setValidity(input, L("Editor.CorrectLayer"));
    }
    input.disabled = this._uploading;
    input.addEventListener("input", event => this._onLayerInput(event));
    if (type === "checkbox") wrapper.append(input, title);
    else wrapper.append(title, input);
    host.append(wrapper);
    return input;
  }

  _renderLayerProperties() {
    this._actorStatusUnsubscribe?.();
    this._actorStatusUnsubscribe = null;
    this._carouselPanel = null;
    this._carouselLabelsGeneration = (this._carouselLabelsGeneration ?? 0) + 1;
    const host = this.element?.querySelector("[data-layer-properties]");
    if (!host) return;
    host.replaceChildren();
    const layer = this._selectedLayer();
    const note = document.createElement("p");
    note.className = "mso-help";
    if (!layer) {
      setText(note, "Editor.SelectLayerHelp");
      host.append(note);
      return;
    }
    this._layerField(host, layer, "name", L("Editor.LayerName"), { maxLength: 80 });
    const geometry = document.createElement("div");
    geometry.className = "mso-property-grid";
    for (const [field, label, min, max] of [
      ["x", "X", -32768, 32768], ["y", "Y", -32768, 32768],
      ["width", L("Editor.Width"), 1, 7680], ["height", L("Editor.Height"), 1, 7680],
      ["rotation", L("Editor.Rotation"), -360, 360], ["opacity", L("Editor.Opacity"), 0, 1]
    ]) this._layerField(geometry, layer, field, label, { type: "number", min, max, step: field === "opacity" ? .01 : "any" });
    host.append(geometry);
    const toggles = document.createElement("div");
    toggles.className = "mso-property-grid";
    this._layerField(toggles, layer, "visible", L("Editor.Visible"), { type: "checkbox" });
    this._layerField(toggles, layer, "locked", L("Editor.Locked"), { type: "checkbox" });
    host.append(toggles);
    if (layer.type === "image") {
      this._layerField(host, layer, "src", L("Editor.ImageSource"), { maxLength: 4096 });
      const images = document.createElement("div");
      images.className = "mso-image-actions";
      for (const [label, callback] of [[L("Editor.UploadImage"), () => this._uploadImage()], [L("Editor.BrowseExisting"), () => { void this._draftOperation(() => this._browseImage()); }]]) {
        const button = document.createElement("button");
        button.type = "button";
        writeText(button, label);
        button.disabled = this._uploading;
        button.addEventListener("click", callback);
        images.append(button);
      }
      host.append(images);
      this._layerField(host, layer, "fit", L("Editor.ImageScaling"), { options: ["contain", "cover", "stretch"].map(value => ({ value, label: S(value) })) });
      this._layerField(host, layer, "lockAspectRatio", L("Editor.LockAspect"), { type: "checkbox" });
      if (!layer.src) {
        const hint = document.createElement("p");
        hint.className = "mso-help";
        setText(hint, "Editor.EmptyImageHelp");
        host.append(hint);
      }
    }
    else if (layer.type === "text") {
      this._layerField(host, layer, "text", L("Editor.TextContent"), { type: "textarea", maxLength: 10000 });
      this._layerField(host, layer, "fontFamily", L("Editor.Font"), { options: FONT_FAMILIES });
      const typography = document.createElement("div");
      typography.className = "mso-property-grid";
      this._layerField(typography, layer, "fontSize", L("Editor.FontSize"), { type: "number", min: 1, max: 512, step: "any" });
      this._layerField(typography, layer, "fontWeight", L("Editor.FontWeight"), { options: FONT_WEIGHTS });
      this._layerField(typography, layer, "color", L("Editor.TextColor"), { maxLength: 9 });
      this._layerField(typography, layer, "align", L("Editor.Alignment"), { options: ["left", "center", "right"].map(value => ({ value, label: S(value) })) });
      host.append(typography);
      this._layerField(host, layer, "shadow", L("Editor.TextShadow"), { type: "checkbox" });
    }
    else if (layer.type === "color") this._layerField(host, layer, "color", L("Editor.Color"));
    this._renderComponentProperties(host, layer);
    this._renderAnimationControls(host, layer);
    const commands = document.createElement("div");
    commands.className = "mso-layer-commands";
    for (const [label, command] of [[L("Editor.MoveUp"), "up"], [L("Editor.MoveDown"), "down"], [L("Editor.BringFront"), "front"], [L("Editor.SendBack"), "back"], [L("Editor.Duplicate"), "duplicate"], [L("Editor.Delete"), "delete"]]) {
      commands.append(this._layerButton(label, command, layer.id, { disabled: command === "delete" && layer.locked }));
    }
    host.append(commands);
    setText(note, "Editor.KeyboardHelp");
    host.append(note);
  }

  _renderAnimationControls(host, target, { wholeDesign = false } = {}) {
    const preset = target.type === "character-widget" ? this.widgetPresets?.list().find(entry => entry.id === target.presetId) : null;
    const targets = this._animationTargets(target, { wholeDesign, preset });
    const controls = document.createElement("div");
    controls.className = "mso-animation-controls";
    const key = `animation.${wholeDesign ? "self" : target.id}`;
    if (preset) {
      const inheritLabel = document.createElement("label"); inheritLabel.className = "mso-layer-field mso-checkbox-field";
      const inherit = document.createElement("input"); inherit.type = "checkbox"; inherit.dataset.animationControl = ""; inherit.checked = !target.animationOverrides; inherit.disabled = this._uploading;
      const caption = document.createElement("span"); setText(caption, "Editor.InheritMotion");
      inherit.addEventListener("change", () => {
        if (this._uploading || this._busy) return;
        target.animationOverrides = !inherit.checked;
        if (target.animationOverrides) { target.animations = clone(preset.animations); target.triggers = clone(preset.triggers); }
        this._invalidInputs.delete(key); this._animationEdits.delete(key); this._markDirty(); this._animationPreviewUpdate = this._updatePreview(); this._renderLayerProperties();
      });
      inheritLabel.append(inherit, caption); host.append(inheritLabel);
      if (!target.animationOverrides) {
        const note = document.createElement("p"); note.className = "mso-help"; setText(note, "Editor.InheritedMotionHelp"); host.append(note);
      }
    }
    const inherited = !!preset && !target.animationOverrides;
    const effective = inherited ? preset : target;
    renderAnimationControls(controls, {
      value: { animations: effective.animations, triggers: effective.triggers },
      draftValue: this._animationEdits.get(key),
      fields: this._fieldDefinitions(target), targets,
      disabled: this._uploading, readOnly: inherited,
      onChange: value => {
        if (this._busy || this._uploading || inherited) return;
        target.animations = validateAnimationSettings(value.animations);
        target.triggers = validateTriggerRules(value.triggers);
        this._invalidInputs.delete(key); this._animationEdits.delete(key); this._markDirty();
        this._animationPreviewUpdate = this._updatePreview();
      },
      onDraftChange: value => { this._animationEdits.set(key, value); this._markDirty(); },
      onInvalid: message => { if (message) this._invalidInputs.set(key, message); else this._invalidInputs.delete(key); },
      onPreview: config => this._previewAnimation(wholeDesign ? "self" : target.id, config),
      onReset: () => this._preview?.renderer?.resetAnimations(wholeDesign ? "self" : target.id),
      onTriggerPreview: ruleId => this._previewTrigger(wholeDesign ? "self" : target.id, ruleId)
    });
    host.append(controls);
  }

  _renderSharedWidgetAnimations() {
    const host = this.element?.querySelector("[data-widget-animations]");
    if (!host || !this.widgetMode || !this._draft) return;
    host.replaceChildren();
    this._renderAnimationControls(host, this._draft, { wholeDesign: true });
  }

  async _previewAnimation(id, configuration) {
    await this._animationPreviewUpdate;
    return this._preview?.renderer?.previewAnimation(id, configuration);
  }

  async _previewTrigger(id, ruleId) {
    await this._animationPreviewUpdate;
    return this._preview?.renderer?.previewTrigger(id, ruleId);
  }

  _renderComponentProperties(host, layer) {
    if (layer.type === "character-widget") { this._renderWidgetProperties(host, layer); return; }
    if (!this.widgetMode) return;
    if (["image", "text", "character-portrait", "character-name", "dynamic-text", "dynamic-number"].includes(layer.type)) {
      const label = document.createElement("label"); label.className = "mso-layer-field"; setText(label, "Editor.ContentSource");
      const source = document.createElement("select"); setAttr(source, "aria-label", "Editor.ContentSource");
      for (const [value, text] of [["static", L("Editor.StaticContent")], ["dynamic", L("Editor.DynamicContent")]]) { const option = document.createElement("option"); option.value = value; writeText(option, text); source.append(option); }
      source.value = ["image", "text"].includes(layer.type) ? "static" : "dynamic";
      source.addEventListener("change", () => { void this._draftOperation(() => this._setContentSource(source.value)); });
      label.append(source); host.append(label);
    }
    const dynamic = ["character-name", "dynamic-text", "dynamic-number", "resource-bar"].includes(layer.type);
    if (layer.type === "character-portrait") {
      this._layerField(host, layer, "portraitSource", L("Editor.PortraitArtwork"), { options: [{ value: "profile", label: L("Editor.ProfileImage") }, { value: "token", label: L("Editor.TokenArtwork") }] });
      this._layerField(host, layer, "fit", L("Editor.ImageScaling"), { options: ["contain", "cover"].map(value => ({ value, label: S(value) })) });
      this._layerField(host, layer, "circular", L("Editor.CircularPortrait"), { type: "checkbox" });
      this._layerField(host, layer, "borderRadius", L("Editor.CornerRadius"), { type: "number", min: 0, max: 3840 });
      this._layerField(host, layer, "lockAspectRatio", L("Editor.LockAspect"), { type: "checkbox" });
      this._layerField(host, layer, "src", L("Editor.FallbackImage"), { maxLength: 4096 });
    }
    if (dynamic) {
      const fields = this._fieldDefinitions(layer);
      const choices = fields.filter(field => !["dynamic-number", "resource-bar"].includes(layer.type) || field.type === "number").map(field => ({ value: field.id, label: fieldLabel(field), fieldId: field.id }));
      const optionsFor = value => choices.some(option => option.value === value) ? choices : [{ value: value ?? "", label: value ? L("Editor.FieldUnavailable", { field: value }) : L("Editor.NoNumericFields") }, ...choices];
      this._layerField(host, layer, "binding", L("Editor.CharacterField"), { options: optionsFor(layer.binding) });
      if (layer.type === "resource-bar") {
        this._layerField(host, layer, "maxBinding", L("Editor.MaximumField"), { options: optionsFor(layer.maxBinding) });
        const pair = document.createElement("button"); pair.type = "button"; setText(pair, "Editor.MatchingMaximum"); pair.disabled = this._uploading;
        pair.addEventListener("click", () => {
          if (this._busy || this._uploading) return;
          if (!this._useResourceMaximum(layer)) ui.notifications.info(t("Editor.NoMaximum"));
        });
        host.append(pair);
        this._layerField(host, layer, "display", L("Editor.ResourceDisplay"), { options: [
          { value: "bar", label: L("Editor.ResourceBar") }, { value: "dots", label: L("Editor.ResourceDots") }
        ] });
        const displayHelp = document.createElement("p"); displayHelp.className = "mso-help"; setText(displayHelp, "Editor.ResourceDotsHelp"); host.append(displayHelp);
        this._layerField(host, layer, "foregroundColor", L("Editor.FillColor"), { maxLength: 9 });
        this._layerField(host, layer, "backgroundColor", L("Editor.TrackColor"), { maxLength: 9 });
        this._layerField(host, layer, "showValue", L("Editor.ShowValues"), { type: "checkbox" });
      }
      else {
        const template = this._layerField(host, layer, "text", L("Editor.TextTemplate"), { type: "textarea", maxLength: 10000 });
        const insertLabel = document.createElement("label"); insertLabel.className = "mso-layer-field"; setText(insertLabel, "Editor.InsertFieldTemplate");
        const insert = document.createElement("select"); setAttr(insert, "aria-label", "Editor.InsertTemplateField");
        for (const field of fields) { const option = document.createElement("option"); option.value = field.id; option.dataset.editorFieldId = field.id; option.textContent = fieldLabel(field); insert.append(option); }
        const button = document.createElement("button"); button.type = "button"; setText(button, "Editor.InsertField"); button.disabled = !fields.length;
        button.addEventListener("click", () => {
          const token = `{${insert.value}}`; const start = template.selectionStart ?? template.value.length; const end = template.selectionEnd ?? start;
          template.value = `${template.value.slice(0, start)}${token}${template.value.slice(end)}`;
          this._onLayerInput({ currentTarget: template }); template.focus();
        });
        insertLabel.append(insert, button); host.append(insertLabel);
      }
      this._layerField(host, layer, "fallback", L("Editor.MissingValue"), { maxLength: 1000 });
      this._layerField(host, layer, "fontFamily", L("Editor.Font"), { options: FONT_FAMILIES });
      this._layerField(host, layer, "fontSize", L("Editor.FontSize"), { type: "number", min: 1, max: 512, step: "any" });
      this._layerField(host, layer, "fontWeight", L("Editor.FontWeight"), { options: FONT_WEIGHTS });
      this._layerField(host, layer, "color", L("Editor.TextColor"), { maxLength: 9 });
      this._layerField(host, layer, "align", L("Editor.Alignment"), { options: ["left", "center", "right"].map(value => ({ value, label: S(value) })) });
      this._layerField(host, layer, "shadow", L("Editor.TextShadow"), { type: "checkbox" });
      const help = document.createElement("p"); help.className = "mso-help"; setText(help, "Editor.FieldsHelp"); host.append(help);
    }
  }

  _useResourceMaximum(layer = this._selectedLayer()) {
    if (layer?.type !== "resource-bar") return false;
    const fields = this._fieldDefinitions(layer);
    const maximum = fields.find(field => field.id === layer.binding)?.maxField;
    if (!maximum || fields.find(field => field.id === maximum)?.type !== "number") return false;
    Object.assign(layer, validateLayer({ ...layer, maxBinding: maximum }, this._draft.canvas));
    this._invalidInputs.delete(`layer.${layer.id}.maxBinding`);
    this._markDirty(); this._syncLayerFields(layer); void this._updatePreview();
    return true;
  }

  async _setContentSource(source) {
    const layer = this._selectedLayer(); if (!layer) return;
    const image = ["image", "character-portrait"].includes(layer.type);
    const type = source === "static" ? image ? "image" : "text" : image ? "character-portrait" : "dynamic-text";
    if (type === layer.type) return;
    const replacement = { ...createLayer(type, this._draft.canvas), ...layer, type };
    if (source === "dynamic" && !image) { replacement.binding = "character.name"; replacement.text = "{character.name}"; }
    Object.assign(layer, validateLayer(replacement, this._draft.canvas));
    this._markDirty(); await this._updatePreview(); this._renderLayerProperties();
  }

  _renderWidgetProperties(host, layer) {
    const preset = this.widgetPresets?.list().find(entry => entry.id === layer.presetId);
    const description = document.createElement("p"); description.className = "mso-help"; writeText(description, preset ? L("Editor.SharedDesign", { name: preset.name }) : L("Editor.SourcePresetMissing")); host.append(description);
    const sourceLabel = document.createElement("label"); sourceLabel.className = "mso-layer-field"; const sourceCaption = document.createElement("span"); setText(sourceCaption, "Editor.DataSource"); sourceLabel.append(sourceCaption);
    const source = document.createElement("select"); setAttr(source, "aria-label", "Editor.DataSource");
    for (const [value, text] of [["actors", L("Editor.FoundryActors")], ["demo", L("Editor.DemoCharacters")]]) { const option = document.createElement("option"); option.value = value; writeText(option, text); source.append(option); }
    source.value = layer.dataSource ?? "actors"; source.disabled = this._uploading;
    source.addEventListener("change", () => { void this._draftOperation(async () => { this._changeCharacterDataSource(layer, source.value); await this._updatePreview(); this._renderLayerProperties(); this._renderAnimationTestPanel(); }); });
    sourceLabel.append(source); host.append(sourceLabel);
    const demoMode = layer.dataSource === "demo";
    if (demoMode) { const note = document.createElement("p"); note.className = "mso-binding-warning mso-help"; setText(note, "Editor.DemoHelp"); host.append(note); }
    const actor = document.createElement("p"); actor.className = "mso-help"; actor.dataset.actorStatus = ""; actor.setAttribute("role", "status"); writeText(actor, layer.actorUuid || L("Editor.NoAssignedCharacter")); host.append(actor);
    if (layer.actorUuid && this.characterData) {
      const id = layer.id; const reference = layer.actorUuid;
      const updateStatus = () => {
        void this.characterData.resolve(reference, ["character.name"]).then(result => {
          if (this._selectedLayerId !== id || this._selectedLayer()?.actorUuid !== reference) return;
          if (result.warning) writeError(actor, result.warning);
          else { delete actor.dataset.editorError; writeText(actor, String(result.values?.["character.name"] ?? reference)); }
          actor.classList.toggle("mso-binding-warning", !!result.warning);
        }).catch(error => { writeError(actor, error); actor.classList.add("mso-binding-warning"); });
      };
      updateStatus();
      this._actorStatusUnsubscribe = this.characterData.subscribe?.(reference, updateStatus);
    }
    const actions = document.createElement("div"); actions.className = "mso-image-actions";
    for (const [label, operation] of [...(!demoMode ? [[L("Editor.ChangeCharacter"), () => this._assignActor()], [L("Editor.ClearCharacter"), () => this._assignActor("")]] : []), [L("Editor.EditDesign"), () => services.openWidgetPreset?.(layer.presetId)]]) {
      const button = document.createElement("button"); button.type = "button"; writeText(button, label); button.disabled = this._uploading || label.key === "Editor.EditDesign" && !preset; button.addEventListener("click", () => { void this._draftOperation(operation); }); actions.append(button);
    }
    host.append(actions);
    const label = document.createElement("label"); label.className = "mso-layer-field"; setText(label, "Editor.ActorUUIDLink");
    const reference = document.createElement("input"); reference.type = "text"; reference.value = demoMode ? "" : layer.actorUuid; setAttr(reference, "aria-label", "Editor.ActorUUIDLink");
    const apply = document.createElement("button"); apply.type = "button"; setText(apply, "Editor.ApplyCharacterLink"); apply.addEventListener("click", () => { void this._draftOperation(() => this._assignActor(reference.value.trim())); }); label.append(reference, apply); if (!demoMode) host.append(label);
    this._renderInstanceCarousel(host, layer, preset);
  }

  _assignedCharacters(layer) { return layer.actorUuids ?? (layer.actorUuid ? [layer.actorUuid] : []); }

  _changeCharacterDataSource(layer, source) {
    if (!this._allLayers().includes(layer) || !["actors", "demo"].includes(source) || (layer.dataSource ?? "actors") === source) return;
    if ((layer.dataSource ?? "actors") === "actors") this._realActorAssignments.set(layer.id, [...this._assignedCharacters(layer)]);
    const actors = source === "demo" ? [...DEMO_ACTOR_UUIDS] : [...(this._realActorAssignments.get(layer.id) ?? [])];
    Object.assign(layer, validateLayer({ ...layer, dataSource: source, actorUuid: actors[0] ?? "", actorUuids: actors, carousel: { ...layer.carousel, actorStartUuid: null } }, this._draft.canvas));
    this._markDirty();
  }

  async _replaceCarouselActor(layer, previous) {
    const draft = this._draft, actor = await this._chooseActor();
    if (!actor || draft !== this._draft || !this._allLayers().includes(layer)) return;
    const actors = [...this._assignedCharacters(layer)], index = actors.indexOf(previous);
    if (index < 0) return;
    if (actors.includes(actor.uuid) && actor.uuid !== previous) throw new Error(t("Editor.AlreadyAssigned"));
    actors[index] = actor.uuid; this._setCarouselCharacters(layer, actors);
    await this._updatePreview(); this._renderLayerProperties();
  }

  async _previewAssignedActor(layer, uuid) {
    const accepted = await this._preview?.renderer?.handleAnimationCommand?.({ overlayId: this._draft.id, layerId: layer.id, kind: "carousel", action: "select-actor", actorUuid: uuid });
    if (!accepted) throw new Error(t("Editor.ActorUnavailablePreview"));
    this._syncInstanceCarouselPreview();
  }

  async _addCarouselActor(reference) {
    const layer = this._selectedLayer(), draft = this._draft;
    if (!layer || layer.type !== "character-widget") return;
    const actor = reference === undefined ? await this._chooseActor() : await this.characterData.resolveActor(reference);
    if (!actor || this._draft !== draft || !this._allLayers().includes(layer)) return;
    if (layer.dataSource === "demo") this._changeCharacterDataSource(layer, "actors");
    const actors = [...this._assignedCharacters(layer)];
    if (actors.includes(actor.uuid)) return;
    if (actors.length >= 20) throw new Error(t("Editor.ActorLimit"));
    actors.push(actor.uuid);
    this._setCarouselCharacters(layer, actors);
    await this._updatePreview(); this._renderLayerProperties();
  }

  _setCarouselCharacters(layer, actors) {
    const carousel = { ...(layer.carousel ?? {}) };
    if (carousel.actorStartUuid && !actors.includes(carousel.actorStartUuid)) carousel.actorStartUuid = null;
    Object.assign(layer, validateLayer({ ...layer, actorUuid: actors[0] ?? "", actorUuids: actors, carousel }, this._draft.canvas));
    this._markDirty();
  }

  async _carouselCharacterCommand(layer, uuid, command) {
    if (!this._allLayers().includes(layer)) return;
    const actors = [...this._assignedCharacters(layer)], index = actors.indexOf(uuid);
    if (index < 0) return;
    if (command === "remove") actors.splice(index, 1);
    else {
      const next = index + (command === "up" ? -1 : 1);
      if (next < 0 || next >= actors.length) return;
      [actors[index], actors[next]] = [actors[next], actors[index]];
    }
    this._setCarouselCharacters(layer, actors);
    await this._updatePreview(); this._renderLayerProperties();
  }

  _instanceCarouselField(host, layer, label, field, { options, pageId, min, max, step } = {}) {
    const wrapper = document.createElement("label"); wrapper.className = "mso-layer-field";
    const title = document.createElement("span"); writeText(title, label);
    const input = document.createElement(options ? "select" : "input");
    input.dataset.instanceCarouselField = field; writeAttr(input, "aria-label", label);
    if (pageId) input.dataset.carouselPageId = pageId;
    if (!options) { input.type = "number"; setAttr(input, "placeholder", "Editor.PresetDefault"); }
    for (const option of options ?? []) { const entry = document.createElement("option"); entry.value = String(option.value); writeText(entry, option.label); input.append(entry); }
    for (const [key, value] of Object.entries({ min, max, step })) if (value !== undefined) input[key] = String(value);
    let value = pageId ? layer.carousel?.pageDurations?.[pageId] : layer.carousel?.[field];
    if ((field === "duration" || pageId) && value !== undefined && value !== null) value /= 1000;
    input.value = String(value ?? "");
    const key = `carousel.${layer.id}.${pageId ? `page.${pageId}` : field}`;
    if (this._invalidInputs.has(key)) { input.value = this._invalidInputs.get(key); setValidity(input, L("Editor.CorrectCarousel")); }
    input.disabled = this._uploading;
    input.addEventListener(options ? "change" : "input", () => this._onInstanceCarouselInput(input, layer, { field, pageId }));
    wrapper.append(title, input); host.append(wrapper); return input;
  }

  _onInstanceCarouselInput(input, layer, { field, pageId }) {
    if (this._busy || this._uploading || !this._allLayers().includes(layer)) return;
    const key = `carousel.${layer.id}.${pageId ? `page.${pageId}` : field}`;
    try {
      let value = input.value.trim() === "" ? null : input.value;
      if (["duration", "transitionDuration", "characterTransitionDuration"].includes(field) || pageId) {
        if (value !== null) value = Number(value) * (field === "duration" || pageId ? 1000 : 1);
        const isDuration = field === "duration" || !!pageId;
        if (value !== null && (!Number.isSafeInteger(value) || value < (isDuration ? 100 : 0) || value > (isDuration ? 3600000 : 10000))) throw editorError(isDuration ? "Editor.DwellRange" : "Editor.TransitionRange");
      }
      if (["loop", "enabled"].includes(field) && value !== null) value = value === "true";
      const carousel = { ...(layer.carousel ?? {}) };
      if (pageId) {
        carousel.pageDurations = { ...(carousel.pageDurations ?? {}) };
        if (value === null) delete carousel.pageDurations[pageId]; else carousel.pageDurations[pageId] = value;
      } else carousel[field] = value;
      Object.assign(layer, validateLayer({ ...layer, carousel }, this._draft.canvas));
      setValidity(input, ""); this._invalidInputs.delete(key); this._markDirty();
      void this._updatePreview().then(() => { if (["mode", "actorStartUuid", "startPageId"].includes(field)) this._renderLayerProperties(); });
    } catch (error) {
      setValidity(input, error); this._invalidInputs.set(key, input.value); this._markDirty();
    }
  }

  async _instancePageOrder(layer, preset, pageId, direction) {
    const order = this._orderedCarouselPages(layer, preset).map(page => page.id), index = order.indexOf(pageId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    Object.assign(layer, validateLayer({ ...layer, carousel: { ...layer.carousel, pageOrder: order } }, this._draft.canvas));
    this._markDirty(); await this._updatePreview(); this._renderLayerProperties();
  }

  _orderedCarouselPages(layer, preset) {
    const pages = preset?.pages ?? [], order = layer.carousel?.pageOrder ?? [];
    return [...order.map(id => pages.find(page => page.id === id)).filter(Boolean), ...pages.filter(page => !order.includes(page.id))];
  }

  _carouselPreviewSequence(layer, preset) {
    const { settings } = resolveCarouselSettings(layer, preset ?? {});
    const actors = this._assignedCharacters(layer);
    const allPages = this._orderedCarouselPages(layer, preset).filter(page => page.enabled !== false);
    const pages = allPages.length ? allPages : (preset?.pages?.length ? [] : [{ id: null, name: t("Editor.SharedCard") }]);
    const firstActor = actors.includes(settings.actorStartUuid) ? settings.actorStartUuid : actors[0];
    const firstPage = pages.find(page => page.id === settings.startPageId) ?? pages[0];
    const actorIds = ["information", "static"].includes(settings.mode) ? (firstActor ? [firstActor] : []) : actors;
    const displayedPages = ["character", "static"].includes(settings.mode) ? (firstPage ? [firstPage] : []) : pages;
    return settings.traversal === "characters-first" ? displayedPages.flatMap(page => actorIds.map(actorUuid => ({ actorUuid, pageId: page.id }))) : actorIds.flatMap(actorUuid => displayedPages.map(page => ({ actorUuid, pageId: page.id })));
  }

  _renderInstanceCarousel(host, layer, preset) {
    const section = document.createElement("section"); section.className = "mso-instance-carousel"; setAttr(section, "aria-label", "Editor.CarouselSettings");
    const title = document.createElement("h4"); setText(title, "Editor.CarouselSettings"); section.append(title); host.append(section);
    const inherited = [{ value: "", label: L("Editor.PresetDefault") }];
    this._instanceCarouselField(section, layer, L("Editor.CyclingMode"), "mode", { options: [...inherited, { value: "static", label: L("Editor.StaticMode") }, { value: "information", label: L("Editor.InformationMode") }, { value: "character", label: L("Editor.CharacterMode") }, { value: "combined", label: L("Editor.CombinedMode") }] });
    this._instanceCarouselField(section, layer, L("Editor.AutomaticPlayback"), "enabled", { options: [...inherited, { value: "true", label: L("Editor.PlayAutomatically") }, { value: "false", label: L("Editor.StartPaused") }] });
    this._instanceCarouselField(section, layer, L("Editor.TraversalOrder"), "traversal", { options: [...inherited, { value: "pages-first", label: L("Editor.PagesFirst") }, { value: "characters-first", label: L("Editor.CharactersFirst") }] });
    const assignedTitle = document.createElement("h5"); setText(assignedTitle, "Editor.AssignedCharacters"); section.append(assignedTitle);
    const assigned = document.createElement("div"); assigned.className = "mso-carousel-assigned"; assigned.dataset.assignedCharacters = ""; setAttr(assigned, "aria-label", "Editor.AssignedDrop"); section.append(assigned);
    const characters = this._assignedCharacters(layer), labels = new Map(), actorNodes = [];
    const addButton = (parent, label, operation, disabled = false) => {
      const button = document.createElement("button"); button.type = "button"; writeText(button, label); button.disabled = this._uploading || disabled;
      button.addEventListener("click", () => { void this._draftOperation(operation); }); parent.append(button); return button;
    };
    if (!characters.length) { const empty = document.createElement("p"); empty.className = "mso-help"; setText(empty, "Editor.NoCharacters"); assigned.append(empty); }
    characters.forEach((uuid, index) => {
      const row = document.createElement("div"); row.className = "mso-carousel-order-row";
      const name = document.createElement("span"); setText(name, "Editor.CharacterLoading", { index: index + 1 }); actorNodes.push([uuid, name]); row.append(name);
      if (layer.dataSource !== "demo") addButton(row, L("Editor.SelectActorIndex", { index: index + 1 }), () => this._replaceCarouselActor(layer, uuid));
      addButton(row, L("Editor.PreviewCharacterIndex", { index: index + 1 }), () => this._previewAssignedActor(layer, uuid));
      addButton(row, L("Editor.EarlierCharacterIndex", { index: index + 1 }), () => this._carouselCharacterCommand(layer, uuid, "up"), index === 0);
      addButton(row, L("Editor.LaterCharacterIndex", { index: index + 1 }), () => this._carouselCharacterCommand(layer, uuid, "down"), index === characters.length - 1);
      addButton(row, L("Editor.RemoveCharacterIndex", { index: index + 1 }), () => this._carouselCharacterCommand(layer, uuid, "remove")); assigned.append(row);
    });
    if (layer.dataSource === "demo") addButton(assigned, L("Editor.RestoreDemoCharacters"), async () => { this._setCarouselCharacters(layer, [...DEMO_ACTOR_UUIDS]); await this._updatePreview(); this._renderLayerProperties(); }, DEMO_ACTOR_UUIDS.every(uuid => characters.includes(uuid)));
    else addButton(assigned, L("Editor.AddCharacter"), () => this._addCarouselActor(), characters.length >= 20);
    const initialActor = this._instanceCarouselField(section, layer, L("Editor.InitialActor"), "actorStartUuid", { options: [{ value: "", label: L("Editor.FirstCharacter") }, ...characters.map((uuid, index) => ({ value: uuid, label: L("Editor.CharacterIndex", { index: index + 1 }) }))] });
    const pagesTitle = document.createElement("h5"); setText(pagesTitle, "Editor.InformationPageOrder"); section.append(pagesTitle);
    const pages = this._orderedCarouselPages(layer, preset);
    if (layer.carousel?.pageOrder?.length) addButton(section, L("Editor.PresetPageOrder"), async () => {
      Object.assign(layer, validateLayer({ ...layer, carousel: { ...layer.carousel, pageOrder: [] } }, this._draft.canvas));
      this._markDirty(); await this._updatePreview(); this._renderLayerProperties();
    });
    if (!pages.length) { const shared = document.createElement("p"); shared.className = "mso-help"; setText(shared, "Editor.SharedCardHelp"); section.append(shared); }
    pages.forEach((page, index) => {
      const row = document.createElement("div"); row.className = "mso-carousel-page-row";
      const name = document.createElement("strong"); setText(name, page.enabled === false ? "Editor.DisabledPageName" : "Editor.PageName", { index: index + 1, name: page.name }); row.append(name);
      const buttons = document.createElement("div"); buttons.className = "mso-page-actions"; row.append(buttons);
      addButton(buttons, L("Editor.EarlierPageIndex", { index: index + 1 }), () => this._instancePageOrder(layer, preset, page.id, -1), index === 0);
      addButton(buttons, L("Editor.LaterPageIndex", { index: index + 1 }), () => this._instancePageOrder(layer, preset, page.id, 1), index === pages.length - 1);
      this._instanceCarouselField(row, layer, L("Editor.NamedPageDuration", { name: page.name }), "duration", { pageId: page.id, min: .1, max: 3600, step: .1 }); section.append(row);
    });
    this._instanceCarouselField(section, layer, L("Editor.InitialPage"), "startPageId", { options: [...inherited, ...pages.filter(page => page.enabled !== false).map(page => ({ value: page.id, label: page.name }))] });
    this._instanceCarouselField(section, layer, L("Editor.PageDuration"), "duration", { min: .1, max: 3600, step: .1 });
    const transitionOptions = [...inherited, ...PAGE_TRANSITIONS.map(entry => ({ value: entry.id, label: S(entry.label) }))];
    this._instanceCarouselField(section, layer, L("Editor.PageTransition"), "transition", { options: transitionOptions });
    this._instanceCarouselField(section, layer, L("Editor.PageTransitionDuration"), "transitionDuration", { min: 0, max: 10000, step: 1 });
    this._instanceCarouselField(section, layer, L("Editor.CharacterTransition"), "characterTransition", { options: transitionOptions });
    this._instanceCarouselField(section, layer, L("Editor.CharacterTransitionDuration"), "characterTransitionDuration", { min: 0, max: 10000, step: 1 });
    this._instanceCarouselField(section, layer, L("Editor.Loop"), "loop", { options: [...inherited, { value: "true", label: L("Editor.Loop") }, { value: "false", label: L("Editor.StopAtEnd") }] });
    const previewTitle = document.createElement("h5"); setText(previewTitle, "Editor.PreviewSequence"); section.append(previewTitle);
    const sequence = document.createElement("ol"); sequence.className = "mso-carousel-sequence"; setAttr(sequence, "aria-label", "Editor.PreviewSequence"); section.append(sequence);
    const status = document.createElement("p"); status.className = "mso-help"; status.setAttribute("role", "status"); section.append(status);
    const controls = document.createElement("div"); controls.className = "mso-page-actions"; section.append(controls);
    for (const [label, command] of [[L("Editor.PreviousStep"), "previous"], [L("Editor.NextStep"), "next"], [L("Editor.PausePreview"), "pause"], [L("Editor.ResumePreview"), "resume"], [L("Editor.ResetPreview"), "reset"]]) addButton(controls, label, () => this._instanceCarouselPreview(layer.id, command), !preset);
    const note = document.createElement("p"); note.className = "mso-help"; setText(note, "Editor.PreviewHelp"); section.append(note);
    this._carouselPanel = { layerId: layer.id, layer, preset, labels, sequence, status };
    this._syncInstanceCarouselPreview();
    this._animationTestPanel?.refreshDiagnostics?.();
    const generation = this._carouselLabelsGeneration;
    void Promise.all(characters.map(async (uuid, index) => {
      try { const result = await this.characterData?.resolve(uuid, ["character.name"]); return [uuid, result?.warning ? L("Editor.CharacterUnavailable", { index: index + 1 }) : result?.values?.["character.name"] == null ? L("Editor.CharacterIndex", { index: index + 1 }) : String(result.values["character.name"])]; }
      catch { return [uuid, L("Editor.CharacterUnavailable", { index: index + 1 })]; }
    })).then(entries => {
      if (generation !== this._carouselLabelsGeneration || this._selectedLayerId !== layer.id) return;
      for (const [uuid, label] of entries) labels.set(uuid, label);
      for (const [uuid, node] of actorNodes) writeText(node, labels.get(uuid));
      for (const option of initialActor.children) if (labels.has(option.value)) writeText(option, labels.get(option.value));
      this._syncInstanceCarouselPreview();
      this._animationTestPanel?.refreshDiagnostics?.();
    });
  }

  async _instanceCarouselPreview(id, command) {
    const carousel = this._preview?.renderer?.compositions?.get(id)?.carousel;
    await carousel?.[command]?.(); this._syncInstanceCarouselPreview();
  }

  _syncInstanceCarouselPreview() {
    const panel = this._carouselPanel;
    if (!panel || this._selectedLayerId !== panel.layerId) return;
    const state = this._preview?.renderer?.compositions?.get(panel.layerId)?.carousel?.getState?.();
    const sequence = state?.sequence ?? this._carouselPreviewSequence(panel.layer, panel.preset);
    panel.sequence.replaceChildren();
    for (const step of sequence) {
      const item = document.createElement("li");
      const actorIndex = this._assignedCharacters(panel.layer).indexOf(step.actorUuid);
      const name = labelText(panel.labels.get(step.actorUuid) ?? L("Editor.CharacterIndex", { index: actorIndex + 1 }));
      const page = panel.preset?.pages?.find(entry => entry.id === step.pageId);
      item.textContent = `${name} / ${page?.name ?? t("Editor.SharedCard")}`;
      if (step.actorUuid === state?.activeActorUuid && step.pageId === state?.activePageId) item.setAttribute("aria-current", "step");
      panel.sequence.append(item);
    }
    const activeName = labelText(panel.labels.get(state?.activeActorUuid)), activePage = panel.preset?.pages?.find(page => page.id === state?.activePageId)?.name;
    panel.status.textContent = !sequence.length ? t("Editor.NoPreviewSteps") : state ? t("Editor.PreviewStatus", { active: activeName ? `: ${activeName} / ${activePage ?? t("Editor.SharedCard")}` : "", state: state.paused ? t("Editor.Paused") : t("Editor.Running"), count: sequence.length }) : t("Editor.ConfiguredSteps", { count: sequence.length });
  }

  _onLayerInput(event) {
    if (this._busy || this._uploading) return;
    const layer = this._selectedLayer();
    if (!layer) return;
    const input = event.currentTarget;
    const field = input.dataset.layerField;
    const numeric = new Set(["x", "y", "width", "height", "rotation", "opacity", "fontSize", "borderRadius"]);
    const allowed = new Set(["name", "x", "y", "width", "height", "rotation", "opacity", "visible", "locked", "src", "fit", "lockAspectRatio", "text", "fontFamily", "fontSize", "fontWeight", "color", "align", "shadow", "binding", "maxBinding", "fallback", "portraitSource", "circular", "borderRadius", "foregroundColor", "backgroundColor", "showValue", "display"]);
    if (!allowed.has(field)) return;
    let value = input.type === "checkbox" ? input.checked : input.value;
    if (numeric.has(field)) value = input.value.trim() === "" ? NaN : Number(input.value);
    try {
      const patch = { [field]: value };
      if (field === "binding" && layer.text === `{${layer.binding}}`) patch.text = `{${value}}`;
      const validated = validateLayer({ ...layer, ...patch }, this._draft.canvas, this._editingLayers().indexOf(layer));
      Object.assign(layer, validated);
      setValidity(input, "");
      this._invalidInputs.delete(`layer.${layer.id}.${field}`);
      this._markDirty();
      this._syncLayerFields(layer, { skip: input });
      this._updateLayerRow(layer);
      void this._updatePreview();
    }
    catch (error) {
      setValidity(input, error);
      this._invalidInputs.set(`layer.${layer.id}.${field}`, input.type === "checkbox" ? input.checked : input.value);
      this._markDirty();
    }
  }

  _syncLayerFields(layer, { skip } = {}) {
    if (!layer || layer.id !== this._selectedLayerId) return;
    this.element?.querySelectorAll("[data-layer-field]").forEach(input => {
      if (input === skip) return;
      const field = input.dataset.layerField;
      // Keep unfinished entries visible until that property is corrected or reloaded.
      if (this._invalidInputs.has(`layer.${layer.id}.${field}`)) return;
      if (input.type === "checkbox") input.checked = !!layer[field];
      else input.value = String(layer[field] ?? "");
      setValidity(input, "");
      this._invalidInputs.delete(`layer.${layer.id}.${field}`);
    });
    this.element?.querySelectorAll('[data-layer-command="delete"]').forEach(button => {
      button.disabled = !!layer.locked || this._uploading;
    });
  }

  _updateLayerRow(layer) {
    this.element?.querySelectorAll("[data-layer-id]").forEach(row => {
      if (row.dataset.layerId !== layer.id) return;
      const name = row.querySelector("[data-layer-name]");
      if (name) name.textContent = layer.name;
      for (const [command, active, yes, no] of [["visible", layer.visible, L("Editor.Visible"), L("Editor.Hidden")], ["locked", !!layer.locked, L("Editor.Locked"), L("Editor.Unlocked")]]) {
        const button = row.querySelector(`[data-layer-command="${command}"]`);
        if (!button) continue;
        writeText(button, active ? yes : no);
        writeAttr(button, "title", active ? yes : no);
        writeAttr(button, "aria-label", active ? yes : no);
        button.setAttribute("aria-pressed", String(active));
      }
    });
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
    // Keep the local file chooser inside the trusted click's synchronous stack.
    if (target.dataset.action === "uploadBackground") {
      this._uploadBackground();
      return;
    }
    if (["addImage", "addText", "selectTool", "addWidget", "manageWidgets", "liveControls", "addComponent", "choosePreviewActor", "chooseDemoPreviewActor"].includes(target.dataset.action)) {
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
    const saved = await this.store.saveOverlay(clone(this._draft), { expectedRevision: this._loadedRevision });
    this._loadDraft(saved);
    ui.notifications.info(t("Editor.Saved"));
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

  async close(options = {}) {
    if (!await this._discardDraft()) return this;
    this._actorStatusUnsubscribe?.();
    this._actorStatusUnsubscribe = null;
    this._preview?.destroy();
    this._preview = null;
    this._loadDraft(null, null);
    editors.delete(this);
    return super.close(options);
  }
}
