/**
 * Optional Discord voice watcher for the OBS connector. It talks to the Discord app running on
 * the same PC over its local IPC pipe (the channel StreamKit uses as well), authorized once
 * through the streamer's own Discord application, and reports who is in the current voice
 * channel and who is speaking. The client secret and tokens stay in a local settings file
 * outside Foundry's Data folder; nothing here prints them or sends them anywhere but Discord.
 */
import { connect as netConnect } from "node:net";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

export const OP = Object.freeze({ HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 });
export const SCOPES = Object.freeze(["rpc", "rpc.voice.read"]);
export const DEFAULT_REDIRECT = "http://localhost";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const CHANNEL_EVENTS = Object.freeze(["VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE", "SPEAKING_START", "SPEAKING_STOP"]);
// The authorization waits for the streamer to answer Discord's prompt.
const REQUEST_TIMEOUT = 15000, AUTHORIZE_TIMEOUT = 5 * 60000, REFRESH_MARGIN = 60000;
const RETRY_DELAYS = Object.freeze([1000, 3000]);

export class DiscordError extends Error {
  constructor(message, code = null) { super(message); this.name = "DiscordError"; this.code = code; }
}

export function discordConfigPath(env = process.env) {
  const base = env.APPDATA || path.join(homedir(), ".config");
  return path.join(base, "modular-stream-overlay", "discord.json");
}

/** Discord's pipe names in the order it opens them; the first free number wins. */
export function ipcPaths(platform = process.platform, env = process.env) {
  const names = Array.from({ length: 10 }, (_, n) => `discord-ipc-${n}`);
  if (platform === "win32") return names.map(name => `\\\\?\\pipe\\${name}`);
  const base = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || "/tmp";
  return names.map(name => path.join(base, name));
}

/** Normalized settings; `token` is kept only when it is complete. */
export function validateDiscordConfig(input) {
  if (!input || typeof input !== "object") throw new TypeError("The Discord settings must be a JSON object.");
  const clientId = String(input.clientId ?? "").trim();
  if (!/^\d{15,25}$/.test(clientId)) throw new TypeError("Enter the Client ID from the Discord application's OAuth2 page (digits only).");
  const clientSecret = typeof input.clientSecret === "string" ? input.clientSecret.trim() : "";
  if (!clientSecret) throw new TypeError("Enter the Client Secret from the Discord application's OAuth2 page.");
  const redirect = new URL(input.redirectUri || DEFAULT_REDIRECT);
  if (!["http:", "https:"].includes(redirect.protocol)) throw new TypeError("Use an http(s) redirect, such as http://localhost.");
  const config = { clientId, clientSecret, redirectUri: String(input.redirectUri || DEFAULT_REDIRECT) };
  const token = input.token;
  if (token && typeof token.accessToken === "string" && token.accessToken && Number.isFinite(token.expiresAt)) {
    config.token = { accessToken: token.accessToken, refreshToken: typeof token.refreshToken === "string" ? token.refreshToken : "",
      expiresAt: token.expiresAt, scope: typeof token.scope === "string" ? token.scope : "" };
  }
  return config;
}

export function encodeFrame(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** Splits the pipe's byte stream into `{ op, data }` frames, however the chunks are cut. */
export function frameReader(onFrame) {
  let buffer = Buffer.alloc(0);
  return chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 8) {
      const op = buffer.readInt32LE(0), length = buffer.readInt32LE(4);
      if (buffer.length < 8 + length) break;
      const body = buffer.subarray(8, 8 + length).toString("utf8");
      buffer = buffer.subarray(8 + length);
      let data = null;
      try { data = JSON.parse(body); } catch { /* A broken frame carries nothing. */ }
      onFrame({ op, data });
    }
  };
}

/** One RPC connection to the local Discord app: handshake, commands with nonces, dispatched events. */
export class DiscordIpc extends EventEmitter {
  constructor({ clientId, paths = ipcPaths(), connect = netConnect, timeout = REQUEST_TIMEOUT } = {}) {
    super();
    Object.assign(this, { clientId, paths, connectTo: connect, timeout });
    this.socket = null;
    this.pending = new Map();
  }

