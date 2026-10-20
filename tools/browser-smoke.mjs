/** Optional browser QA: real module DOM/controller/template, mocked Foundry application/settings. */
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = process.env.MSO_SERVE_ONLY ? {} : require(process.env.MSO_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const handlebars = require.resolve("handlebars/dist/handlebars.js", { paths: [process.env.MSO_FOUNDRY_APP || "C:/Program Files/Foundry Virtual Tabletop/resources/app", root] });
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles/renderer.css"><link rel="stylesheet" href="/styles/editor.css"><link rel="stylesheet" href="/styles/layer-canvas.css"><style>body{margin:0;background:#10151d;font-family:Arial,sans-serif}.application{width:calc(100vw - 32px);height:calc(100vh - 32px);margin:16px}.window-content{height:100%}button,input,select,textarea{font:inherit}button{cursor:pointer}</style></head><body><script src="/handlebars.js"></script><script type="module">
class Application {
  constructor() { this.rendered=false; this.renderCount=0; }
  _canRender() { return true; }
  async _prepareContext() { return {}; }
  async _onRender() {}
  async render() {
    if(this._canRender({})===false)return this;
    const context=await this._prepareContext({});
    this.element?.remove(); this.element=document.createElement('div');this.element.className='application mso-editor';
    const content=document.createElement('section');content.className='window-content';
    content.innerHTML=Handlebars.compile(await(await fetch('/templates/editor.hbs')).text())(context);
    this.element.append(content); document.body.append(this.element);this.rendered=true;this.renderCount++;
    this.element.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(target){const handler=this.constructor.DEFAULT_OPTIONS.actions[target.dataset.action];handler?.call(this,event,target);}});
    await this._onRender(context,{});return this;
  }
  async close() {this.rendered=false;this.element?.remove();return this;}
}
globalThis.foundry={applications:{api:{ApplicationV2:Application,HandlebarsApplicationMixin:Base=>Base,DialogV2:{confirm:async()=>true,input:async()=>({name:'Browser test preset'})}}},utils:{deepClone:structuredClone,getRoute:value=>'/'+value}};
const values=new Map(),configs=new Map();globalThis.errors=[];
globalThis.ui={notifications:{info(){},warn(){},error(message){errors.push(message);}}};
globalThis.game={view:'game',user:{id:'gm',isGM:true,can:()=>true},users:[],modules:new Map([['modular-stream-overlay',{}]]),settings:{register(id,key,config){configs.set(key,config);if(!values.has(key))values.set(key,structuredClone(config.default));},get(id,key){return values.get(key);},async set(id,key,value){values.set(key,structuredClone(value));return value;}}};
const {registerSettings,OverlayStore}=await import('/scripts/core/store.js');registerSettings();const store=new OverlayStore();await store.createOverlay('Phase 2 browser QA');
game.modules.get('modular-stream-overlay').api={store,getViewerUserId:()=>'',getOBSUrl:()=>location.origin+'/stream?mso=1',getJoinUrl:()=>location.origin+'/join'};
const {OverlayEditor,configureEditor}=await import('/scripts/ui/editor.js');configureEditor({store});
globalThis.editor=new OverlayEditor();globalThis.store=store;await editor.render();globalThis.ready=true;
</script></body></html>`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/") { response.setHeader("Content-Type", "text/html"); return response.end(html); }
    if (url.pathname === "/handlebars.js") { response.setHeader("Content-Type", "text/javascript"); return response.end(await readFile(handlebars)); }
    if (url.pathname === "/work/fixture.svg") { response.setHeader("Content-Type", "image/svg+xml"); return response.end('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#234c65"/><circle cx="320" cy="180" r="100" fill="#72bdba"/></svg>'); }
    const relative = decodeURIComponent(url.pathname).slice(1);
    if (!/^(scripts|styles|templates)\/[A-Za-z0-9_./-]+$/.test(relative)) throw Error("Blocked resource");
    const file = path.resolve(root, relative);
    if (!file.startsWith(root) || relative.split("/").includes("..")) throw Error("Blocked path");
    response.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : file.endsWith(".hbs") ? "text/plain" : "text/javascript");
    response.end(await readFile(file));
  } catch { response.statusCode = 404; response.end("Not found"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
if (process.env.MSO_SERVE_ONLY) {
  console.log(`Isolated editor harness: http://127.0.0.1:${server.address().port}`);
  await new Promise(() => {});
}
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MSO_CHROMIUM_EXECUTABLE || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const browserErrors = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => globalThis.ready);
  const idle = async () => { await page.waitForFunction(() => !editor._busy && !editor._uploading); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
  await page.locator('[data-action="addImage"]').click(); await idle();
  await page.locator('[data-layer-field="src"]').fill("work/fixture.svg"); await idle();
  assert.equal(await page.evaluate(() => editor._draft.layers.length), 1);
  assert.equal(await page.evaluate(() => store.getState().overlays[0].layers.length), 0, "Unsaved additions stay private");
  const id = await page.evaluate(() => editor._selectedLayerId);
  const before = await page.evaluate(() => ({ ...editor._draft.layers[0], renders: editor.renderCount, scale: editor._preview.renderer.layout.scale }));
  const box = await page.locator(`.mso-layer-hit[data-layer-id="${id}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 6 }); await page.mouse.up();
  const dragged = await page.evaluate(() => ({ ...editor._draft.layers[0], renders: editor.renderCount }));
  assert(Math.abs(dragged.x - before.x - 60 / before.scale) < .05);
  assert(Math.abs(dragged.y - before.y - 30 / before.scale) < .05);
  assert.equal(dragged.renders, before.renders, "Pointer movement cannot rerender the application");
  const resize = await page.locator('.mso-layer-selection [data-resize-handle="se"]').boundingBox();
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2); await page.mouse.down();
  await page.mouse.move(resize.x + resize.width / 2 + 30, resize.y + resize.height / 2 + 20, { steps: 4 }); await page.mouse.up();
  const resized = await page.evaluate(() => editor._draft.layers[0]);
  assert(resized.width > dragged.width); assert(Math.abs(resized.width / resized.height - dragged.width / dragged.height) < .001);
  await page.locator('[data-preview]').focus(); await page.keyboard.press("Shift+ArrowRight");
  assert(Math.abs((await page.evaluate(() => editor._draft.layers[0].x)) - resized.x - 10) < .001);
  await page.locator('[data-layer-field="locked"]').check(); await idle();
  const lockedX = await page.evaluate(() => editor._draft.layers[0].x);
  await page.locator('[data-preview]').focus(); await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(() => editor._draft.layers[0].x), lockedX);
  assert.equal(await page.locator(".mso-resize-handle").count(), 0);
  await page.locator('[data-layer-field="locked"]').uncheck(); await idle();
  await page.locator('[data-canvas-zoom]').selectOption("1"); await idle();
  assert.equal(await page.evaluate(() => editor._preview.renderer.layout.scale), 1);
  await page.locator('[data-canvas-zoom]').selectOption("fit"); await idle();
  await page.locator('[data-action="addText"]').click(); await idle();
  const dangerousText = '<img src=x onerror="window.executed=true">\nWelcome to the game';
  await page.locator('[data-layer-field="text"]').fill(dangerousText); await idle();
  assert.equal(await page.locator(".mso-text-content").textContent(), dangerousText);
  assert.equal(await page.locator(".mso-text-content img").count(), 0);
  await page.locator('[data-layer-field="fontWeight"]').selectOption("700"); await idle();
  await page.locator('[data-layer-field="rotation"]').fill("30"); await idle();
  await page.locator('[data-layer-field="text"]').focus(); await page.keyboard.press("Control+d");
  assert.equal(await page.evaluate(() => editor._draft.layers.length), 2, "Editable controls retain keyboard shortcuts");
  await page.locator('[data-preview]').focus(); await page.keyboard.press("Control+d"); await idle();
  assert.equal(await page.evaluate(() => editor._draft.layers.length), 3);
  await page.locator('[data-action="saveOverlay"]').click(); await idle();
  assert.equal(await page.evaluate(() => store.getState().overlays[0].layers.length), 3);
  await page.evaluate(async () => {
    const { OverlayRenderer } = await import('/scripts/render/renderer.js');
    const output = document.createElement('div'); output.id='broadcast-test'; output.style.cssText='width:960px;height:540px';document.body.append(output);
    globalThis.outputRenderer = new OverlayRenderer(output);await outputRenderer.render(store.getState().overlays[0]);
  });
  assert.equal(await page.locator("#broadcast-test .mso-canvas-controls, #broadcast-test .mso-resize-handle").count(), 0);
  assert.equal(await page.locator("#broadcast-test .mso-text-content").count(), 2);
  await page.evaluate(() => { outputRenderer.destroy(); document.getElementById('broadcast-test').remove(); });
  await page.setViewportSize({ width: 1200, height: 900 }); await idle();
  assert((await page.locator('[data-preview]').boundingBox()).width > 250);
  await mkdir(path.join(root, "work"), { recursive: true });
  await page.screenshot({ path: path.join(root, "work/phase2-editor.png"), fullPage: true });
  assert.deepEqual(await page.evaluate(() => errors), []);
  assert.deepEqual(browserErrors, []);
  console.log("Browser smoke passed: real template/DOM, drag, aspect resize, zoom, locks, shortcuts, safe text, draft Save, and broadcast without editor controls. Foundry ApplicationV2/settings were mocked; Foundry/OBS runtime was not exercised.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
