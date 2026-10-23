#!/usr/bin/env node
/**
 * Optional OBS connector. Runs on the streaming PC, signs in to Foundry as the overlay
 * viewer account and forwards the stream page to OBS, so the Browser Source keeps one
 * URL and needs no manual sign-in after Foundry or the world restarts.
 *
 *   node tools/obs-connector.mjs setup   # once: Foundry address, account name, password
 *   node tools/obs-connector.mjs         # then keep it running while streaming
 *
 * Anything that reaches it acts as the viewer account, so it listens on 127.0.0.1 only,
 * accepts only its own Host and Origin, forwards GET/HEAD requests and the socket, and
 * refuses Foundry's other pages (game, setup, join, …). The password stays in a local
 * file outside Foundry's Data folder and is never printed or sent anywhere but Foundry.
 */
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as netConnect } from "node:net";
import tls, { connect as tlsConnect } from "node:tls";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { CONNECTOR_HEADER } from "../scripts/integration/obs.js";
import { VOICE_PATH } from "../scripts/integration/voice.js";
import { DEFAULT_REDIRECT, DiscordVoice, VoiceFeed, discordConfigPath, validateDiscordConfig } from "./discord-voice.mjs";

export { CONNECTOR_HEADER };
const BLOCKED_ROUTES = new Set(["game", "join", "setup", "players", "auth", "license", "update", "create", "quit", "upload"]);
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "host", "cookie"]);
const READY_FOR = 5000, RETRY_FAILED_AFTER = 30000;
// Transparent while Foundry, the world or the sign-in is not ready; it asks again every 5 seconds.
const WAITING_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>OBS connector</title>
<style>html,body{margin:0;background:transparent}</style></head><body></body></html>`;

export function defaultConfigPath(env = process.env) {
  const base = env.APPDATA || path.join(homedir(), ".config");
  return path.join(base, "modular-stream-overlay", "obs-connector.json");
}

/** Normalized settings; the Foundry URL may include a route prefix such as /foundry. */
export function validateConfig(input) {
  if (!input || typeof input !== "object") throw new TypeError("The connector settings must be a JSON object.");
  const url = new URL(input.foundryUrl ?? "http://localhost:30000");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new TypeError("Use a plain http(s) Foundry address, such as http://localhost:30000.");
  const userName = typeof input.userName === "string" ? input.userName.trim() : "";
  if (!userName) throw new TypeError("Enter the name of the overlay viewer account.");
  if (typeof (input.password ?? "") !== "string") throw new TypeError("The password must be text.");
  const port = input.port ?? 30001;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new TypeError("Choose a connector port between 1024 and 65535.");
  return { foundryUrl: url.href.replace(/\/+$/, ""), userName, password: input.password ?? "", port };
}

/**
 * Minimal Socket.IO client for Foundry's unauthenticated join data: the session the server
 * assigned, the user signed in to the current world (if any), and the world's users.
 */
export function socketProbe(foundryUrl, cookie, { timeout = 6000, WebSocketClass = globalThis.WebSocket } = {}) {
  const base = new URL(`${foundryUrl}/`);
  const url = new URL("socket.io/?EIO=4&transport=websocket", base);
  url.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  return new Promise((resolve, reject) => {
    const socket = new WebSocketClass(url.href, cookie ? { headers: { Cookie: cookie } } : undefined);
    let session = null;
    const finish = (error, value) => { clearTimeout(timer); try { socket.close(); } catch { /* Already closed. */ } error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error("Foundry did not answer on its socket.")), timeout);
    socket.onerror = () => finish(new Error("Foundry is not reachable."));
    socket.onmessage = ({ data }) => {
      const message = String(data);
      if (message.startsWith("0")) socket.send("40");
      else if (message === "2") socket.send("3");
      else if (message.startsWith("40")) socket.send('420["getJoinData"]');
      else if (message.startsWith('42["session"')) session = JSON.parse(message.slice(2))[1] ?? null;
      else if (message.startsWith("430")) {
        const data = JSON.parse(message.slice(3))[0] ?? {};
        finish(null, { sessionId: session?.sessionId ?? null, userId: session?.userId ?? null,
          worldId: data.world?.id ?? null, users: Array.isArray(data.users) ? data.users : [] });
      }
    };
  });
}

export class ObsConnector {
  constructor(config, { fetch = globalThis.fetch, probe = socketProbe, log = message => console.log(`[${new Date().toLocaleTimeString()}] ${message}`), now = () => Date.now(), voice = null } = {}) {
    this.config = validateConfig(config);
    // An optional VoiceFeed: who speaks in Discord, for voice layers on the stream page.
    this.voice = voice;
    this.upstream = new URL(`${this.config.foundryUrl}/`);
    this.prefix = this.upstream.pathname.replace(/\/$/, "");
    this.fetch = fetch; this.probe = probe; this.log = log; this.now = now;
    this.sessionId = null; this.state = { status: "idle", until: 0 }; this.pending = null;
    this.allowedHosts = new Set([`localhost:${this.config.port}`, `127.0.0.1:${this.config.port}`]);
    // Foundry's own pages on this PC (the GM's editor) may read voice state, nothing else.
    const local = ["localhost", "127.0.0.1"].includes(this.upstream.hostname);
    const port = this.upstream.port ? `:${this.upstream.port}` : "";
    this.foundryOrigins = new Set([this.upstream.origin, ...(local ? ["localhost", "127.0.0.1"].map(host => `${this.upstream.protocol}//${host}${port}`) : [])]);
  }

  get cookie() { return this.sessionId ? `session=${this.sessionId}` : ""; }
  get streamPath() { return `${this.prefix}/stream?mso=1`; }

  /** "ready", "waiting" (Foundry or the world is not up) or "failed" (account or password). */
  async ensureSession() {
    const { status, until } = this.state;
    if ((status === "ready" || status === "failed") && this.now() < until) return status;
    this.pending ??= this.#signIn().then(result => {
      this.state = { status: result, until: this.now() + (result === "failed" ? RETRY_FAILED_AFTER : result === "ready" ? READY_FOR : 0) };
      return result;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }

  invalidate() { this.state = { status: "idle", until: 0 }; }

  async #signIn() {
    let probe;
    try {
      // The stream route hands out a session cookie (a fresh one when ours expired with a
      // Foundry restart) without signing anyone out; the socket does not answer without one.
      const page = await this.fetch(new URL("stream", this.upstream), { redirect: "manual", headers: this.sessionId ? { Cookie: this.cookie } : {} });
      await page.arrayBuffer().catch(() => {});
      const assigned = (page.headers.getSetCookie?.() ?? []).map(value => value.split(";")[0]).find(value => value.startsWith("session="));
      if (assigned) this.sessionId = assigned.slice("session=".length);
      probe = await this.probe(this.config.foundryUrl, this.cookie);
    } catch (error) { this.#report("waiting", `Waiting for Foundry: ${error.message}`); return "waiting"; }
    if (probe.sessionId) this.sessionId = probe.sessionId;
    if (!probe.worldId) { this.#report("waiting", "Waiting for a world to be launched in Foundry."); return "waiting"; }
    const user = probe.users.find(entry => String(entry.name).toLocaleLowerCase() === this.config.userName.toLocaleLowerCase());
    if (!user) { this.#report("failed", `No account named "${this.config.userName}" in world ${probe.worldId}.`); return "failed"; }
    if (probe.userId === user._id) { this.#report("ready", `Signed in as "${user.name}" in world ${probe.worldId}.`); return "ready"; }
    let response;
    try {
      // Foundry refuses a POST whose Origin is missing or another site (400), so name Foundry's own.
      response = await this.fetch(new URL("join", this.upstream), { method: "POST", redirect: "manual",
        headers: { "Content-Type": "application/json", Cookie: this.cookie, Origin: this.upstream.origin },
        body: JSON.stringify({ action: "join", userId: user._id, password: this.config.password }) });
    } catch (error) { this.#report("waiting", `Waiting for Foundry: ${error.message}`); return "waiting"; }
    const result = await response.json().catch(() => null);
    if (response.ok && result?.status === "success") { this.#report("ready", `Signed in as "${user.name}" in world ${probe.worldId}.`); return "ready"; }
    const reason = response.status === 401 ? "wrong password or the account cannot join" : `Foundry answered ${response.status}`;
    this.#report("failed", `Sign-in as "${user.name}" failed: ${reason}. Run "node tools/obs-connector.mjs setup" to change it.`);
    return "failed";
  }

  #report(status, message) {
    // Log state changes once instead of every poll.
    if (this.lastReport !== `${status}:${message}`) this.log(message);
    this.lastReport = `${status}:${message}`;
  }

  #local(request) {
    return this.allowedHosts.has(String(request.headers.host ?? "").toLowerCase());
  }

  #route(url) {
    const relative = url.pathname.startsWith(this.prefix) ? url.pathname.slice(this.prefix.length) : url.pathname;
    return relative.split("/").filter(Boolean)[0] ?? "";
  }

  async handleRequest(request, response) {
    const send = (status, body, type = "text/plain; charset=utf-8") => {
      response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", [CONNECTOR_HEADER]: "1" });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    if (!this.#local(request)) return send(403, "Only OBS on this computer can use the connector.");
    if (!["GET", "HEAD"].includes(request.method)) return send(405, "The connector only shows the stream.");
    const url = new URL(request.url, "http://connector.invalid");
    if (url.pathname === VOICE_PATH) return this.#voiceStream(request, response, send);
    const route = this.#route(url);
    if (!route) { response.writeHead(302, { Location: this.streamPath, [CONNECTOR_HEADER]: "1" }); return response.end(); }
    if (BLOCKED_ROUTES.has(route)) return send(403, "The connector only shows the stream.");
    if (route === "stream") {
      const state = await this.ensureSession();
      if (state !== "ready") return send(200, WAITING_PAGE, "text/html; charset=utf-8");
    }
    this.#forward(request, response, url, route, send);
  }

  /**
   * Who is in the Discord voice channel and speaking, as server-sent events for the stream page
   * and for Foundry's own pages on this PC (the GM's editor preview): the whole state on connect
   * and after every change. 404 when Discord voice is not set up.
   */
  #voiceStream(request, response, send) {
    const origin = request.headers.origin;
    const foundry = Boolean(origin) && this.foundryOrigins.has(origin);
    if (origin && !foundry && ![...this.allowedHosts].some(host => origin === `http://${host}`)) return send(403, "Only the stream page and Foundry can read voice state.");
    const cors = foundry ? { "Access-Control-Allow-Origin": origin, "Access-Control-Expose-Headers": CONNECTOR_HEADER, Vary: "Origin" } : {};
    if (!this.voice) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", [CONNECTOR_HEADER]: "1", ...cors });
      return response.end(request.method === "HEAD" ? undefined : "Discord voice is not set up in this connector.");
    }
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", [CONNECTOR_HEADER]: "1", ...cors });
    if (request.method === "HEAD") return response.end();
    const voice = this.voice;
    const write = state => response.write(`data: ${JSON.stringify(state)}\n\n`);
    write(voice.state);
    voice.on("change", write);
    const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), 15000);
    heartbeat.unref?.();
    request.on("close", () => { clearInterval(heartbeat); voice.off("change", write); });
  }

  #forward(request, response, url, route, send) {
    const headers = Object.fromEntries(Object.entries(request.headers).filter(([key]) => !HOP_HEADERS.has(key)));
    headers.host = this.upstream.host;
    if (this.sessionId) headers.cookie = this.cookie;
    const upstream = (this.upstream.protocol === "https:" ? httpsRequest : httpRequest)(
      new URL(`${url.pathname}${url.search}`, this.upstream.origin), { method: request.method, headers }, reply => {
        const location = reply.headers.location;
        // Signed out between check and request (for example Foundry restarted): show the waiting page and sign in again.
        if (route === "stream" && reply.statusCode >= 300 && reply.statusCode < 400 && /\/join(?:$|[?#])/.test(location ?? "")) {
          reply.resume(); this.invalidate();
          return send(200, WAITING_PAGE.replace('content="5"', 'content="1"'), "text/html; charset=utf-8");
        }
        const out = { ...reply.headers, [CONNECTOR_HEADER]: "1" };
        delete out["set-cookie"];
        if (location) {
          const target = new URL(location, this.upstream);
          if (target.origin === this.upstream.origin) out.location = `${target.pathname}${target.search}${target.hash}`;
        }
        response.writeHead(reply.statusCode ?? 502, out);
        reply.pipe(response);
      });
    upstream.on("error", () => {
      if (response.headersSent) return response.destroy();
      if (route === "stream") { this.invalidate(); return send(200, WAITING_PAGE, "text/html; charset=utf-8"); }
      send(502, "Foundry is not reachable.");
    });
    request.pipe(upstream);
  }

  /** Socket.IO upgrade with the viewer session; other sites in a normal browser cannot use it. */
  handleUpgrade(request, socket, head) {
    const origin = request.headers.origin;
    const url = new URL(request.url, "http://connector.invalid");
    const allowedOrigin = !origin || [...this.allowedHosts].some(host => origin === `http://${host}`);
    if (!this.#local(request) || !allowedOrigin || this.#route(url) !== "socket.io") {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const secure = this.upstream.protocol === "https:";
    const port = Number(this.upstream.port) || (secure ? 443 : 80);
    const target = secure ? tlsConnect({ host: this.upstream.hostname, port, servername: this.upstream.hostname }) : netConnect({ host: this.upstream.hostname, port });
    target.once(secure ? "secureConnect" : "connect", () => {
      const lines = [`${request.method} ${url.pathname}${url.search} HTTP/1.1`, `Host: ${this.upstream.host}`];
      for (const [key, value] of Object.entries(request.headers)) {
        if (["host", "cookie", "origin"].includes(key)) continue;
        for (const entry of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${entry}`);
      }
      lines.push(`Origin: ${this.upstream.origin}`);
      if (this.sessionId) lines.push(`Cookie: ${this.cookie}`);
      target.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head?.length) target.write(head);
      target.pipe(socket); socket.pipe(target);
    });
    const close = () => { socket.destroy(); target.destroy(); };
    target.on("error", close); socket.on("error", close);
  }

  listen() {
    const server = createServer((request, response) => {
      this.handleRequest(request, response).catch(error => {
        this.log(`Request failed: ${error.message}`);
        if (!response.headersSent) response.writeHead(502, { [CONNECTOR_HEADER]: "1" });
        response.end();
      });
    });
    server.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.config.port, "127.0.0.1", () => resolve(server));
    });
  }
}

async function ask(question, { hidden = false, fallback = "" } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = text => { if (text.includes(question)) process.stdout.write(text); };
  const answer = await new Promise(resolve => rl.question(question, resolve));
  rl.close();
  if (hidden) process.stdout.write("\n");
  return answer.trim() || fallback;
}

async function setup(file) {
  let current = {};
  try { current = JSON.parse(await readFile(file, "utf8")); } catch { /* First setup. */ }
  console.log("Modular Stream Overlay — OBS connector setup. Leave a line empty to keep the value in [brackets].");
  const foundryUrl = await ask(`Foundry address [${current.foundryUrl ?? "http://localhost:30000"}]: `, { fallback: current.foundryUrl ?? "http://localhost:30000" });
  const userName = await ask(`Overlay viewer account name${current.userName ? ` [${current.userName}]` : ""}: `, { fallback: current.userName ?? "" });
  const password = await ask(`Password for that account${current.password !== undefined ? " [keep current]" : ""} (not shown): `, { hidden: true, fallback: current.password ?? "" });
  const port = Number(await ask(`Connector port [${current.port ?? 30001}]: `, { fallback: String(current.port ?? 30001) }));
  const config = validateConfig({ foundryUrl, userName, password, port });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`Saved ${file}`);
  console.log(`OBS Browser Source URL: http://localhost:${config.port}/`);
}

async function discordSetup(file) {
  let current = {};
  try { current = JSON.parse(await readFile(file, "utf8")); } catch { /* First setup. */ }
  console.log("Discord voice — setup. Create an application at https://discord.com/developers/applications,");
  console.log(`add the redirect ${DEFAULT_REDIRECT} on its OAuth2 page and enter its values here. Leave a line empty to keep the value in [brackets].`);
  const clientId = await ask(`Client ID${current.clientId ? ` [${current.clientId}]` : ""}: `, { fallback: current.clientId ?? "" });
  const clientSecret = await ask(`Client Secret${current.clientSecret ? " [keep current]" : ""} (not shown): `, { hidden: true, fallback: current.clientSecret ?? "" });
  const redirectUri = await ask(`Redirect [${current.redirectUri ?? DEFAULT_REDIRECT}]: `, { fallback: current.redirectUri ?? DEFAULT_REDIRECT });
  // A token belongs to the application that issued it.
  const same = clientId === current.clientId && clientSecret === current.clientSecret;
  const config = validateDiscordConfig({ clientId, clientSecret, redirectUri, token: same ? current.token : undefined });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`Saved ${file}`);
  console.log('Next: join a voice channel in Discord and run "node tools/obs-connector.mjs discord-test".');
}

/** Prints the current voice channel and every start and stop of speaking until Ctrl+C. */
async function discordTest(file) {
  let config;
  try { config = JSON.parse(await readFile(file, "utf8")); }
  catch { throw new Error(`No Discord settings at ${file}. Run "node tools/obs-connector.mjs discord-setup" first.`); }
  const log = message => console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
  const voice = new DiscordVoice(config, {
    saveToken: async token => {
      const saved = validateDiscordConfig({ ...config, token });
      await writeFile(file, `${JSON.stringify(saved, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    }
  });
  const label = entry => `${entry.name} (${entry.id})${entry.bot ? " [bot]" : ""}${entry.muted ? " [muted]" : ""}${entry.deafened ? " [deafened]" : ""}`;
  voice.on("authorizing", () => log("Discord shows an authorization prompt for your application: confirm it there (once)."));
  voice.on("channel", ({ channel, members }) => {
    if (!channel) return log("Not in a voice channel. Join one in Discord; this window follows you.");
    log(`Voice channel "${channel.name}" (channel ${channel.id}, server ${channel.guildId ?? "none"}), ${members.length} in it:`);
    for (const entry of members) log(`    ${label(entry)}`);
  });
  voice.on("member", ({ type, member }) => log(`${type === "join" ? "+ joined " : type === "leave" ? "- left   " : "~ changed"} ${label(member)}`));
  voice.on("speaking", ({ speaking, member }) => log(`${speaking ? ">> speaks " : "   stopped"} ${member.name} (${member.id})`));
  voice.on("problem", error => log(`Problem: ${error.message}`));
  voice.on("close", info => { log(`Discord closed the connection${info?.message ? `: ${info.message}` : ""}.`); process.exit(1); });
  log("Connecting to the Discord app on this PC…");
  let user, scopes;
  try { ({ user, scopes } = await voice.start()); }
  catch (error) {
    const text = `${error.message} ${error.code ?? ""}`;
    if (/client id/i.test(text)) log('Hint: check the Client ID with "discord-setup".');
    else if (/redirect/i.test(text)) log(`Hint: add ${config.redirectUri ?? DEFAULT_REDIRECT} under OAuth2 → Redirects in the Developer Portal and save.`);
    else if (/invalid_client|secret/i.test(text)) log('Hint: reset the Client Secret in the Developer Portal and enter it again with "discord-setup".');
    else if (/scope|tester|approv|4006|5000/i.test(text)) log("Hint: Discord gives voice events only to approved apps and to the testers of your own application.");
    throw error;
  }
  log(`Signed in to Discord as ${user?.global_name || user?.username || "?"} (${user?.id ?? "?"}) with ${scopes.join(", ") || "no scopes"}. Speak in the channel; Ctrl+C stops.`);
}

/**
 * Lets Node also trust the Windows certificate store, as browsers do, so HTTPS scanning by
 * antivirus software (whose root certificate lives only there) does not break discord.com.
 */
export function trustSystemCertificates(api = tls) {
  if (typeof api.setDefaultCACertificates !== "function" || typeof api.getCACertificates !== "function") return false;
  try {
    api.setDefaultCACertificates([...new Set([...api.getCACertificates("default"), ...api.getCACertificates("system")])]);
    return true;
  } catch { return false; }
}

async function main(argv) {
  trustSystemCertificates();
  const configIndex = argv.indexOf("--config");
  const file = configIndex >= 0 ? argv[configIndex + 1] : defaultConfigPath();
  if (!file) throw new Error("--config needs a file path.");
  if (argv[0] === "setup") return setup(file);
  if (argv[0] === "discord-setup") return discordSetup(discordConfigPath());
  if (argv[0] === "discord-test") return discordTest(discordConfigPath());
  let config;
  try { config = JSON.parse(await readFile(file, "utf8")); }
  catch { throw new Error(`No settings at ${file}. Run "node tools/obs-connector.mjs setup" first.`); }
  const connector = new ObsConnector(config);
  await connector.listen();
  connector.log(`OBS connector for ${connector.config.foundryUrl} as "${connector.config.userName}".`);
  connector.log(`OBS Browser Source URL: http://localhost:${connector.config.port}/  (keep this window open while streaming)`);
  void connector.ensureSession();
  await startDiscordVoice(connector);
}

/** With Discord voice set up (discord-setup), the stream page learns who is speaking. */
async function startDiscordVoice(connector, file = discordConfigPath()) {
  let config;
  try { config = JSON.parse(await readFile(file, "utf8")); }
  catch { return; }
  const saveToken = async token => {
    config = validateDiscordConfig({ ...config, token });
    await writeFile(file, `${JSON.stringify(config, null, 2)}
`, { encoding: "utf8", mode: 0o600 });
  };
  connector.voice = new VoiceFeed(config, { saveToken, log: message => connector.log(message) });
  connector.log("Discord voice: connecting to the Discord app on this PC…");
  void connector.voice.start();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
