import { CarouselController } from "./runtime.js";
import { TRANSITION_IDS } from "./schema.js";

const MODES = new Set(["information", "character", "combined", "static"]);
const TRANSITIONS = new Set(TRANSITION_IDS);
const milliseconds = (value, fallback, minimum = 100, maximum = 3600000) => Number.isFinite(value)
  ? Math.max(minimum, Math.min(maximum, value)) : fallback;
const pairKey = ({ actorUuid, pageId }) => JSON.stringify([actorUuid, pageId]);
const pairFromKey = key => {
  if (typeof key !== "string") return null;
  try {
    const value = JSON.parse(key);
    return Array.isArray(value) && value.length === 2 && value.every(item => typeof item === "string")
      ? { actorUuid: value[0], pageId: value[1] } : null;
  } catch { return null; }
};
const actorsOnly = actors => [...new Set((Array.isArray(actors) ? actors : []).filter(value => typeof value === "string" && value.length > 0))];
const enabledPages = pages => {
  const seen = new Set();
  return (Array.isArray(pages) ? pages : []).filter(page => {
    if (!page || typeof page.id !== "string" || !page.id || page.enabled === false || seen.has(page.id)) return false;
    seen.add(page.id); return true;
  });
};

/** Declarative playback order. Only Actor identifiers and page identifiers leave this helper. */
export function buildCarouselSequence({ actors = [], pages = [], settings = {}, isActorAvailable = () => true,
  isEligible = () => true, onError = () => {} } = {}) {
  const safeCheck = callback => {
    try { return callback() === true; }
    catch (error) { try { onError(error); } catch { /* Availability must fail closed. */ } return false; }
  };
  let actorList = actorsOnly(actors).filter(uuid => safeCheck(() => isActorAvailable(uuid)));
  let pageList = enabledPages(pages);
  const mode = MODES.has(settings.mode) ? settings.mode : "information";
  const actorStartUuid = settings.actorStartUuid ?? settings.startActorUuid;
  if (mode === "information" || mode === "static") {
    const actor = actorList.find(uuid => uuid === actorStartUuid) ?? actorList[0];
    actorList = actor ? [actor] : [];
  }
  if (mode === "character" || mode === "static") {
    const page = pageList.find(item => item.id === settings.startPageId) ?? pageList[0];
    pageList = page ? [page] : [];
  }
  const sequence = [];
  const append = (actorUuid, page) => {
    if (!page.skipIfUnavailable || safeCheck(() => isEligible(actorUuid, page))) sequence.push({ actorUuid, pageId: page.id });
  };
  if (settings.traversal === "characters-first" && mode === "combined") {
    for (const page of pageList) for (const actorUuid of actorList) append(actorUuid, page);
  } else {
    for (const actorUuid of actorList) for (const page of pageList) append(actorUuid, page);
  }
  return sequence;
}

/**
 * One existing scheduler owns the complete Actor/page sequence. Transition work is
 * awaited before a full page dwell starts; no parallel character timer is created.
 */
export class UnifiedCarouselController {
  constructor({ actors = [], pages = [], settings = {}, isEligible = () => true, isActorAvailable = () => true,
    onStep = () => {}, onState = () => {}, onCancel = () => {},
    onError = error => console.error("Modular Stream Overlay | Carousel", error), canAnimate = () => true,
    now, setTimer, clearTimer } = {}) {
    this.actors = actorsOnly(actors);
    this.pages = enabledPages(pages);
    this.settings = {
      enabled: settings.enabled === true,
      mode: MODES.has(settings.mode) ? settings.mode : "information",
      traversal: settings.traversal === "characters-first" ? "characters-first" : "pages-first",
      duration: milliseconds(settings.duration, 5000),
      transition: TRANSITIONS.has(settings.transition) ? settings.transition : "fade",
      transitionDuration: milliseconds(settings.transitionDuration, 400, 0, 10000),
      characterTransition: TRANSITIONS.has(settings.characterTransition) ? settings.characterTransition : "fade",
      characterTransitionDuration: milliseconds(settings.characterTransitionDuration, 500, 0, 10000),
      loop: settings.loop !== false,
      actorStartUuid: settings.actorStartUuid ?? settings.startActorUuid ?? null,
      startPageId: settings.startPageId ?? null,
      pageDurations: settings.pageDurations && typeof settings.pageDurations === "object" ? { ...settings.pageDurations } : {}
    };
    this.selectedActorUuid = null;
    this.selectedPageId = null;
    this.isEligible = isEligible; this.isActorAvailable = isActorAvailable;
    this.onStep = onStep; this.onState = onState; this.onCancel = onCancel; this.onError = onError; this.canAnimate = canAnimate;
    this.controller = new CarouselController({
      pages: [], settings: { ...this.settings, enabled: this.settings.mode !== "static" && this.settings.enabled },
      now, setTimer, clearTimer,
      canAnimate: () => false,
      onPage: event => this.present(event),
      onState: () => this.emit(),
      onCancel: event => this.onCancel({ ...event, ...pairFromKey(event.activePageId), activePageId: pairFromKey(event.activePageId)?.pageId ?? null }),
      onError: error => this.report(error)
    });
    this.rebuild();
  }

