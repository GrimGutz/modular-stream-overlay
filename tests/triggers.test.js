import test from "node:test";
import assert from "node:assert/strict";
import { TriggerRuntime, evaluateCondition, registerTriggerEvent } from "../scripts/animation/triggers.js";

const HP = "character.hp.current", PERCENT = "character.hp.percent";
const values = (hp, percent = hp) => ({ [HP]: hp, [PERCENT]: percent });
const rule = (id, event, extra = {}) => ({ id, event, field: HP, action: { type: "play-animation", animation: { type: "pulse" } }, ...extra });
function fixture(rules, options = {}) {
  const actions = [], stopped = [], errors = [];
  const runtime = new TriggerRuntime({ rules, onAction: (entry, event) => actions.push({ id: entry.id, event }),
    onStop: entry => stopped.push(entry.id), onError: error => errors.push(error), ...options });
  return { runtime, actions, stopped, errors };
}

test("initial values do not replay historical one-shots; changed, increased and decreased use actual prior values", () => {
  const f = fixture([rule("changed", "field-changed"), rule("up", "increased"), rule("down", "decreased")]);
  f.runtime.update(values(80)); assert.equal(f.actions.length, 0);
  f.runtime.update(values(45)); assert.deepEqual(f.actions.map(action => action.id), ["changed", "down"]);
  assert.equal(f.actions[1].event.previous, 80); assert.equal(f.actions[1].event.current, 45);
  f.runtime.update(values(45)); assert.equal(f.actions.length, 2);
  f.runtime.update(values(60)); assert.deepEqual(f.actions.slice(2).map(action => action.id), ["changed", "up"]);
  f.runtime.update(values(10), { initial: true }); assert.equal(f.actions.length, 4);
});

test("threshold crossings fire once per actual crossing, including exact boundary transitions", () => {
  const f = fixture([
    rule("below", "crossed-below", { condition: { operator: "crossed-below", value: 25 } }),
    rule("above", "crossed-above", { condition: { operator: "crossed-above", value: 25 } })
  ]);
  for (const hp of [30, 25, 24, 20, 22, 25, 26, 30, 24]) f.runtime.update(values(hp));
  assert.deepEqual(f.actions.map(action => action.id), ["below", "above", "below"]);
});

test("all comparisons are strict, safely handle absent values and never execute expressions", () => {
  const previous = values(20), current = values(30);
  for (const [operator, threshold, expected] of [
    ["eq", 30, true], ["eq", "30", false], ["ne", 30, false], ["ne", "30", true], ["gt", 25, true],
    ["gte", 30, true], ["lt", 30, false], ["lte", 30, true], ["increased", null, true], ["decreased", null, false],
    ["crossed-above", 25, true], ["crossed-below", 25, false]
  ]) assert.equal(evaluateCondition({ operator, value: threshold }, previous, current, { field: HP }), expected, operator);
  for (const unavailable of [null, undefined, NaN, Infinity, {}, []]) {
    assert.equal(evaluateCondition({ operator: "ne", value: 20 }, previous, values(unavailable), { field: HP }), false);
    assert.equal(evaluateCondition({ operator: "gt", value: 0 }, previous, values(unavailable), { field: HP }), false);
  }
  assert.equal(evaluateCondition({ operator: "eval", value: "globalThis.hacked=true" }, previous, current, { field: HP }), false);
  assert.equal(globalThis.hacked, undefined);
});

test("conditions may reference a different normalized field and text changes are supported", () => {
  const f = fixture([
    rule("low-damage", "decreased", { condition: { field: PERCENT, operator: "lt", value: 25 } }),
    rule("name", "field-changed", { field: "character.name", condition: { operator: "eq", value: "New" } })
  ]);
  f.runtime.update({ ...values(80, 80), "character.name": "Old" });
  f.runtime.update({ ...values(70, 70), "character.name": "New" });
  assert.deepEqual(f.actions.map(action => action.id), ["name"]);
  f.runtime.update({ ...values(20, 20), "character.name": "New" });
  assert.equal(f.actions.at(-1).id, "low-damage");
});

test("continuous low-value effects reconstruct on reconnect and stop at the configured threshold", () => {
  const f = fixture([rule("warning", "field-changed", {
    field: PERCENT, condition: { operator: "lt", value: 25 }, continuous: true
  })]);
  f.runtime.update(values(10), { initial: true });
  assert.equal(f.actions.length, 1); assert.equal(f.actions[0].event.persistent, true);
  f.runtime.update(values(15)); f.runtime.update(values(20)); assert.equal(f.actions.length, 1);
  f.runtime.update(values(25)); assert.deepEqual(f.stopped, ["warning"]);
  f.runtime.update(values(10)); assert.equal(f.actions.length, 2);
  f.runtime.update(values(null)); assert.deepEqual(f.stopped, ["warning", "warning"]);
});

test("continuous threshold crossing conditions become current-level tests during reconnect", () => {
  const f = fixture([rule("warning", "crossed-below", { condition: { operator: "crossed-below", value: 25 }, continuous: true })]);
  f.runtime.update(values(20)); assert.equal(f.actions.length, 1);
  f.runtime.update(values(10)); assert.equal(f.actions.length, 1);
  f.runtime.update(values(25)); assert.deepEqual(f.stopped, ["warning"]);
});

