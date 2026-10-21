import { clone, createOverlay, validateOverlay, validateWidgetPreset } from "../core/schema.js";
import { createLayer, createWidgetInstance } from "../core/layers.js";
import { createWidgetPreset } from "../core/widget-presets.js";

export const CAIN_CARD_ID = "cain-exorcist-card";
export const CAIN_COMPACT_ID = "cain-compact-status";
export const CAIN_OVERLAY_ID = "cain-character-examples";
export const CAIN_WIDGET_ID = "cain-example-character";
const SKILLS = ["force", "conditioning", "coordination", "covert", "interfacing", "investigation", "surveillance", "negotiation", "authority", "connection"];

function layer(canvas, type, id, patch) {
  return { ...createLayer(type, canvas), id, color: "#171717", fontFamily: "Arial", ...patch };
}
function text(canvas, id, value, patch) {
  return layer(canvas, "text", id, { text: value, fontSize: 21, ...patch });
}
function value(canvas, id, binding, template, patch) {
  return layer(canvas, "dynamic-text", id, { binding, text: template, fallback: "—", fontSize: 24, ...patch });
}
function resource(canvas, id, label, current, maximum, row, { color = "#222222", trigger = false } = {}) {
  return [
    text(canvas, `${id}-label`, label, { x: 270, y: 185 + row * 100, width: 460, height: 32, z: 10 }),
    value(canvas, `${id}-value`, current, `{${current}} / {${maximum}}`, { x: 750, y: 185 + row * 100, width: 150, height: 32, align: "right", fontSize: 21, z: 10 }),
    layer(canvas, "resource-bar", id, { x: 270, y: 220 + row * 100, width: 630, height: 35, z: 11,
      binding: current, maxBinding: maximum, foregroundColor: color, backgroundColor: "#c9c4ba", showValue: false,
      ...(trigger ? { triggers: [{ id: `${id}-increase`, name: `${label} increases`, event: "increased", field: current,
        action: { type: "color-flash", target: "self", animation: { type: "color-flash", duration: 350, color: "#c8493e" } } }] } : {}) })
  ];
}
function motion(preset) {
  preset.animations = { ...preset.animations, entrance: { type: "fade-in", duration: 400 }, exit: { type: "fade-out", duration: 400 },
    emphasis: { type: "pulse", duration: 600, intensity: .2 }, transition: { ...preset.animations.transition, duration: 250, bar: true, numeric: true } };
}

/** Actor-free, ordinary editable components; no CAIN system paths are saved in the design. */
export function createCainCardPreset() {
  const preset = createWidgetPreset("CAIN — Exorcist Card"); preset.id = CAIN_CARD_ID;
  const canvas = preset.canvas = { width: 960, height: 600 }; motion(preset);
  preset.layers = [
    layer(canvas, "color", "cain-card-background", { width: 960, height: 600, color: "#ede8de", z: 0 }),
    layer(canvas, "color", "cain-card-rule", { x: 240, y: 32, width: 3, height: 530, color: "#171717", z: 1 }),
    text(canvas, "cain-card-title", "CAIN / EXORCIST", { x: 32, y: 32, width: 190, height: 42, fontSize: 20, fontWeight: "700", z: 2 }),
    layer(canvas, "character-portrait", "cain-card-portrait", { x: 32, y: 100, width: 184, height: 280, fit: "contain", z: 2 }),
    layer(canvas, "character-name", "cain-card-name", { x: 270, y: 42, width: 630, height: 58, fontSize: 36, fontWeight: "700", fallback: "Assign a CAIN Character", z: 3 }),
    value(canvas, "cain-card-rank", "character.cain.cat", "CAT {character.cain.cat}   /   PSYCHE {character.psyche}", { x: 270, y: 112, width: 630, height: 45, fontSize: 26, z: 3 }),
    value(canvas, "cain-card-xid", "character.cain.xid", "XID {character.cain.xid}", { x: 32, y: 412, width: 184, height: 48, fontSize: 18, z: 3 })
  ];
  const page = (id, name, index, layers) => ({ id, name, enabled: true, duration: 5000, skipIfUnavailable: true, layers: [
    ...layers, text(canvas, `${id}-caption`, `${index} / 4   ${name.toUpperCase()}`, { x: 270, y: 545, width: 630, height: 30, fontSize: 17, z: 20 })
  ] });
  const conditions = [
    ...resource(canvas, "cain-stress", "STRESS", "character.stress.current", "character.stress.max", 0, { trigger: true }),
    ...resource(canvas, "cain-injuries", "INJURIES", "character.cain.injuries.current", "character.cain.injuries.max", 1, { trigger: true }),
    ...resource(canvas, "cain-agony", "DIVINE AGONY", "character.cain.divineAgony.current", "character.cain.divineAgony.max", 2)
  ];
  const resources = [
    ...resource(canvas, "cain-bursts", "PSYCHE BURSTS", "character.cain.psycheBurst.current", "character.cain.psycheBurst.max", 0),
    ...resource(canvas, "cain-kit", "KIT POINTS", "character.cain.kitPoints.current", "character.cain.kitPoints.max", 1),
    ...resource(canvas, "cain-overflow", "SIN OVERFLOW", "character.cain.sinOverflow.current", "character.cain.sinOverflow.max", 2, { color: "#7e3933" })
  ];
  const skills = SKILLS.map((skill, index) => value(canvas, `cain-skill-${skill}`, `character.cain.skills.${skill}.rating`,
    `${skill[0].toUpperCase()}${skill.slice(1)}  {character.cain.skills.${skill}.rating}`, {
      x: 270 + index % 2 * 315, y: 190 + Math.floor(index / 2) * 59, width: 300, height: 43, fontSize: 22, z: 10
    }));
  const progression = [
    ...resource(canvas, "cain-xp", "XP", "character.cain.xp.current", "character.cain.xp.max", 0),
    ...resource(canvas, "cain-advancements", "ADVANCEMENTS", "character.cain.advancements.current", "character.cain.advancements.max", 1),
    value(canvas, "cain-scrip", "character.cain.scrip", "SCRIP  {character.cain.scrip}", { x: 270, y: 405, width: 630, height: 50, fontSize: 29, z: 10 })
  ];
  preset.pages = [page("cain-condition-page", "Condition", 1, conditions), page("cain-resources-page", "Resources", 2, resources),
    page("cain-skills-page", "Skills", 3, skills), page("cain-progression-page", "Progression", 4, progression)];
  preset.cycling = { ...preset.cycling, enabled: true, mode: "combined", traversal: "pages-first", duration: 5000, loop: true,
    transition: "fade", transitionDuration: 300, characterTransition: "fade", characterTransitionDuration: 400, startPageId: "cain-condition-page" };
  return validateWidgetPreset(preset);
}

