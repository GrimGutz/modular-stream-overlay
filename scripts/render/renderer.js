import { validateOverlay, validateLayer, validateWidgetPreset, validateAssetPath, clone } from "../core/schema.js";
import { widgetPresetToOverlay } from "../core/widget-presets.js";
import { isCharacterComponent, mountCharacterComponent } from "./character-components.js";
import { LayerMotion, effectiveWidgetMotion } from "./motion.js";
import { validateAnimationSettings } from "../animation/schema.js";
import { WidgetCarousel } from "./carousel.js";
import { ActorCarousel } from "./actor-carousel.js";
import { resolveCarouselSettings } from "../carousel/schema.js";
import { applyBoxStyle, createTextElement, gradientFill, keepFitted, markupLines, usesSpans, writeTextContent } from "./text.js";
import { bindVoice } from "./voice.js";

/** A layer's own cleanup list that also records into the scene's pending list as it grows. */
function trackedList(sink) {
  const list = [];
  list.push = (...items) => { sink.push(...items); return Array.prototype.push.apply(list, items); };
  return list;
}

function coordinated(instance, preset, settings = resolveCarouselSettings(instance, preset)) {
  return settings.actors.length !== 1 || settings.settings.mode !== "information"
    || (preset.pages?.length > 0 && settings.pages.length === 0);
}

/** A DOM renderer shared by preview and broadcast. It never reads Foundry Documents. */
export class OverlayRenderer {
  constructor(container, { widgets, context = {}, preview = false, resolveAsset = defaultAssetURL, onLayout, viewportSize = null, stretch = false } = {}) {
    this.container = container;
    this.widgets = widgets;
    this.context = { ...context, mode: preview ? "preview" : "broadcast" };
    this.resolveAsset = resolveAsset;
    this.onLayout = onLayout;
    this.viewportSize = viewportSize;
    this.stretch = stretch;
    this.compositions = new Map();
    this.motions = new Map();
    this.rootMotion = null;
    this.carousel = null;
    this.pageEditing = null;
    this.fixedScale = null;
    this.layout = null;
    this.layerElements = new Map();
    this.generation = 0;
    this.instances = [];
    this.pendingScenes = new Map();
    this.root = null;
    this.initialized = false;
    this.disposed = false;
    this.container.classList.add("mso-viewport");
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(container);
  }

