import { clone, createOverlay, validateOverlay, validateWidgetPreset } from "../core/schema.js";
import { createLayer, createWidgetInstance } from "../core/layers.js";
import { createWidgetPreset } from "../core/widget-presets.js";
import { DEMO_ACTOR_UUIDS } from "./identities.js";

export const DEMO_OVERLAY_ID = "demo-animated-character-showcase";
export const DEMO_PRESET_ID = "demo-animated-character-card";
export const DEMO_WIDGET_ID = "demo-character-widget";

const fieldName = id => id.replace(/^character\./, "").replace(/\./g, " ");
function component(canvas, type, id, patch) { return { ...createLayer(type, canvas), id, ...patch }; }
function label(canvas, id, text, patch = {}) {
  return component(canvas, "text", id, { text, fontSize: 23, color: "#d4deed", fontFamily: "Arial", ...patch });
}

/** Ordinary editable layers/pages. Dynamic bindings are selected from actual adapter metadata. */
export function createDemoPreset({ fields = [] } = {}) {
  const preset = createWidgetPreset("Demo — Animated Character Card");
  preset.id = DEMO_PRESET_ID; preset.canvas = { width: 960, height: 520 };
  const canvas = preset.canvas;
  const definitions = new Map(fields.filter(field => field && typeof field.id === "string").map(field => [field.id, field]));
  const hp = definitions.get("character.hp.current")?.type === "number" && definitions.get("character.hp.max")?.type === "number";
  preset.animations = {
    ...preset.animations,
    entrance: { type: "fade-in", duration: 600 }, exit: { type: "fade-out", duration: 600 },
    emphasis: { type: "pulse", duration: 800, intensity: 0.35 },
    transition: { ...preset.animations.transition, duration: 600, bar: true, numeric: true }
  };
  preset.layers = [
    component(canvas, "color", "demo-card-background", { width: 960, height: 520, color: "#14213a", z: 0 }),
    component(canvas, "color", "demo-card-accent", { x: 0, y: 0, width: 8, height: 520, color: "#45d6c4", z: 1 }),
    component(canvas, "character-portrait", "demo-portrait", { x: 40, y: 60, width: 216, height: 280, fit: "contain", borderRadius: 14, z: 2 }),
    component(canvas, "character-name", "demo-name", { x: 300, y: 64, width: 620, height: 62, fontSize: 42, fontWeight: "700", fallback: "Choose a character", z: 3 }),
    component(canvas, "dynamic-text", "demo-source-label", { x: 40, y: 368, width: 216, height: 42,
      binding: "character.type", text: "{character.type}", fontSize: 18, color: "#91a7c5", align: "center", z: 4 }),
    label(canvas, "demo-card-heading", "CHARACTER SHOWCASE", { x: 300, y: 28, width: 600, height: 28, fontSize: 17, color: "#45d6c4", z: 4 })
  ];
  const page = (id, name, index, layers) => ({ id, name, enabled: true, duration: 4000, skipIfUnavailable: false, layers: [
    ...layers,
    label(canvas, `demo-page-${index}-indicator`, `${index} / 3  ·  ${name.toUpperCase()}`, { x: 40, y: 458, width: 880, height: 30, fontSize: 18, color: "#91a7c5", z: 30 })
  ] });
  const main = [];
  if (hp) {
    main.push(component(canvas, "dynamic-text", "demo-hp-text", {
      x: 300, y: 168, width: 610, height: 50, fontSize: 32, fontWeight: "600", z: 10,
      binding: "character.hp.current", text: "HP  {character.hp.current} / {character.hp.max}", fallback: "—"
    }));
    main.push(component(canvas, "resource-bar", "demo-hp-bar", {
      x: 300, y: 240, width: 610, height: 44, z: 11, showValue: false,
      foregroundColor: "#45d6a1", backgroundColor: "#283a56",
      animations: { transition: { duration: 600, bar: true, numeric: true, easing: "ease-out" } },
      triggers: [
        { id: "demo-damage-flash", name: "HP decreases: red flash", event: "decreased", field: "character.hp.current", action: { type: "color-flash", target: "self", animation: { type: "color-flash", duration: 400, color: "#ff5263" } } },
        { id: "demo-healing-flash", name: "HP increases: green flash", event: "increased", field: "character.hp.current", action: { type: "color-flash", target: "self", animation: { type: "color-flash", duration: 400, color: "#4ce6a1" } } }
      ]
    }));
    main.push(label(canvas, "demo-hp-hint", "Health updates and flashes when its value changes.", { x: 300, y: 310, width: 610, height: 70, fontSize: 20, color: "#91a7c5", z: 12 }));
  } else main.push(label(canvas, "demo-basic-information", "Character portrait and name\nThis adapter provides basic character information.\nAdd supported resource mappings to display health.", { x: 300, y: 170, width: 610, height: 180, fontSize: 26, z: 10 }));

  const extras = [], used = new Set(["character.hp.current", "character.hp.max", "character.hp.percent"]);
  for (const field of definitions.values()) {
    if (extras.length >= 4 || field.type !== "number" || used.has(field.id) || /\.(?:max|percent)$/.test(field.id)) continue;
    used.add(field.id);
    const maximum = typeof field.maxField === "string" && definitions.get(field.maxField)?.type === "number" ? field.maxField : null;
    if (maximum) used.add(maximum);
    extras.push(component(canvas, "dynamic-text", `demo-additional-${extras.length + 1}`, {
      x: 300, y: 158 + extras.length * 54, width: 620, height: 48, fontSize: 27, z: 10 + extras.length,
      binding: field.id, text: `${String(field.label ?? fieldName(field.id)).slice(0, 80)}  {${field.id}}${maximum ? ` / {${maximum}}` : ""}`, fallback: "—"
    }));
  }
  if (!extras.length) extras.push(component(canvas, "dynamic-text", "demo-actor-type", {
    x: 300, y: 166, width: 620, height: 54, fontSize: 28, binding: "character.type", text: "Character type: {character.type}", fallback: "—", z: 10
  }), label(canvas, "demo-adapter-note", "Additional fields follow the active adapter.\nNo unsupported system statistics are assumed.", { x: 300, y: 246, width: 620, height: 100, fontSize: 24, z: 11 }));

  const visual = [
    label(canvas, "demo-visual-caption", "Every character. Every page.\nOne coordinated sequence.", { x: 300, y: 160, width: 620, height: 118, fontSize: 35, fontWeight: "600", z: 10 }),
    label(canvas, "demo-visual-pulse", "PULSE  ·  800 ms", {
      x: 300, y: 310, width: 610, height: 60, fontSize: 33, fontWeight: "700", color: "#45d6c4", align: "center", z: 11,
      animations: { emphasis: { type: "pulse", duration: 800, intensity: 0.4 } },
      triggers: [{ id: "demo-visible-pulse", name: "Pulse while the visual page is visible", event: "field-changed", field: "character.name",
        condition: { operator: "ne", value: "" }, continuous: true,
        action: { type: "play-animation", target: "self", animation: { type: "pulse", duration: 800, intensity: 0.4 } } }]
    })
  ];
  preset.pages = [page("demo-main", "Main Information", 1, main), page("demo-additional", "Additional Information", 2, extras), page("demo-visual", "Visual Showcase", 3, visual)];
  preset.cycling = {
    ...preset.cycling, enabled: true, mode: "combined", traversal: "pages-first", duration: 4000, loop: true,
    transition: "slide-left", transitionDuration: 400, characterTransition: "fade", characterTransitionDuration: 600,
    startPageId: "demo-main"
  };
  return validateWidgetPreset(preset);
}