  /** Resolves with Discord's READY data; tries each pipe until one answers. */
  async connect() {
    let refused = null;
    for (const file of this.paths) {
      try { return await this.#open(file); }
      catch (error) {
        if (error instanceof DiscordError) throw error;
        refused = error;
      }
    }
    throw new DiscordError(`Discord is not running on this PC (${refused?.code ?? "no IPC pipe"}). Start the Discord app and try again.`, "not-running");
  }

  #open(file) {
    return new Promise((resolve, reject) => {
      const socket = this.connectTo(file);
      let ready = false, settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(error);
      };
      socket.on("error", error => (ready ? this.#closed({ code: error.code ?? "error", message: error.message }) : fail(error)));
      socket.once("connect", () => socket.write(encodeFrame(OP.HANDSHAKE, { v: 1, client_id: this.clientId })));
      socket.on("data", frameReader(frame => {
        if (ready) return this.#handle(frame);
        if (frame.op === OP.FRAME && frame.data?.cmd === "DISPATCH" && frame.data.evt === "READY") {
          ready = settled = true;
          this.socket = socket;
          resolve(frame.data.data ?? {});
        } else if (frame.op === OP.CLOSE) {
          fail(new DiscordError(`Discord refused the connection: ${frame.data?.message ?? "no reason given"}.`, frame.data?.code ?? "closed"));
        }
      }));
      socket.on("close", () => {
        if (ready) this.#closed({ code: "closed", message: "" });
        else fail(new DiscordError("Discord closed the connection during the handshake.", "closed"));
      });
    });
  }

  #handle({ op, data }) {
    if (op === OP.PING) return this.socket?.write(encodeFrame(OP.PONG, data ?? {}));
    if (op === OP.CLOSE) {
      this.#closed({ code: data?.code ?? "closed", message: data?.message ?? "" });
      return this.socket?.destroy();
    }
    if (op !== OP.FRAME || !data) return;
    const waiting = data.nonce ? this.pending.get(data.nonce) : null;
    if (waiting) {
      this.pending.delete(data.nonce);
      if (data.evt === "ERROR") waiting.reject(new DiscordError(`${data.cmd}: ${data.data?.message ?? "error"}`, data.data?.code ?? null));
      else waiting.resolve(data.data ?? null);
    } else if (data.cmd === "DISPATCH" && data.evt) this.emit("event", data.evt, data.data ?? {});
  }

  #closed(info) {
    if (!this.socket) return;
    this.socket = null;
    for (const { reject } of this.pending.values()) reject(new DiscordError("Discord closed the connection.", "closed"));
    this.pending.clear();
    this.emit("close", info);
  }

  request(cmd, args = {}, evt, { timeout = this.timeout } = {}) {
    if (!this.socket) return Promise.reject(new DiscordError("Not connected to Discord.", "closed"));
    const nonce = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new DiscordError(`Discord did not answer ${cmd} in time.`, "timeout"));
      }, timeout);
      this.pending.set(nonce, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      this.socket.write(encodeFrame(OP.FRAME, { cmd, args, evt, nonce }));
    });
  }

  close() {
    const socket = this.socket;
    if (!socket) return;
    try { socket.write(encodeFrame(OP.CLOSE, {})); } catch { /* Already gone. */ }
    // Windows pipes do not pass a half close on, so the handle is released once the frame is out.
    socket.end(() => socket.destroy());
    this.#closed({ code: "closed", message: "" });
  }
}

function member(state) {
  const user = state.user ?? {}, voice = state.voice_state ?? {};
  return {
    id: String(user.id ?? ""), name: state.nick || user.global_name || user.username || String(user.id ?? ""), bot: Boolean(user.bot),
    muted: Boolean(voice.mute || voice.self_mute || voice.suppress), deafened: Boolean(voice.deaf || voice.self_deaf), speaking: false
  };
}

/**
 * Who is in the streamer's current voice channel and who is speaking. Follows the streamer
 * between channels. Events: "authorizing" (Discord shows its prompt), "channel" (a snapshot
 * after joining, leaving or switching), "member" ({ type: join|update|leave, member }),
 * "speaking" ({ userId, speaking, member }) and "close" (the Discord app went away).
 */
export class DiscordVoice extends EventEmitter {
  constructor(config, { fetch = globalThis.fetch, createIpc = options => new DiscordIpc(options), paths, saveToken = async () => {}, now = () => Date.now(), retryDelays = RETRY_DELAYS } = {}) {
    super();
    this.config = validateDiscordConfig(config);
    Object.assign(this, { fetch, createIpc, paths, saveToken, now, retryDelays });
    this.ipc = null;
    this.channel = null;
    this.members = new Map();
    this.settling = false;
    this.queue = Promise.resolve();
  }

