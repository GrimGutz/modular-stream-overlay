import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import { ObsConnector, validateConfig, defaultConfigPath, CONNECTOR_HEADER } from "../tools/obs-connector.mjs";
import { watchForConnector } from "../scripts/integration/obs.js";

const settings = port => ({ foundryUrl: "http://127.0.0.1:1", userName: "OBS Overlay", password: "secret", port });

/** A stand-in Foundry: page routes hand out a session, /join signs it in, /stream needs it. */
async function fakeFoundry() {
  const signedIn = new Set(), joins = [];
  let next = 0;
  const server = createServer((request, response) => {
    const session = /session=([^;]+)/.exec(request.headers.cookie ?? "")?.[1];
    if (request.url === "/join" && request.method === "POST") {
      // Foundry 14 answers 400 to a POST from another origin or without one.
      const site = request.headers["sec-fetch-site"];
      if (site ? site !== "same-origin" : request.headers.origin !== `http://${request.headers.host}`) {
        response.writeHead(400, { "Content-Type": "application/json" }); return response.end('{"error":"The request could not be processed."}');
      }
      let body = ""; request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        const data = JSON.parse(body); joins.push({ ...data, session });
        if (data.password !== "secret") { response.writeHead(401); return response.end("JOIN.ErrorInvalidPassword"); }
        signedIn.add(session); response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ request: "join", status: "success", redirect: "/stream?mso=1" }));
      });
      return;
    }
    if (request.url.startsWith("/stream")) {
      const headers = session ? {} : { "Set-Cookie": `session=s${++next}; HttpOnly; SameSite=Strict` };
      if (!signedIn.has(session)) { response.writeHead(302, { ...headers, Location: "/join" }); return response.end(); }
      response.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": "other=1" }); return response.end(`<main>stream ${request.headers.host}</main>`);
    }
    response.writeHead(301, { Location: `http://127.0.0.1:${server.address().port}/icons/moved.svg` }); response.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, signedIn, joins, url: `http://127.0.0.1:${server.address().port}` };
}

test("connector settings require an account, a plain Foundry address and a user port", () => {
  assert.deepEqual(validateConfig({ foundryUrl: "http://localhost:30000/foundry/", userName: " OBS ", password: "x" }),
    { foundryUrl: "http://localhost:30000/foundry", userName: "OBS", password: "x", port: 30001 });
  for (const bad of [{ userName: "" }, { userName: "a", foundryUrl: "http://user:pw@localhost" }, { userName: "a", foundryUrl: "ftp://x" }, { userName: "a", port: 80 }]) {
    assert.throws(() => validateConfig(bad));
  }
  assert.match(defaultConfigPath({ APPDATA: "C:\\Users\\me\\AppData\\Roaming" }), /modular-stream-overlay[\\/]obs-connector\.json$/);
});

test("the connector waits for a world, signs in once by account name and reports wrong passwords", async t => {
  const foundry = await fakeFoundry(); t.after(() => foundry.server.close());
  let world = null, signedInUser = null;
  const probe = async (_url, cookie) => ({ sessionId: cookie.replace("session=", ""), userId: signedInUser, worldId: world,
    users: [{ _id: "gm", name: "Gamemaster" }, { _id: "obs", name: "OBS Overlay" }] });
  const logs = [];
  const connector = new ObsConnector({ ...settings(30101), foundryUrl: foundry.url }, { probe, log: message => logs.push(message) });
  assert.equal(await connector.ensureSession(), "waiting");
  assert.match(logs.at(-1), /world/);
  world = "test";
  assert.equal(await connector.ensureSession(), "ready");
  assert.deepEqual(foundry.joins, [{ action: "join", userId: "obs", password: "secret", session: "s1" }]);
  assert.equal(connector.sessionId, "s1");
  signedInUser = "obs"; connector.invalidate();
  assert.equal(await connector.ensureSession(), "ready"); assert.equal(foundry.joins.length, 1, "An existing sign-in is reused");
  assert(!logs.some(message => message.includes("secret")), "The password is never logged");
  const wrong = new ObsConnector({ ...settings(30102), foundryUrl: foundry.url, password: "nope" }, { probe: async () => ({ sessionId: "s9", userId: null, worldId: "test", users: [{ _id: "obs", name: "obs overlay" }] }), log: message => logs.push(message) });
  assert.equal(await wrong.ensureSession(), "failed"); assert.match(logs.at(-1), /wrong password/);
  const missing = new ObsConnector({ ...settings(30103), foundryUrl: foundry.url }, { probe: async () => ({ sessionId: "s8", userId: null, worldId: "test", users: [] }), log: message => logs.push(message) });
  assert.equal(await missing.ensureSession(), "failed"); assert.match(logs.at(-1), /No account named/);
});

