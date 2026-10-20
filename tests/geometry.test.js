import test from "node:test";
import assert from "node:assert/strict";
import { nativePoint, moveGeometry, resizeGeometry, shortcutCommand } from "../scripts/editor/geometry.js";

const start = { x: 100, y: 200, width: 400, height: 200, rotation: 0, lockAspectRatio: false };
const near = (actual, expected) => assert(Math.abs(actual - expected) < 0.000001, `${actual} differs from ${expected}`);

test("pointer deltas convert CSS coordinates into native pixels at every preview zoom", () => {
  for (const scale of [0.1, 0.25, 0.5, 1, 2, 4]) {
    const point = nativePoint(20 + 960 * scale, 50 + 540 * scale, { left: 20, top: 50 }, scale);
    near(point.x, 960); near(point.y, 540);
  }
  assert.throws(() => nativePoint(0, 0, { left: 0, top: 0 }, 0), /Invalid/);
});

test("movement preserves native coordinates and enforces model limits", () => {
  assert.deepEqual(moveGeometry(start, { x: 30, y: -25 }), { x: 130, y: 175 });
  assert.throws(() => moveGeometry(start, { x: Infinity, y: 0 }), /Invalid/);
  assert.deepEqual(moveGeometry(start, { x: 100000, y: -100000 }), { x: 32768, y: -32768 });
});

test("all eight resize handles keep the opposite anchor stationary", () => {
  const handles = { nw: [-1,-1], n: [0,-1], ne: [1,-1], e: [1,0], se: [1,1], s: [0,1], sw: [-1,1], w: [-1,0] };
  for (const [handle, [hx,hy]] of Object.entries(handles)) {
    const next = resizeGeometry(start, handle, { x: 30, y: 20 });
    near(next.width, start.width + hx * 30);
    near(next.height, start.height + hy * 20);
    near(next.x + next.width / 2 - hx * next.width / 2, start.x + start.width / 2 - hx * start.width / 2);
    near(next.y + next.height / 2 - hy * next.height / 2, start.y + start.height / 2 - hy * start.height / 2);
  }
});

test("rotated resizing projects movement into local axes and preserves opposite corner", () => {
  const rotated = { ...start, rotation: 90 };
  const next = resizeGeometry(rotated, "se", { x: -40, y: 60 });
  near(next.width, 460); near(next.height, 240);
  const anchor = value => ({ x: value.x + value.width/2 + value.height/2, y: value.y + value.height/2 - value.width/2 });
  near(anchor(next).x, anchor(rotated).x); near(anchor(next).y, anchor(rotated).y);
});

test("aspect-locked resizing keeps proportions for corners and side handles", () => {
  for (const handle of ["nw","n","ne","e","se","s","sw","w"]) {
    const next = resizeGeometry({ ...start, lockAspectRatio: true }, handle, { x: 60, y: 30 });
    near(next.width / next.height, 2);
  }
});

test("resize cannot create negative, too-small or excessive dimensions", () => {
  const small = resizeGeometry(start, "se", { x: -10000, y: -10000 });
  assert.equal(small.width, 8); assert.equal(small.height, 8);
  const big = resizeGeometry(start, "se", { x: 10000, y: 10000 });
  assert.equal(big.width, 7680); assert.equal(big.height, 7680);
  const aspect = resizeGeometry({ ...start, lockAspectRatio: true }, "se", { x: -10000, y: -10000 });
  near(aspect.width / aspect.height, 2); assert(aspect.height >= 8);
  assert.throws(() => resizeGeometry(start, "bad", { x: 1, y: 1 }), /Invalid/);
});

test("extreme aspect ratios stay within schema bounds instead of forcing the 8px editor minimum", () => {
  for (const dimensions of [{ width: 1, height: 7680 }, { width: 7680, height: 1 }, { width: 2, height: 3000 }]) {
    const source = { ...start, ...dimensions, lockAspectRatio: true };
    for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      for (const delta of [{ x: -10000, y: -10000 }, { x: 10000, y: 10000 }, { x: 0, y: 0 }]) {
        const next = resizeGeometry(source, handle, delta);
        assert(next.width >= 1 && next.height >= 1);
        assert(next.width <= 7680 && next.height <= 7680);
        near(next.width / next.height, source.width / source.height);
      }
    }
    const unchanged = resizeGeometry(source, "se", { x: 0, y: 0 });
    near(unchanged.width, source.width);
    near(unchanged.height, source.height);
  }
});

test("editor shortcuts move one or ten pixels and support deletion/duplication", () => {
  const event = values => ({ key: "ArrowRight", target: {}, ...values });
  assert.deepEqual(shortcutCommand(event({})), { action: "move", x: 1, y: 0 });
  assert.deepEqual(shortcutCommand(event({ shiftKey: true, key: "ArrowUp" })), { action: "move", x: 0, y: -10 });
  assert.deepEqual(shortcutCommand(event({ key: "Backspace" })), { action: "delete" });
  assert.deepEqual(shortcutCommand(event({ key: "d", metaKey: true })), { action: "duplicate" });
  assert.equal(shortcutCommand(event({ key: "ArrowRight", altKey: true })), null);
});

test("typing in any editable control is never intercepted", () => {
  for (const target of [{ isContentEditable: true }, { closest: () => ({ tagName: "INPUT" }) }]) {
    for (const key of ["Backspace", "Delete", "ArrowLeft", "d"]) assert.equal(shortcutCommand({ target, key, ctrlKey: true }), null);
  }
});
