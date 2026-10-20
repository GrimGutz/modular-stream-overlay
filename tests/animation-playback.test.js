import test from "node:test";
import assert from "node:assert/strict";
import { AnimationController, AnimationRegistry, defaultAnimationRegistry, applyTransition } from "../scripts/animation/playback.js";
import { ANIMATION_DEFINITIONS } from "../scripts/animation/schema.js";

function fixture(options = {}) {
  const animations = [], frames = new Map();
  let time = 0, sequence = 0;
  const element = { style: { transform: "rotate(32deg)", opacity: "0.6", filter: "contrast(1.2)" }, animate(keyframes, settings) {
    let finish, reject;
    const animation = { keyframes, settings, cancelled: 0, finished: new Promise((resolve, fail) => { finish = resolve; reject = fail; }),
      finish() { finish(); }, cancel() { this.cancelled++; reject(Error("cancelled")); } };
    animations.push(animation);
    return animation;
  } };
  const controller = new AnimationController(element, { now: () => time, reducedMotion: false,
    requestFrame: callback => { const id = ++sequence; frames.set(id, callback); return id; },
    cancelFrame: id => frames.delete(id), ...options });
  return { controller, animations, frames, element, advance(ms) {
    time += ms;
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(time);
  } };
}

test("every configured built-in effect has bounded browser keyframes and preserves geometry styles", async () => {
  const f = fixture();
  const baseline = { ...f.element.style };
  assert.equal(defaultAnimationRegistry.list().length, ANIMATION_DEFINITIONS.length);
  for (const { type } of ANIMATION_DEFINITIONS) {
    const playing = f.controller.play({ type, duration: 400 });
    const animation = f.animations.at(-1);
    assert.ok(animation.keyframes.length >= 2, type);
    assert.equal(animation.settings.iterations, 1);
    assert.equal(animation.settings.fill, "both");
    for (const frame of animation.keyframes) {
      if (frame.transform) assert.match(frame.transform, /^rotate\(32deg\)/);
      if (frame.opacity !== undefined) assert.ok(frame.opacity >= 0 && frame.opacity <= 0.6);
      if (frame.filter) assert.match(frame.filter, /^contrast\(1\.2\)/);
    }
    animation.finish();
    assert.equal((await playing).status, "finished");
    assert.equal(animation.cancelled, 1, "Finished effects release their browser timeline");
  }
  assert.deepEqual(f.element.style, baseline, "Effects never commit temporary transform, alpha, or color");
  assert.equal(f.controller.channels.size, 0);
});

test("new effects replace one channel without accumulating queues or cancelling other channels", async () => {
  const f = fixture();
  const first = f.controller.play({ type: "shake" });
  const entrance = f.controller.play({ type: "fade-in" }, { channel: "visibility" });
  const second = f.controller.play({ type: "glow" }, { persistent: true });
  assert.equal((await first).status, "cancelled");
  assert.equal(f.animations[0].cancelled, 1);
  assert.equal(f.animations[1].cancelled, 0);
  assert.equal(f.animations[2].settings.iterations, Infinity, "Only an explicitly owned persistent effect loops");
  assert.equal(f.controller.channels.size, 2);
  f.controller.stop();
  assert.equal((await second).status, "cancelled");
  f.animations[1].finish();
  assert.equal((await entrance).status, "finished");
  assert.equal(f.controller.channels.size, 0);
});

test("invalid, unknown and unsupported effects resolve safely without touching final design", async () => {
  const f = fixture();
  assert.equal((await f.controller.play({ type: "pulse", duration: -1 })).status, "invalid");
  assert.equal((await f.controller.play({ type: "pulse", repeat: 99 })).status, "invalid");
  assert.equal((await f.controller.play({ type: "future:effect" })).status, "unknown");
  delete f.element.animate;
  assert.equal((await f.controller.play({ type: "fade-out" })).status, "unsupported");
  assert.equal(f.animations.length, 0);
  assert.equal(f.element.style.opacity, "0.6");
});

