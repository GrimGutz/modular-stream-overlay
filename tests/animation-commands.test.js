import test from "node:test";
import assert from "node:assert/strict";
import { AnimationCommands } from "../scripts/animation/commands.js";
import { createOverlay, createState } from "../scripts/core/schema.js";
import { createLayer } from "../scripts/core/layers.js";

function fixture() {
  const state = createState(), overlay = createOverlay(), target = createLayer("image", overlay.canvas);
  overlay.layers.push(target); state.overlays.push(overlay); state.activeOverlayId = overlay.id;
  const gm = { id: "gm", role: 4, isGM: true };
  const viewer = { id: "viewer", role: 1, isGM: false, active: true };
  let time = 100000, localUser = viewer, receiver = true, ready = true, sequence = 0;
  const played = [], sent = [];
  const commands = new AnimationCommands({ getState: () => state, getUser: () => localUser, getViewer: () => viewer,
    isReceiver: () => receiver, getRenderer: () => ready ? { handleAnimationCommand: command => { played.push(command); return true; } } : null,
    send: async command => { sent.push(command); return { accepted: true }; },
    now: () => time, createId: () => `command-${++sequence}` });
  const command = extra => ({ id: `event-${++sequence}`, overlayId: overlay.id, layerId: target.id,
    createdAt: time, expiresAt: time + 10000, kind: "play", ...extra });
  return { state, overlay, target, gm, viewer, played, sent, commands, command,
    setTime(value) { time = value; }, setUser(value) { localUser = value; }, setReceiver(value) { receiver = value; }, setReady(value) { ready = value; } };
}

test("GM publishes metadata-only commands through the injected transport with no saved-state or Actor writes", async () => {
  const f = fixture(); f.setUser(f.gm);
  const before = structuredClone(f.state);
  assert.deepEqual(await f.commands.publish(f.target.id, { kind: "play", animation: { type: "shake", duration: 400 } }), { accepted: true });
  assert.equal(f.sent.length, 1);
  const payload = f.sent[0];
  assert.equal(payload.createdAt, 100000); assert.equal(payload.expiresAt, 110000);
  assert.equal(payload.overlayId, f.overlay.id); assert.equal(payload.layerId, f.target.id);
  assert.equal(payload.animation.type, "shake"); assert.equal(payload.animation.repeat, 1);
  assert.deepEqual(Object.keys(payload).sort(), ["animation", "createdAt", "expiresAt", "id", "kind", "layerId", "overlayId"].sort());
  assert.deepEqual(f.state, before); assert.equal(f.played.length, 0, "GM publishing does not run preview effects");
});

test("Players cannot publish and an embedded sender cannot impersonate Foundry's authenticated GM context", async () => {
  const f = fixture();
  await assert.rejects(f.commands.publish(f.target.id), /Game Master/);
  assert.equal(f.sent.length, 0);
  const result = await f.commands.receive(f.command({ sender: f.gm }), { user: f.viewer });
  assert.equal(result.accepted, false); assert.match(result.reason, /authenticated Game Master/);
  assert.equal((await f.commands.receive(f.command(), { user: f.gm })).accepted, true);
  assert.equal(f.played.length, 1);
});

test("only the configured Player's active overlay receiver accepts commands", async () => {
  const f = fixture();
  f.setUser(f.gm);
  assert.equal((await f.commands.receive(f.command(), { user: f.gm })).accepted, false);
  f.setUser({ id: "different-player", role: 1, isGM: false });
  assert.equal((await f.commands.receive(f.command(), { user: f.gm })).accepted, false);
  f.setUser(f.viewer); f.setReceiver(false);
  assert.equal((await f.commands.receive(f.command(), { user: f.gm })).accepted, false);
  f.setReceiver(true); f.viewer.role = 2;
  assert.equal((await f.commands.receive(f.command(), { user: f.gm })).accepted, false);
  assert.equal(f.played.length, 0);
});

test("offline and unavailable receivers produce clear errors without queuing or retrying commands", async () => {
  const f = fixture(); f.setUser(f.gm);
  f.viewer.active = false;
  await assert.rejects(f.commands.publish(f.target.id), /offline/); assert.equal(f.sent.length, 0);
  f.viewer.active = true; delete f.commands.send;
  await assert.rejects(f.commands.publish(f.target.id), /transport is unavailable/);
  f.commands.send = async command => { f.sent.push(command); throw Error("Overlay acknowledgement timed out"); };
  await assert.rejects(f.commands.publish(f.target.id), /timed out/); assert.equal(f.sent.length, 1);
  f.commands.send = async () => ({ accepted: false, reason: "wrong overlay" });
  await assert.rejects(f.commands.publish(f.target.id), /wrong overlay/);
  assert.equal(f.played.length, 0); assert.equal(f.commands.eventIds.size, 0);
});

