import { validateOverlay, validateLayer, validateWidgetPreset, validateAssetPath, clone } from "../core/schema.js";
import { widgetPresetToOverlay } from "../core/widget-presets.js";
import { isCharacterComponent, mountCharacterComponent } from "./character-components.js";
import { LayerMotion, effectiveWidgetMotion } from "./motion.js";
import { validateAnimationSettings } from "../animation/schema.js";
import { WidgetCarousel } from "./carousel.js";
import { ActorCarousel } from "./actor-carousel.js";
import { resolveCarouselSettings } from "../carousel/schema.js";

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
      this.container.replaceChildren();
      return;
    }

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
    let carousel = null;
    const rootMotion = new LayerMotion({ element: root, layer: { ...overlay, visible: true }, context: this.context,
      resolveTarget: id => motions.get(id) ?? carousel?.findMotion(id) });
    instances.push({ definition: { destroy: () => rootMotion.destroy(this.disposed ? "destroyed" : "render-interrupted") }, args: {} });
    for (const { kind, value } of elements) {
      if (!value.visible && kind !== "layer") continue;
      const element = document.createElement("div");
      element.className = `mso-${kind}`;
      element.dataset.instanceId = value.id;
      applyGeometry(element, value);
      root.append(element);
      if (kind === "layer") {
        layerElements.set(value.id, element);
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
            : motions.get(id) ?? carousel?.findMotion(id) ?? this.context.resolveMotion?.(id) });
        motions.set(value.id, motion);
        instances.push({ definition: { destroy: () => motion.destroy(this.disposed ? "destroyed" : "render-interrupted") }, args: {} });
        if (["image", "color", "text"].includes(value.type)) {
          this.renderStaticLayer(element, value);
          continue;
        }
        const start = instances.length;
        try {
          if (isCharacterComponent(value.type)) {
            const binding = mountCharacterComponent({ element, layer: value, context: this.context, resolveAsset: this.resolveAsset, motion });
            motion.numberAnimator = binding.animateNumber;
            instances.push({ definition: { destroy: () => binding.destroy() }, args: {} });
            await binding.ready;
          } else if (value.type === "character-widget") {
            const child = await this.renderCharacterWidget(element, value, instances, motion);
            if (child) compositions.set(value.id, child);
          } else {
            // Extension types continue through the established widget registry below.
            await this.renderRegisteredWidget(element, value, overlay, instances);
          }
        } catch (error) {
          this.cleanup(instances.splice(start));
          element.replaceChildren();
          if (this.context.mode === "preview") element.textContent = "Widget content unavailable";
          console.error(`Modular Stream Overlay | Layer ${value.id} failed`, error);
        }
        if (this.disposed || generation !== this.generation) { this.cleanup(instances); return; }
        continue;
      }
      await this.renderRegisteredWidget(element, value, overlay, instances);
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
    if (overlay.pages.length) {
      carousel = new WidgetCarousel({ root, overlay, context: this.context, parentMotion: rootMotion,
        editing: this.pageEditing, resolveMotion: id => motions.get(id),
        createRenderer: (element, context) => new OverlayRenderer(element, { widgets: this.widgets,
          resolveAsset: this.resolveAsset, context, preview: this.context.mode === "preview",
          viewportSize: overlay.canvas }) });
      instances.push({ definition: { destroy: () => carousel.destroy() }, args: {} });
      await carousel.mount();
      if (this.disposed || generation !== this.generation) { this.cleanup(instances); return; }
    }
    await Promise.all([...motions.values()].map(motion => motion.start()));
    await rootMotion.start();
    if (this.disposed || generation !== this.generation) { this.cleanup(instances); return; }
    this.cleanup(this.instances);
    this.pendingScenes.delete(generation);
    this.instances = instances;
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
    if (wasInitialized) for (const [id, motion] of motions) {
      const before = previous?.id === overlay.id ? previous.layers.find(layer => layer.id === id) : null;
      if (motion.layer.visible && !before?.visible) motion.enter();
      else if (before && motion.layer.visible) this.transitionStyle(motion, before);
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

  async renderCharacterWidget(element, value, instances, motion) {
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
        context: { ...this.context, deferEntrances: true }, parentMotion: motion, viewportSize: { width: value.width, height: value.height },
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
    else if (value.type === "color") element.style.backgroundColor = value.color;
    else if (value.type === "text") {
      const text = document.createElement("div");
      text.className = "mso-text-content";
      text.textContent = value.text;
      Object.assign(text.style, {
        fontFamily: `"${value.fontFamily}", ${["Georgia", "Times New Roman"].includes(value.fontFamily) ? "serif" : value.fontFamily === "Courier New" ? "monospace" : "sans-serif"}`,
        fontSize: `${value.fontSize}px`, fontWeight: String(value.fontWeight), color: value.color,
        textAlign: value.align, textShadow: value.shadow ? "0 2px 4px rgba(0,0,0,0.8)" : "none"
      });
      element.append(text);
    }
  }

  /** Patch geometry during direct manipulation without replacing the stage or widgets. */
  updateLayer(input) {
    if (!this.overlay || this.disposed) return;
    const value = validateLayer(input, this.overlay.canvas);
    const element = this.layerElements.get(value.id);
    if (!element && this.carousel?.updateLayer(value)) return;
    if (element) applyGeometry(element, value);
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
