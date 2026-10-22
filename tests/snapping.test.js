import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { snapMove, snapResize, snapTargets } from "../scripts/editor/snapping.js";
import { createOverlay } from "../scripts/core/schema.js";
import { createLayer } from "../scripts/core/layers.js";
import { LayerCanvas } from "../scripts/editor/layer-canvas.js";

const canvas = { width: 1920, height: 1080 };
const box = (x, y, width = 100, height = 50, id = `${x}:${y}`) => ({ id, x, y, width, height });

test("a moved box sticks to the canvas middle and edges and shows a full-height guide", () => {
  const snapped = snapMove(box(906, 300), [], canvas, 6);
  assert.equal(snapped.x, 910, "Its center snaps to the vertical middle");
  assert.deepEqual(snapped.guides.find(guide => guide.axis === "x"), { type: "line", axis: "x", position: 960, from: 0, to: 1080, canvas: true });
  assert.equal(snapMove(box(3, 1033), [], canvas, 6).y, 1030, "Bottom edge sticks to the canvas bottom");
  assert.deepEqual(snapMove(box(880, 300), [], canvas, 6), { x: 880, y: 300, guides: [] }, "Nothing beyond the threshold");
});

test("edges and centers align with other layers and the guide spans both boxes", () => {
  const other = box(500, 100, 200, 80, "other");
  const snapped = snapMove(box(504, 400, 100, 50), [other], canvas, 6);
  assert.equal(snapped.x, 500);
  const guide = snapped.guides.find(entry => entry.axis === "x" && entry.position === 500);
  assert.deepEqual([guide.from, guide.to, guide.canvas], [100, 450, false]);
  assert.equal(snapMove(box(548, 400, 100, 50), [other], canvas, 6).x, 550, "Centers align too");
});

test("equal spacing centers a box between neighbours and repeats an existing gap", () => {
  const left = box(100, 500, 100, 50, "left"), right = box(500, 500, 100, 50, "right");
  const between = snapMove(box(302, 510, 100, 50), [left, right], canvas, 6);
  assert.equal(between.x, 300);
  assert.deepEqual(between.guides.filter(guide => guide.type === "gap").map(guide => [guide.from, guide.to, guide.size]), [[200, 300, 100], [400, 500, 100]]);
  const row = [box(100, 700, 100, 50, "a"), box(260, 700, 100, 50, "b")];
  const repeated = snapMove(box(423, 705, 100, 50), row, canvas, 6);
  assert.equal(repeated.x, 420, "A third item keeps the 60 px gap of the first two");
  assert(repeated.guides.some(guide => guide.type === "gap" && guide.size === 60 && guide.from === 360));
  const elsewhere = snapMove(box(423, 900, 100, 50), row, canvas, 6);
  assert.equal(elsewhere.x, 423, "Spacing only applies to boxes in the same row or column");
});

test("resizing snaps only the moving edges and keeps a minimum size", () => {
  const other = box(800, 100, 100, 100, "other");
  const right = snapResize(box(600, 300, 196, 50), "e", [other], canvas, 6);
  assert.deepEqual([right.x, right.width], [600, 200]);
  const left = snapResize(box(803, 300, 200, 50), "sw", [other], canvas, 6);
  assert.deepEqual([left.x, left.width], [800, 203], "The right edge stays where it was");
  assert.equal(snapResize(box(797, 300, 9, 50), "w", [other], canvas, 6, { minSize: 8 }).width, 9, "Never below the minimum");
});

test("snap targets skip the moving, hidden and rotated layers and repeated IDs", () => {
  const layers = [{ id: "self", x: 0, y: 0, width: 10, height: 10 }, { id: "hidden", visible: false, x: 0, y: 0, width: 1, height: 1 },
    { id: "turned", rotation: 45, x: 0, y: 0, width: 1, height: 1 }, { id: "flat", rotation: 360, x: 5, y: 6, width: 7, height: 8 },
    { id: "flat", x: 9, y: 9, width: 9, height: 9 }];
  assert.deepEqual(snapTargets(layers, "self"), [{ id: "flat", x: 5, y: 6, width: 7, height: 8 }]);
});

class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.dataset = {}; this.style = { setProperty(key, value) { this[key] = value; } };
    this.listeners = new Map(); this.captures = new Set(); this.classList = { add() {}, remove() {} }; this.textContent = "";
  }
  append(...children) { children.forEach(child => { child.parentElement = this; this.children.push(child); }); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  setAttribute() {} addEventListener(name, fn) { this.listeners.set(name, fn); } removeEventListener() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 1920, height: 1080 }; }
  setPointerCapture(id) { this.captures.add(id); } hasPointerCapture(id) { return this.captures.has(id); } releasePointerCapture(id) { this.captures.delete(id); }
  focus() {}
  closest(selector) {
    const key = selector === "[data-layer-id]" ? "layerId" : selector === "[data-resize-handle]" ? "resizeHandle" : null;
    return key && this.dataset[key] !== undefined ? this : this.parentElement?.closest?.(selector) ?? null;
  }
}
beforeEach(() => {
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});

test("dragging on the editor canvas snaps, draws guides, clears them and lets Alt place freely", async () => {
  const overlay = createOverlay();
  const anchor = createLayer("color", overlay.canvas); Object.assign(anchor, { x: 200, y: 100, width: 300, height: 100 });
  const moving = createLayer("color", overlay.canvas); Object.assign(moving, { x: 200, y: 400, width: 300, height: 100 });
  overlay.layers.push(anchor, moving);
  const host = new Element("main");
  const layerCanvas = new LayerCanvas({ host, getOverlay: () => overlay });
  await layerCanvas.render(overlay); layerCanvas.setZoom(1);
  const target = layerCanvas.controls.children.find(node => node.dataset.layerId === moving.id);
  const pointer = values => ({ target, button: 0, pointerId: 1, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {}, ...values });
  layerCanvas.pointerDown(pointer());
  layerCanvas.pointerMove(pointer({ clientX: 4, clientY: 10 }));
  assert.equal(moving.x, 200, "The left edge sticks to the layer above");
  const guides = layerCanvas.controls.children.find(node => node.className === "mso-snap-guides");
  assert(guides.children.some(node => node.className.startsWith("mso-snap-line mso-snap-line-x") && node.style.left === "200px"));
  layerCanvas.pointerMove(pointer({ clientX: 4, clientY: 10, altKey: true }));
  assert.equal(moving.x, 204, "Alt places the layer freely");
  layerCanvas.pointerUp(pointer({ clientX: 4, clientY: 10, altKey: true }));
  assert(!layerCanvas.controls.children.some(node => node.className === "mso-snap-guides"), "Guides disappear after the drag");
  layerCanvas.setSnapping(false);
  layerCanvas.pointerDown(pointer()); layerCanvas.pointerMove(pointer({ clientX: -2, clientY: 0 }));
  assert.equal(moving.x, 202, "Snapping can be turned off");
  layerCanvas.pointerUp(pointer({ clientX: -2, clientY: 0 }));
  layerCanvas.destroy();
});
