import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { setImmediate } from "node:timers/promises";
import { ObsConnector, CONNECTOR_HEADER } from "../tools/obs-connector.mjs";
import { DiscordError, VoiceFeed } from "../tools/discord-voice.mjs";
import { VOICE_PATH } from "../scripts/integration/voice.js";

const CONFIG = { clientId: "123456789012345678", clientSecret: "client-secret" };
const SNAPSHOT = { channel: { id: "200", guildId: "100", name: "Table" }, members: [{ id: "1", name: "gm", bot: false, muted: false, deafened: false, speaking: false }] };

class FakeVoice extends EventEmitter {
  constructor(config, options, failure) { super(); Object.assign(this, { config, options, failure, stopped: false }); }
  async start() {
    if (this.failure) throw this.failure;
    this.emit("channel", structuredClone(SNAPSHOT));
    return { user: { id: "1" }, scopes: ["rpc"] };
  }
  stop() { this.stopped = true; }
}

function feedFixture(failures = []) {
  const created = [], timers = [], logs = [];
  const feed = new VoiceFeed(CONFIG, {
    createVoice: (config, options) => { const voice = new FakeVoice(config, options, failures.shift()); created.push(voice); return voice; },
    log: message => logs.push(message), setTimer: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; }, clearTimer() {}
  });
  return { feed, created, timers, logs };
}

test("the feed keeps the channel current, reconnects after Discord closes and reuses the newest token", async () => {
  const { feed, created, timers } = feedFixture();
  const changes = [];
  feed.on("change", state => changes.push(state));
  await feed.start();
  assert.deepEqual(feed.state, { connected: true, ...SNAPSHOT });
  created[0].emit("update", { ...SNAPSHOT, members: [{ ...SNAPSHOT.members[0], speaking: true }] });
  assert.equal(feed.state.members[0].speaking, true);
  await created[0].options.saveToken({ accessToken: "access-2", refreshToken: "refresh-2", expiresAt: 1, scope: "rpc" });
  created[0].emit("close", { code: "closed" });
  assert.deepEqual(feed.state, { connected: false, channel: null, members: [] });
  assert.equal(timers.length, 1);
  timers[0].callback();
  await setImmediate();
  assert.equal(created.length, 2);
  assert.equal(created[1].config.token.accessToken, "access-2", "A reconnection does not ask Discord again");
  created[0].emit("update", { ...SNAPSHOT, members: [] });
  assert.equal(feed.state.members.length, 1, "The closed connection no longer reports");
  assert(changes.length >= 4);
  feed.stop();
  assert.equal(created[1].stopped, true);
});

test("the feed retries while Discord is not running and stops on errors the streamer must fix", async () => {
  const waiting = feedFixture([new DiscordError("Discord is not running on this PC.", "not-running")]);
  await waiting.feed.start();
  assert.deepEqual([waiting.timers.length, waiting.feed.state.connected], [1, false]);
  waiting.timers[0].callback();
  await setImmediate();
  assert.equal(waiting.feed.state.connected, true, "It connects once Discord starts");
  waiting.feed.stop();
  const refused = feedFixture([new DiscordError("AUTHORIZE: User denied access", 5000)]);
  await refused.feed.start();
  assert.equal(refused.timers.length, 0, "A refused authorization is not repeated over and over");
  assert.match(refused.logs.at(-1), /Discord voice stopped: AUTHORIZE: User denied access .*discord-test/);
});

async function connectorFixture(t, voice) {
  const connector = new ObsConnector({ foundryUrl: "http://127.0.0.1:1", userName: "OBS Overlay", password: "secret", port: 30105 }, { log: () => {}, voice });
  const server = await new Promise(resolve => { const value = createServer((request, response) => void connector.handleRequest(request, response)); value.listen(0, "127.0.0.1", () => resolve(value)); });
  t.after(() => server.close());
  const port = server.address().port;
  connector.allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  return { connector, base: `http://127.0.0.1:${port}` };
}

test("the connector streams the voice state to the stream page and nowhere else", async t => {
  const voice = Object.assign(new EventEmitter(), { state: { connected: true, ...SNAPSHOT } });
  const { base } = await connectorFixture(t, voice);
  const probe = await fetch(`${base}${VOICE_PATH}`, { method: "HEAD" });
  assert.deepEqual([probe.status, probe.headers.get(CONNECTOR_HEADER), probe.headers.get("content-type")], [200, "1", "text/event-stream; charset=utf-8"]);
  const controller = new AbortController();
  const response = await fetch(`${base}${VOICE_PATH}`, { signal: controller.signal });
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = "";
  const until = async pattern => { while (!pattern.test(text)) text += decoder.decode((await reader.read()).value); };
  await until(/\n\n/);
  assert.deepEqual(JSON.parse(text.match(/^data: (.*)$/m)[1]), voice.state);
  voice.state = { connected: true, ...SNAPSHOT, members: [{ ...SNAPSHOT.members[0], speaking: true }] };
  voice.emit("change", voice.state);
  await until(/"speaking":true/);
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(voice.listenerCount("change"), 0, "A closed page stops listening");
  const foreign = await fetch(`${base}${VOICE_PATH}`, { headers: { Origin: "https://evil.example" } });
  assert.equal(foreign.status, 403);
  await foreign.body?.cancel();
});

test("without Discord voice the connector answers 404, so the stream page stops asking", async t => {
  const { base } = await connectorFixture(t, null);
  const response = await fetch(`${base}${VOICE_PATH}`, { method: "HEAD" });
  assert.deepEqual([response.status, response.headers.get(CONNECTOR_HEADER)], [404, "1"]);
});

test("Foundry's own pages on this PC may read the voice feed; other sites may not", async t => {
  const voice = Object.assign(new EventEmitter(), { state: { connected: true, ...SNAPSHOT } });
  const connector = new ObsConnector({ foundryUrl: "http://localhost:30000", userName: "OBS Overlay", password: "secret", port: 30106 }, { log: () => {}, voice });
  const server = await new Promise(resolve => { const value = createServer((request, response) => void connector.handleRequest(request, response)); value.listen(0, "127.0.0.1", () => resolve(value)); });
  t.after(() => server.close());
  const port = server.address().port;
  connector.allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  for (const origin of ["http://localhost:30000", "http://127.0.0.1:30000"]) {
    const response = await fetch(`http://127.0.0.1:${port}${VOICE_PATH}`, { method: "HEAD", headers: { Origin: origin } });
    assert.deepEqual([response.status, response.headers.get("access-control-allow-origin"), response.headers.get("access-control-expose-headers")], [200, origin, CONNECTOR_HEADER], origin);
  }
  for (const origin of ["http://localhost:30002", "https://evil.example"]) {
    const response = await fetch(`http://127.0.0.1:${port}${VOICE_PATH}`, { method: "HEAD", headers: { Origin: origin } });
    assert.deepEqual([response.status, response.headers.get("access-control-allow-origin")], [403, null], origin);
  }
  connector.voice = null;
  const missing = await fetch(`http://127.0.0.1:${port}${VOICE_PATH}`, { method: "HEAD", headers: { Origin: "http://localhost:30000" } });
  assert.deepEqual([missing.status, missing.headers.get("access-control-allow-origin")], [404, "http://localhost:30000"], "The editor learns that voice is not set up and stops asking");
});
