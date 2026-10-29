/** Serializable information pages; deliberately independent of Foundry and Actor documents. */
import { isDemoReference } from "../demo/identities.js";

export const PAGE_LIMIT = 20;
export const ACTOR_LIMIT = 20;
export const COMPONENT_LIMIT = 100;
export const CAROUSEL_MODES = Object.freeze(["static", "information", "character", "combined"]);
export const CAROUSEL_TRAVERSALS = Object.freeze(["pages-first", "characters-first"]);
/**
 * Page and character transitions: the incoming page's entrance, the outgoing page's exit and how
 * they meet. "together" plays both at once; "over" reveals the incoming page above the outgoing
 * one, which is hidden afterwards; "sequence" plays the exit, then the entrance, each for half the
 * duration. Character changes always play exit, then entrance.
 */
const transition = (id, label, entrance = "", exit = "", mode = "together") => Object.freeze({ id, label, entrance, exit, mode });
export const PAGE_TRANSITIONS = Object.freeze([
  transition("fade", "Fade", "fade-in", "fade-out"),
  transition("fade-over", "Fade Over", "fade-in", "fade-out", "over"),
  transition("slide-left", "Slide Left", "slide-in-right", "slide-out-left"),
  transition("slide-right", "Slide Right", "slide-in-left", "slide-out-right"),
  transition("slide-up", "Slide Up", "slide-in-bottom", "slide-out-top"),
  transition("slide-down", "Slide Down", "slide-in-top", "slide-out-bottom"),
  transition("scale", "Scale", "scale-in", "scale-out"),
  transition("zoom-in", "Zoom Through", "scale-in", "grow-out"),
  transition("zoom-out", "Zoom Back", "shrink-in", "scale-out"),
  transition("blur", "Blur", "blur-in", "blur-out"),
  transition("flip-horizontal", "Flip Horizontal", "flip-in-y", "flip-out-y", "sequence"),
  transition("flip-vertical", "Flip Vertical", "flip-in-x", "flip-out-x", "sequence"),
  transition("rotate", "Rotate", "rotate-in", "rotate-out", "sequence"),
  transition("drop", "Drop", "drop-in", "fall-out", "sequence"),
  transition("wipe-left", "Wipe Left", "wipe-in-right", "wipe-out-left", "over"),
  transition("wipe-right", "Wipe Right", "wipe-in-left", "wipe-out-right", "over"),
  transition("wipe-up", "Wipe Up", "wipe-in-bottom", "wipe-out-top", "over"),
  transition("wipe-down", "Wipe Down", "wipe-in-top", "wipe-out-bottom", "over"),
  transition("circle", "Circle Reveal", "circle-in", "circle-out", "over"),
  transition("glitch", "Glitch", "glitch-in", "glitch-out", "sequence"),
  transition("instant", "Instant Switch")
]);
export const TRANSITION_IDS = Object.freeze(PAGE_TRANSITIONS.map(entry => entry.id));
/** The transition's effects, or null for an instant switch or an unknown ID. */
export function transitionEffects(id) {
  const entry = PAGE_TRANSITIONS.find(value => value.id === id);
  return entry?.entrance ? entry : null;
}
const TRANSITIONS = new Set(TRANSITION_IDS);
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be a plain object.`);
  if (Object.keys(value).some(key => FORBIDDEN.has(key))) throw new TypeError(`${label} contains an unsafe property.`);
  return value;
}
function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value) || value !== value.trim() || FORBIDDEN.has(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}
function name(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError("Page name must contain 1–80 printable characters.");
  return value.trim();
}
function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${label} must be an integer between ${min} and ${max}.`);
  return value;
}
function bool(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be true or false.`);
  return value;
}
function choice(value, options, label) {
  if (!options.includes(value)) throw new TypeError(`Choose a supported ${label}.`);
  return value;
}
function actorUuid(value, dataSource = "actors") {
  if (dataSource === "demo" && isDemoReference(value)) return value;
  if (typeof value !== "string" || !/^Actor\.[A-Za-z0-9_-]{1,64}$/.test(value)) throw new TypeError("Choose a world Actor UUID such as Actor.abc123.");
  if (dataSource === "demo") throw new TypeError("DEMO DATA accepts only the bundled synthetic characters.");
  return value;
}

export function validateDataSource(value = "actors") {
  if (!["actors", "demo"].includes(value)) throw new TypeError("Choose Foundry Actors or DEMO DATA as the character source.");
  return value;
}

/** Persistent Actor assignments belong to instances, never reusable designs. */
export function validateActorUuids(input = [], { dataSource = "actors" } = {}) {
  validateDataSource(dataSource);
  if (!Array.isArray(input) || input.length > ACTOR_LIMIT) throw new TypeError(`Assigned characters must be a list with at most ${ACTOR_LIMIT} entries.`);
  const actors = input.map(value => actorUuid(value, dataSource));
  if (new Set(actors).size !== actors.length) throw new TypeError("Assigned characters contain duplicate Actor UUIDs.");
  return actors;
}
function newId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`;
}
function copy(value) {
  const seen = new Set();
  let nodes = 0;
  function visit(entry, depth = 0) {
    if (++nodes > 100000 || depth > 24) throw new TypeError("Page configuration is too large or deeply nested.");
    if (entry === null || typeof entry === "boolean" || typeof entry === "string") return entry;
    if (typeof entry === "number" && Number.isFinite(entry)) return entry;
    if (!entry || typeof entry !== "object") throw new TypeError("Page configuration requires JSON values.");
    if (seen.has(entry)) throw new TypeError("Page configuration must not be circular.");
    seen.add(entry);
    const result = Array.isArray(entry) ? entry.map(item => visit(item, depth + 1))
      : Object.fromEntries(Object.entries(record(entry, "Page configuration")).map(([key, item]) => [key, visit(item, depth + 1)]));
    seen.delete(entry);
    return result;
  }
  return visit(value);
}