test("expired, excessively future, negative-life and oversized TTL commands never play", async () => {
  const f = fixture();
  for (const timestamps of [
    { createdAt: 89000, expiresAt: 99000 }, { createdAt: 102001, expiresAt: 112001 },
    { createdAt: 100000, expiresAt: 100000 }, { createdAt: 100000, expiresAt: 116000 },
    { createdAt: NaN, expiresAt: 110000 }, { createdAt: 100000, expiresAt: Infinity }
  ]) {
    const result = await f.commands.receive(f.command(timestamps), { user: f.gm });
    assert.equal(result.accepted, false); assert.match(result.reason, /timestamp|expired/);
  }
  assert.equal(f.played.length, 0); assert.equal(f.commands.eventIds.size, 0);
  assert.equal((await f.commands.receive(f.command({ createdAt: 102000, expiresAt: 112000 }), { user: f.gm })).accepted, true);
});

test("deduplication reserves IDs before asynchronous playback and bounds its cache", async () => {
  const f = fixture();
  const duplicate = f.command();
  assert.equal((await f.commands.receive(duplicate, { user: f.gm })).accepted, true);
  const second = await f.commands.receive(duplicate, { user: f.gm });
  assert.equal(second.accepted, false); assert.match(second.reason, /already received/);
  for (let i = 0; i < 260; i++) await f.commands.receive(f.command(), { user: f.gm });
  assert.equal(f.commands.eventIds.size, 256); assert.equal(f.played.length, 261);
  f.setTime(120000);
  assert.equal((await f.commands.receive(duplicate, { user: f.gm })).accepted, false, "An evicted old ID is still expired");
});

test("concurrent duplicates cannot begin another effect while the first command awaits playback", async () => {
  const f = fixture();
  let finish, starts = 0;
  f.commands.getRenderer = () => ({ handleAnimationCommand() { starts++; return new Promise(resolve => { finish = resolve; }); } });
  const command = f.command();
  const pending = f.commands.receive(command, { user: f.gm });
  assert.equal(starts, 1);
  assert.equal((await f.commands.receive(command, { user: f.gm })).accepted, false);
  assert.equal(starts, 1);
  finish(true); assert.deepEqual(await pending, { accepted: true });
});

test("command targets must be on the current saved active overlay; hidden layers remain addressable", async () => {
  const f = fixture();
  f.target.visible = false;
  assert.equal((await f.commands.receive(f.command({ kind: "reset" }), { user: f.gm })).accepted, true);
  assert.equal((await f.commands.receive(f.command({ layerId: "missing" }), { user: f.gm })).accepted, false);
  assert.equal((await f.commands.receive(f.command({ overlayId: "different-overlay" }), { user: f.gm })).accepted, false);
  const old = f.command(); f.state.activeOverlayId = null;
  assert.equal((await f.commands.receive(old, { user: f.gm })).accepted, false);
  f.setUser(f.gm); await assert.rejects(f.commands.publish(f.target.id), /current live overlay/);
});

test("strict schemas reject unknown fields, unsafe IDs, incompatible commands and Actor data", async () => {
  const f = fixture();
  for (const extra of [
    { actor: { system: { hp: 50 } } }, { sender: f.gm }, { id: "invalid event id" },
    { kind: "execute" }, { kind: "event" }, { kind: "reset", animation: { type: "pulse" } },
    { kind: "play", animation: { type: "pulse", actorValues: { hp: 50 } } },
    { kind: "play", animation: { type: "pulse", repeat: 100 } }, { kind: "play", ruleId: "manual-rule" },
    { kind: "event", eventType: "arbitrary code()" }
  ]) assert.equal((await f.commands.receive(f.command(extra), { user: f.gm })).accepted, false);
  f.setUser(f.gm);
  await assert.rejects(f.commands.publish(f.target.id, { kind: "play", actor: {} }), /unsupported/);
  assert.equal(f.played.length, 0); assert.equal(f.sent.length, 0);
});

test("manual rules, named extension events and resets use semantic metadata without replay history", async () => {
  const f = fixture();
  for (const extra of [{ kind: "manual", ruleId: "damage-button" }, { kind: "event", eventType: "extension:celebrate" }, { kind: "reset" }]) {
    assert.equal((await f.commands.receive(f.command(extra), { user: f.gm })).accepted, true);
  }
  assert.deepEqual(f.played.map(command => command.kind), ["manual", "event", "reset"]);
  assert.equal(f.played[0].ruleId, "damage-button"); assert.equal(f.played[1].eventType, "extension:celebrate");
  const restarted = new AnimationCommands({ getState: () => f.state });
  assert.equal(restarted.eventIds.size, 0, "No past command list is restored on reload");
});

