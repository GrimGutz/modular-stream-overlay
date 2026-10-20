import { validateAnimationSettings, validateTriggerRules } from "../animation/schema.js";
import { validateActorUuids, validateCarousel, validateCycling, validateDataSource, validateInstanceCarousel } from "../carousel/schema.js";

/** Versioned, system-independent data accepted by the overlay core. */
export const MODULE_ID = "modular-stream-overlay";
export const SCHEMA_VERSION = 6;
export const WIDGET_PRESET_SCHEMA_VERSION = 4;
export const CHARACTER_FIELD_PATTERN = /^character(?:\.[A-Za-z][A-Za-z0-9_]{0,47}){1,5}$/;
export const FONT_FAMILIES = Object.freeze(["Arial", "Verdana", "Georgia", "Times New Roman", "Courier New", "Trebuchet MS"]);
export const FONT_WEIGHTS = Object.freeze(["400", "600", "700"]);
export const WIDGET_DEFINITIONS = Object.freeze([
  Object.freeze({ type: "character-portrait", label: "Character portrait" }),
  Object.freeze({ type: "character-name", label: "Character name" }),
  Object.freeze({ type: "dynamic-text", label: "Dynamic text" }),
  Object.freeze({ type: "dynamic-number", label: "Dynamic number" }),
  Object.freeze({ type: "resource-bar", label: "Health / resource bar" })
]);

const LIMITS = Object.freeze({ overlays: 100, presets: 100, layers: 100, widgets: 100 });
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const FITS = new Set(["cover", "contain", "stretch"]);