test("missing or malformed character values cannot create damage flashes on permission restoration", () => {
  const f = fixture([rule("damage", "decreased"), rule("changed", "field-changed")]);
  const inherited = Object.create({ [HP]: 1 });
  f.runtime.update(values(80));
  for (const invalid of [values(null), values(NaN), {}, inherited, values({ value: 30 })]) f.runtime.update(invalid);
  f.runtime.update(values(10)); assert.equal(f.actions.length, 0);
  f.runtime.update(values(5)); assert.deepEqual(f.actions.map(action => action.id), ["damage", "changed"]);
});

test("widget instances maintain independent histories without mutating supplied Actor values", () => {
  const configuration = [rule("damage", "decreased")];
  const a = fixture(configuration), b = fixture(configuration);
  const initial = Object.freeze(values(80));
  a.runtime.update(initial); b.runtime.update(initial);
  const damaged = Object.freeze(values(45)); a.runtime.update(damaged);
  assert.equal(a.actions.length, 1); assert.equal(b.actions.length, 0);
  assert.deepEqual(initial, values(80)); assert.deepEqual(damaged, values(45));
  b.runtime.update(values(85)); assert.equal(b.actions.length, 0);
});

test("visibility and manual events remain distinct and hidden widgets stop continuous effects", () => {
  const f = fixture([
    rule("shown", "visible", { field: "" }), rule("hidden", "hidden", { field: "" }),
    rule("button", "manual", { field: "" }),
    rule("warning", "field-changed", { condition: { operator: "lt", value: 25 }, continuous: true })
  ]);
  f.runtime.visibility(true, { initial: true }); f.runtime.update(values(10));
  f.runtime.visibility(false); f.runtime.visibility(false);
  assert.deepEqual(f.actions.map(action => action.id), ["warning", "hidden"]);
  assert.deepEqual(f.stopped, ["warning"]);
  f.runtime.manual("button"); assert.equal(f.actions.at(-1).id, "button");
  f.runtime.visibility(true); assert.deepEqual(f.actions.slice(-2).map(action => action.id), ["warning", "shown"]);
});

test("semantic event IDs are deduplicated with a bounded history", () => {
  const f = fixture([rule("damage", "decreased")], { maxEventIds: 2 });
  f.runtime.update(values(80), { eventId: "first" });
  f.runtime.update(values(60), { eventId: "second" });
  f.runtime.update(values(40), { eventId: "second" });
  assert.equal(f.actions.length, 1); assert.equal(f.runtime.values[HP], 60);
  f.runtime.update(values(40), { eventId: "third" });
  f.runtime.update(values(20), { eventId: "first" });
  assert.equal(f.actions.length, 3); assert.equal(f.runtime.eventIds.size, 2);
});

test("unknown events are inert until an extension registers a predicate", () => {
  const f = fixture([rule("extension", "test:custom-change")]);
  f.runtime.update(values(80)); f.runtime.update(values(70)); assert.equal(f.actions.length, 0);
  registerTriggerEvent("test:custom-change", (entry, { current }) => current[entry.field] === 42);
  f.runtime.update(values(42)); assert.equal(f.actions.length, 1);
  assert.throws(() => registerTriggerEvent("test:custom-change", () => true), /already exists/);
  assert.throws(() => registerTriggerEvent("bad expression()", () => true), /safe ID/);
  f.runtime.dispatch("test:custom-change", { eventId: "explicit-command" });
  assert.equal(f.actions.length, 2);
});

test("cyclic visibility rules have a shared action budget instead of an unbounded recursion", () => {
  let runtime, actions = 0;
  runtime = new TriggerRuntime({ rules: [
    rule("hide-on-visible", "visible", { field: "", action: { type: "hide" } }),
    rule("show-on-hidden", "hidden", { field: "", action: { type: "show" } })
  ], onAction: entry => { actions++; runtime.visibility(entry.action.type === "show"); } });
  runtime.visibility(true, { initial: true });
  runtime.visibility(false);
  assert.equal(actions, 32);
  assert.equal(runtime.dispatchDepth, 0);
});

test("disabled rules, replacement rules and destruction clean up continuous state", () => {
  const warning = rule("warning", "field-changed", { condition: { operator: "lt", value: 25 }, continuous: true });
  const f = fixture([warning, rule("disabled", "manual", { enabled: false })]);
  f.runtime.update(values(10)); f.runtime.manual(); assert.equal(f.actions.length, 1);
  f.runtime.setRules([{ ...warning, enabled: false }]); assert.deepEqual(f.stopped, ["warning"]);
  f.runtime.update(values(5)); assert.equal(f.actions.length, 1);
  f.runtime.setRules([warning]); f.runtime.update(values(5), { initial: true }); assert.equal(f.actions.length, 2);
  f.runtime.destroy(); f.runtime.destroy();
  assert.deepEqual(f.stopped, ["warning", "warning"]);
  assert.equal(f.runtime.active.size, 0); assert.equal(f.runtime.eventIds.size, 0); assert.equal(f.runtime.rules.length, 0);
  f.runtime.update(values(2)); f.runtime.manual(); assert.equal(f.actions.length, 2);
});

test("a failing extension callback is isolated from other rules", () => {
  const errors = [], performed = [];
  const runtime = new TriggerRuntime({ rules: [rule("bad", "manual"), rule("good", "manual")],
    onAction: entry => { if (entry.id === "bad") throw Error("broken extension"); performed.push(entry.id); },
    onError: error => errors.push(error.message) });
  runtime.manual(); assert.deepEqual(performed, ["good"]); assert.deepEqual(errors, ["broken extension"]);
});
