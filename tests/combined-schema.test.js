import test from "node:test";
import assert from "node:assert/strict";
import { clone, createOverlay, SCHEMA_VERSION, WIDGET_PRESET_SCHEMA_VERSION, validateLayer, validateOverlay, validateState } from "../scripts/core/schema.js";
import { createWidgetInstance, duplicateLayer } from "../scripts/core/layers.js";
import { createWidgetPreset, validateWidgetPreset, validateWidgetPresetState, widgetPresetToOverlay, overlayToWidgetPreset } from "../scripts/core/widget-presets.js";
import { ACTOR_LIMIT, CAROUSEL_MODES, CAROUSEL_TRAVERSALS, PAGE_TRANSITIONS, createPage, resolveCarouselSettings, validateActorUuids, validateCycling, validateInstanceCarousel } from "../scripts/carousel/schema.js";

function card() {
  const preset = createWidgetPreset("Combined card");
  preset.pages = [
    { ...createPage("Basic information"), id: "basic" },
    { ...createPage("Attributes"), id: "attributes", duration: 8000 },
    { ...createPage("Private information"), id: "private", enabled: false }
  ];
  preset.cycling = { ...preset.cycling, enabled: true, mode: "combined" };
  return validateWidgetPreset(preset);
}

test("legacy instance Actor binding migrates without changing storage; explicit empty assignments stay empty", () => {
  const preset = card();
  const legacy = { ...createWidgetInstance(preset), actorUuid: "Actor.A" };
  delete legacy.actorUuids;
  delete legacy.carousel;
  const before = clone(legacy);
  const normalized = validateLayer(legacy);
  assert.deepEqual(normalized.actorUuids, ["Actor.A"]);
  assert.equal(normalized.actorUuid, "Actor.A");
  assert.equal(normalized.carousel.mode, null);
  assert.deepEqual(legacy, before);
  const cleared = validateLayer({ ...legacy, actorUuids: [] });
  assert.deepEqual(cleared.actorUuids, []);
  assert.deepEqual(resolveCarouselSettings(cleared, preset).actors, []);
  assert.deepEqual(resolveCarouselSettings(legacy, preset).actors, ["Actor.A"]);
});

test("ordered assignments and nullable instance overrides round trip separately from reusable designs", () => {
  const preset = card();
  const instance = createWidgetInstance(preset, {
    actorUuid: "Actor.B", actorUuids: ["Actor.B", "Actor.A"],
    carousel: {
      mode: "combined", traversal: "characters-first", enabled: true,
      actorStartUuid: "Actor.A", pageOrder: ["attributes", "basic"], startPageId: "attributes",
      duration: 6000, pageDurations: { basic: 7000 }, transition: "slide-left", transitionDuration: 750,
      characterTransition: "scale", characterTransitionDuration: 900, loop: false
    }
  });
  const overlay = createOverlay();
  overlay.layers = [instance];
  assert.deepEqual(validateOverlay(JSON.parse(JSON.stringify(overlay))).layers[0], instance);
  const copy = duplicateLayer(overlay, instance.id);
  assert.deepEqual(copy.actorUuids, instance.actorUuids);
  assert.deepEqual(copy.carousel, instance.carousel);
  copy.actorUuids.reverse();
  copy.carousel.pageDurations.basic = 9500;
  assert.deepEqual(instance.actorUuids, ["Actor.B", "Actor.A"]);
  assert.equal(instance.carousel.pageDurations.basic, 7000);
  assert.deepEqual(overlayToWidgetPreset(widgetPresetToOverlay(preset)), preset);
  assert.equal(JSON.stringify(preset).includes("Actor."), false);
});

test("one shared resolution merges instance defaults, enabled page order, starts and dwell overrides", () => {
  const preset = card();
  const instance = createWidgetInstance(preset, {
    actorUuids: ["Actor.A", "Actor.B"], carousel: {
      actorStartUuid: "Actor.B", pageOrder: ["attributes", "deleted-page"], startPageId: "private",
      duration: 12000, pageDurations: { basic: 5500, "deleted-page": 6000 }, characterTransition: "slide-up"
    }
  });
  const before = clone({ preset, instance });
  const resolved = resolveCarouselSettings(instance, preset);
  assert.deepEqual(resolved.actors, ["Actor.A", "Actor.B"]);
  assert.deepEqual(resolved.pages.map(page => page.id), ["attributes", "basic"]);
  assert.equal(resolved.settings.mode, "combined");
  assert.equal(resolved.settings.traversal, "pages-first");
  assert.equal(resolved.settings.enabled, true);
  assert.equal(resolved.settings.actorStartUuid, "Actor.B");
  assert.equal(resolved.settings.startPageId, "attributes");
  assert.equal(resolved.settings.duration, 12000);
  assert.equal(resolved.pages[0].duration, 8000);
  assert.equal(resolved.pages[1].duration, 5500);
  assert.deepEqual(resolved.settings.pageDurations, { basic: 5500 });
  assert.equal(resolved.settings.transition, "fade");
  assert.equal(resolved.settings.characterTransition, "slide-up");
  assert.deepEqual({ preset, instance }, before);
  resolved.pages[0].name = "Local clone";
  assert.equal(preset.pages[1].name, "Attributes");
});