  /** Replace the scene atomically. Failed widgets cannot remove the background or other widgets. */
  async render(input, { animateExit = false } = {}) {
    if (this.disposed) return;
    const generation = ++this.generation;
    for (const pending of this.pendingScenes.values()) this.cleanup(pending);
    this.pendingScenes.clear();
    const overlay = input ? validateOverlay(input) : null;
    const previous = this.overlay;
    const wasInitialized = this.initialized;
    this.initialized = true;
    // Saved visibility changes may animate out while retaining the old mounted scene.
    if (previous && (overlay || animateExit)) {
      for (const motion of this.motions.values()) motion.controller.stop("visibility");
      const departing = [...this.motions.entries()].filter(([id, motion]) => motion.effectiveVisible()
        && (!overlay || previous.id !== overlay.id || !overlay.layers.some(layer => layer.id === id && layer.visible)));
      if (departing.length) await Promise.all(departing.map(([, motion]) => motion.exit()));
      if (this.disposed || generation !== this.generation) return;
    }
    if (!overlay) {
      this.cleanup(this.instances);
      this.instances = [];
      this.root = null;
      this.overlay = null;
      this.layerElements.clear();
      this.compositions.clear();
      this.motions.clear(); this.rootMotion = null; this.carousel = null;
      this.mounted = null; this.rootInstances = []; this.sceneKey = null;
      this.container.replaceChildren();
      return;
    }

    // The same scene with changed layers: keep every unchanged layer running (carousels,
    // images, animations) and rebuild or move only what changed.
    if (this.canUpdateInPlace(overlay)) return this.renderChanges(overlay, previous, generation);

    let backgroundElement = null;
    const root = document.createElement("div");
    root.className = "mso-stage";
    root.style.width = `${overlay.canvas.width}px`;
    root.style.height = `${overlay.canvas.height}px`;
    root.setAttribute("aria-label", overlay.name);
    if (overlay.background.src) {
      const background = this.image(overlay.background.src, overlay.background.fit);
      background.className = "mso-background";
      background.style.opacity = String(overlay.background.opacity);
      root.append(background);
      backgroundElement = background;
    }

    const elements = [
      ...overlay.layers.map(value => ({ kind: "layer", value })),
      ...overlay.widgets.map(value => ({ kind: "widget", value }))
    ].sort((a, b) => a.value.z - b.value.z);
    const instances = [];
    this.pendingScenes.set(generation, instances);
    const layerElements = new Map();
    const compositions = new Map();
    const motions = new Map();
    const mounted = new Map();
    // Closures below look the carousel up here, so it can be created after the layers.
    const scene = { carousel: null };
    const rootMotion = new LayerMotion({ element: root, layer: { ...overlay, visible: true }, context: this.context,
      resolveTarget: id => motions.get(id) ?? scene.carousel?.findMotion(id) });
    const rootInstances = [{ definition: { destroy: () => rootMotion.destroy(this.disposed ? "destroyed" : "render-interrupted") }, args: {} }];
    instances.push(...rootInstances);
    for (const { kind, value } of elements) {
      if (kind === "layer") {
        const pendingMount = this.mountLayer(value, { overlay, rootMotion, motions, compositions, scene, sink: instances });
        const mount = pendingMount instanceof Promise ? await pendingMount : pendingMount;
        if (this.disposed || generation !== this.generation) { this.cleanup(instances); return; }
        root.append(mount.element);
        layerElements.set(value.id, mount.element);
        motions.set(value.id, mount.motion);
        if (mount.composition) compositions.set(value.id, mount.composition);
        mounted.set(value.id, { key: this.layerKey(value), instances: mount.instances, element: mount.element });
        continue;
      }
      if (!value.visible) continue;
      const element = document.createElement("div");
      element.className = "mso-widget";
      element.dataset.instanceId = value.id;
      applyGeometry(element, value);
      applyBoxStyle(element, value, this.resolveAsset);
      root.append(element);
      const start = instances.length;
      await this.renderRegisteredWidget(element, value, overlay, instances);
      rootInstances.push(...instances.slice(start));
      if (this.disposed || generation !== this.generation) {
        this.cleanup(instances);
        return;
      }
    }
    if (this.disposed || generation !== this.generation) {
      this.cleanup(instances);
      return;
    }
    this.fit(root, overlay);
    let carousel = null;
    if (overlay.pages.length) {
      carousel = scene.carousel = new WidgetCarousel({ root, overlay, context: this.context, parentMotion: rootMotion,
        editing: this.pageEditing, resolveMotion: id => motions.get(id),
        createRenderer: (element, context) => new OverlayRenderer(element, { widgets: this.widgets,
          resolveAsset: this.resolveAsset, context, preview: this.context.mode === "preview",
          viewportSize: overlay.canvas }) });
      const entry = { definition: { destroy: () => carousel.destroy() }, args: {} };
      instances.push(entry); rootInstances.push(entry);
      await carousel.mount();
      if (this.disposed || generation !== this.generation) { this.cleanup(instances); return; }
    }
    await Promise.all([...motions.values()].map(motion => motion.start()));
    await rootMotion.start();
    if (this.disposed || generation !== this.generation) { this.cleanup(instances); return; }
    this.cleanup(this.instances);
    this.pendingScenes.delete(generation);
    this.instances = instances;
    this.rootInstances = rootInstances;
    this.mounted = mounted;
    this.scene = scene;
    this.sceneKey = this.overlayKey(overlay);
    this.backgroundElement = backgroundElement;
    this.root = root;
    this.overlay = overlay;
    this.layerElements = layerElements;
    this.compositions = compositions;
    this.motions = motions; this.rootMotion = rootMotion; this.carousel = carousel;
    this.container.replaceChildren(root);
    this.fit();
    // A configured entrance is presentation, not a historical Actor event. Play it
    // only after the outer scene is attached; prepared nested cards stay gated.
    if (!wasInitialized && !this.context.deferEntrances) for (const motion of motions.values()) {
      if (motion.layer.visible && motion.settings.entrance) motion.enter({ fire: false });
    }
    // Saved live changes may fire intentional visibility events; cold data snapshots never do.
    if (wasInitialized) for (const [id, motion] of motions) this.announceChange(motion, previous?.id === overlay.id ? previous.layers.find(layer => layer.id === id) : null);
  }