test("trusted extensions register keyframes without executable saved configuration", async () => {
  const registry = new AnimationRegistry();
  registry.register({ id: "extension:tilt", label: "Tilt", keyframes: ({ intensity }) => [{ transform: `rotate(${intensity}deg)` }, { transform: "none" }] });
  assert.throws(() => registry.register({ id: "extension:tilt", keyframes() {} }), /already exists/);
  assert.throws(() => registry.register({ id: "invalid id", keyframes() {} }), /ID/);
  const f = fixture({ registry });
  const playing = f.controller.play({ type: "extension:tilt", intensity: 2 });
  assert.equal(f.animations[0].keyframes[0].transform, "rotate(32deg) rotate(2deg)");
  f.animations[0].finish(); await playing;
});

test("Pulse enlarges to 1.12 while Flash and Glow retain distinct visual properties", async () => {
  const f = fixture();
  const pulse = f.controller.play({ type: "pulse", duration: 1200 });
  assert.deepEqual(f.animations[0].keyframes, [
    { transform: "rotate(32deg) scale(1)" }, { transform: "rotate(32deg) scale(1.12)" }, { transform: "rotate(32deg) scale(1)" }
  ]);
  assert.equal(f.animations[0].settings.duration, 1200);
  f.animations[0].finish(); await pulse;
  for (const [type, property] of [["flash", "opacity"], ["glow", "filter"]]) {
    const playing = f.controller.play({ type });
    assert.ok(property in f.animations.at(-1).keyframes[1]);
    assert.equal("transform" in f.animations.at(-1).keyframes[1], false);
    f.animations.at(-1).finish(); await playing;
  }
  assert.equal(f.element.style.transform, "rotate(32deg)");
});

