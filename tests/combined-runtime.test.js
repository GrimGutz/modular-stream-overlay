import test from "node:test";
import assert from "node:assert/strict";
import { buildCarouselSequence, UnifiedCarouselController } from "../scripts/carousel/sequence.js";

const pages = () => [{ id: "basic", enabled: true, duration: null }, { id: "resources", enabled: true, duration: 8000 }];
const pairs = sequence => sequence.map(({ actorUuid, pageId }) => `${actorUuid}/${pageId}`);
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

function fixture(options = {}) {
  let now = 0, id = 0;
  const timers = new Map(), changes = [], states = [], cancellations = [], errors = [];
  const controller = new UnifiedCarouselController({ actors: ["Actor.A", "Actor.B"], pages: pages(),
    settings: { enabled: true, mode: "combined" }, now: () => now,
    setTimer(callback, ms) { const key = ++id; timers.set(key, { callback, due: now + ms }); return key; },
    clearTimer: key => timers.delete(key), onStep: event => changes.push(event), onState: state => states.push(state),
    onCancel: event => cancellations.push(event), onError: error => errors.push(error), ...options });
  return { controller, timers, changes, states, cancellations, errors,
    async advance(ms) {
      now += ms;
      for (const [key, value] of [...timers].filter(([, value]) => value.due <= now)) { timers.delete(key); value.callback(); }
      await settle();
    } };
}

test("combined playback has one timer and exhausts each Actor's pages before advancing the Actor", async () => {
  const f = fixture();
  await f.controller.start();
  assert.deepEqual(pairs(f.controller.getState().sequence), ["Actor.A/basic", "Actor.A/resources", "Actor.B/basic", "Actor.B/resources"]);
  assert.equal(f.changes[0].initial, true);
  assert.equal(f.changes[0].transition, "instant");
  assert.equal(f.timers.size, 1);
  await f.advance(5000); await f.advance(8000); await f.advance(5000); await f.advance(8000);
  assert.deepEqual(pairs(f.changes.map(event => event.to)), ["Actor.A/basic", "Actor.A/resources", "Actor.B/basic", "Actor.B/resources", "Actor.A/basic"]);
  assert.deepEqual(f.controller.getState().sequence.map(Object.keys), Array(4).fill(["actorUuid", "pageId"]));
  assert.equal(f.timers.size, 1);
  f.controller.destroy(); assert.equal(f.timers.size, 0);
});

test("optional characters-first traversal uses the same single scheduler", async () => {
  const f = fixture({ settings: { enabled: true, mode: "combined", traversal: "characters-first" } });
  await f.controller.start();
  assert.deepEqual(pairs(f.controller.getState().sequence), ["Actor.A/basic", "Actor.B/basic", "Actor.A/resources", "Actor.B/resources"]);
  await f.controller.next(); assert.equal(f.controller.getState().activeActorUuid, "Actor.B");
  assert.equal(f.controller.getState().activePageId, "basic");
  assert.equal(f.timers.size, 1); f.controller.destroy();
});

test("information and character modes constrain only their designated playback dimension", async () => {
  const info = fixture({ settings: { enabled: true, mode: "information", actorStartUuid: "Actor.B" } });
  await info.controller.start();
  assert.deepEqual(pairs(info.controller.getState().sequence), ["Actor.B/basic", "Actor.B/resources"]);
  await info.controller.next(); await info.controller.next();
  assert.equal(info.controller.getState().activeActorUuid, "Actor.B");
  await info.controller.selectActor("Actor.A");
  assert.deepEqual(pairs(info.controller.getState().sequence), ["Actor.A/basic", "Actor.A/resources"]);
  const character = fixture({ settings: { enabled: true, mode: "character", startPageId: "resources" } });
  await character.controller.start();
  assert.deepEqual(pairs(character.controller.getState().sequence), ["Actor.A/resources", "Actor.B/resources"]);
  await character.controller.next(); assert.equal(character.controller.getState().activeActorUuid, "Actor.B");
  await character.controller.select("basic");
  assert.deepEqual(pairs(character.controller.getState().sequence), ["Actor.A/basic", "Actor.B/basic"]);
  info.controller.destroy(); character.controller.destroy();
});