  /** A shown layer enters; a changed one transitions its opacity and color. */
  announceChange(motion, before) {
    if (motion.layer.visible && !before?.visible) motion.enter();
    else if (before && motion.layer.visible) this.transitionStyle(motion, before);
  }

  /** What rebuilds the whole stage: the canvas, background, scene-wide motion, pages and legacy widgets. */
  overlayKey(overlay) {
    const { id, canvas, background, animations, triggers, pages, cycling, widgets } = overlay;
    return JSON.stringify({ id, canvas, background, animations, triggers, pages, cycling, widgets });
  }

  /**
   * What rebuilds one layer. Position, size, rotation, opacity and stacking update in place;
   * editor-only fields (name, lock, group) never rebuild anything.
   */
  layerKey(value) {
    const { x, y, width, height, rotation, opacity, z, name, locked, groupId, groupName, ...content } = value;
    let preset = null;
    if (value.type === "character-widget") {
      try { preset = this.context.widgetPresets?.list?.().find(item => item.id === value.presetId) ?? null; }
      catch { preset = { unreadable: (this.unreadableLibraries = (this.unreadableLibraries ?? 0) + 1) }; }
    }
    return JSON.stringify({ content, preset, previewActorUuid: this.context.previewActorUuid ?? null, actorUuid: this.context.actorUuid ?? null });
  }

  canUpdateInPlace(overlay) {
    return !!(this.root && this.mounted && this.overlay && !this.overlay.widgets.length && !overlay.widgets.length && this.sceneKey === this.overlayKey(overlay));
  }

  /**
   * Build one layer's element, motion and content off-stage. Static layers finish at once;
   * loading content returns a promise.
   */
  mountLayer(value, { overlay, rootMotion, motions, compositions, scene, sink }) {
    // Recorded in the scene's pending list at once, so clearing the output mid-load cleans it up.
    const instances = trackedList(sink);
    const element = document.createElement("div");
    element.className = "mso-layer";
    element.dataset.instanceId = value.id;
    applyGeometry(element, value);
    applyBoxStyle(element, value, this.resolveAsset);
    let appearance = value;
    if (value.type === "character-widget") {
      try {
        const preset = this.context.widgetPresets?.list().find(item => item.id === value.presetId);
        appearance = { ...value, ...effectiveWidgetMotion(value, preset) };
        if (preset && coordinated(value, preset)) appearance.triggers = [];
      } catch { /* A bad library is isolated by the content renderer below. */ }
    }
    const motion = new LayerMotion({ element, layer: appearance, context: { ...this.context,
      parentMotion: rootMotion,
      inheritedTransition: this.context.inheritedTransition ?? overlay.animations.transition },
      resolveTarget: id => value.type === "character-widget" ? compositions.get(value.id)?.findMotion(id)
        : motions.get(id) ?? scene.carousel?.findMotion(id) ?? this.context.resolveMotion?.(id) });
    instances.push({ definition: { destroy: () => motion.destroy(this.disposed ? "destroyed" : "render-interrupted") }, args: {} });
    // A character card follows the character it shows now; a component in a design, its card's character.
    const shown = { composition: null };
    const voice = bindVoice(element, value, this.context.voice, () => value.type === "character-widget"
      ? shown.composition?.getState?.().activeActorUuid ?? value.actorUuids?.[0] ?? ""
      : this.context.actorUuid || this.context.previewActorUuid || "", this.context.characterData);
    if (voice) instances.push({ definition: { destroy: () => voice.destroy() }, args: {} });
    if (["image", "color", "text"].includes(value.type)) {
      this.renderStaticLayer(element, value);
      return { element, motion, composition: null, instances };
    }
    return this.mountContent(value, overlay, { element, motion, instances, voice, shown });
  }

