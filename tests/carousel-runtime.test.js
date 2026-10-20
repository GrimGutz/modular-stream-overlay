import test from "node:test";
import assert from "node:assert/strict";
import { CarouselController } from "../scripts/carousel/runtime.js";

const pages = (options = {}) => ["basic", "attributes", "resources"].map(id => ({ id, name: id, duration: null,
  skipIfUnavailable: false, layers: [], ...options }));
const settle = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };

function fixture(options = {}) {
  let now = 0, sequence = 0;
  const timers = new Map(), changes = [], states = [], errors = [], cancellations = [];
  const controller = new CarouselController({ pages: pages(), settings: { enabled: true },
    now: () => now,
    setTimer(callback, ms) { const id = ++sequence; timers.set(id, { callback, due: now + ms }); return id; },
    clearTimer: id => timers.delete(id),
    onPage: event => { changes.push(event); }, onState: state => states.push(state), onError: error => errors.push(error),
    onCancel: event => cancellations.push(event), ...options });
  return { controller, timers, changes, states, errors, cancellations,
    async advance(ms) {
      now += ms;
      const due = [...timers].filter(([, value]) => value.due <= now);
      for (const [id, value] of due) { timers.delete(id); value.callback(); }
      await settle();
    } };
}

test("configured page starts without a transition and each instance owns an independent local timer", async () => {
  const first = fixture({ settings: { enabled: true, startPageId: "attributes" } });
  const second = fixture();
  await Promise.all([first.controller.start(), second.controller.start()]);
  assert.equal(first.changes[0].to, "attributes");
  assert.equal(first.changes[0].initial, true);
  assert.equal(first.changes[0].transition, "instant");
  assert.equal(first.changes[0].duration, 0);
  assert.equal(first.timers.size, 1);
  await first.advance(5000);
  assert.equal(first.controller.getState().activePageId, "resources");
  assert.equal(second.controller.getState().activePageId, "basic");
  assert.equal(second.timers.size, 1);
  first.controller.destroy(); second.controller.destroy();
  assert.equal(first.timers.size + second.timers.size, 0);
});

test("page duration overrides inherit only when absent and wrap when looping", async () => {
  const configuredPages = pages(); configuredPages[1].duration = 8000;
  const f = fixture({ pages: configuredPages });
  await f.controller.start();
  await f.advance(4999); assert.equal(f.changes.length, 1);
  await f.advance(1); assert.equal(f.controller.getState().activePageId, "attributes");
  await f.advance(7999); assert.equal(f.changes.length, 2);
  await f.advance(1); assert.equal(f.controller.getState().activePageId, "resources");
  await f.advance(5000); assert.equal(f.controller.getState().activePageId, "basic");
  assert.equal(f.timers.size, 1);
  f.controller.destroy();
});

test("a full dwell begins after transition completion rather than consuming transition time", async () => {
  let finish;
  const f = fixture({ onPage: event => event.initial ? undefined : new Promise(resolve => { finish = resolve; }) });
  await f.controller.start();
  await f.advance(5000);
  assert.equal(f.controller.getState().activePageId, "attributes");
  assert.equal(f.controller.getState().transitioning, true);
  assert.equal(f.timers.size, 0);
  await f.advance(4000);
  finish(); await settle();
  assert.equal(f.controller.getState().remaining, 5000);
  assert.equal(f.timers.size, 1);
  await f.advance(4999);
  assert.equal(f.controller.getState().activePageId, "attributes");
  f.controller.destroy();
});

test("pause and hidden widgets preserve remaining dwell without a hidden backlog", async () => {
  const f = fixture();
  await f.controller.start();
  await f.advance(1700);
  f.controller.pause();
  assert.equal(f.controller.getState().remaining, 3300);
  assert.equal(f.timers.size, 0);
  await f.advance(30000);
  await f.controller.resume();
  await f.advance(1000);
  await f.controller.setVisible(false);
  assert.equal(f.controller.getState().remaining, 2300);
  await f.advance(30000);
  assert.equal(f.controller.getState().activePageId, "basic");
  await f.controller.setVisible(true);
  await f.advance(2299); assert.equal(f.changes.length, 1);
  await f.advance(1); assert.equal(f.controller.getState().activePageId, "attributes");
  assert.equal(f.timers.size, 1);
  f.controller.destroy();
});

test("manual selection keeps pause state, resets dwell and can temporarily resume disabled automatic cycling", async () => {
  const f = fixture({ settings: { enabled: false } });
  await f.controller.start();
  assert.equal(f.controller.getState().paused, true);
  assert.equal(f.timers.size, 0);
  await f.controller.select("attributes");
  assert.equal(f.controller.getState().paused, true);
  await f.advance(9000); assert.equal(f.controller.getState().activePageId, "attributes");
  await f.controller.resume();
  await f.advance(4500);
  await f.controller.select("resources");
  assert.equal(f.controller.getState().paused, false);
  assert.equal(f.controller.getState().remaining, 5000);
  await f.advance(4999); assert.equal(f.controller.getState().activePageId, "resources");
  await f.advance(1); assert.equal(f.controller.getState().activePageId, "basic");
  f.controller.destroy();
});

