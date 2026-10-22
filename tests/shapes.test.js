import test from "node:test";
import assert from "node:assert/strict";
import { createLayer } from "../scripts/core/layers.js";
import { validateLayer } from "../scripts/core/schema.js";
import { applyBoxStyle, clipPath, fadeMask, fitText, gradientFill, keepFitted } from "../scripts/render/text.js";

test("shapes, masks, faded edges and gradients are optional, validated layer styles", () => {
  const base = createLayer("image");
  assert.equal(Object.hasOwn(validateLayer(base), "clipShape"), false, "Older layouts keep their exact form");
  const styled = validateLayer({ ...base, clipShape: "hexagon", clipSize: 30, maskSrc: "assets/mask.png", fadeEdge: "bottom", fadeSize: 40 });
  assert.deepEqual([styled.clipShape, styled.clipSize, styled.maskSrc, styled.fadeEdge, styled.fadeSize], ["hexagon", 30, "assets/mask.png", "bottom", 40]);
  for (const bad of [{ clipShape: "star" }, { maskSrc: "https://example.com/mask.png" }, { fadeEdge: "middle" }, { fadeSize: 0 }]) assert.throws(() => validateLayer({ ...base, ...bad }));
  const fill = validateLayer({ ...createLayer("color"), color: "#ff0000", gradientTo: "#0000ff", gradientAngle: 90, gradientType: "radial" });
  assert.deepEqual([fill.gradientTo, fill.gradientAngle, fill.gradientType], ["#0000ff", 90, "radial"]);
  assert.equal(Object.hasOwn(validateLayer({ ...createLayer("color"), gradientAngle: 90 }), "gradientAngle"), false, "An angle without a second color is dropped");
});

test("styles become clip paths, masks with the -webkit- prefix for OBS, and gradient fills", () => {
  assert.equal(clipPath("circle"), "circle(closest-side at 50% 50%)");
  assert.equal(clipPath("chamfer", 10), "polygon(10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px), 0 10px)");
  assert.equal(clipPath(undefined), "");
  assert.equal(fadeMask("bottom", 30), "linear-gradient(to top, transparent 0%, #000 30%)");
  assert.equal(fadeMask("vertical", 20), "linear-gradient(to bottom, transparent 0%, #000 20%, #000 80%, transparent 100%)");
  assert.equal(gradientFill({ color: "#111111", gradientTo: "#eeeeee" }), "linear-gradient(180deg, #111111, #eeeeee)");
  assert.equal(gradientFill({ color: "#111111", gradientTo: "#eeeeee", gradientType: "radial" }), "radial-gradient(circle at center, #111111, #eeeeee)");
  const element = { style: {} };
  applyBoxStyle(element, { clipShape: "diamond", maskSrc: "assets/m\"ask.png", fadeEdge: "top", fadeSize: 25 }, src => `/prefix/${src}`);
  assert.equal(element.style.clipPath, "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)");
  assert.equal(element.style.webkitMaskImage, 'url("/prefix/assets/m%22ask.png"), linear-gradient(to bottom, transparent 0%, #000 25%)');
  assert.equal(element.style.maskImage, element.style.webkitMaskImage);
  assert.deepEqual([element.style.webkitMaskComposite, element.style.maskComposite, element.style.maskSize], ["source-in", "intersect", "100% 100%"]);
  applyBoxStyle(element, {}, src => src);
  assert.deepEqual([element.style.clipPath, element.style.maskImage, element.style.webkitMaskImage], ["", "", ""], "Clearing the styles removes them");
});

/** A text box whose content height grows with its font size: two lines per pixel of font. */
function textBox(height) {
  const strong = { style: {} };
  return {
    strong, isConnected: true, clientWidth: 300, clientHeight: height, scrollWidth: 300, style: { fontSize: "40px" },
    get scrollHeight() { return parseFloat(this.style.fontSize) * 2; },
    querySelectorAll: selector => selector === "strong" ? [strong] : []
  };
}

test("fit to box shrinks the font, and bold text with it, until the content fits", () => {
  const layer = { autoFit: true, fontSize: 40, strongFontSize: 60 };
  const element = textBox(41);
  fitText(element, layer);
  assert.equal(element.style.fontSize, "20.75px", "40 px text in a box that holds about 21 px (1 px tolerance)");
  assert.equal(element.strong.style.fontSize, `${60 * 20.75 / 40}px`);
  const roomy = textBox(200);
  fitText(roomy, layer);
  assert.equal(roomy.style.fontSize, "40px", "Text that fits keeps its size");
  const tiny = textBox(4);
  fitText(tiny, { ...layer, minFontSize: 12 });
  assert.equal(tiny.style.fontSize, "12px", "Never below the smallest size");
  const detached = { ...textBox(10), isConnected: false };
  fitText(detached, layer);
  assert.equal(detached.style.fontSize, "40px", "Unmeasurable boxes are left until they are shown");
  const plain = textBox(10);
  keepFitted(plain, { fontSize: 40 });
  assert.equal(plain.style.fontSize, "40px", "Without fit to box nothing changes");
});