test("unready and failing renderers fail cleanly and do not replay partially handled commands", async () => {
  const f = fixture(); f.setReady(false);
  assert.match((await f.commands.receive(f.command(), { user: f.gm })).reason, /not ready/);
  f.commands.getRenderer = () => ({ handleAnimationCommand() { throw Error("removed target"); } });
  const command = f.command();
  assert.match((await f.commands.receive(command, { user: f.gm })).reason, /removed target/);
  assert.match((await f.commands.receive(command, { user: f.gm })).reason, /already received/);
});

test("page commands use bounded semantic actions and never accept Actor data or incompatible payloads", async () => {
  const f = fixture();
  for (const action of ["next", "previous", "pause", "resume", "select"]) {
    const command = f.command({ kind: "carousel", action, ...(action === "select" ? { pageId: "resources" } : {}) });
    assert.equal((await f.commands.receive(command, { user: f.gm })).accepted, true);
  }
  for (const extra of [
    { kind: "carousel" }, { kind: "carousel", action: "execute" }, { kind: "carousel", action: "select" },
    { kind: "carousel", action: "select", pageId: "unsafe page id" }, { kind: "carousel", action: "pause", pageId: "resources" },
    { kind: "carousel", action: "next", actorUuid: "Actor.secret" }, { kind: "carousel", action: "next", animation: { type: "pulse" } },
    { kind: "play", action: "pause" }, { kind: "reset", pageId: "resources" }
  ]) assert.equal((await f.commands.receive(f.command(extra), { user: f.gm })).accepted, false);
  f.setUser(f.gm);
  await f.commands.publish(f.target.id, { kind: "carousel", action: "select", pageId: "resources" });
  assert.equal(f.sent[0].pageId, "resources"); assert.equal(f.sent[0].kind, "carousel");
  assert.equal(f.played.length, 5);
});

test("character selection and sequence reset permit only semantic UUID metadata", async () => {
  const f = fixture();
  for (const extra of [{ action: "reset" }, { action: "select-actor", actorUuid: "Actor.alpha" },
    { action: "select", pageId: "resources", actorUuid: "Actor.bravo" }]) {
    assert.equal((await f.commands.receive(f.command({ kind: "carousel", ...extra }), { user: f.gm })).accepted, true);
  }
  for (const extra of [{ action: "select-actor" }, { action: "select-actor", actorUuid: "Actor.alpha bad" },
    { action: "select-actor", actorUuid: { uuid: "Actor.alpha" } }, { action: "select-actor", actorUuid: "Actor.alpha", values: { hp: 10 } },
    { action: "reset", actorUuid: "Actor.alpha" }, { action: "select-actor", actorUuid: "Actor.alpha", pageId: "resources" }]) {
    assert.equal((await f.commands.receive(f.command({ kind: "carousel", ...extra }), { user: f.gm })).accepted, false);
  }
  assert.equal(f.played.length, 3);
});

test("animation test command metadata stays authenticated and synthetic actions cannot target real Actors", async () => {
  const f = fixture(); f.setUser(f.gm);
  for (const kind of ["entrance", "exit"]) await f.commands.publish(f.target.id, { kind });
  for (const action of ["next-page", "previous-page", "next-actor", "previous-actor"]) await f.commands.publish(f.target.id, { kind: "carousel", action });
  await assert.rejects(f.commands.publish(f.target.id, { kind: "demo", action: "damage" }), /DEMO DATA/);
  Object.assign(f.target, { type: "character-widget", presetId: "demo-card", dataSource: "demo", actorUuid: "Demo.warrior", actorUuids: ["Demo.warrior", "Demo.mage"] });
  await f.commands.publish(f.target.id, { kind: "demo", action: "damage" });
  await f.commands.publish(f.target.id, { kind: "carousel", action: "select-actor", actorUuid: "Demo.mage" });
  f.setUser(f.viewer);
  assert.equal((await f.commands.receive(f.command({ kind: "demo", action: "healing" }), { user: f.gm })).accepted, true);
  assert.equal((await f.commands.receive(f.command({ kind: "demo", action: "heal-real-actor" }), { user: f.gm })).accepted, false);
  f.target.dataSource = "actors"; f.target.actorUuid = "Actor.real"; f.target.actorUuids = ["Actor.real"];
  assert.equal((await f.commands.receive(f.command({ kind: "demo", action: "damage" }), { user: f.gm })).accepted, false);
});
