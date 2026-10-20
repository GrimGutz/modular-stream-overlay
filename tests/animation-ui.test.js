import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { renderAnimationControls, renderAnimationTestControls } from "../scripts/ui/animation-controls.js";
import { createOverlay, createState } from "../scripts/core/schema.js";
import { createLayer, createWidgetInstance } from "../scripts/core/layers.js";
import { createWidgetPreset } from "../scripts/core/widget-presets.js";
import { validateAnimationConfig } from "../scripts/animation/schema.js";

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = new Map(); this.dataset = {}; this.listeners = new Map(); this._text = ""; this.value = ""; this.disabled = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this._text = ""; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key); }
  removeAttribute(key) { this.attributes.delete(key); }
  setCustomValidity(message) { this.validationMessage = message; }
  checkValidity() { return !this.validationMessage; }
  addEventListener(type, callback) { const listeners = this.listeners.get(type) ?? []; listeners.push(callback); this.listeners.set(type, listeners); }
  dispatch(type) { for (const listener of this.listeners.get(type) ?? []) listener({ currentTarget: this, preventDefault() {} }); }
  querySelectorAll(selector) {
    const match = element => selector === "details[data-animation-group]" ? element.tagName === "DETAILS" && element.dataset.animationGroup !== undefined : element.tagName === selector.toUpperCase();
    return this.children.flatMap(child => [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
class ApplicationStub {
  constructor() { this.rendered = false; }
  _canRender() {} async _prepareContext() { return {}; }
  async render() { return this; }
}
globalThis.foundry = {
  applications: { api: { ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: base => base, DialogV2: {} } },
  utils: { deepClone: structuredClone }
};
const { OverlayEditor, configureEditor } = await import("../scripts/ui/editor.js");
const { LiveControls, configureLiveControls, openLiveControls } = await import("../scripts/ui/live-controls.js");
const fields = [
  { id: "character.name", label: "Name", type: "string" },
  { id: "character.hp.current", label: "Health", type: "number" },
  { id: "character.hp.percent", label: "Health percent", type: "number" }
];
const all = host => host.children.flatMap(child => [child, ...all(child)]);
const field = (host, label, index = 0) => all(host).filter(element => element.getAttribute("aria-label") === label)[index];
const button = (host, label) => all(host).find(element => element.tagName === "BUTTON" && element.textContent === label);
const edit = (element, value) => { element.value = String(value); element.dispatch(element.tagName === "SELECT" ? "change" : "input"); };
const check = (element, value) => { element.checked = value; element.dispatch("change"); };
const click = async element => { assert(element, "Expected a visible control"); if (!element.disabled) element.dispatch("click"); await new Promise(resolve => setImmediate(resolve)); };

beforeEach(() => {
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.game = { user: { isGM: true }, modules: new Map() };
  globalThis.ui = { notifications: { error() {} } };
});

test("animation controls preserve consecutive parameter edits and keep previews separate from draft writes", async () => {
  const host = new Element("div"), changes = [], previews = [], resets = [];
  const controls = renderAnimationControls(host, { fields, onChange: value => changes.push(value), onPreview: value => previews.push(value), onReset: () => resets.push(true) });
  edit(field(host, "Animation type"), "fade-in");
  edit(field(host, "Duration (ms)"), 750);
  edit(field(host, "Delay (ms)"), 100);
  edit(field(host, "Easing"), "linear");
  assert.equal(controls.getValue().animations.entrance.duration, 750);
  assert.equal(controls.getValue().animations.entrance.delay, 100);
  assert.equal(controls.getValue().animations.entrance.easing, "linear");
  const writes = changes.length;
  await click(button(host, "Preview entrance")); await click(button(host, "Reset temporary effects"));
  assert.equal(previews.length, 1); assert.equal(previews[0].duration, 750); assert.equal(resets.length, 1);
  assert.equal(changes.length, writes, "Preview and reset do not change saved or draft configuration");
  previews[0].duration = 3;
  assert.equal(controls.getValue().animations.entrance.duration, 750, "Preview callbacks receive a detached value");
});

test("invalid animation values cannot replace the valid draft and can be corrected without losing other edits", () => {
  const host = new Element("div"), changes = [], errors = [];
  const controls = renderAnimationControls(host, { value: { animations: { emphasis: { type: "pulse", duration: 500 } } }, onChange: value => changes.push(value), onInvalid: error => errors.push(error) });
  edit(field(host, "Delay (ms)"), 120);
  const count = changes.length;
  edit(field(host, "Duration (ms)"), -10);
  assert.equal(changes.length, count); assert.equal(controls.isValid(), false); assert.match(errors.at(-1), /duration/);
  assert.throws(() => controls.getValue(), /duration/);
  edit(field(host, "Duration (ms)"), 650);
  assert.equal(controls.getValue().animations.emphasis.duration, 650); assert.equal(controls.getValue().animations.emphasis.delay, 120); assert.equal(errors.at(-1), "");
});

test("unfinished animation entries survive reselecting a layer and block Save until corrected", () => {
  const overlay = createOverlay(); overlay.layers.push(createLayer("image", overlay.canvas));
  const editor = new OverlayEditor(); editor._loadDraft(overlay, 0); editor.element = new Element("div"); editor._updatePreview = async () => {};
  const layer = editor._draft.layers[0], first = new Element("div");
  editor._renderAnimationControls(first, layer);
  edit(field(first, "Animation type"), "fade-in"); edit(field(first, "Duration (ms)"), -25);
  assert.throws(() => editor._validateInputs(), /invalid property/);
  const selectedAgain = new Element("div"); editor._renderAnimationControls(selectedAgain, layer);
  assert.equal(Number(field(selectedAgain, "Duration (ms)").value), -25);
  assert.throws(() => editor._validateInputs(), /invalid property/);
  edit(field(selectedAgain, "Duration (ms)"), 700);
  assert.doesNotThrow(() => editor._validateInputs()); assert.equal(layer.animations.entrance.duration, 700);
});

test("multiple declarative trigger rules expose normalized numeric fields, conditions, targets and local previews", async () => {
  const host = new Element("div"), previews = [];
  const controls = renderAnimationControls(host, { fields, targets: [{ id: "portrait", name: "Portrait" }], onTriggerPreview: id => previews.push(id) });
  await click(button(host, "Add trigger rule"));
  edit(field(host, "Event"), "decreased");
  assert.deepEqual(field(host, "Event character field").children.map(option => option.value), ["character.hp.current", "character.hp.percent"]);
  edit(field(host, "Rule name"), "Damage");
  check(field(host, "Use a condition"), true);
  edit(field(host, "Comparison"), "lt");
  edit(field(host, "Threshold / comparison value"), 25);
  edit(field(host, "Action target"), "portrait");
  check(field(host, "Keep effect active while condition matches"), true);
  const damage = controls.getValue().triggers[0];
  assert.equal(damage.event, "decreased"); assert.equal(damage.field, "character.hp.current");
  assert.equal(damage.condition.operator, "lt"); assert.equal(damage.condition.value, 25); assert.equal(damage.action.target, "portrait"); assert.equal(damage.continuous, true);
  await click(button(host, "Preview rule locally")); assert.deepEqual(previews, [damage.id]);
  await click(button(host, "Add trigger rule"));
  assert.equal(controls.getValue().triggers.length, 2); assert.notEqual(controls.getValue().triggers[0].id, controls.getValue().triggers[1].id);
  edit(field(host, "Event", 1), "crossed-below");
  assert.equal(controls.getValue().triggers[1].condition.value, 25);
  await click(button(host, "Delete rule")); assert.equal(controls.getValue().triggers.length, 1);
});

test("examples create ordinary editable settings and inherited settings remain previewable", async () => {
  const host = new Element("div");
  const controls = renderAnimationControls(host, { fields });
  edit(field(host, "Editable example"), "low-health-warning"); await click(button(host, "Apply example"));
  assert.equal(controls.getValue().triggers[0].continuous, true);
  edit(field(host, "Threshold / comparison value"), 30);
  assert.equal(controls.getValue().triggers[0].condition.value, 30);
  edit(field(host, "Action"), "hide"); assert.equal(controls.getValue().triggers[0].continuous, false);
  const readonly = new Element("div"), previews = [];
  renderAnimationControls(readonly, { value: controls.getValue(), fields, readOnly: true, onPreview: config => previews.push(config) });
  assert.equal(field(readonly, "Duration (ms)").disabled, true);
  assert.equal(button(readonly, "Add trigger rule").disabled, true);
  await click(button(readonly, "Preview emphasis")); assert.equal(previews.length, 1);
});

test("overlay animation edits remain private and previews preserve geometry, zoom and stored data", async () => {
  const overlay = createOverlay(); overlay.layers.push(createLayer("text", overlay.canvas));
  const state = { ...createState(), overlays: [overlay], activeOverlayId: overlay.id };
  configureEditor({ store: { getState: () => structuredClone(state), listPresets: () => [] }, characterData: { fieldDefinitions: () => fields } });
  const editor = new OverlayEditor(); editor._loadDraft(overlay, 0);
  editor.element = new Element("div"); editor._zoom = 2;
  const previews = [];
  editor._preview = { renderer: { previewAnimation: (...args) => previews.push(args), resetAnimations() {}, previewTrigger() {} } };
  editor._updatePreview = async () => {};
  const target = editor._draft.layers[0], host = new Element("div");
  const geometry = { x: target.x, y: target.y, width: target.width, height: target.height, rotation: target.rotation };
  editor._renderAnimationControls(host, target);
  edit(field(host, "Animation type"), "fade-in");
  await click(button(host, "Preview entrance"));
  assert.equal(editor._dirty, true); assert.equal(state.overlays[0].layers[0].animations.entrance, null);
  assert.equal(target.animations.entrance.type, "fade-in"); assert.equal(previews[0][0], target.id); assert.equal(editor._zoom, 2);
  for (const [key, value] of Object.entries(geometry)) assert.equal(target[key], value);
});

test("widget instance animation inheritance is explicit and changing it does not change its Actor", () => {
  const preset = createWidgetPreset(); preset.animations.emphasis = validateAnimationConfig({ type: "pulse" });
  const overlay = createOverlay(), instance = createWidgetInstance(preset); instance.actorUuid = "Actor.hero"; overlay.layers.push(instance);
  configureEditor({ widgetPresets: { list: () => [preset] }, characterData: { fieldDefinitions: () => fields } });
  const editor = new OverlayEditor(); editor._loadDraft(overlay, 0); editor.element = new Element("div"); editor._updatePreview = async () => {}; editor._renderLayerProperties = () => {};
  const host = new Element("div"), target = editor._draft.layers[0]; editor._renderAnimationControls(host, target);
  const inherit = all(host).find(element => element.tagName === "INPUT" && element.type === "checkbox" && element.checked && element.getAttribute("aria-label") === undefined);
  assert.equal(field(host, "Animation type", 2).disabled, true);
  check(inherit, false);
  assert.equal(target.animationOverrides, true); assert.equal(target.animations.emphasis.type, "pulse"); assert.equal(target.actorUuid, "Actor.hero");
  target.animations.emphasis.duration = 700;
  assert.equal(preset.animations.emphasis.duration, 500);
});

test("live controls expose only enabled manual rules and enforce GM authorization on every command", async () => {
  const commands = [];
  configureLiveControls({ liveControls: {
    getState: () => ({ activeOverlayId: "overlay", overlays: [{ id: "overlay", name: "Stream" }], layers: [{ id: "hero", visible: true, triggers: [{ id: "manual", enabled: true, event: "manual" }, { id: "damage", enabled: true, event: "decreased" }, { id: "off", enabled: false, event: "manual" }] }] }),
    setActive: id => commands.push(["active", id]), setVisibility: (id, value) => commands.push(["visible", id, value]),
    play: (id, value) => commands.push(["play", id, value]), reset: id => commands.push(["reset", id])
  } });
  const panel = new LiveControls(), context = await panel._prepareContext({});
  assert.equal(context.overlays[0].active, true); assert.deepEqual(context.layers[0].rules.map(rule => rule.id), ["manual"]);
  await panel._command("hide", "hero"); await panel._command("show", "hero"); await panel._command("play", "hero", "manual"); await panel._command("reset", "hero");
  assert.deepEqual(commands, [["visible", "hero", false], ["visible", "hero", true], ["play", "hero", { ruleId: "manual" }], ["reset", "hero"]]);
  game.user.isGM = false;
  await assert.rejects(panel._command("show", "hero"), /Game Master/); await assert.rejects(openLiveControls(), /Game Master/);
  assert.equal(panel._canRender({}), false); assert.equal(commands.length, 4);
});

test("Animation Test Controls dispatch every real engine action and limit simulation to explicit demo mode", async () => {
  const host = new Element("div"), calls = [];
  const panel = renderAnimationTestControls(host, { layers: [{ id: "demo", name: "Demo card", dataSource: "demo" }, { id: "real", name: "Real card", dataSource: "actors" }],
    onCommand: (...args) => calls.push(args), onDebug: enabled => calls.push(["debug", enabled]), getDiagnostics: () => [{ instanceId: "demo" }] });
  const expected = [
    ["Play Entrance Animation", "entrance"], ["Play Exit Animation", "exit"], ["Play Pulse Animation", "play"],
    ["Next Page", "next-page"], ["Previous Page", "previous-page"], ["Next Character", "next-actor"], ["Previous Character", "previous-actor"],
    ["Pause Carousel", "pause"], ["Resume Carousel", "resume"], ["Restart Carousel", "reset"], ["Simulate Damage", "damage"], ["Simulate Healing", "healing"]
  ];
  for (const [label, action] of expected) {
    await click(button(host, label));
    const [id, command, target] = calls.at(-1); assert.equal(id, "demo"); assert.equal(target, "preview"); assert.equal(command.action ?? command.kind, action);
  }
  assert.equal(calls[2][1].animation.duration, 1200); assert.equal(calls[2][1].animation.intensity, 1);
  edit(field(host, "Test output"), "obs"); await click(button(host, "Play Pulse Animation")); assert.equal(calls.at(-1)[2], "obs");
  edit(field(host, "Test widget"), "real"); assert.equal(button(host, "Simulate Damage").hidden, true); assert.equal(button(host, "Simulate Healing").hidden, true);
  check(field(host, "Animation and carousel debug mode"), true); await new Promise(resolve => setImmediate(resolve)); panel.refreshDiagnostics();
  assert.deepEqual(calls.at(-1), ["debug", true]); assert.match(field(host, "Animation diagnostics").textContent, /instanceId/);
});

test("animation tests explain motion preferences and detached targets without claiming playback", async () => {
  const host = new Element("div"), calls = [];
  let blockedReason = "animations-disabled";
  renderAnimationTestControls(host, { layers: [{ id: "card", name: "Character card" }],
    getPlaybackState: id => { assert.equal(id, "card"); return { blockedReason, entrance: true, exit: true }; },
    onCommand: (...args) => calls.push(args) });
  const status = all(host).find(element => element.getAttribute("role") === "status");
  await click(button(host, "Play Pulse Animation"));
  assert.equal(calls.length, 0); assert.match(status.textContent, /animations are disabled/);
  blockedReason = "reduced-motion";
  await click(button(host, "Play Entrance Animation"));
  assert.equal(calls.length, 0); assert.match(status.textContent, /Reduced motion/);
  blockedReason = "detached";
  await click(button(host, "Play Exit Animation"));
  assert.equal(calls.length, 0); assert.match(status.textContent, /not mounted/);
  blockedReason = null;
  await click(button(host, "Play Pulse Animation"));
  assert.equal(calls.length, 1); assert.match(status.textContent, /requested in editor preview/); assert.doesNotMatch(status.textContent, /played/);
});

test("playback blockers are visible before a test and refresh independently of command results or debug mode", async () => {
  const host = new Element("div"), calls = [];
  let blockedReason = "reduced-motion";
  const panel = renderAnimationTestControls(host, { layers: [{ id: "card", name: "Character card" }], debug: false,
    getPlaybackState: () => ({ blockedReason, entrance: true, exit: true }), onCommand: (...args) => calls.push(args) });
  const notice = field(host, "Animation playback availability");
  const status = all(host).find(element => element.getAttribute("role") === "status");
  assert.equal(notice.hidden, false, "A motion preference must be explained before the user attempts playback");
  assert.equal(notice.dataset.blockedReason, "reduced-motion");
  assert.match(notice.textContent, /Fade In, Fade Out, Pulse, and carousel transition effects are suppressed/);
  assert.match(notice.textContent, /Game Settings → Modular Stream Overlay → Respect reduced motion/);
  assert.match(notice.textContent, /operating-system settings stay unchanged/);
  assert.equal(calls.length, 0);
  await click(button(host, "Next Page"));
  assert.equal(calls.length, 1, "Reduced motion still allows carousel navigation");
  const resultMessage = status.textContent;
  assert.match(resultMessage, /Next Page.*requested in editor preview/);
  assert.equal(notice.hidden, false, "A command result must not replace the persistent blocker explanation");
  blockedReason = null; panel.refreshDiagnostics();
  assert.equal(notice.hidden, true, "Refreshing without debug enabled clears a resolved playback blocker");
  assert.equal(notice.textContent, "");
  assert.equal(status.textContent, resultMessage, "Availability updates retain the latest command result");
  await click(button(host, "Play Pulse Animation"));
  assert.equal(calls.length, 2); assert.equal(calls.at(-1)[1].kind, "play");
  blockedReason = "animations-disabled"; await click(button(host, "Refresh diagnostics"));
  assert.equal(notice.hidden, false); assert.equal(notice.dataset.blockedReason, "animations-disabled");
  assert.match(notice.textContent, /Game Settings → Modular Stream Overlay → Enable overlay animations/);
  await click(button(host, "Play Pulse Animation"));
  assert.equal(calls.length, 2, "The actionable notice does not bypass the existing preference guard");
});

test("playback availability follows widget and output selection without attributing preview blockers to OBS", async () => {
  const host = new Element("div"), calls = [], reads = [];
  renderAnimationTestControls(host, { layers: [{ id: "blocked", name: "Blocked card" }, { id: "ready", name: "Ready card" }],
    getPlaybackState: id => { reads.push(id); return { blockedReason: id === "blocked" ? "reduced-motion" : null, entrance: true, exit: true }; },
    onCommand: (...args) => calls.push(args) });
  const notice = field(host, "Animation playback availability");
  assert.equal(notice.hidden, false);
  edit(field(host, "Test widget"), "ready");
  assert.equal(notice.hidden, true); assert.equal(reads.at(-1), "ready");
  edit(field(host, "Test widget"), "blocked");
  assert.equal(notice.hidden, false); assert.equal(reads.at(-1), "blocked");
  const localReads = reads.length;
  edit(field(host, "Test output"), "obs");
  assert.equal(notice.hidden, true); assert.equal(notice.textContent, "");
  await click(button(host, "Refresh diagnostics")); await click(button(host, "Play Pulse Animation"));
  assert.equal(reads.length, localReads, "OBS controls must not query editor preview playback availability");
  assert.equal(calls.length, 1); assert.equal(calls[0][2], "obs");
  edit(field(host, "Test output"), "preview");
  assert.equal(notice.hidden, false, "Returning to preview restores its own current blocker");
  assert.equal(reads.at(-1), "blocked");
});

test("hidden widgets require an entrance before emphasis and missing configured effects are reported", async () => {
  const host = new Element("div"), calls = [];
  const state = { blockedReason: "hidden", entrance: true, exit: true };
  renderAnimationTestControls(host, { layers: [{ id: "card", name: "Character card" }], getPlaybackState: () => state,
    onCommand: (_id, command) => { calls.push(command); if (command.kind === "entrance") state.blockedReason = null; } });
  const status = all(host).find(element => element.getAttribute("role") === "status");
  await click(button(host, "Play Pulse Animation"));
  assert.equal(calls.length, 0); assert.match(status.textContent, /hidden.*Play Entrance Animation/);
  await click(button(host, "Play Entrance Animation")); await click(button(host, "Play Pulse Animation"));
  assert.deepEqual(calls.map(command => command.kind), ["entrance", "play"]);
  state.entrance = false; state.exit = false;
  await click(button(host, "Play Entrance Animation")); assert.match(status.textContent, /Configure an entrance animation/);
  await click(button(host, "Play Exit Animation")); assert.match(status.textContent, /Configure an exit animation/);
  assert.equal(calls.length, 2);
});

test("OBS test requests do not infer remote playback from local preview state", async () => {
  const host = new Element("div"), calls = [];
  renderAnimationTestControls(host, { layers: [{ id: "card", name: "Character card" }], target: "obs",
    getPlaybackState: () => { throw new Error("Local preview state must not be used for OBS."); }, onCommand: (...args) => calls.push(args) });
  await click(button(host, "Play Entrance Animation"));
  assert.equal(calls.length, 1); assert.equal(calls[0][2], "obs");
  const status = all(host).find(element => element.getAttribute("role") === "status");
  assert.match(status.textContent, /command sent to OBS/); assert.doesNotMatch(status.textContent, /played/);
});

test("editor test actions supply overlay identity, separate saved OBS from drafts, and never simulate real Actors", async () => {
  const preset = createWidgetPreset(), overlay = createOverlay(), instance = createWidgetInstance(preset);
  overlay.layers.push(instance); const state = { ...createState(), overlays: [overlay], activeOverlayId: overlay.id };
  const preview = [], live = [];
  configureEditor({ store: { getState: () => structuredClone(state), listPresets: () => [] }, publishTestCommand: async (...args) => live.push(args) });
  const editor = new OverlayEditor(); editor._loadDraft(overlay, 0); editor._preview = { renderer: { handleAnimationCommand(command) { preview.push(command); return command.overlayId === overlay.id; } } };
  await editor._runAnimationTest(instance.id, { kind: "entrance" });
  assert.equal(preview[0].overlayId, overlay.id); assert.equal(preview[0].layerId, instance.id);
  await editor._previewAssignedActor(editor._draft.layers[0], "Actor.hero"); assert.equal(preview.at(-1).overlayId, overlay.id);
  editor._dirty = true; await assert.rejects(editor._runAnimationTest(instance.id, { kind: "exit" }, "obs"), /Save overlay/);
  editor._dirty = false; await editor._runAnimationTest(instance.id, { kind: "play" }, "obs"); assert.deepEqual(live, [[instance.id, { kind: "play" }]]);
  await assert.rejects(editor._runAnimationTest(instance.id, { kind: "demo", action: "damage" }), /DEMO DATA/);
  assert.equal(state.overlays[0].layers[0].dataSource, "actors"); assert.equal(editor._dirty, false);
});
