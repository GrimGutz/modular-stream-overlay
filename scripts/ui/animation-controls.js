import {
  ANIMATION_DEFINITIONS, EASINGS, TRIGGER_EVENTS, CONDITION_OPERATORS, ACTION_TYPES,
  validateAnimationConfig, validateAnimationSettings, validateTriggerRules, createAnimationExamples
} from "../animation/schema.js";

const copy = value => structuredClone(value);
const titleCase = value => value.replace(/-/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
const NUMERIC = new Set(["increased", "decreased", "crossed-above", "crossed-below", "gt", "lt", "gte", "lte"]);
const DATA_EVENTS = new Set(["field-changed", "increased", "decreased", "crossed-above", "crossed-below"]);
const EVENT_LABELS = { visible: "Becomes visible", hidden: "Becomes hidden", "field-changed": "Character field changes", increased: "Numeric value increases", decreased: "Numeric value decreases", "crossed-above": "Crosses above threshold", "crossed-below": "Crosses below threshold", manual: "Manual · GM control" };
const OPERATOR_LABELS = { eq: "Equals", ne: "Not equals", gt: "Greater than", lt: "Less than", gte: "Greater than or equal", lte: "Less than or equal", increased: "Value increased", decreased: "Value decreased", "crossed-above": "Crossed above threshold", "crossed-below": "Crossed below threshold" };
const ACTION_LABELS = { "play-animation": "Play animation", show: "Show", hide: "Hide", glow: "Temporary glow", "color-flash": "Temporary color flash", "animate-number": "Animate numeric value" };

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function uniqueId() { return `trigger-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`}`; }
// Preserve the objects captured by focused controls while accepting normalized values.
function replaceContents(target, source) {
  for (const key of Object.keys(target)) if (!(key in source)) delete target[key];
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && target[key] && typeof target[key] === "object" && Array.isArray(value) === Array.isArray(target[key])) replaceContents(target[key], value);
    else target[key] = value;
  }
  if (Array.isArray(target)) target.length = source.length;
}

/** Draft-only controls shared by the overlay editor, component editor, and whole widget design. */
export function renderAnimationControls(host, {
  value = {}, draftValue, fields = [], targets = [], disabled = false, readOnly = false,
  onChange = () => {}, onDraftChange = () => {}, onInvalid = () => {}, onPreview = () => {}, onReset = () => {}, onTriggerPreview = () => {}
} = {}) {
  const current = draftValue ? copy(draftValue) : { animations: validateAnimationSettings(value.animations ?? {}), triggers: validateTriggerRules(value.triggers ?? []) };
  let failure = "";
  let status;
  const valid = () => ({ animations: validateAnimationSettings(current.animations), triggers: validateTriggerRules(current.triggers) });
  try { valid(); } catch (error) { failure = error.message; }
  const report = message => { failure = message; onInvalid(message); if (status) { status.textContent = message; status.hidden = !message; } };
  const commit = (next, { redraw = false } = {}) => {
    replaceContents(current, next);
    onDraftChange(copy(current));
    try {
      replaceContents(current, valid()); onChange(copy(current)); report("");
      for (const input of host.querySelectorAll?.("[data-animation-control]") ?? []) input.setCustomValidity("");
    }
    catch (error) { report(error.message); }
    if (redraw) draw();
  };
  const button = (parent, label, callback, { edit = false } = {}) => {
    const result = node("button", label);
    result.type = "button"; result.disabled = disabled || (edit && readOnly);
    result.addEventListener("click", event => {
      event.preventDefault();
      if (disabled || (edit && readOnly)) return;
      Promise.resolve().then(callback).catch(error => {
        if (status) { status.textContent = error.message || "The preview could not be played."; status.hidden = false; }
      });
    });
    parent.append(result); return result;
  };
  const field = (parent, label, value, callback, { type = "text", options, min, max, step, maxLength } = {}) => {
    const wrapper = node("label", undefined, `mso-layer-field${type === "checkbox" ? " mso-checkbox-field" : ""}`);
    const caption = node("span", label);
    const input = node(options ? "select" : "input");
    input.dataset.animationControl = "";
    input.setAttribute("aria-label", label);
    input.disabled = disabled || readOnly;
    if (options) {
      const choices = options.some(option => (option.value ?? option) === value) || value === "" ? options : [{ value, label: `${value} · unavailable` }, ...options];
      for (const option of choices) { const item = node("option", option.label ?? titleCase(option)); item.value = option.value ?? option; input.append(item); }
    }
    else input.type = type;
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    if (step !== undefined) input.step = step;
    if (maxLength !== undefined) input.maxLength = maxLength;
    if (type === "checkbox") input.checked = !!value;
    else input.value = value ?? "";
    input.addEventListener(options || type === "checkbox" ? "change" : "input", () => {
      if (disabled || readOnly) return;
      const parsed = type === "checkbox" ? input.checked : type === "number" ? input.value.trim() ? Number(input.value) : NaN : input.value;
      callback(parsed);
      input.setCustomValidity(failure);
    });
    if (type === "checkbox") wrapper.append(input, caption);
    else wrapper.append(caption, input);
    parent.append(wrapper); return input;
  };
  const animationFields = (parent, config, change, { category, nullable = false, getConfig = () => config } = {}) => {
    const definitions = ANIMATION_DEFINITIONS.filter(definition => !category || definition.category === category);
    const options = [...(nullable ? [{ value: "", label: "None · immediate" }] : []), ...definitions.map(definition => ({ value: definition.type, label: definition.label }))];
    field(parent, "Animation type", config?.type ?? "", type => change(type ? { ...validateAnimationConfig(), ...(getConfig() ?? {}), type } : null, true), { options });
    if (!config) return;
    const grid = node("div", undefined, "mso-property-grid");
    for (const [property, label, min, max, step] of [["duration", "Duration (ms)", 1, 10000, 1], ["delay", "Delay (ms)", 0, 10000, 1], ["intensity", "Intensity", 0, 2, .05], ["repeat", "Repeat count", 1, 20, 1]]) {
      field(grid, label, config[property], value => change({ ...getConfig(), [property]: value }), { type: "number", min, max, step });
    }
    parent.append(grid);
    field(parent, "Easing", config.easing, value => change({ ...getConfig(), easing: value }), { options: EASINGS });
    field(parent, "Direction", config.direction, value => change({ ...getConfig(), direction: value }), { options: ["normal", "reverse", "alternate"] });
    if (["glow", "color-flash", "flash"].includes(config.type)) field(parent, "Effect color (hex)", config.color ?? "#ff4444", value => change({ ...getConfig(), color: value }), { maxLength: 9 });
  };
  const fieldChoices = (selected, numeric = false) => {
    const supported = fields.filter(entry => !numeric || entry.type === "number").map(entry => ({ value: entry.id, label: entry.label }));
    if (selected && !supported.some(entry => entry.value === selected)) supported.unshift({ value: selected, label: `${selected} · unavailable in this system` });
    if (!supported.length) supported.push({ value: "", label: numeric ? "No supported numeric fields" : "No supported character fields" });
    return supported;
  };
  const firstField = numeric => fields.find(field => !numeric || field.type === "number")?.id ?? "";
  const changeRule = (index, patch, redraw = false) => {
    const next = copy(current); next.triggers[index] = { ...next.triggers[index], ...patch }; commit(next, { redraw });
  };
  const drawRule = (parent, rule, index) => {
    const card = node("fieldset", undefined, "mso-trigger-rule"); card.append(node("legend", rule.name));
    field(card, "Rule name", rule.name, name => changeRule(index, { name }), { maxLength: 80 });
    field(card, "Rule enabled", rule.enabled, enabled => changeRule(index, { enabled }), { type: "checkbox" });
    field(card, "Event", rule.event, event => {
      const field = DATA_EVENTS.has(event) ? (NUMERIC.has(event) && !fields.some(entry => entry.id === rule.field && entry.type === "number") ? firstField(true) : rule.field || firstField(false)) : rule.field;
      const condition = ["crossed-above", "crossed-below"].includes(event) ? { ...(rule.condition ?? {}), operator: event, value: typeof rule.condition?.value === "number" ? rule.condition.value : 25 } : rule.condition;
      changeRule(index, { event, field, condition, continuous: DATA_EVENTS.has(event) ? rule.continuous : false }, true);
    }, { options: TRIGGER_EVENTS.map(value => ({ value, label: EVENT_LABELS[value] ?? titleCase(value) })) });
    if (DATA_EVENTS.has(rule.event)) field(card, "Event character field", rule.field, field => changeRule(index, { field }, true), { options: fieldChoices(rule.field, NUMERIC.has(rule.event)) });
    field(card, "Use a condition", !!rule.condition, enabled => {
      const field = rule.field || firstField(false);
      changeRule(index, { field, condition: enabled ? { operator: "eq", value: "" } : null, continuous: enabled && rule.continuous }, true);
    }, { type: "checkbox" });
    if (rule.condition) {
      const condition = rule.condition;
      field(card, "Condition field", condition.field ?? rule.field, field => {
        const numeric = fields.some(entry => entry.id === field && entry.type === "number");
        changeRule(index, { condition: { ...condition, field, value: numeric && typeof condition.value !== "number" ? 0 : condition.value } }, true);
      }, { options: fieldChoices(condition.field ?? rule.field, NUMERIC.has(condition.operator)) });
      field(card, "Comparison", condition.operator, operator => {
        const value = NUMERIC.has(operator) && typeof condition.value !== "number" ? 25 : condition.value;
        const conditionField = fields.find(entry => entry.id === (condition.field ?? rule.field));
        changeRule(index, { condition: { ...condition, operator, value, ...(NUMERIC.has(operator) && conditionField?.type !== "number" ? { field: firstField(true) } : {}) } }, true);
      }, { options: CONDITION_OPERATORS.map(value => ({ value, label: OPERATOR_LABELS[value] ?? titleCase(value) })) });
      if (!["increased", "decreased"].includes(condition.operator)) {
        const definition = fields.find(entry => entry.id === (condition.field ?? rule.field));
        const numeric = NUMERIC.has(condition.operator) || definition?.type === "number";
        field(card, numeric ? "Threshold / comparison value" : "Comparison value", condition.value, value => changeRule(index, { condition: { ...condition, value } }), { type: numeric ? "number" : "text", step: "any", maxLength: 1000 });
      }
    }
    field(card, "Action", rule.action.type, type => {
      changeRule(index, { action: { ...rule.action, type, ...(["play-animation", "glow", "color-flash", "animate-number"].includes(type) && !rule.action.animation ? { animation: validateAnimationConfig({ type: type === "glow" ? "glow" : type === "color-flash" ? "color-flash" : "pulse", duration: 400, color: "#ff4444" }) } : {}) }, continuous: ["play-animation", "glow", "color-flash"].includes(type) && rule.continuous }, true);
    }, { options: ACTION_TYPES.map(value => ({ value, label: ACTION_LABELS[value] ?? titleCase(value) })) });
    field(card, "Action target", rule.action.target, target => changeRule(index, { action: { ...rule.action, target } }), { options: [{ value: "self", label: "This element / whole widget" }, ...targets.filter(target => target.id !== "self").map(target => ({ value: target.id, label: target.name ?? target.id }))] });
    if (["play-animation", "glow", "color-flash", "animate-number"].includes(rule.action.type)) {
      animationFields(card, rule.action.animation ?? validateAnimationConfig({ type: "pulse", duration: 400 }), (animation, redraw) => changeRule(index, { action: { ...rule.action, animation } }, redraw), { category: "emphasis", getConfig: () => rule.action.animation ?? validateAnimationConfig({ type: "pulse", duration: 400 }) });
    }
    if (DATA_EVENTS.has(rule.event) && rule.condition && ["play-animation", "glow", "color-flash"].includes(rule.action.type)) {
      field(card, "Keep effect active while condition matches", rule.continuous, continuous => changeRule(index, { continuous }), { type: "checkbox" });
      card.append(node("p", "Continuous effects stop when the condition becomes false. One-shot rules run only on matching changes.", "mso-help"));
    }
    const actions = node("div", undefined, "mso-image-actions");
    button(actions, "Preview rule locally", () => { valid(); return onTriggerPreview(rule.id); });
    button(actions, "Delete rule", () => { const next = copy(current); next.triggers.splice(index, 1); commit(next, { redraw: true }); }, { edit: true });
    card.append(actions); parent.append(card);
  };
  function draw() {
    const openGroups = new Map([...(host.querySelectorAll?.("details[data-animation-group]") ?? [])].map(element => [element.dataset.animationGroup, element.open]));
    host.replaceChildren();
    const section = node("details", undefined, "mso-animation-section");
    section.dataset.animationGroup = "settings"; section.open = openGroups.get("settings") ?? true; section.append(node("summary", "Animations"));
    section.append(node("p", "These settings stay in this draft until Save. Preview and Reset affect this editor only.", "mso-help"));
    const examples = node("div", undefined, "mso-animation-examples");
    const exampleSelect = field(examples, "Editable example", "", () => {}, { options: [{ value: "", label: "Choose an example" }, ...createAnimationExamples().map(example => ({ value: example.id, label: example.name }))] });
    button(examples, "Apply example", () => {
      const example = createAnimationExamples().find(entry => entry.id === exampleSelect.value); if (!example) return;
      const next = copy(current); next.animations[example.slot] = example.animation;
      if (example.trigger) { if (next.triggers.length >= 32) throw new Error("At most 32 trigger rules are supported."); next.triggers.push({ ...example.trigger, id: uniqueId() }); }
      commit(next, { redraw: true });
    }, { edit: true });
    section.append(examples);
    for (const [slot, label] of [["entrance", "Entrance"], ["exit", "Exit"], ["emphasis", "Emphasis"]]) {
      const group = node("details", undefined, "mso-animation-group"); group.append(node("summary", label));
      group.dataset.animationGroup = slot; group.open = openGroups.get(slot) ?? false;
      animationFields(group, current.animations[slot], (animation, redraw) => { const next = copy(current); next.animations[slot] = animation; commit(next, { redraw }); }, { category: slot, nullable: true });
      const actions = node("div", undefined, "mso-image-actions");
      const preview = button(actions, `Preview ${label.toLowerCase()}`, () => { valid(); if (current.animations[slot]) return onPreview(copy(current.animations[slot])); });
      preview.disabled = disabled || !current.animations[slot];
      group.append(actions); section.append(group);
    }
    const transitions = node("details", undefined, "mso-animation-group"); transitions.append(node("summary", "Value transitions"));
    transitions.dataset.animationGroup = "transitions"; transitions.open = openGroups.get("transitions") ?? false;
    const transition = current.animations.transition;
    const transitionChange = patch => { const next = copy(current); next.animations.transition = { ...next.animations.transition, ...patch }; commit(next); };
    field(transitions, "Transition duration (ms)", transition.duration, duration => transitionChange({ duration }), { type: "number", min: 0, max: 10000, step: 1 });
    field(transitions, "Transition easing", transition.easing, easing => transitionChange({ easing }), { options: EASINGS });
    for (const [property, label] of [["bar", "Smooth resource bars"], ["numeric", "Interpolate numeric text"], ["color", "Smooth colors"], ["opacity", "Smooth opacity"]]) field(transitions, label, transition[property], value => transitionChange({ [property]: value }), { type: "checkbox" });
    transitions.append(node("p", "Use a duration above zero to enable transitions. Character values are read only; these settings animate their display.", "mso-help"));
    section.append(transitions);
    const reset = node("div", undefined, "mso-image-actions"); button(reset, "Reset temporary effects", onReset); section.append(reset);
    status = node("p", failure, "mso-animation-error"); status.hidden = !failure; status.setAttribute("role", "status"); section.append(status);
    host.append(section);
    const rules = node("details", undefined, "mso-animation-section"); rules.append(node("summary", `Triggers (${current.triggers.length})`));
    rules.dataset.animationGroup = "triggers"; rules.open = openGroups.get("triggers") ?? !!current.triggers.length;
    rules.append(node("p", "Choose an event, optional condition, and visual action. Layer and whole-widget manual rules appear in Live Controls. To manually animate a component there, add a whole-widget manual rule targeting that component. Character fields come from the active system adapter.", "mso-help"));
    current.triggers.forEach((rule, index) => drawRule(rules, rule, index));
    const add = button(rules, "Add trigger rule", () => {
      const next = copy(current); next.triggers.push({ id: uniqueId(), name: `Trigger ${next.triggers.length + 1}`, enabled: true, event: "manual", field: "", condition: null, action: { type: "play-animation", target: "self", animation: validateAnimationConfig({ type: "pulse", duration: 400 }) }, continuous: false });
      commit(next, { redraw: true });
    }, { edit: true }); add.disabled = disabled || readOnly || current.triggers.length >= 32;
    host.append(rules);
  }
  draw();
  onInvalid(failure);
  return { getValue: () => copy(valid()), isValid: () => !failure };
}

/** Exercise the same command dispatcher used by the stream; all test state is temporary. */
export function renderAnimationTestControls(host, {
  layers = [], layerId = "", target = "preview", disabled = false, debug = false,
  onSelection = () => {}, onCommand = () => {}, onDebug = () => {}, getDiagnostics = () => [], getPlaybackState = () => null
} = {}) {
  host.replaceChildren();
  const selection = node("div", undefined, "mso-test-selection");
  const select = (label, options, value, callback) => {
    const wrapper = node("label", undefined, "mso-layer-field"); wrapper.append(node("span", label));
    const input = node("select"); input.setAttribute("aria-label", label); input.disabled = disabled;
    for (const option of options) { const item = node("option", option.label); item.value = option.value; input.append(item); }
    input.value = value; input.addEventListener("change", () => callback(input.value)); wrapper.append(input); selection.append(wrapper); return input;
  };
  let selectedId = layers.some(layer => layer.id === layerId) ? layerId : layers[0]?.id ?? "";
  const layerSelect = select("Test widget", layers.map(layer => ({ value: layer.id, label: layer.name })), selectedId, value => { selectedId = value; onSelection({ layerId: value, target }); updateButtons(); refreshDiagnostics(); });
  layerSelect.disabled ||= !layers.length;
  select("Test output", [{ value: "preview", label: "Editor preview" }, { value: "obs", label: "OBS (saved active overlay)" }], target, value => { target = value; onSelection({ layerId: selectedId, target }); refreshDiagnostics(); });
  host.append(selection);
  const hint = node("p", "Editor preview uses this draft. For OBS, save this overlay and select it in Active on stream. Test actions never change real Actor statistics.", "mso-help"); host.append(hint);
  const playbackNotice = node("p", "", "mso-help mso-animation-blocker");
  playbackNotice.setAttribute("aria-label", "Animation playback availability");
  playbackNotice.setAttribute("role", "note"); playbackNotice.setAttribute("aria-live", "polite");
  playbackNotice.hidden = true; host.append(playbackNotice);
  const playbackMessages = {
    "animations-disabled": "Overlay animations are disabled. Fade In, Fade Out, Pulse, and carousel transition effects are suppressed; pages and characters still change instantly. Open Foundry Game Settings → Modular Stream Overlay → Enable overlay animations and turn it on to enable animated overlays.",
    "reduced-motion": "Reduced motion is active in this browser. Fade In, Fade Out, Pulse, and carousel transition effects are suppressed; pages and characters still change instantly. To enable animated overlays, open Foundry Game Settings → Modular Stream Overlay → Respect reduced motion and turn it off. Your operating-system settings stay unchanged.",
    hidden: "This widget is hidden. Click Play Entrance Animation before testing another effect.",
    "layer-hidden": "This layer or its parent is hidden. Show it with the layer visibility control before testing animations.",
    detached: "This widget is not mounted in the preview. Wait for the preview to load."
  };
  function refreshPlaybackNotice() {
    playbackNotice.hidden = true; playbackNotice.textContent = ""; playbackNotice.dataset.blockedReason = "";
    // The preview's preferences and target cannot establish the remote OBS state.
    if (target !== "preview" || !selectedId || disabled) return;
    try {
      const reason = getPlaybackState(selectedId)?.blockedReason;
      if (!reason) return;
      playbackNotice.dataset.blockedReason = reason;
      playbackNotice.textContent = playbackMessages[reason] ?? "This widget cannot play an animation in its current state.";
    } catch { playbackNotice.textContent = "Preview playback status is unavailable. Refresh diagnostics after the preview loads."; }
    playbackNotice.hidden = false;
  }
  const actions = node("div", undefined, "mso-animation-test-actions"); host.append(actions);
  const status = node("p", layers.length ? "Choose an action to test the selected widget." : "Add a character widget to test its animations and carousel.", "mso-help"); status.setAttribute("role", "status");
  const buttons = [];
  const run = async (label, command) => {
    if (disabled || !selectedId) return;
    buttons.forEach(button => { button.disabled = true; });
    try {
      if (target === "preview" && ["entrance", "exit", "play"].includes(command.kind)) {
        const state = getPlaybackState(selectedId);
        if (state?.blockedReason && !(state.blockedReason === "hidden" && command.kind === "entrance")) throw new Error(playbackMessages[state.blockedReason] ?? "This widget cannot play an animation in its current state.");
        if (["entrance", "exit"].includes(command.kind) && state?.[command.kind] === false) throw new Error(`Configure an ${command.kind} animation for this widget before testing it.`);
      }
      await onCommand(selectedId, copy(command), target);
      status.textContent = `${label} — ${target === "obs" ? "command sent to OBS" : "requested in editor preview"}.`;
    }
    catch (error) { status.textContent = error.message || "The test could not be played."; }
    finally { updateButtons(); refreshDiagnostics(); }
  };
  for (const [label, command] of [
    ["Play Entrance Animation", { kind: "entrance" }], ["Play Exit Animation", { kind: "exit" }],
    ["Play Pulse Animation", { kind: "play", animation: { type: "pulse", duration: 1200, intensity: 1 } }],
    ["Next Page", { kind: "carousel", action: "next-page" }], ["Previous Page", { kind: "carousel", action: "previous-page" }],
    ["Next Character", { kind: "carousel", action: "next-actor" }], ["Previous Character", { kind: "carousel", action: "previous-actor" }],
    ["Pause Carousel", { kind: "carousel", action: "pause" }], ["Resume Carousel", { kind: "carousel", action: "resume" }],
    ["Restart Carousel", { kind: "carousel", action: "reset" }],
    ["Simulate Damage", { kind: "demo", action: "damage" }], ["Simulate Healing", { kind: "demo", action: "healing" }]
  ]) {
    const button = node("button", label); button.type = "button"; button.dataset.testCommand = command.kind; button.dataset.demoOnly = String(command.kind === "demo");
    button.addEventListener("click", () => { void run(label, command); }); actions.append(button); buttons.push(button);
  }
  function updateButtons() {
    const synthetic = layers.find(layer => layer.id === selectedId)?.dataSource === "demo";
    for (const button of buttons) { button.hidden = button.dataset.demoOnly === "true" && !synthetic; button.disabled = disabled || !selectedId; }
  }
  updateButtons(); host.append(status);
  const debugLabel = node("label", undefined, "mso-layer-field mso-checkbox-field");
  const checkbox = node("input"); checkbox.type = "checkbox"; checkbox.checked = debug; checkbox.disabled = disabled; checkbox.setAttribute("aria-label", "Animation and carousel debug mode");
  debugLabel.append(checkbox, node("span", "Animation and carousel debug mode")); host.append(debugLabel);
  const diagnostics = node("pre", undefined, "mso-animation-diagnostics"); diagnostics.setAttribute("aria-label", "Animation diagnostics"); diagnostics.hidden = !debug; host.append(diagnostics);
  function refreshDiagnostics() {
    refreshPlaybackNotice();
    if (!checkbox.checked) return;
    try { diagnostics.textContent = target === "obs" ? "OBS commands use the saved active overlay. The runtime metadata below belongs to this editor preview.\n" : "";
      diagnostics.textContent += JSON.stringify(getDiagnostics(), null, 2); }
    catch (error) { diagnostics.textContent = error.message || "Diagnostics unavailable."; }
  }
  checkbox.addEventListener("change", async () => {
    try { await onDebug(checkbox.checked); diagnostics.hidden = !checkbox.checked; refreshDiagnostics(); }
    catch (error) { checkbox.checked = !checkbox.checked; status.textContent = error.message; }
  });
  const refresh = node("button", "Refresh diagnostics"); refresh.type = "button"; refresh.addEventListener("click", refreshDiagnostics); host.append(refresh);
  refreshDiagnostics();
  return { refreshDiagnostics };
}
