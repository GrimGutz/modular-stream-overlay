/** Declarative animation configuration. Playback state never belongs in saved data. */
export const ANIMATION_DEFINITIONS = Object.freeze([
  ...[
    ["fade-in", "Fade In"], ["slide-in-left", "Slide In Left"], ["slide-in-right", "Slide In Right"],
    ["slide-in-top", "Slide In Top"], ["slide-in-bottom", "Slide In Bottom"], ["scale-in", "Scale In"], ["pop-in", "Pop In"],
    ["shrink-in", "Shrink In"], ["blur-in", "Blur In"], ["flip-in-x", "Flip In Vertically"], ["flip-in-y", "Flip In Horizontally"],
    ["rotate-in", "Rotate In"], ["drop-in", "Drop In"], ["bounce-in", "Bounce In"],
    ["wipe-in-left", "Wipe In From Left"], ["wipe-in-right", "Wipe In From Right"], ["wipe-in-top", "Wipe In From Top"],
    ["wipe-in-bottom", "Wipe In From Bottom"], ["circle-in", "Circle In"], ["glitch-in", "Glitch In"]
  ].map(([type, label]) => Object.freeze({ type, label, category: "entrance" })),
  ...[
    ["fade-out", "Fade Out"], ["slide-out-left", "Slide Out Left"], ["slide-out-right", "Slide Out Right"],
    ["slide-out-top", "Slide Out Top"], ["slide-out-bottom", "Slide Out Bottom"], ["scale-out", "Scale Out"],
    ["grow-out", "Grow Out"], ["blur-out", "Blur Out"], ["flip-out-x", "Flip Out Vertically"], ["flip-out-y", "Flip Out Horizontally"],
    ["rotate-out", "Rotate Out"], ["fall-out", "Fall Out"], ["bounce-out", "Bounce Out"],
    ["wipe-out-left", "Wipe Out To Left"], ["wipe-out-right", "Wipe Out To Right"], ["wipe-out-top", "Wipe Out To Top"],
    ["wipe-out-bottom", "Wipe Out To Bottom"], ["circle-out", "Circle Out"], ["glitch-out", "Glitch Out"]
  ].map(([type, label]) => Object.freeze({ type, label, category: "exit" })),
  ...[
    ["pulse", "Pulse"], ["flash", "Flash"], ["shake", "Shake"], ["bounce", "Bounce"],
    ["glow", "Glow"], ["color-flash", "Color Flash"], ["scale-pulse", "Scale Pulse"],
    ["heartbeat", "Heartbeat"], ["wobble", "Wobble"], ["tada", "Tada"], ["rubber-band", "Rubber Band"], ["jello", "Jello"],
    ["float", "Float"], ["shake-vertical", "Vertical Shake"], ["spin", "Spin"], ["flicker", "Flicker"], ["glitch", "Glitch"]
  ].map(([type, label]) => Object.freeze({ type, label, category: "emphasis" }))
]);
export const EASINGS = Object.freeze(["linear", "ease-in", "ease-out", "ease-in-out", "back-in", "back-out", "back-in-out", "expo-out", "steps"]);
// CSS timing functions for the named easings; the browser and OBS both understand these forms.
const EASING_CURVES = Object.freeze({
  "back-in": "cubic-bezier(0.36, 0, 0.66, -0.56)", "back-out": "cubic-bezier(0.34, 1.56, 0.64, 1)",
  "back-in-out": "cubic-bezier(0.68, -0.6, 0.32, 1.6)", "expo-out": "cubic-bezier(0.16, 1, 0.3, 1)", steps: "steps(6, end)"
});
export function cssEasing(easing) {
  return EASING_CURVES[easing] ?? (EASINGS.includes(easing) ? easing : "ease-out");
}
export const TRIGGER_EVENTS = Object.freeze(["visible", "hidden", "field-changed", "increased", "decreased", "crossed-above", "crossed-below", "manual"]);
export const CONDITION_OPERATORS = Object.freeze(["eq", "ne", "gt", "lt", "gte", "lte", "increased", "decreased", "crossed-above", "crossed-below"]);
export const ACTION_TYPES = Object.freeze(["play-animation", "show", "hide", "glow", "color-flash", "animate-number"]);

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const FIELD = /^character(?:\.[A-Za-z][A-Za-z0-9_]{0,47}){1,5}$/;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
const DATA_EVENTS = new Set(["field-changed", "increased", "decreased", "crossed-above", "crossed-below"]);
const NUMERIC_OPERATORS = new Set(["gt", "lt", "gte", "lte", "crossed-above", "crossed-below"]);
const CHANGE_OPERATORS = new Set(["increased", "decreased"]);