  report(error) { try { this.onError(error); } catch { /* Reporting cannot retain scheduler work. */ } }

  rebuild() {
    const settings = { ...this.settings,
      actorStartUuid: this.selectedActorUuid ?? this.settings.actorStartUuid,
      startPageId: this.selectedPageId ?? this.settings.startPageId };
    this.sequence = buildCarouselSequence({ actors: this.actors, pages: this.pages, settings,
      isEligible: this.isEligible, isActorAvailable: this.isActorAvailable, onError: error => this.report(error) });
    this.controller.pages = this.sequence.map(pair => {
      const page = this.pages.find(item => item.id === pair.pageId);
      return { id: pairKey(pair), duration: this.settings.pageDurations[pair.pageId] ?? page?.duration, skipIfUnavailable: false };
    });
    this.controller.eligiblePages = this.controller.collectEligible();
    const start = this.startPair();
    this.controller.settings.startPageId = start ? pairKey(start) : null;
  }

  startPair() {
    const actorUuid = this.selectedActorUuid ?? this.settings.actorStartUuid;
    const pageId = this.selectedPageId ?? this.settings.startPageId;
    return this.sequence.find(pair => pair.actorUuid === actorUuid && pair.pageId === pageId)
      ?? this.sequence.find(pair => pair.actorUuid === actorUuid)
      ?? this.sequence.find(pair => pair.pageId === pageId)
      ?? this.sequence[0] ?? null;
  }

  getState() {
    const state = this.controller.getState(), pair = pairFromKey(state.activePageId);
    const actorIndex = pair ? this.actors.indexOf(pair.actorUuid) : -1;
    const pageIndex = pair ? this.pages.findIndex(page => page.id === pair.pageId) : -1;
    return { ...state, mode: this.settings.mode, traversal: this.settings.traversal,
      activeActorUuid: pair?.actorUuid ?? null, activePageId: pair?.pageId ?? null,
      actorIndex, pageIndex, currentActorIndex: actorIndex, currentPageIndex: pageIndex,
      sequenceIndex: pair ? this.sequence.findIndex(item => pairKey(item) === state.activePageId) : -1,
      sequence: this.sequence.map(item => ({ ...item })),
      availableActorUuids: [...new Set(this.sequence.map(item => item.actorUuid))],
      availablePageIds: [...new Set(this.sequence.map(item => item.pageId))],
      running: this.settings.mode !== "static" && state.running };
  }

  emit() {
    const state = this.getState();
    try { this.onState(state); } catch (error) { this.report(error); }
    return state;
  }

  async present({ from: fromKey, to: toKey, initial, generation, isCurrent }) {
    const from = pairFromKey(fromKey), to = pairFromKey(toKey);
    const actorChanged = Boolean(from && to && from.actorUuid !== to.actorUuid);
    let animate = false;
    try { animate = !initial && this.controller.visible && this.canAnimate() === true; } catch (error) { this.report(error); }
    const configured = actorChanged ? this.settings.characterTransition : this.settings.transition;
    const configuredDuration = actorChanged ? this.settings.characterTransitionDuration : this.settings.transitionDuration;
    const transition = animate && configuredDuration > 0 ? configured : "instant";
    const duration = transition === "instant" ? 0 : configuredDuration;
    await this.onStep({ from, to, actorChanged, transition, duration, initial, generation, isCurrent });
  }

  async start() {
    if (this.controller.destroyed || this.controller.started) return this.getState();
    this.rebuild();
    await this.controller.start();
    return this.getState();
  }

  pause() { this.controller.pause(); return this.getState(); }

  async resume() {
    if (this.controller.destroyed) return this.getState();
    if (this.settings.mode === "static") return this.pause();
    this.rebuild();
    this.controller.paused = false;
    this.controller.ended = false;
    if (this.controller.remaining === 0) this.controller.remaining = this.controller.dwell();
    if (!this.controller.started) return this.start();
    await this.refreshAvailability();
    this.controller.schedule();
    return this.emit();
  }

  async select(pageId, actorUuid = undefined) {
    if (this.controller.destroyed) return this.getState();
    if (!this.controller.started) await this.start();
    if (!this.pages.some(page => page.id === pageId) || actorUuid !== undefined && !this.actors.includes(actorUuid)) return this.getState();
    const current = pairFromKey(this.controller.activePageId);
    const targetActor = actorUuid ?? current?.actorUuid ?? this.startPair()?.actorUuid;
    const priorActor = this.selectedActorUuid, priorPage = this.selectedPageId;
    if (this.settings.mode === "information" || this.settings.mode === "static") this.selectedActorUuid = targetActor;
    if (this.settings.mode === "character" || this.settings.mode === "static") this.selectedPageId = pageId;
    this.rebuild();
    const pair = this.sequence.find(item => item.actorUuid === targetActor && item.pageId === pageId);
    if (!pair) {
      this.selectedActorUuid = priorActor; this.selectedPageId = priorPage; this.rebuild();
      return this.getState();
    }
    await this.controller.select(pairKey(pair));
    return this.getState();
  }