/** The core supplies its established component validator, avoiding a schema import cycle. */
export function validatePages(input = [], { canvas, normalizeLayer, sharedLayers = [] } = {}) {
  if (!Array.isArray(input) || input.length > PAGE_LIMIT) throw new TypeError(`Widget pages must be a list with at most ${PAGE_LIMIT} entries.`);
  if (typeof normalizeLayer !== "function") throw new TypeError("Page validation requires a component validator.");
  const pageIds = new Set();
  const componentIds = new Set(sharedLayers.map(layer => layer.id));
  let components = sharedLayers.length;
  return input.map(page => {
    record(page, "Widget page");
    const id = identifier(page.id, "Page ID");
    if (pageIds.has(id)) throw new TypeError("Widget pages contain duplicate IDs.");
    pageIds.add(id);
    if (Object.hasOwn(page, "pages") || Object.hasOwn(page, "cycling")) throw new TypeError("Widget pages cannot recursively contain pages or cycling settings.");
    if (page.widgets !== undefined && (!Array.isArray(page.widgets) || page.widgets.length)) throw new TypeError("Widget pages cannot contain legacy widgets.");
    const layers = page.layers ?? [];
    if (!Array.isArray(layers) || (components += layers.length) > COMPONENT_LIMIT) throw new TypeError(`A widget supports at most ${COMPONENT_LIMIT} components across shared elements and pages.`);
    return {
      id, name: name(page.name ?? "Information page"),
      enabled: bool(page.enabled ?? true, "Page enabled"),
      duration: page.duration === undefined || page.duration === null ? null : integer(page.duration, "Page duration", 100, 3600000),
      skipIfUnavailable: bool(page.skipIfUnavailable ?? false, "Skip unavailable page"),
      layers: layers.map((entry, index) => {
        record(entry, "Page component");
        if (entry.type === "character-widget") throw new TypeError("Widget pages cannot contain nested widget instances.");
        if (Object.hasOwn(entry, "pages") || Object.hasOwn(entry, "widgets") || Object.hasOwn(entry, "cycling")) throw new TypeError("Page components cannot contain recursive pages or legacy widgets.");
        const layer = normalizeLayer(entry, canvas, index);
        if (componentIds.has(layer.id)) throw new TypeError("Widget components contain duplicate IDs across shared elements and pages.");
        componentIds.add(layer.id);
        return layer;
      })
    };
  });
}

export function validateCycling(input = {}, pages = []) {
  record(input, "Cycling settings");
  const transition = input.transition ?? "fade";
  if (!TRANSITIONS.has(transition)) throw new TypeError("Choose a supported page transition.");
  const startPageId = input.startPageId === undefined || input.startPageId === null ? null : identifier(input.startPageId, "Starting page ID");
  if (startPageId !== null && !pages.some(page => page.id === startPageId)) throw new TypeError("The starting page does not exist in this widget.");
  return {
    enabled: bool(input.enabled ?? false, "Automatic cycling"),
    mode: choice(input.mode ?? "information", CAROUSEL_MODES, "cycling mode"),
    traversal: choice(input.traversal ?? "pages-first", CAROUSEL_TRAVERSALS, "carousel traversal"),
    duration: integer(input.duration ?? 5000, "Default page duration", 100, 3600000),
    transition, transitionDuration: integer(input.transitionDuration ?? 400, "Page transition duration", 0, 10000),
    characterTransition: choice(input.characterTransition ?? "fade", [...TRANSITIONS], "character transition"),
    characterTransitionDuration: integer(input.characterTransitionDuration ?? 500, "Character transition duration", 0, 10000),
    loop: bool(input.loop ?? true, "Loop pages"), startPageId
  };
}

