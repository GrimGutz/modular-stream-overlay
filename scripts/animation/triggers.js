import { validateTriggerRules } from "./schema.js";

const FIELD = /^character(?:\.[A-Za-z][A-Za-z0-9_]{0,47}){1,5}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
const DATA_EVENTS = new Set(["field-changed", "increased", "decreased", "crossed-above", "crossed-below"]);
const numeric = value => typeof value === "number" && Number.isFinite(value);
const available = value => typeof value === "string" || typeof value === "boolean" || numeric(value);
const ownValue = (values, field) => values && Object.hasOwn(values, field) ? values[field] : undefined;

function snapshot(values) {
  const result = Object.create(null);
  if (!values || typeof values !== "object" || Array.isArray(values)) return result;
  for (const [field, value] of Object.entries(values)) {
    if (!FIELD.test(field) || field.split(".").some(part => FORBIDDEN.has(part))) continue;
    result[field] = available(value) ? value : null;
  }
  return result;
}

/** Compares normalized scalar fields without expression evaluation or document traversal. */
export function evaluateCondition(condition, previous, current, { field = "", continuous = false } = {}) {
  if (!condition) return true;
  const key = condition.field || field;
  const before = ownValue(previous, key), after = ownValue(current, key), threshold = condition.value;
  if (!available(after)) return false;
  if (condition.operator === "eq") return available(threshold) && Object.is(after, threshold);
  if (condition.operator === "ne") return available(threshold) && !Object.is(after, threshold);
  if (!numeric(after)) return false;
  if (condition.operator === "increased") return numeric(before) && after > before;
  if (condition.operator === "decreased") return numeric(before) && after < before;
  if (!numeric(threshold)) return false;
  if (condition.operator === "gt") return after > threshold;
  if (condition.operator === "gte") return after >= threshold;
  if (condition.operator === "lt") return after < threshold;
  if (condition.operator === "lte") return after <= threshold;
  if (condition.operator === "crossed-above") return after > threshold && (continuous || numeric(before) && before <= threshold);
  if (condition.operator === "crossed-below") return after < threshold && (continuous || numeric(before) && before >= threshold);
  return false;
}

const eventPredicates = new Map();

/** A trusted extension can register an event predicate; saved settings contain only its ID. */
export function registerTriggerEvent(type, predicate) {
  if (!ID.test(type ?? "") || FORBIDDEN.has(type) || typeof predicate !== "function") throw new TypeError("A trigger event needs a safe ID and predicate.");
  if (eventPredicates.has(type) || ["visible", "hidden", "manual"].includes(type)) throw new Error(`Trigger event '${type}' already exists.`);
  eventPredicates.set(type, predicate);
  return type;
}

for (const type of DATA_EVENTS) registerTriggerEvent(type, (rule, { previous, current }) => {
  const before = ownValue(previous, rule.field), after = ownValue(current, rule.field);
  if (!available(before) || !available(after)) return false;
  if (type === "field-changed") return !Object.is(before, after);
  if (!numeric(before) || !numeric(after)) return false;
  if (type === "increased") return after > before;
  if (type === "decreased") return after < before;
  const threshold = rule.condition?.value;
  if (!numeric(threshold)) return false;
  if (type === "crossed-above") return before <= threshold && after > threshold;
  if (type === "crossed-below") return before >= threshold && after < threshold;
  return false;
});

/**
 * One runtime per bound widget or component. Initial snapshots reconstruct continuous
 * state while suppressing historical one-shots. It neither writes settings nor Actors.
 */
export class TriggerRuntime {
  constructor({ rules = [], onAction = () => {}, onStop = () => {}, onError = error => console.error("Modular Stream Overlay | Trigger", error),
    maxEventIds = 256 } = {}) {
    this.onAction = onAction;
    this.onStop = onStop;
    this.onError = onError;
    this.maxEventIds = Math.max(1, Math.min(1024, Number(maxEventIds) || 256));
    this.rules = [];
    this.active = new Set();
    this.eventIds = new Set();
    this.values = snapshot({});
    this.previousValues = snapshot({});
    this.hasSnapshot = false;
    this.visible = null;
    this.destroyed = false;
    this.dispatchDepth = 0;
    this.remainingActions = 32;
    this.setRules(rules);
  }

  _call(callback, ...args) {
    if (callback === this.onAction && this.remainingActions-- <= 0) return;
    try { Promise.resolve(callback(...args)).catch(this.onError); } catch (error) { this.onError(error); }
  }

  _run(operation) {
    if (this.dispatchDepth++ === 0) this.remainingActions = 32;
    try { return operation(); } finally { this.dispatchDepth--; }
  }

