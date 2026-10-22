const TRANSITIONS = new Set(["fade", "fade-over", "slide-left", "slide-right", "slide-up", "slide-down", "scale", "instant"]);
const duration = (value, fallback, minimum = 100, maximum = 3600000) => Number.isFinite(value)
  ? Math.max(minimum, Math.min(maximum, value)) : fallback;

/**
 * Disposable local page scheduling. It owns one timeout and never persists playback
 * state. Manual navigation keeps the pause state and restarts the full page dwell.
 * Resume also permits a temporary run when saved automatic cycling is disabled.
 */
export class CarouselController {
  constructor({ pages = [], settings = {}, onPage = () => {}, onState = () => {}, onCancel = () => {},
    onError = error => console.error("Modular Stream Overlay | Carousel", error), isEligible = () => true,
    canAnimate = () => true, now = () => globalThis.performance?.now?.() ?? Date.now(),
    setTimer = (callback, ms) => globalThis.setTimeout(callback, ms), clearTimer = id => globalThis.clearTimeout(id) } = {}) {
    this.pages = Array.isArray(pages) ? [...pages] : [];
    this.settings = {
      enabled: settings.enabled === true,
      duration: duration(settings.duration, 5000),
      transition: TRANSITIONS.has(settings.transition) ? settings.transition : "fade",
      transitionDuration: duration(settings.transitionDuration, 400, 0, 10000),
      loop: settings.loop !== false,
      startPageId: settings.startPageId ?? null
    };
    this.onPage = onPage; this.onState = onState; this.onCancel = onCancel; this.onError = onError;
    this.isEligible = isEligible; this.canAnimate = canAnimate;
    this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.activePageId = null;
    this.paused = !this.settings.enabled;
    this.visible = true;
    this.started = false;
    this.destroyed = false;
    this.transitioning = false;
    this.ended = false;
    this.generation = 0;
    this.timer = null;
    this.deadline = null;
    this.remaining = null;
    this.eligiblePages = this.collectEligible();
  }

  collectEligible() {
    return this.pages.filter(page => {
      if (!page.skipIfUnavailable) return true;
      try { return this.isEligible(page) === true; }
      catch (error) { this.report(error); return false; }
    });
  }

  report(error) { try { this.onError(error); } catch { /* Reporting cannot retain a scheduler. */ } }

  getState() {
    const remaining = this.deadline === null ? this.remaining : Math.max(0, this.deadline - this.now());
    return {
      activePageId: this.activePageId,
      paused: this.paused,
      visible: this.visible,
      transitioning: this.transitioning,
      running: this.started && !this.destroyed && !this.paused && this.visible && !this.ended && this.eligiblePages.length > 1,
      ended: this.ended,
      remaining,
      availablePageIds: this.eligiblePages.map(page => page.id),
      destroyed: this.destroyed
    };
  }

  emit() {
    const state = this.getState();
    try { this.onState(state); } catch (error) { this.report(error); }
    return state;
  }

  dwell(pageId = this.activePageId) {
    return duration(this.pages.find(page => page.id === pageId)?.duration, this.settings.duration);
  }

  suspend() {
    if (this.timer !== null) {
      this.remaining = Math.max(0, this.deadline - this.now());
      this.clearTimer(this.timer);
    }
    this.timer = null;
    this.deadline = null;
  }

  schedule() {
    if (this.timer !== null || this.destroyed || !this.started || this.paused || !this.visible || this.transitioning ||
      this.ended || this.activePageId === null || this.eligiblePages.length < 2) return;
    const remaining = this.remaining ?? this.dwell();
    this.remaining = remaining;
    this.deadline = this.now() + remaining;
    const generation = this.generation;
    const timer = this.setTimer(() => {
      if (this.destroyed || this.timer !== timer || generation !== this.generation) return;
      this.timer = null; this.deadline = null; this.remaining = 0;
      const index = this.eligiblePages.findIndex(page => page.id === this.activePageId);
      if (!this.settings.loop && index === this.eligiblePages.length - 1) {
        this.ended = true;
        this.emit();
        return;
      }
      const next = this.eligiblePages[(index + 1) % this.eligiblePages.length];
      void this.change(next?.id ?? null);
    }, remaining);
    this.timer = timer;
  }

  invalidate() {
    const previous = this.generation++;
    if (this.transitioning) {
      this.transitioning = false;
      try { this.onCancel({ generation: previous, activePageId: this.activePageId }); }
      catch (error) { this.report(error); }
    }
    return this.generation;
  }