test("nonlooping playback holds the last page and previous navigation can restart the earlier page dwell", async () => {
  const f = fixture({ settings: { enabled: true, loop: false } });
  await f.controller.start();
  await f.advance(5000); await f.advance(5000); await f.advance(5000);
  assert.equal(f.controller.getState().activePageId, "resources");
  assert.equal(f.controller.getState().ended, true);
  assert.equal(f.controller.getState().running, false);
  assert.equal(f.timers.size, 0);
  await f.advance(60000); assert.equal(f.changes.length, 3);
  await f.controller.previous();
  assert.equal(f.controller.getState().activePageId, "attributes");
  assert.equal(f.controller.getState().ended, false);
  assert.equal(f.timers.size, 1);
  f.controller.destroy();
});

test("unavailable dynamic pages are skipped while fallback pages remain eligible", async () => {
  let available = new Set(["attributes"]);
  const configuredPages = pages({ skipIfUnavailable: true });
  configuredPages[2].skipIfUnavailable = false;
  const f = fixture({ pages: configuredPages, isEligible: page => available.has(page.id),
    settings: { enabled: true, startPageId: "basic" } });
  await f.controller.start();
  assert.equal(f.controller.getState().activePageId, "attributes");
  assert.deepEqual(f.controller.getState().availablePageIds, ["attributes", "resources"]);
  await f.advance(1200);
  await f.controller.refreshAvailability();
  assert.equal(f.controller.getState().remaining, 3800, "Live updates do not restart the timer or replay the page");
  assert.equal(f.changes.length, 1);
  available = new Set();
  await f.controller.refreshAvailability();
  assert.equal(f.controller.getState().activePageId, "resources");
  assert.equal(f.timers.size, 0, "One available page does not waste a timer");
  f.controller.destroy();
});

test("all unavailable pages produce an idle empty state and recover a valid configured starting page", async () => {
  let available = false;
  const f = fixture({ pages: pages({ skipIfUnavailable: true }), isEligible: () => available,
    settings: { enabled: true, startPageId: "attributes" } });
  await f.controller.start();
  assert.equal(f.controller.getState().activePageId, null);
  assert.equal(f.timers.size, 0);
  await f.advance(60000); await f.controller.refreshAvailability();
  assert.equal(f.changes.length, 1);
  available = true;
  await f.controller.refreshAvailability();
  assert.equal(f.controller.getState().activePageId, "attributes");
  assert.equal(f.timers.size, 1);
  available = false;
  await f.controller.refreshAvailability();
  assert.equal(f.controller.getState().activePageId, null);
  assert.equal(f.timers.size, 0);
  f.controller.destroy();
});

test("reduced motion and disabled animation still switch information without transitions", async () => {
  const f = fixture({ canAnimate: () => false });
  await f.controller.start(); await f.advance(5000);
  assert.equal(f.controller.getState().activePageId, "attributes");
  assert.equal(f.changes[1].transition, "instant");
  assert.equal(f.changes[1].duration, 0);
  assert.equal(f.timers.size, 1);
  f.controller.destroy();
});

test("all transition choices are passed to the rendering context without implementing frame ticks", async () => {
  for (const transition of ["fade", "slide-left", "slide-right", "slide-up", "slide-down", "scale", "instant"]) {
    const f = fixture({ settings: { enabled: true, transition, transitionDuration: 600 } });
    await f.controller.start(); await f.controller.next();
    assert.equal(f.changes[1].transition, transition);
    assert.equal(f.changes[1].duration, transition === "instant" ? 0 : 600);
    assert.equal(f.timers.size, 1);
    f.controller.destroy();
  }
});

test("rapid asynchronous changes invalidate stale callbacks and destroy cancels pending work", async () => {
  const pending = [], events = [], cancellations = [];
  const f = fixture({ onPage: event => {
    events.push(event);
    if (event.initial) return;
    return new Promise(resolve => pending.push(resolve));
  }, onCancel: event => cancellations.push(event) });
  await f.controller.start();
  const first = f.controller.next();
  const second = f.controller.next();
  assert.equal(events[1].isCurrent(), false);
  assert.equal(events[2].isCurrent(), true);
  assert.equal(f.controller.getState().activePageId, "resources");
  assert.equal(cancellations.length, 1);
  pending[0](); await first;
  assert.equal(f.controller.getState().transitioning, true);
  assert.equal(f.timers.size, 0, "An obsolete callback cannot restart a timer");
  f.controller.destroy();
  assert.equal(events[2].isCurrent(), false);
  pending[1](); await second;
  assert.equal(f.timers.size, 0);
  assert.equal(cancellations.length, 2);
  assert.equal(f.controller.getState().destroyed, true);
  await f.controller.resume(); await f.controller.select("basic"); await f.controller.setVisible(true);
  assert.equal(f.timers.size, 0);
});

test("renderer errors settle safely and do not accumulate timer work", async () => {
  const f = fixture({ onPage: () => { throw Error("render failed"); } });
  await f.controller.start();
  assert.equal(f.errors.length, 1);
  assert.equal(f.controller.getState().transitioning, false);
  assert.equal(f.timers.size, 1);
  await f.advance(5000);
  assert.equal(f.errors.length, 2);
  assert.equal(f.timers.size, 1);
  f.controller.destroy();
});