/** Null fields inherit the reusable design; no playback position is persisted. */
export function validateInstanceCarousel(input = {}, { actors, dataSource = "actors" } = {}) {
  validateDataSource(dataSource);
  record(input, "Instance carousel settings");
  const optional = (key, validate) => input[key] === undefined || input[key] === null ? null : validate(input[key]);
  const pageOrder = input.pageOrder ?? [];
  if (!Array.isArray(pageOrder) || pageOrder.length > PAGE_LIMIT) throw new TypeError(`Page order supports at most ${PAGE_LIMIT} pages.`);
  const order = pageOrder.map(id => identifier(id, "Ordered page ID"));
  if (new Set(order).size !== order.length) throw new TypeError("Page order contains duplicate IDs.");
  const pageDurations = record(input.pageDurations ?? {}, "Page duration overrides");
  if (Object.keys(pageDurations).length > PAGE_LIMIT) throw new TypeError(`Page duration overrides support at most ${PAGE_LIMIT} pages.`);
  const durations = Object.fromEntries(Object.entries(pageDurations).map(([id, value]) => [
    identifier(id, "Duration page ID"), integer(value, "Page duration override", 100, 3600000)
  ]));
  const actorStartUuid = optional("actorStartUuid", value => actorUuid(value, dataSource));
  if (actors && actorStartUuid !== null && !actors.includes(actorStartUuid)) throw new TypeError("The starting character must be assigned to this widget.");
  return {
    enabled: optional("enabled", value => bool(value, "Instance automatic cycling")),
    mode: optional("mode", value => choice(value, CAROUSEL_MODES, "cycling mode")),
    traversal: optional("traversal", value => choice(value, CAROUSEL_TRAVERSALS, "carousel traversal")),
    actorStartUuid, pageOrder: order,
    startPageId: optional("startPageId", value => identifier(value, "Starting page ID")),
    duration: optional("duration", value => integer(value, "Instance page duration", 100, 3600000)),
    pageDurations: durations,
    transition: optional("transition", value => choice(value, [...TRANSITIONS], "page transition")),
    transitionDuration: optional("transitionDuration", value => integer(value, "Instance page transition duration", 0, 10000)),
    characterTransition: optional("characterTransition", value => choice(value, [...TRANSITIONS], "character transition")),
    characterTransitionDuration: optional("characterTransitionDuration", value => integer(value, "Instance character transition duration", 0, 10000)),
    loop: optional("loop", value => bool(value, "Instance loop"))
  };
}

/** One shared resolution contract for the renderer, local preview, and live controls. */
export function resolveCarouselSettings(instance = {}, preset = {}) {
  record(instance, "Widget instance");
  record(preset, "Widget preset");
  const dataSource = validateDataSource(instance.dataSource);
  const actors = Object.hasOwn(instance, "actorUuids") ? validateActorUuids(instance.actorUuids, { dataSource })
    : instance.actorUuid ? validateActorUuids([instance.actorUuid], { dataSource }) : [];
  const overrides = validateInstanceCarousel(instance.carousel, { actors, dataSource });
  if (!Array.isArray(preset.pages ?? []) || (preset.pages ?? []).length > PAGE_LIMIT) throw new TypeError(`Widget pages must be a list with at most ${PAGE_LIMIT} entries.`);
  const sourcePages = (preset.pages ?? []).map(page => {
    record(page, "Widget page");
    return {
      ...copy(page), id: identifier(page.id, "Page ID"), enabled: bool(page.enabled ?? true, "Page enabled"),
      duration: page.duration === undefined || page.duration === null ? null : integer(page.duration, "Page duration", 100, 3600000),
      skipIfUnavailable: bool(page.skipIfUnavailable ?? false, "Skip unavailable page")
    };
  });
  if (new Set(sourcePages.map(page => page.id)).size !== sourcePages.length) throw new TypeError("Widget pages contain duplicate IDs.");
  const defaults = validateCycling(preset.cycling, sourcePages);
  const settings = { ...defaults };
  for (const key of ["enabled", "mode", "traversal", "duration", "transition", "transitionDuration", "characterTransition", "characterTransitionDuration", "loop", "startPageId"]) {
    if (overrides[key] !== null) settings[key] = overrides[key];
  }
  const orderedIds = [...overrides.pageOrder, ...sourcePages.map(page => page.id).filter(id => !overrides.pageOrder.includes(id))];
  const pages = orderedIds.map(id => sourcePages.find(page => page.id === id)).filter(page => page?.enabled).map(page => ({
    ...page, duration: overrides.pageDurations[page.id] ?? page.duration ?? null
  }));
  settings.pageOrder = pages.map(page => page.id);
  settings.pageDurations = Object.fromEntries(pages.filter(page => Object.hasOwn(overrides.pageDurations, page.id)).map(page => [page.id, overrides.pageDurations[page.id]]));
  settings.startPageId = pages.some(page => page.id === settings.startPageId) ? settings.startPageId : pages[0]?.id ?? null;
  settings.actorStartUuid = overrides.actorStartUuid ?? actors[0] ?? null;
  if (settings.mode === "static") settings.enabled = false;
  return { actors, pages, settings };
}