function fail(message) { throw new TypeError(message); }
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object.`);
  if (Object.keys(value).some(key => FORBIDDEN.has(key))) fail(`${label} contains an unsafe property.`);
  return value;
}
function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value) || FORBIDDEN.has(value)) fail(`${label} must be a supported identifier.`);
  return value;
}
function numeric(value, label, min, max, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail(`${label} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}.`);
  }
  return value;
}
function boolean(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be true or false.`);
  return value;
}
function field(value, empty = false) {
  if (empty && value === "") return "";
  if (typeof value !== "string" || !FIELD.test(value) || value.split(".").some(part => FORBIDDEN.has(part))) fail("Choose a normalized character field for the trigger.");
  return value;
}
function scalar(value) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length <= 1000 && !/[\u0000-\u001f\u007f]/.test(value)) return value;
  fail("Trigger comparison values must be finite numbers, booleans, null, or short text.");
}
function label(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) fail("Trigger name must contain 1–80 printable characters.");
  return value.trim();
}

/** Unknown bounded type identifiers survive storage, allowing registered future animations. */
export function validateAnimationConfig(input = {}) {
  record(input, "Animation");
  const result = {
    type: identifier(input.type ?? "fade-in", "Animation type"),
    duration: numeric(input.duration ?? 500, "Animation duration", 1, 10000),
    delay: numeric(input.delay ?? 0, "Animation delay", 0, 10000),
    easing: input.easing ?? "ease-out",
    direction: input.direction ?? "normal",
    intensity: numeric(input.intensity ?? 1, "Animation intensity", 0, 2),
    repeat: numeric(input.repeat ?? 1, "Animation repeat", 1, 20, true)
  };
  if (!EASINGS.includes(result.easing)) fail("Choose a supported animation easing.");
  if (!["normal", "reverse", "alternate"].includes(result.direction)) fail("Choose normal, reverse, or alternate animation direction.");
  if (result.delay + result.duration * result.repeat > 60000) fail("An animation must complete within 60 seconds, including delay and repeats.");
  if (input.color !== undefined) {
    if (typeof input.color !== "string" || !/^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8})$/i.test(input.color)) fail("Animation color must be hexadecimal.");
    result.color = input.color;
  }
  return result;
}

/** Missing configuration intentionally preserves the previous immediate display behavior. */
export function validateAnimationSettings(input = {}) {
  record(input, "Animation settings");
  const transition = record(input.transition ?? {}, "Value transition");
  const result = {
    entrance: input.entrance == null ? null : validateAnimationConfig(input.entrance),
    exit: input.exit == null ? null : validateAnimationConfig(input.exit),
    emphasis: input.emphasis == null ? null : validateAnimationConfig(input.emphasis),
    transition: {
      duration: numeric(transition.duration ?? 0, "Value transition duration", 0, 10000),
      easing: transition.easing ?? "ease-out",
      numeric: boolean(transition.numeric ?? false, "Numeric interpolation"),
      bar: boolean(transition.bar ?? true, "Bar transition"),
      color: boolean(transition.color ?? false, "Color transition"),
      opacity: boolean(transition.opacity ?? false, "Opacity transition")
    }
  };
  if (!EASINGS.includes(result.transition.easing)) fail("Choose a supported value transition easing.");
  return result;
}

