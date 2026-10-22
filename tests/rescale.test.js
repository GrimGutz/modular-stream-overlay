import test from "node:test";
import assert from "node:assert/strict";
import { createOverlay } from "../scripts/core/schema.js";
import { createLayer } from "../scripts/core/layers.js";
import { rescaleOverlay, rescaleTransform } from "../scripts/core/rescale.js";

function overlay() {
  const value = createOverlay("Layout");
  value.layers.push(Object.assign(createLayer("text", value.canvas), { id: "title", x: 100, y: 100, width: 400, height: 100, fontSize: 40, borderWidth: 2, letterSpacing: 3, rotation: 15 }));
  value.pages.push({ id: "page-1", name: "Page", enabled: true, duration: null, skipIfUnavailable: false,
    layers: [Object.assign(createLayer("color", value.canvas), { id: "box", x: 960, y: 540, width: 100, height: 100 })] });
  return value;
}
const pick = (layer, keys) => keys.map(key => layer[key]);

test("fit keeps proportions and centers; stretch fills both axes; style sizes follow the smaller factor", () => {
  const larger = rescaleOverlay(overlay(), 2560, 1440);
  assert.deepEqual(larger.canvas, { width: 2560, height: 1440 });
  assert.deepEqual(pick(larger.layers[0], ["x", "y", "width", "height", "fontSize", "borderWidth", "letterSpacing", "rotation"]),
    [133.33, 133.33, 533.33, 133.33, 53.33, 2.67, 4, 15]);
  assert.deepEqual(pick(larger.pages[0].layers[0], ["x", "y", "width"]), [1280, 720, 133.33], "Page layers too");
  const taller = rescaleOverlay(overlay(), 1920, 1200);
  assert.deepEqual(pick(taller.layers[0], ["x", "y", "width", "height", "fontSize"]), [100, 160, 400, 100, 40], "Same width: centered with 60 px margins");
  const stretched = rescaleOverlay(overlay(), 3840, 1080, { mode: "stretch" });
  assert.deepEqual(pick(stretched.layers[0], ["x", "y", "width", "height", "fontSize"]), [200, 100, 800, 100, 40]);
  assert.throws(() => rescaleOverlay(overlay(), 1920, 1080, { mode: "zoom" }));
  assert.deepEqual(rescaleTransform({ width: 100, height: 100 }, { width: 200, height: 100 }, "fit"), { sx: 1, sy: 1, ox: 50, oy: 0, style: 1 });
});
