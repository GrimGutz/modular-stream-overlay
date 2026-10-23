import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { OP, DiscordVoice, discordConfigPath, encodeFrame, frameReader, ipcPaths, validateDiscordConfig } from "../tools/discord-voice.mjs";

const CLIENT_ID = "123456789012345678";
let pipes = 0;
const pipePath = () => process.platform === "win32" ? `\\\\.\\pipe\\mso-discord-test-${process.pid}-${pipes++}` : path.join(tmpdir(), `mso-discord-${process.pid}-${pipes++}.sock`);
const state = (id, name, voice = {}) => ({ voice_state: { mute: false, deaf: false, self_mute: false, self_deaf: false, suppress: false, ...voice }, user: { id, username: name, bot: false }, nick: null });
const channels = {
  table: { id: "200", guild_id: "100", name: "Table", type: 2, voice_states: [state("1", "gm"), state("2", "player", { self_mute: true })] },
  lobby: { id: "300", guild_id: "100", name: "Lobby", type: 2, voice_states: [state("3", "guest")] }
};

/** A stand-in Discord app: the IPC handshake, AUTHORIZE/AUTHENTICATE, voice commands and dispatches. */
async function fakeDiscord({ clientId = CLIENT_ID, token = "access-1" } = {}) {
  const file = pipePath(), commands = [], sockets = new Set();
  let client = null, selected = "table";
  const send = (op, data) => client?.write(encodeFrame(op, data));
  const server = createServer(socket => {
    client = socket;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.on("data", frameReader(({ op, data }) => {
      if (op === OP.HANDSHAKE) {
        if (data.client_id !== clientId) return send(OP.CLOSE, { code: 4000, message: "Invalid Client ID" });
        return send(OP.FRAME, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } });
      }
      if (op !== OP.FRAME) return;
      commands.push(data);
      const reply = value => send(OP.FRAME, { cmd: data.cmd, nonce: data.nonce, data: value });
      const fail = (code, message) => send(OP.FRAME, { cmd: data.cmd, nonce: data.nonce, evt: "ERROR", data: { code, message } });
      if (data.cmd === "AUTHORIZE") return reply({ code: "code-1" });
      if (data.cmd === "AUTHENTICATE") return data.args.access_token === token ? reply({ user: { id: "1", username: "gm" }, scopes: ["rpc", "rpc.voice.read"] }) : fail(4009, "Invalid access token");
      if (data.cmd === "GET_SELECTED_VOICE_CHANNEL") return reply(selected ? structuredClone(channels[selected]) : null);
      // Like Discord, replay a current voice state while the subscription is being set up.
      if (data.cmd === "SUBSCRIBE" && data.evt === "VOICE_STATE_UPDATE" && data.args.channel_id === "200") {
        send(OP.FRAME, { cmd: "DISPATCH", evt: "VOICE_STATE_UPDATE", data: { ...state("1", "gm"), nick: "GM" } });
      }
      if (data.cmd === "SUBSCRIBE" || data.cmd === "UNSUBSCRIBE") return reply({ evt: data.evt });
      fail(4002, "Invalid command");
    }));
  });
  await new Promise(resolve => server.listen(file, resolve));
  return {
    file, commands, server,
    dispatch: (evt, data) => send(OP.FRAME, { cmd: "DISPATCH", evt, data }),
    select(name) { selected = name; },
    open: () => sockets.size,
    close: () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); })
  };
}

function tokenEndpoint(calls) {
  return async (url, init) => {
    calls.push({ url, body: Object.fromEntries(new URLSearchParams(String(init.body))) });
    return { ok: true, status: 200, json: async () => ({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 604800, scope: "rpc rpc.voice.read" }) };
  };
}
const config = extra => ({ clientId: CLIENT_ID, clientSecret: "client-secret", ...extra });
const nextEvent = (emitter, name) => new Promise(resolve => emitter.once(name, resolve));