export function validateCarousel(input, options) {
  const pages = validatePages(input.pages, options);
  return { pages, cycling: validateCycling(input.cycling, pages) };
}

export function createPage(pageName = "New information page") {
  return { id: newId("page"), name: name(pageName), enabled: true, duration: null, skipIfUnavailable: false, layers: [] };
}

function pagesOf(draft) {
  record(draft, "Widget draft");
  if (draft.pages === undefined) draft.pages = [];
  if (!Array.isArray(draft.pages)) throw new TypeError("Widget pages must be a list.");
  return draft.pages;
}
function componentCount(draft) { return (draft.layers?.length ?? 0) + pagesOf(draft).reduce((count, page) => count + (page.layers?.length ?? 0), 0); }

/** Draft helpers never save settings or bind Actors. */
export function addPage(draft, pageName) {
  const pages = pagesOf(draft);
  if (pages.length >= PAGE_LIMIT) throw new RangeError(`A widget supports at most ${PAGE_LIMIT} pages.`);
  const page = createPage(pageName);
  pages.push(page);
  return page;
}

export function duplicatePage(draft, id) {
  const pages = pagesOf(draft);
  const source = pages.find(page => page.id === id);
  if (!source) return null;
  if (pages.length >= PAGE_LIMIT) throw new RangeError(`A widget supports at most ${PAGE_LIMIT} pages.`);
  if (componentCount(draft) + source.layers.length > COMPONENT_LIMIT) throw new RangeError(`A widget supports at most ${COMPONENT_LIMIT} components across shared elements and pages.`);
  const duplicate = copy(source);
  const ids = new Set([...pages.map(page => page.id), ...(draft.layers ?? []).map(layer => layer.id), ...pages.flatMap(page => page.layers.map(layer => layer.id))]);
  const fresh = prefix => { let value; do { value = newId(prefix); } while (ids.has(value)); ids.add(value); return value; };
  duplicate.id = fresh("page");
  duplicate.name = `${source.name.slice(0, 75)} copy`;
  const replacements = new Map(duplicate.layers.map(layer => [layer.id, fresh("layer")]));
  for (const layer of duplicate.layers) {
    layer.id = replacements.get(layer.id);
    for (const trigger of layer.triggers ?? []) {
      if (replacements.has(trigger.action?.target)) trigger.action.target = replacements.get(trigger.action.target);
    }
  }
  pages.splice(pages.indexOf(source) + 1, 0, duplicate);
  return duplicate;
}

export function renamePage(draft, id, pageName) {
  const page = pagesOf(draft).find(entry => entry.id === id);
  if (!page) return false;
  page.name = name(pageName);
  return true;
}

export function deletePage(draft, id) {
  const pages = pagesOf(draft);
  const index = pages.findIndex(page => page.id === id);
  if (index < 0) return false;
  pages.splice(index, 1);
  if (draft.cycling?.startPageId === id) draft.cycling.startPageId = null;
  return true;
}

export function reorderPage(draft, id, action) {
  if (!["up", "down", "first", "last"].includes(action)) throw new TypeError("Page order action must be up, down, first, or last.");
  const pages = pagesOf(draft);
  const index = pages.findIndex(page => page.id === id);
  if (index < 0) return false;
  const next = action === "first" ? 0 : action === "last" ? pages.length - 1 : index + (action === "up" ? -1 : 1);
  if (next < 0 || next >= pages.length || next === index) return false;
  pages.splice(next, 0, ...pages.splice(index, 1));
  return true;
}
