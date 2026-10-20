/**
 * Read-only world diagnostic: real Foundry v14 ApplicationV2 on /join, production
 * animation/renderer modules and memory-only demo stores. Does not log in, change
 * world settings, read Actors, or test OBS. Run separately from the browser runner.
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.MSO_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "work", "animation-forensics");
const address = new URL("join", process.env.MSO_FOUNDRY_URL || "http://127.0.0.1:30000/").href;
const evidence = {
  createdAt: new Date().toISOString(), address,
  scope: "Actual Foundry ApplicationV2, production AnimationController and OverlayRenderer, memory-only DEMO DATA",
  exclusions: ["Module editor ApplicationV2 subclass", "Real world Actor documents", "Authenticated stream output", "OBS/CEF", "Socket delivery"],
  checks: [], effects: [], screenshots: [], browserErrors: [], consoleErrors: []
};
let browser, page;
const save = () => writeFile(path.join(output, "foundry-evidence.json"), JSON.stringify(evidence, null, 2));
const check = async (name, operation) => {
  try { const detail = await operation(); evidence.checks.push({ name, status: "passed", ...(detail ? { detail } : {}) }); }
  catch (error) { evidence.checks.push({ name, status: "failed", error: error.stack ?? String(error) }); }
  await save();
};
const at = ms => page.evaluate(value => new Promise(resolve => setTimeout(resolve, Math.max(0, value - (performance.now() - msoFoundryQA.started)))), ms);

async function effect(name, start, duration = 2000) {
  await start();
  await page.evaluate(async () => { const animation = msoFoundryQA.selected.getAnimations().at(-1); if (animation) await animation.ready; });
  const result = { name, duration, samples: [] };
  const clip = await page.evaluate(() => msoFoundryQA.clip());
  for (const [label, ms] of [["start", 30], ["middle", duration / 2], ["end", duration + 150]]) {
    await at(ms);
    result.samples.push({ label, ...await page.evaluate(() => msoFoundryQA.sample()) });
    const filename = `foundry-${name}-${label}.png`;
    const pixels = await page.screenshot({ path: path.join(output, filename), clip });
    evidence.screenshots.push({ filename, sha256: createHash("sha256").update(pixels).digest("hex"), clip });
  }
  result.outcome = await page.evaluate(() => msoFoundryQA.result);
  evidence.effects.push(result); await save();
  return result;
}

function connectedStable(samples) {
  for (const sample of samples) { assert.equal(sample.connected, true); assert.equal(sample.sameNode, true); }
  for (const property of ["left", "top", "width", "height", "transform", "opacity"]) {
    assert.equal(samples[0].inline[property], samples.at(-1).inline[property], property);
  }
}

try {
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, executablePath: process.env.MSO_CHROMIUM_EXECUTABLE || undefined });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => evidence.browserErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") evidence.consoleErrors.push(message.text()); });
  await page.goto(address, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof globalThis.foundry?.applications?.api?.ApplicationV2 === "function", { timeout: 30000 });
  evidence.environment = await page.evaluate(async () => {
    const moduleBase = foundry.utils.getRoute("modules/modular-stream-overlay").replace(/\/+$/, "") + "/";
    const source = suffix => new URL(moduleBase + suffix, location.origin).href;
    const stylesheetURL = source("styles/renderer.css");
    if (![...document.styleSheets].some(sheet => sheet.href === stylesheetURL)) {
      await new Promise((resolve, reject) => { const link = document.createElement("link"); link.rel = "stylesheet"; link.href = stylesheetURL; link.onload = resolve; link.onerror = reject; document.head.append(link); });
    }
    const [playback, rendererModule, dataModule, registryModule, generic, cain, storeModule, presetModule, demo] = await Promise.all([
      import(source("scripts/animation/playback.js")), import(source("scripts/render/renderer.js")), import(source("scripts/data/character-data.js")),
      import(source("scripts/core/registry.js")), import(source("scripts/adapters/generic.js")), import(source("scripts/adapters/cain.js")),
      import(source("scripts/core/store.js")), import(source("scripts/core/widget-presets.js")), import(source("scripts/demo/install.js"))
    ]);
    const qa = globalThis.msoFoundryQA = { events: [], renders: 0, started: 0, selected: null, result: null, ignoreReduced: false };
    qa.motionReduced = () => !qa.ignoreReduced && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const registry = new playback.AnimationRegistry();
    for (const definition of playback.defaultAnimationRegistry.list()) registry.register(definition);
    registry.register({ id: "diagnostic:pulse", keyframes: () => [{ transform: "scale(1)" }, { transform: "scale(1.2)" }, { transform: "scale(1)" }] });
    registry.register({ id: "diagnostic:slide", keyframes: () => [{ transform: "translateX(-100px)" }, { transform: "translateX(0px)" }] });
    const memory = new Map(), memoryGM = { id: "diagnostic-memory-gm", isGM: true }, memoryViewer = { id: "diagnostic-memory-viewer", isGM: false };
    const settings = { get: (_module, key) => memory.get(key), set: async (_module, key, value) => { memory.set(key, structuredClone(value)); return value; } };
    const adapters = new registryModule.AdapterRegistry(); adapters.register(generic.genericAdapter); adapters.register(cain.cainAdapter);
    qa.characterData = new dataModule.CharacterDataService({ adapters, getUser: () => memoryViewer, getSystemId: () => "cain", hooks: null,
      resolveUuid: async () => { throw Error("This diagnostic never resolves world Actors"); }, debounceMs: 0 });
    qa.store = new storeModule.OverlayStore({ settings, getUser: () => memoryGM });
    qa.presets = new presetModule.WidgetPresetStore({ settings, getUser: () => memoryGM });
    const installed = await demo.installDemo({ store: qa.store, widgetPresets: qa.presets, characterData: qa.characterData });
    qa.overlay = qa.store.getState().overlays.find(value => value.id === installed.overlayId);
    const preset = qa.presets.list().find(value => value.id === demo.DEMO_PRESET_ID);
    preset.animations.entrance = { type: "fade-in", duration: 2000, easing: "linear" };
    preset.animations.exit = { type: "fade-out", duration: 2000, easing: "linear" };
    preset.cycling.enabled = false;
    await qa.presets.save(preset);
    class DiagnosticApplication extends foundry.applications.api.ApplicationV2 {
      static DEFAULT_OPTIONS = { id: "mso-forensic-application", classes: ["mso-forensic-application"],
        window: { title: "Temporary animation diagnostic", resizable: false }, position: { width: 1280, height: 850, left: 60, top: 40 } };
      async _renderHTML() {
        const shell = document.createElement("div"); shell.style.cssText = "height:100%;min-height:720px;position:relative;background:#07101f;overflow:hidden";
        const label = document.createElement("p"); label.textContent = "Actual Foundry ApplicationV2 · Temporary memory-only animation diagnostic";
        label.style.cssText = "position:absolute;top:15px;left:20px;color:#fff;font:20px Arial;z-index:10"; shell.append(label);
        const probe = document.createElement("div"); probe.dataset.forensicProbe = "";
        probe.style.cssText = "position:absolute;left:250px;top:220px;width:240px;height:150px;background:#32d7b2"; shell.append(probe);
        const host = document.createElement("div"); host.dataset.forensicProduction = ""; host.style.cssText = "position:absolute;inset:0;visibility:hidden"; shell.append(host);
        return shell;
      }
      _replaceHTML(result, content) { content.replaceChildren(result); }
      async _onRender(context, options) {
        await super._onRender(context, options); qa.renders++;
        qa.probeController?.destroy("application-rerender"); qa.renderer?.destroy();
        qa.probe = this.element.querySelector("[data-forensic-probe]"); qa.host = this.element.querySelector("[data-forensic-production]");
        qa.probeController = new playback.AnimationController(qa.probe, { registry, reducedMotion: qa.motionReduced,
          debug: () => true, onDiagnostic: event => qa.events.push({ surface: "probe", ...event }) });
        qa.renderer = new rendererModule.OverlayRenderer(qa.host, { context: { widgetPresets: qa.presets, characterData: qa.characterData,
          deferEntrances: true, reducedMotion: qa.motionReduced, debug: () => true, onDiagnostic: event => qa.events.push({ surface: "production", ...event }) } });
        await qa.renderer.render(qa.overlay); qa.card = qa.renderer.compositions.get(demo.DEMO_WIDGET_ID); qa.card.pause();
        qa.outer = qa.renderer.motions.get(demo.DEMO_WIDGET_ID); qa.selected = qa.probe;
      }
      async _onClose(options) { qa.probeController?.destroy(); qa.renderer?.destroy(); qa.characterData.stop(); await super._onClose(options); }
    }
    qa.app = new DiagnosticApplication(); await qa.app.render({ force: true });
    qa.track = promise => { qa.result = null; qa.pending = Promise.resolve(promise).then(value => { qa.result = value; return value; }); };
    qa.startProbe = type => { qa.selected = qa.probe; qa.started = performance.now(); qa.track(qa.probeController.play({ type, duration: 2000, easing: "linear" })); };
    qa.showProduction = () => { qa.probe.hidden = true; qa.host.style.visibility = "visible"; qa.selected = qa.outer.element; };
    qa.startWidget = type => {
      qa.selected = qa.outer.element; qa.started = performance.now();
      const command = { overlayId: qa.overlay.id, layerId: demo.DEMO_WIDGET_ID, kind: "play", animation: { type, duration: 2000, easing: "linear", intensity: 1 } };
      if (!qa.renderer.handleAnimationCommand(command)) throw Error("Production dispatcher rejected diagnostic command");
    };
    qa.sample = (element = qa.selected) => {
      const css = getComputedStyle(element), rect = element.getBoundingClientRect();
      const matrix = new DOMMatrixReadOnly(css.transform === "none" ? undefined : css.transform);
      return { elapsed: performance.now() - qa.started, connected: element.isConnected, sameNode: element === qa.selected,
        renders: qa.renders, opacity: Number(css.opacity), transform: css.transform, scaleX: Math.hypot(matrix.a, matrix.b), translateX: matrix.e,
        visibility: css.visibility, display: css.display, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        inline: { left: element.style.left, top: element.style.top, width: element.style.width, height: element.style.height, transform: element.style.transform, opacity: element.style.opacity },
        animations: element.getAnimations().map(animation => ({ playState: animation.playState, currentTime: animation.currentTime,
          timelineTime: animation.timeline?.currentTime ?? null, duration: animation.effect?.getTiming().duration, progress: animation.effect?.getComputedTiming().progress })) };
    };
    qa.clip = () => {
      const rect = qa.selected.getBoundingClientRect(); const x = Math.max(0, Math.floor(rect.x - 110)), y = Math.max(0, Math.floor(rect.y - 50));
      return { x, y, width: Math.min(innerWidth - x, Math.ceil(rect.width + 220)), height: Math.min(innerHeight - y, Math.ceil(rect.height + 100)) };
    };
    return { userAgent: navigator.userAgent, foundryVersion: game?.version ?? game?.release?.version ?? null,
      view: game?.view ?? null, systemReducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      nativeApplicationV2: qa.app instanceof foundry.applications.api.ApplicationV2,
      documentTimeline: document.timeline.currentTime, stylesheet: stylesheetURL, stylesheetCount: document.styleSheets.length,
      writes: "Only injected memory stores; global Foundry game/settings remain untouched" };
  });
  const preferences = [{ name: "actual-preference", force: false }];
  if (evidence.environment.systemReducedMotion) preferences.push({ name: "forced-motion-comparison", force: true });
  for (const preference of preferences) {
    await page.evaluate(force => { msoFoundryQA.ignoreReduced = force; }, preference.force);
    const blocked = evidence.environment.systemReducedMotion && !preference.force;
    for (const [name, type] of [["fade", "fade-in"], ["pulse", "diagnostic:pulse"], ["slide", "diagnostic:slide"]]) {
      await check(`ApplicationV2 ${preference.name}: ${name}`, async () => {
        const result = await effect(`${preference.name}-probe-${name}`, () => page.evaluate(value => msoFoundryQA.startProbe(value), type));
        connectedStable(result.samples);
        if (blocked) { assert(result.samples.every(sample => sample.animations.length === 0)); assert.equal(result.outcome?.status, "disabled"); return { blockedByNativeReducedMotion: true }; }
        const [start, middle, end] = result.samples;
        assert.equal(middle.animations[0]?.duration, 2000); assert.equal(middle.animations[0]?.playState, "running");
        if (name === "fade") { assert(start.opacity < 0.25); assert(middle.opacity > 0.25 && middle.opacity < 0.75); assert.equal(end.opacity, 1); }
        if (name === "pulse") { assert(middle.scaleX > 1.17); assert(Math.abs(end.scaleX - 1) < 0.01); }
        if (name === "slide") { assert(start.translateX < -70); assert(middle.translateX > -70 && middle.translateX < -30); assert(Math.abs(end.translateX) < 0.01); }
        assert.equal(start.renders, end.renders, "Animation must not rerender the application");
      });
    }
  }
  await page.evaluate(() => msoFoundryQA.showProduction());
  for (const type of ["fade-in", "fade-out", "pulse"]) await check(`production renderer inside actual ApplicationV2: ${type}`, async () => {
    const result = await effect(`widget-${type}`, () => page.evaluate(value => msoFoundryQA.startWidget(value), type));
    connectedStable(result.samples); const [start, middle, end] = result.samples;
    assert.equal(middle.animations[0]?.duration, 2000); assert.equal(middle.animations[0]?.playState, "running");
    if (type === "fade-in") { assert(start.opacity < 0.25); assert(middle.opacity > 0.25 && middle.opacity < 0.75); assert.equal(end.opacity, 1); }
    if (type === "fade-out") { assert(start.opacity > 0.75); assert(middle.opacity > 0.25 && middle.opacity < 0.75); assert.equal(end.opacity, 1, "Ephemeral dispatcher play restores base opacity after finish"); }
    if (type === "pulse") { assert(middle.scaleX > 1.08); assert(Math.abs(end.scaleX - 1) < 0.01); }
    assert.equal(start.renders, end.renders);
  });
  await check("actual ApplicationV2 cleanup", async () => {
    const result = await page.evaluate(async () => { const qa = msoFoundryQA; await qa.app.close(); return { applicationConnected: qa.app.element?.isConnected ?? false,
      rendererDisposed: qa.renderer.disposed, subscriptions: qa.characterData.subscriptions.size, animationChannels: qa.probeController.channels.size }; });
    assert.deepEqual(result, { applicationConnected: false, rendererDisposed: true, subscriptions: 0, animationChannels: 0 }); return result;
  });
} catch (error) { evidence.fatal = error.stack ?? String(error); }
finally {
  if (page) try { evidence.finalDiagnostics = await page.evaluate(() => msoFoundryQA.events); } catch { /* Bootstrap failure recorded separately. */ }
  await browser?.close(); await mkdir(output, { recursive: true });
  evidence.passed = evidence.checks.filter(check => check.status === "passed").length;
  evidence.failed = evidence.checks.filter(check => check.status === "failed").length + (evidence.fatal ? 1 : 0); await save();
  console.log(`Foundry ApplicationV2 animation checks: ${evidence.passed} passed, ${evidence.failed} failed. Evidence: ${path.join(output, "foundry-evidence.json")}`);
  if (evidence.failed) process.exitCode = 1;
}