test("static mode never schedules even after Resume and remains manually selectable", async () => {
  const f = fixture({ settings: { enabled: true, mode: "static", actorStartUuid: "Actor.B", startPageId: "resources" } });
  await f.controller.start(); await f.controller.resume();
  assert.equal(f.controller.getState().paused, true);
  assert.equal(f.controller.getState().running, false);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(pairs(f.controller.getState().sequence), ["Actor.B/resources"]);
  await f.controller.select("basic", "Actor.A"); await f.advance(60000);
  assert.equal(f.controller.getState().activeActorUuid, "Actor.A");
  assert.equal(f.controller.getState().activePageId, "basic");
  assert.equal(f.timers.size, 0); f.controller.destroy();
});

test("page changes and character changes select their own transitions and duration overrides", async () => {
  const f = fixture({ settings: { enabled: true, mode: "combined", duration: 2000, pageDurations: { basic: 3000 },
    transition: "slide-left", transitionDuration: 300, characterTransition: "fade", characterTransitionDuration: 500 } });
  await f.controller.start();
  assert.equal(f.controller.getState().remaining, 3000);
  await f.advance(3000);
  assert.equal(f.changes[1].transition, "slide-left"); assert.equal(f.changes[1].duration, 300);
  assert.equal(f.changes[1].actorChanged, false);
  assert.equal(f.controller.getState().remaining, 8000);
  await f.advance(8000);
  assert.equal(f.changes[2].transition, "fade"); assert.equal(f.changes[2].duration, 500);
  assert.equal(f.changes[2].actorChanged, true);
  assert.equal(f.controller.getState().remaining, 3000); f.controller.destroy();
});

test("a character transition starts the complete dwell only after the prepared presentation commits", async () => {
  let commit;
  const f = fixture({ settings: { enabled: true, mode: "character", duration: 5000 },
    onStep: event => event.initial ? undefined : new Promise(resolve => { commit = resolve; }) });
  await f.controller.start(); await f.advance(5000);
  assert.equal(f.controller.getState().transitioning, true);
  assert.equal(f.timers.size, 0);
  await f.advance(700);
  commit(); await settle();
  assert.equal(f.controller.getState().remaining, 5000);
  assert.equal([...f.timers.values()][0].due, 10700);
  f.controller.destroy();
});

test("pause, hidden state, Resume and manual navigation preserve both position and remaining dwell", async () => {
  const f = fixture(); await f.controller.start(); await f.advance(1400);
  f.controller.pause(); assert.equal(f.controller.getState().remaining, 3600);
  await f.advance(30000); await f.controller.resume(); await f.advance(600);
  await f.controller.setVisible(false); assert.equal(f.controller.getState().remaining, 3000);
  await f.advance(30000); await f.controller.setVisible(true);
  assert.equal(f.controller.getState().activeActorUuid, "Actor.A");
  await f.advance(2999); assert.equal(f.changes.length, 1);
  await f.advance(1); assert.equal(f.controller.getState().activePageId, "resources");
  f.controller.pause(); await f.controller.next();
  assert.equal(f.controller.getState().paused, true);
  assert.equal(f.controller.getState().activeActorUuid, "Actor.B");
  assert.equal(f.controller.getState().activePageId, "basic");
  assert.equal(f.controller.getState().remaining, 5000);
  assert.equal(f.timers.size, 0); f.controller.destroy();
});

test("manual next, previous and direct Actor/page selection reset full dwell without changing the pause state", async () => {
  const f = fixture(); await f.controller.start(); await f.advance(4990);
  await f.controller.next(); assert.equal(f.controller.getState().remaining, 8000);
  await f.controller.previous(); assert.equal(f.controller.getState().remaining, 5000);
  await f.controller.select("resources", "Actor.B");
  assert.equal(f.controller.getState().actorIndex, 1); assert.equal(f.controller.getState().pageIndex, 1);
  assert.equal(f.controller.getState().sequenceIndex, 3);
  assert.equal(f.controller.getState().paused, false);
  await f.advance(1200); await f.controller.select("resources", "Actor.B");
  assert.equal(f.controller.getState().remaining, 8000);
  f.controller.pause(); await f.controller.selectActor("Actor.A");
  assert.equal(f.controller.getState().activeActorUuid, "Actor.A");
  assert.equal(f.controller.getState().activePageId, "resources");
  assert.equal(f.controller.getState().paused, true); f.controller.destroy();
});