test("frames survive any chunking; settings and pipe names follow Discord's documentation", () => {
  const frames = [];
  const read = frameReader(frame => frames.push(frame));
  const bytes = Buffer.concat([encodeFrame(OP.FRAME, { cmd: "DISPATCH", evt: "READY" }), encodeFrame(OP.PING, { n: 1 })]);
  for (let at = 0; at < bytes.length; at += 5) read(bytes.subarray(at, at + 5));
  assert.deepEqual(frames, [{ op: OP.FRAME, data: { cmd: "DISPATCH", evt: "READY" } }, { op: OP.PING, data: { n: 1 } }]);
  assert.deepEqual(encodeFrame(OP.HANDSHAKE, { v: 1 }).subarray(0, 8), Buffer.from([0, 0, 0, 0, 7, 0, 0, 0]));
  assert.equal(ipcPaths("win32")[0], "\\\\?\\pipe\\discord-ipc-0");
  assert.equal(ipcPaths("linux", { XDG_RUNTIME_DIR: "/run/user/1000" })[9], path.join("/run/user/1000", "discord-ipc-9"));
  assert.equal(discordConfigPath({ APPDATA: "C:\\Users\\me\\AppData\\Roaming" }), path.join("C:\\Users\\me\\AppData\\Roaming", "modular-stream-overlay", "discord.json"));
  assert.deepEqual(validateDiscordConfig(config()), { clientId: CLIENT_ID, clientSecret: "client-secret", redirectUri: "http://localhost" });
  for (const bad of [{ clientId: "abc" }, { clientSecret: "" }, { redirectUri: "discord://x" }]) assert.throws(() => validateDiscordConfig(config(bad)));
});

test("first start asks Discord once, saves the token, and reports the channel, speaking and members", async () => {
  const discord = await fakeDiscord(), calls = [], saved = [];
  const voice = new DiscordVoice(config(), { paths: [discord.file], fetch: tokenEndpoint(calls), saveToken: async token => saved.push(token), now: () => 1000 });
  let prompted = false, early = 0;
  voice.on("authorizing", () => { prompted = true; });
  voice.on("member", () => { early++; });
  const firstChannel = nextEvent(voice, "channel");
  const auth = await voice.start();
  try {
    assert(prompted);
    assert.equal(early, 0, "Voice states replayed while subscribing are part of the first snapshot");
    voice.removeAllListeners("member");
    assert.deepEqual(auth.scopes, ["rpc", "rpc.voice.read"]);
    assert.deepEqual(discord.commands.find(entry => entry.cmd === "AUTHORIZE").args.scopes, ["rpc", "rpc.voice.read"]);
    assert.deepEqual(calls[0].body, { client_id: CLIENT_ID, client_secret: "client-secret", grant_type: "authorization_code", code: "code-1", redirect_uri: "http://localhost" });
    assert.deepEqual(saved, [{ accessToken: "access-1", refreshToken: "refresh-1", expiresAt: 1000 + 604800000, scope: "rpc rpc.voice.read" }]);
    const { channel, members } = await firstChannel;
    assert.deepEqual(channel, { id: "200", guildId: "100", name: "Table" });
    assert.deepEqual(members.map(entry => [entry.id, entry.name, entry.muted, entry.speaking]), [["1", "GM", false, false], ["2", "player", true, false]]);
    assert.deepEqual(discord.commands.filter(entry => entry.cmd === "SUBSCRIBE" && entry.args.channel_id === "200").map(entry => entry.evt),
      ["VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE", "SPEAKING_START", "SPEAKING_STOP"]);

    const speaking = nextEvent(voice, "speaking"), updated = nextEvent(voice, "update");
    discord.dispatch("SPEAKING_START", { user_id: "2", channel_id: "200" });
    assert.deepEqual(await speaking, { userId: "2", speaking: true, member: { id: "2", name: "player", bot: false, muted: true, deafened: false, speaking: true } });
    assert.deepEqual((await updated).members.map(entry => entry.speaking), [false, true], "Every change also comes as a whole snapshot");
    const stopped = nextEvent(voice, "speaking");
    discord.dispatch("SPEAKING_STOP", { user_id: "2" });
    assert.equal((await stopped).speaking, false);

    const joined = nextEvent(voice, "member");
    discord.dispatch("VOICE_STATE_CREATE", { ...state("4", "late"), nick: "Late Player" });
    assert.deepEqual([(await joined).type, (await joined).member.name], ["join", "Late Player"]);
    const left = nextEvent(voice, "member");
    discord.dispatch("VOICE_STATE_DELETE", state("1", "gm"));
    assert.deepEqual([(await left).type, (await left).member.id], ["leave", "1"]);
    assert.deepEqual(voice.snapshot().members.map(entry => entry.id), ["2", "4"]);
  } finally { voice.stop(); await discord.close(); }
});

