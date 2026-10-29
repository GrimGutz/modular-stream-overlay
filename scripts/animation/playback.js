import { ANIMATION_DEFINITIONS, cssEasing, validateAnimationConfig } from "./schema.js";

const TYPE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const finite = value => typeof value === "number" && Number.isFinite(value);
const defaultNow = () => globalThis.performance?.now?.() ?? Date.now();

/** Registrations contain code supplied by trusted modules, never code read from settings. */
export class AnimationRegistry {
  constructor() { this.definitions = new Map(); }

  register(definition) {
    if (!definition || !TYPE_ID.test(definition.id ?? "") || typeof definition.keyframes !== "function") {
      throw new TypeError("An animation needs an ID and a keyframes callback.");
    }
    if (this.definitions.has(definition.id)) throw new Error(`Animation '${definition.id}' already exists.`);
    const entry = Object.freeze({ id: definition.id, label: String(definition.label ?? definition.id).slice(0, 80),
      category: definition.category ?? "emphasis", keyframes: definition.keyframes });
    this.definitions.set(entry.id, entry);
    return entry;
  }

  get(id) { return this.definitions.get(id); }
  list() { return [...this.definitions.values()]; }
}

export const defaultAnimationRegistry = new AnimationRegistry();

function effectFrames(type, { intensity = 1, color = "#ff4040" }) {
  const amount = Math.max(0, Math.min(3, intensity));
  const distance = 48 * amount;
  const start = { transform: "none", opacity: 1 };
  const end = { ...start };
  if (type === "fade-in") return [{ opacity: 0 }, { opacity: 1 }];
  if (type === "fade-out") return [{ opacity: 1 }, { opacity: 0 }];
  if (type.startsWith("slide-")) {
    const [mode, direction] = type.slice(6).split("-");
    const offset = direction === "left" ? `translateX(${-distance}px)` : direction === "right"
      ? `translateX(${distance}px)` : direction === "top" ? `translateY(${-distance}px)` : `translateY(${distance}px)`;
    return mode === "in" ? [{ transform: offset, opacity: 0 }, end] : [start, { transform: offset, opacity: 0 }];
  }
  if (type === "scale-in") return [{ transform: `scale(${Math.max(0.05, 1 - 0.6 * amount)})`, opacity: 0 }, end];
  if (type === "scale-out") return [start, { transform: `scale(${Math.max(0.05, 1 - 0.6 * amount)})`, opacity: 0 }];
  if (type === "pop-in") return [{ transform: "scale(0.7)", opacity: 0 },
    { transform: `scale(${1 + 0.08 * amount})`, opacity: 1, offset: 0.72 }, end];
  if (type === "pulse") return [{ transform: "scale(1)" }, { transform: `scale(${1 + 0.12 * amount})` }, { transform: "scale(1)" }];
  if (type === "flash") return [{ opacity: 1 }, { opacity: Math.max(0.45, 1 - 0.35 * amount) }, { opacity: 1 }];
  if (type === "shake") return [0, -1, 1, -0.7, 0.7, 0].map(value => ({ transform: `translateX(${value * 7 * amount}px)` }));
  if (type === "bounce") return [{ transform: "none" }, { transform: `translateY(${-14 * amount}px)` },
    { transform: "none" }, { transform: `translateY(${-5 * amount}px)` }, { transform: "none" }];
  if (type === "scale-pulse") return [{ transform: "scale(1)" }, { transform: `scale(${1 + 0.06 * amount})` }, { transform: "scale(1)" }];
  if (type === "glow" || type === "color-flash") {
    const glow = `drop-shadow(0 0 ${Math.max(1, 12 * amount)}px ${color})`;
    return [{ filter: "none" }, { filter: `${glow}${type === "color-flash" ? ` brightness(${1 + 0.25 * amount})` : ""}` }, { filter: "none" }];
  }
  return motionFrames(type, amount, distance) ?? revealFrames(type) ?? emphasisFrames(type, amount);
}

// An exit plays its entrance backwards, offsets included.
const reverse = frames => frames.map(({ offset, ...frame }) => offset === undefined ? frame : { ...frame, offset: 1 - offset }).reverse();