function fail(message) { throw new TypeError(message); }
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain object.`);
  if (Object.keys(value).some(key => FORBIDDEN_KEYS.has(key))) fail(`${label} contains an unsafe property.`);
  return value;
}
function text(value, label, max = 80) {
  if (typeof value !== "string") fail(`${label} must be text.`);
  const result = value.trim();
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) fail(`${label} must contain 1–${max} printable characters.`);
  return result;
}
function identifier(value, label = "ID") {
  if (typeof value !== "string" || value !== value.trim() || !ID.test(value)) fail(`${label} is invalid.`);
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
function version(value, label) {
  if (![1, 2, 3, 4, 5, SCHEMA_VERSION].includes(value)) fail(`${label} schema version is unsupported. Expected 1, 2, 3, 4, 5, or ${SCHEMA_VERSION}.`);
}
function array(value, label, limit) {
  if (!Array.isArray(value) || value.length > limit) fail(`${label} must be a list with at most ${limit} entries.`);
  return value;
}
function unique(entries, label) {
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) fail(`${label} contains duplicate IDs.`);
  return entries;
}

/** Copy JSON configuration while rejecting executable, cyclic, or prototype-bearing values. */
export function clone(value) {
  const seen = new Set();
  let nodes = 0;
  let stringLength = 0;
  function copy(item, depth) {
    if (++nodes > 100000 || depth > 24) fail("Configuration is too large or deeply nested.");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) fail("Configuration numbers must be finite.");
      return item;
    }
    if (typeof item === "string") {
      stringLength += item.length;
      if (stringLength > 2000000) fail("Configuration text is too large.");
      return item;
    }
    if (!item || typeof item !== "object") fail("Configuration must contain JSON values only.");
    if (seen.has(item)) fail("Configuration must not contain circular references.");
    seen.add(item);
    let result;
    if (Array.isArray(item)) result = item.map(child => copy(child, depth + 1));
    else {
      record(item, "Configuration");
      result = {};
      for (const [key, child] of Object.entries(item)) result[key] = copy(child, depth + 1);
    }
    seen.delete(item);
    return result;
  }
  return copy(value, 0);
}

function configuration(value = {}) {
  record(value, "Extension configuration");
  const result = clone(value);
  if (JSON.stringify(result).length > 65536) fail("Extension configuration exceeds 64 KiB.");
  return result;
}

function content(value, label = "Text content", max = 10000) {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    fail(`${label} must be text no longer than ${max} characters, with optional newlines.`);
  }
  return value;
}

function color(value, label = "Color", transparent = false) {
  if (typeof value !== "string" || value !== value.trim() || (!/^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8})$/i.test(value) && !(transparent && value === "transparent"))) {
    fail(`${label} requires a hexadecimal color${transparent ? " or transparent" : ""}.`);
  }
  return value;
}

function textStyle(input) {
  const fontFamily = input.fontFamily ?? FONT_FAMILIES[0];
  if (!FONT_FAMILIES.includes(fontFamily)) fail("Choose a supported font family.");
  const fontWeight = input.fontWeight ?? "400";
  if (!FONT_WEIGHTS.includes(fontWeight)) fail("Font weight must be 400, 600, or 700.");
  const align = input.align ?? "left";
  if (!["left", "center", "right"].includes(align)) fail("Text alignment must be left, center, or right.");
  return {
    fontFamily, fontSize: numeric(input.fontSize ?? 48, "Font size", 1, 512), fontWeight,
    color: color(input.color ?? "#ffffff", "Text color"), align,
    shadow: boolean(input.shadow ?? false, "Text shadow")
  };
}

/** A normalized field ID, never an executable expression or an unrestricted Actor path. */
export function validateCharacterBinding(value) {
  if (typeof value !== "string" || value !== value.trim() || !CHARACTER_FIELD_PATTERN.test(value)
    || value.split(".").some(part => FORBIDDEN_KEYS.has(part))) fail("Choose a normalized character field.");
  return value;
}

/** Only persistent world Actor identities are supported; synthetic Tokens are deliberately excluded. */
export function validateActorUuid(value) {
  if (value === "") return value;
  if (typeof value !== "string" || value !== value.trim() || !/^Actor\.[A-Za-z0-9_-]{1,64}$/.test(value)) fail("Choose a world Actor UUID such as Actor.abc123.");
  return value;
}

/** Per-component presentation overrides never change bindings, templates, source images, or Actor identities. */
function instanceOverrides(input = {}) {
  record(input, "Widget overrides");
  if (Object.keys(input).length > 100) fail("Widget overrides support at most 100 components.");
  const result = {};
  for (const [id, value] of Object.entries(input)) {
    identifier(id, "Override component ID");
    record(value, "Component overrides");
    const safe = {};
    for (const [key, candidate] of Object.entries(value)) {
      if (key === "opacity") safe[key] = numeric(candidate, "Override opacity", 0, 1);
      else if (["visible", "shadow", "circular", "showValue"].includes(key)) safe[key] = boolean(candidate, `Override ${key}`);
      else if (key === "fontSize") safe[key] = numeric(candidate, "Override font size", 1, 512);
      else if (key === "borderRadius") safe[key] = numeric(candidate, "Override border radius", 0, 3840);
      else if (["color", "foregroundColor", "backgroundColor"].includes(key)) safe[key] = color(candidate, `Override ${key}`);
      else if (key === "fontFamily") {
        if (!FONT_FAMILIES.includes(candidate)) fail("Choose a supported override font family.");
        safe[key] = candidate;
      } else if (key === "fontWeight") {
        if (!FONT_WEIGHTS.includes(candidate)) fail("Choose a supported override font weight.");
        safe[key] = candidate;
      } else if (key === "align") {
        if (!["left", "center", "right"].includes(candidate)) fail("Choose a supported override alignment.");
        safe[key] = candidate;
      } else if (key === "fit") {
        if (!["contain", "cover"].includes(candidate)) fail("Choose contain or cover for override image scaling.");
        safe[key] = candidate;
      } else if (key === "animations") safe[key] = validateAnimationSettings(candidate);
      else if (key === "triggers") safe[key] = validateTriggerRules(candidate);
    }
    result[id] = safe;
  }
  return result;
}

/** MVP assets are references inside Foundry's public data directory, never embedded or remote. */
export function validateAssetPath(value) {
  if (typeof value !== "string" || value.length > 4096) fail("Image path must be text no longer than 4096 characters.");
  if (value === "") return "";
  if (value !== value.trim() || /[\u0000-\u001f\u007f\\]/.test(value) || /^[\/]/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    fail("Choose an image in Foundry's managed files using a relative path.");
  }
  let decoded = value;
  try {
    for (let index = 0; index < 3; index++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch { fail("Image path has invalid URL encoding."); }
  if (/[\u0000-\u001f\u007f\\]/.test(decoded) || /^[\/]/.test(decoded) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded)
    || decoded.split(/[/?#]/).some(segment => segment === ".." || segment === ".")) {
    fail("Image path must remain inside Foundry's managed files.");
  }
  return value;
}

function newId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`;
}

