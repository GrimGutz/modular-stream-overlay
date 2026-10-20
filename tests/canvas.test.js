import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createOverlay } from "../scripts/core/schema.js";
import { createLayer } from "../scripts/core/layers.js";
import { WidgetRegistry } from "../scripts/core/registry.js";
import { LayerCanvas } from "../scripts/editor/layer-canvas.js";

class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.dataset = {}; this.style = { setProperty(key,value) { this[key]=value; } };
    this.attributes = {}; this.listeners = new Map(); this.classes = new Set(); this.captures = new Set();
    this.classList = { add: value => this.classes.add(value), remove: value => this.classes.delete(value) };
  }
  set className(value) { this._className=value; this.classes=new Set(value.split(" ")); }
  get className() { return this._className; }
  append(...children) { children.forEach(child => { child.parent=this; this.children.push(child); }); }
  replaceChildren(...children) { this.children=[]; this.append(...children); }
  setAttribute(key,value) { this.attributes[key]=value; }
  addEventListener(name,fn) { this.listeners.set(name,fn); }
  removeEventListener(name,fn) { if(this.listeners.get(name)===fn)this.listeners.delete(name); }
  getBoundingClientRect() { return { left:0,top:0,width:parseFloat(this.style.width)||960,height:parseFloat(this.style.height)||540 }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  focus() { this.focused=true; }
  closest(selector) {
    const key = selector === "[data-layer-id]" ? "layerId" : selector === "[data-resize-handle]" ? "resizeHandle" : null;
    return key && this.dataset[key] !== undefined ? this : this.parent?.closest(selector) ?? null;
  }
}

beforeEach(() => {
  globalThis.document={createElement:tag=>new Element(tag)};
  globalThis.ResizeObserver=class {observe(){}disconnect(){this.disconnected=true;}};
});
function fixture(widgets) {
  const overlay=createOverlay(); const layer=createLayer("image",overlay.canvas); layer.x=100;layer.y=80;
  overlay.layers.push(layer);
  const host=new Element("main"); const changes=[], selections=[], commands=[]; let blocked=false;
  const canvas=new LayerCanvas({host,widgets,getOverlay:()=>overlay,onChange:value=>changes.push({...value}),onSelect:id=>selections.push(id),onCommand:action=>commands.push(action),isBlocked:()=>blocked});
  return {overlay,layer,host,canvas,changes,selections,commands,block:()=>{blocked=true;}};
}
const event=(target, values={})=>({target,button:0,pointerId:1,clientX:10,clientY:20,preventDefault(){},stopPropagation(){},...values});

test("click selection and empty-space clearing never alter the draft",async()=>{
  const f=fixture();await f.canvas.render(f.overlay);
  const box=f.canvas.controls.children[0];
  f.canvas.pointerDown(event(box));f.canvas.pointerUp(event(box));
  assert.equal(f.canvas.selectedId,f.layer.id);assert.equal(f.changes.length,0);
  assert.equal(f.host.captures.size,0);
  f.canvas.pointerDown(event(f.canvas.controls));
  assert.equal(f.canvas.selectedId,null);assert.equal(f.changes.length,0);
  f.canvas.destroy();
});

test("dragging converts preview deltas to native coordinates without replacing renderer stage",async()=>{
  const f=fixture();await f.canvas.render(f.overlay);f.canvas.setZoom(.5);
  const root=f.canvas.renderer.root;const box=f.canvas.controls.children[0];
  f.canvas.pointerDown(event(box));f.canvas.pointerMove(event(box,{clientX:40,clientY:40}));
  assert.equal(f.layer.x,160);assert.equal(f.layer.y,120);
  assert.equal(f.canvas.renderer.root,root);assert.equal(f.changes.length,1);
  assert.equal(f.canvas.renderer.layerElements.get(f.layer.id).style.left,"160px");
  const matches=f.canvas.controls.children.filter(node=>node.dataset.layerId===f.layer.id);
  assert(matches.every(node=>node.style.left==="160px"));
  f.canvas.pointerUp(event(box,{clientX:40,clientY:40}));assert.equal(f.changes.length,1);
  f.canvas.destroy();
});