function condition(input) {
  if (input === null || input === undefined) return null;
  record(input, "Trigger condition");
  if (!CONDITION_OPERATORS.includes(input.operator)) fail("Choose a supported trigger comparison.");
  const result = {
    operator: input.operator,
    value: CHANGE_OPERATORS.has(input.operator) && input.value === undefined ? null : scalar(input.value)
  };
  if (input.field !== undefined && input.field !== "") result.field = field(input.field);
  if (NUMERIC_OPERATORS.has(input.operator) && typeof result.value !== "number") fail("Numeric trigger comparisons require a finite numeric threshold.");
  return result;
}

function action(input) {
  record(input, "Trigger action");
  const result = { type: identifier(input.type, "Trigger action"), target: identifier(input.target ?? "self", "Trigger target") };
  if (input.animation !== undefined && input.animation !== null) result.animation = validateAnimationConfig(input.animation);
  return result;
}

/** Rule data is declarative only: no expressions, functions, or document paths are accepted. */
export function validateTriggerRules(input = []) {
  if (!Array.isArray(input) || input.length > 32) fail("At most 32 trigger rules are supported per element.");
  const ids = new Set();
  const result = input.map((entry, index) => {
    record(entry, "Trigger rule");
    const rule = {
      id: identifier(entry.id ?? `trigger-${index + 1}`, "Trigger ID"), name: label(entry.name, `Trigger ${index + 1}`),
      enabled: boolean(entry.enabled ?? true, "Trigger enabled"),
      event: identifier(entry.event ?? "manual", "Trigger event"),
      field: field(entry.field ?? "", !DATA_EVENTS.has(entry.event)),
      condition: condition(entry.condition), action: action(entry.action ?? { type: "play-animation" }),
      continuous: boolean(entry.continuous ?? false, "Continuous trigger")
    };
    if (ids.has(rule.id)) fail("Trigger rules contain duplicate IDs.");
    ids.add(rule.id);
    if (["crossed-above", "crossed-below"].includes(rule.event) && typeof rule.condition?.value !== "number") fail("Threshold crossing triggers require a finite numeric condition threshold.");
    if (rule.condition && !rule.condition.field && !rule.field) fail("Trigger conditions require a normalized character field.");
    if (rule.continuous && (!DATA_EVENTS.has(rule.event) || !rule.condition
      || !["play-animation", "glow", "color-flash"].includes(rule.action.type))) fail("Continuous effects require a character-data condition and an emphasis action.");
    return rule;
  });
  if (JSON.stringify(result).length > 65536) fail("Trigger rules exceed 64 KiB.");
  return result;
}

/** Editable examples are new ordinary objects on every request, never runtime commands. */
export function createAnimationExamples() {
  return [
    { id: "soft-entrance", name: "Soft Entrance", slot: "entrance", animation: validateAnimationConfig({ type: "fade-in", duration: 500 }) },
    { id: "damage-flash", name: "Damage Flash", slot: "emphasis", animation: validateAnimationConfig({ type: "color-flash", duration: 400, color: "#ff4444" }),
      trigger: validateTriggerRules([{ id: "damage", name: "Damage Flash", event: "decreased", field: "character.hp.current", action: { type: "color-flash", target: "self", animation: { type: "color-flash", duration: 400, color: "#ff4444" } } }])[0] },
    { id: "healing-flash", name: "Healing Flash", slot: "emphasis", animation: validateAnimationConfig({ type: "color-flash", duration: 400, color: "#55cc88" }),
      trigger: validateTriggerRules([{ id: "healing", name: "Healing Flash", event: "increased", field: "character.hp.current", action: { type: "color-flash", target: "self", animation: { type: "color-flash", duration: 400, color: "#55cc88" } } }])[0] },
    { id: "low-health-warning", name: "Low Health Warning", slot: "emphasis", animation: validateAnimationConfig({ type: "pulse", duration: 1400, intensity: 0.35 }),
      trigger: validateTriggerRules([{ id: "low-health", name: "Low Health Warning", event: "field-changed", field: "character.hp.percent", condition: { operator: "lt", value: 25 }, action: { type: "play-animation", target: "self", animation: { type: "pulse", duration: 1400, intensity: 0.35 } }, continuous: true }])[0] },
    { id: "slide-entrance", name: "Slide Entrance", slot: "entrance", animation: validateAnimationConfig({ type: "slide-in-left", duration: 600 }) }
  ];
}
