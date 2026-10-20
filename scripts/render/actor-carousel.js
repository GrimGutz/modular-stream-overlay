import { UnifiedCarouselController } from "../carousel/sequence.js";
import { requestedFields } from "../data/bindings.js";
import { LayerMotion } from "./motion.js";
import { pageHasInformation } from "./carousel.js";

const EFFECTS = { fade: ["fade-in", "fade-out"], "slide-left": ["slide-in-right", "slide-out-left"],
  "slide-right": ["slide-in-left", "slide-out-right"], "slide-up": ["slide-in-bottom", "slide-out-top"],
  "slide-down": ["slide-in-top", "slide-out-bottom"], scale: ["scale-in", "scale-out"] };

/** A single sequence owns scheduling; prepared Actor presentations contain no automatic timer. */
export class ActorCarousel {
  constructor({ element, overlay, instance, configuration, context, parentMotion, createRenderer, viewportSize, hasPages = overlay.pages.length > 0 }) {
    this.element = element; this.overlay = overlay; this.instance = instance; this.configuration = configuration;
    this.context = context; this.parentMotion = parentMotion; this.createRenderer = createRenderer; this.viewportSize = viewportSize;
    this.slots = new Map(); this.snapshots = new Map(); this.subscriptions = []; this.generations = new Map();
    this.activeSlot = null; this.disposed = false; this.carousel = this;
    this.pages = hasPages ? configuration.pages : [{ id: "shared-content", name: "Shared content", enabled: true, duration: null, skipIfUnavailable: false, layers: [] }];
    this.controller = new UnifiedCarouselController({ actors: configuration.actors, pages: this.pages, settings: configuration.settings,
      isActorAvailable: uuid => this.snapshots.get(uuid)?.available === true,
      isEligible: (uuid, page) => pageHasInformation(page, this.snapshots.get(uuid)?.values ?? {}),
      canAnimate: () => this.parentMotion.controller.canPlay(),
      onStep: event => this.present(event), onCancel: () => this.cancelTransition(),
      onState: state => this.context.onCarouselChange?.({ ...state, layerId: instance.id }),
      onError: error => console.error("Modular Stream Overlay | Actor sequence", error) });
    this.unsubscribeVisibility = parentMotion.subscribeVisibility(visible => { void this.controller.setVisible(visible); });
    void this.controller.setVisible(parentMotion.effectiveVisible());
  }

  async mount() {
    const layers = [...this.overlay.layers, ...this.configuration.pages.flatMap(page => page.layers)];
    const fields = [...new Set(["character.name", ...layers.flatMap(requestedFields),
      ...[this.overlay, ...layers].flatMap(layer => (layer.triggers ?? []).flatMap(rule => [rule.field, rule.condition?.field]).filter(Boolean))])];
    this.fields = fields;
    for (const uuid of this.configuration.actors) {
      const unsubscribe = this.context.characterData?.subscribe(uuid, () => { void this.refreshActor(uuid); });
      if (unsubscribe) this.subscriptions.push(unsubscribe);
    }
    await Promise.all(this.configuration.actors.map(uuid => this.refreshActor(uuid, true)));
    if (!this.disposed) await this.controller.start();
  }

  async refreshActor(uuid, initial = false) {
    const generation = (this.generations.get(uuid) ?? 0) + 1; this.generations.set(uuid, generation);
    let values = {}, available = false;
    try {
      const service = this.context.characterData;
      if (service) {
        const selected = this.fields.filter(field => field !== "character.name"), chunks = [];
        for (let index = 0; index < Math.max(1, selected.length); index += 127) chunks.push(["character.name", ...selected.slice(index, index + 127)]);
        const results = await Promise.all(chunks.map(fields => service.resolve(uuid, fields)));
        available = results.every(result => typeof result?.values?.["character.name"] === "string" && result.values["character.name"].length > 0);
        if (available) for (const result of results) for (const field of this.fields) {
          const value = result.values[field];
          if (typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) values[field] = value;
        }
      }
    } catch { /* Missing Actors and denied permissions remove their combinations from the sequence. */ }
    if (this.disposed || generation !== this.generations.get(uuid)) return;
    this.snapshots.set(uuid, { available, values });
    if (this.context.debug?.()) this.context.onDiagnostic?.({ type: "actor-resolution", instanceId: this.instance.id,
      actorUuid: uuid, available, missingBindings: this.fields.filter(field => values[field] === undefined || values[field] === null) });
    if (!initial) await this.controller.refreshAvailability();
  }

  destroySlot(slot) {
    if (!slot || slot.disposed) return;
    slot.disposed = true; slot.renderer.destroy(); slot.gate.destroy(); slot.element.remove?.();
    this.slots.delete(slot.actorUuid);
  }

  async prepare(uuid) {
    const existing = this.slots.get(uuid);
    if (existing) { await existing.ready; return existing.disposed ? null : existing; }
    // Keep at most the active card and one prepared successor, including rapid navigation.
    for (const slot of [...this.slots.values()]) if (slot !== this.activeSlot) this.destroySlot(slot);
    const element = document.createElement("div"); element.className = "mso-actor-presentation"; element.dataset.actorUuid = uuid;
    element.style.display = "none"; this.element.append(element);
    const gate = new LayerMotion({ element, layer: { id: `actor:${uuid}`, visible: false }, context: { ...this.context, parentMotion: this.parentMotion } });
    const renderer = this.createRenderer(element, { ...this.context, actorUuid: uuid, previewActorUuid: "", parentMotion: gate,
      carouselManaged: true, onCarouselChange: undefined });
    renderer.viewportSize = { ...this.viewportSize };
    const slot = { actorUuid: uuid, element, gate, renderer, disposed: false, ready: null };
    this.slots.set(uuid, slot);
    slot.ready = renderer.render(this.overlay);
    try { await slot.ready; }
    catch (error) { this.destroySlot(slot); throw error; }
    if (slot.disposed || this.disposed) return null;
    // Visibility actions authored on the grouped card still control the whole instance.
    const motion = renderer.rootMotion, action = motion.action.bind(motion);
    motion.action = (rule, event) => {
      if (slot !== this.activeSlot) return;
      return rule.action.target === "self" && ["show", "hide"].includes(rule.action.type)
        ? this.parentMotion.setVisible(rule.action.type === "show") : action(rule, event);
    };
    return slot;
  }

