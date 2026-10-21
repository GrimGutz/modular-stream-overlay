import { t, uiText, errorText, setText, setAttr } from "./i18n.js";
import { fieldLabel } from "./field-settings.js";
import {
  ANIMATION_DEFINITIONS, EASINGS, TRIGGER_EVENTS, CONDITION_OPERATORS, ACTION_TYPES,
  validateAnimationConfig, validateAnimationSettings, validateTriggerRules, createAnimationExamples
} from "../animation/schema.js";

const L = (key, params = {}) => ({ key, params });
const S = (literal, key) => ({ key, params: {}, literal });
const labelText = value => value?.key ? t(value.key, value.params) : String(value ?? "");
function writeText(element, value) {
  if (value?.key) {
    if (value.literal !== undefined) element.textContent = uiText(value.literal);
    setText(element, value.key, value.params);
  } else {
    element.removeAttribute?.("data-i18n");
    if (element.dataset) delete element.dataset.i18n;
    element.textContent = value ?? "";
  }
}
function writeAttr(element, attribute, value) {
  if (value?.key) setAttr(element, attribute, value.key, value.params);
  else element.setAttribute(attribute, value);
}
const copy = value => structuredClone(value);
const titleCase = value => value.replace(/-/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
const NUMERIC = new Set(["increased", "decreased", "crossed-above", "crossed-below", "gt", "lt", "gte", "lte"]);
const DATA_EVENTS = new Set(["field-changed", "increased", "decreased", "crossed-above", "crossed-below"]);
const EVENT_LABELS = { visible: S("Becomes visible", "Animations.Event.visible"), hidden: S("Becomes hidden", "Animations.Event.hidden"), "field-changed": S("Character field changes", "Animations.Event.field-changed"), increased: S("Numeric value increases", "Animations.Event.increased"), decreased: S("Numeric value decreases", "Animations.Event.decreased"), "crossed-above": S("Crosses above threshold", "Animations.Event.crossed-above"), "crossed-below": S("Crosses below threshold", "Animations.Event.crossed-below"), manual: S("Manual · GM control", "Animations.Event.manual") };
const OPERATOR_LABELS = { eq: S("Equals", "Animations.Operator.eq"), ne: S("Not equals", "Animations.Operator.ne"), gt: S("Greater than", "Animations.Operator.gt"), lt: S("Less than", "Animations.Operator.lt"), gte: S("Greater than or equal", "Animations.Operator.gte"), lte: S("Less than or equal", "Animations.Operator.lte"), increased: S("Value increased", "Animations.Operator.increased"), decreased: S("Value decreased", "Animations.Operator.decreased"), "crossed-above": S("Crossed above threshold", "Animations.Operator.crossed-above"), "crossed-below": S("Crossed below threshold", "Animations.Operator.crossed-below") };
const ACTION_LABELS = { "play-animation": S("Play animation", "Animations.Action.play-animation"), show: S("Show", "Animations.Action.show"), hide: S("Hide", "Animations.Action.hide"), glow: S("Temporary glow", "Animations.Action.glow"), "color-flash": S("Temporary color flash", "Animations.Action.color-flash"), "animate-number": S("Animate numeric value", "Animations.Action.animate-number") };

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) writeText(element, text);
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
  try { valid(); } catch (error) { failure = errorText(error); }
  const report = message => { failure = message; onInvalid(message); if (status) { writeText(status, message); status.hidden = !message; } };
  const commit = (next, { redraw = false } = {}) => {
    replaceContents(current, next);
    onDraftChange(copy(current));
    try {
      replaceContents(current, valid()); onChange(copy(current)); report("");
      for (const input of host.querySelectorAll?.("[data-animation-control]") ?? []) input.setCustomValidity("");
    }
    catch (error) { report(errorText(error)); }
    if (redraw) draw();
  };
  const button = (parent, label, callback, { edit = false } = {}) => {
    const result = node("button", label);
    result.type = "button"; result.disabled = disabled || (edit && readOnly);
    result.addEventListener("click", event => {
      event.preventDefault();
      if (disabled || (edit && readOnly)) return;
      Promise.resolve().then(callback).catch(error => {
        if (status) { writeText(status, errorText(error) || t("Animations.PreviewFailed")); status.hidden = false; }
      });
    });
    parent.append(result); return result;
  };
  const field = (parent, label, value, callback, { type = "text", options, min, max, step, maxLength } = {}) => {
    const wrapper = node("label", undefined, `mso-layer-field${type === "checkbox" ? " mso-checkbox-field" : ""}`);
    const caption = node("span", label);
    const input = node(options ? "select" : "input");
    input.dataset.animationControl = "";
    writeAttr(input, "aria-label", label);
    input.disabled = disabled || readOnly;
    if (options) {
      const choices = options.some(option => (option.value ?? option) === value) || value === "" ? options : [{ value, label: L("Animations.Unavailable", { value }) }, ...options];
      for (const option of choices) { const item = node("option", option.label ?? titleCase(option)); item.value = option.value ?? option; if (option.fieldId) item.dataset.editorFieldId = option.fieldId; input.append(item); }
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
    const options = [...(nullable ? [{ value: "", label: L("Animations.NoneImmediate") }] : []), ...definitions.map(definition => ({ value: definition.type, label: S(definition.label, `Animations.Effect.${definition.type}`) }))];
    field(parent, L("Animations.Type"), config?.type ?? "", type => change(type ? { ...validateAnimationConfig(), ...(getConfig() ?? {}), type } : null, true), { options });
    if (!config) return;
    const grid = node("div", undefined, "mso-property-grid");
    for (const [property, label, min, max, step] of [["duration", L("Animations.Duration"), 1, 10000, 1], ["delay", L("Animations.Delay"), 0, 10000, 1], ["intensity", L("Animations.Intensity"), 0, 2, .05], ["repeat", L("Animations.Repeat"), 1, 20, 1]]) {
      field(grid, label, config[property], value => change({ ...getConfig(), [property]: value }), { type: "number", min, max, step });
    }
    parent.append(grid);
    field(parent, L("Animations.EasingLabel"), config.easing, value => change({ ...getConfig(), easing: value }), { options: EASINGS.map(value => ({ value, label: S(titleCase(value), `Animations.Easing.${value}`) })) });
    field(parent, L("Animations.DirectionLabel"), config.direction, value => change({ ...getConfig(), direction: value }), { options: ["normal", "reverse", "alternate"].map(value => ({ value, label: S(titleCase(value), `Animations.Direction.${value}`) })) });
    if (["glow", "color-flash", "flash"].includes(config.type)) field(parent, L("Animations.EffectColor"), config.color ?? "#ff4444", value => change({ ...getConfig(), color: value }), { maxLength: 9 });
  };
  const fieldChoices = (selected, numeric = false) => {
    const supported = fields.filter(entry => !numeric || entry.type === "number").map(entry => ({ value: entry.id, fieldId: entry.id, label: fieldLabel(entry) }));
    if (selected && !supported.some(entry => entry.value === selected)) supported.unshift({ value: selected, label: L("Animations.UnsupportedField", { value: selected }) });
    if (!supported.length) supported.push({ value: "", label: numeric ? L("Animations.NoNumeric") : L("Animations.NoFields") });
    return supported;
  };
  const firstField = numeric => fields.find(field => !numeric || field.type === "number")?.id ?? "";
  const changeRule = (index, patch, redraw = false) => {
    const next = copy(current); next.triggers[index] = { ...next.triggers[index], ...patch }; commit(next, { redraw });
  };
  const drawRule = (parent, rule, index) => {
    const card = node("fieldset", undefined, "mso-trigger-rule"); card.append(node("legend", rule.name));
    field(card, L("Animations.RuleName"), rule.name, name => changeRule(index, { name }), { maxLength: 80 });
    field(card, L("Animations.RuleEnabled"), rule.enabled, enabled => changeRule(index, { enabled }), { type: "checkbox" });
    field(card, L("Animations.EventLabel"), rule.event, event => {
      const field = DATA_EVENTS.has(event) ? (NUMERIC.has(event) && !fields.some(entry => entry.id === rule.field && entry.type === "number") ? firstField(true) : rule.field || firstField(false)) : rule.field;
      const condition = ["crossed-above", "crossed-below"].includes(event) ? { ...(rule.condition ?? {}), operator: event, value: typeof rule.condition?.value === "number" ? rule.condition.value : 25 } : rule.condition;
      changeRule(index, { event, field, condition, continuous: DATA_EVENTS.has(event) ? rule.continuous : false }, true);
    }, { options: TRIGGER_EVENTS.map(value => ({ value, label: EVENT_LABELS[value] ?? titleCase(value) })) });
    if (DATA_EVENTS.has(rule.event)) field(card, L("Animations.EventField"), rule.field, field => changeRule(index, { field }, true), { options: fieldChoices(rule.field, NUMERIC.has(rule.event)) });
    field(card, L("Animations.UseCondition"), !!rule.condition, enabled => {
      const field = rule.field || firstField(false);
      changeRule(index, { field, condition: enabled ? { operator: "eq", value: "" } : null, continuous: enabled && rule.continuous }, true);
    }, { type: "checkbox" });
    if (rule.condition) {
      const condition = rule.condition;
      field(card, L("Animations.ConditionField"), condition.field ?? rule.field, field => {
        const numeric = fields.some(entry => entry.id === field && entry.type === "number");
        changeRule(index, { condition: { ...condition, field, value: numeric && typeof condition.value !== "number" ? 0 : condition.value } }, true);
      }, { options: fieldChoices(condition.field ?? rule.field, NUMERIC.has(condition.operator)) });
      field(card, L("Animations.Comparison"), condition.operator, operator => {
        const value = NUMERIC.has(operator) && typeof condition.value !== "number" ? 25 : condition.value;
        const conditionField = fields.find(entry => entry.id === (condition.field ?? rule.field));
        changeRule(index, { condition: { ...condition, operator, value, ...(NUMERIC.has(operator) && conditionField?.type !== "number" ? { field: firstField(true) } : {}) } }, true);
      }, { options: CONDITION_OPERATORS.map(value => ({ value, label: OPERATOR_LABELS[value] ?? titleCase(value) })) });
      if (!["increased", "decreased"].includes(condition.operator)) {
        const definition = fields.find(entry => entry.id === (condition.field ?? rule.field));
        const numeric = NUMERIC.has(condition.operator) || definition?.type === "number";
        field(card, numeric ? L("Animations.Threshold") : L("Animations.ComparisonValue"), condition.value, value => changeRule(index, { condition: { ...condition, value } }), { type: numeric ? "number" : "text", step: "any", maxLength: 1000 });
      }
    }
    field(card, L("Animations.ActionLabel"), rule.action.type, type => {
      changeRule(index, { action: { ...rule.action, type, ...(["play-animation", "glow", "color-flash", "animate-number"].includes(type) && !rule.action.animation ? { animation: validateAnimationConfig({ type: type === "glow" ? "glow" : type === "color-flash" ? "color-flash" : "pulse", duration: 400, color: "#ff4444" }) } : {}) }, continuous: ["play-animation", "glow", "color-flash"].includes(type) && rule.continuous }, true);
    }, { options: ACTION_TYPES.map(value => ({ value, label: ACTION_LABELS[value] ?? titleCase(value) })) });
    field(card, L("Animations.ActionTarget"), rule.action.target, target => changeRule(index, { action: { ...rule.action, target } }), { options: [{ value: "self", label: L("Animations.SelfTarget") }, ...targets.filter(target => target.id !== "self").map(target => ({ value: target.id, label: target.name ?? target.id }))] });
    if (["play-animation", "glow", "color-flash", "animate-number"].includes(rule.action.type)) {
      animationFields(card, rule.action.animation ?? validateAnimationConfig({ type: "pulse", duration: 400 }), (animation, redraw) => changeRule(index, { action: { ...rule.action, animation } }, redraw), { category: "emphasis", getConfig: () => rule.action.animation ?? validateAnimationConfig({ type: "pulse", duration: 400 }) });
    }
    if (DATA_EVENTS.has(rule.event) && rule.condition && ["play-animation", "glow", "color-flash"].includes(rule.action.type)) {
      field(card, L("Animations.KeepActive"), rule.continuous, continuous => changeRule(index, { continuous }), { type: "checkbox" });
      card.append(node("p", L("Animations.ContinuousHelp"), "mso-help"));
    }
    const actions = node("div", undefined, "mso-image-actions");
    button(actions, L("Animations.PreviewRule"), () => { valid(); return onTriggerPreview(rule.id); });
    button(actions, L("Animations.DeleteRule"), () => { const next = copy(current); next.triggers.splice(index, 1); commit(next, { redraw: true }); }, { edit: true });
    card.append(actions); parent.append(card);
  };
  function draw() {
    const openGroups = new Map([...(host.querySelectorAll?.("details[data-animation-group]") ?? [])].map(element => [element.dataset.animationGroup, element.open]));
    host.replaceChildren();
    const section = node("details", undefined, "mso-animation-section");
    section.dataset.animationGroup = "settings"; section.open = openGroups.get("settings") ?? true; section.append(node("summary", L("Animations.Title")));
    section.append(node("p", L("Animations.DraftHelp"), "mso-help"));
    const examples = node("div", undefined, "mso-animation-examples");
    const exampleSelect = field(examples, L("Animations.EditableExample"), "", () => {}, { options: [{ value: "", label: L("Animations.ChooseExample") }, ...createAnimationExamples().map(example => ({ value: example.id, label: S(example.name, `Animations.Example.${example.id}`) }))] });
    button(examples, L("Animations.ApplyExample"), () => {
      const example = createAnimationExamples().find(entry => entry.id === exampleSelect.value); if (!example) return;
      const next = copy(current); next.animations[example.slot] = example.animation;
      if (example.trigger) { if (next.triggers.length >= 32) throw new Error(t("Animations.TriggerLimit")); next.triggers.push({ ...example.trigger, id: uniqueId() }); }
      commit(next, { redraw: true });
    }, { edit: true });
    section.append(examples);
    for (const [slot, label] of [["entrance", L("Animations.Entrance")], ["exit", L("Animations.Exit")], ["emphasis", L("Animations.Emphasis")]]) {
      const group = node("details", undefined, "mso-animation-group"); group.append(node("summary", label));
      group.dataset.animationGroup = slot; group.open = openGroups.get(slot) ?? false;
      animationFields(group, current.animations[slot], (animation, redraw) => { const next = copy(current); next.animations[slot] = animation; commit(next, { redraw }); }, { category: slot, nullable: true });
      const actions = node("div", undefined, "mso-image-actions");
      const preview = button(actions, L({ entrance: "Animations.PreviewEntrance", exit: "Animations.PreviewExit", emphasis: "Animations.PreviewEmphasis" }[slot]), () => { valid(); if (current.animations[slot]) return onPreview(copy(current.animations[slot])); });
      preview.disabled = disabled || !current.animations[slot];
      group.append(actions); section.append(group);
    }
    const transitions = node("details", undefined, "mso-animation-group"); transitions.append(node("summary", L("Animations.ValueTransitions")));
    transitions.dataset.animationGroup = "transitions"; transitions.open = openGroups.get("transitions") ?? false;
    const transition = current.animations.transition;
    const transitionChange = patch => { const next = copy(current); next.animations.transition = { ...next.animations.transition, ...patch }; commit(next); };
    field(transitions, L("Animations.TransitionDuration"), transition.duration, duration => transitionChange({ duration }), { type: "number", min: 0, max: 10000, step: 1 });
    field(transitions, L("Animations.TransitionEasing"), transition.easing, easing => transitionChange({ easing }), { options: EASINGS.map(value => ({ value, label: S(titleCase(value), `Animations.Easing.${value}`) })) });
    for (const [property, label] of [["bar", L("Animations.SmoothBars")], ["numeric", L("Animations.InterpolateNumbers")], ["color", L("Animations.SmoothColors")], ["opacity", L("Animations.SmoothOpacity")]]) field(transitions, label, transition[property], value => transitionChange({ [property]: value }), { type: "checkbox" });
    transitions.append(node("p", L("Animations.TransitionHelp"), "mso-help"));
    section.append(transitions);
    const reset = node("div", undefined, "mso-image-actions"); button(reset, L("Animations.ResetEffects"), onReset); section.append(reset);
    status = node("p", failure, "mso-animation-error"); status.hidden = !failure; status.setAttribute("role", "status"); section.append(status);
    host.append(section);
    const rules = node("details", undefined, "mso-animation-section"); rules.append(node("summary", L("Animations.Triggers", { count: current.triggers.length })));
    rules.dataset.animationGroup = "triggers"; rules.open = openGroups.get("triggers") ?? !!current.triggers.length;
    rules.append(node("p", L("Animations.TriggerHelp"), "mso-help"));
    current.triggers.forEach((rule, index) => drawRule(rules, rule, index));
    const add = button(rules, L("Animations.AddTrigger"), () => {
      const next = copy(current); next.triggers.push({ id: uniqueId(), name: t("Animations.NewTrigger", { number: next.triggers.length + 1 }), enabled: true, event: "manual", field: "", condition: null, action: { type: "play-animation", target: "self", animation: validateAnimationConfig({ type: "pulse", duration: 400 }) }, continuous: false });
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
    const input = node("select"); writeAttr(input, "aria-label", label); input.disabled = disabled;
    for (const option of options) { const item = node("option", option.label); item.value = option.value; input.append(item); }
    input.value = value; input.addEventListener("change", () => callback(input.value)); wrapper.append(input); selection.append(wrapper); return input;
  };
  let selectedId = layers.some(layer => layer.id === layerId) ? layerId : layers[0]?.id ?? "";
  const layerSelect = select(L("Animations.TestWidget"), layers.map(layer => ({ value: layer.id, label: layer.name })), selectedId, value => { selectedId = value; onSelection({ layerId: value, target }); updateButtons(); refreshDiagnostics(); });
  layerSelect.disabled ||= !layers.length;
  select(L("Animations.TestOutput"), [{ value: "preview", label: L("Animations.EditorPreview") }, { value: "obs", label: L("Animations.OBSOutput") }], target, value => { target = value; onSelection({ layerId: selectedId, target }); refreshDiagnostics(); });
  host.append(selection);
  const hint = node("p", L("Animations.TestHelp"), "mso-help"); host.append(hint);
  const playbackNotice = node("p", "", "mso-help mso-animation-blocker");
  setAttr(playbackNotice, "aria-label", "Animations.PlaybackAvailability");
  playbackNotice.setAttribute("role", "note"); playbackNotice.setAttribute("aria-live", "polite");
  playbackNotice.hidden = true; host.append(playbackNotice);
  const playbackMessages = {
    "animations-disabled": L("Animations.AnimationsDisabled"),
    "reduced-motion": L("Animations.ReducedMotion"),
    hidden: L("Animations.Hidden"),
    "layer-hidden": L("Animations.LayerHidden"),
    detached: L("Animations.Detached")
  };
  function refreshPlaybackNotice() {
    playbackNotice.hidden = true; writeText(playbackNotice, ""); playbackNotice.dataset.blockedReason = "";
    // The preview's preferences and target cannot establish the remote OBS state.
    if (target !== "preview" || !selectedId || disabled) return;
    try {
      const reason = getPlaybackState(selectedId)?.blockedReason;
      if (!reason) return;
      playbackNotice.dataset.blockedReason = reason;
      writeText(playbackNotice, playbackMessages[reason] ?? L("Animations.PlaybackBlocked"));
    } catch { setText(playbackNotice, "Animations.PlaybackStatusUnavailable"); }
    playbackNotice.hidden = false;
  }
  const actions = node("div", undefined, "mso-animation-test-actions"); host.append(actions);
  const status = node("p", layers.length ? L("Animations.ChooseTest") : L("Animations.AddTestWidget"), "mso-help"); status.setAttribute("role", "status");
  const buttons = [];
  const run = async (label, command) => {
    if (disabled || !selectedId) return;
    buttons.forEach(button => { button.disabled = true; });
    try {
      if (target === "preview" && ["entrance", "exit", "play"].includes(command.kind)) {
        const state = getPlaybackState(selectedId);
        if (state?.blockedReason && !(state.blockedReason === "hidden" && command.kind === "entrance")) throw new Error(labelText(playbackMessages[state.blockedReason] ?? L("Animations.PlaybackBlocked")));
        if (["entrance", "exit"].includes(command.kind) && state?.[command.kind] === false) throw new Error(t(command.kind === "entrance" ? "Animations.ConfigureEntrance" : "Animations.ConfigureExit"));
      }
      await onCommand(selectedId, copy(command), target);
      writeText(status, "");
      status.replaceChildren(node("span", label), node("span", L(target === "obs" ? "Animations.SentToOBSSuffix" : "Animations.RequestedSuffix")));
    }
    catch (error) { writeText(status, errorText(error) || t("Animations.TestFailed")); }
    finally { updateButtons(); refreshDiagnostics(); }
  };
  for (const [label, command] of [
    [L("Animations.PlayEntrance"), { kind: "entrance" }], [L("Animations.PlayExit"), { kind: "exit" }],
    [L("Animations.PlayPulse"), { kind: "play", animation: { type: "pulse", duration: 1200, intensity: 1 } }],
    [L("Animations.NextPage"), { kind: "carousel", action: "next-page" }], [L("Animations.PreviousPage"), { kind: "carousel", action: "previous-page" }],
    [L("Animations.NextCharacter"), { kind: "carousel", action: "next-actor" }], [L("Animations.PreviousCharacter"), { kind: "carousel", action: "previous-actor" }],
    [L("Animations.PauseCarousel"), { kind: "carousel", action: "pause" }], [L("Animations.ResumeCarousel"), { kind: "carousel", action: "resume" }],
    [L("Animations.RestartCarousel"), { kind: "carousel", action: "reset" }],
    [L("Animations.SimulateDamage"), { kind: "demo", action: "damage" }], [L("Animations.SimulateHealing"), { kind: "demo", action: "healing" }]
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
  const checkbox = node("input"); checkbox.type = "checkbox"; checkbox.checked = debug; checkbox.disabled = disabled; setAttr(checkbox, "aria-label", "Animations.DebugMode");
  debugLabel.append(checkbox, node("span", L("Animations.DebugMode"))); host.append(debugLabel);
  const diagnostics = node("pre", undefined, "mso-animation-diagnostics"); setAttr(diagnostics, "aria-label", "Animations.Diagnostics"); diagnostics.hidden = !debug; host.append(diagnostics);
  function refreshDiagnostics() {
    refreshPlaybackNotice();
    if (!checkbox.checked) return;
    try {
      writeText(diagnostics, "");
      diagnostics.replaceChildren();
      if (target === "obs") diagnostics.append(node("span", L("Animations.OBSDiagnosticsHelp")));
      diagnostics.append(node("span", JSON.stringify(getDiagnostics(), null, 2)));
    }
    catch (error) { writeText(diagnostics, errorText(error) || t("Animations.DiagnosticsUnavailable")); }
  }
  checkbox.addEventListener("change", async () => {
    try { await onDebug(checkbox.checked); diagnostics.hidden = !checkbox.checked; refreshDiagnostics(); }
    catch (error) { checkbox.checked = !checkbox.checked; writeText(status, errorText(error)); }
  });
  const refresh = node("button", L("Animations.RefreshDiagnostics")); refresh.type = "button"; refresh.addEventListener("click", refreshDiagnostics); host.append(refresh);
  refreshDiagnostics();
  return { refreshDiagnostics };
}