test("a saved token skips the prompt; switching channels moves the subscriptions", async () => {
  const discord = await fakeDiscord(), calls = [];
  const voice = new DiscordVoice(config({ token: { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: 10 ** 13 } }),
    { paths: [discord.file], fetch: tokenEndpoint(calls), now: () => 1000 });
  await voice.start();
  try {
    assert.equal(discord.commands.some(entry => entry.cmd === "AUTHORIZE"), false);
    assert.equal(calls.length, 0);
    discord.select("lobby");
    const moved = nextEvent(voice, "channel");
    discord.dispatch("VOICE_CHANNEL_SELECT", { channel_id: "300", guild_id: "100" });
    const { channel, members } = await moved;
    assert.deepEqual([channel.name, members.map(entry => entry.name)], ["Lobby", ["guest"]]);
    assert.equal(discord.commands.filter(entry => entry.cmd === "UNSUBSCRIBE" && entry.args.channel_id === "200").length, 5);
    assert.equal(discord.commands.filter(entry => entry.cmd === "SUBSCRIBE" && entry.args.channel_id === "300").length, 5);
    discord.select(null);
    const out = nextEvent(voice, "channel");
    discord.dispatch("VOICE_CHANNEL_SELECT", { channel_id: null, guild_id: null });
    assert.deepEqual(await out, { channel: null, members: [] });
  } finally { voice.stop(); await discord.close(); }
});

test("an expired token is refreshed, a revoked one asks again, and failures explain themselves", async () => {
  const discord = await fakeDiscord(), calls = [];
  const expired = new DiscordVoice(config({ token: { accessToken: "old", refreshToken: "refresh-0", expiresAt: 500 } }), { paths: [discord.file], fetch: tokenEndpoint(calls), now: () => 1000 });
  await expired.start();
  expired.stop();
  assert.deepEqual([calls[0].body.grant_type, calls[0].body.refresh_token], ["refresh_token", "refresh-0"]);
  assert.equal(discord.commands.some(entry => entry.cmd === "AUTHORIZE"), false);
  const revoked = new DiscordVoice(config({ token: { accessToken: "revoked", refreshToken: "", expiresAt: 10 ** 13 } }), { paths: [discord.file], fetch: tokenEndpoint(calls), now: () => 1000 });
  await revoked.start();
  revoked.stop();
  assert.equal(discord.commands.filter(entry => entry.cmd === "AUTHORIZE").length, 1, "A rejected token falls back to the prompt");
  await discord.close();

  const wrongApp = await fakeDiscord({ clientId: "999999999999999999" });
  await assert.rejects(new DiscordVoice(config(), { paths: [wrongApp.file] }).start(), /refused the connection: Invalid Client ID/);
  await wrongApp.close();
  await assert.rejects(new DiscordVoice(config(), { paths: [pipePath()] }).start(), /Discord is not running/);
  const refusing = await fakeDiscord();
  const denied = async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "Invalid \"redirect_uri\" in request." }) });
  await assert.rejects(new DiscordVoice(config(), { paths: [refusing.file], fetch: denied }).start(), /token exchange: Invalid "redirect_uri"/);
  let tries = 0;
  const flaky = async (...request) => {
    if (++tries < 3) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    return tokenEndpoint([])(...request);
  };
  const retried = new DiscordVoice(config(), { paths: [refusing.file], fetch: flaky, retryDelays: [0, 0] });
  await retried.start();
  retried.stop();
  assert.equal(tries, 3, "Dropped token requests are tried again");
  const offline = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ETIMEDOUT" } }); };
  await assert.rejects(new DiscordVoice(config(), { paths: [refusing.file], fetch: offline, retryDelays: [0] }).start(), /Could not reach discord\.com .*\(ETIMEDOUT\)/);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(refusing.open(), 0, "A failed start leaves no connection open");
  await refusing.close();
});