  async start() {
    this.ipc = this.createIpc({ clientId: this.config.clientId, ...(this.paths ? { paths: this.paths } : {}) });
    this.ipc.on("event", (evt, data) => this.#dispatch(evt, data));
    this.ipc.on("close", info => this.emit("close", info));
    try {
      await this.ipc.connect();
      const auth = await this.#authenticate();
      await this.ipc.request("SUBSCRIBE", {}, "VOICE_CHANNEL_SELECT");
      await this.#serial(async () => this.#watch(await this.ipc.request("GET_SELECTED_VOICE_CHANNEL")));
      return { user: auth?.user ?? null, scopes: auth?.scopes ?? [] };
    } catch (error) {
      // A failed start closes quietly; the caller reports the error itself.
      this.ipc.removeAllListeners();
      this.ipc.close();
      throw error;
    }
  }

  stop() { this.ipc?.close(); }

  snapshot() {
    return { channel: this.channel ? { ...this.channel } : null, members: [...this.members.values()].map(entry => ({ ...entry })) };
  }

  async #authenticate() {
    let token = this.config.token ?? null;
    if (token && token.expiresAt - REFRESH_MARGIN < this.now()) {
      token = token.refreshToken ? await this.#exchange({ grant_type: "refresh_token", refresh_token: token.refreshToken }).catch(() => null) : null;
    }
    if (token) {
      try { return await this.ipc.request("AUTHENTICATE", { access_token: token.accessToken }); }
      catch (error) { if (!Number.isInteger(error.code)) throw error; } // A revoked token: ask again.
    }
    this.emit("authorizing");
    const { code } = await this.ipc.request("AUTHORIZE", { client_id: this.config.clientId, scopes: [...SCOPES] }, undefined, { timeout: AUTHORIZE_TIMEOUT }) ?? {};
    if (!code) throw new DiscordError("Discord returned no authorization code.", "oauth");
    token = await this.#exchange({ grant_type: "authorization_code", code, redirect_uri: this.config.redirectUri });
    return this.ipc.request("AUTHENTICATE", { access_token: token.accessToken });
  }

  async #exchange(params) {
    const body = new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, ...params });
    let response;
    // An authorization code lives for minutes, so a dropped connection is worth a few more tries.
    for (let attempt = 0; !response; attempt++) {
      try { response = await this.fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }); }
      catch (error) {
        if (attempt >= this.retryDelays.length) {
          const cause = error.cause?.code || error.cause?.message || error.message;
          throw new DiscordError(`Could not reach discord.com to finish the authorization (${cause}). Check that this PC can open discord.com, then try again.`, "network");
        }
        await new Promise(resolve => setTimeout(resolve, this.retryDelays[attempt]));
      }
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.access_token !== "string") {
      throw new DiscordError(`Discord refused the token exchange: ${data.error_description || data.error || `HTTP ${response.status}`}.`, "oauth");
    }
    const token = { accessToken: data.access_token, refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : "",
      expiresAt: this.now() + (Number(data.expires_in) || 604800) * 1000, scope: typeof data.scope === "string" ? data.scope : "" };
    this.config.token = token;
    await this.saveToken(token);
    return token;
  }

  /** Channel switches run one after another so subscriptions never cross. */
  #serial(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(error => this.emit("problem", error));
    return run;
  }

  async #watch(channel) {
    const previous = this.channel;
    if (previous) {
      for (const evt of CHANNEL_EVENTS) await this.ipc.request("UNSUBSCRIBE", { channel_id: previous.id }, evt).catch(() => {});
    }
    this.channel = channel?.id ? { id: String(channel.id), guildId: channel.guild_id ? String(channel.guild_id) : null, name: channel.name ?? "" } : null;
    this.members = new Map((this.channel ? channel.voice_states ?? [] : []).map(state => member(state)).filter(entry => entry.id).map(entry => [entry.id, entry]));
    // Discord replays current voice states while subscribing; they belong to the snapshot.
    this.settling = true;
    try {
      if (this.channel) {
        for (const evt of CHANNEL_EVENTS) await this.ipc.request("SUBSCRIBE", { channel_id: this.channel.id }, evt);
      }
    } finally { this.settling = false; }
    this.emit("channel", this.snapshot());
  }

  #dispatch(evt, data) {
    this.#route(evt, data);
    if (evt === "SPEAKING_START" || evt === "SPEAKING_STOP" || evt.startsWith("VOICE_STATE_")) this.emit("update", this.snapshot());
  }

  #route(evt, data) {
    if (evt === "VOICE_CHANNEL_SELECT") {
      if ((data.channel_id ?? null) === (this.channel?.id ?? null)) return;
      void this.#serial(async () => this.#watch(data.channel_id ? await this.ipc.request("GET_SELECTED_VOICE_CHANNEL") : null)).catch(() => {});
    } else if (evt === "VOICE_STATE_CREATE" || evt === "VOICE_STATE_UPDATE") {
      const next = member(data);
      if (!next.id) return;
      const known = this.members.get(next.id);
      this.members.set(next.id, { ...next, speaking: known?.speaking ?? false });
      if (!this.settling) this.emit("member", { type: known ? "update" : "join", member: { ...this.members.get(next.id) } });
    } else if (evt === "VOICE_STATE_DELETE") {
      const gone = member(data);
      const known = this.members.get(gone.id);
      this.members.delete(gone.id);
      if (!this.settling) this.emit("member", { type: "leave", member: { ...(known ?? gone), speaking: false } });
    } else if (evt === "SPEAKING_START" || evt === "SPEAKING_STOP") {
      const userId = String(data.user_id ?? "");
      if (!userId) return;
      const speaking = evt === "SPEAKING_START";
      const known = this.members.get(userId) ?? { id: userId, name: userId, bot: false, muted: false, deafened: false, speaking: false };
      if (known.speaking === speaking && this.members.has(userId)) return;
      this.members.set(userId, { ...known, speaking });
      this.emit("speaking", { userId, speaking, member: { ...this.members.get(userId) } });
    }
  }
}

