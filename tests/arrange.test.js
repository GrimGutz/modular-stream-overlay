import test from "node:test";
import assert from "node:assert/strict";
import { alignPositions, boundsOf, containsBox, distributePositions } from "../scripts/editor/arrange.js";

const boxes = [
  { id: "a", x: 10, y: 100, width: 100, height: 50 },
  { id: "b", x: 300, y: 20, width: 40, height: 200 },
  { id: "c", x: 150, y: 60, width: 60, height: 30 }
];
const at = (positions, id) => Object.values(positions.get(id));

test("selection bounds and containment use unrotated boxes", () => {
  assert.deepEqual(boundsOf(boxes), { x: 10, y: 20, width: 330, height: 200 });
  assert.equal(boundsOf([]), null);
  assert.equal(containsBox({ x: 0, y: 0, width: 200, height: 200 }, boxes[0]), true);
  assert.equal(containsBox({ x: 20, y: 0, width: 200, height: 200 }, boxes[0]), false);
});

test("alignment moves edges and centers onto the frame and keeps the other axis", () => {
  const frame = boundsOf(boxes);
  const left = alignPositions(boxes, "left", frame);
  assert.deepEqual(boxes.map(box => at(left, box.id)), [[10, 100], [10, 20], [10, 60]]);
  assert.deepEqual(at(alignPositions(boxes, "right", frame), "a"), [240, 100]);
  assert.deepEqual(at(alignPositions(boxes, "center", frame), "c"), [145, 60]);
  assert.deepEqual(at(alignPositions(boxes, "top", frame), "a"), [10, 20]);
  assert.deepEqual(at(alignPositions(boxes, "middle", frame), "a"), [10, 95]);
  assert.deepEqual(at(alignPositions(boxes, "bottom", frame), "b"), [300, 20]);
  assert.deepEqual(at(alignPositions([boxes[0]], "center", { x: 0, y: 0, width: 1920, height: 1080 }), "a"), [910, 100], "One layer centers on the canvas");
  assert.throws(() => alignPositions(boxes, "diagonal", frame));
  assert.equal(boxes[0].x, 10, "Inputs are not changed");
});

test("distribution leaves equal gaps and keeps the outer boxes in place", () => {
  const spread = distributePositions(boxes, "x");
  // Span 10..340 holds 200 px of boxes: two gaps of 65 px.
  assert.deepEqual(["a", "c", "b"].map(id => at(spread, id)[0]), [10, 175, 300]);
  assert.deepEqual(at(spread, "c")[1], 60, "The other axis stays");
  const vertical = distributePositions(boxes, "y");
  // Span 20..150 is shorter than the 280 px of boxes: they overlap by the same 75 px each.
  assert.deepEqual(["b", "c", "a"].map(id => at(vertical, id)[1]), [20, 145, 100], "Overlapping boxes still share the space evenly");
  assert.deepEqual(at(distributePositions(boxes.slice(0, 2), "x"), "a"), [10, 100], "Two boxes do not move");
});