export function createCainCompactPreset() {
  const preset = createWidgetPreset("CAIN — Compact Status"); preset.id = CAIN_COMPACT_ID;
  const canvas = preset.canvas = { width: 640, height: 210 }; motion(preset);
  preset.layers = [
    layer(canvas, "color", "cain-compact-background", { width: 640, height: 210, color: "#ede8de", z: 0 }),
    layer(canvas, "character-portrait", "cain-compact-portrait", { x: 18, y: 22, width: 98, height: 155, fit: "contain", z: 1 }),
    layer(canvas, "character-name", "cain-compact-name", { x: 140, y: 19, width: 475, height: 42, fontSize: 27, fontWeight: "700", fallback: "Assign a CAIN Character", z: 2 }),
    value(canvas, "cain-compact-rank", "character.cain.cat", "CAT {character.cain.cat} / PSYCHE {character.psyche}", { x: 140, y: 65, width: 475, height: 37, fontSize: 22, z: 2 }),
    text(canvas, "cain-compact-stress-label", "STRESS", { x: 140, y: 111, width: 215, height: 28, fontSize: 17, z: 2 }),
    text(canvas, "cain-compact-bursts-label", "PSYCHE BURSTS", { x: 385, y: 111, width: 230, height: 28, fontSize: 17, z: 2 }),
    value(canvas, "cain-compact-stress-value", "character.stress.current", "{character.stress.current} / {character.stress.max}", { x: 285, y: 111, width: 70, height: 28, align: "right", fontSize: 17, z: 3 }),
    value(canvas, "cain-compact-bursts-value", "character.cain.psycheBurst.current", "{character.cain.psycheBurst.current} / {character.cain.psycheBurst.max}", { x: 545, y: 111, width: 70, height: 28, align: "right", fontSize: 17, z: 3 }),
    layer(canvas, "resource-bar", "cain-compact-stress", { x: 140, y: 149, width: 215, height: 30, binding: "character.stress.current", maxBinding: "character.stress.max", foregroundColor: "#333333", backgroundColor: "#c9c4ba", showValue: false, z: 3 }),
    layer(canvas, "resource-bar", "cain-compact-bursts", { x: 385, y: 149, width: 230, height: 30, binding: "character.cain.psycheBurst.current", maxBinding: "character.cain.psycheBurst.max", foregroundColor: "#333333", backgroundColor: "#c9c4ba", showValue: false, z: 3 })
  ];
  return validateWidgetPreset(preset);
}

export function createCainExampleOverlay(preset = createCainCardPreset()) {
  const overlay = createOverlay("CAIN — Character Examples"); overlay.id = CAIN_OVERLAY_ID;
  const instance = createWidgetInstance(preset, { x: 480, y: 250, width: 960, height: 600, dataSource: "actors", actorUuids: [] });
  instance.id = CAIN_WIDGET_ID;
  overlay.layers = [instance, text(overlay.canvas, "cain-example-help", "Assign CAIN Characters in Carousel Settings. Reuse this design for your party.", { x: 280, y: 920, width: 1360, height: 55, color: "#ffffff", fontSize: 28, align: "center", z: 2 })];
  return validateOverlay(overlay);
}

/** Explicit installation only. Fixed identities preserve edits, assignments and the live overlay. */
export async function installCainPresets({ store, widgetPresets } = {}) {
  if (!store?.getState || !store?.saveOverlay || !widgetPresets?.getState || !widgetPresets?.save) throw new TypeError("CAIN examples require the overlay and widget preset stores.");
  const presets = [createCainCardPreset(), createCainCompactPreset()], overlay = createCainExampleOverlay(presets[0]);
  const createdPresetIds = [];
  for (const preset of presets) {
    const state = widgetPresets.getState();
    if (state.presets.some(existing => existing.id === preset.id)) continue;
    await widgetPresets.save(clone(preset), { expectedRevision: state.revision });
    createdPresetIds.push(preset.id);
  }
  const state = store.getState(), createdOverlay = !state.overlays.some(existing => existing.id === overlay.id);
  if (createdOverlay) await store.saveOverlay(clone(overlay), { expectedRevision: state.revision, activateIfEmpty: false });
  return { presetIds: presets.map(preset => preset.id), overlayId: overlay.id, createdPresetIds, createdOverlay,
    created: createdOverlay || createdPresetIds.length > 0 };
}