export function createOverlay(name = "New overlay") {
  return {
    schemaVersion: SCHEMA_VERSION, id: newId("overlay"), name: text(name, "Overlay name"),
    canvas: { width: 1920, height: 1080 }, background: { src: "", opacity: 1, fit: "cover" },
    layers: [], widgets: [], adapter: { id: "generic", config: {} },
    animations: validateAnimationSettings(), triggers: [], pages: [], cycling: validateCycling()
  };
}

export function createState() {
  return { schemaVersion: SCHEMA_VERSION, revision: 0, activeOverlayId: null, overlays: [], presets: [] };
}

function geometry(input, canvas, index) {
  return {
    visible: boolean(input.visible ?? true, "Visibility"),
    locked: boolean(input.locked ?? false, "Locked state"),
    x: numeric(input.x ?? 0, "X position", -32768, 32768),
    y: numeric(input.y ?? 0, "Y position", -32768, 32768),
    width: numeric(input.width ?? canvas.width, "Element width", 1, 7680),
    height: numeric(input.height ?? canvas.height, "Element height", 1, 7680),
    rotation: numeric(input.rotation ?? 0, "Element rotation", -360, 360),
    opacity: numeric(input.opacity ?? 1, "Element opacity", 0, 1),
    z: numeric(input.z ?? index, "Stack order", -10000, 10000, true),
    animations: validateAnimationSettings(input.animations), triggers: validateTriggerRules(input.triggers)
  };
}

