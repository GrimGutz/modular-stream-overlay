import { LayerCanvas } from "../editor/layer-canvas.js";
import { uploadBackground } from "../core/background-upload.js";
import { validateAssetPath, validateLayer, FONT_FAMILIES, FONT_WEIGHTS } from "../core/schema.js";
import { createLayer, createWidgetInstance, duplicateLayer, deleteLayer, reorderLayer } from "../core/layers.js";
import { safePortraitURL } from "../render/character-components.js";
import { renderAnimationControls, renderAnimationTestControls } from "./animation-controls.js";
import { DEMO_ACTOR_UUIDS } from "../demo/data.js";
import { validateAnimationSettings, validateTriggerRules } from "../animation/schema.js";
import { PAGE_TRANSITIONS, resolveCarouselSettings } from "../carousel/schema.js";

const MODULE_ID = "modular-stream-overlay";
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
let services = {};
const editors = new Set();

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
    window: { title: "Modular Stream Overlay", icon: "fa-solid fa-tv", resizable: true },
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
    return this.characterData?.fieldDefinitions?.({ dataSource }) ?? [];
  }

  _canRender(options) {
    if (!game.user?.isGM) {
      ui.notifications.warn("Only a Game Master can configure stream overlays.");
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
        { value: "fit", label: "Fit" }, { value: "0.5", label: "50%" },
        { value: "1", label: "100%" }, { value: "2", label: "200%" }
      ].map(option => ({ ...option, selected: String(this._zoom) === option.value })),
      conflict: this._conflict,
      fitOptions: ["cover", "contain", "stretch"].map(value => ({
        value, label: value[0].toUpperCase() + value.slice(1), selected: value === this._draft?.background.fit
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
        input.setCustomValidity("Enter a whole number from 64 to 7680.");
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
        ui.notifications.info(selectedId ? "The saved active overlay is now live." : "The stream overlay is now transparent.");
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
      ui.notifications.error(error.message || "The layer could not be updated.");
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
    if (reset && !await this._confirm("Reset Demo Overlay", "Replace the demonstration overlay and its widget design with the original demo settings? Changes you made to these two demo items will be lost. Other overlays and designs are preserved.", "Reset Demo Overlay")) return;
    const install = services.installDemo ?? this.api?.installDemo;
    if (!install) throw new Error("Demo installation is not ready. Reopen the editor after the world loads.");
    const result = await install({ reset });
    const state = this.store.getState();
    const overlay = state.overlays.find(entry => entry.id === result.overlayId);
    if (!overlay) throw new Error("The installed demo could not be found. Reopen the overlay editor.");
    this._loadDraft(overlay, state.revision);
    this._selectedLayerId = overlay.layers.find(layer => layer.type === "character-widget")?.id ?? null;
    this._testLayerId = this._selectedLayerId;
    ui.notifications.info("Demo opened. Choose Active on stream to display its saved configuration in OBS.");
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
    if (!game.user?.isGM) throw new Error("Only a Game Master can test overlay animations.");
    if (this._uploading || this._busy) throw new Error("Wait for the current editor operation to finish.");
    const layer = this._draft?.layers.find(entry => entry.id === layerId && entry.type === "character-widget");
    if (!layer) throw new Error("Choose an existing character widget.");
    if (command.kind === "demo" && layer.dataSource !== "demo") throw new Error("Simulation is available only for DEMO DATA. Real Actor values are never changed.");
    if (target === "obs") {
      if (this._dirty) throw new Error("Save overlay before testing the saved OBS output.");
      if (this.store.getState().activeOverlayId !== this._draft.id) throw new Error("Select this overlay in Active on stream before testing OBS.");
      const publish = services.publishTestCommand ?? this.api?.liveControls?.testCommand;
      if (!publish) throw new Error("Live animation controls are not ready.");
      await publish(layerId, command);
    } else {
      await this._animationPreviewUpdate;
      const accepted = await this._preview?.renderer?.handleAnimationCommand?.({ ...command, overlayId: this._draft.id, layerId });
      if (!accepted) throw new Error("The preview could not accept this action. Check that the widget design and its assigned characters are available.");
    }
    this._syncInstanceCarouselPreview();
  }

  async _addWidget() {
    if (!this._draft) return;
    const presets = this.widgetPresets?.list() ?? [];
    if (!presets.length) { await this._manageWidgets(); return; }
    const content = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = "Widget design";
    const select = document.createElement("select");
    select.name = "presetId";
    for (const preset of presets) {
      const option = document.createElement("option");
      option.value = preset.id; option.textContent = preset.name; select.append(option);
    }
    label.append(select); content.append(label);
    const result = await DialogV2.input({ window: { title: "Add widget · Choose preset" }, content, modal: true, rejectClose: false });
    if (!result?.presetId) return;
    const preset = presets.find(entry => entry.id === result.presetId);
    if (!preset) throw new Error("This widget preset no longer exists.");
    const actor = await this._chooseActor();
    if (actor === undefined) return;
    await this._insertWidget(preset, actor?.uuid ?? "");
  }

  async _insertWidget(preset, actorUuid = "") {
    if (!this._draft || this._allLayers().length >= 100) throw new Error("A design supports up to 100 components across shared elements and pages.");
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
    if (!this.characterData) throw new Error("Character data is not ready. Reopen the editor after the world loads.");
    // DialogV2 accepts an attribute-free DIV, serializes its children, then rebuilds the form.
    const content = document.createElement("div");
    const picker = document.createElement("div"); picker.className = "mso-actor-picker";
    const search = document.createElement("input"); search.type = "search"; search.placeholder = "Search characters"; search.setAttribute("aria-label", "Search characters");
    const list = document.createElement("div"); list.className = "mso-actor-list"; list.setAttribute("role", "list");
    const label = document.createElement("label"); label.textContent = "Actor UUID or Foundry document link";
    const reference = document.createElement("input"); reference.type = "text"; reference.name = "actorReference"; reference.placeholder = "Actor.… or @UUID[Actor.…]{Name}";
    label.append(reference);
    const help = document.createElement("p"); help.textContent = "Choose a character, paste its link, or leave blank to place an unassigned widget. Only characters visible to both the GM and stream viewer are listed.";
    picker.append(search, list, label, help); content.append(picker);
    const entries = this.characterData.listActors?.() ?? this.characterData.accessibleActors?.() ?? [];
    const actors = await Promise.resolve(entries);
    const result = await DialogV2.input({ window: { title: "Assign character" }, content, modal: true, rejectClose: false,
      render: (_event, dialog) => {
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
          if (!list.children.length) { const empty = document.createElement("p"); empty.textContent = "No matching permitted Actors. Give the stream viewer Observer access to a character to include it."; list.append(empty); }
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
      if (data.type !== "Actor" || !data.uuid) throw new Error("Drag an Actor from Foundry's Actor Directory.");
      if (event.target.closest?.("[data-assigned-characters]")?.dataset.assignedCharacters !== undefined) await this._addCarouselActor(data.uuid);
      else await this._assignActor(data.uuid);
    });
  }

  async _addLayer(type) {
    if (!this._draft) return;
    if (this._allLayers().length >= 100) throw new Error("A design supports up to 100 components across shared elements and pages.");
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
      if (this._allLayers().length >= 100) throw new Error("A design supports up to 100 components across shared elements and pages.");
      const copy = duplicateLayer(composition, id);
      this._selectedLayerId = copy.id;
    }
    else if (command === "delete") {
      if (layer.locked) { ui.notifications.info("Unlock this layer before deleting it."); return; }
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
    button.textContent = label;
    button.title = label;
    button.setAttribute("aria-label", label);
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
      message.textContent = "Add an image or text layer to start composing.";
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
      const visible = this._layerButton(layer.visible ? "Visible" : "Hidden", "visible", layer.id, { pressed: layer.visible });
      visible.className = "mso-layer-toggle";
      const locked = this._layerButton(layer.locked ? "Locked" : "Unlocked", "locked", layer.id, { pressed: !!layer.locked });
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
    title.textContent = label;
    const input = document.createElement(options ? "select" : type === "textarea" ? "textarea" : "input");
    if (!options && type !== "textarea") input.type = type;
    input.dataset.layerField = field;
    input.setAttribute("aria-label", label);
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    if (step !== undefined) input.step = String(step);
    if (maxLength !== undefined) input.maxLength = maxLength;
    if (options) {
      for (const option of options) {
        const entry = document.createElement("option");
        entry.value = String(option.value ?? option);
        entry.textContent = String(option.label ?? option);
        input.append(entry);
      }
    }
    if (type === "checkbox") input.checked = !!layer[field];
    else input.value = String(layer[field] ?? "");
    const invalidKey = `layer.${layer.id}.${field}`;
    if (this._invalidInputs.has(invalidKey)) {
      if (type === "checkbox") input.checked = this._invalidInputs.get(invalidKey);
      else input.value = this._invalidInputs.get(invalidKey);
      input.setCustomValidity("Correct this layer property before saving.");
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
      note.textContent = "Select a layer on the canvas or in the list to edit its properties.";
      host.append(note);
      return;
    }
    this._layerField(host, layer, "name", "Layer name", { maxLength: 80 });
    const geometry = document.createElement("div");
    geometry.className = "mso-property-grid";
    for (const [field, label, min, max] of [
      ["x", "X", -32768, 32768], ["y", "Y", -32768, 32768],
      ["width", "Width", 1, 7680], ["height", "Height", 1, 7680],
      ["rotation", "Rotation (°)", -360, 360], ["opacity", "Opacity", 0, 1]
    ]) this._layerField(geometry, layer, field, label, { type: "number", min, max, step: field === "opacity" ? .01 : "any" });
    host.append(geometry);
    const toggles = document.createElement("div");
    toggles.className = "mso-property-grid";
    this._layerField(toggles, layer, "visible", "Visible", { type: "checkbox" });
    this._layerField(toggles, layer, "locked", "Locked", { type: "checkbox" });
    host.append(toggles);
    if (layer.type === "image") {
      this._layerField(host, layer, "src", "Image source", { maxLength: 4096 });
      const images = document.createElement("div");
      images.className = "mso-image-actions";
      for (const [label, callback] of [["Upload image", () => this._uploadImage()], ["Browse existing", () => { void this._draftOperation(() => this._browseImage()); }]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.disabled = this._uploading;
        button.addEventListener("click", callback);
        images.append(button);
      }
      host.append(images);
      this._layerField(host, layer, "fit", "Image scaling", { options: ["contain", "cover", "stretch"] });
      this._layerField(host, layer, "lockAspectRatio", "Lock aspect ratio", { type: "checkbox" });
      if (!layer.src) {
        const hint = document.createElement("p");
        hint.className = "mso-help";
        hint.textContent = "Choose an image to display. The empty frame is visible only in this editor.";
        host.append(hint);
      }
    }
    else if (layer.type === "text") {
      this._layerField(host, layer, "text", "Text content", { type: "textarea", maxLength: 10000 });
      this._layerField(host, layer, "fontFamily", "Font", { options: FONT_FAMILIES });
      const typography = document.createElement("div");
      typography.className = "mso-property-grid";
      this._layerField(typography, layer, "fontSize", "Font size", { type: "number", min: 1, max: 512, step: "any" });
      this._layerField(typography, layer, "fontWeight", "Font weight", { options: FONT_WEIGHTS });
      this._layerField(typography, layer, "color", "Text color (hex)", { maxLength: 9 });
      this._layerField(typography, layer, "align", "Alignment", { options: ["left", "center", "right"] });
      host.append(typography);
      this._layerField(host, layer, "shadow", "Text shadow", { type: "checkbox" });
    }
    else if (layer.type === "color") this._layerField(host, layer, "color", "Color");
    this._renderComponentProperties(host, layer);
    this._renderAnimationControls(host, layer);
    const commands = document.createElement("div");
    commands.className = "mso-layer-commands";
    for (const [label, command] of [["Move up", "up"], ["Move down", "down"], ["Bring to front", "front"], ["Send to back", "back"], ["Duplicate", "duplicate"], ["Delete", "delete"]]) {
      commands.append(this._layerButton(label, command, layer.id, { disabled: command === "delete" && layer.locked }));
    }
    host.append(commands);
    note.textContent = "Arrow keys move 1 px; Shift moves 10 px. Ctrl/Cmd+D duplicates. Delete removes an unlocked layer.";
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
      const caption = document.createElement("span"); caption.textContent = "Inherit shared widget animations and triggers";
      inherit.addEventListener("change", () => {
        if (this._uploading || this._busy) return;
        target.animationOverrides = !inherit.checked;
        if (target.animationOverrides) { target.animations = clone(preset.animations); target.triggers = clone(preset.triggers); }
        this._invalidInputs.delete(key); this._animationEdits.delete(key); this._markDirty(); this._animationPreviewUpdate = this._updatePreview(); this._renderLayerProperties();
      });
      inheritLabel.append(inherit, caption); host.append(inheritLabel);
      if (!target.animationOverrides) {
        const note = document.createElement("p"); note.className = "mso-help"; note.textContent = "This widget uses the shared design's grouped animations and triggers. Edit the shared design, or turn off inheritance to configure only this instance."; host.append(note);
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
      const label = document.createElement("label"); label.className = "mso-layer-field"; label.textContent = "Content source";
      const source = document.createElement("select"); source.setAttribute("aria-label", "Content source");
      for (const [value, text] of [["static", "Static content"], ["dynamic", "Dynamic character data"]]) { const option = document.createElement("option"); option.value = value; option.textContent = text; source.append(option); }
      source.value = ["image", "text"].includes(layer.type) ? "static" : "dynamic";
      source.addEventListener("change", () => { void this._draftOperation(() => this._setContentSource(source.value)); });
      label.append(source); host.append(label);
    }
    const dynamic = ["character-name", "dynamic-text", "dynamic-number", "resource-bar"].includes(layer.type);
    if (layer.type === "character-portrait") {
      this._layerField(host, layer, "portraitSource", "Portrait artwork", { options: [{ value: "profile", label: "Actor profile image" }, { value: "token", label: "Token artwork" }] });
      this._layerField(host, layer, "fit", "Image scaling", { options: ["contain", "cover"] });
      this._layerField(host, layer, "circular", "Circular portrait", { type: "checkbox" });
      this._layerField(host, layer, "borderRadius", "Corner radius (px)", { type: "number", min: 0, max: 3840 });
      this._layerField(host, layer, "lockAspectRatio", "Lock aspect ratio", { type: "checkbox" });
      this._layerField(host, layer, "src", "Fallback image path", { maxLength: 4096 });
    }
    if (dynamic) {
      const fields = this._fieldDefinitions(layer);
      const choices = fields.filter(field => !["dynamic-number", "resource-bar"].includes(layer.type) || field.type === "number").map(field => ({ value: field.id, label: field.label }));
      const optionsFor = value => choices.some(option => option.value === value) ? choices : [{ value: value ?? "", label: value ? `${value} · unavailable in this system` : "No supported numeric fields" }, ...choices];
      this._layerField(host, layer, "binding", "Character field", { options: optionsFor(layer.binding) });
      if (layer.type === "resource-bar") {
        this._layerField(host, layer, "maxBinding", "Maximum field", { options: optionsFor(layer.maxBinding) });
        this._layerField(host, layer, "foregroundColor", "Fill color (hex)", { maxLength: 9 });
        this._layerField(host, layer, "backgroundColor", "Track color (hex)", { maxLength: 9 });
        this._layerField(host, layer, "showValue", "Show current / maximum", { type: "checkbox" });
      }
      else {
        const template = this._layerField(host, layer, "text", "Text template (blank uses field)", { type: "textarea", maxLength: 10000 });
        const insertLabel = document.createElement("label"); insertLabel.className = "mso-layer-field"; insertLabel.textContent = "Insert field into template";
        const insert = document.createElement("select"); insert.setAttribute("aria-label", "Insert template field");
        for (const field of fields) { const option = document.createElement("option"); option.value = field.id; option.textContent = field.label; insert.append(option); }
        const button = document.createElement("button"); button.type = "button"; button.textContent = "Insert field"; button.disabled = !fields.length;
        button.addEventListener("click", () => {
          const token = `{${insert.value}}`; const start = template.selectionStart ?? template.value.length; const end = template.selectionEnd ?? start;
          template.value = `${template.value.slice(0, start)}${token}${template.value.slice(end)}`;
          this._onLayerInput({ currentTarget: template }); template.focus();
        });
        insertLabel.append(insert, button); host.append(insertLabel);
      }
      this._layerField(host, layer, "fallback", "Missing value text", { maxLength: 1000 });
      this._layerField(host, layer, "fontFamily", "Font", { options: FONT_FAMILIES });
      this._layerField(host, layer, "fontSize", "Font size", { type: "number", min: 1, max: 512, step: "any" });
      this._layerField(host, layer, "fontWeight", "Font weight", { options: FONT_WEIGHTS });
      this._layerField(host, layer, "color", "Text color (hex)", { maxLength: 9 });
      this._layerField(host, layer, "align", "Alignment", { options: ["left", "center", "right"] });
      this._layerField(host, layer, "shadow", "Text shadow", { type: "checkbox" });
      const help = document.createElement("p"); help.className = "mso-help"; help.textContent = "Available fields come from the active game system adapter. Missing values use the fallback; unavailable resources have no live fill. Templates accept {character.field} tokens and plain text."; host.append(help);
    }
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
    const description = document.createElement("p"); description.className = "mso-help"; description.textContent = preset ? `Shared design: ${preset.name}. This instance keeps its own character and placement when the design changes.` : "The source widget preset is missing. Restore it or choose a new widget."; host.append(description);
    const sourceLabel = document.createElement("label"); sourceLabel.className = "mso-layer-field"; const sourceCaption = document.createElement("span"); sourceCaption.textContent = "Character data source"; sourceLabel.append(sourceCaption);
    const source = document.createElement("select"); source.setAttribute("aria-label", "Character data source");
    for (const [value, text] of [["actors", "Foundry Actors"], ["demo", "DEMO DATA — simulated characters"]]) { const option = document.createElement("option"); option.value = value; option.textContent = text; source.append(option); }
    source.value = layer.dataSource ?? "actors"; source.disabled = this._uploading;
    source.addEventListener("change", () => { void this._draftOperation(async () => { this._changeCharacterDataSource(layer, source.value); await this._updatePreview(); this._renderLayerProperties(); this._renderAnimationTestPanel(); }); });
    sourceLabel.append(source); host.append(sourceLabel);
    const demoMode = layer.dataSource === "demo";
    if (demoMode) { const note = document.createElement("p"); note.className = "mso-binding-warning mso-help"; note.textContent = "DEMO DATA: synthetic characters and simulated values. No Foundry Actor documents are created or changed. Switch to Foundry Actors to use your characters with this same design."; host.append(note); }
    const actor = document.createElement("p"); actor.className = "mso-help"; actor.dataset.actorStatus = ""; actor.setAttribute("role", "status"); actor.textContent = layer.actorUuid || "No character assigned. Drop an Actor here or choose a character."; host.append(actor);
    if (layer.actorUuid && this.characterData) {
      const id = layer.id; const reference = layer.actorUuid;
      const updateStatus = () => {
        void this.characterData.resolve(reference, ["character.name"]).then(result => {
          if (this._selectedLayerId !== id || this._selectedLayer()?.actorUuid !== reference) return;
          actor.textContent = result.warning || String(result.values?.["character.name"] ?? reference);
          actor.classList.toggle("mso-binding-warning", !!result.warning);
        }).catch(error => { actor.textContent = error.message; actor.classList.add("mso-binding-warning"); });
      };
      updateStatus();
      this._actorStatusUnsubscribe = this.characterData.subscribe?.(reference, updateStatus);
    }
    const actions = document.createElement("div"); actions.className = "mso-image-actions";
    for (const [label, operation] of [...(!demoMode ? [["Assign / change character", () => this._assignActor()], ["Clear character", () => this._assignActor("")]] : []), ["Edit shared design", () => services.openWidgetPreset?.(layer.presetId)]]) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.disabled = this._uploading || label === "Edit shared design" && !preset; button.addEventListener("click", () => { void this._draftOperation(operation); }); actions.append(button);
    }
    host.append(actions);
    const label = document.createElement("label"); label.className = "mso-layer-field"; label.textContent = "Actor UUID or document link";
    const reference = document.createElement("input"); reference.type = "text"; reference.value = demoMode ? "" : layer.actorUuid; reference.setAttribute("aria-label", "Actor UUID or document link");
    const apply = document.createElement("button"); apply.type = "button"; apply.textContent = "Apply character link"; apply.addEventListener("click", () => { void this._draftOperation(() => this._assignActor(reference.value.trim())); }); label.append(reference, apply); if (!demoMode) host.append(label);
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
    if (actors.includes(actor.uuid) && actor.uuid !== previous) throw new Error("This character is already assigned to the widget.");
    actors[index] = actor.uuid; this._setCarouselCharacters(layer, actors);
    await this._updatePreview(); this._renderLayerProperties();
  }

  async _previewAssignedActor(layer, uuid) {
    const accepted = await this._preview?.renderer?.handleAnimationCommand?.({ overlayId: this._draft.id, layerId: layer.id, kind: "carousel", action: "select-actor", actorUuid: uuid });
    if (!accepted) throw new Error("This character is not available in the current preview. Check the source and widget design.");
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
    if (actors.length >= 20) throw new Error("A widget can have up to 20 assigned characters.");
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
    const title = document.createElement("span"); title.textContent = label;
    const input = document.createElement(options ? "select" : "input");
    input.dataset.instanceCarouselField = field; input.setAttribute("aria-label", label);
    if (pageId) input.dataset.carouselPageId = pageId;
    if (!options) { input.type = "number"; input.placeholder = "Use preset default"; }
    for (const option of options ?? []) { const entry = document.createElement("option"); entry.value = String(option.value); entry.textContent = option.label; input.append(entry); }
    for (const [key, value] of Object.entries({ min, max, step })) if (value !== undefined) input[key] = String(value);
    let value = pageId ? layer.carousel?.pageDurations?.[pageId] : layer.carousel?.[field];
    if ((field === "duration" || pageId) && value !== undefined && value !== null) value /= 1000;
    input.value = String(value ?? "");
    const key = `carousel.${layer.id}.${pageId ? `page.${pageId}` : field}`;
    if (this._invalidInputs.has(key)) { input.value = this._invalidInputs.get(key); input.setCustomValidity("Correct this carousel setting before saving."); }
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
        if (value !== null && (!Number.isSafeInteger(value) || value < (isDuration ? 100 : 0) || value > (isDuration ? 3600000 : 10000))) throw new Error(isDuration ? "Enter 0.1–3600 seconds, or leave blank to inherit." : "Enter 0–10000 milliseconds, or leave blank to inherit.");
      }
      if (["loop", "enabled"].includes(field) && value !== null) value = value === "true";
      const carousel = { ...(layer.carousel ?? {}) };
      if (pageId) {
        carousel.pageDurations = { ...(carousel.pageDurations ?? {}) };
        if (value === null) delete carousel.pageDurations[pageId]; else carousel.pageDurations[pageId] = value;
      } else carousel[field] = value;
      Object.assign(layer, validateLayer({ ...layer, carousel }, this._draft.canvas));
      input.setCustomValidity(""); this._invalidInputs.delete(key); this._markDirty();
      void this._updatePreview().then(() => { if (["mode", "actorStartUuid", "startPageId"].includes(field)) this._renderLayerProperties(); });
    } catch (error) {
      input.setCustomValidity(error.message); this._invalidInputs.set(key, input.value); this._markDirty();
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
    const pages = allPages.length ? allPages : (preset?.pages?.length ? [] : [{ id: null, name: "Shared card" }]);
    const firstActor = actors.includes(settings.actorStartUuid) ? settings.actorStartUuid : actors[0];
    const firstPage = pages.find(page => page.id === settings.startPageId) ?? pages[0];
    const actorIds = ["information", "static"].includes(settings.mode) ? (firstActor ? [firstActor] : []) : actors;
    const displayedPages = ["character", "static"].includes(settings.mode) ? (firstPage ? [firstPage] : []) : pages;
    return settings.traversal === "characters-first" ? displayedPages.flatMap(page => actorIds.map(actorUuid => ({ actorUuid, pageId: page.id }))) : actorIds.flatMap(actorUuid => displayedPages.map(page => ({ actorUuid, pageId: page.id })));
  }

  _renderInstanceCarousel(host, layer, preset) {
    const section = document.createElement("section"); section.className = "mso-instance-carousel"; section.setAttribute("aria-label", "Carousel Settings");
    const title = document.createElement("h4"); title.textContent = "Carousel Settings"; section.append(title); host.append(section);
    const inherited = [{ value: "", label: "Use preset default" }];
    this._instanceCarouselField(section, layer, "Cycling Mode", "mode", { options: [...inherited, { value: "static", label: "Static — one character and page" }, { value: "information", label: "Information Only — one character, all pages" }, { value: "character", label: "Character Only — all characters, one page" }, { value: "combined", label: "Combined — all pages for each character" }] });
    this._instanceCarouselField(section, layer, "Automatic playback", "enabled", { options: [...inherited, { value: "true", label: "Play automatically" }, { value: "false", label: "Start paused" }] });
    this._instanceCarouselField(section, layer, "Traversal Order", "traversal", { options: [...inherited, { value: "pages-first", label: "Pages First — A/1, A/2, B/1, B/2" }, { value: "characters-first", label: "Characters First — A/1, B/1, A/2, B/2" }] });
    const assignedTitle = document.createElement("h5"); assignedTitle.textContent = "Assigned Characters"; section.append(assignedTitle);
    const assigned = document.createElement("div"); assigned.className = "mso-carousel-assigned"; assigned.dataset.assignedCharacters = ""; assigned.setAttribute("aria-label", "Assigned Characters — drop Foundry Actors here"); section.append(assigned);
    const characters = this._assignedCharacters(layer), labels = new Map(), actorNodes = [];
    const addButton = (parent, label, operation, disabled = false) => {
      const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.disabled = this._uploading || disabled;
      button.addEventListener("click", () => { void this._draftOperation(operation); }); parent.append(button); return button;
    };
    if (!characters.length) { const empty = document.createElement("p"); empty.className = "mso-help"; empty.textContent = "No characters assigned. Add a character or drop an Actor here."; assigned.append(empty); }
    characters.forEach((uuid, index) => {
      const row = document.createElement("div"); row.className = "mso-carousel-order-row";
      const name = document.createElement("span"); name.textContent = `Character ${index + 1} — loading…`; actorNodes.push([uuid, name]); row.append(name);
      if (layer.dataSource !== "demo") addButton(row, `Select Actor ${index + 1}`, () => this._replaceCarouselActor(layer, uuid));
      addButton(row, `Preview Character ${index + 1}`, () => this._previewAssignedActor(layer, uuid));
      addButton(row, `Earlier character ${index + 1}`, () => this._carouselCharacterCommand(layer, uuid, "up"), index === 0);
      addButton(row, `Later character ${index + 1}`, () => this._carouselCharacterCommand(layer, uuid, "down"), index === characters.length - 1);
      addButton(row, `Remove character ${index + 1}`, () => this._carouselCharacterCommand(layer, uuid, "remove")); assigned.append(row);
    });
    if (layer.dataSource === "demo") addButton(assigned, "Restore demo characters", async () => { this._setCarouselCharacters(layer, [...DEMO_ACTOR_UUIDS]); await this._updatePreview(); this._renderLayerProperties(); }, DEMO_ACTOR_UUIDS.every(uuid => characters.includes(uuid)));
    else addButton(assigned, "Add Character", () => this._addCarouselActor(), characters.length >= 20);
    const initialActor = this._instanceCarouselField(section, layer, "Initial Actor", "actorStartUuid", { options: [{ value: "", label: "First assigned character" }, ...characters.map((uuid, index) => ({ value: uuid, label: `Character ${index + 1}` }))] });
    const pagesTitle = document.createElement("h5"); pagesTitle.textContent = "Information Page Order"; section.append(pagesTitle);
    const pages = this._orderedCarouselPages(layer, preset);
    if (layer.carousel?.pageOrder?.length) addButton(section, "Use preset page order", async () => {
      Object.assign(layer, validateLayer({ ...layer, carousel: { ...layer.carousel, pageOrder: [] } }, this._draft.canvas));
      this._markDirty(); await this._updatePreview(); this._renderLayerProperties();
    });
    if (!pages.length) { const shared = document.createElement("p"); shared.className = "mso-help"; shared.textContent = "This design has a single shared card. Add information pages in the Widget Designer to cycle information."; section.append(shared); }
    pages.forEach((page, index) => {
      const row = document.createElement("div"); row.className = "mso-carousel-page-row";
      const name = document.createElement("strong"); name.textContent = `${index + 1}. ${page.name}${page.enabled === false ? " (disabled in preset)" : ""}`; row.append(name);
      const buttons = document.createElement("div"); buttons.className = "mso-page-actions"; row.append(buttons);
      addButton(buttons, `Earlier page ${index + 1}`, () => this._instancePageOrder(layer, preset, page.id, -1), index === 0);
      addButton(buttons, `Later page ${index + 1}`, () => this._instancePageOrder(layer, preset, page.id, 1), index === pages.length - 1);
      this._instanceCarouselField(row, layer, `${page.name} duration (seconds; blank inherits)`, "duration", { pageId: page.id, min: .1, max: 3600, step: .1 }); section.append(row);
    });
    this._instanceCarouselField(section, layer, "Initial information page", "startPageId", { options: [...inherited, ...pages.filter(page => page.enabled !== false).map(page => ({ value: page.id, label: page.name }))] });
    this._instanceCarouselField(section, layer, "Page Duration (seconds; blank inherits)", "duration", { min: .1, max: 3600, step: .1 });
    const transitionOptions = [...inherited, ...PAGE_TRANSITIONS.map(entry => ({ value: entry.id, label: entry.label }))];
    this._instanceCarouselField(section, layer, "Page Transition", "transition", { options: transitionOptions });
    this._instanceCarouselField(section, layer, "Page transition duration (milliseconds; blank inherits)", "transitionDuration", { min: 0, max: 10000, step: 1 });
    this._instanceCarouselField(section, layer, "Character Transition", "characterTransition", { options: transitionOptions });
    this._instanceCarouselField(section, layer, "Character transition duration (milliseconds; blank inherits)", "characterTransitionDuration", { min: 0, max: 10000, step: 1 });
    this._instanceCarouselField(section, layer, "Loop", "loop", { options: [...inherited, { value: "true", label: "Loop" }, { value: "false", label: "Stop after the last step" }] });
    const previewTitle = document.createElement("h5"); previewTitle.textContent = "Preview Sequence"; section.append(previewTitle);
    const sequence = document.createElement("ol"); sequence.className = "mso-carousel-sequence"; sequence.setAttribute("aria-label", "Preview Sequence"); section.append(sequence);
    const status = document.createElement("p"); status.className = "mso-help"; status.setAttribute("role", "status"); section.append(status);
    const controls = document.createElement("div"); controls.className = "mso-page-actions"; section.append(controls);
    for (const [label, command] of [["Previous step", "previous"], ["Next step", "next"], ["Pause preview", "pause"], ["Resume preview", "resume"], ["Reset preview", "reset"]]) addButton(controls, label, () => this._instanceCarouselPreview(layer.id, command), !preset);
    const note = document.createElement("p"); note.className = "mso-help"; note.textContent = "Preview controls affect this editor only. Save to apply configuration to OBS. Display duration starts after each transition completes. Empty duration and transition fields inherit the shared preset."; section.append(note);
    this._carouselPanel = { layerId: layer.id, layer, preset, labels, sequence, status };
    this._syncInstanceCarouselPreview();
    this._animationTestPanel?.refreshDiagnostics?.();
    const generation = this._carouselLabelsGeneration;
    void Promise.all(characters.map(async (uuid, index) => {
      try { const result = await this.characterData?.resolve(uuid, ["character.name"]); return [uuid, result?.warning ? `Character ${index + 1} — unavailable` : String(result?.values?.["character.name"] ?? `Character ${index + 1}`)]; }
      catch { return [uuid, `Character ${index + 1} — unavailable`]; }
    })).then(entries => {
      if (generation !== this._carouselLabelsGeneration || this._selectedLayerId !== layer.id) return;
      for (const [uuid, label] of entries) labels.set(uuid, label);
      for (const [uuid, node] of actorNodes) node.textContent = labels.get(uuid);
      for (const option of initialActor.children) if (labels.has(option.value)) option.textContent = labels.get(option.value);
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
      const name = panel.labels.get(step.actorUuid) ?? `Character ${actorIndex + 1}`;
      const page = panel.preset?.pages?.find(entry => entry.id === step.pageId);
      item.textContent = `${name} / ${page?.name ?? "Shared card"}`;
      if (step.actorUuid === state?.activeActorUuid && step.pageId === state?.activePageId) item.setAttribute("aria-current", "step");
      panel.sequence.append(item);
    }
    const activeName = panel.labels.get(state?.activeActorUuid), activePage = panel.preset?.pages?.find(page => page.id === state?.activePageId)?.name;
    panel.status.textContent = !sequence.length ? "No available character/page steps. Assign a character and enable an information page." : state ? `Local preview${activeName ? `: ${activeName} / ${activePage ?? "Shared card"}` : ""} — ${state.paused ? "paused" : "running"}. ${sequence.length} sequence steps.` : `${sequence.length} configured sequence steps. Local preview uses current Actor permissions and skips unavailable data where configured.`;
  }

  _onLayerInput(event) {
    if (this._busy || this._uploading) return;
    const layer = this._selectedLayer();
    if (!layer) return;
    const input = event.currentTarget;
    const field = input.dataset.layerField;
    const numeric = new Set(["x", "y", "width", "height", "rotation", "opacity", "fontSize", "borderRadius"]);
    const allowed = new Set(["name", "x", "y", "width", "height", "rotation", "opacity", "visible", "locked", "src", "fit", "lockAspectRatio", "text", "fontFamily", "fontSize", "fontWeight", "color", "align", "shadow", "binding", "maxBinding", "fallback", "portraitSource", "circular", "borderRadius", "foregroundColor", "backgroundColor", "showValue"]);
    if (!allowed.has(field)) return;
    let value = input.type === "checkbox" ? input.checked : input.value;
    if (numeric.has(field)) value = input.value.trim() === "" ? NaN : Number(input.value);
    try {
      const patch = { [field]: value };
      if (field === "binding" && layer.text === `{${layer.binding}}`) patch.text = `{${value}}`;
      const validated = validateLayer({ ...layer, ...patch }, this._draft.canvas, this._editingLayers().indexOf(layer));
      Object.assign(layer, validated);
      input.setCustomValidity("");
      this._invalidInputs.delete(`layer.${layer.id}.${field}`);
      this._markDirty();
      this._syncLayerFields(layer, { skip: input });
      this._updateLayerRow(layer);
      void this._updatePreview();
    }
    catch (error) {
      input.setCustomValidity(error.message);
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
      input.setCustomValidity("");
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
      for (const [command, active, yes, no] of [["visible", layer.visible, "Visible", "Hidden"], ["locked", !!layer.locked, "Locked", "Unlocked"]]) {
        const button = row.querySelector(`[data-layer-command="${command}"]`);
        if (!button) continue;
        button.textContent = active ? yes : no;
        button.title = button.textContent;
        button.setAttribute("aria-label", button.textContent);
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
        input.setCustomValidity("Enter a whole number from 64 to 7680.");
        this._markDirty();
        return;
      }
      this._invalidInputs.delete(field);
      input.setCustomValidity("");
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
    if (status) status.textContent = "Unsaved changes";
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
        message.textContent = `Preview: ${error.message}`;
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
      ui.notifications.info("Wait for the background upload to finish.");
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
      ui.notifications.error(failure.message || "The overlay could not be updated.");
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
    label.textContent = "Name";
    const input = document.createElement("input");
    input.type = "text";
    input.name = "name";
    input.required = true;
    input.maxLength = 80;
    input.setAttribute("value", initial);
    input.autofocus = true;
    label.append(input);
    content.append(label);
    const result = await DialogV2.input({ window: { title }, content, modal: true, rejectClose: false });
    if (!result) return null;
    const name = result.name?.trim();
    if (!name) throw new Error("Enter a name.");
    return name;
  }

  async _confirm(title, text, label = "Continue") {
    const content = document.createElement("div");
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    content.append(paragraph);
    return DialogV2.confirm({ window: { title }, content, yes: { label }, modal: true, rejectClose: false });
  }

  async _discardDraft() {
    if (this._uploading) {
      ui.notifications.info("Wait for the background upload to finish.");
      return false;
    }
    return !this._dirty || await this._confirm("Unsaved overlay changes", "Discard the changes in this preview?", "Discard changes");
  }

  async _editOverlay(target) {
    if (target.dataset.overlayId === this._draft?.id || !await this._discardDraft()) return;
    const state = this.store.getState();
    this._loadDraft(state.overlays.find(overlay => overlay.id === target.dataset.overlayId), state.revision);
  }

  async _createOverlay() {
    if (!await this._discardDraft()) return;
    const name = await this._name("Create overlay", "New overlay");
    if (!name) return;
    this._loadDraft(await this.store.createOverlay(name));
  }

  async _renameOverlay() {
    if (!this._draft) return;
    const name = await this._name("Rename overlay", this._draft.name);
    if (!name) return;
    // Renaming is part of the draft; Save publishes all changes together.
    this._draft.name = name;
    this._markDirty();
  }

  async _deleteOverlay() {
    if (!this._draft) return;
    if (!await this._confirm("Delete overlay", `Delete “${this._draft.name}” and its saved configuration?`, "Delete overlay")) return;
    await this.store.deleteOverlay(this._draft.id);
    const state = this.store.getState();
    this._loadDraft(this._initialOverlay(state), state.revision);
  }

  _validateInputs() {
    const invalid = [...this.element.querySelectorAll("[data-draft-field], [data-layer-field], [data-instance-carousel-field]")].find(input => input.checkValidity?.() === false);
    if (invalid) {
      invalid.reportValidity();
      throw new Error("Correct the highlighted canvas, background, or layer property before saving.");
    }
    if (this._invalidInputs.size) throw new Error("Correct the invalid property entries before saving. Select the affected layer or reload the saved overlay.");
  }

  async _saveOverlay() {
    if (!this._draft) return;
    this._validateInputs();
    const saved = await this.store.saveOverlay(clone(this._draft), { expectedRevision: this._loadedRevision });
    this._loadDraft(saved);
    ui.notifications.info("Overlay saved. The active overlay updates automatically in OBS.");
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
      ui.notifications.info("Wait for the current overlay operation to finish.");
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
      if (!path) throw new Error("Foundry did not return an uploaded image path.");
      if (!this.rendered || this._draft !== draft || this._draft.id !== overlayId) {
        ui.notifications.warn("The image was uploaded, but the overlay changed. Browse Existing to select it.");
        return;
      }
      await this._applyBackground(path);
      ui.notifications.info("Background uploaded to the preview. Save overlay to publish it to OBS.");
    }
    catch (error) {
      throw new Error(`Background upload failed: ${error.message || "Try the image again."}`, { cause: error });
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
      ui.notifications.info("Wait for the current overlay operation to finish.");
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
      if (!path) throw new Error("Foundry did not return an uploaded image path.");
      const layer = this._allLayers().find(entry => entry.id === target.layerId && entry.type === "image");
      if (!this.rendered || this._draft !== target.draft || this._draft.id !== target.overlayId || !layer) {
        ui.notifications.warn("The image was uploaded, but the layer changed. Browse existing to select it.");
        return;
      }
      await this._applyImage(layer, path);
      ui.notifications.info("Image uploaded to the preview. Save overlay to publish it to OBS.");
    }
    catch (error) { throw new Error(`Image upload failed: ${error.message || "Try the image again."}`, { cause: error }); }
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
      status.textContent = this._uploading ? `Uploading ${this._uploadKind === "image" ? "image" : "background"}…` : "";
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
    if (pathLabel) pathLabel.textContent = path || "No image selected";
    if (!image || !message) return;
    const generation = ++this._thumbnailGeneration;
    image.hidden = true;
    image.removeAttribute("src");
    message.hidden = false;
    message.textContent = path ? "Loading image…" : "No background image";
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
        message.textContent = "Image unavailable";
        message.hidden = false;
      };
      image.src = foundry.utils.getRoute(src);
    }
    catch {
      message.textContent = "Image unavailable";
    }
  }

  async _savePreset() {
    if (!this._draft) return;
    this._validateInputs();
    const name = await this._name("Save configuration as preset", this._draft.name);
    if (!name) return;
    const preset = await this._sideMutation(options => this.store.savePreset(clone(this._draft), name, options));
    this._selectedPresetId = preset.id;
    // The preset save does not modify the persisted overlay; preserve its private draft.
    ui.notifications.info("Preset saved.");
  }

  async _loadPreset() {
    if (!this._selectedPresetId || !await this._discardDraft()) return;
    const saved = await this.store.loadPreset(this._selectedPresetId, this._draft?.id ?? null);
    this._loadDraft(saved);
    ui.notifications.info("Preset loaded and saved to the selected overlay.");
  }

  _selectedPreset() { return this.store.listPresets().find(preset => preset.id === this._selectedPresetId); }

  async _renamePreset() {
    const preset = this._selectedPreset();
    if (!preset || preset.builtin) return;
    const name = await this._name("Rename preset", preset.name);
    if (name) await this._sideMutation(options => this.store.renamePreset(preset.id, name, options));
  }

  async _duplicatePreset() {
    const preset = this._selectedPreset();
    if (!preset) return;
    const name = await this._name("Duplicate preset", `${preset.name.slice(0, 75)} copy`);
    if (!name) return;
    const copy = await this._sideMutation(options => this.store.duplicatePreset(preset.id, name, options));
    this._selectedPresetId = copy.id;
  }

  async _deletePreset() {
    const preset = this._selectedPreset();
    if (!preset || preset.builtin) return;
    if (!await this._confirm("Delete preset", `Delete the custom preset “${preset.name}”?`, "Delete preset")) return;
    await this._sideMutation(options => this.store.deletePreset(preset.id, options));
    this._selectedPresetId = "builtin-transparent";
  }

  async _saveViewer() {
    const value = this.element.querySelector('[name="viewerUserId"]')?.value ?? "";
    await this.api.setViewerUserId(value);
    ui.notifications.info("OBS viewer saved.");
  }

  async _copyURL() {
    const input = this.element.querySelector('[name="obsURL"]');
    if (!input?.value) return;
    try {
      await navigator.clipboard.writeText(input.value);
      ui.notifications.info("OBS browser source URL copied.");
    }
    catch {
      input.focus();
      input.select();
      ui.notifications.info("The URL is selected. Copy it with Ctrl+C.");
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
