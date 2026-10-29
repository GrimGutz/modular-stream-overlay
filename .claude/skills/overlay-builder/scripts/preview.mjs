#!/usr/bin/env node
// Renders an overlay bundle with sample characters through the module's real renderer in headless
// Chrome or Edge: one PNG per overlay (and page) plus a report of layout problems. No Foundry, OBS
// or npm packages; the module and Foundry's Data folder are served read-only on 127.0.0.1.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, mkdtemp, rm, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { moduleRoot, fieldCatalog, load, MODULE_ID } from "./catalog.mjs";

const usage = `Preview an overlay bundle
  node .claude/skills/overlay-builder/scripts/preview.mjs BUNDLE.json [--out DIR] [--overlay ID] [--pages]
       [--samples SAMPLES.json] [--mappings MAPPINGS.json] [--no-accents] [--background checker|transparent|#rrggbb] [--wait MS] [--browser PATH] [--serve]
--pages     also capture every carousel page of every widget design (one PNG per page)
--samples   {"*": {field: value}, "<actor slot or Actor UUID>": {field: value}} overrides generated sample values;
            a character.name override also sets the callsign and real name, as Foundry would
--mappings  GM field mappings for a system without an adapter: checked with the module's validator,
            and their fields count as known and get typed sample values
--no-accents  no character accent colours, as in a world without profile colours, colour rules or a system colour
--serve     keep a local server running for viewing live animation in a browser instead of taking screenshots
Writes DIR/<overlay>.png, DIR/<overlay>--<page>.png and DIR/preview-report.json (DIR defaults to <bundle>-preview).`;

// Report problems as one line instead of a stack trace.
process.on("uncaughtException", error => { console.error(`Preview: ${error.message}`); process.exit(1); });
const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) { console.log(usage); process.exit(args.length ? 0 : 1); }
const flags = new Set(["--pages", "--serve", "--no-accents"]);
const options = {}; let bundleFile;
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (flags.has(key)) options[key.slice(2)] = true;
  else if (key.startsWith("--")) {
    if (!args[index + 1] || args[index + 1].startsWith("--")) throw Error(`${key} needs a value.\n${usage}`);
    options[key.slice(2)] = args[++index];
  } else if (!bundleFile) bundleFile = key;
  else throw Error(`Unexpected argument ${key}.\n${usage}`);
}
if (!bundleFile) throw Error(usage);

