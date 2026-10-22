import test from "node:test";
import assert from "node:assert/strict";
import { rulerSteps } from "../scripts/editor/rulers.js";
import { snapMove, snapResize } from "../scripts/editor/snapping.js";
import { shortcutCommand } from "../scripts/editor/geometry.js";

const canvas = { width: 1920, height: 1080 };

test("ruler labels stay readable at every zoom", () => {
  assert.deepEqual(rulerSteps(0.5), { major: 200, minor: 20 });
  assert.deepEqual(rulerSteps(1), { major: 100, minor: 10 });
  assert.deepEqual(rulerSteps(2), { major: 50, minor: 5 });
  assert.deepEqual(rulerSteps(0.1), { major: 1000, minor: 100 });
});

test("ruler guides and the grid attract edges without drawing their own snap lines", () => {
  const box = { x: 397, y: 203, width: 100, height: 50 };
  const guided = snapMove(box, [], canvas, 6, { guides: { x: [400], y: [] } });
  assert.deepEqual([guided.x, guided.y], [400, 203]);
  assert(!guided.guides.some(guide => guide.position === 400), "The guide is already visible");
  const gridded = snapMove(box, [], canvas, 6, { grid: 25 });
  assert.deepEqual([gridded.x, gridded.y], [400, 200]);
  assert.deepEqual([snapMove({ ...box, x: 410 }, [], canvas, 6, { grid: 25 }).x], [410], "Out of reach stays put");
  const resized = snapResize({ x: 0, y: 0, width: 197, height: 100 }, "e", [], canvas, 6, { grid: 50 });
  assert.equal(resized.width, 200);
});

test("Ctrl/Cmd+G groups and Ctrl/Cmd+Shift+G ungroups, on any keyboard layout", () => {
  const key = values => ({ key: "g", code: "KeyG", ctrlKey: true, target: { closest: () => null }, ...values });
  assert.deepEqual(shortcutCommand(key()), { action: "group" });
  assert.deepEqual(shortcutCommand(key({ key: "п", shiftKey: true })), { action: "ungroup" });
  assert.deepEqual(shortcutCommand(key({ key: "a", code: "KeyA" })), { action: "selectAll" });
});