// Rotations list the same functions at both ends so the browser turns them instead of
// interpolating matrices.
function motionFrames(type, amount, distance) {
  const flip = axis => [{ transform: `perspective(800px) rotate${axis}(${Math.min(90, 90 * amount)}deg)`, opacity: 0 },
    { transform: `perspective(800px) rotate${axis}(0deg)`, opacity: 1 }];
  const entrances = {
    "shrink-in": () => [{ transform: `scale(${1 + 0.5 * amount})`, opacity: 0 }, { transform: "none", opacity: 1 }],
    "blur-in": () => [{ filter: `blur(${12 * amount}px)`, opacity: 0 }, { filter: "blur(0px)", opacity: 1 }],
    "flip-in-x": () => flip("X"),
    "flip-in-y": () => flip("Y"),
    "rotate-in": () => [{ transform: `rotate(${-180 * amount}deg) scale(0.5)`, opacity: 0 }, { transform: "rotate(0deg) scale(1)", opacity: 1 }],
    "drop-in": () => [{ transform: `translateY(${-1.5 * distance}px)`, opacity: 0 }, { transform: "translateY(0px)", opacity: 1, offset: 0.6 },
      { transform: `translateY(${-12 * amount}px)`, opacity: 1, offset: 0.8 }, { transform: "translateY(0px)", opacity: 1 }],
    "bounce-in": () => [{ transform: "scale(0.3)", opacity: 0 }, { transform: `scale(${1 + 0.1 * amount})`, opacity: 1, offset: 0.5 },
      { transform: `scale(${1 - 0.05 * amount})`, opacity: 1, offset: 0.75 }, { transform: "scale(1)", opacity: 1 }],
    "glitch-in": () => [[0, -8, 0], [0.2, 6, 1], [0.4, -4, 0.3], [0.6, 3, 1], [0.8, -2, 0.7], [1, 0, 1]].map(([offset, x, opacity]) =>
      ({ transform: `translateX(${x * amount}px)`, opacity, offset }))
  };
  const exits = { "grow-out": "shrink-in", "blur-out": "blur-in", "flip-out-x": "flip-in-x", "flip-out-y": "flip-in-y",
    "rotate-out": "rotate-in", "bounce-out": "bounce-in", "glitch-out": "glitch-in" };
  if (entrances[type]) return entrances[type]();
  if (exits[type]) return reverse(entrances[exits[type]]());
  if (type === "fall-out") return [{ transform: "translateY(0px) rotate(0deg)", opacity: 1 },
    { transform: `translateY(${1.5 * distance}px) rotate(${8 * amount}deg)`, opacity: 0 }];
  return null;
}