export function createDemoOverlay(preset = createDemoPreset()) {
  const overlay = createOverlay("Demo — Animated Character Showcase");
  overlay.id = DEMO_OVERLAY_ID;
  const canvas = overlay.canvas;
  const card = createWidgetInstance(preset, { x: 480, y: 330, width: 960, height: 520, z: 10,
    dataSource: "demo", actorUuids: [...DEMO_ACTOR_UUIDS], carousel: { mode: "combined", traversal: "pages-first" } });
  card.id = DEMO_WIDGET_ID;
  overlay.layers = [
    component(canvas, "color", "demo-background", { width: 1920, height: 1080, color: "#0a1120", z: 0 }),
    component(canvas, "color", "demo-top-accent", { x: 128, y: 110, width: 92, height: 6, color: "#45d6c4", z: 1 }),
    label(canvas, "demo-title", "ANIMATED CHARACTER SHOWCASE", { x: 128, y: 145, width: 1650, height: 92, fontSize: 58, fontWeight: "700", color: "#ffffff", z: 2 }),
    label(canvas, "demo-subtitle", "Three information pages  ·  Two characters  ·  One reusable card", { x: 128, y: 242, width: 1650, height: 54, fontSize: 28, color: "#91a7c5", z: 3 }),
    card,
    label(canvas, "demo-footer", "Use Animation Test Controls in the editor to inspect the real playback system.", { x: 128, y: 966, width: 1664, height: 48, fontSize: 24, color: "#91a7c5", align: "center", z: 20 })
  ];
  return validateOverlay(overlay);
}

/** Fixed identities make installation repeatable. Existing demo edits require explicit reset. */
export async function installDemo({ store, widgetPresets, characterData, reset = false } = {}) {
  if (!store?.getState || !store?.saveOverlay || !widgetPresets?.getState || !widgetPresets?.save) throw new TypeError("The demo installer requires the existing overlay and widget preset stores.");
  if (typeof reset !== "boolean") throw new TypeError("Demo reset must be true or false.");
  const presetState = widgetPresets.getState(), overlayState = store.getState();
  const existingPreset = presetState.presets.find(preset => preset.id === DEMO_PRESET_ID);
  const existingOverlay = overlayState.overlays.find(overlay => overlay.id === DEMO_OVERLAY_ID);
  if (existingPreset && existingOverlay && !reset) return { overlayId: DEMO_OVERLAY_ID, presetId: DEMO_PRESET_ID,
    created: false, createdOverlay: false, createdPreset: false, reset: false };
  const preset = createDemoPreset({ fields: characterData?.fieldDefinitions?.() ?? [] });
  const overlay = createDemoOverlay(preset);
  // Validate every generated record before either persisted store is changed.
  if (!existingPreset || reset) await widgetPresets.save(clone(preset), { expectedRevision: presetState.revision });
  if (!existingOverlay || reset) await store.saveOverlay(clone(overlay), { expectedRevision: overlayState.revision, activateIfEmpty: false });
  return { overlayId: DEMO_OVERLAY_ID, presetId: DEMO_PRESET_ID, created: !existingPreset || !existingOverlay,
    createdOverlay: !existingOverlay, createdPreset: !existingPreset, reset };
}
