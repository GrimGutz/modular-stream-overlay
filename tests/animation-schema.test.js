import test from "node:test";
import assert from "node:assert/strict";
import {
  ANIMATION_DEFINITIONS, EASINGS, TRIGGER_EVENTS, CONDITION_OPERATORS, ACTION_TYPES,
  validateAnimationConfig, validateAnimationSettings, validateTriggerRules, createAnimationExamples
} from "../scripts/animation/schema.js";
import { SCHEMA_VERSION, WIDGET_PRESET_SCHEMA_VERSION, clone, createOverlay, createState, validateLayer, validateOverlay, validateState } from "../scripts/core/schema.js";
import { createLayer, createWidgetInstance, duplicateLayer } from "../scripts/core/layers.js";
import { OverlayStore } from "../scripts/core/store.js";
import { createWidgetPreset, createWidgetPresetState, validateWidgetPresetState, widgetPresetToOverlay, overlayToWidgetPreset, WidgetPresetStore } from "../scripts/core/widget-presets.js";

const flash = () => validateAnimationConfig({ type: "color-flash", duration: 400, color: "#ff4444" });
const damageRule = () => ({ id: "damage", name: "Damage", event: "decreased", field: "character.hp.current", action: { type: "color-flash", target: "portrait", animation: flash() } });

test("animation metadata covers supported types, presets and bounded editable defaults", () => {
  assert.equal(ANIMATION_DEFINITIONS.length, 20);
  assert.equal(new Set(ANIMATION_DEFINITIONS.map(entry => entry.type)).size, ANIMATION_DEFINITIONS.length);
  assert.equal(ANIMATION_DEFINITIONS.filter(entry => entry.category === "entrance").length, 7);
  assert.equal(ANIMATION_DEFINITIONS.filter(entry => entry.category === "exit").length, 6);
  assert.equal(ANIMATION_DEFINITIONS.filter(entry => entry.category === "emphasis").length, 7);
  assert.deepEqual(EASINGS, ["linear", "ease-in", "ease-out", "ease-in-out"]);
  assert.equal(TRIGGER_EVENTS.includes("manual"), true);
  assert.equal(CONDITION_OPERATORS.includes("crossed-below"), true);
  assert.equal(ACTION_TYPES.includes("animate-number"), true);
  assert.equal(Object.isFrozen(ANIMATION_DEFINITIONS), true);
  assert.equal(Object.isFrozen(ANIMATION_DEFINITIONS[0]), true);
  for (const definition of ANIMATION_DEFINITIONS) assert.equal(validateAnimationConfig({ type: definition.type }).type, definition.type);
  const examples = createAnimationExamples();
  assert.deepEqual(examples.map(entry => entry.name), ["Soft Entrance", "Damage Flash", "Healing Flash", "Low Health Warning", "Slide Entrance"]);
  assert.equal(examples[3].trigger.continuous, true);
  assert.equal(examples[3].trigger.condition.value, 25);
  examples[1].trigger.action.animation.color = "#000000";
  assert.equal(createAnimationExamples()[1].trigger.action.animation.color, "#ff4444");
});

test("animation settings preserve immediate legacy behavior and copy every optional parameter", () => {
  const defaults = validateAnimationSettings();
  assert.deepEqual(defaults, { entrance: null, exit: null, emphasis: null, transition: { duration: 0, easing: "ease-out", numeric: false, bar: true, color: false, opacity: false } });
  const input = {
    entrance: { type: "slide-in-left", duration: 10000, delay: 10000, repeat: 5, easing: "linear", direction: "alternate", intensity: 2 },
    exit: { type: "fade-out", duration: 1 }, emphasis: flash(),
    transition: { duration: 10000, easing: "ease-in-out", numeric: true, bar: false, color: true, opacity: true }
  };
  const result = validateAnimationSettings(input);
  assert.equal(result.entrance.delay + result.entrance.duration * result.entrance.repeat, 60000);
  assert.equal(result.exit.duration, 1);
  assert.equal(result.emphasis.color, "#ff4444");
  assert.deepEqual(result.transition, input.transition);
  result.emphasis.color = "#fff";
  assert.equal(input.emphasis.color, "#ff4444");
  assert.deepEqual(defaults, validateAnimationSettings());
});