  cancelTransition() {
    for (const slot of this.slots.values()) {
      slot.gate.visibilityGeneration++; slot.gate.controller.stop("visibility");
      slot.renderer.carousel?.cancelTransition();
      const show = slot === this.activeSlot;
      slot.gate.settings.entrance = slot.gate.settings.exit = null;
      void slot.gate.setVisible(show); slot.gate.setParentVisible(slot.gate.parentVisible);
      slot.element.style.display = show ? "" : "none";
    }
  }

  async present({ to, initial, isCurrent }) {
    if (this.disposed) return;
    if (!to) {
      this.cancelTransition();
      if (this.activeSlot) {
        this.activeSlot.gate.settings.exit = null; await this.activeSlot.gate.setVisible(false);
        this.activeSlot.element.style.display = "none"; this.activeSlot = null;
      }
      return;
    }
    const next = await this.prepare(to.actorUuid);
    if (!next || !isCurrent() || !this.snapshots.get(to.actorUuid)?.available) return;
    const previous = this.activeSlot, changed = previous?.actorUuid !== to.actorUuid;
    const pages = next.renderer.carousel;
    if (changed || initial) {
      // Choose the complete incoming Actor/page while it is hidden. No second page transition.
      if (pages) { pages.controller.settings.transitionDuration = 0; await pages.select(to.pageId); }
    } else if (pages) {
      const animate = !initial && this.parentMotion.controller.canPlay();
      pages.controller.settings.transition = animate ? this.configuration.settings.transition : "instant";
      pages.controller.settings.transitionDuration = animate ? this.configuration.settings.transitionDuration : 0;
      await pages.select(to.pageId);
      return;
    }
    if (!isCurrent() || this.disposed) return;
    const animate = !initial && previous && this.parentMotion.controller.canPlay();
    const kind = animate ? this.configuration.settings.characterTransition : "instant";
    const ms = animate ? this.configuration.settings.characterTransitionDuration : 0;
    const types = ms > 0 ? EFFECTS[kind] : null;
    // Exit and entrance share one configured duration and never mix identities in one card.
    if (previous && previous !== next) {
      const exitDuration = Math.floor(ms / 2);
      previous.gate.settings.exit = types && exitDuration ? { type: types[1], duration: exitDuration, easing: "ease-in-out" } : null;
      await previous.gate.setVisible(false);
      if (!isCurrent() || this.disposed) return;
      previous.element.style.display = "none";
    }
    this.activeSlot = next; next.element.style.display = "";
    const entranceDuration = ms - Math.floor(ms / 2);
    next.gate.settings.entrance = types && entranceDuration ? { type: types[0], duration: entranceDuration, easing: "ease-in-out" } : null;
    await next.gate.setVisible(true);
    if (!isCurrent() || this.disposed) return;
    for (const slot of this.slots.values()) if (slot !== next) slot.element.style.display = "none";
  }

  getState() { return { ...this.controller.getState(), layerId: this.instance.id,
    availableActorUuids: this.configuration.actors.filter(uuid => this.snapshots.get(uuid)?.available),
    pages: this.pages.map(({ id, name }) => ({ id, name })) }; }
  canSelect(pageId, uuid = this.getState().activeActorUuid) {
    const page = this.pages.find(page => page.id === pageId), snapshot = this.snapshots.get(uuid);
    return Boolean(page && snapshot?.available && (!page.skipIfUnavailable || pageHasInformation(page, snapshot.values)));
  }
  canSelectActor(uuid) { return this.pages.some(page => this.canSelect(page.id, uuid)); }
  pause() { return this.controller.pause(); }
  resume() { return this.controller.resume(); }
  next() { return this.controller.next(); }
  previous() { return this.controller.previous(); }
  nextPage() { return this.controller.nextPage(); }
  previousPage() { return this.controller.previousPage(); }
  nextActor() { return this.controller.nextActor(); }
  previousActor() { return this.controller.previousActor(); }
  reset() { return this.controller.reset(); }
  select(pageId, uuid) { return this.controller.select(pageId, uuid); }
  selectActor(uuid) { return this.controller.selectActor(uuid); }
  findMotion(id) { return this.activeSlot?.renderer.findMotion(id) ?? null; }
  getActiveMotion() { return this.activeSlot?.renderer.rootMotion ?? null; }
  resetAnimations() { this.activeSlot?.renderer.resetAnimations(); }
  fit() { for (const { renderer } of this.slots.values()) { renderer.viewportSize = this.viewportSize; renderer.fit(); } }
  destroy() {
    if (this.disposed) return;
    this.disposed = true; this.controller.destroy(); this.unsubscribeVisibility?.();
    for (const unsubscribe of this.subscriptions) unsubscribe(); this.subscriptions = [];
    for (const slot of [...this.slots.values()]) this.destroySlot(slot);
    this.snapshots.clear(); this.activeSlot = null;
  }
}