// Discord not running, closed or briefly unreachable: try again. Anything else (a refused
// authorization, a wrong Client ID) needs the streamer, so the feed stops and says so.
const RETRYABLE = new Set(["not-running", "closed", "timeout", "network"]);

/**
 * The connector's live voice state, kept while it runs: `state` is always current and "change"
 * fires on every update. Discord may start later or restart; the feed reconnects by itself.
 */
export class VoiceFeed extends EventEmitter {
  constructor(config, { createVoice = (settings, options) => new DiscordVoice(settings, options), saveToken = async () => {}, log = () => {}, retryAfter = 15000,
    setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = timer => clearTimeout(timer) } = {}) {
    super();
    Object.assign(this, { config, createVoice, saveToken, log, retryAfter, setTimer, clearTimer });
    this.state = { connected: false, channel: null, members: [] };
    this.voice = null;
    this.timer = null;
    this.stopped = false;
  }

  #set(state) {
    this.state = state;
    this.emit("change", state);
  }

  async start() {
    if (this.stopped) return;
    let voice;
    // A reconnection uses the newest token, so Discord does not ask again.
    const saveToken = async token => { this.config = { ...this.config, token }; await this.saveToken(token); };
    try { voice = this.voice = this.createVoice(this.config, { saveToken }); }
    catch (error) { this.log(`Discord voice stopped: ${error.message}`); return; }
    const update = snapshot => { if (this.voice === voice) this.#set({ connected: true, ...snapshot }); };
    voice.on("channel", snapshot => {
      update(snapshot);
      this.log(snapshot.channel ? `Discord voice: in "${snapshot.channel.name}" with ${snapshot.members.length}.` : "Discord voice: not in a voice channel.");
    });
    voice.on("update", update);
    voice.on("authorizing", () => this.log("Discord voice: confirm the authorization prompt in Discord (once)."));
    voice.on("problem", error => this.log(`Discord voice: ${error.message}`));
    voice.on("close", () => {
      if (this.voice !== voice) return;
      this.log("Discord voice: the Discord app closed the connection; trying again.");
      this.#set({ connected: false, channel: null, members: [] });
      this.#retry();
    });
    try { await voice.start(); }
    catch (error) {
      if (this.voice !== voice) return;
      this.voice = null;
      this.#set({ connected: false, channel: null, members: [] });
      if (RETRYABLE.has(error.code)) { this.#retry(); return; }
      this.log(`Discord voice stopped: ${error.message} Run "node tools/obs-connector.mjs discord-test" to check it.`);
    }
  }

  #retry() {
    if (this.stopped || this.timer) return;
    this.voice = null;
    this.timer = this.setTimer(() => { this.timer = null; void this.start(); }, this.retryAfter);
    this.timer?.unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    const voice = this.voice;
    this.voice = null;
    voice?.removeAllListeners();
    voice?.stop();
  }
}