  async mountContent(value, overlay, { element, motion, instances, voice = null, shown = {} }) {
    let composition = null;
    try {
      if (isCharacterComponent(value.type)) {
        const binding = mountCharacterComponent({ element, layer: value, context: this.context, resolveAsset: this.resolveAsset, motion });
        motion.numberAnimator = binding.animateNumber;
        instances.push({ definition: { destroy: () => binding.destroy() }, args: {} });
        await binding.ready;
      } else if (value.type === "character-widget") {
        composition = await this.renderCharacterWidget(element, value, instances, motion, () => voice?.refresh());
        shown.composition = composition;
        voice?.refresh();
      } else {
        // Extension types continue through the established widget registry below.
        await this.renderRegisteredWidget(element, value, overlay, instances);
      }
    } catch (error) {
      // The motion (and the voice binding, which keeps the empty frame glowing) stay with the element.
      this.cleanup(instances.splice(voice ? 2 : 1));
      element.replaceChildren();
      if (this.context.mode === "preview") element.textContent = "Widget content unavailable";
      console.error(`Modular Stream Overlay | Layer ${value.id} failed`, error);
    }
    return { element, motion, composition, instances };
  }

  /**
   * Update the mounted scene: rebuild changed layers off-stage, then swap them in, drop removed
   * layers, and apply position, size, rotation, opacity and order to the rest.
   */
  async renderChanges(overlay, previous, generation) {
    const pending = [];
    this.pendingScenes.set(generation, pending);
    const prepared = new Map();
    for (const value of overlay.layers) {
      if (this.mounted.get(value.id)?.key === this.layerKey(value)) continue;
      const pendingMount = this.mountLayer(value, { overlay, rootMotion: this.rootMotion, motions: this.motions, compositions: this.compositions, scene: this.scene, sink: pending });
      const mount = pendingMount instanceof Promise ? await pendingMount : pendingMount;
      if (this.disposed || generation !== this.generation) { this.cleanup(pending); return; }
      prepared.set(value.id, mount);
    }
    await Promise.all([...prepared.values()].map(mount => mount.motion.start()));
    if (this.disposed || generation !== this.generation) { this.cleanup(pending); return; }
    const present = new Set(overlay.layers.map(layer => layer.id));
    for (const [id, mount] of this.mounted) {
      if (present.has(id) && !prepared.has(id)) continue;
      this.cleanup(mount.instances);
      mount.element.remove?.();
      this.mounted.delete(id); this.motions.delete(id); this.compositions.delete(id); this.layerElements.delete(id);
    }
    for (const [id, mount] of prepared) {
      this.mounted.set(id, { key: this.layerKey(overlay.layers.find(layer => layer.id === id)), instances: mount.instances, element: mount.element });
      this.motions.set(id, mount.motion);
      if (mount.composition) this.compositions.set(id, mount.composition);
      this.layerElements.set(id, mount.element);
    }
    const ordered = [...overlay.layers].sort((a, b) => a.z - b.z), desired = ordered.map(value => this.layerElements.get(value.id));
    for (const value of ordered) {
      const element = this.layerElements.get(value.id);
      applyGeometry(element, value);
      applyBoxStyle(element, value, this.resolveAsset);
      if (prepared.has(value.id)) continue;
      const motion = this.motions.get(value.id);
      if (motion) Object.assign(motion.layer, { x: value.x, y: value.y, width: value.width, height: value.height, rotation: value.rotation, opacity: value.opacity, z: value.z });
      const composition = this.compositions.get(value.id);
      if (composition && (composition.viewportSize?.width !== value.width || composition.viewportSize?.height !== value.height)) {
        composition.viewportSize = { width: value.width, height: value.height };
        composition.fit();
      }
    }
    // Layers sit after the background and before page content, in stacking order. Unchanged
    // stacking moves nothing, so running effects inside the layers are not disturbed.
    const elements = new Set(desired), children = [...this.root.children];
    const current = children.filter(child => elements.has(child));
    if (current.length !== desired.length || current.some((element, index) => element !== desired[index])) {
      const rest = children.filter(child => child !== this.backgroundElement && !elements.has(child) && child.className !== "mso-layer");
      this.root.replaceChildren(...(this.backgroundElement ? [this.backgroundElement] : []), ...desired, ...rest);
    }
    this.root.setAttribute("aria-label", overlay.name);
    this.pendingScenes.delete(generation);
    this.overlay = overlay;
    this.instances = [...this.rootInstances, ...[...this.mounted.values()].flatMap(mount => mount.instances)];
    this.fit();
    for (const value of overlay.layers) {
      const before = previous?.layers.find(layer => layer.id === value.id);
      const motion = this.motions.get(value.id);
      if (!motion) continue;
      if (prepared.has(value.id)) this.announceChange(motion, before);
      else if (before && before.opacity !== value.opacity && motion.layer.visible) this.transitionStyle(motion, before);
    }
  }