/** Normalize both legacy and current layers without changing the caller's data. */
export function validateLayer(input, canvas = { width: 1920, height: 1080 }, index = 0) {
  record(input, "Layer");
  const type = identifier(input.type, "Layer type");
  const labels = { color: "Color", image: "Image", text: "Text", ...Object.fromEntries(WIDGET_DEFINITIONS.map(entry => [entry.type, entry.label])), "character-widget": "Character widget" };
  const result = {
    id: identifier(input.id, "Layer ID"), type,
    name: text(input.name ?? `${Object.hasOwn(labels, type) ? labels[type] : type} layer`, "Layer name"),
    ...geometry(input, canvas, index)
  };
  if (type === "image") {
    result.src = validateAssetPath(input.src ?? "");
    result.fit = input.fit ?? "cover";
    if (!FITS.has(result.fit)) fail("Image scaling must be cover, contain, or stretch.");
    // Legacy layouts keep their original freely stretched geometry.
    result.lockAspectRatio = boolean(input.lockAspectRatio ?? false, "Aspect ratio lock");
  } else if (["text", "character-name", "dynamic-text", "dynamic-number"].includes(type)) {
    const dynamic = type !== "text";
    result.text = content(input.text ?? (type === "text" ? "Text" : type === "dynamic-text" ? "{character.name}" : ""));
    Object.assign(result, textStyle(input));
    if (dynamic) {
      result.binding = validateCharacterBinding(input.binding ?? (type === "dynamic-number" ? "character.hp.current" : "character.name"));
      result.fallback = content(input.fallback ?? "—", "Fallback text", 1000);
    }
  } else if (type === "character-portrait") {
    result.binding = validateCharacterBinding(input.binding ?? "character.portrait");
    result.src = validateAssetPath(input.src ?? "");
    result.fit = input.fit ?? "cover";
    if (!["contain", "cover"].includes(result.fit)) fail("Portrait scaling must be contain or cover.");
    result.portraitSource = input.portraitSource ?? "profile";
    if (!["profile", "token"].includes(result.portraitSource)) fail("Portrait source must be profile or token.");
    result.circular = boolean(input.circular ?? false, "Circular portrait");
    result.borderRadius = numeric(input.borderRadius ?? 0, "Portrait border radius", 0, 3840);
    result.lockAspectRatio = boolean(input.lockAspectRatio ?? true, "Aspect ratio lock");
  } else if (type === "resource-bar") {
    result.binding = validateCharacterBinding(input.binding ?? "character.hp.current");
    result.maxBinding = validateCharacterBinding(input.maxBinding ?? "character.hp.max");
    result.foregroundColor = color(input.foregroundColor ?? "#4caf77", "Resource foreground color");
    result.backgroundColor = color(input.backgroundColor ?? "#26313b", "Resource background color");
    result.showValue = boolean(input.showValue ?? true, "Resource numeric text");
    result.fallback = content(input.fallback ?? "—", "Fallback text", 1000);
    Object.assign(result, textStyle(input));
  } else if (type === "character-widget") {
    result.presetId = identifier(input.presetId, "Widget preset ID");
    result.dataSource = validateDataSource(input.dataSource);
    const legacyActor = input.actorUuid ?? "";
    if (legacyActor) validateActorUuids([legacyActor], { dataSource: result.dataSource });
    result.actorUuids = Object.hasOwn(input, "actorUuids") ? validateActorUuids(input.actorUuids, { dataSource: result.dataSource })
      : legacyActor ? validateActorUuids([legacyActor], { dataSource: result.dataSource }) : [];
    result.actorUuid = result.actorUuids[0] ?? "";
    result.carousel = validateInstanceCarousel(input.carousel, { actors: result.actorUuids, dataSource: result.dataSource });
    result.overrides = instanceOverrides(input.overrides);
    result.animationOverrides = boolean(input.animationOverrides ?? false, "Instance animation override");
  } else if (type === "color") {
    result.color = input.color ?? "transparent";
    if (typeof result.color !== "string" || !/^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|transparent)$/i.test(result.color)) {
      fail("Color layers require a hexadecimal color or transparent.");
    }
  } else {
    // Registered widget types own only their isolated JSON configuration.
    result.config = configuration(input.config);
  }
  return result;
}

/** A reusable design has no Actor identity and cannot recursively contain widget instances. */
export function validateWidgetPreset(input) {
  record(input, "Widget preset");
  if (![1, 2, 3, WIDGET_PRESET_SCHEMA_VERSION].includes(input.schemaVersion)) fail(`Widget preset schema version is unsupported. Expected 1, 2, 3, or ${WIDGET_PRESET_SCHEMA_VERSION}.`);
  const overlay = validateOverlay({
    schemaVersion: SCHEMA_VERSION, id: input.id, name: input.name,
    canvas: input.canvas, background: input.background, layers: input.layers ?? [], widgets: [],
    adapter: { id: "generic", config: {} }, animations: input.animations, triggers: input.triggers,
    pages: input.pages, cycling: input.cycling
  });
  if (overlay.layers.some(layer => layer.type === "character-widget")) fail("Widget presets cannot contain nested widget instances.");
  return {
    schemaVersion: WIDGET_PRESET_SCHEMA_VERSION, id: overlay.id, name: overlay.name,
    canvas: overlay.canvas, background: overlay.background, layers: overlay.layers,
    animations: overlay.animations, triggers: overlay.triggers, pages: overlay.pages, cycling: overlay.cycling
  };
}

