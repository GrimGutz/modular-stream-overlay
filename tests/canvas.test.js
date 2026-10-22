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
  remove() { if(this.parent) this.parent.children=this.parent.children.filter(child=>child!==this); }
  setAttribute(key,value) { this.attributes[key]=value; }
  addEventListener(name,fn) { this.listeners.set(name,fn); }
  removeEventListener(name,fn) { if(this.listeners.get(name)===fn)this.listeners.delete(name); }
  getBoundingClientRect() { return { left:0,top:0,width:parseFloat(this.style.width)||960,height:parseFloat(this.style.height)||540 }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  focus() { this.focused=true; }
  closest(selector) {
    const key = { "[data-layer-id]": "layerId", "[data-resize-handle]": "resizeHandle", "[data-rotate-handle]": "rotateHandle", "[data-guide-axis]": "guideAxis", "[data-ruler]": "ruler", "[data-group-handle]": "groupHandle", "[data-group-rotate]": "groupRotate" }[selector] ?? null;
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
  const host=new Element("main"); const changes=[], selections=[], commands=[], payloads=[]; let blocked=false;
  const canvas=new LayerCanvas({host,widgets,getOverlay:()=>overlay,onChange:value=>changes.push({...value}),onSelect:(id,ids)=>selections.push(ids?[id,ids]:id),onCommand:(action,payload)=>{commands.push(action);payloads.push(payload);},copyText:()=>"COPIED",isBlocked:()=>blocked});
  return {overlay,layer,host,canvas,changes,selections,commands,payloads,block:()=>{blocked=true;}};
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
  assert.equal(selection.dataset.layerId,f.layer.id);assert.equal(selection.children.filter(node=>node.dataset.resizeHandle).length,8);
  assert.equal(selection.children.filter(node=>node.dataset.rotateHandle!==undefined).length,1,"One rotation handle");
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


const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const shortcut=(f,values)=>({key:"v",code:"KeyV",ctrlKey:true,target:f.host,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...values});
const clipboardEvent=(type,data={})=>({type,clipboardData:{getData:()=>data.text??"",setData(kind,value){data[kind]=value;}},preventDefault(){this.prevented=true;},stopPropagation(){}});

test("copy, cut and paste wait for the browser's clipboard event so the system clipboard is used",async()=>{
  const f=fixture();await f.canvas.render(f.overlay);
  const paste=shortcut(f);f.canvas.keyDown(paste);
  assert.equal(paste.prevented,undefined,"The browser still raises its paste event");assert.equal(paste.stopped,true,"Foundry does not see the key");
  assert.deepEqual(f.commands,[]);
  const pasted=clipboardEvent("paste",{text:"from another world"});f.canvas.clipboardEvent(pasted);
  assert.deepEqual(f.commands,["paste"]);assert.deepEqual(f.payloads[0],{text:"from another world"});assert.equal(pasted.prevented,true);
  f.canvas.keyDown(shortcut(f,{key:"c",code:"KeyC"}));await tick();
  assert.equal(f.commands.length,1,"Copy without a selection does nothing");
  f.canvas.select(f.layer.id);f.canvas.keyDown(shortcut(f,{key:"с",code:"KeyC"}));
  const data={};f.canvas.clipboardEvent(clipboardEvent("copy",data));
  assert.equal(data["text/plain"],"COPIED");assert.deepEqual([f.commands.at(-1),f.payloads.at(-1)],["copy",{copied:true}]);
  f.canvas.clipboardEvent(clipboardEvent("copy",{}));assert.equal(f.commands.length,2,"A copy event the canvas did not ask for is ignored");
  f.canvas.keyDown(shortcut(f,{key:"x",code:"KeyX"}));await tick();
  assert.deepEqual([f.commands.at(-1),f.payloads.at(-1)],["cut",undefined],"Without a clipboard event the editor falls back to its own copy");
  f.canvas.keyDown(shortcut(f,{key:"z",code:"KeyZ"}));f.canvas.keyDown(shortcut(f,{key:"z",code:"KeyZ",shiftKey:true}));
  assert.deepEqual(f.commands.slice(-2),["undo","redo"]);
  f.canvas.destroy();
});

function group(){
  const f=fixture();const second=createLayer("text",f.overlay.canvas);Object.assign(second,{x:900,y:80,width:200,height:100,z:5});
  const locked=createLayer("color",f.overlay.canvas);Object.assign(locked,{x:0,y:0,width:1920,height:1080,z:-1,locked:true});
  f.overlay.layers.push(second,locked);return {...f,second,locked};
}

test("Shift/Ctrl-click builds a selection and dragging one selected layer moves them all",async()=>{
  const f=group();await f.canvas.render(f.overlay);f.canvas.setZoom(1);f.canvas.setSnapping(false);
  const hit=id=>f.canvas.controls.children.find(node=>node.dataset.layerId===id&&node.className==="mso-layer-hit");
  f.canvas.pointerDown(event(hit(f.layer.id)));f.canvas.pointerUp(event(hit(f.layer.id)));
  f.canvas.pointerDown(event(hit(f.second.id),{shiftKey:true}));
  assert.deepEqual(f.canvas.selectedIds,[f.layer.id,f.second.id]);assert.equal(f.canvas.selectedId,f.second.id);
  assert.deepEqual(f.selections.at(-1),[f.second.id,[f.layer.id,f.second.id]]);
  assert.equal(f.canvas.controls.children.filter(node=>node.className==="mso-group-selection").length,1);
  const frame=f.canvas.controls.children.find(node=>node.className==="mso-group-selection");
  assert.equal(frame.children.filter(node=>node.dataset.groupHandle).length,8,"The selection frame has its own handles");
  assert(f.canvas.controls.children.filter(node=>node.className==="mso-layer-selection").every(node=>!node.children.length),"Single-layer handles are hidden");
  f.canvas.pointerDown(event(hit(f.layer.id)));f.canvas.pointerMove(event(hit(f.layer.id),{clientX:40,clientY:50}));f.canvas.pointerUp(event(hit(f.layer.id),{clientX:40,clientY:50}));
  assert.deepEqual([f.layer.x,f.layer.y,f.second.x,f.second.y],[130,110,930,110]);assert.deepEqual(f.locked.x,0);
  assert.deepEqual(f.canvas.selectedIds,[f.layer.id,f.second.id],"Dragging keeps the selection");
  f.canvas.keyDown(event(f.host,{key:"ArrowLeft",shiftKey:true}));assert.deepEqual([f.layer.x,f.second.x],[120,920]);
  f.canvas.pointerDown(event(hit(f.second.id)));f.canvas.pointerUp(event(hit(f.second.id)));
  assert.deepEqual(f.canvas.selectedIds,[f.second.id],"A click without dragging selects just that layer");
  f.canvas.pointerDown(event(hit(f.second.id),{ctrlKey:true}));assert.deepEqual(f.canvas.selectedIds,[]);
  f.canvas.destroy();
});

test("dragging on empty space or a locked background selects the layers inside the rectangle",async()=>{
  const f=group();await f.canvas.render(f.overlay);f.canvas.setZoom(1);
  const background=f.canvas.controls.children.find(node=>node.dataset.layerId===f.locked.id);
  f.canvas.pointerDown(event(background,{clientX:90,clientY:70}));
  assert.deepEqual(f.canvas.selectedIds,[f.locked.id],"Pressing a locked layer selects it");
  f.canvas.pointerMove(event(background,{clientX:760,clientY:460}));
  assert.deepEqual(f.canvas.selectedIds,[f.layer.id],"Only layers fully inside; the locked background stays out");
  assert.equal(f.canvas.controls.children.at(-1).className,"mso-marquee");
  f.canvas.pointerUp(event(background,{clientX:1200,clientY:460}));
  assert.deepEqual(f.canvas.selectedIds,[f.layer.id,f.second.id]);assert.deepEqual(f.selections.at(-1),[f.second.id,[f.layer.id,f.second.id]]);
  assert.equal(f.host.captures.size,0);assert(!f.canvas.controls.children.some(node=>node.className==="mso-marquee"));
  assert.equal(f.changes.length,0,"Selecting never edits the draft");
  f.canvas.keyDown(event(f.host,{key:"Escape"}));assert.deepEqual(f.canvas.selectedIds,[]);
  f.canvas.keyDown(event(f.host,{key:"a",code:"KeyA",ctrlKey:true}));
  assert.deepEqual(f.canvas.selectedIds,[f.layer.id,f.second.id],"Ctrl+A selects every visible unlocked layer");
  f.canvas.pointerDown(event(background,{clientX:5,clientY:5}));f.canvas.pointerMove(event(background,{clientX:50,clientY:50}));
  f.canvas.keyDown(event(f.host,{key:"Escape"}));assert.deepEqual(f.canvas.selectedIds,[f.locked.id],"Escape restores the selection before the rectangle");
  f.canvas.destroy();
});

test("copy raised by the key press itself writes the clipboard once, with no fallback afterwards",async()=>{
  const f=fixture();await f.canvas.render(f.overlay);f.canvas.select(f.layer.id);
  const data={};document.execCommand=action=>{f.canvas.clipboardEvent(clipboardEvent(action,data));return true;};
  const copy=shortcut(f,{key:"c",code:"KeyC"});f.canvas.keyDown(copy);await tick();
  assert.equal(data["text/plain"],"COPIED");assert.equal(copy.prevented,true);
  assert.deepEqual(f.commands,["copy"],"The fallback does not copy a second time");
  delete document.execCommand;f.canvas.destroy();
});

test("the rotation handle turns a layer around its center; Shift snaps to 15° and near-straight angles snap",async()=>{
  const f=fixture();await f.canvas.render(f.overlay);f.canvas.setZoom(1);f.canvas.select(f.layer.id);
  // Layer 100,80 640×360: center 420,260. The handle starts straight above the center.
  const rotate=()=>f.canvas.controls.children.at(-1).children.find(node=>node.dataset.rotateHandle!==undefined);
  f.canvas.pointerDown(event(rotate(),{clientX:420,clientY:60}));
  f.canvas.pointerMove(event(rotate(),{clientX:620,clientY:260}));assert.equal(f.layer.rotation,90);
  f.canvas.pointerMove(event(rotate(),{clientX:620,clientY:200}));assert.equal(f.layer.rotation,73.3);
  f.canvas.pointerMove(event(rotate(),{clientX:620,clientY:200,shiftKey:true}));assert.equal(f.layer.rotation,75);
  f.canvas.pointerMove(event(rotate(),{clientX:425,clientY:60}));assert.equal(f.layer.rotation,0,"Within 2° of straight snaps");
  f.canvas.pointerMove(event(rotate(),{clientX:425,clientY:60,altKey:true}));assert.equal(f.layer.rotation,1.4);
  f.canvas.keyDown(event(f.host,{key:"Escape"}));assert.equal(f.layer.rotation,0,"Escape restores the angle");
  assert.equal(f.layer.x,100,"Rotation never moves the layer");
  f.canvas.destroy();
});

test("clicking a grouped layer selects its group and drags it; clicking again picks just that layer",async()=>{
  const f=group();Object.assign(f.layer,{groupId:"group-1",groupName:"Pair"});Object.assign(f.second,{groupId:"group-1",groupName:"Pair"});
  await f.canvas.render(f.overlay);f.canvas.setZoom(1);f.canvas.setSnapping(false);
  const hit=id=>f.canvas.controls.children.find(node=>node.dataset.layerId===id&&node.className==="mso-layer-hit");
  f.canvas.pointerDown(event(hit(f.second.id)));
  assert.deepEqual(f.canvas.selectedIds,[f.layer.id,f.second.id]);assert.equal(f.canvas.selectedId,f.second.id);
  f.canvas.pointerMove(event(hit(f.second.id),{clientX:30,clientY:20}));f.canvas.pointerUp(event(hit(f.second.id),{clientX:30,clientY:20}));
  assert.deepEqual([f.layer.x,f.second.x],[120,920],"The whole group moved");
  f.canvas.pointerDown(event(hit(f.second.id)));f.canvas.pointerUp(event(hit(f.second.id)));
  assert.deepEqual(f.canvas.selectedIds,[f.second.id]);
  f.canvas.select(null);f.canvas.pointerDown(event(hit(f.layer.id),{shiftKey:true}));
  assert.deepEqual(f.canvas.selectedIds,[f.layer.id,f.second.id],"Shift-click adds the whole group");
  f.canvas.select(null);
  const background=f.canvas.controls.children.find(node=>node.dataset.layerId===f.locked.id);
  f.canvas.pointerDown(event(background,{clientX:90,clientY:70}));f.canvas.pointerUp(event(background,{clientX:760,clientY:460}));
  assert.deepEqual(f.canvas.selectedIds,[f.layer.id,f.second.id],"A rectangle around one member selects its group");
  f.canvas.destroy();
});

test("guides come out of the rulers, snap moved layers, and go back into the ruler to be removed",async()=>{
  const f=fixture();const saved=[];f.canvas.onGuides=guides=>saved.push(guides);
  await f.canvas.render(f.overlay);f.canvas.setZoom(1);f.canvas.setRulers(true);
  const [top,left]=[f.canvas.rulers.top,f.canvas.rulers.left];
  assert.equal(top.hidden,false);assert.equal(top.dataset.ruler,"y");
  f.canvas.pointerDown(event(left,{clientX:10,clientY:300}));f.canvas.pointerMove(event(left,{clientX:803,clientY:300}));
  const live=f.canvas.controls.children.find(node=>node.dataset.guideAxis==="x");
  assert.equal(live.style.left,"803px");assert.equal(live.children[0].textContent,"803","The position shows while dragging");
  f.canvas.pointerUp(event(left,{clientX:803,clientY:300}));
  assert.deepEqual(saved.at(-1),{x:[803],y:[]});
  f.canvas.select(f.layer.id);const box=f.canvas.controls.children.find(node=>node.className==="mso-layer-hit");
  // Right edge 740 dragged by 60 lands at 800, within reach of the guide at 803.
  f.canvas.pointerDown(event(box,{clientX:10,clientY:20}));f.canvas.pointerMove(event(box,{clientX:70,clientY:20}));f.canvas.pointerUp(event(box,{clientX:70,clientY:20}));
  assert.equal(f.layer.x+f.layer.width,803);
  const guide=f.canvas.controls.children.find(node=>node.dataset.guideAxis==="x");
  f.canvas.pointerDown(event(guide,{clientX:803,clientY:300}));f.canvas.pointerUp(event(guide,{clientX:5,clientY:300}));
  assert.deepEqual(saved.at(-1),{x:[],y:[]},"Dropped on the ruler, the guide is gone");
  f.canvas.setRulers(false);assert.equal(top.hidden,true);
  f.canvas.destroy();
});

test("the grid draws and snaps edges to its lines",async()=>{
  const f=fixture();await f.canvas.render(f.overlay);f.canvas.setZoom(1);f.canvas.setGrid(50);
  assert.equal(f.canvas.controls.children[0].className,"mso-grid");assert.equal(f.canvas.controls.children[0].style["--mso-grid-size"],"50px");
  f.canvas.select(f.layer.id);const box=f.canvas.controls.children.find(node=>node.className==="mso-layer-hit");
  f.canvas.pointerDown(event(box,{clientX:10,clientY:20}));f.canvas.pointerMove(event(box,{clientX:57,clientY:20}));f.canvas.pointerUp(event(box,{clientX:57,clientY:20}));
  assert.equal(f.layer.x,150,"147 snaps to the grid line at 150");
  f.canvas.setGrid(0);assert(!f.canvas.controls.children.some(node=>node.className==="mso-grid"));
  f.canvas.destroy();
});

test("the selection frame resizes and turns every selected layer together",async()=>{
  const f=group();await f.canvas.render(f.overlay);f.canvas.setZoom(1);f.canvas.setSnapping(false);
  // layer 100,80 640×360 and second 900,80 200×100: frame 100,80 → 1100,440.
  f.canvas.setSelection([f.layer.id,f.second.id]);
  const frame=()=>f.canvas.controls.children.find(node=>node.className==="mso-group-selection");
  const handle=direction=>frame().children.find(node=>node.dataset.groupHandle===direction);
  f.canvas.pointerDown(event(handle("e"),{clientX:1100,clientY:200}));f.canvas.pointerMove(event(handle("e"),{clientX:1600,clientY:200}));
  // The frame grows from 1000 to 1500 wide: ×1.5 horizontally from its left edge.
  assert.deepEqual([f.second.x,f.second.width,f.second.y,f.second.height],[1300,300,80,100]);
  assert.deepEqual([f.layer.x,f.layer.width],[260,640],"The aspect-locked image keeps its size (×1 vertically) while its center moves");
  assert.equal(frame().style.width,"1340px","The frame follows the layers");
  f.canvas.keyDown(event(f.host,{key:"Escape"}));
  assert.deepEqual([f.second.x,f.second.width],[900,200],"Escape restores every layer");
  // Turning by 90° around the frame center (600, 260).
  const rotate=frame().children.find(node=>node.dataset.groupRotate!==undefined);
  f.canvas.pointerDown(event(rotate,{clientX:600,clientY:60}));f.canvas.pointerMove(event(rotate,{clientX:800,clientY:260,shiftKey:true}));
  assert.deepEqual([f.layer.rotation,f.second.rotation],[90,90]);
  assert.deepEqual([Math.round(f.second.x+f.second.width/2),Math.round(f.second.y+f.second.height/2)],[730,660],"Each layer's center turns around the frame center");
  f.canvas.pointerUp(event(rotate,{clientX:800,clientY:260,shiftKey:true}));
  assert(f.changes.length>0);assert.equal(f.locked.rotation,0,"Locked layers stay put");
  f.canvas.destroy();
});

test("Alt shows distances to the nearest layers and canvas edges, or to a hovered layer",async()=>{
  const f=group();await f.canvas.render(f.overlay);f.canvas.setZoom(1);f.canvas.select(f.layer.id);
  const sizes=()=>f.canvas.controls.children.find(node=>node.className==="mso-measure")?.children.map(node=>`${node.className.split(" ")[1]}:${node.children[0].textContent}`)??[];
  f.canvas.keyDown(event(f.host,{key:"Alt"}));
  // Layer 100,80 640×360; the text layer at 900 is 160 px to the right; above and below run to the canvas edges.
  assert.deepEqual(sizes(),["mso-measure-x:100","mso-measure-x:160","mso-measure-y:80","mso-measure-y:640"]);
  const hit=f.canvas.controls.children.find(node=>node.dataset.layerId===f.locked.id);
  f.canvas.pointerMove(event(hit,{altKey:true}));
  assert.deepEqual(sizes(),["mso-measure-x:100","mso-measure-x:1180","mso-measure-y:80","mso-measure-y:640"],"Inside a hovered container, to its inner edges");
  f.canvas.host.listeners.get("keyup")?.({key:"Alt"});
  assert.deepEqual(sizes(),[],"Releasing Alt hides them");
  f.canvas.destroy();
});