  async renderRegisteredWidget(element, value, overlay, instances) {
    const definition = this.widgets?.get(value.type);
    if (!definition) return;
    const args = { element, config: { ...clone(definition.defaults ?? {}), ...clone(value.config) },
      context: { ...this.context }, overlay: clone(overlay) };
    instances.push({ definition, args });
    try { await definition.render(args); }
    catch (error) { console.error(`Modular Stream Overlay | Widget ${value.type} failed`, error); element.replaceChildren(); }
  }

  async renderCharacterWidget(element, value, instances, motion, onActorChange = () => {}) {
    const preset = this.context.widgetPresets?.list().find(item => item.id === value.presetId);
    if (!preset) {
      if (this.context.mode === "preview") { element.textContent = "Widget preset unavailable"; element.classList.add("mso-widget-placeholder"); }
      return null;
    }
    const design = clone(preset);
    for (const component of [...design.layers, ...(design.pages ?? []).flatMap(page => page.layers)]) Object.assign(component, value.overrides?.[component.id] ?? {});
    const normalized = validateWidgetPreset(design);
    const configuration = resolveCarouselSettings(value, normalized);
    const overlay = widgetPresetToOverlay(normalized);
    overlay.pages = configuration.pages;
    overlay.cycling = { ...configuration.settings };
    const appearance = effectiveWidgetMotion(value, preset);
    if (coordinated(value, design, configuration)) {
      overlay.animations = appearance.animations; overlay.triggers = appearance.triggers;
      const child = new ActorCarousel({ element, overlay, instance: value, hasPages: normalized.pages.length > 0, configuration,
        context: { ...this.context, deferEntrances: true,
          onCarouselChange: state => { this.context.onCarouselChange?.(state); onActorChange(); } }, parentMotion: motion, viewportSize: { width: value.width, height: value.height },
        createRenderer: (host, context) => new OverlayRenderer(host, { widgets: this.widgets, resolveAsset: this.resolveAsset,
          context, preview: this.context.mode === "preview", viewportSize: { width: value.width, height: value.height }, stretch: true }) });
      instances.push({ definition: { destroy: () => child.destroy() }, args: {} });
      await child.mount();
      return child;
    }
    // The group owns preset-level motion; its components retain their own independent rules.
    overlay.animations = validateAnimationSettings(); overlay.triggers = [];
    const child = new OverlayRenderer(element, { widgets: this.widgets, resolveAsset: this.resolveAsset,
      context: { ...this.context, actorUuid: configuration.actors[0] ?? "",
        deferEntrances: true,
        onCarouselChange: state => this.context.onCarouselChange?.({ ...state, layerId: value.id }),
        parentMotion: motion,
        inheritedTransition: effectiveWidgetMotion(value, preset).animations.transition }, preview: this.context.mode === "preview",
      viewportSize: { width: value.width, height: value.height }, stretch: true });
    instances.push({ definition: { destroy: () => child.destroy() }, args: {} });
    await child.render(overlay);
    return child;
  }

  transitionStyle(motion, before) {
    const config = motion.settings.transition;
    if (!config.duration) return;
    if (config.opacity && before.opacity !== motion.layer.opacity) {
      void motion.controller.transitionNumber("style-opacity", before.opacity, motion.layer.opacity, config,
        value => { if (!motion.disposed) motion.element.style.opacity = String(value); });
    }
    if (config.color && before.color && before.color !== motion.layer.color && motion.controller.canPlay()) {
      const element = motion.element.children[0] ?? motion.element;
      try {
        motion.colorAnimation?.cancel?.();
        const animation = element.animate?.([{ color: before.color }, { color: motion.layer.color }], { duration: config.duration, easing: config.easing, fill: "none" });
        if (animation) {
          motion.colorAnimation = animation;
          animation.finished?.then(() => animation.cancel(), () => {}).catch(() => {});
        }
      } catch { /* A browser without color animation uses the latest configured color. */ }
    }
  }