test("animation timing rejects invalid durations, loops, easing, colors and unsafe records", () => {
  for (const patch of [
    { duration: 0 }, { duration: -1 }, { duration: 10001 }, { duration: Infinity }, { duration: "400" },
    { delay: -1 }, { delay: 10001 }, { delay: NaN }, { repeat: Infinity }, { repeat: 0 }, { repeat: 21 }, { repeat: 1.5 },
    { duration: 10000, repeat: 6, delay: 1 }, { intensity: -0.1 }, { intensity: 2.1 },
    { easing: "cubic-bezier(0,0,1,1)" }, { direction: "alternate-reverse" }, { color: "red" }, { color: "url(secret)" },
    { type: "shake;alert()" }, { type: "constructor" }
  ]) assert.throws(() => validateAnimationConfig(patch), TypeError, JSON.stringify(patch));
  for (const input of [null, [], new Date(), JSON.parse('{"__proto__":{}}')]) assert.throws(() => validateAnimationConfig(input), TypeError);
  for (const patch of [{ duration: -1 }, { duration: 10001 }, { easing: "unknown" }, { numeric: "true" }, { color: 1 }]) assert.throws(() => validateAnimationSettings({ transition: patch }), TypeError);
  assert.throws(() => validateAnimationSettings({ entrance: [] }), TypeError);
  assert.equal(validateAnimationConfig({ type: "extension:drift", intensity: 0 }).type, "extension:drift");
});

test("triggers support declarative comparisons, safe extension IDs and continuous level conditions", () => {
  const rules = validateTriggerRules([
    damageRule(),
    { id: "threshold", event: "crossed-below", field: "character.hp.percent", condition: { operator: "crossed-below", value: 25 }, action: { type: "play-animation", animation: { type: "pulse" } } },
    { id: "low", event: "field-changed", field: "character.hp.percent", condition: { operator: "lt", value: 25 }, action: { type: "glow" }, continuous: true },
    { id: "manual", event: "manual", action: { type: "show" } },
    { id: "custom", event: "extension:custom-event", condition: { field: "character.type", operator: "eq", value: "hero" }, action: { type: "extension:custom-action" } }
  ]);
  assert.equal(rules[0].enabled, true);
  assert.equal(rules[0].continuous, false);
  assert.equal(rules[1].condition.value, 25);
  assert.equal(rules[2].continuous, true);
  assert.equal(rules[3].field, "");
  assert.equal(rules[3].action.target, "self");
  assert.equal(rules[4].condition.field, "character.type");
  for (const operator of CONDITION_OPERATORS) assert.doesNotThrow(() => validateTriggerRules([{ ...damageRule(), condition: { operator, value: 10 } }]));
  assert.equal(validateTriggerRules([{ ...damageRule(), condition: { operator: "increased" } }])[0].condition.value, null);
  const original = damageRule();
  const result = validateTriggerRules([original]);
  result[0].action.animation.color = "#000000";
  assert.equal(original.action.animation.color, "#ff4444");
});

test("trigger validation rejects expressions, missing thresholds, unsafe data and uncontrolled effects", () => {
  const base = damageRule();
  for (const patch of [
    { field: "system.attributes.hp.value" }, { field: "character.hp.current + 1" }, { field: "character.__proto__.value" }, { field: "" },
    { enabled: "true" }, { continuous: "true" }, { event: "on update" }, { id: "constructor" },
    { event: "crossed-below", condition: null }, { event: "crossed-above", condition: { operator: "eq", value: "25" } },
    { condition: { operator: "lt", value: "25" } }, { condition: { operator: "eq", value: {} } },
    { condition: { operator: "eq", value: () => {} } }, { condition: { operator: "eval", value: 3 } },
    { condition: { operator: "eq", value: Infinity } }, { condition: { operator: "eq", value: "x".repeat(1001) } },
    { action: { type: "play-animation", target: "<script>" } }, { action: { type: "play-animation", animation: { repeat: -1 } } },
    { continuous: true, event: "manual", field: "character.hp.current", condition: { operator: "lt", value: 25 } },
    { continuous: true, condition: { operator: "lt", value: 25 }, action: { type: "hide" } }
  ]) assert.throws(() => validateTriggerRules([{ ...base, ...patch }]), TypeError, JSON.stringify(patch));
  assert.throws(() => validateTriggerRules([{ id: "manual", event: "manual", condition: { operator: "eq", value: 3 }, action: { type: "show" } }]), /normalized character field/);
  assert.throws(() => validateTriggerRules([base, base]), /duplicate/);
  assert.throws(() => validateTriggerRules(Array.from({ length: 33 }, (_, index) => ({ ...base, id: `rule-${index}` }))), /32/);
  assert.throws(() => validateTriggerRules([JSON.parse('{"id":"unsafe","__proto__":{}}')]), /unsafe/);
  assert.throws(() => validateTriggerRules({}), /32/);
});