  _remember(eventId) {
    if (eventId === undefined || eventId === null || eventId === "") return true;
    if (typeof eventId !== "string" || eventId.length > 160 || this.eventIds.has(eventId)) return false;
    this.eventIds.add(eventId);
    if (this.eventIds.size > this.maxEventIds) this.eventIds.delete(this.eventIds.values().next().value);
    return true;
  }

  _event(rule, type, previous, current, detail = {}) {
    return { type, field: rule.field, previous: ownValue(previous, rule.field), current: ownValue(current, rule.field),
      previousValues: previous, values: current, persistent: rule.continuous, ...detail };
  }

  _stop(rule) {
    if (!this.active.delete(rule.id)) return;
    this._call(this.onStop, rule);
  }

  _continuous(previous, current, detail = {}) {
    const actions = [];
    for (const rule of this.rules) {
      if (!rule.continuous) continue;
      const matches = !this.destroyed && this.visible !== false && rule.enabled
        && evaluateCondition(rule.condition, previous, current, { field: rule.field, continuous: true });
      if (!matches) { this._stop(rule); continue; }
      if (this.active.has(rule.id)) continue;
      if (this.remainingActions <= 0) continue;
      this.active.add(rule.id);
      const event = this._event(rule, rule.event, previous, current, detail);
      actions.push({ rule, event });
      this._call(this.onAction, rule, event);
    }
    return actions;
  }

  setRules(rules) {
    const next = validateTriggerRules(rules);
    for (const rule of this.rules) this._stop(rule);
    this.rules = next;
  }

  update(values, options = {}) { return this._run(() => this._update(values, options)); }

  _update(values, { initial = false, eventId } = {}) {
    if (this.destroyed || !this._remember(eventId)) return [];
    const previous = this.values, current = snapshot(values);
    const first = initial || !this.hasSnapshot;
    this.previousValues = previous;
    this.values = current;
    this.hasSnapshot = true;
    const detail = { initial: first, eventId };
    const actions = this._continuous(previous, current, detail);
    if (first) return actions;
    for (const rule of this.rules) {
      if (!rule.enabled || rule.continuous) continue;
      const predicate = eventPredicates.get(rule.event);
      let matches = false;
      try { matches = Boolean(predicate?.(rule, { previous, current })); } catch (error) { this.onError(error); }
      if (!matches || !evaluateCondition(rule.condition, previous, current, { field: rule.field })) continue;
      if (this.remainingActions <= 0) break;
      const event = this._event(rule, rule.event, previous, current, detail);
      actions.push({ rule, event });
      this._call(this.onAction, rule, event);
    }
    return actions;
  }

  visibility(visible, options = {}) { return this._run(() => this._visibility(visible, options)); }

  _visibility(visible, { initial = false, eventId } = {}) {
    if (this.destroyed || typeof visible !== "boolean" || !this._remember(eventId)) return [];
    const before = this.visible;
    this.visible = visible;
    const actions = this._continuous(this.previousValues, this.values, { initial: true, eventId });
    if (initial || before === null || before === visible) return actions;
    return [...actions, ...this._dispatch(visible ? "visible" : "hidden", undefined, { eventId })];
  }

  _dispatch(type, ruleId, detail = {}) {
    const actions = [];
    for (const rule of this.rules) {
      if (!rule.enabled || rule.continuous || rule.event !== type || ruleId && rule.id !== ruleId
        || !evaluateCondition(rule.condition, this.previousValues, this.values, { field: rule.field })) continue;
      if (this.remainingActions <= 0) break;
      const event = this._event(rule, type, this.previousValues, this.values, { initial: false, ...detail });
      actions.push({ rule, event });
      this._call(this.onAction, rule, event);
    }
    return actions;
  }

  manual(ruleId, options = {}) { return this._run(() => this._manual(ruleId, options)); }

  _manual(ruleId, { eventId } = {}) {
    if (this.destroyed || !this._remember(eventId)) return [];
    return this._dispatch("manual", ruleId, { eventId });
  }

  /** Explicit semantic extension event, with no executable expression in its payload. */
  dispatch(type, options = {}) { return this._run(() => this._dispatchEvent(type, options)); }

  _dispatchEvent(type, { eventId, ...detail } = {}) {
    if (this.destroyed || !ID.test(type ?? "") || !this._remember(eventId)) return [];
    return this._dispatch(type, undefined, { ...detail, eventId });
  }

  reset() {
    for (const rule of this.rules) this._stop(rule);
    this.eventIds.clear();
    this.values = snapshot({});
    this.previousValues = snapshot({});
    this.hasSnapshot = false;
    this.visible = null;
  }

  destroy() { this.reset(); this.destroyed = true; this.rules = []; }
}