  findMotion(id) { return this.motions.get(id) ?? this.carousel?.findMotion(id) ?? null; }
  setPageEditing(scope) {
    this.pageEditing = scope;
    return this.carousel?.setEditing(scope);
  }
  previewAnimation(id, config) {
    const motion = id === "self" ? this.rootMotion : this.findMotion(id);
    return motion?.preview(config);
  }
  previewTrigger(id, ruleId) {
    const motion = id === "self" ? this.rootMotion : this.compositions.get(id)?.getActiveMotion?.() ?? this.findMotion(id);
    const rule = motion?.rules.find(rule => rule.id === ruleId);
    if (rule) return motion.action({ ...rule, continuous: false }, { type: "preview", values: motion.values,
      previousValues: motion.values, previous: motion.values[rule.field], current: motion.values[rule.field], persistent: false });
  }
  resetAnimations(id = "self") {
    const motion = id === "self" ? this.rootMotion : this.findMotion(id);
    motion?.reset();
    if (id === "self") for (const child of this.motions.values()) child.reset();
    if (id === "self") this.carousel?.resetAnimations();
    const nested = this.compositions.get(id); if (nested) nested.resetAnimations();
  }
  handleAnimationCommand(command) {
    if (!this.overlay || command.overlayId !== this.overlay.id) return false;
    const outerMotion = command.layerId === "self" ? this.rootMotion : this.motions.get(command.layerId);
    const motion = this.compositions.get(command.layerId)?.getActiveMotion?.() ?? outerMotion;
    if (!motion) return false;
    if (command.kind === "carousel") return this.handleCarouselCommand(command);
    if (command.kind === "demo") {
      const layer = this.overlay.layers.find(layer => layer.id === command.layerId);
      const actorUuid = this.compositions.get(command.layerId)?.getState?.().activeActorUuid ?? layer?.actorUuids?.[0] ?? layer?.actorUuid;
      if (layer?.dataSource !== "demo" || !["damage", "healing"].includes(command.action) || !actorUuid || typeof this.context.characterData?.simulateDemo !== "function") return false;
      return this.context.characterData.simulateDemo(actorUuid, command.action) !== false;
    }
    if (command.kind === "entrance") outerMotion.enter();
    else if (command.kind === "exit") void outerMotion.exit();
    else if (command.kind === "reset") this.resetAnimations(command.layerId);
    else if (command.kind === "manual") return motion.manual(command.ruleId, command.id).length > 0;
    else if (command.kind === "event") motion.dispatch(command.eventType, { eventId: command.id });
    // Whole-widget effects belong on its outer geometry surface. Animating the
    // active Actor's fitted stage clips enlargement inside the card's bounds.
    else if (command.kind === "play") void outerMotion.play(command.animation ?? motion.settings.emphasis ?? { type: "pulse", duration: 500 });
    else return false;
    return true;
  }

  /** Local test feedback is separate from command acceptance and OBS delivery. */
  getAnimationTestState(layerId) {
    const motion = layerId === "self" ? this.rootMotion : this.motions.get(layerId);
    if (!motion) return { blockedReason: "detached", entrance: false, exit: false };
    let blockedReason = null;
    if (!(this.context.animationsEnabled?.() ?? true)) blockedReason = "animations-disabled";
    else if (this.context.reducedMotion?.() ?? globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false) blockedReason = "reduced-motion";
    else if (motion.element?.isConnected === false) blockedReason = "detached";
    else if (!motion.effectiveVisible()) blockedReason = "layer-hidden";
    else if (!motion.presentationVisible) blockedReason = "hidden";
    return { blockedReason, entrance: Boolean(motion.settings.entrance), exit: Boolean(motion.settings.exit) };
  }

