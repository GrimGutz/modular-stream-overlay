/** Native Chromium UI/renderer acceptance. All settings and Actor fixtures stay in memory.
 * This is not an authenticated Foundry or OBS acceptance run.
 */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.MSO_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url)), output = path.join(root, "work", "phase6-browser");
const handlebars = require.resolve("handlebars/dist/handlebars.js", { paths: ["C:/Program Files/Foundry Virtual Tabletop/resources/app", root] });
const evidence = { createdAt: new Date().toISOString(), scope: "Native Chromium; production editor, adapters, renderer and carousels; synthetic Actors and memory stores",
  exclusions: ["Authenticated Foundry world", "Real Actor data", "OBS/CEF"], checks: [], browserErrors: [] };
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Phase 6 acceptance</title>
<link rel="stylesheet" href="/styles/renderer.css"><link rel="stylesheet" href="/styles/editor.css"><link rel="stylesheet" href="/styles/layer-canvas.css">
<style>html,body{margin:0;background:#1b1b1b;color:#ddd;font:14px Arial}button,input,select,textarea{font:inherit}button{cursor:pointer}.application{position:absolute;inset:12px;background:#18212d;overflow:auto}.window-content{height:100%}.qa-dialog{position:fixed;inset:8% 17%;z-index:1000;background:#fff;color:#111;padding:20px;overflow:auto}.qa-dialog label{display:block;margin:12px 0}.qa-dialog textarea{color:#111;background:white}#production{position:fixed;inset:0}</style></head><body><script src="/handlebars.js"></script><script type="module">
class Application {
 constructor(){this.rendered=false;this.renderCount=0;(globalThis.qaApps??=[]).push(this);} _canRender(){return true;} async _prepareContext(){return {};} async _onRender(){}
 async render(){if(this._canRender({})===false)return this; this.qaRenderPending=true;const context=await this._prepareContext({});this.element?.remove();this.element=document.createElement('div');this.element.className='application mso-editor';this.element.style.zIndex=this.widgetMode?'20':'10';const content=document.createElement('section');content.className='window-content';const template=Object.values(this.constructor.PARTS)[0].template;content.innerHTML=Handlebars.compile(await(await fetch('/'+template.replace(/^modules\\/modular-stream-overlay\\//,''))).text())(context);this.element.append(content);document.body.append(this.element);this.rendered=true;this.renderCount++;this.element.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(target)this.constructor.DEFAULT_OPTIONS.actions[target.dataset.action]?.call(this,event,target);});await this._onRender(context,{});this.qaRenderPending=false;return this;}
 async close(){this.rendered=false;this.element?.remove();return this;}
}
const DialogV2={confirm:async()=>true,input:options=>new Promise(resolve=>{const element=document.createElement('div');element.className='qa-dialog';const form=document.createElement('form');form.innerHTML=options.content.innerHTML;const save=document.createElement('button');save.type='submit';save.textContent='Save';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';form.append(save,cancel);element.append(form);document.body.append(element);const finish=result=>{element.remove();resolve(result);};form.addEventListener('submit',event=>{event.preventDefault();finish(Object.fromEntries(new FormData(form)));});cancel.addEventListener('click',()=>finish(null));options.render?.(null,{element});})};
globalThis.foundry={applications:{api:{ApplicationV2:Application,HandlebarsApplicationMixin:Base=>Base,DialogV2}},utils:{deepClone:value=>structuredClone(value),getRoute:value=>'/'+value.replace(/^\\//,'')}};
const values=new Map(), configs=new Map(); const notices=[];let writes=0;
const gm={id:'gm',isGM:true,role:4};const viewer={id:'cain-test-viewer',isGM:false,role:1};
globalThis.game={view:'game',user:gm,system:{id:'cain',version:'1.3.26'},users:[viewer],modules:new Map([['modular-stream-overlay',{}]]),
 settings:{register(_id,key,config){configs.set(key,config);if(!values.has(key))values.set(key,structuredClone(config.default));},get(_id,key){return values.get(key);},async set(_id,key,value){writes++;values.set(key,structuredClone(value));configs.get(key)?.onChange?.(value);return value;}}};
globalThis.ui={notifications:{info:value=>notices.push(value),warn:value=>notices.push(value),error:value=>notices.push(value)}};
const [{AdapterRegistry},{CharacterDataService,validateAdapterPreferences},{genericAdapter},{cainAdapter},{dnd5eAdapter},{registerSettings,OverlayStore},{registerWidgetSettings,WidgetPresetStore},{createCainCharacter},{installCainPresets,createCainCardPreset,createCainExampleOverlay},{configureEditor},{configureWidgetEditor,WidgetPresetManager},{OverlayRenderer},{validateMappings}]=await Promise.all([
 import('/scripts/core/registry.js'),import('/scripts/data/character-data.js'),import('/scripts/adapters/generic.js'),import('/scripts/adapters/cain.js'),import('/scripts/adapters/dnd5e.js'),import('/scripts/core/store.js'),import('/scripts/core/widget-presets.js'),import('/fixtures/cain-1.3.26.js'),import('/scripts/demo/cain.js'),import('/scripts/ui/editor.js'),import('/scripts/ui/widget-editor.js'),import('/scripts/render/renderer.js'),import('/scripts/data/mappings.js')]);
registerSettings();registerWidgetSettings();values.set('fieldMappings',[]);values.set('adapterPreferences',{});
const actors=[createCainCharacter(),createCainCharacter()];actors[0].img='assets/demo-warrior.svg';actors[1].uuid='Actor.secondCain';actors[1].id='secondCain';actors[1].name='Second synthetic CAIN';actors[1].img='assets/demo-mage.svg';actors[1].system.stress.value=4;
const adapters=new AdapterRegistry();adapters.register(genericAdapter);adapters.register(cainAdapter);adapters.register(dnd5eAdapter);
const store=new OverlayStore(),presets=new WidgetPresetStore();await store.createOverlay('Existing memory overlay');
const data=new CharacterDataService({adapters,getUser:()=>viewer,getSystemId:()=>game.system.id,getSystemVersion:()=>game.system.version,getAdapterPreferences:()=>values.get('adapterPreferences'),getMappings:()=>values.get('fieldMappings'),resolveUuid:async uuid=>actors.find(actor=>actor.uuid===uuid),getActors:()=>({contents:actors}),hooks:null,debounceMs:0});
const api={store,widgetPresets:presets,characterData:data,adapters,getViewerUserId:()=>viewer.id,getOBSUrl:()=>'',getJoinUrl:()=>'',installCainPresets:()=>installCainPresets({store,widgetPresets:presets}),getFieldMappings:()=>validateMappings(values.get('fieldMappings')),setFieldMappings:async value=>{await game.settings.set('', 'fieldMappings',validateMappings(value));data.refresh();},getAdapterPreferences:()=>validateAdapterPreferences(values.get('adapterPreferences')),setAdapterPreferences:async value=>{await game.settings.set('','adapterPreferences',validateAdapterPreferences(value));data.refresh();}};
game.modules.get('modular-stream-overlay').api=api;const config={store,widgetPresets:presets,characterData:data,context:{characterData:data,widgetPresets:presets,reducedMotion:()=>false}};configureEditor(config);configureWidgetEditor(config);
const qa=globalThis.phase6QA={actors,adapters,data,store,presets,api,notices,getWrites:()=>writes};
qa.manager=new WidgetPresetManager();await qa.manager.render();
qa.showCard=async()=>{qa.manager.element.style.display='none';const preset=createCainCardPreset();const overlay=createCainExampleOverlay(preset);overlay.layers[0].actorUuids=actors.map(actor=>actor.uuid);overlay.layers[0].actorUuid=actors[0].uuid;const host=document.createElement('main');host.id='production';document.body.append(host);qa.renderer=new OverlayRenderer(host,{context:{characterData:data,widgetPresets:{list:()=>[preset]},reducedMotion:()=>false,debug:()=>true}});await qa.renderer.render(overlay);qa.view=qa.renderer.compositions.get('cain-example-character');qa.view.pause();};
qa.ready=true;
</script></body></html>`;
const server=createServer(async(request,response)=>{
 try { const pathname=new URL(request.url,'http://localhost').pathname;
  if(pathname==='/'){response.setHeader('Content-Type','text/html');return response.end(html);}
  if(pathname==='/handlebars.js'){response.setHeader('Content-Type','text/javascript');return response.end(await readFile(handlebars));}
  let relative=decodeURIComponent(pathname).slice(1);
  if(relative==='fixtures/cain-1.3.26.js')relative='tests/'+relative;
  else if(!/^(scripts|styles|templates|lang)\/[A-Za-z0-9_./-]+$/.test(relative)&&!/^assets\/demo-(warrior|mage)\.svg$/.test(relative))throw Error('Blocked');
  if(relative.split('/').includes('..'))throw Error('Blocked');
  response.setHeader('Content-Type',relative.endsWith('.json')?'application/json':relative.endsWith('.css')?'text/css':relative.endsWith('.svg')?'image/svg+xml':relative.endsWith('.hbs')?'text/plain':'text/javascript');
  response.end(await readFile(path.join(root,relative)));
 }catch{response.statusCode=404;response.end('Not found');}
});
let browser,page;
async function check(name,operation){try{const detail=await operation();evidence.checks.push({name,status:'passed',...(detail?{detail}:{})});}catch(error){evidence.checks.push({name,status:'failed',error:String(error.stack??error),debug:await page.evaluate(()=>({notices:globalThis.phase6QA?.notices,apps:globalThis.qaApps?.map(app=>({widgetMode:app.widgetMode,rendered:app.rendered,pending:app.qaRenderPending}))})).catch(()=>null)});}await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));}
try{
 await mkdir(output,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,executablePath:process.env.MSO_CHROMIUM_EXECUTABLE||undefined});page=await browser.newPage({viewport:{width:1600,height:1000}});
 page.setDefaultTimeout(10000);page.on('pageerror',error=>evidence.browserErrors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>globalThis.phase6QA?.ready);
 const idle=async()=>{await page.waitForFunction(()=>!phase6QA.manager._busy&&qaApps.filter(app=>app.rendered).every(app=>!app.qaRenderPending)&&![...document.querySelectorAll('.qa-dialog')].length);};
 await check('CAIN examples install through the manager and preserve the active overlay',async()=>{
  const before=await page.evaluate(()=>phase6QA.store.getState().activeOverlayId);
  await page.locator('[data-action="installCainPresets"]').click();await idle();
  assert.equal(await page.evaluate(()=>phase6QA.presets.list().filter(p=>p.id.startsWith('cain-')).length),2);
  assert.equal(await page.evaluate(()=>phase6QA.store.getState().activeOverlayId),before);
  await page.screenshot({path:path.join(output,'manager.png')});
 });
 await check('the designer assigns a temporary synthetic preview and discovers grouped numeric fields',async()=>{
  await page.locator('[data-widget-command="edit"][data-preset-id="cain-exorcist-card"]').click();
  await page.waitForFunction(()=>globalThis.qaApps?.some(app=>app.widgetMode&&app.rendered&&!app.qaRenderPending));
  await page.evaluate(()=>{phase6QA.editor=qaApps.find(app=>app.widgetMode&&app.rendered);});
  await page.locator('[data-action="choosePreviewActor"]').click();
  await page.locator('.qa-dialog [name="actorReference"]').fill('Actor.cainFixture');await page.locator('.qa-dialog button[type="submit"]').click();
  await page.waitForFunction(()=>phase6QA.editor._previewActorUuid==='Actor.cainFixture'&&!phase6QA.editor._busy);
  await page.locator('select[aria-label="Edit shared elements or an information page"]').selectOption('cain-condition-page');
  await page.waitForFunction(()=>!phase6QA.editor._busy);
  await page.locator('[data-layer-list] [data-layer-id="cain-stress"] button').first().click();
  assert.equal(await page.locator('[data-layer-field="binding"] option:checked').textContent(),'Resources · Stress');
  assert.equal(await page.locator('[data-layer-field="binding"] option[value="character.cain.injuries.current"]').count(),1);
  assert.equal(await page.locator('[data-layer-field="binding"] option[value="character.cain.agenda"]').count(),0,'numeric bars filter text fields');
  assert(!await page.evaluate(()=>JSON.stringify(phase6QA.presets.list()).includes('Actor.cainFixture')));
 });
 await check('resource maximum changes only by explicit pairing and the saved preset retains native bindings',async()=>{
  const input=page.locator('[data-layer-field="binding"]');await input.selectOption('character.cain.injuries.current');
  assert.equal(await page.locator('[data-layer-field="maxBinding"]').inputValue(),'character.stress.max');
  await page.getByRole('button',{name:'Use matching maximum',exact:true}).click();
  assert.equal(await page.locator('[data-layer-field="maxBinding"]').inputValue(),'character.cain.injuries.max');
  await page.locator('[data-action="saveOverlay"]').click();await page.waitForFunction(()=>!phase6QA.editor._busy&&!phase6QA.editor._dirty);
  assert.equal(await page.evaluate(()=>phase6QA.presets.list().find(p=>p.id==='cain-exorcist-card').pages[0].layers.find(l=>l.id==='cain-stress').maxBinding),'character.cain.injuries.max');
  await page.screenshot({path:path.join(output,'designer.png')});
  await page.evaluate(()=>phase6QA.editor.close());await page.evaluate(()=>phase6QA.manager.render());
 });
 await check('unsaved scoped mappings preview viewer-safe scalars without writes and invalid JSON stays editable',async()=>{
  const before=await page.evaluate(()=>phase6QA.getWrites());
  await page.locator('[data-action="fieldMappings"]').click();
  const mapping=[{id:'character.testFocus',label:'Focus',type:'number',path:'system.kitPoints.value',systemId:'cain',actorTypes:['character'],testedSystemVersions:['1.3.26']}];
  await page.locator('.qa-dialog [name="mappings"]').fill(JSON.stringify(mapping));
  await page.locator('.qa-dialog [name="mappingPreviewActor"]').selectOption('Actor.cainFixture');
  await page.locator('[data-mapping-preview]').click();await page.waitForFunction(()=>document.querySelector('[data-mapping-result]')?.textContent.includes('character.testFocus'));
  const result=JSON.parse(await page.locator('[data-mapping-result]').textContent());assert.deepEqual(result.values,{'character.testFocus':3});
  assert.equal(await page.evaluate(()=>phase6QA.getWrites()),before);
  await page.locator('.qa-dialog [name="mappings"]').fill('{invalid');await page.locator('[data-mapping-preview]').click();
  await page.waitForFunction(()=>document.querySelector('[data-mapping-result]')?.textContent.includes('valid JSON'));
  await page.locator('.qa-dialog [name="mappings"]').fill(JSON.stringify(mapping));await page.locator('.qa-dialog button[type="submit"]').click();await idle();
  assert.deepEqual(await page.evaluate(()=>phase6QA.api.getFieldMappings()),mapping);
 });
 await check('provider defaults survive dialog serialization and unverified fields remain visible with an explanation',async()=>{
  await page.evaluate(()=>phase6QA.api.setAdapterPreferences({cain:'cain'}));
  await page.locator('[data-action="adapterSettings"]').click();
  assert.equal(await page.locator('.qa-dialog [name="provider"]').inputValue(),'cain');
  await page.locator('.qa-dialog button[type="submit"]').click();await idle();
  assert.deepEqual(await page.evaluate(()=>phase6QA.api.getAdapterPreferences()),{cain:'cain'});
  const state=await page.evaluate(()=>{game.system.version='unverified';const fields=phase6QA.data.fieldDefinitions({actorType:'character'});game.system.version='1.3.26';return{native:fields.find(f=>f.id==='character.cain.cat').status,legacy:fields.find(f=>f.id==='character.hp.current').status};});
  assert.deepEqual(state,{native:'unverified-version',legacy:'available'});
 });
 await check('native browser renders all CAIN pages and both Characters through the production carousel',async()=>{
  await page.evaluate(()=>phase6QA.showCard());const pairs=[];
  for(let i=0;i<8;i++){pairs.push(await page.evaluate(()=>{const state=phase6QA.view.getState();return[state.activeActorUuid,state.activePageId];}));await page.evaluate(()=>phase6QA.view.next());}
  assert.deepEqual(pairs,['Actor.cainFixture','Actor.secondCain'].flatMap(actor=>['cain-condition-page','cain-resources-page','cain-skills-page','cain-progression-page'].map(page=>[actor,page])));
  await page.screenshot({path:path.join(output,'cain-card.png')});
 });
 await check('Stress changes animate on the same DOM and trigger growth without a fabricated HP event',async()=>{
  await page.evaluate(()=>{const q=phase6QA;const renderer=q.view.activeSlot.renderer.carousel.views.get('cain-condition-page').renderer;q.stressElement=renderer.layerElements.get('cain-stress');q.stressFill=q.stressElement.querySelector('.mso-resource-fill');q.initialWidth=parseFloat(q.stressFill.style.width);q.actors[0].system.stress.value=4;q.data.refresh();});
  await page.waitForTimeout(130);const middle=await page.evaluate(()=>({width:parseFloat(phase6QA.stressFill.style.width),initial:phase6QA.initialWidth}));
  assert(middle.width>middle.initial&&middle.width<66.667);
  await page.waitForTimeout(350);
  const final=await page.evaluate(()=>({width:parseFloat(phase6QA.stressFill.style.width),same:phase6QA.view.activeSlot.renderer.carousel.views.get('cain-condition-page').renderer.layerElements.get('cain-stress')===phase6QA.stressElement,rule:phase6QA.renderer.getDiagnostics()[0].lastTrigger?.ruleId}));
  assert(Math.abs(final.width-66.6667)<.1);assert.equal(final.same,true);assert.equal(final.rule,'cain-stress-increase');return{middle,final};
 });
 await check('permission loss removes stale Character data and teardown releases all subscriptions',async()=>{
  await page.evaluate(()=>{phase6QA.actors[0].testUserPermission=()=>false;phase6QA.data.refresh();});
  await page.waitForFunction(()=>phase6QA.view.getState().activeActorUuid==='Actor.secondCain');
  await page.evaluate(()=>phase6QA.renderer.destroy());assert.equal(await page.evaluate(()=>phase6QA.data.subscriptions.size),0);
 });
 assert.deepEqual(evidence.browserErrors,[]);
}catch(error){evidence.fatal=String(error.stack??error);}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await mkdir(output,{recursive:true});evidence.passed=evidence.checks.filter(c=>c.status==='passed').length;evidence.failed=evidence.checks.filter(c=>c.status==='failed').length+Number(Boolean(evidence.fatal));await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log('Phase 6 browser checks: '+evidence.passed+' passed, '+evidence.failed+' failed. Evidence: '+path.join(output,'evidence.json'));if(evidence.failed)process.exitCode=1;}
