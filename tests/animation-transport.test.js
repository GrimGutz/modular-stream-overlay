import test from "node:test";
import assert from "node:assert/strict";
import { StreamCommandTransport, SOCKET_NAME } from "../scripts/animation/transport.js";

function fixture() {
  let now = 100000, sequence = 0, timerSequence = 0;
  const timers = new Map(), clients = [], packets = [], played = [];
  const gm = { id: "gm", role: 4, isGM: true, active: true };
  // A native stream needs neither a User.query listener nor permission to query users.
  const viewer = { id: "viewer", role: 1, isGM: false, active: true, hasPermission: () => false };
  const outsider = { id: "outsider", role: 1, isGM: false, active: true };
  const users = new Map([gm, viewer, outsider].map(user => [user.id, user]));
  const command = extra => ({ id: `command-${++sequence}`, overlayId: "overlay-1", layerId: "layer-1", kind: "play",
    createdAt: now, expiresAt: now + 10000, ...extra });
  const clock = {
    now: () => now,
    setTimer(callback, delay) { const id = ++timerSequence; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimer: id => timers.delete(id),
    tick(amount) {
      const until = now + amount;
      for (;;) {
        const next = [...timers].filter(([, value]) => value.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback();
      }
      now = until;
    }
  };
  function client(user, { receiver = false, receive = async (payload, context) => { played.push({ payload, context }); return { accepted: true }; } } = {}) {
    const listeners = new Map();
    const socket = {
      connected: true,
      on(event, callback) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); },
      off(event, callback) { listeners.get(event)?.delete(callback); },
      emit(event, payload, options) {
        assert.equal(event, SOCKET_NAME);
        packets.push({ event, payload: structuredClone(payload), options: structuredClone(options), senderId: user.id });
        // Emulate Foundry v14's authenticated handleCustomSocket: payload identity is
        // never used, and every socket of the recipient user receives the event.
        for (const target of clients) {
          if (options?.recipients ? options.recipients.includes(target.user.id) : target.socket !== socket) {
            for (const handler of target.listeners.get(event) ?? []) handler(structuredClone(payload), user.id);
          }
        }
      }
    };
    const transport = new StreamCommandTransport({ getUser: () => user, getViewer: () => viewer,
      getUserById: id => users.get(id), isReceiver: () => receiver, receive, socket, ...clock });
    const value = { transport, socket, listeners, user, setReceiver: value => { receiver = value; },
      deliver(payload, senderId) { for (const handler of listeners.get(SOCKET_NAME) ?? []) handler(payload, senderId); },
      disconnect() { socket.connected = false; for (const handler of listeners.get("disconnect") ?? []) handler(); },
      shutdown() { for (const handler of listeners.get("shutdown") ?? []) handler(); } };
    clients.push(value); transport.start(); return value;
  }
  return { gm, viewer, outsider, users, command, client, clock, timers, packets, played };
}

async function flush() { for (let index = 0; index < 5; index++) await Promise.resolve(); }

test("native stream receives commands and authenticates acknowledgments without User.query or a query permission", async () => {
  const f = fixture(), game = f.client(f.gm), stream = f.client(f.viewer, { receiver: true });
  const command = f.command({ kind: "carousel", action: "next" });
  assert.deepEqual(await game.transport.send(command), { accepted: true });
  assert.equal(f.played.length, 1);
  assert.deepEqual(f.played[0], { payload: command, context: { user: f.gm } });
  assert.deepEqual(f.packets[0], { event: SOCKET_NAME, payload: { type: "command", viewerId: f.viewer.id, command }, options: { recipients: [f.viewer.id] }, senderId: f.gm.id });
  assert.deepEqual(f.packets[1], { event: SOCKET_NAME, payload: { type: "ack", gmId: f.gm.id, id: command.id, accepted: true }, options: { recipients: [f.gm.id] }, senderId: f.viewer.id });
  assert.equal(game.transport.pending.size, 0); assert.equal(f.timers.size, 0);
  assert.equal(stream.listeners.has("userQuery"), false);
});

test("server sender identity is required and payload identities cannot impersonate a GM", async () => {
  const f = fixture(), stream = f.client(f.viewer, { receiver: true });
  const packet = () => ({ type: "command", viewerId: f.viewer.id, command: f.command() });
  for (const sender of [undefined, null, "", f.viewer.id, f.outsider.id, "missing-gm"]) stream.deliver(packet(), sender);
  stream.deliver({ ...packet(), gmId: f.gm.id }, f.outsider.id);
  stream.deliver({ ...packet(), sender: f.gm.id }, f.gm.id);
  stream.deliver({ ...packet(), command: { ...f.command(), sender: f.gm.id } }, f.gm.id);
  await flush();
  assert.equal(f.played.length, 0); assert.equal(f.packets.length, 0);
  stream.deliver(packet(), f.gm.id); await flush();
  assert.equal(f.played.length, 1);
});