test("selected handles remain above overlaps and aspect resizing preserves source proportions",async()=>{
  const f=fixture();const above=createLayer("text",f.overlay.canvas);above.z=10;f.overlay.layers.push(above);
  await f.canvas.render(f.overlay);f.canvas.setZoom(1);f.canvas.select(f.layer.id);
  const selection=f.canvas.controls.children.at(-1);
  assert.equal(selection.dataset.layerId,f.layer.id);assert.equal(selection.children.length,8);
  const handle=selection.children.find(node=>node.dataset.resizeHandle==="se");
  f.canvas.pointerDown(event(handle));f.canvas.pointerMove(event(handle,{clientX:110,clientY:60}));
  assert(f.layer.width>640);assert(Math.abs(f.layer.width/f.layer.height-640/360)<.000001);
  f.canvas.pointerUp(event(handle,{clientX:110,clientY:60}));f.canvas.destroy();
});

test("locked layers select without moving or handles; hidden layers have no hit targets",async()=>{
  const f=fixture();f.layer.locked=true;await f.canvas.render(f.overlay);
  const box=f.canvas.controls.children[0];f.canvas.pointerDown(event(box));
  assert.equal(f.canvas.selectedId,f.layer.id);assert.equal(f.canvas.gesture,null);
  assert.equal(f.canvas.controls.children.at(-1).children.length,0);
  f.canvas.keyDown(event(f.host,{key:"ArrowRight"}));assert.equal(f.layer.x,100);
  f.layer.visible=false;await f.canvas.render(f.overlay);assert.equal(f.canvas.controls.children.length,0);
  f.canvas.destroy();
});

test("Escape/pointer cancellation restores the gesture origin and releases capture",async()=>{
  const f=fixture();await f.canvas.render(f.overlay);f.canvas.setZoom(1);
  const box=f.canvas.controls.children[0];f.canvas.pointerDown(event(box));f.canvas.pointerMove(event(box,{clientX:60,clientY:20}));
  assert.equal(f.layer.x,150);f.canvas.keyDown(event(f.host,{key:"Escape"}));
  assert.equal(f.layer.x,100);assert.equal(f.canvas.gesture,null);assert.equal(f.host.captures.size,0);
  f.canvas.pointerDown(event(f.canvas.controls.children[0]));f.canvas.pointerMove(event(box,{clientX:25,clientY:20}));
  f.canvas.pointerCancel(event(box));assert.equal(f.layer.x,100);f.canvas.destroy();
});

test("scoped shortcuts route commands and ignore editable inputs and blocked edits",async()=>{
  const f=fixture();await f.canvas.render(f.overlay);f.canvas.select(f.layer.id);
  f.canvas.keyDown(event(f.host,{key:"ArrowRight",shiftKey:true}));assert.equal(f.layer.x,110);
  f.canvas.keyDown(event(f.host,{key:"d",ctrlKey:true}));f.canvas.keyDown(event(f.host,{key:"Delete"}));
  assert.deepEqual(f.commands,["duplicate","delete"]);
  f.canvas.keyDown(event({isContentEditable:true},{key:"ArrowRight"}));assert.equal(f.layer.x,110);
  f.block();f.canvas.keyDown(event(f.host,{key:"ArrowRight"}));assert.equal(f.layer.x,110);
  f.canvas.destroy();assert.equal(f.host.listeners.size,0);assert.equal(f.canvas.resizeObserver.disconnected,true);
});

test("controller cleanup removes every editor control while broadcast renderer remains separate",async()=>{
  const f=fixture();await f.canvas.render(f.overlay);f.canvas.select(f.layer.id);
  assert(f.canvas.controls.children.length>0);assert.equal(f.canvas.renderer.root.children.length,1);
  assert.equal(f.canvas.renderer.root.children[0].className,"mso-layer");
  f.canvas.destroy();assert.equal(f.host.children.length,0);
});

