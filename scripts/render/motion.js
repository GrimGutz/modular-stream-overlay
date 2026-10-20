import { AnimationController } from "../animation/playback.js";
import { TriggerRuntime } from "../animation/triggers.js";
import { validateAnimationSettings, validateTriggerRules } from "../animation/schema.js";

const mounted = new Set();
const actionHandlers = new Map();

export function registerAnimationAction(id, handler) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(id) || ["__proto__", "constructor", "prototype", "play-animation", "show", "hide", "glow", "color-flash", "animate-number"].includes(id)
    || typeof handler !== "function" || actionHandlers.has(id)) throw new TypeError("Register a unique namespaced animation action and callback.");
  actionHandlers.set(id, handler);
}

/** One browser-wide preference refresh, including editor previews and nested compositions. */
export function refreshAnimationPreferences() {
  for (const motion of mounted) motion.refreshPreferences();
}

export function effectiveWidgetMotion(instance, preset) {
  const source = instance.animationOverrides ? instance : preset;
  return { animations: validateAnimationSettings(source?.animations), triggers: validateTriggerRules(source?.triggers) };
}

/** Runtime state belongs to this mounted presentation, never to saved layers or Actors. */
export class LayerMotion {
  constructor({ element, layer, context = {}, resolveTarget = () => null }) {
    this.element = element; this.layer = layer; this.context = context; this.resolveTarget = resolveTarget;
    this.settings = validateAnimationSettings(layer.animations);
    if (!this.settings.transition.duration && context.inheritedTransition?.duration) this.settings.transition = { ...context.inheritedTransition };
    this.rules = validateTriggerRules(layer.triggers);
    this.visible = layer.visible !== false; this.disposed = false; this.generation = 0; this.visibilityGeneration = 0;
    this.parentMotion = context.parentMotion ?? null;
    this.parentVisible = this.parentMotion?.effectiveVisible() ?? true;
    this.presentationVisible = this.effectiveVisible();
    this.children = new Set();
    this.visibilityListeners = new Set();
    this.targetSubscriptions = new Map();
    this.parentMotion?.children.add(this);
    this.values = {}; this.hasValues = false; this.numberAnimator = null;
    this.diagnostics = { lastTrigger: null, lastAnimation: null, playback: [], missingBindings: [], resolutionError: false };
    this.controller = new AnimationController(element, {
      enabled: () => this.presentationVisible && (context.animationsEnabled?.() ?? true),
      reducedMotion: () => context.reducedMotion?.() ?? globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
      blockedReason: () => !this.presentationVisible ? "hidden" : null,
      debug: () => context.debug?.() ?? false,
      onDiagnostic: event => {
        this.diagnostics.lastAnimation = { ...event, layerId: layer.id };
        this.diagnostics.playback.push(this.diagnostics.lastAnimation);
        if (this.diagnostics.playback.length > 8) this.diagnostics.playback.shift();
        context.onDiagnostic?.({ event: "animation", ...this.diagnostics.lastAnimation });
      },
      registry: context.animationRegistry
    });
    this.runtime = new TriggerRuntime({ rules: this.rules, onAction: (rule, event) => this.action(rule, event),
      onStop: rule => {
        this.target(rule.action.target)?.controller.stop(`continuous:${this.layer.id}:${rule.id}`);
        this.targetSubscriptions.get(rule.id)?.(); this.targetSubscriptions.delete(rule.id);
      } });
    this.runtime.visibility(this.effectiveVisible(), { initial: true });
    if (!this.effectiveVisible()) this.element.style.visibility = "hidden";
    mounted.add(this);
    const fields = [...new Set(this.rules.flatMap(rule => [rule.field, rule.condition?.field]).filter(Boolean))];
    const actorUuid = layer.actorUuid ?? context.actorUuid ?? context.previewActorUuid ?? "";
    const service = context.characterData;
    const refresh = async () => {
      const generation = ++this.generation;
      let values = {};
      let resolutionError = false;
      try { const result = await service.resolve(actorUuid, fields); values = result.values; resolutionError = Boolean(result.warning); }
      catch { resolutionError = true; /* Missing access stops continuous effects. */ }
      if (this.disposed || generation !== this.generation) return;
      this.values = values ?? {};
      if (this.context.debug?.()) {
        this.diagnostics.resolutionError = resolutionError;
        this.diagnostics.missingBindings = fields.filter(field => this.values[field] === undefined || this.values[field] === null);
      }
      this.runtime.update(this.values, { initial: !this.hasValues }); this.hasValues = true;
    };
    this.ready = Promise.resolve();
    this.startData = () => {
      if (fields.length && actorUuid && service && !this.disposed) {
        this.unsubscribe = service.subscribe(actorUuid, () => { void refresh(); });
        this.ready = refresh();
      }
      return this.ready;
    };
  }

  start() { const start = this.startData; this.startData = null; return start?.() ?? this.ready; }

  target(id = "self") { return id === "self" ? this : this.resolveTarget(id); }

  effectiveVisible() { return !this.disposed && this.visible && this.parentVisible; }

  subscribeVisibility(callback) {
    this.visibilityListeners.add(callback);
    return () => this.visibilityListeners.delete(callback);
  }

  notifyVisibility(visible = this.effectiveVisible()) {
    for (const callback of this.visibilityListeners) callback(visible);
  }

  propagateVisibility(visible = this.effectiveVisible(), reason = "parent-hidden") {
    for (const child of this.children) child.setParentVisible(visible, reason);
  }