test("only the selected viewer's opted-in stream receives commands, while ordinary game tabs stay silent", async () => {
  const f = fixture();
  const normal = f.client(f.viewer), other = f.client(f.outsider, { receiver: true }), stream = f.client(f.viewer, { receiver: true });
  const packet = () => ({ type: "command", viewerId: f.viewer.id, command: f.command() });
  normal.deliver(packet(), f.gm.id); other.deliver(packet(), f.gm.id);
  stream.deliver({ ...packet(), viewerId: f.outsider.id }, f.gm.id);
  await flush(); assert.equal(f.played.length, 0);
  stream.deliver(packet(), f.gm.id); await flush(); assert.equal(f.played.length, 1);
  // An Assistant GM viewer is accepted like any other selected account.
  Object.assign(f.viewer, { role: 3, isGM: true }); stream.deliver(packet(), f.gm.id); await flush(); assert.equal(f.played.length, 2);
});

test("unknown GM tabs cannot race a command acknowledgment away from the issuing tab", async () => {
  const f = fixture(), origin = f.client(f.gm), otherTab = f.client(f.gm);
  f.client(f.viewer); f.client(f.viewer, { receiver: true });
  assert.deepEqual(await origin.transport.send(f.command()), { accepted: true });
  assert.equal(f.played.length, 1); assert.equal(otherTab.transport.pending.size, 0);
  assert.equal(f.packets.length, 2);
});

test("spoofed, unknown, wrongly addressed and malformed acknowledgments cannot resolve a command", async () => {
  const f = fixture(), game = f.client(f.gm), command = f.command();
  const pending = game.transport.send(command), rejected = assert.rejects(pending, /did not acknowledge.*OBS overlay source/);
  const ack = { type: "ack", gmId: f.gm.id, id: command.id, accepted: true };
  for (const sender of [undefined, f.gm.id, f.outsider.id]) game.deliver(ack, sender);
  game.deliver({ ...ack, gmId: "other-gm" }, f.viewer.id);
  game.deliver({ ...ack, id: "unknown" }, f.viewer.id);
  game.deliver({ ...ack, accepted: "true" }, f.viewer.id);
  game.deliver({ ...ack, actorData: {} }, f.viewer.id);
  game.deliver({ ...ack, reason: "x".repeat(301) }, f.viewer.id);
  assert.equal(game.transport.pending.size, 1);
  f.clock.tick(6000); await rejected;
  game.deliver(ack, f.viewer.id); assert.equal(game.transport.pending.size, 0);
});

test("a stale second OBS source cannot reject ahead of a healthy source", async () => {
  const f = fixture(), game = f.client(f.gm);
  f.client(f.viewer, { receiver: true, receive: async () => ({ accepted: false, reason: "old overlay" }) });
  f.client(f.viewer, { receiver: true });
  assert.deepEqual(await game.transport.send(f.command()), { accepted: true });
  assert.equal(f.packets.filter(entry => entry.payload.type === "ack").length, 2);
  assert.equal(f.timers.size, 0);
});

test("a renderer rejection is bounded and reported after the acknowledgment deadline", async () => {
  const f = fixture(), game = f.client(f.gm);
  f.client(f.viewer, { receiver: true, receive: async () => ({ accepted: false, reason: "wrong live overlay" }) });
  let settled = false;
  const pending = game.transport.send(f.command()).then(result => { settled = true; return result; });
  await flush(); assert.equal(settled, false);
  f.clock.tick(6000);
  assert.deepEqual(await pending, { accepted: false, reason: "wrong live overlay" });
  assert.equal(game.transport.pending.size, 0);
});

test("normal viewer sessions time out with actionable OBS guidance without retries or an offline queue", async () => {
  const f = fixture(), game = f.client(f.gm); f.client(f.viewer);
  const result = assert.rejects(game.transport.send(f.command()), /Open or refresh the configured OBS overlay source/);
  f.clock.tick(6000); await result;
  assert.equal(f.packets.length, 1); assert.equal(game.transport.pending.size, 0);
  f.client(f.viewer, { receiver: true }); await flush();
  assert.equal(f.played.length, 0); assert.equal(f.packets.length, 1);
});