  async change(pageId, { initial = false } = {}) {
    if (this.destroyed) return this.getState();
    const from = this.activePageId;
    this.suspend();
    this.activePageId = pageId;
    const generation = this.invalidate();
    this.ended = false;
    this.remaining = pageId === null ? null : this.dwell(pageId);
    this.transitioning = true;
    let animate = false;
    try { animate = !initial && this.visible && this.canAnimate() === true; } catch (error) { this.report(error); }
    const transition = animate && this.settings.transitionDuration > 0 ? this.settings.transition : "instant";
    const ms = transition === "instant" ? 0 : this.settings.transitionDuration;
    const isCurrent = () => !this.destroyed && this.generation === generation;
    this.emit();
    try { await this.onPage({ from, to: pageId, transition, duration: ms, initial, generation, isCurrent }); }
    catch (error) { if (isCurrent()) this.report(error); }
    if (!isCurrent()) return this.getState();
    this.transitioning = false;
    this.schedule();
    return this.emit();
  }

  async start() {
    if (this.destroyed || this.started) return this.getState();
    this.started = true;
    this.eligiblePages = this.collectEligible();
    const page = this.eligiblePages.find(item => item.id === this.settings.startPageId) ?? this.eligiblePages[0];
    return this.change(page?.id ?? null, { initial: true });
  }

  pause() {
    if (this.destroyed) return this.getState();
    this.paused = true;
    this.suspend();
    return this.emit();
  }

  async resume() {
    if (this.destroyed) return this.getState();
    this.paused = false;
    this.ended = false;
    if (this.remaining === 0) this.remaining = this.dwell();
    if (!this.started) return this.start();
    await this.refreshAvailability();
    this.schedule();
    return this.emit();
  }

  async select(pageId) {
    if (this.destroyed) return this.getState();
    if (!this.started) void this.start();
    this.eligiblePages = this.collectEligible();
    if (!this.eligiblePages.some(page => page.id === pageId)) return this.getState();
    if (pageId === this.activePageId && !this.transitioning) {
      this.suspend(); this.remaining = this.dwell(); this.ended = false;
      this.schedule();
      return this.emit();
    }
    return this.change(pageId);
  }

  async navigate(direction) {
    if (this.destroyed) return this.getState();
    if (!this.started) void this.start();
    this.eligiblePages = this.collectEligible();
    const pages = this.eligiblePages;
    if (!pages.length) return this.refreshAvailability();
    const index = pages.findIndex(page => page.id === this.activePageId);
    let next = index < 0 ? 0 : index + direction;
    if (this.settings.loop) next = (next + pages.length) % pages.length;
    else next = Math.max(0, Math.min(pages.length - 1, next));
    return this.select(pages[next].id);
  }

  next() { return this.navigate(1); }
  previous() { return this.navigate(-1); }

  async refreshAvailability() {
    if (this.destroyed) return this.getState();
    this.eligiblePages = this.collectEligible();
    if (!this.started) return this.getState();
    if (this.eligiblePages.some(page => page.id === this.activePageId)) {
      if (this.eligiblePages.length < 2) this.suspend();
      else this.schedule();
      return this.emit();
    }
    if (this.activePageId === null && !this.eligiblePages.length) return this.emit();
    const previousIndex = this.pages.findIndex(page => page.id === this.activePageId);
    let page;
    if (previousIndex >= 0) {
      page = this.eligiblePages.find(item => this.pages.indexOf(item) > previousIndex) ?? this.eligiblePages[0];
    } else {
      page = this.eligiblePages.find(item => item.id === this.settings.startPageId) ?? this.eligiblePages[0];
    }
    return this.change(page?.id ?? null);
  }

  async setVisible(visible) {
    if (this.destroyed || this.visible === Boolean(visible)) return this.getState();
    this.visible = Boolean(visible);
    if (!this.visible) this.suspend();
    else {
      await this.refreshAvailability();
      this.schedule();
    }
    return this.emit();
  }

  destroy() {
    if (this.destroyed) return this.getState();
    this.destroyed = true;
    this.suspend();
    this.invalidate();
    this.activePageId = null;
    this.remaining = null;
    this.eligiblePages = [];
    this.pages = [];
    const state = this.emit();
    this.onPage = this.onState = this.onCancel = () => {};
    return state;
  }
}