  handleCarouselCommand({ layerId, action, pageId, actorUuid }) {
    const carousel = this.compositions.get(layerId)?.carousel;
    if (!carousel) return false;
    let operation;
    if (action === "select") {
      if (carousel.canSelect ? !carousel.canSelect(pageId, actorUuid) : !carousel.getState().availablePageIds.includes(pageId)) return false;
      operation = carousel.select(pageId, actorUuid);
    } else if (action === "select-actor") {
      if (!carousel.getState().availableActorUuids?.includes(actorUuid) || !carousel.canSelectActor?.(actorUuid)) return false;
      operation = carousel.selectActor(actorUuid);
    } else if (["next-page", "previous-page", "next-actor", "previous-actor"].includes(action)) {
      const method = { "next-page": "nextPage", "previous-page": "previousPage", "next-actor": "nextActor", "previous-actor": "previousActor" }[action];
      if (typeof carousel[method] !== "function") return false;
      operation = carousel[method]();
    } else if (["next", "previous", "pause", "resume", "reset"].includes(action)) operation = carousel[action]();
    else return false;
    // Acknowledge semantic acceptance immediately; a configured transition can be
    // longer than Foundry's command timeout and owns its own cancellation guards.
    void Promise.resolve(operation).catch(error => console.error("Modular Stream Overlay | Page command", error));
    return true;
  }