// Wipes and circles uncover the layer through clip-path; every inset() keeps four values.
function revealFrames(type) {
  const hidden = { left: "inset(0 100% 0 0)", right: "inset(0 0 0 100%)", top: "inset(0 0 100% 0)", bottom: "inset(100% 0 0 0)" };
  const shown = "inset(0 0 0 0)";
  const wipe = type.match(/^wipe-(in|out)-(left|right|top|bottom)$/);
  // In "from the left" uncovers the left edge first; out "to the left" leaves it last.
  if (wipe) return wipe[1] === "in" ? [{ clipPath: hidden[wipe[2]] }, { clipPath: shown }] : [{ clipPath: shown }, { clipPath: hidden[wipe[2]] }];
  if (type === "circle-in") return [{ clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(75% at 50% 50%)" }];
  if (type === "circle-out") return [{ clipPath: "circle(75% at 50% 50%)" }, { clipPath: "circle(0% at 50% 50%)" }];
  return null;
}

function emphasisFrames(type, amount) {
  const spread = (values, frame) => values.map((value, index) => ({ ...frame(value * amount), offset: index / (values.length - 1) }));
  if (type === "heartbeat") return [[0, 0], [0.14, 1], [0.28, 0], [0.42, 1], [0.7, 0], [1, 0]]
    .map(([offset, beat]) => ({ transform: `scale(${1 + 0.14 * amount * beat})`, offset }));
  if (type === "wobble") return spread([0, -1, 0.8, -0.6, 0.4, -0.2, 0], value => ({ transform: `translateX(${value * 12}px) rotate(${value * 4}deg)` }));
  if (type === "tada") return [[1, 0], [0.92, -3], [1.08, 3], [1.08, -3], [1.08, 3], [1.08, -3], [1, 0]].map(([scale, angle], index, all) =>
    ({ transform: `scale(${1 + (scale - 1) * amount}) rotate(${angle * amount}deg)`, offset: index / (all.length - 1) }));
  if (type === "rubber-band") return [[0, 0], [0.3, 0.25], [0.4, -0.25], [0.5, 0.15], [0.65, -0.05], [0.75, 0.05], [1, 0]]
    .map(([offset, stretch]) => ({ transform: `scale(${1 + stretch * amount}, ${1 - stretch * amount})`, offset }));
  if (type === "jello") return spread([0, -12.5, 6.25, -3.125, 1.5625, -0.78, 0], value => ({ transform: `skewX(${value}deg) skewY(${value}deg)` }));
  if (type === "float") return [{ transform: "translateY(0px)" }, { transform: `translateY(${-10 * amount}px)` }, { transform: "translateY(0px)" }];
  if (type === "shake-vertical") return [0, -1, 1, -0.7, 0.7, 0].map(value => ({ transform: `translateY(${value * 7 * amount}px)` }));
  if (type === "spin") return [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }];
  if (type === "flicker") return [[0, 0], [0.1, 0.7], [0.15, 0], [0.3, 0.9], [0.33, 0], [0.5, 0.4], [0.55, 0], [0.8, 0.8], [0.84, 0], [1, 0]]
    .map(([offset, dip]) => ({ opacity: 1 - dip * Math.min(1, amount), offset }));
  if (type === "glitch") return [[0, 0, 0, 0], [0.2, -3, 1, -4], [0.4, 3, -1, 4], [0.6, -2, -1, 0], [0.8, 2, 1, -2], [1, 0, 0, 0]]
    .map(([offset, x, y, skew]) => ({ transform: `translate(${2 * x * amount}px, ${2 * y * amount}px) skewX(${skew * amount}deg)`,
      filter: `hue-rotate(${Math.abs(skew) * 20 * amount}deg)`, offset }));
  return null;
}

for (const { type, category } of ANIMATION_DEFINITIONS) defaultAnimationRegistry.register({ id: type, category, keyframes: config => effectFrames(type, config) });

// JavaScript forms of the CSS curves in schema.js, for numbers counted frame by frame.
const BACK = 1.70158;
function easingValue(progress, easing) {
  if (easing === "ease-in") return progress * progress;
  if (easing === "ease-out") return 1 - (1 - progress) ** 2;
  if (easing === "ease-in-out") return progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
  if (easing === "back-in") return (BACK + 1) * progress ** 3 - BACK * progress ** 2;
  if (easing === "back-out") return 1 + (BACK + 1) * (progress - 1) ** 3 + BACK * (progress - 1) ** 2;
  if (easing === "back-in-out") {
    const back = BACK * 1.525;
    return progress < 0.5 ? (2 * progress) ** 2 * ((back + 1) * 2 * progress - back) / 2
      : ((2 * progress - 2) ** 2 * ((back + 1) * (progress * 2 - 2) + back) + 2) / 2;
  }
  if (easing === "expo-out") return progress === 1 ? 1 : 1 - 2 ** (-10 * progress);
  if (easing === "steps") return Math.floor(progress * 6) / 6;
  return progress;
}

/** A layer's own clip-path is its shape; a reveal there would erase it, so it fades instead. */
function keepShape(frames, element, category) {
  const shape = element.style?.clipPath;
  if (!shape || shape === "none" || !frames.some(frame => frame.clipPath !== undefined)) return frames;
  if (!["entrance", "exit"].includes(category)) return frames.map(({ clipPath, ...frame }) => frame);
  const [from, to] = category === "exit" ? [1, 0] : [0, 1];
  return frames.map(({ clipPath, ...frame }, index) => ({ ...frame, opacity: from + (to - from) * index / (frames.length - 1) }));
}

function preserveBaseFrames(frames, element, category) {
  if (!Array.isArray(frames)) throw new TypeError("Animation keyframes must be an array.");
  frames = keepShape(frames, element, category);
  const transform = element.style?.transform;
  const filter = element.style?.filter;
  const opacity = Number.parseFloat(element.style?.opacity);
  return frames.map(frame => {
    const result = { ...frame };
    if (result.transform !== undefined && transform && transform !== "none") {
      result.transform = result.transform === "none" ? transform : `${transform} ${result.transform}`;
    }
    if (result.filter !== undefined && filter && filter !== "none") {
      result.filter = result.filter === "none" ? filter : `${filter} ${result.filter}`;
    }
    if (finite(result.opacity) && finite(opacity)) result.opacity *= opacity;
    return result;
  });
}

/** Configure transitions on the actual value node; the surrounding layer geometry is untouched. */
export function applyTransition(element, config = {}, properties = [], { enabled = true, reducedMotion = false } = {}) {
  if (!element?.style) return;
  const allowed = new Set(["width", "height", "color", "background-color", "opacity"]);
  const selected = properties.filter(property => allowed.has(property));
  const duration = enabled && !reducedMotion && finite(config.duration) ? Math.max(0, Math.min(60000, config.duration)) : 0;
  element.style.transitionProperty = duration > 0 && selected.length ? selected.join(", ") : "none";
  element.style.transitionDuration = `${duration}ms`;
  element.style.transitionTimingFunction = cssEasing(config.easing);
  element.style.transitionDelay = "0ms";
}

/**
 * One disposable controller per animation surface. New effects replace their channel;
 * no transforms, opacity, or filters are committed to the saved layer design.
 */
export class AnimationController {
  constructor(element, { enabled = () => true, reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
    registry = defaultAnimationRegistry, requestFrame = callback => globalThis.requestAnimationFrame?.(callback),
    cancelFrame = id => globalThis.cancelAnimationFrame?.(id), now = defaultNow,
    blockedReason = () => null, debug = () => false, onDiagnostic = () => {} } = {}) {
    this.element = element;
    this.enabled = typeof enabled === "function" ? enabled : () => Boolean(enabled);
    this.reducedMotion = typeof reducedMotion === "function" ? reducedMotion : () => Boolean(reducedMotion);
    this.registry = registry;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.now = now;
    this.blockedReason = blockedReason;
    this.debug = debug;
    this.onDiagnostic = onDiagnostic;
    this.enabledOverride = null;
    this.channels = new Map();
    this.numbers = new Map();
    this.destroyed = false;
  }

  getBlockedReason() {
    if (this.destroyed) return "destroyed";
    if (this.enabledOverride === false || !this.enabled()) return this.blockedReason() ?? "animations-disabled";
    if (this.reducedMotion()) return "reduced-motion";
    return this.blockedReason();
  }

  canPlay() { return !this.getBlockedReason(); }

  /** A few lifecycle samples, never a frame logger. Values contain no Actor data. */
  diagnose(config, channel, phase, detail = {}) {
    if (!this.debug()) return;
    const element = this.element;
    let computed;
    try { computed = globalThis.getComputedStyle?.(element); } catch { /* Detached/test DOM. */ }
    try {
      this.onDiagnostic({ type: config?.type ?? null, duration: config?.duration ?? null, channel, phase, at: Date.now(),
        target: { tag: element?.tagName ?? null, className: typeof element?.className === "string" ? element.className : null,
          instanceId: element?.dataset?.instanceId ?? null, pageId: element?.dataset?.pageId ?? null,
          actorUuid: element?.dataset?.actorUuid ?? null },
        connected: element?.isConnected ?? null,
        opacity: computed?.opacity ?? null, transform: computed?.transform ?? null,
        visibility: computed?.visibility ?? null, display: computed?.display ?? null, ...detail });
    } catch { /* Diagnostics cannot interrupt presentation. */ }
  }

  play(input, { channel = "emphasis", persistent = false } = {}) {
    this.stop(channel, "replaced");
    const skip = (status, reason = status) => {
      this.diagnose(input, channel, "skipped", { status, reason });
      return Promise.resolve({ status });
    };
    const blocked = this.getBlockedReason();
    if (blocked) return skip("disabled", blocked);
    let config;
    try { config = validateAnimationConfig(input); } catch { return skip("invalid"); }
    if (!config) return skip("empty");
    const definition = this.registry.get(config.type);
    if (!definition) return skip("unknown");
    if (typeof this.element?.animate !== "function") return skip("unsupported");
    let frames, animation;
    this.diagnose(config, channel, "requested");
    try {
      frames = definition.keyframes(config);
      if (!frames) return skip("unknown");
      frames = preserveBaseFrames(frames, this.element, definition.category);
      animation = this.element.animate(frames, { duration: config.duration, delay: config.delay,
        easing: cssEasing(config.easing), direction: config.direction, iterations: persistent ? Infinity : config.repeat,
        // Hold the initial frame through delay and the final frame until the
        // visibility owner has hidden the outgoing surface in the same task.
        fill: "both" });
    } catch { return skip("unsupported"); }
    return new Promise(resolve => {
      const entry = { animation, resolve, settled: false, sample: null };
      const settle = (status, reason) => {
        if (entry.settled) return;
        entry.settled = true;
        if (entry.sample !== null) clearTimeout(entry.sample);
        this.diagnose(config, channel, status, { status, reason: reason ?? status, currentTime: animation.currentTime ?? null });
        if (this.channels.get(channel) === entry) this.channels.delete(channel);
        // Cancel even a finished animation to release its timeline and effect references.
        try { animation.cancel?.(); } catch { /* Already detached. */ }
        resolve({ status });
      };
      entry.finish = settle;
      this.channels.set(channel, entry);
      const started = () => {
        if (entry.settled) return;
        this.diagnose(config, channel, "started", { status: "running", playState: animation.playState ?? null });
        if (this.debug()) entry.sample = setTimeout(() => {
          entry.sample = null;
          if (!entry.settled) this.diagnose(config, channel, "sample", { status: "running", currentTime: animation.currentTime ?? null });
        }, config.delay + config.duration / 2);
      };
      if (animation.ready?.then) animation.ready.then(started, () => {}).catch(() => {});
      else started();
      // Consuming rejection prevents cancellation from producing unhandled browser promises.
      if (animation.finished?.then) animation.finished.then(() => settle("finished"), () => settle("cancelled"));
      else {
        animation.onfinish = () => settle("finished");
        animation.oncancel = () => settle("cancelled");
      }
    });
  }

  stop(channel = "emphasis", reason = "stopped") {
    const entry = this.channels.get(channel);
    if (entry) entry.finish("cancelled", reason);
  }

  transitionStyles(element, config, properties) {
    applyTransition(element, config, properties, { enabled: this.canPlay() });
  }

  /** Rapid updates start at the value currently displayed and always finish at the latest target. */
  transitionNumber(key, from, to, config = {}, onValue = () => {}) {
    const previous = this.numbers.get(key);
    const start = previous?.current ?? from;
    this.cancelNumber(key, { finish: false });
    const duration = finite(config.duration) ? Math.max(0, Math.min(60000, config.duration)) : 0;
    if (!finite(to) || !finite(start) || !this.canPlay() || duration === 0) {
      onValue(to);
      return Promise.resolve({ status: "finished", value: to });
    }
    return new Promise(resolve => {
      const entry = { from: start, to, current: start, frame: null, started: this.now(), onValue, resolve };
      this.numbers.set(key, entry);
      const finish = status => {
        if (this.numbers.get(key) !== entry) return;
        this.numbers.delete(key);
        entry.frame = null;
        resolve({ status, value: entry.current });
      };
      const step = timestamp => {
        if (this.numbers.get(key) !== entry || this.destroyed) return;
        entry.frame = null;
        if (!this.canPlay()) { this.cancelNumber(key); return; }
        const elapsed = Math.max(0, (finite(timestamp) ? timestamp : this.now()) - entry.started);
        const progress = Math.min(1, elapsed / duration);
        const eased = easingValue(progress, config.easing);
        // A weighted sum avoids overflowing the difference between two finite extremes.
        const interpolated = start * (1 - eased) + to * eased;
        entry.current = progress === 1 ? to : finite(interpolated) ? interpolated : eased < 0.5 ? start : to;
        try { onValue(entry.current); } catch { finish("failed"); return; }
        if (progress === 1) { finish("finished"); return; }
        entry.frame = this.requestFrame(step);
        if (entry.frame === undefined || entry.frame === null) this.cancelNumber(key);
      };
      try { onValue(start); } catch { finish("failed"); return; }
      entry.frame = this.requestFrame(step);
      if (entry.frame === undefined || entry.frame === null) this.cancelNumber(key);
    });
  }

  cancelNumber(key, { finish = true } = {}) {
    const entry = this.numbers.get(key);
    if (!entry) return;
    this.numbers.delete(key);
    if (entry.frame !== null) this.cancelFrame(entry.frame);
    entry.frame = null;
    if (finish) {
      entry.current = entry.to;
      try { entry.onValue(entry.to); } catch { /* The value node may have been removed. */ }
    }
    entry.resolve({ status: finish ? "finished" : "cancelled", value: entry.current });
  }

  setEnabled(enabled) {
    this.enabledOverride = Boolean(enabled);
    if (!this.canPlay()) this.reset("preferences-changed");
  }

  reset(reason = "reset") {
    for (const channel of [...this.channels.keys()]) this.stop(channel, reason);
    for (const key of [...this.numbers.keys()]) this.cancelNumber(key);
  }

  destroy(reason = "destroyed") { this.reset(reason); this.destroyed = true; this.element = null; }
}
