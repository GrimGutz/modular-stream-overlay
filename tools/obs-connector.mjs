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
import { connect as tlsConnect } from "node:tls";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { CONNECTOR_HEADER } from "../scripts/integration/obs.js";

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
  constructor(config, { fetch = globalThis.fetch, probe = socketProbe, log = message => console.log(`[${new Date().toLocaleTimeString()}] ${message}`), now = () => Date.now() } = {}) {
    this.config = validateConfig(config);
    this.upstream = new URL(`${this.config.foundryUrl}/`);
    this.prefix = this.upstream.pathname.replace(/\/$/, "");
    this.fetch = fetch; this.probe = probe; this.log = log; this.now = now;
    this.sessionId = null; this.state = { status: "idle", until: 0 }; this.pending = null;
    this.allowedHosts = new Set([`localhost:${this.config.port}`, `127.0.0.1:${this.config.port}`]);
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
    const route = this.#route(url);
    if (!route) { response.writeHead(302, { Location: this.streamPath, [CONNECTOR_HEADER]: "1" }); return response.end(); }
    if (BLOCKED_ROUTES.has(route)) return send(403, "The connector only shows the stream.");
    if (route === "stream") {
      const state = await this.ensureSession();
      if (state !== "ready") return send(200, WAITING_PAGE, "text/html; charset=utf-8");
    }
    this.#forward(request, response, url, route, send);
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

async function main(argv) {
  const configIndex = argv.indexOf("--config");
  const file = configIndex >= 0 ? argv[configIndex + 1] : defaultConfigPath();
  if (!file) throw new Error("--config needs a file path.");
  if (argv[0] === "setup") return setup(file);
  let config;
  try { config = JSON.parse(await readFile(file, "utf8")); }
  catch { throw new Error(`No settings at ${file}. Run "node tools/obs-connector.mjs setup" first.`); }
  const connector = new ObsConnector(config);
  await connector.listen();
  connector.log(`OBS connector for ${connector.config.foundryUrl} as "${connector.config.userName}".`);
  connector.log(`OBS Browser Source URL: http://localhost:${connector.config.port}/  (keep this window open while streaming)`);
  void connector.ensureSession();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