  /** Opt-in identifiers and status only. No Actor values or document errors leave this renderer. */
  getDiagnostics() {
    if (!this.context.debug?.() || !this.overlay) return [];
    return [...this.compositions].map(([instanceId, composition]) => {
      const instance = this.overlay.layers.find(layer => layer.id === instanceId);
      const preset = this.context.widgetPresets?.list().find(preset => preset.id === instance.presetId);
      const configuration = resolveCarouselSettings(instance, preset);
      const state = composition.getState?.() ?? composition.carousel?.getState?.() ?? {};
      const child = composition.activeSlot?.renderer ?? composition;
      const motions = child.diagnosticMotions?.() ?? [];
      motions.push(this.motions.get(instanceId), composition.activeSlot?.gate);
      const diagnostic = motions.filter(Boolean).map(motion => motion.diagnostics);
      const latest = key => diagnostic.map(value => value[key]).filter(Boolean).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0] ?? null;
      const unavailable = composition.snapshots ? [...composition.snapshots].filter(([, snapshot]) => !snapshot.available).map(([uuid]) => uuid) : [];
      return { instanceId, presetId: instance.presetId,
        actorUuid: state.activeActorUuid ?? configuration.actors[0] ?? null,
        pageId: state.activePageId ?? null, pageIndex: state.pageIndex ?? configuration.pages.findIndex(page => page.id === state.activePageId),
        mode: state.mode ?? configuration.settings.mode, paused: state.paused ?? true, running: state.running ?? false,
        transitioning: state.transitioning ?? false, nextTransitionInMs: state.running ? state.remaining : null,
        lastTrigger: latest("lastTrigger"), lastAnimation: latest("lastAnimation"),
        playback: diagnostic.flatMap(value => value.playback ?? []).sort((a, b) => a.at - b.at).slice(-16),
        missingBindings: [...new Set(diagnostic.flatMap(value => value.missingBindings))],
        resolutionError: unavailable.length > 0 || diagnostic.some(value => value.resolutionError), unavailableActorUuids: unavailable };
    });
  }

  diagnosticMotions() {
    const result = [this.rootMotion, ...this.motions.values()].filter(Boolean);
    for (const view of this.carousel?.views?.values?.() ?? []) result.push(view.gate, ...view.renderer.diagnosticMotions());
    return result;
  }

  renderStaticLayer(element, value) {
    if (value.type === "image" && value.src) element.append(this.image(value.src, value.fit));
    else if (value.type === "color") {
      element.style.backgroundColor = value.color;
      element.style.backgroundImage = gradientFill(value);
    }
    else if (value.type === "text") {
      const text = createTextElement(value);
      writeTextContent(text, value, usesSpans(value) ? markupLines(value.text, value.richText) : value.text);
      element.append(text);
      keepFitted(text, value);
    }
  }

  /** Patch geometry during direct manipulation without replacing the stage or widgets. */
  updateLayer(input) {
    if (!this.overlay || this.disposed) return;
    const value = validateLayer(input, this.overlay.canvas);
    const element = this.layerElements.get(value.id);
    if (!element && this.carousel?.updateLayer(value)) return;
    if (element) { applyGeometry(element, value); applyBoxStyle(element, value, this.resolveAsset); }
    const composition = this.compositions.get(value.id);
    if (composition) { composition.viewportSize = { width: value.width, height: value.height }; composition.fit(); }
    const index = this.overlay.layers.findIndex(layer => layer.id === value.id);
    if (index >= 0) this.overlay.layers[index] = value;
  }

  /** Only editor instances set a fixed native-pixel scale. OBS keeps fit-to-viewport behavior. */
  setScale(scale) {
    if (scale !== null && (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0 || scale > 8)) {
      throw new TypeError("Preview scale must be positive and at most 8.");
    }
    this.fixedScale = scale;
    this.fit();
  }

  /** Explicit update entry point for future normalized live-data providers. No documents are broadcast. */
  async update(data) {
    for (const instance of [...this.instances]) {
      try { await instance.definition.update?.({ ...instance.args, data: clone(data) }); }
      catch (error) { console.error("Modular Stream Overlay | Widget update failed", error); }
    }
  }

  image(src, fit = "cover") {
    const image = document.createElement("img");
    image.alt = "";
    image.draggable = false;
    image.style.objectFit = fit === "stretch" ? "fill" : fit;
    image.addEventListener("error", () => { image.style.visibility = "hidden"; });
    image.src = this.resolveAsset(validateAssetPath(src));
    return image;
  }

  fit(root = this.root, overlay = this.overlay) {
    if (!root || !overlay) return;
    const { width, height } = overlay.canvas;
    const bounds = this.viewportSize ?? this.container.getBoundingClientRect();
    const scale = this.fixedScale ?? Math.min(bounds.width / width, bounds.height / height);
    const transform = this.stretch ? `scale(${bounds.width / width}, ${bounds.height / height})` : `scale(${Math.max(0, scale)})`;
    const changed = root.style.transform !== transform;
    root.style.transform = transform;
    if (this.stretch) {
      root.style.left = "0px"; root.style.top = "0px";
      if (changed && root === this.root) { this.rootMotion?.controller.reset(); this.rootMotion?.refreshPreferences(); }
      return;
    }
    root.style.left = `${Math.max(0, (bounds.width - width * scale) / 2)}px`;
    root.style.top = `${Math.max(0, (bounds.height - height * scale) / 2)}px`;
    if (root !== this.root) return;
    // A zoom change cancels local previews and rebuilds current continuous effects
    // against the new stage transform, preserving native canvas geometry.
    if (changed) { this.rootMotion?.controller.reset(); this.rootMotion?.refreshPreferences(); }
    this.layout = { scale, width, height, left: Math.max(0, (bounds.width - width * scale) / 2), top: Math.max(0, (bounds.height - height * scale) / 2) };
    this.onLayout?.(this.layout);
  }

  cleanup(instances) {
    for (const instance of instances) {
      if (instance.cleaned) continue;
      instance.cleaned = true;
      const { definition, args } = instance;
      try {
        const result = definition.destroy?.(args);
        if (result?.catch) result.catch(error => console.error("Modular Stream Overlay | Widget cleanup failed", error));
      } catch (error) { console.error("Modular Stream Overlay | Widget cleanup failed", error); }
    }
  }

  destroy() {
    this.disposed = true;
    ++this.generation;
    this.observer.disconnect();
    this.cleanup(this.instances);
    for (const pending of this.pendingScenes.values()) this.cleanup(pending);
    this.pendingScenes.clear();
    this.instances = [];
    this.container.replaceChildren();
    this.root = null;
    this.layerElements.clear();
    this.compositions.clear();
    this.motions.clear(); this.rootMotion = null; this.carousel = null;
    this.mounted = null; this.rootInstances = []; this.sceneKey = null;
  }
}

function applyGeometry(element, value) {
  Object.assign(element.style, {
    left: `${value.x}px`, top: `${value.y}px`, width: `${value.width}px`, height: `${value.height}px`,
    opacity: String(value.opacity), transform: `rotate(${value.rotation ?? 0}deg)`, transformOrigin: "center center"
  });
}

function defaultAssetURL(src) {
  return globalThis.foundry?.utils?.getRoute ? foundry.utils.getRoute(src) : src;
}