test("reset restores the defined Actor/page starting pair and preserves paused state", async () => {
  const f = fixture({ settings: { enabled: true, mode: "combined", actorStartUuid: "Actor.B", startPageId: "resources" } });
  await f.controller.start();
  await f.controller.next(); assert.equal(f.controller.getState().activeActorUuid, "Actor.A");
  f.controller.pause(); await f.controller.reset();
  assert.equal(f.controller.getState().activeActorUuid, "Actor.B");
  assert.equal(f.controller.getState().activePageId, "resources");
  assert.equal(f.controller.getState().remaining, 8000);
  assert.equal(f.controller.getState().paused, true);
  assert.equal(f.timers.size, 0); f.controller.destroy();
});

test("nonlooping combined playback holds the final Actor/page without retaining a timer", async () => {
  const f = fixture({ settings: { enabled: true, mode: "combined", loop: false } });
  await f.controller.start();
  for (const ms of [5000, 8000, 5000, 8000]) await f.advance(ms);
  assert.equal(f.controller.getState().activeActorUuid, "Actor.B");
  assert.equal(f.controller.getState().activePageId, "resources");
  assert.equal(f.controller.getState().ended, true);
  assert.equal(f.timers.size, 0);
  await f.controller.previous(); assert.equal(f.controller.getState().ended, false);
  assert.equal(f.timers.size, 1); f.controller.destroy();
});

test("live availability changes preserve a valid current presentation and never restart its dwell", async () => {
  let unavailable = new Set();
  const f = fixture({ pages: pages().map(page => ({ ...page, skipIfUnavailable: true })),
    isEligible: (uuid, page) => !unavailable.has(`${uuid}/${page.id}`) });
  await f.controller.start(); await f.advance(1500);
  unavailable = new Set(["Actor.B/resources"]);
  await f.controller.refreshAvailability();
  assert.equal(f.controller.getState().remaining, 3500);
  assert.equal(f.changes.length, 1);
  assert.deepEqual(pairs(f.controller.getState().sequence), ["Actor.A/basic", "Actor.A/resources", "Actor.B/basic"]);
  unavailable.add("Actor.A/basic"); await f.controller.refreshAvailability();
  assert.equal(f.controller.getState().activePageId, "resources");
  assert.equal(f.changes[1].initial, true, "Automatic recovery supplies a fresh baseline rather than replaying events");
  assert.equal(f.changes[1].transition, "instant"); f.controller.destroy();
});

test("missing Actors, unavailable pages and empty inputs produce idle states and recover without skip loops", async () => {
  let activeActors = new Set(), available = false;
  const f = fixture({ pages: pages().map(page => ({ ...page, skipIfUnavailable: true })),
    isActorAvailable: uuid => activeActors.has(uuid), isEligible: () => available });
  await f.controller.start();
  assert.equal(f.controller.getState().activeActorUuid, null); assert.equal(f.timers.size, 0);
  await f.advance(100000); await f.controller.refreshAvailability(); assert.equal(f.changes.length, 1);
  activeActors = new Set(["Actor.B"]); available = true; await f.controller.refreshAvailability();
  assert.equal(f.controller.getState().activeActorUuid, "Actor.B"); assert.equal(f.changes[1].initial, true);
  activeActors.clear(); await f.controller.refreshAvailability();
  assert.equal(f.controller.getState().activePageId, null); assert.equal(f.timers.size, 0);
  f.controller.destroy();
  for (const options of [{ actors: [] }, { pages: [] }, { pages: pages().map(page => ({ ...page, enabled: false })) }]) {
    const empty = fixture(options); await empty.controller.start(); await empty.controller.next(); await empty.controller.resume();
    assert.equal(empty.controller.getState().activePageId, null); assert.equal(empty.timers.size, 0); empty.controller.destroy();
  }
});

