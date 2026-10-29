import { CarouselController } from "../carousel/runtime.js";
import { LayerMotion } from "./motion.js";
import { templateFields } from "../data/bindings.js";
import { transitionEffects } from "../carousel/schema.js";

const finite = value => typeof value === "number" && Number.isFinite(value);
const available = value => finite(value) || typeof value === "boolean" || typeof value === "string" && value.length > 0;

function fieldsFor(layer) {
  if (!layer.visible) return [];
  if (layer.type === "resource-bar") return [layer.binding, layer.maxBinding];
  if (["character-portrait", "character-name", "dynamic-text", "dynamic-number"].includes(layer.type)) {
    return layer.text ? templateFields(layer.text) : [layer.binding];
  }
  return [];
}

/** Availability describes actual bound content, not fallback labels or static decorations. */
export function pageHasInformation(page, values) {
  return page.layers.some(layer => {
    const fields = fieldsFor(layer);
    if (layer.type === "resource-bar") return fields.length && finite(values[layer.binding]) && finite(values[layer.maxBinding]) && values[layer.maxBinding] > 0;
    return fields.some(field => available(values[field]));
  });
}

/** Mounted pages keep independent bindings; one disposable scheduler only changes presentation. */
export class WidgetCarousel {
  constructor({ root, overlay, context, parentMotion, createRenderer, resolveMotion, editing = null }) {
    this.root = root; this.overlay = overlay; this.context = context; this.parentMotion = parentMotion;
    this.createRenderer = createRenderer; this.resolveMotion = resolveMotion; this.editing = editing;
    this.pages = overlay.pages.filter(page => page.enabled !== false || page.id === editing); this.views = new Map(); this.values = {}; this.disposed = false; this.dataGeneration = 0;
    this.controller = new CarouselController({ pages: this.pages, settings: { ...overlay.cycling, enabled: context.carouselManaged ? false : overlay.cycling.enabled },
      isEligible: page => context.carouselManaged || this.editing !== null || pageHasInformation(page, this.values),
      canAnimate: () => this.editing === null && parentMotion.controller.canPlay(),
      onState: state => context.onCarouselChange?.(state),
      onPage: event => this.changePage(event), onCancel: () => this.cancelTransition(),
      onError: error => console.error("Modular Stream Overlay | Carousel", error) });
    this.unsubscribeVisibility = parentMotion.subscribeVisibility(visible => this.controller.setVisible(visible));
    this.controller.setVisible(parentMotion.effectiveVisible());
  }

  async mount() {
    for (const page of this.pages) {
      if (this.disposed) return;
      const element = document.createElement("div"); element.className = "mso-carousel-page"; element.dataset.pageId = page.id;
      element.style.display = "none"; this.root.append(element);
      const gate = new LayerMotion({ element, layer: { id: `page:${page.id}`, visible: false }, context: { ...this.context, parentMotion: this.parentMotion } });
      const child = this.createRenderer(element, { ...this.context, parentMotion: gate, resolveMotion: this.resolveMotion,
        inheritedTransition: this.context.inheritedTransition ?? this.parentMotion.settings.transition });
      this.views.set(page.id, { element, gate, renderer: child });
      await child.render({ ...this.overlay, id: page.id, name: page.name, layers: page.layers,
        background: { src: "", opacity: 1, fit: "cover" }, widgets: [], pages: [],
        animations: undefined, triggers: [], cycling: undefined });
    }
    if (this.disposed) return;
    const fields = [...new Set(this.pages.filter(page => page.skipIfUnavailable).flatMap(page => page.layers.flatMap(fieldsFor)))];
    const service = this.context.characterData, actorUuid = this.context.actorUuid ?? this.context.previewActorUuid ?? "";
    if (!this.context.carouselManaged && service && actorUuid && fields.length) {
      const refresh = async (initial = false) => {
        const generation = ++this.dataGeneration;
        let values = {};
        try { values = (await service.resolve(actorUuid, fields)).values ?? {}; } catch { /* Unavailable pages use their declared fallback/skip policy. */ }
        if (this.disposed || generation !== this.dataGeneration) return;
        this.values = values;
        if (!initial) await this.controller.refreshAvailability();
      };
      this.unsubscribeData = service.subscribe(actorUuid, () => { void refresh(); });
      await refresh(true);
    }
    if (this.disposed) return;
    if (this.editing !== null) this.controller.pause();
    if (this.editing && this.editing !== "shared" && this.views.has(this.editing)) this.controller.settings.startPageId = this.editing;
    await this.controller.start();
  }