function widget(input, canvas, index) {
  record(input, "Widget");
  return {
    id: identifier(input.id, "Widget ID"), type: identifier(input.type, "Widget type"),
    ...geometry(input, canvas, index), config: configuration(input.config)
  };
}

/** Unknown structural fields are stripped; extension JSON lives in widget/adapter config. */
export function validateOverlay(input) {
  record(input, "Overlay");
  version(input.schemaVersion, "Overlay");
  const canvas = record(input.canvas, "Canvas");
  const background = record(input.background, "Background");
  const adapter = record(input.adapter ?? { id: "generic", config: {} }, "Adapter");
  const result = {
    schemaVersion: SCHEMA_VERSION, id: identifier(input.id, "Overlay ID"), name: text(input.name, "Overlay name"),
    canvas: {
      width: numeric(canvas.width, "Canvas width", 64, 7680, true),
      height: numeric(canvas.height, "Canvas height", 64, 7680, true)
    },
    background: {
      src: validateAssetPath(background.src ?? ""), opacity: numeric(background.opacity ?? 1, "Background opacity", 0, 1),
      fit: background.fit ?? "cover"
    },
    layers: [], widgets: [], adapter: { id: identifier(adapter.id, "Adapter ID"), config: configuration(adapter.config) },
    animations: validateAnimationSettings(input.animations), triggers: validateTriggerRules(input.triggers)
  };
  if (!FITS.has(result.background.fit)) fail("Background scaling must be cover, contain, or stretch.");
  result.layers = unique(array(input.layers ?? [], "Layers", LIMITS.layers).map((entry, index) => validateLayer(entry, result.canvas, index)), "Layers");
  result.widgets = unique(array(input.widgets ?? [], "Widgets", LIMITS.widgets).map((entry, index) => widget(entry, result.canvas, index)), "Widgets");
  Object.assign(result, validateCarousel(input, { canvas: result.canvas, normalizeLayer: validateLayer, sharedLayers: result.layers }));
  return result;
}

function preset(input) {
  record(input, "Preset");
  version(input.schemaVersion, "Preset");
  const id = identifier(input.id, "Preset ID");
  if (id.startsWith("builtin-")) fail("Built-in preset IDs are reserved.");
  return { schemaVersion: SCHEMA_VERSION, id, name: text(input.name, "Preset name"), overlay: validateOverlay(input.overlay) };
}

export function validateState(input) {
  record(input, "Overlay settings");
  version(input.schemaVersion, "Overlay settings");
  const result = {
    schemaVersion: SCHEMA_VERSION,
    revision: numeric(input.revision, "Settings revision", 0, Number.MAX_SAFE_INTEGER, true),
    activeOverlayId: input.activeOverlayId === null ? null : identifier(input.activeOverlayId, "Active overlay ID"),
    overlays: unique(array(input.overlays, "Overlays", LIMITS.overlays).map(validateOverlay), "Overlays"),
    presets: unique(array(input.presets, "Presets", LIMITS.presets).map(preset), "Presets")
  };
  if (result.activeOverlayId !== null && !result.overlays.some(overlay => overlay.id === result.activeOverlayId)) {
    fail("The active overlay does not exist.");
  }
  if (JSON.stringify(result).length > 2000000) fail("Overlay settings exceed the supported size.");
  return result;
}

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

const transparent = createOverlay("Empty transparent overlay");
transparent.id = "template-transparent";
const background = createOverlay("Basic background overlay");
background.id = "template-background";
background.background.src = `modules/${MODULE_ID}/assets/basic-background.svg`;

export const BUILTIN_PRESETS = freeze([
  { schemaVersion: SCHEMA_VERSION, id: "builtin-transparent", name: "Empty transparent overlay", overlay: transparent, builtin: true },
  { schemaVersion: SCHEMA_VERSION, id: "builtin-background", name: "Basic background overlay", overlay: background, builtin: true }
]);
