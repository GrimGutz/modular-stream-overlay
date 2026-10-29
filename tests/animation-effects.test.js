import test from "node:test";
import assert from "node:assert/strict";
import { AnimationController, defaultAnimationRegistry, applyTransition } from "../scripts/animation/playback.js";
import { ANIMATION_DEFINITIONS, EASINGS, cssEasing, validateAnimationConfig, validateAnimationSettings } from "../scripts/animation/schema.js";
import { PAGE_TRANSITIONS, TRANSITION_IDS, transitionEffects, validateCycling } from "../scripts/carousel/schema.js";
import { CarouselController } from "../scripts/carousel/runtime.js";
import { UnifiedCarouselController } from "../scripts/carousel/sequence.js";

const frames = (type, config = {}) => defaultAnimationRegistry.get(type).keyframes({ intensity: 1, color: "#ff0000", ...config });
const functions = transform => [...String(transform).matchAll(/([a-zA-Z]+)\(/g)].map(match => match[1]);

function element(style = {}) {
  const animations = [];
  return { animations, style: { ...style }, animate(keyframes, settings) {
    let finish;
    const animation = { keyframes, settings, finished: new Promise(resolve => { finish = resolve; }), finish: () => finish(), cancel() {} };
    animations.push(animation);
    return animation;
  } };
}

test("every effect's keyframe offsets stay ordered within the timeline", () => {
  for (const { type } of ANIMATION_DEFINITIONS) {
    const offsets = frames(type).map(frame => frame.offset).filter(offset => offset !== undefined);
    assert.ok(offsets.every(offset => offset >= 0 && offset <= 1), type);
    assert.deepEqual(offsets, [...offsets].sort((left, right) => left - right), type);
  }
});

test("entrances end at the layer's resting look and their exits leave from it", () => {
  for (const { type, category } of ANIMATION_DEFINITIONS.filter(entry => entry.category !== "emphasis")) {
    const list = frames(type), rest = category === "entrance" ? list.at(-1) : list[0];
    const hidden = category === "entrance" ? list[0] : list.at(-1);
    if (rest.opacity !== undefined) assert.equal(rest.opacity, 1, type);
    if (rest.clipPath !== undefined) assert.match(rest.clipPath, /^inset\(0 0 0 0\)$|^circle\(75%/, type);
    assert.ok(hidden.opacity === 0 || hidden.clipPath !== undefined, `${type} starts or ends unseen`);
  }
  assert.deepEqual(frames("blur-out"), [...frames("blur-in")].reverse());
  assert.deepEqual(frames("glitch-out").map(frame => Math.round(frame.offset * 10) / 10), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(frames("glitch-out").map(frame => frame.opacity), [...frames("glitch-in").map(frame => frame.opacity)].reverse());
});

test("turning effects list the same transform functions at both ends", () => {
  for (const type of ["rotate-in", "rotate-out", "flip-in-x", "flip-in-y", "flip-out-x", "flip-out-y", "spin", "fall-out", "tada", "wobble", "jello", "rubber-band"]) {
    const list = frames(type);
    assert.deepEqual(functions(list[0].transform), functions(list.at(-1).transform), type);
  }
  assert.equal(frames("spin").at(-1).transform, "rotate(360deg)");
  assert.equal(frames("flip-in-y")[0].transform, "perspective(800px) rotateY(90deg)");
  assert.equal(frames("flip-in-y", { intensity: 0.5 })[0].transform, "perspective(800px) rotateY(45deg)", "Intensity tilts less");
});

test("wipes uncover from the named edge and leave toward it", () => {
  assert.deepEqual(frames("wipe-in-left").map(frame => frame.clipPath), ["inset(0 100% 0 0)", "inset(0 0 0 0)"]);
  assert.deepEqual(frames("wipe-in-bottom").map(frame => frame.clipPath), ["inset(100% 0 0 0)", "inset(0 0 0 0)"]);
  assert.deepEqual(frames("wipe-out-left").map(frame => frame.clipPath), ["inset(0 0 0 0)", "inset(0 100% 0 0)"]);
  assert.deepEqual(frames("wipe-out-top").map(frame => frame.clipPath), ["inset(0 0 0 0)", "inset(0 0 100% 0)"]);
  assert.deepEqual(frames("circle-out").map(frame => frame.clipPath), ["circle(75% at 50% 50%)", "circle(0% at 50% 50%)"]);
  for (const { type } of ANIMATION_DEFINITIONS) for (const frame of frames(type)) {
    if (frame.clipPath?.startsWith("inset(")) assert.equal(frame.clipPath.slice(6, -1).split(" ").length, 4, type);
  }
});

test("a shaped layer keeps its shape: reveals fade on it instead of replacing its clip-path", async () => {
  const shaped = element({ clipPath: "circle(closest-side at 50% 50%)", opacity: "0.5" });
  const controller = new AnimationController(shaped, { reducedMotion: false });
  void controller.play({ type: "wipe-in-left" }, { channel: "visibility" });
  assert.deepEqual(shaped.animations[0].keyframes, [{ opacity: 0 }, { opacity: 0.5 }]);
  void controller.play({ type: "circle-out" }, { channel: "visibility" });
  assert.deepEqual(shaped.animations[1].keyframes, [{ opacity: 0.5 }, { opacity: 0 }]);
  const plain = element();
  void new AnimationController(plain, { reducedMotion: false }).play({ type: "wipe-in-left" });
  assert.equal(plain.animations[0].keyframes[0].clipPath, "inset(0 100% 0 0)");
  assert.deepEqual(shaped.style, { clipPath: "circle(closest-side at 50% 50%)", opacity: "0.5" }, "The saved shape is untouched");
});

test("named easings reach the browser as CSS timing functions and stay valid in saved settings", () => {
  assert.equal(cssEasing("back-out"), "cubic-bezier(0.34, 1.56, 0.64, 1)");
  assert.equal(cssEasing("steps"), "steps(6, end)");
  assert.equal(cssEasing("ease-in"), "ease-in");
  assert.equal(cssEasing("unknown"), "ease-out");
  for (const easing of EASINGS) {
    assert.equal(validateAnimationConfig({ type: "pulse", easing }).easing, easing);
    assert.equal(validateAnimationSettings({ transition: { duration: 300, easing } }).transition.easing, easing);
  }
  const target = element();
  void new AnimationController(target, { reducedMotion: false }).play({ type: "pop-in", easing: "back-in-out" });
  assert.equal(target.animations[0].settings.easing, "cubic-bezier(0.68, -0.6, 0.32, 1.6)");
  const bar = { style: {} };
  applyTransition(bar, { duration: 400, easing: "expo-out" }, ["width"]);
  assert.equal(bar.style.transitionTimingFunction, "cubic-bezier(0.16, 1, 0.3, 1)");
});

test("counted numbers follow the new easings and always finish on the target", async () => {
  const run = async easing => {
    let time = 0;
    const callbacks = [];
    const controller = new AnimationController(element(), { reducedMotion: false, now: () => time,
      requestFrame: callback => callbacks.push(callback), cancelFrame: () => {} });
    const values = [];
    const done = controller.transitionNumber("hp", 0, 100, { duration: 1000, easing }, value => values.push(value));
    for (const at of [100, 250, 500, 750, 900, 1000]) { time = at; callbacks.shift()?.(at); }
    assert.equal((await done).value, 100);
    return values;
  };
  const stepped = await run("steps");
  assert.ok(stepped.every(value => Math.abs(value * 6 / 100 - Math.round(value * 6 / 100)) < 1e-9), "Stepped values jump between six levels");
  assert.ok((await run("back-out")).some(value => value > 100), "Overshoot passes the target before settling");
  assert.ok((await run("back-in")).some(value => value < 0), "Anticipate pulls back first");
  assert.equal((await run("expo-out")).at(-1), 100);
});

test("every transition names registered effects of the right kind and survives the schedulers", () => {
  const categories = new Map(ANIMATION_DEFINITIONS.map(entry => [entry.type, entry.category]));
  for (const entry of PAGE_TRANSITIONS) {
    assert.equal(Object.isFrozen(entry), true);
    if (entry.id === "instant") { assert.equal(transitionEffects(entry.id), null); continue; }
    assert.equal(categories.get(entry.entrance), "entrance", entry.id);
    assert.equal(categories.get(entry.exit), "exit", entry.id);
    assert.ok(["together", "over", "sequence"].includes(entry.mode), entry.id);
    assert.equal(validateCycling({ transition: entry.id, characterTransition: entry.id }).transition, entry.id);
    assert.equal(new CarouselController({ settings: { transition: entry.id } }).settings.transition, entry.id);
    const unified = new UnifiedCarouselController({ settings: { transition: entry.id, characterTransition: entry.id } });
    assert.equal(unified.settings.transition, entry.id); assert.equal(unified.settings.characterTransition, entry.id);
  }
  assert.equal(transitionEffects("missing"), null);
  assert.deepEqual(TRANSITION_IDS, PAGE_TRANSITIONS.map(entry => entry.id));
  assert.equal(transitionEffects("wipe-up").mode, "over");
  assert.equal(transitionEffects("flip-horizontal").mode, "sequence");
});