  cancelTransition() {
    for (const { gate } of this.views.values()) {
      gate.visibilityGeneration++; gate.controller.stop("visibility");
      gate.setParentVisible(gate.parentVisible);
    }
  }

  async changePage({ to, transition, duration, initial, isCurrent }) {
    if (this.disposed) return;
    const effects = !initial && duration > 0 ? transitionEffects(transition) : null;
    // Over: the incoming page appears above the outgoing one, which is hidden only
    // afterwards, so content repeated on both pages stays steady instead of dimming.
    const over = effects?.mode === "over";
    if (effects?.mode === "sequence") {
      // The outgoing page leaves first, then the incoming one arrives in the same place.
      const half = Math.floor(duration / 2);
      const leaving = [...this.views].filter(([id]) => id !== to).map(([, { gate }]) => {
        gate.settings.exit = half ? { type: effects.exit, duration: half, easing: "ease-in" } : null;
        return gate.setVisible(false);
      });
      await Promise.all(leaving);
      if (this.disposed || !isCurrent()) return;
      const { element, gate } = this.views.get(to) ?? {};
      for (const [id, view] of this.views) view.element.style.display = id === to ? "" : "none";
      if (!gate) return;
      element.style.zIndex = "";
      gate.settings.entrance = { type: effects.entrance, duration: duration - half, easing: "ease-out" };
      await gate.setVisible(true);
      return;
    }
    const operations = [];
    for (const [id, { element, gate }] of this.views) {
      gate.settings.entrance = effects ? { type: effects.entrance, duration, easing: "ease-in-out" } : null;
      gate.settings.exit = effects && !over ? { type: effects.exit, duration, easing: "ease-in-out" } : null;
      element.style.zIndex = over && id === to ? "1" : "";
      if (id === to) element.style.display = "";
      if (id === to || !over) operations.push(gate.setVisible(id === to));
    }
    await Promise.all(operations);
    if (this.disposed || !isCurrent()) return;
    if (over) {
      await Promise.all([...this.views].filter(([id]) => id !== to).map(([, { gate }]) => gate.setVisible(false)));
      if (this.disposed || !isCurrent()) return;
    }
    for (const [id, { element }] of this.views) element.style.display = id === to ? "" : "none";
  }

  async setEditing(scope) {
    this.editing = scope;
    if (scope === null) {
      await this.controller.refreshAvailability();
      if (!this.context.carouselManaged && this.overlay.cycling.enabled) this.controller.resume();
    } else {
      this.controller.pause();
      await this.controller.refreshAvailability();
      if (scope !== "shared" && this.views.has(scope)) await this.controller.select(scope);
    }
  }

  findMotion(id) {
    for (const view of this.views.values()) { const motion = view.renderer.findMotion(id); if (motion) return motion; }
    return null;
  }
  updateLayer(layer) {
    for (const [id, view] of this.views) if (view.renderer.layerElements.has(layer.id)) {
      view.renderer.updateLayer(layer);
      const page = this.pages.find(page => page.id === id), index = page.layers.findIndex(value => value.id === layer.id);
      page.layers[index] = layer;
      return true;
    }
    return false;
  }
  getState() { return { ...this.controller.getState(), pages: this.pages.map(({ id, name }) => ({ id, name })) }; }
  pause() { return this.controller.pause(); }
  resume() { return this.controller.resume(); }
  select(id) { return this.controller.select(id); }
  next() { return this.controller.next(); }
  previous() { return this.controller.previous(); }
  nextPage() { return this.next(); }
  previousPage() { return this.previous(); }
  reset() {
    const state = this.getState();
    const id = state.availablePageIds.includes(this.overlay.cycling.startPageId) ? this.overlay.cycling.startPageId : state.availablePageIds[0];
    return id ? this.controller.select(id) : state;
  }
  resetAnimations() { for (const { renderer } of this.views.values()) renderer.resetAnimations(); }
  destroy() {
    if (this.disposed) return;
    this.disposed = true; this.dataGeneration++;
    this.unsubscribeData?.(); this.unsubscribeVisibility?.(); this.controller.destroy();
    for (const { renderer, gate } of this.views.values()) { renderer.destroy(); gate.destroy(); }
    this.views.clear();
  }
}
