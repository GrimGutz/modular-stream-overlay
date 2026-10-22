import test from "node:test";
import assert from "node:assert/strict";
import { measureDistances } from "../scripts/editor/measure.js";

const frame = { x: 0, y: 0, width: 1000, height: 500 };

test("distances run to the nearest overlapping neighbour on each side, otherwise to the frame", () => {
  const box = { x: 300, y: 200, width: 100, height: 50 };
  const others = [
    { x: 100, y: 180, width: 100, height: 40 },  // left, overlaps vertically: 100 px
    { x: 0, y: 210, width: 50, height: 10 },     // further left, ignored
    { x: 600, y: 0, width: 50, height: 50 },     // right but above: no overlap
    { x: 320, y: 300, width: 50, height: 50 }    // below: 50 px
  ];
  assert.deepEqual(measureDistances(box, others, frame).map(({ axis, size, cross }) => [axis, size, cross]),
    [["x", 100, 210], ["x", 600, 225], ["y", 200, 350], ["y", 50, 345]]);
  assert.deepEqual(measureDistances({ x: 0, y: 0, width: 1000, height: 500 }, [], frame), [], "No zero-length lines");
});