  async selectActor(actorUuid) {
    if (this.controller.destroyed || !this.actors.includes(actorUuid)) return this.getState();
    if (!this.controller.started) await this.start();
    const current = pairFromKey(this.controller.activePageId);
    const pages = [...this.pages].sort((left, right) => Number(right.id === current?.pageId) - Number(left.id === current?.pageId));
    for (const page of pages) {
      let eligible = true;
      try { eligible = this.isActorAvailable(actorUuid) === true && (!page.skipIfUnavailable || this.isEligible(actorUuid, page) === true); }
      catch (error) { this.report(error); eligible = false; }
      if (eligible) return this.select(page.id, actorUuid);
    }
    return this.getState();
  }

  async navigate(direction) {
    if (this.controller.destroyed) return this.getState();
    if (!this.controller.started) await this.start();
    this.rebuild();
    await this.controller.navigate(direction);
    return this.getState();
  }

  next() { return this.navigate(1); }
  previous() { return this.navigate(-1); }

  /** Test and manual controls can change one axis without advancing the other. */
  async navigatePage(direction) {
    if (this.controller.destroyed) return this.getState();
    if (!this.controller.started) await this.start();
    const actorUuid = this.getState().activeActorUuid ?? this.startPair()?.actorUuid;
    if (!actorUuid) return this.getState();
    const pages = this.pages.filter(page => {
      try { return this.isActorAvailable(actorUuid) === true && (!page.skipIfUnavailable || this.isEligible(actorUuid, page) === true); }
      catch (error) { this.report(error); return false; }
    });
    if (!pages.length) return this.getState();
    const index = pages.findIndex(page => page.id === this.getState().activePageId);
    let next = index < 0 ? 0 : index + direction;
    next = this.settings.loop ? (next + pages.length) % pages.length : Math.max(0, Math.min(pages.length - 1, next));
    return this.select(pages[next].id, actorUuid);
  }

  async navigateActor(direction) {
    if (this.controller.destroyed) return this.getState();
    if (!this.controller.started) await this.start();
    const actors = this.actors.filter(actorUuid => this.pages.some(page => {
      try { return this.isActorAvailable(actorUuid) === true && (!page.skipIfUnavailable || this.isEligible(actorUuid, page) === true); }
      catch (error) { this.report(error); return false; }
    }));
    if (!actors.length) return this.getState();
    const index = actors.indexOf(this.getState().activeActorUuid);
    let next = index < 0 ? 0 : index + direction;
    next = this.settings.loop ? (next + actors.length) % actors.length : Math.max(0, Math.min(actors.length - 1, next));
    return this.selectActor(actors[next]);
  }

  nextPage() { return this.navigatePage(1); }
  previousPage() { return this.navigatePage(-1); }
  nextActor() { return this.navigateActor(1); }
  previousActor() { return this.navigateActor(-1); }

  async reset() {
    if (this.controller.destroyed) return this.getState();
    this.selectedActorUuid = this.selectedPageId = null;
    this.rebuild();
    if (!this.controller.started) return this.start();
    const pair = this.startPair();
    if (!pair) await this.controller.change(null, { initial: true });
    else await this.controller.select(pairKey(pair));
    return this.getState();
  }

  async refreshAvailability() {
    if (this.controller.destroyed) return this.getState();
    const priorOrder = this.sequence, currentKey = this.controller.activePageId;
    this.rebuild();
    if (!this.controller.started) return this.getState();
    if (this.sequence.some(pair => pairKey(pair) === currentKey)) {
      if (this.sequence.length < 2) this.controller.suspend();
      else this.controller.schedule();
      return this.emit();
    }
    if (currentKey === null && !this.sequence.length) return this.emit();
    const priorIndex = priorOrder.findIndex(pair => pairKey(pair) === currentKey);
    const next = priorOrder.slice(priorIndex + 1).find(pair => this.sequence.some(item => pairKey(item) === pairKey(pair)))
      ?? this.startPair();
    await this.controller.change(next ? pairKey(next) : null, { initial: true });
    return this.getState();
  }

  async setVisible(visible) {
    if (this.controller.destroyed || this.controller.visible === Boolean(visible)) return this.getState();
    this.controller.visible = Boolean(visible);
    if (!this.controller.visible) this.controller.suspend();
    else { await this.refreshAvailability(); this.controller.schedule(); }
    return this.emit();
  }

  destroy() {
    if (this.controller.destroyed) return this.getState();
    this.sequence = []; this.actors = []; this.pages = [];
    this.controller.destroy();
    this.onStep = this.onState = this.onCancel = () => {};
    this.isEligible = this.isActorAvailable = () => false;
    return this.getState();
  }
}