test("static mode disables automatic playback while all other modes and both traversals remain declarative", () => {
  assert.deepEqual(CAROUSEL_MODES, ["static", "information", "character", "combined"]);
  assert.deepEqual(CAROUSEL_TRAVERSALS, ["pages-first", "characters-first"]);
  assert.equal(Object.isFrozen(CAROUSEL_MODES), true);
  const preset = card();
  for (const mode of CAROUSEL_MODES) {
    const instance = createWidgetInstance(preset, { actorUuids: ["Actor.A", "Actor.B"], carousel: { mode } });
    const { settings } = resolveCarouselSettings(instance, preset);
    assert.equal(settings.mode, mode);
    assert.equal(settings.enabled, mode !== "static");
  }
  for (const traversal of CAROUSEL_TRAVERSALS) assert.equal(validateCycling({ traversal }).traversal, traversal);
  for (const { id } of PAGE_TRANSITIONS) {
    assert.equal(validateCycling({ characterTransition: id }).characterTransition, id);
    assert.equal(validateInstanceCarousel({ characterTransition: id }).characterTransition, id);
  }
});

test("zero enabled pages and empty assignments have a finite empty resolution; disabled starts fall back safely", () => {
  const preset = card();
  preset.pages.forEach(page => { page.enabled = false; });
  const resolved = resolveCarouselSettings(createWidgetInstance(preset), preset);
  assert.deepEqual(resolved.actors, []);
  assert.deepEqual(resolved.pages, []);
  assert.equal(resolved.settings.actorStartUuid, null);
  assert.equal(resolved.settings.startPageId, null);
  const old = createWidgetPreset("Shared design only");
  assert.deepEqual(resolveCarouselSettings(createWidgetInstance(old), old).pages, []);
  assert.deepEqual(old.pages, []);
});

test("assignment validation rejects duplicates, synthetic or unsafe references, excessive lists and Actor documents", () => {
  assert.equal(validateActorUuids(Array.from({ length: ACTOR_LIMIT }, (_, index) => `Actor.id-${index}`)).length, ACTOR_LIMIT);
  for (const actors of [
    ["Actor.A", "Actor.A"], [""], [" Actor.A"], ["Scene.S.Token.T.Actor.A"], ["Compendium.world.actors.Actor.A"],
    ["Actor.constructor.extra"], [{ uuid: "Actor.A" }], [new Date()], null, {},
    Array.from({ length: ACTOR_LIMIT + 1 }, (_, index) => `Actor.id-${index}`)
  ]) assert.throws(() => validateActorUuids(actors), TypeError);
  const preset = card();
  assert.throws(() => createWidgetInstance(preset, { actorUuids: ["Actor.A"], carousel: { actorStartUuid: "Actor.B" } }), /starting character/);
  assert.throws(() => createWidgetInstance(preset, { actorUuids: [], carousel: { actorStartUuid: "Actor.A" } }), /starting character/);
});

test("instance timing, identities, traversal and transition overrides reject executable and unbounded values", () => {
  const patches = [
    { mode: "random" }, { traversal: "random" }, { enabled: "true" }, { loop: 1 },
    { duration: 99 }, { duration: 3600001 }, { duration: Infinity }, { duration: 100.5 }, { duration: "5000" },
    { transition: "url(script)" }, { characterTransition: "eval()" }, { transitionDuration: -1 },
    { transitionDuration: 10001 }, { characterTransitionDuration: NaN }, { characterTransitionDuration: 500.5 },
    { pageOrder: ["basic", "basic"] }, { pageOrder: ["bad id"] }, { startPageId: "__proto__" },
    { pageDurations: { basic: 0 } }, { pageDurations: { basic: () => 5000 } },
    { pageDurations: JSON.parse('{"__proto__":5000}') }, { pageDurations: new Date() },
    { pageOrder: Array.from({ length: 21 }, (_, index) => `p-${index}`) },
    { pageDurations: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`p-${index}`, 5000])) }
  ];
  for (const patch of patches) assert.throws(() => validateInstanceCarousel(patch), TypeError, JSON.stringify(patch));
  assert.throws(() => validateInstanceCarousel(new Date()), TypeError);
  assert.throws(() => validateInstanceCarousel(JSON.parse('{"constructor":{}}')), TypeError);
  assert.throws(() => validateCycling({ mode: "execute" }), TypeError);
  assert.throws(() => validateCycling({ characterTransitionDuration: 10001 }), TypeError);
  assert.throws(() => validateWidgetPreset({ ...card(), pages: [{ ...card().pages[0], enabled: "true" }] }), TypeError);
});

test("schema migration accepts every previous saved version without persisting runtime state or Actors in presets", () => {
  assert.equal(SCHEMA_VERSION, 6);
  assert.equal(WIDGET_PRESET_SCHEMA_VERSION, 4);
  for (const schemaVersion of [1, 2, 3, 4, 5, 6]) {
    const overlay = { ...createOverlay(), schemaVersion };
    assert.equal(validateOverlay(overlay).schemaVersion, 6);
    assert.equal(validateState({ schemaVersion, revision: 0, activeOverlayId: null, overlays: [overlay], presets: [] }).schemaVersion, 6);
  }
  for (const schemaVersion of [1, 2, 3, 4]) {
    const preset = { ...card(), schemaVersion, actorUuids: ["Actor.secret"], actorStartUuid: "Actor.secret" };
    preset.cycling.actorUuids = ["Actor.secret"];
    preset.cycling.currentActorIndex = 7;
    const normalized = validateWidgetPreset(preset);
    assert.equal(normalized.schemaVersion, 4);
    assert.equal(JSON.stringify(normalized).includes("Actor.secret"), false);
    assert.equal(normalized.cycling.currentActorIndex, undefined);
    assert.equal(validateWidgetPresetState({ schemaVersion, revision: 0, presets: [preset] }).schemaVersion, 4);
  }
  const instance = createWidgetInstance(card(), { actorUuids: ["Actor.A"], carousel: { currentActorIndex: 2, timer: 123, actor: { system: { private: true } } } });
  assert.equal(instance.carousel.currentActorIndex, undefined);
  assert.equal(instance.carousel.timer, undefined);
  assert.equal(instance.carousel.actor, undefined);
});