test("stop, disconnect and world shutdown cancel commands, timers and only transport-owned listeners", async () => {
  for (const action of ["stop", "disconnect", "shutdown"]) {
    const f = fixture(), game = f.client(f.gm), existing = () => {};
    game.socket.on(SOCKET_NAME, existing);
    const rejected = assert.rejects(game.transport.send(f.command()), /closed|disconnected|shut down/);
    if (action === "stop") game.transport.stop(); else game[action]();
    await rejected;
    assert.equal(game.transport.pending.size, 0); assert.equal(f.timers.size, 0);
    assert.ok(game.listeners.get(SOCKET_NAME).has(existing));
    if (action !== "disconnect") assert.equal(game.listeners.get(SOCKET_NAME).size, 1);
    if (action === "shutdown") {
      assert.equal(game.transport.started, false);
      assert.equal(game.listeners.get("shutdown").size, 0);
    }
    game.transport.stop(); assert.equal(game.listeners.get(SOCKET_NAME).size, 1);
  }
});

test("concurrent duplicate commands execute once and seen IDs stay bounded", async () => {
  const f = fixture(); let finish;
  const stream = f.client(f.viewer, { receiver: true, receive: payload => {
    f.played.push(payload); return payload.id === "slow-command" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ accepted: true });
  } });
  const first = { type: "command", viewerId: f.viewer.id, command: f.command({ id: "slow-command" }) };
  stream.deliver(first, f.gm.id); stream.deliver(first, f.gm.id);
  assert.equal(f.played.length, 1);
  for (let index = 0; index < 270; index++) {
    stream.deliver({ ...first, command: f.command() }, f.gm.id); await flush();
  }
  assert.equal(stream.transport.seen.size, 256);
  stream.deliver(first, f.gm.id); assert.equal(f.played.length, 271, "in-flight IDs survive seen-cache eviction");
  finish({ accepted: true }); await flush(); assert.equal(stream.transport.inFlight.size, 0);
});

test("invalid, expired and excessive command metadata never reaches the stream renderer", async () => {
  const f = fixture(), game = f.client(f.gm), stream = f.client(f.viewer, { receiver: true });
  const invalid = [
    { actorData: { hp: 10 } }, { createdAt: 0, expiresAt: 1 }, { createdAt: 102001, expiresAt: 112001 },
    { expiresAt: 100000 }, { expiresAt: 116000 }, { id: "x".repeat(97) }, { kind: "eval" },
    { animation: { type: "shake", script: "alert(1)" } }, { animation: { type: "x".repeat(161) } },
    { animation: { type: "shake", duration: Infinity } }, { animation: { type: "shake", color: {} } }
  ];
  for (const extra of invalid) {
    const command = f.command(extra);
    await assert.rejects(game.transport.send(command), /metadata|timestamp|expired/);
    stream.deliver({ type: "command", viewerId: f.viewer.id, command }, f.gm.id);
  }
  await flush(); assert.equal(f.played.length, 0); assert.equal(f.packets.length, 0);
});

test("pending and in-flight limits bound memory even without acknowledgments", async () => {
  const f = fixture(), game = f.client(f.gm), waiting = [];
  for (let index = 0; index < 64; index++) waiting.push(assert.rejects(game.transport.send(f.command()), /did not acknowledge/));
  await assert.rejects(game.transport.send(f.command()), /Too many stream controls/);
  assert.equal(game.transport.pending.size, 64); assert.equal(f.timers.size, 64);
  f.clock.tick(6000); await Promise.all(waiting); assert.equal(game.transport.pending.size, 0);
  const stream = f.client(f.viewer, { receiver: true, receive: payload => { f.played.push(payload); return new Promise(() => {}); } });
  for (let index = 0; index < 20; index++) stream.deliver({ type: "command", viewerId: f.viewer.id, command: f.command() }, f.gm.id);
  assert.equal(f.played.length, 16); assert.equal(stream.transport.inFlight.size, 16);
  stream.transport.stop(); assert.equal(stream.transport.inFlight.size, 0);
});

test("authorization, offline state and unavailable sockets fail before emitting", async () => {
  const f = fixture(), player = f.client(f.viewer), game = f.client(f.gm);
  await assert.rejects(player.transport.send(f.command()), /Game Master/);
  f.viewer.id = ""; await assert.rejects(game.transport.send(f.command()), /Configure an overlay viewer/); f.viewer.id = "viewer";
  f.viewer.active = false; await assert.rejects(game.transport.send(f.command()), /offline/); f.viewer.active = true;
  game.socket.connected = false; await assert.rejects(game.transport.send(f.command()), /unavailable/);
  assert.equal(f.packets.length, 0);
});

test("receiver shutdown during asynchronous processing cannot emit a late acknowledgment", async () => {
  const f = fixture(); let finish;
  const stream = f.client(f.viewer, { receiver: true, receive: () => new Promise(resolve => { finish = resolve; }) });
  stream.deliver({ type: "command", viewerId: f.viewer.id, command: f.command() }, f.gm.id);
  stream.transport.stop(); finish({ accepted: true }); await flush();
  assert.equal(f.packets.length, 0); assert.equal(stream.transport.inFlight.size, 0);
});