const { root } = await moduleRoot();
// Foundry's Data folder holds modules/<id>; other managed paths (worlds/…, user folders) resolve there.
const dataRoot = path.basename(path.dirname(root)) === "modules" ? path.dirname(path.dirname(root)) : null;
const { validateOverlayBundle } = await load(root, "scripts/authoring/bundle.js");
const { splitCharacterName } = await load(root, "scripts/adapters/generic.js");
async function readJson(file, label) {
  let text;
  try { text = await readFile(file, "utf8"); } catch { throw Error(`Cannot read the ${label} file ${file}.`); }
  try { return JSON.parse(text.replace(/^﻿/, "")); } catch (error) { throw Error(`The ${label} file ${file} is not valid JSON: ${error.message}`); }
}
const bundle = validateOverlayBundle(await readJson(bundleFile, "bundle"));
const catalog = new Map((await fieldCatalog(root)).map(field => [field.id, field]));
if (options.mappings) {
  const { validateMappings } = await load(root, "scripts/data/mappings.js");
  const mappings = validateMappings(await readJson(options.mappings, "mappings"), { fields: [...catalog.values()] });
  for (const mapping of mappings) catalog.set(mapping.id, { ...mapping, provider: "mapping", system: mapping.systemId ?? "any",
    role: [...catalog.values(), ...mappings].some(other => other.maxField === mapping.id) ? "maximum" : "" });
}
const samples = options.samples ? await readJson(options.samples, "samples") : {};
const background = options.background ?? "checker";
if (!/^(?:checker|transparent|#[\da-f]{3,8})$/i.test(background)) throw Error("--background must be checker, transparent or a hexadecimal color.");
const wait = Number(options.wait ?? 8000);
if (!Number.isInteger(wait) || wait < 500 || wait > 60000) throw Error("--wait must be 500–60000 milliseconds.");
const outDir = path.resolve(options.out ?? bundleFile.replace(/\.json$/i, "") + "-preview");
const overlays = options.overlay ? bundle.overlays.filter(item => item.id === options.overlay) : bundle.overlays;
if (!overlays.length) throw Error(options.overlay ? `No overlay ${options.overlay} in the bundle.` : "The bundle has no overlays to preview.");

// ---- Static checks on the normalized records ----
const warnings = [];
const warn = (where, message) => warnings.push(`${where}: ${message}`);
const TOKEN = /\{(character(?:\.[A-Za-z0-9_]+)+)(?:\|[^}]*)?\}/g;
const TEMPLATE_TYPES = new Set(["character-name", "dynamic-text", "dynamic-number"]);
const STANDARD_FONTS = new Set(["", "Arial", "Verdana", "Georgia", "Times New Roman", "Courier New", "Trebuchet MS", "Signika"]);
const used = new Set();
function fieldsOf(layer) {
  const result = [];
  if (layer.binding) result.push(layer.binding);
  if (layer.maxBinding) result.push(layer.maxBinding);
  if (TEMPLATE_TYPES.has(layer.type) && layer.text) for (const match of layer.text.matchAll(TOKEN)) result.push(match[1]);
  if (layer.accent || layer.strongAccent) result.push("character.profile.accent");
  return result;
}
async function checkAsset(where, src) {
  if (!src) return;
  if (/^https?:/i.test(src)) return warn(where, `remote image ${src}; prefer a file in Foundry's Data folder`);
  if (/^(?:icons|ui|cards)\//.test(src)) return; // Foundry's own files: present in Foundry, absent from the preview.
  const own = `modules/${MODULE_ID}/`;
  const file = src.startsWith(own) ? path.join(root, src.slice(own.length)) : dataRoot ? path.join(dataRoot, src) : null;
  if (!file) return warn(where, `cannot check ${src} outside a Foundry Data folder`);
  try { await access(file); } catch { warn(where, `image not found: ${src}`); }
}
async function checkLayers(where, layers, canvas) {
  for (const layer of layers) {
    const at = `${where} › ${layer.id}`;
    for (const field of fieldsOf(layer)) {
      used.add(field);
      if (!catalog.has(field) && !Object.values(samples).some(values => values && Object.hasOwn(values, field))) warn(at, `${field} is not a built-in field; it needs a GM field mapping in the world, or it shows its fallback`);
    }
    if (layer.type === "text" && TOKEN.test(layer.text ?? "")) warn(at, "a plain text layer shows {character.*} tokens literally; use dynamic-text");
    TOKEN.lastIndex = 0;
    if (!STANDARD_FONTS.has(layer.fontFamily ?? "")) warn(at, `font "${layer.fontFamily}" must be configured in Foundry; the preview substitutes a system font unless it is installed here`);
    if (canvas && (layer.x < 0 || layer.y < 0 || layer.x + layer.width > canvas.width || layer.y + layer.height > canvas.height)) warn(at, `extends past the ${canvas.width}×${canvas.height} canvas (x ${layer.x}, y ${layer.y}, ${layer.width}×${layer.height})`);
    for (const key of ["src", "maskSrc"]) await checkAsset(at, layer[key]);
  }
}
const presets = new Map(bundle.widgetPresets.map(preset => [preset.id, preset]));
for (const preset of bundle.widgetPresets) {
  await checkLayers(`design ${preset.id}`, preset.layers, preset.canvas);
  for (const page of preset.pages) await checkLayers(`design ${preset.id} page ${page.id}`, page.layers, preset.canvas);
}
for (const overlay of overlays) {
  await checkLayers(`overlay ${overlay.id}`, overlay.layers, overlay.canvas);
  await checkAsset(`overlay ${overlay.id} background`, overlay.background.src);
  for (const layer of overlay.layers.filter(item => item.type === "character-widget")) {
    const preset = presets.get(layer.presetId);
    if (!preset) { warn(`overlay ${overlay.id} › ${layer.id}`, `design ${layer.presetId} is not in the bundle (an existing world design); the preview leaves it empty`); continue; }
    const ratio = (layer.width / layer.height) / (preset.canvas.width / preset.canvas.height);
    if (Math.abs(ratio - 1) > 0.02) warn(`overlay ${overlay.id} › ${layer.id}`, `${layer.width}×${layer.height} stretches design ${preset.id} (${preset.canvas.width}×${preset.canvas.height}); keep the same proportions`);
  }
}

// ---- Sample characters ----
const NAMES = [["Ash", "Mara Vance"], ["Bram", "Theo Kell"], ["Cinder", "Ivy Rook"], ["Dusk", "Oren Hale"], ["Echo", "Lena Voss"], ["Flint", "Rui Tanaka"]];
const ACCENTS = ["#e8a000", "#9966ff", "#3fa9f5", "#ff5577", "#55cc88", "#ff8844"];
const ART = [`modules/${MODULE_ID}/assets/demo-warrior.svg`, `modules/${MODULE_ID}/assets/demo-mage.svg`];
const slotUuid = name => `Actor.preview-${name.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 70);
const slots = Object.fromEntries(bundle.actorSlots.map(name => [name, slotUuid(name)]));
const uuids = [...new Set([...Object.values(slots), ...bundle.overlays.flatMap(overlay => overlay.layers.flatMap(layer => layer.actorUuids ?? []))])];
// A small per-field offset keeps bars and numbers from all showing the same value.
const spread = id => [...id].reduce((total, char) => total + char.charCodeAt(0), 0);
function sample(id, index, values) {
  const [callsign, real] = NAMES[index % NAMES.length], definition = catalog.get(id);
  const fixed = { "character.name": `${callsign} (${real})`, "character.callsign": callsign, "character.realName": real,
    "character.profile.fullName": real, "character.profile.accent": ACCENTS[index % ACCENTS.length], "character.type": "character" };
  if (Object.hasOwn(fixed, id)) return fixed[id];
  const type = definition?.type ?? (/\.(?:max|current|value|percent|level|rating|score)$/.test(id) ? "number" : "string");
  if (type === "image") return ART[index % ART.length];
  if (type === "number") {
    const role = definition?.role ?? "";
    if (role === "maximum" || id.endsWith(".max")) return 6;
    if (role === "percentage" || id.endsWith(".percent")) return 80 - 20 * (index % 4);
    if (definition?.maxField) return Math.max(0, (values[definition.maxField] ?? 6) - 1 - ((index + spread(id)) % 4));
    if (role === "modifier") return (index % 4) - 1;
    if (role === "score") return 10 + 2 * (index % 4);
    return 1 + ((index + spread(id)) % 4);
  }
  const label = definition?.label ?? id.split(".").at(-1);
  return definition?.role === "summary" ? `${label} one\n${label} two` : `${label} ${String.fromCharCode(65 + index % 26)}`;
}
const values = {};
uuids.forEach((uuid, index) => {
  const entry = values[uuid] = {};
  const slot = Object.keys(slots).find(name => slots[name] === uuid);
  // Maximums first, so current values can sit below them.
  const ids = [...new Set([...catalog.keys(), ...used])].sort((left, right) => Number(!left.endsWith(".max")) - Number(!right.endsWith(".max")));
  for (const id of ids) entry[id] = sample(id, index, entry);
  if (options["no-accents"]) entry["character.profile.accent"] = "";
  const override = { ...samples["*"] ?? {}, ...samples[uuid] ?? {}, ...slot ? samples[slot] ?? {} : {} };
  if (typeof override["character.name"] === "string") {
    const { callsign, realName } = splitCharacterName(override["character.name"]);
    Object.assign(entry, { "character.callsign": callsign, "character.realName": realName, "character.profile.fullName": realName });
  }
  Object.assign(entry, override);
  entry["character.uuid"] = uuid;
});

// ---- Local server ----
const types = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".webm": "video/webm", ".mp4": "video/mp4" };
const checker = "repeating-conic-gradient(#2b2b33 0% 25%, #1f1f26 0% 50%) 50% / 40px 40px";
const page = `<!doctype html><html><head><meta charset="utf-8"><title>Overlay preview</title>
<link rel="stylesheet" href="/modules/${MODULE_ID}/styles/renderer.css">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{background:${background === "checker" ? checker : background}}#output{width:100vw;height:100vh}</style>
</head><body><main id="output"></main><script type="module">
const report = { errors: [], overflow: [], images: [], unsampled: [] };
const unsampled = new Set();
const original = console.error.bind(console);
console.error = (...parts) => { report.errors.push(parts.map(part => part?.stack ?? part?.message ?? String(part)).join(" ").slice(0, 600)); original(...parts); };
addEventListener("error", event => { if (!event.target?.tagName) report.errors.push(String(event.message)); }, true);
addEventListener("unhandledrejection", event => report.errors.push(String(event.reason?.stack ?? event.reason)));
const finish = () => {
  const node = document.createElement("script"); node.type = "application/json"; node.id = "mso-report";
  node.textContent = JSON.stringify(report); document.body.append(node); document.title = "ready";
};
try {
  const params = new URLSearchParams(location.search);
  const data = await (await fetch("/__mso/data.json")).json();
  const { OverlayRenderer } = await import("/modules/${MODULE_ID}/scripts/render/renderer.js");
  const overlay = structuredClone(data.bundle.overlays.find(item => item.id === params.get("overlay")) ?? data.bundle.overlays[0]);
  const resolve = value => typeof value === "string" && value.startsWith("$actor:") ? data.slots[value.slice(7)] : value;
  for (const binding of data.bundle.actorBindings) if (binding.overlayId === overlay.id) {
    const layer = overlay.layers.find(item => item.id === binding.layerId);
    layer.actorUuids = binding.actors.map(resolve); layer.actorUuid = layer.actorUuids[0] ?? "";
    if (binding.startActor) layer.carousel.actorStartUuid = resolve(binding.startActor);
  }
  const values = data.values;
  const characterData = {
    resolveActor: async uuid => ({ uuid }),
    listActors: () => Object.keys(values).map(uuid => ({ uuid, name: values[uuid]["character.name"], portrait: values[uuid]["character.portrait"] })),
    resolve: async (uuid, fields) => {
      for (const field of fields) if (!Object.hasOwn(values[uuid] ?? {}, field)) unsampled.add(field);
      return { values: Object.fromEntries(fields.map(field => [field, values[uuid]?.[field] ?? null])), warning: null };
    },
    subscribe: () => () => {}
  };
  const renderer = new OverlayRenderer(document.querySelector("#output"), { context: {
    widgetPresets: { list: () => data.bundle.widgetPresets }, characterData,
    // Screenshots show finished layouts: entrances, transitions and page changes apply at once.
    animationsEnabled: () => params.get("play") === "1", reducedMotion: () => false, debug: () => false } });
  await renderer.render(overlay);
  const carousels = [...renderer.compositions.values()].map(view => view?.select ? view : view?.carousel).filter(Boolean);
  const pageId = params.get("page");
  if (params.get("play") !== "1") for (const carousel of carousels) carousel.pause();
  if (pageId) for (const carousel of carousels) {
    if (!carousel.pages?.some(item => item.id === pageId)) continue;
    await carousel.select(pageId, carousel.getState().activeActorUuid ?? undefined);
    if (params.get("play") !== "1") carousel.pause();
  }
  await document.fonts.ready;
  await new Promise(resolve => setTimeout(resolve, params.get("play") === "1" ? 0 : 800));
  const visible = element => element.offsetParent && getComputedStyle(element).visibility === "visible"
    && !element.closest(".mso-carousel-page[style*='display: none']");
  report.overflow = [...document.querySelectorAll("#output .mso-text-content")].filter(visible)
    .filter(element => element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2)
    .map(element => ({ layer: element.closest("[data-instance-id]")?.dataset.instanceId ?? "", text: element.textContent.slice(0, 80),
      box: [element.clientWidth, element.clientHeight], content: [element.scrollWidth, element.scrollHeight] }));
  report.images = [...document.querySelectorAll("#output img")].filter(image => image.complete && image.naturalWidth === 0)
    .map(image => image.getAttribute("src"));
  report.unsampled = [...unsampled];
  report.carousels = carousels.map(carousel => ({ pages: (carousel.pages ?? []).map(item => item.id), active: carousel.getState().activePageId ?? null }));
} catch (error) { report.errors.push(String(error?.stack ?? error)); }
finish();
</script></body></html>`;
const payload = JSON.stringify({ bundle, slots, values });
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/") { response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(page); return; }
    if (url.pathname === "/__mso/data.json") { response.writeHead(200, { "content-type": "application/json" }).end(payload); return; }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const own = `modules/${MODULE_ID}/`;
    const base = relative.startsWith(own) ? root : dataRoot;
    const file = base && path.resolve(base, relative.startsWith(own) ? relative.slice(own.length) : relative);
    const type = types[path.extname(relative).toLowerCase()];
    // Read-only and narrow: module code and lang files, and media/fonts anywhere in Data. Never world JSON.
    if (!file || !type || !file.startsWith(base + path.sep) || (type === "application/json" && base !== root)) throw Error("refused");
    response.writeHead(200, { "content-type": type, "cache-control": "no-store" }).end(await readFile(file));
  } catch { response.writeHead(404).end("Not found"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const views = overlays.flatMap(overlay => {
  const pageIds = options.pages ? [...new Set(overlay.layers.filter(layer => layer.type === "character-widget")
    .flatMap(layer => presets.get(layer.presetId)?.pages.map(item => item.id) ?? []))] : [];
  return [{ overlay, page: null }, ...pageIds.map(id => ({ overlay, page: id }))];
});
const viewUrl = ({ overlay, page }, play = false) => `${origin}/?overlay=${encodeURIComponent(overlay.id)}${page ? `&page=${encodeURIComponent(page)}` : ""}${play ? "&play=1" : ""}`;

if (options.serve) {
  console.log("Serving the preview (Ctrl+C to stop). Open in a browser:");
  for (const view of views) console.log(`  ${view.overlay.id}${view.page ? ` / ${view.page}` : ""}: ${viewUrl(view, true)}`);
  if (warnings.length) console.log(`\nChecks:\n- ${warnings.join("\n- ")}`);
} else {
  try { await capture(); } finally { server.close(); }
}

async function findBrowser() {
  const candidates = options.browser ? [options.browser] : process.env.MSO_BROWSER ? [process.env.MSO_BROWSER] : process.platform === "win32"
    ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).flatMap(base => [
      path.join(base, "Google/Chrome/Application/chrome.exe"), path.join(base, "Microsoft/Edge/Application/msedge.exe"), path.join(base, "Chromium/Application/chrome.exe")])
    : process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
      : (process.env.PATH ?? "").split(path.delimiter).flatMap(folder => ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"].map(name => path.join(folder, name)));
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch { /* Next. */ } }
  throw Error("No Chrome, Edge or Chromium found. Pass --browser PATH or set MSO_BROWSER.");
}

function run(browser, url, width, height, output) {
  return mkdtemp(path.join(os.tmpdir(), "mso-preview-")).then(profile => new Promise((resolve, reject) => {
    const flags = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--no-default-browser-check",
      "--disable-extensions", `--user-data-dir=${profile}`, `--window-size=${width},${height}`, `--virtual-time-budget=${wait}`,
      output ? `--screenshot=${output}` : "--dump-dom", url];
    execFile(browser, flags, { timeout: 120000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }).catch(() => {});
      if (error) reject(Error(`Browser run failed: ${error.message}`)); else resolve(stdout);
    });
  }));
}

async function capture() {
  const browser = await findBrowser();
  await mkdir(outDir, { recursive: true });
  const results = [];
  for (const view of views) {
    const { width, height } = view.overlay.canvas;
    const name = `${view.overlay.id}${view.page ? `--${view.page}` : ""}`.replace(/[^A-Za-z0-9_.-]/g, "_");
    const png = path.join(outDir, `${name}.png`);
    await run(browser, viewUrl(view), width, height, png);
    const dom = await run(browser, viewUrl(view), width, height, null);
    const match = dom.match(/<script type="application\/json" id="mso-report">([\s\S]*?)<\/script>/);
    const report = match ? JSON.parse(match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")) : { errors: ["The page did not finish rendering; raise --wait."] };
    results.push({ overlay: view.overlay.id, page: view.page, png, ...report });
    const problems = [...report.errors ?? [], ...(report.overflow ?? []).map(item => `text overflows ${item.layer}: "${item.text}"`),
      ...(report.images ?? []).map(src => `image failed to load: ${src}`)];
    console.log(`${png}${problems.length ? `\n  - ${problems.join("\n  - ")}` : "  (no runtime problems)"}`);
  }
  const reportFile = path.join(outDir, "preview-report.json");
  await writeFile(reportFile, JSON.stringify({ bundle: path.resolve(bundleFile), sampleActors: slots, warnings, views: results }, null, 2) + "\n");
  if (warnings.length) console.log(`\nChecks:\n- ${warnings.join("\n- ")}`);
  console.log(`\nReport: ${reportFile}`);
}
