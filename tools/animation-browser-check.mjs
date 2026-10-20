/**
 * Native-browser regression/diagnostic runner for the installed production renderer.
 * Run manually with MSO_PLAYWRIGHT_MODULE and, optionally, MSO_CHROMIUM_EXECUTABLE.
 * Its server exposes only production sources/styles and bundled demo portraits.
 * Settings and character data are memory-only; Foundry and OBS are not mocked as tested runtimes.
 */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "work", "animation-forensics");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.MSO_PLAYWRIGHT_MODULE || "playwright");
const evidence = {
  createdAt: new Date().toISOString(),
  scope: "Native Chromium: isolated AnimationController and actual OverlayRenderer/ActorCarousel/UI controls, memory-only demo data",
  exclusions: ["Actual Foundry ApplicationV2 lifecycle", "Real world Actor documents", "OBS/CEF rendering or transport"],
  checks: [], effects: [], screenshots: [], browserErrors: [], consoleErrors: []
};

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Production animation forensics</title>
<link rel="stylesheet" href="/styles/renderer.css"><style>
html,body{margin:0;width:100%;height:100%;background:#070d18;color:#eef4ff;font:14px Arial}
#production{position:absolute;inset:0}#probe{position:absolute;left:150px;top:240px;width:240px;height:150px;background:#32d7b2;z-index:4}
#probe-label{position:absolute;left:100px;top:160px;z-index:4;font:24px Arial}#controls{position:fixed;right:8px;top:8px;z-index:20;max-width:300px;background:#17243bdd;padding:8px}
#controls button{margin:2px;padding:5px}#controls select{max-width:280px}#controls p,#controls pre{display:none}
</style></head><body><main id="production"></main><div id="probe-label">Native browser diagnostic</div><div id="probe"></div><aside id="controls"></aside>
<script type="module">
import { AnimationController, AnimationRegistry, defaultAnimationRegistry } from '/scripts/animation/playback.js';
import { OverlayRenderer } from '/scripts/render/renderer.js';
import { refreshAnimationPreferences } from '/scripts/render/motion.js';
import { CharacterDataService } from '/scripts/data/character-data.js';
import { AdapterRegistry } from '/scripts/core/registry.js';
import { genericAdapter } from '/scripts/adapters/generic.js';
import { cainAdapter } from '/scripts/adapters/cain.js';
import { OverlayStore } from '/scripts/core/store.js';
import { WidgetPresetStore } from '/scripts/core/widget-presets.js';
import { installDemo, DEMO_WIDGET_ID, DEMO_PRESET_ID } from '/scripts/demo/install.js';
import { renderAnimationTestControls } from '/scripts/ui/animation-controls.js';
const qa = globalThis.qa = { reduced: false, enabled: true, events: [], history: [], sequence: 0, started: 0, selected: null, pending: null, result: null };
qa.refreshPreferences = refreshAnimationPreferences;
const storeValues = new Map(), gm = { id: 'forensic-memory-gm', isGM: true }, viewer = { id: 'forensic-memory-viewer', isGM: false };
const settings = { get: (_module,key) => storeValues.get(key), set: async (_module,key,value) => { storeValues.set(key,structuredClone(value)); return value; } };
globalThis.foundry = { utils: { getRoute: value => '/'+value.replace(/^\\//,'') } };
globalThis.game = { user: gm, system: { id: 'cain' } };
const adapters = new AdapterRegistry(); adapters.register(genericAdapter); adapters.register(cainAdapter);
qa.characterData = new CharacterDataService({ adapters, getUser: () => viewer, getSystemId: () => 'cain', hooks: null,
  resolveUuid: async () => { throw Error('No world documents are read by this diagnostic'); }, debounceMs: 0 });
qa.store = new OverlayStore({ settings, getUser: () => gm });
qa.presets = new WidgetPresetStore({ settings, getUser: () => gm });
const installation = await installDemo({ store: qa.store, widgetPresets: qa.presets, characterData: qa.characterData });
qa.overlay = qa.store.getState().overlays.find(value => value.id === installation.overlayId);
qa.preset = qa.presets.list().find(value => value.id === DEMO_PRESET_ID);
// Explicit memory-only fixture timing, never a change to installed/user configuration.
qa.preset.animations.entrance = { type: 'fade-in', duration: 1200, easing: 'linear' };
qa.preset.animations.exit = { type: 'fade-out', duration: 1200, easing: 'linear' };
qa.preset.cycling.enabled = false; qa.preset.cycling.transitionDuration = 1200; qa.preset.cycling.characterTransitionDuration = 1200;
await qa.presets.save(qa.preset);
const registry = new AnimationRegistry();
for (const definition of defaultAnimationRegistry.list()) registry.register(definition);
registry.register({ id:'diagnostic:pulse', keyframes: () => [{transform:'scale(1)'},{transform:'scale(1.2)'},{transform:'scale(1)'}] });
registry.register({ id:'diagnostic:slide', keyframes: () => [{transform:'translateX(-100px)'},{transform:'translateX(0px)'}] });
qa.probe = document.querySelector('#probe');
qa.probeController = new AnimationController(qa.probe, { registry, reducedMotion: () => qa.reduced, enabled: () => qa.enabled,
  debug: () => true, onDiagnostic: event => qa.events.push({ surface: 'probe', ...event }) });
qa.sample = (element = qa.selected) => {
  if (!element) return null;
  const computed = getComputedStyle(element), rect = element.getBoundingClientRect();
  const matrix = new DOMMatrixReadOnly(computed.transform === 'none' ? undefined : computed.transform);
  return { elapsed: performance.now()-qa.started, connected: element.isConnected, sameNode: element === qa.selected,
    tag: element.tagName, className: element.className, opacity: Number(computed.opacity), transform: computed.transform,
    scaleX: Math.hypot(matrix.a,matrix.b), scaleY: Math.hypot(matrix.c,matrix.d), translateX: matrix.e, translateY: matrix.f,
    visibility: computed.visibility, display: computed.display,
    rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
    inline:{left:element.style.left,top:element.style.top,width:element.style.width,height:element.style.height,transform:element.style.transform,opacity:element.style.opacity},
    animations: element.getAnimations().map(animation => ({playState:animation.playState,currentTime:animation.currentTime,
      timelineTime:animation.timeline?.currentTime ?? null,duration:animation.effect?.getTiming().duration,
      progress:animation.effect?.getComputedTiming().progress,iterations:animation.effect?.getTiming().iterations})) };
};
qa.track = promise => { qa.result = null; qa.pending = Promise.resolve(promise).then(result => { qa.result=result; return result; }); };
qa.startProbe = type => { qa.selected=qa.probe; qa.started=performance.now(); qa.track(qa.probeController.play({type,duration:2000,easing:'linear'})); };
qa.createProduction = async () => {
  qa.renderer?.destroy(); qa.history=[];
  qa.renderer = new OverlayRenderer(document.querySelector('#production'),{ context:{ widgetPresets:qa.presets,characterData:qa.characterData,
    deferEntrances:true,animationsEnabled:()=>qa.enabled,reducedMotion:()=>qa.reduced,debug:()=>true,
    onDiagnostic:event=>qa.events.push({surface:'production',...event}),
    onCarouselChange:state=>{const key=state.activeActorUuid+'/'+state.activePageId;if(state.activeActorUuid&&qa.history.at(-1)!==key)qa.history.push(key);} } });
  await qa.renderer.render(qa.overlay); qa.card=qa.renderer.compositions.get(DEMO_WIDGET_ID);qa.outer=qa.renderer.motions.get(DEMO_WIDGET_ID);
  qa.card.pause(); qa.selected=qa.outer.element;
};
qa.command = command => {
  qa.started=performance.now();
  const accepted=qa.renderer.handleAnimationCommand({ id:'forensic-'+(++qa.sequence),overlayId:qa.overlay.id,layerId:DEMO_WIDGET_ID,...command });
  if(!accepted)throw Error('Production command rejected: '+JSON.stringify(command));
  return accepted;
};
qa.startEffect = type => {qa.selected=qa.outer.element;qa.command({kind:'play',animation:{type,duration:1200,easing:'linear',intensity:1}});};
qa.startTransition = axis => {
  qa.transitionBefore=qa.card.getState();qa.transitionActorBefore=qa.card.activeSlot;qa.transitionOuterBefore=qa.outer.element;
  qa.started=performance.now();qa.track(axis==='actor'?qa.card.nextActor():qa.card.nextPage());
};
qa.transitionSample = () => ({ elapsed:performance.now()-qa.started,state:qa.card.getState(),outerSame:qa.outer.element===qa.transitionOuterBefore,
  presentations:[...qa.card.slots.values()].map(slot=>({actorUuid:slot.actorUuid,...qa.sample(slot.element),
    pages:[...(slot.renderer.carousel?.views.values()??[])].map(view=>({pageId:view.element.dataset.pageId,...qa.sample(view.element)}))})) });
await qa.createProduction();
renderAnimationTestControls(document.querySelector('#controls'), { layers:qa.overlay.layers.filter(layer=>layer.id===DEMO_WIDGET_ID),layerId:DEMO_WIDGET_ID,
  onCommand:(_id,command)=>qa.command(command),getPlaybackState:()=>qa.renderer.getAnimationTestState(DEMO_WIDGET_ID),getDiagnostics:()=>qa.renderer.getDiagnostics() });
qa.ready=true;
</script></body></html>`;

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/") { response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); return response.end(html); }
    const relative = decodeURIComponent(pathname).replace(/^\/(?:modules\/modular-stream-overlay\/)?/, "");
    const allowed = /^(scripts\/[A-Za-z0-9_./-]+\.js|styles\/[A-Za-z0-9_.-]+\.css|assets\/demo-(warrior|mage)\.svg)$/.test(relative);
    const resolved = path.resolve(root, relative);
    if (!allowed || relative.split("/").includes("..") || !resolved.startsWith(root)) throw Error("Unavailable");
    const type = resolved.endsWith(".js") ? "text/javascript" : resolved.endsWith(".css") ? "text/css" : "image/svg+xml";
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); response.end(await readFile(resolved));
  } catch { response.writeHead(404); response.end("Not found"); }
});

let browser, page;
const save = async () => writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
const check = async (name, callback) => {
  try { const detail = await callback(); evidence.checks.push({ name, status: "passed", ...(detail ? { detail } : {}) }); }
  catch (error) { evidence.checks.push({ name, status: "failed", error: error.stack ?? String(error) }); }
  await save();
};
const at = async milliseconds => page.evaluate(ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms-(performance.now()-qa.started)))), milliseconds);
const screenshot = async name => {
  const filename = `${name}.png`; await page.screenshot({ path: path.join(output, filename) }); evidence.screenshots.push(filename);
};
const effect = async (name, start, duration, { screenshotFrames = false } = {}) => {
  const before = await page.evaluate(() => qa.sample()); await start();
  // Allow the browser to resolve the native animation's start time before sampling.
  await page.evaluate(async () => { const animation=qa.selected.getAnimations().at(-1); if(animation)await animation.ready; });
  const result = { name, configuredDuration: duration, before, samples: [] };
  for (const [label, milliseconds] of [["start", 30], ["middle", duration/2], ["end", duration+150]]) {
    await at(milliseconds); result.samples.push({ label, ...await page.evaluate(() => qa.sample()) });
    if (screenshotFrames) await screenshot(`${name}-${label}`);
  }
  evidence.effects.push(result); await save(); return result;
};
const stableLayout = samples => {
  for (const sample of samples) { assert.equal(sample.connected, true); assert.equal(sample.sameNode, true); }
  for (const key of ["left", "top", "width", "height", "transform", "opacity"]) assert.equal(samples.at(-1).inline[key], samples[0].inline[key], key);
};

try {
  await mkdir(output, { recursive: true });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true, executablePath: process.env.MSO_CHROMIUM_EXECUTABLE || undefined });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", error => evidence.browserErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") evidence.consoleErrors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => globalThis.qa?.ready);
  evidence.environment = await page.evaluate(() => ({userAgent:navigator.userAgent,systemReducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
    documentTimeline:document.timeline.currentTime,animationsSupported:typeof Element.prototype.animate==='function',
    testPreferences:{reducedMotion:qa.reduced,animationsEnabled:qa.enabled}}));

  await page.evaluate(() => { document.querySelector('#production').style.visibility='hidden';document.querySelector('#controls').hidden=true;qa.selected=qa.probe; });
  await check("isolated fade: computed opacity changes over 2000 ms", async () => {
    const result = await effect("isolated-fade", () => page.evaluate(() => qa.startProbe('fade-in')), 2000, { screenshotFrames: true });
    const [start,middle,end]=result.samples;assert(start.opacity<0.25);assert(middle.opacity>0.25&&middle.opacity<0.75);assert.equal(end.opacity,1);
    assert.equal(middle.animations[0]?.duration,2000);assert.equal(middle.animations[0]?.playState,'running');stableLayout(result.samples);return result.samples;
  });
  await check("isolated pulse: actual scale 1 → 1.2 → 1", async () => {
    const result=await effect("isolated-pulse",()=>page.evaluate(()=>qa.startProbe('diagnostic:pulse')),2000,{screenshotFrames:true});
    assert(result.samples[1].scaleX>1.17);assert(Math.abs(result.samples[2].scaleX-1)<0.01);stableLayout(result.samples);
  });
  await check("isolated slide: actual translateX -100 → 0", async () => {
    const result=await effect("isolated-slide",()=>page.evaluate(()=>qa.startProbe('diagnostic:slide')),2000,{screenshotFrames:true});
    assert(result.samples[0].translateX < -70);assert(result.samples[1].translateX > -70 && result.samples[1].translateX < -30);assert(Math.abs(result.samples[2].translateX)<0.01);stableLayout(result.samples);
  });

  await page.evaluate(() => { qa.probe.hidden=true;document.querySelector('#probe-label').hidden=true;document.querySelector('#production').style.visibility='';document.querySelector('#controls').hidden=false;qa.selected=qa.outer.element; });
  await check("production UI entrance: connected real widget changes opacity", async () => {
    const result=await effect("widget-fade-in",()=>page.getByRole('button',{name:'Play Entrance Animation',exact:true}).click(),1200,{screenshotFrames:true});
    assert(result.samples[0].opacity<0.3);assert(result.samples[1].opacity>0.25&&result.samples[1].opacity<0.75);assert.equal(result.samples[2].opacity,1);stableLayout(result.samples);
  });
  await check("production UI exit completes before hiding the same widget", async () => {
    const result=await effect("widget-fade-out",()=>page.getByRole('button',{name:'Play Exit Animation',exact:true}).click(),1200,{screenshotFrames:true});
    assert(result.samples[1].opacity>0.25&&result.samples[1].opacity<0.75);assert.equal(result.samples[1].visibility,'visible');assert.equal(result.samples[2].visibility,'hidden');stableLayout(result.samples);
  });
  await page.getByRole('button',{name:'Play Entrance Animation',exact:true}).click();await at(1350);
  for(const repetition of [1,2])await check(`production pulse ${repetition}: visible scaling with stable saved geometry`,async()=>{
    const result=await effect(`widget-pulse-${repetition}`,()=>page.evaluate(()=>qa.startEffect('pulse')),1200,{screenshotFrames:true});
    assert(result.samples[1].rect.width>result.before.rect.width*1.08);assert(result.samples[1].scaleX>1.08);assert(Math.abs(result.samples[2].rect.width-result.before.rect.width)<0.1);stableLayout(result.samples);
  });
  await check("production slide differs from pulse and returns to saved coordinates",async()=>{
    const result=await effect("widget-slide",()=>page.evaluate(()=>qa.startEffect('slide-in-left')),1200);
    assert(result.samples[1].translateX < -10);assert(Math.abs(result.samples[1].scaleX-1)<0.01);assert.equal(result.samples[2].translateX,0);stableLayout(result.samples);
  });

  const transition = async (axis,name) => {
    await page.evaluate(value=>qa.startTransition(value),axis);
    const result={name,samples:[]};
    for(const [label,ms]of [['early',200],['middle',850],['end',1400]]){await at(ms);result.samples.push({label,...await page.evaluate(()=>qa.transitionSample())});if(label!=='end')await screenshot(`${name}-${label}`);}
    result.outcome=await page.evaluate(async()=>await qa.pending);evidence.effects.push(result);return result;
  };
  await check("production page transition retains DOM and exposes intermediate translation",async()=>{
    const result=await transition('page','page-slide');
    const nodes=result.samples[0].presentations.flatMap(slot=>slot.pages).filter(value=>value.animations.length);
    assert(nodes.length>=2);assert(nodes.every(value=>value.connected));assert(nodes.some(value=>Math.abs(value.translateX)>1));
    assert(nodes.every(value=>value.animations[0].duration===1200));assert(result.samples.every(value=>value.outerSame));
    assert.notEqual(result.samples.at(-1).state.activePageId,await page.evaluate(()=>qa.transitionBefore.activePageId));assert.equal(result.samples.at(-1).state.transitioning,false);
  });
  await check("production Actor transition exits before entrance and animates real opacity",async()=>{
    const result=await transition('actor','actor-fade');
    const early=result.samples[0].presentations.filter(value=>value.animations.length),middle=result.samples[1].presentations.filter(value=>value.animations.length);
    assert(early.some(value=>value.opacity>0&&value.opacity<1));assert(middle.some(value=>value.opacity>0&&value.opacity<1));
    assert(early.every(value=>value.animations[0].duration===600));assert(middle.every(value=>value.animations[0].duration===600));
    const final=result.samples.at(-1);assert.notEqual(final.state.activeActorUuid,await page.evaluate(()=>qa.transitionBefore.activeActorUuid));
    assert.equal(final.state.transitioning,false);assert.equal(final.presentations.filter(value=>value.display!=='none').length,1);
    assert(result.samples.every(value=>value.outerSame));
  });
  await check("rapid production navigation settles the latest target without orphan effects",async()=>{
    const result=await page.evaluate(async()=>{
      const first=qa.card.nextPage();await new Promise(resolve=>setTimeout(resolve,100));const second=qa.card.nextActor();
      await Promise.all([first,second]);return {state:qa.card.getState(),animations:qa.outer.element.getAnimations({subtree:true}).filter(animation=>animation.effect?.getTiming().iterations!==Infinity).length,
        visible:[...qa.card.slots.values()].filter(slot=>getComputedStyle(slot.element).display!=='none').length};
    });assert.equal(result.state.transitioning,false);assert.equal(result.visible,1);assert.equal(result.animations,0);return result;
  });
  await check("reduced-motion contrast: no registered animations and immediate carousel",async()=>{
    const result=await page.evaluate(async()=>{
      qa.reduced=true;qa.refreshPreferences();qa.selected=qa.outer.element;const before=qa.sample();qa.startEffect('pulse');
      const diagnostic=qa.events.at(-1);const eventCount=qa.outer.element.getAnimations({subtree:true}).length;
      const start=performance.now();await qa.card.nextActor();const elapsed=performance.now()-start;qa.reduced=false;qa.refreshPreferences();
      return {before,after:qa.sample(),diagnostic,eventCount,elapsed,state:qa.card.getState()};
    });assert.equal(result.diagnostic.reason,'reduced-motion');assert.equal(result.eventCount,0);assert(result.elapsed<300);assert.equal(result.after.transform,result.before.transform);return result;
  });
  await check("global disable contrast: playback resolves disabled without a browser animation",async()=>{
    const result=await page.evaluate(async()=>{qa.enabled=false;qa.refreshPreferences();const result=await qa.outer.play({type:'fade-in',duration:1200});qa.enabled=true;qa.refreshPreferences();return {result,count:qa.outer.element.getAnimations().length};});
    assert.equal(result.result.status,'disabled');assert.equal(result.count,0);return result;
  });
  await check("full renderer replacement cancels the old target with explicit lifecycle cause",async()=>{
    const result=await page.evaluate(async()=>{
      const old=qa.outer.element;qa.events=[];const playing=qa.outer.play({type:'pulse',duration:2000});await new Promise(resolve=>setTimeout(resolve,100));
      const middle=qa.sample(old);await qa.renderer.render(qa.overlay);const settled=await playing;
      const details={middle,settled,oldConnected:old.isConnected,same:old===qa.renderer.motions.get('demo-character-widget').element,
        events:qa.events.filter(event=>event.phase==='cancelled')};qa.card=qa.renderer.compositions.get('demo-character-widget');qa.outer=qa.renderer.motions.get('demo-character-widget');qa.card.pause();qa.selected=qa.outer.element;return details;
    });assert.equal(result.settled.status,'cancelled');assert.equal(result.oldConnected,false);assert.equal(result.same,false);assert(result.events.some(event=>event.reason==='render-interrupted'));return result;
  });
  await check("automatic combined carousel preserves pages-first sequence and wraps",async()=>{
    const result=await page.evaluate(async()=>{
      qa.card.pause();qa.history=[];const settings=qa.card.controller.settings;
      // Short, explicit memory-only dwell keeps the full 2 Actor × 3 page regression bounded.
      settings.duration=100;settings.transitionDuration=120;settings.characterTransitionDuration=160;
      Object.assign(qa.card.configuration.settings,{duration:100,transitionDuration:120,characterTransitionDuration:160});
      qa.card.controller.controller.settings.duration=100;
      for(const page of qa.card.controller.pages)page.duration=100;
      for(const page of qa.card.pages)page.duration=100;
      await qa.card.reset();await qa.card.resume();const began=performance.now();
      while(qa.history.length<7&&performance.now()-began<10000)await new Promise(resolve=>setTimeout(resolve,20));
      qa.card.pause();return {history:qa.history,state:qa.card.getState()};
    });assert(result.history.length>=7);const first=result.history.slice(0,7).map(key=>key.split('/'));
    assert.equal(new Set(first.slice(0,3).map(pair=>pair[0])).size,1);assert.equal(new Set(first.slice(3,6).map(pair=>pair[0])).size,1);
    assert.notEqual(first[0][0],first[3][0]);assert.equal(new Set(first.slice(0,3).map(pair=>pair[1])).size,3);assert.deepEqual(first[0],first[6]);return result;
  });
  await check("cleanup releases native animations, data subscriptions and output DOM",async()=>{
    const result=await page.evaluate(()=>{qa.renderer.destroy();qa.probeController.destroy();qa.characterData.stop();return {animations:document.getAnimations().length,
      subscriptions:qa.characterData.subscriptions.size,outputChildren:document.querySelector('#production').children.length,probeChannels:qa.probeController.channels.size};});
    assert.deepEqual(result,{animations:0,subscriptions:0,outputChildren:0,probeChannels:0});return result;
  });
  await check("browser raised no JavaScript exceptions",()=>assert.deepEqual(evidence.browserErrors,[]));
} catch (error) {
  evidence.fatal = error.stack ?? String(error);
} finally {
  if (page) {
    try { evidence.finalDiagnostics=await page.evaluate(()=>({events:qa.events.slice(-150),renderer:qa.renderer.getDiagnostics()})); } catch { /* Failed bootstrap is recorded above. */ }
  }
  await browser?.close();
  if(server.listening)await new Promise(resolve=>server.close(resolve));
  await mkdir(output,{recursive:true});
  evidence.passed=evidence.checks.filter(value=>value.status==='passed').length;
  evidence.failed=evidence.checks.filter(value=>value.status==='failed').length+(evidence.fatal?1:0);
  await save();
  console.log(`Animation browser checks: ${evidence.passed} passed, ${evidence.failed} failed. Evidence: ${path.join(output,'evidence.json')}`);
  if(evidence.failed)process.exitCode=1;
}