test("pending widget rendering blocks gestures and shortcuts until the current scene is ready",async()=>{
  let finish;
  const widgets=new WidgetRegistry();
  widgets.register({id:"slow",label:"Slow",render:()=>new Promise(resolve=>{finish=resolve;})});
  const f=fixture(widgets);await f.canvas.render(f.overlay);f.canvas.select(f.layer.id);f.canvas.setZoom(1);
  const oldBox=f.canvas.controls.children[0];
  f.overlay.widgets.push({id:"slow-widget",type:"slow",config:{}});
  const rendering=f.canvas.render(f.overlay);
  f.canvas.pointerDown(event(oldBox));f.canvas.pointerMove(event(oldBox,{clientX:110}));
  for(const values of [{key:"ArrowRight"},{key:"d",ctrlKey:true},{key:"Delete"}]) f.canvas.keyDown(event(f.host,values));
  assert.equal(f.canvas.gesture,null);assert.equal(f.host.captures.size,0);
  assert.equal(f.layer.x,100);assert.equal(f.changes.length,0);assert.deepEqual(f.commands,[]);
  finish();await rendering;
  f.canvas.keyDown(event(f.host,{key:"ArrowRight"}));
  assert.equal(f.layer.x,101);assert.equal(f.canvas.renderer.layerElements.get(f.layer.id).style.left,"101px");
  const box=f.canvas.controls.children[0];
  f.canvas.pointerDown(event(box));f.canvas.pointerUp(event(box,{clientX:20}));
  assert.equal(f.layer.x,111);assert.equal(f.canvas.renderer.layerElements.get(f.layer.id).style.left,"111px");
  f.canvas.destroy();
});

test("older render completion cannot unlock a newer pending scene or overwrite newer gesture output",async()=>{
  const completions=[];
  const widgets=new WidgetRegistry();
  widgets.register({id:"slow",label:"Slow",render:()=>new Promise(resolve=>completions.push(resolve))});
  const f=fixture(widgets);await f.canvas.render(f.overlay);f.canvas.select(f.layer.id);
  f.overlay.widgets.push({id:"slow-widget",type:"slow",config:{}});
  const older=f.canvas.render(f.overlay);const newer=f.canvas.render(f.overlay);
  completions[0]();await older;
  f.canvas.keyDown(event(f.host,{key:"ArrowRight"}));
  f.canvas.pointerDown(event(f.canvas.controls.children[0]));
  assert.equal(f.layer.x,100);assert.equal(f.canvas.gesture,null);
  completions[1]();await newer;
  f.canvas.keyDown(event(f.host,{key:"ArrowRight"}));assert.equal(f.layer.x,101);
  const anotherOld=f.canvas.render(f.overlay);const latest=f.canvas.render(f.overlay);
  completions[3]();await latest;
  f.canvas.keyDown(event(f.host,{key:"ArrowRight"}));assert.equal(f.layer.x,102);
  const root=f.canvas.renderer.root;const controls=f.canvas.controls;
  completions[2]();await anotherOld;
  assert.equal(f.canvas.renderer.root,root);assert.equal(f.canvas.controls,controls);
  assert.equal(f.canvas.renderer.layerElements.get(f.layer.id).style.left,"102px");
  f.canvas.keyDown(event(f.host,{key:"ArrowRight"}));assert.equal(f.layer.x,103);
  f.canvas.destroy();
});

test("failed rendering releases interaction blocking and destroying a pending render cannot restore controls",async()=>{
  let finish;
  const widgets=new WidgetRegistry();
  widgets.register({id:"slow",label:"Slow",render:()=>new Promise(resolve=>{finish=resolve;})});
  const f=fixture(widgets);await f.canvas.render(f.overlay);f.canvas.select(f.layer.id);
  f.overlay.background.src="https://example.com/invalid.png";
  await assert.rejects(f.canvas.render(f.overlay),/relative path/);
  f.overlay.background.src="";
  f.canvas.keyDown(event(f.host,{key:"ArrowRight"}));
  assert.equal(f.layer.x,101);assert.equal(f.canvas.renderer.layerElements.get(f.layer.id).style.left,"101px");
  f.overlay.widgets.push({id:"slow-widget",type:"slow",config:{}});
  const rendering=f.canvas.render(f.overlay);
  f.canvas.destroy();finish();await rendering;
  assert.equal(f.host.children.length,0);assert.equal(f.canvas.renderer.root,null);
  assert.equal(f.host.listeners.size,0);assert.equal(f.canvas.pendingRenderGeneration,null);
  f.canvas.keyDown(event(f.host,{key:"ArrowRight"}));assert.equal(f.layer.x,101);
});