test("OBS gets the stream as the signed-in account while other pages, methods, hosts and origins are refused", async t => {
  const foundry = await fakeFoundry(); t.after(() => foundry.server.close());
  const probe = async (_url, cookie) => ({ sessionId: cookie.replace("session=", ""), userId: null, worldId: "test", users: [{ _id: "obs", name: "OBS Overlay" }] });
  const connector = new ObsConnector({ ...settings(30104), foundryUrl: foundry.url }, { probe, log: () => {} });
  const server = await new Promise(resolve => { const value = createServer((request, response) => void connector.handleRequest(request, response));
    value.on("upgrade", (request, socket, head) => connector.handleUpgrade(request, socket, head)); value.listen(0, "127.0.0.1", () => resolve(value)); });
  t.after(() => server.close());
  const port = server.address().port, base = `http://127.0.0.1:${port}`;
  connector.allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const get = (path, options = {}) => fetch(`${base}${path}`, { redirect: "manual", ...options });
  let response = await get("/");
  assert.equal(response.status, 302); assert.equal(response.headers.get("location"), "/stream?mso=1");
  response = await get("/stream?mso=1");
  assert.equal(response.status, 200); assert.equal(response.headers.get(CONNECTOR_HEADER), "1");
  assert.equal(await response.text(), `<main>stream 127.0.0.1:${foundry.server.address().port}</main>`);
  assert.equal(response.headers.get("set-cookie"), null, "Foundry cookies never reach OBS");
  response = await get("/icons/old.svg");
  assert.equal(response.headers.get("location"), "/icons/moved.svg", "Redirects stay on the connector");
  for (const path of ["/game", "/join", "/setup", "/players"]) assert.equal((await get(path)).status, 403, path);
  assert.equal((await get("/stream?mso=1", { method: "POST", body: "x" })).status, 405);
  const foreignHost = await new Promise(resolve => {
    const socket = connect(port, "127.0.0.1", () => socket.write("GET /stream?mso=1 HTTP/1.1\r\nHost: attacker.example\r\nConnection: close\r\n\r\n"));
    let text = ""; socket.on("data", chunk => { text += chunk; }); socket.on("end", () => resolve(text));
  });
  assert.match(foreignHost, /^HTTP\/1\.1 403/, "DNS-rebinding hosts are refused");
  const foreignOrigin = await new Promise(resolve => {
    const socket = connect(port, "127.0.0.1", () => socket.write(`GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: https://evil.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    let text = ""; socket.on("data", chunk => { text += chunk; }); socket.on("end", () => resolve(text)); socket.on("error", () => resolve(text));
  });
  assert.match(foreignOrigin, /^HTTP\/1\.1 403/, "Other websites cannot use the viewer's socket");
  foundry.signedIn.clear();
  response = await get("/stream?mso=1");
  assert.match(await response.text(), /http-equiv="refresh"/, "A lost sign-in shows the transparent waiting page and signs in again");
  assert.equal((await (await get("/stream?mso=1")).text()).startsWith("<main>"), true);
});

test("the stream page reloads only behind the connector once it answers again", async () => {
  const timers = [], reloads = [];
  let header = null, online = false;
  const fetch = async () => { if (!online) throw new Error("offline"); return { headers: { get: name => name === CONNECTOR_HEADER ? header : null } }; };
  const stop = watchForConnector({ url: "http://localhost:30001/stream?mso=1", reload: () => reloads.push(true), fetch,
    setTimer: callback => { timers.push(callback); return timers.length; }, clearTimer: () => { timers.length = 0; } });
  await timers[0](); online = true; await timers[0]();
  assert.equal(reloads.length, 0, "Without the connector, OBS never reloads into Foundry's sign-in page");
  header = "1"; await timers[0]();
  assert.equal(reloads.length, 1); assert.equal(timers.length, 0, "Polling stops after the reload");
  stop();
});