  /** Parent gating preserves each child's saved/runtime visibility and suppresses one-shots. */
  setParentVisible(visible, reason = "parent-hidden") {
    if (this.disposed) return;
    this.parentVisible = Boolean(visible);
    this.visibilityGeneration++;
    const effective = this.effectiveVisible();
    this.presentationVisible = effective;
    this.runtime.visibility(effective, { initial: true });
    if (!effective) this.controller.reset(reason);
    this.element.style.visibility = effective ? "visible" : "hidden";
    this.propagateVisibility(effective, reason);
    this.notifyVisibility(effective);
  }

  action(rule, event) {
    const target = this.target(rule.action.target);
    if (!target || target.disposed) return;
    const action = rule.action;
    if (this.context.debug?.()) {
      this.diagnostics.lastTrigger = { ruleId: rule.id, type: event.type, at: Date.now() };
      this.context.onDiagnostic?.({ type: "trigger", layerId: this.layer.id, ...this.diagnostics.lastTrigger });
    }
    if (rule.continuous && target !== this && !this.targetSubscriptions.has(rule.id)) {
      this.targetSubscriptions.set(rule.id, target.subscribeVisibility(visible => {
        if (visible && !this.disposed && this.effectiveVisible() && this.runtime.active.has(rule.id)) this.action(rule, event);
      }));
    }
    const animation = action.animation ?? target.settings.emphasis ?? { type: "pulse", duration: 500 };
    if (action.type === "show" || action.type === "hide") return target.setVisible(action.type === "show");
    if (action.type === "animate-number") return target.numberAnimator?.(event, animation);
    if (["play-animation", "glow", "color-flash"].includes(action.type)) {
      return target.play({ ...animation, ...(["glow", "color-flash"].includes(action.type) ? { type: action.type } : {}) },
        { channel: rule.continuous ? `continuous:${this.layer.id}:${rule.id}` : "emphasis", persistent: rule.continuous });
    }
    return actionHandlers.get(action.type)?.({ target, source: this, rule, event });
  }

  async setVisible(visible, { fire = true } = {}) {
    if (this.disposed || this.visible === visible) return;
    const generation = ++this.visibilityGeneration;
    this.visible = visible;
    this.controller.stop("visibility");
    const effective = this.effectiveVisible();
    if (effective) { this.presentationVisible = true; this.element.style.visibility = "visible"; this.propagateVisibility(true); }
    this.notifyVisibility(effective);
    this.runtime.visibility(effective, { initial: !fire });
    if (generation !== this.visibilityGeneration) return;
    const config = this.parentVisible ? effective ? this.settings.entrance : this.settings.exit : null;
    if (config) await this.play(config, { channel: "visibility" });
    if (!this.disposed && generation === this.visibilityGeneration) {
      this.presentationVisible = effective;
      this.element.style.visibility = effective ? "visible" : "hidden";
      this.propagateVisibility(effective);
    }
  }

  /** The old scene remains mounted until its configured exit has finished. */
  async exit() {
    if (!this.effectiveVisible()) return;
    const generation = ++this.visibilityGeneration;
    this.runtime.visibility(false);
    if (this.settings.exit) await this.play(this.settings.exit, { channel: "visibility" });
    if (!this.disposed && generation === this.visibilityGeneration) {
      this.presentationVisible = false;
      this.element.style.visibility = "hidden";
      this.propagateVisibility(false);
      this.notifyVisibility(false);
    }
  }

  enter({ fire = true } = {}) {
    if (!this.effectiveVisible()) return;
    this.visibilityGeneration++;
    this.controller.stop("visibility");
    this.presentationVisible = true;
    this.element.style.visibility = "visible";
    this.runtime.visibility(true, { initial: true });
    this.propagateVisibility(true);
    this.notifyVisibility(true);
    if (this.settings.entrance) void this.play(this.settings.entrance, { channel: "visibility" });
    if (fire) this.runtime.dispatch("visible");
  }

  play(config, options) {
    return this.controller.play(config, options);
  }
  preview(config) { return this.play(config, { channel: "preview" }); }
  manual(ruleId, eventId) { return this.runtime.manual(ruleId, { eventId }); }
  dispatch(type, detail = {}) { return this.runtime.dispatch(type, detail); }
  reset() {
    this.visibilityGeneration++;
    this.controller.reset();
    this.colorAnimation?.cancel?.();
    this.runtime.reset();
    this.visible = this.layer.visible !== false;
    this.presentationVisible = this.effectiveVisible();
    this.runtime.visibility(this.effectiveVisible(), { initial: true });
    this.runtime.update(this.values, { initial: true });
    this.element.style.visibility = this.effectiveVisible() ? "visible" : "hidden";
    this.propagateVisibility();
    this.notifyVisibility();
  }
  refreshPreferences() {
    this.controller.setEnabled(this.context.animationsEnabled?.() ?? true);
    this.colorAnimation?.cancel?.();
    const values = this.values;
    this.runtime.reset(); this.runtime.visibility(this.effectiveVisible(), { initial: true });
    this.runtime.update(values, { initial: true });
  }
  destroy(reason = "destroyed") {
    if (this.disposed) return;
    this.disposed = true; this.generation++; this.visibilityGeneration++;
    this.presentationVisible = false;
    // Stop descendants before their visibility listeners cancel carousel gates,
    // preserving the real interruption cause in their playback diagnostics.
    this.controller.reset(reason);
    this.propagateVisibility(false, reason);
    this.notifyVisibility(false); this.visibilityListeners.clear();
    this.parentMotion?.children.delete(this);
    this.children.clear();
    this.colorAnimation?.cancel?.();
    this.unsubscribe?.(); this.runtime.destroy(); this.controller.destroy(reason); mounted.delete(this);
    for (const unsubscribe of this.targetSubscriptions.values()) unsubscribe(); this.targetSubscriptions.clear();
  }
}