test("overlay schemas 1 through 5 migrate animation defaults in memory without saving", () => {
  for (const schemaVersion of [1, 2, 3, 4, 5]) {
    const overlay = createOverlay(`Version ${schemaVersion}`);
    overlay.schemaVersion = schemaVersion;
    delete overlay.animations;
    delete overlay.triggers;
    overlay.layers.push({ id: "legacy-image", type: "image", src: "worlds/example/frame.webp" });
    const state = { ...createState(), schemaVersion, overlays: [overlay], activeOverlayId: overlay.id };
    const original = clone(state);
    const writes = [];
    const store = new OverlayStore({ settings: { get: () => state, set: (...args) => writes.push(args) }, getUser: () => ({ isGM: true }) });
    const result = store.getState();
    assert.equal(result.schemaVersion, SCHEMA_VERSION);
    assert.equal(result.overlays[0].schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(result.overlays[0].layers[0].animations, validateAnimationSettings());
    assert.deepEqual(result.overlays[0].layers[0].triggers, []);
    assert.deepEqual(state, original);
    assert.deepEqual(writes, []);
  }
});

test("widget preset version migration preserves configuration and never writes while reading", () => {
  const legacy = createWidgetPresetState();
  legacy.schemaVersion = 1;
  for (const preset of legacy.presets) {
    preset.schemaVersion = 1;
    delete preset.animations;
    delete preset.triggers;
    for (const component of preset.layers) { delete component.animations; delete component.triggers; }
  }
  const original = clone(legacy);
  let writes = 0;
  const store = new WidgetPresetStore({ settings: { get: () => legacy, set: () => { writes++; } }, getUser: () => ({ isGM: true }) });
  const result = store.getState();
  assert.equal(result.schemaVersion, WIDGET_PRESET_SCHEMA_VERSION);
  assert.equal(result.presets[0].schemaVersion, WIDGET_PRESET_SCHEMA_VERSION);
  assert.deepEqual(result.presets[0].animations, validateAnimationSettings());
  assert.deepEqual(result.presets[0].layers[0].animations, validateAnimationSettings());
  assert.deepEqual(validateWidgetPresetState(result), result);
  assert.deepEqual(legacy, original);
  assert.equal(writes, 0);
});

test("shared presets, instances, component overrides and overlay presets round trip animations independently", async () => {
  const preset = createWidgetPreset("Animated card");
  preset.layers = [{ ...createLayer("character-portrait", preset.canvas), id: "portrait", animations: validateAnimationSettings({ emphasis: flash() }), triggers: validateTriggerRules([damageRule()]) }];
  preset.animations = validateAnimationSettings({ entrance: { type: "fade-in" }, transition: { duration: 400, numeric: true } });
  preset.triggers = validateTriggerRules([damageRule()]);
  const design = widgetPresetToOverlay(preset);
  assert.deepEqual(design.animations, preset.animations);
  assert.deepEqual(design.triggers, preset.triggers);
  assert.deepEqual(overlayToWidgetPreset(design), preset);
  const overlay = createOverlay();
  overlay.animations = validateAnimationSettings({ entrance: { type: "slide-in-left" } });
  overlay.triggers = validateTriggerRules([{ id: "show", event: "manual", action: { type: "show" } }]);
  const first = createWidgetInstance(preset, { actorUuid: "Actor.first", animationOverrides: true, animations: validateAnimationSettings({ entrance: { type: "pop-in" } }), triggers: validateTriggerRules([damageRule()]), overrides: { portrait: { animations: validateAnimationSettings({ emphasis: { type: "glow" } }), triggers: validateTriggerRules([damageRule()]) } } });
  const second = createWidgetInstance(preset, { actorUuid: "Actor.second" });
  overlay.layers = [first, second];
  const copy = duplicateLayer(overlay, first.id);
  copy.triggers[0].action.animation.color = "#000000";
  copy.overrides.portrait.animations.emphasis.type = "pulse";
  assert.equal(first.triggers[0].action.animation.color, "#ff4444");
  assert.equal(first.overrides.portrait.animations.emphasis.type, "glow");
  assert.equal(first.actorUuid, "Actor.first");
  assert.equal(second.actorUuid, "Actor.second");
  assert.equal(first.animationOverrides, true);
  assert.equal(second.animationOverrides, false);
  assert.throws(() => validateLayer({ ...first, animationOverrides: "true" }), TypeError);
  assert.equal(first.presetId, second.presetId);
  assert.deepEqual(validateLayer(first), first);
  assert.deepEqual(validateOverlay(overlay), overlay);
  let state = createState();
  const store = new OverlayStore({ settings: { get: () => state, set: async (_namespace, _key, next) => { state = clone(next); } }, getUser: () => ({ isGM: true }) });
  const saved = await store.savePreset(overlay, "Animated party");
  const restored = await store.loadPreset(saved.id);
  assert.deepEqual(restored.layers, overlay.layers);
  assert.deepEqual(restored.animations, overlay.animations);
  assert.deepEqual(restored.triggers, overlay.triggers);
  assert.doesNotThrow(() => validateState(state));
  assert.equal(JSON.stringify(state).includes('"system"'), false);
});