test("fallback pages remain eligible and a single eligible pair needs no timer", async () => {
  const f = fixture({ pages: [{ id: "basic", skipIfUnavailable: true }, { id: "fallback", skipIfUnavailable: false }],
    isActorAvailable: uuid => uuid === "Actor.B", isEligible: () => false });
  await f.controller.start();
  assert.deepEqual(pairs(f.controller.getState().sequence), ["Actor.B/fallback"]);
  assert.equal(f.controller.getState().activePageId, "fallback"); assert.equal(f.timers.size, 0); f.controller.destroy();
});

test("reduced motion switches both dimensions instantly without disabling playback", async () => {
  const f = fixture({ canAnimate: () => false }); await f.controller.start();
  await f.controller.next(); await f.controller.next();
  assert.equal(f.controller.getState().activeActorUuid, "Actor.B");
  assert.ok(f.changes.every(event => event.transition === "instant" && event.duration === 0));
  assert.equal(f.timers.size, 1); f.controller.destroy();
});

test("rapid asynchronous navigation invalidates stale presentations and destroy cleans the only timer", async () => {
  const pending = [], events = [], cancellations = [];
  const f = fixture({ onStep: event => {
    events.push(event); if (!event.initial) return new Promise(resolve => pending.push(resolve));
  }, onCancel: event => cancellations.push(event) });
  await f.controller.start();
  const first = f.controller.next(), second = f.controller.next();
  await settle();
  assert.equal(events[1].isCurrent(), false); assert.equal(events[2].isCurrent(), true);
  assert.equal(events[2].to.actorUuid, "Actor.B");
  pending[0](); await first; assert.equal(f.timers.size, 0);
  f.controller.destroy(); assert.equal(events[2].isCurrent(), false);
  pending[1](); await second;
  assert.equal(cancellations.length, 2); assert.equal(f.timers.size, 0);
  assert.equal(f.controller.getState().destroyed, true);
  await f.controller.resume(); await f.controller.next(); await f.controller.reset();
  assert.equal(f.timers.size, 0);
});

test("instances keep independent sequence positions and fresh reloads return to their defined start", async () => {
  const a = fixture(), b = fixture(); await Promise.all([a.controller.start(), b.controller.start()]);
  await a.controller.select("resources", "Actor.B");
  assert.equal(b.controller.getState().activeActorUuid, "Actor.A");
  assert.equal(b.controller.getState().activePageId, "basic");
  a.controller.destroy(); const reload = fixture(); await reload.controller.start();
  assert.equal(reload.controller.getState().activeActorUuid, "Actor.A"); assert.equal(reload.changes[0].initial, true);
  b.controller.destroy(); reload.controller.destroy();
});

test("sequence helper filters disabled and duplicate entries without exposing page content or Actor values", () => {
  const result = buildCarouselSequence({ actors: ["Actor.A", "Actor.A", "Actor.B"],
    pages: [{ id: "basic", layers: [{ secret: true }] }, { id: "hidden", enabled: false }, { id: "basic" }],
    settings: { mode: "combined" } });
  assert.deepEqual(result, [{ actorUuid: "Actor.A", pageId: "basic" }, { actorUuid: "Actor.B", pageId: "basic" }]);
});

test("availability errors fail closed and presentation errors do not create extra timers", async () => {
  const f = fixture({ isActorAvailable: uuid => { if (uuid === "Actor.A") throw Error("Unavailable"); return true; },
    onStep: () => { throw Error("Presentation failed"); } });
  await f.controller.start(); assert.equal(f.controller.getState().activeActorUuid, "Actor.B");
  assert.ok(f.errors.length >= 2); assert.equal(f.timers.size, 1);
  await f.advance(5000); assert.equal(f.timers.size, 1); f.controller.destroy();
});