test("opt-in diagnostics distinguish blocked requests, actual playback and cancellation causes", async t => {
  const original = globalThis.getComputedStyle;
  t.after(() => { if (original === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = original; });
  let reduced = true, debug = false;
  const events = [];
  globalThis.getComputedStyle = () => ({ opacity: "0.42", transform: "matrix(1.12, 0, 0, 1.12, 0, 0)", visibility: "visible", display: "block" });
  const f = fixture({ debug: () => debug, onDiagnostic: event => events.push(event), reducedMotion: () => reduced });
  f.element.isConnected = true; f.element.dataset = { instanceId: "card" }; f.element.tagName = "DIV";
  await f.controller.play({ type: "pulse" }); assert.equal(events.length, 0, "Debug remains silent by default");
  debug = true;
  await f.controller.play({ type: "pulse", duration: 1200 });
  assert.equal(events.at(-1).phase, "skipped"); assert.equal(events.at(-1).reason, "reduced-motion");
  reduced = false;
  const playing = f.controller.play({ type: "pulse", duration: 1200 });
  assert.deepEqual(events.slice(-2).map(event => event.phase), ["requested", "started"]);
  assert.equal(events.at(-1).connected, true); assert.equal(events.at(-1).target.instanceId, "card");
  assert.equal(events.at(-1).opacity, "0.42"); assert.match(events.at(-1).transform, /1\.12/);
  f.controller.destroy("render-interrupted"); await playing;
  assert.equal(events.at(-1).phase, "cancelled"); assert.equal(events.at(-1).reason, "render-interrupted");
});

test("numeric interpolation handles rapid consecutive changes from the displayed value", async () => {
  const f = fixture();
  const values = [];
  const first = f.controller.transitionNumber("hp", 80, 40, { duration: 100, easing: "linear" }, value => values.push(value));
  f.advance(50);
  assert.equal(values.at(-1), 60);
  const latest = f.controller.transitionNumber("hp", 40, 10, { duration: 100, easing: "linear" }, value => values.push(value));
  assert.equal((await first).status, "cancelled");
  assert.equal(values.at(-1), 60, "The replacement starts from the visible midpoint");
  assert.equal(f.frames.size, 1);
  f.advance(50); assert.equal(values.at(-1), 35);
  f.advance(50); assert.equal(values.at(-1), 10);
  assert.deepEqual(await latest, { status: "finished", value: 10 });
  assert.equal(f.frames.size, 0); assert.equal(f.controller.numbers.size, 0);
});

test("numeric easing and degenerate values resolve to their correct latest visual state", async () => {
  const f = fixture();
  const values = [];
  const playing = f.controller.transitionNumber("number", 0, 100, { duration: 100, easing: "ease-in" }, value => values.push(value));
  f.advance(50); assert.equal(values.at(-1), 25);
  f.advance(50); await playing;
  await f.controller.transitionNumber("number", 100, 0, { duration: 0 }, value => values.push(value));
  assert.equal(values.at(-1), 0);
  await f.controller.transitionNumber("number", undefined, 5, { duration: 100 }, value => values.push(value));
  assert.equal(values.at(-1), 5);
  await f.controller.transitionNumber("number", 5, null, { duration: 100 }, value => values.push(value));
  assert.equal(values.at(-1), null, "Unavailable data is delivered without attempting numeric frames");
  assert.equal(f.frames.size, 0);
});

test("interpolation between finite extreme values never overflows the displayed number", async () => {
  const f = fixture();
  const values = [];
  const playing = f.controller.transitionNumber("extreme", -1e308, 1e308, { duration: 100, easing: "linear" }, value => values.push(value));
  f.advance(25); f.advance(25); f.advance(25); f.advance(25); await playing;
  assert.ok(values.every(Number.isFinite));
  assert.equal(values.at(-1), 1e308); assert.equal(values[2], 0);
});

test("global disable and reduced motion cancel effects and immediately settle latest values", async () => {
  const f = fixture();
  let value;
  const effect = f.controller.play({ type: "pulse" }, { persistent: true });
  const number = f.controller.transitionNumber("hp", 100, 25, { duration: 500 }, current => { value = current; });
  f.advance(100);
  f.controller.setEnabled(false);
  assert.equal(value, 25);
  assert.equal((await effect).status, "cancelled");
  assert.equal((await number).value, 25);
  assert.equal(f.frames.size, 0); assert.equal(f.controller.channels.size, 0);
  assert.equal((await f.controller.play({ type: "flash" })).status, "disabled");
  const reduced = fixture({ reducedMotion: true });
  assert.equal((await reduced.controller.play({ type: "flash" })).status, "disabled");
  await reduced.controller.transitionNumber("hp", 1, 0, { duration: 500 }, current => { value = current; });
  assert.equal(value, 0); assert.equal(reduced.animations.length, 0); assert.equal(reduced.frames.size, 0);
});

test("CSS transitions are restricted to display properties and respect disable and reduced motion", () => {
  const element = { style: {} };
  applyTransition(element, { duration: 500, easing: "linear" }, ["width", "color", "opacity", "transform", "left"]);
  assert.equal(element.style.transitionProperty, "width, color, opacity");
  assert.equal(element.style.transitionDuration, "500ms");
  assert.equal(element.style.transitionTimingFunction, "linear");
  applyTransition(element, { duration: 500 }, ["width"], { reducedMotion: true });
  assert.equal(element.style.transitionProperty, "none");
  const f = fixture(); f.controller.setEnabled(false);
  f.controller.transitionStyles(element, { duration: 1000 }, ["width"]);
  assert.equal(element.style.transitionDuration, "0ms");
});

test("repeated resets and destruction release frames and animation references", async () => {
  const f = fixture();
  const pending = [];
  let value;
  for (let i = 0; i < 40; i++) {
    pending.push(f.controller.play({ type: "pulse" }, { persistent: true }));
    pending.push(f.controller.transitionNumber("hp", 100, i, { duration: 500 }, current => { value = current; }));
    f.controller.reset();
    assert.equal(value, i);
  }
  f.controller.destroy(); f.controller.destroy(); await Promise.all(pending);
  assert.equal(f.frames.size, 0); assert.equal(f.controller.numbers.size, 0); assert.equal(f.controller.channels.size, 0);
  assert.ok(f.animations.every(animation => animation.cancelled === 1));
  assert.equal((await f.controller.play({ type: "fade-in" })).status, "disabled");
});
