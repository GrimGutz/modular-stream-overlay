import test from "node:test";
import assert from "node:assert/strict";
import { createLayer } from "../scripts/core/layers.js";
import { isFontFamily, validateLayer, FONT_FAMILIES } from "../scripts/core/schema.js";
import { fontStack } from "../scripts/render/text.js";
import { fontFamilies, loadFoundryFonts } from "../scripts/integration/fonts.js";

const config = { fontDefinitions: {
  Arial: { editor: true, fonts: [] },
  "Modesto Condensed": { editor: true, fonts: [{ urls: ["fonts/modesto-condensed/modesto-condensed.woff2"] }] },
  Signika: { editor: true, fonts: [{ urls: ["fonts/signika/signika-regular.woff2"] }] },
  "bad;name": { editor: true, fonts: [{ urls: ["x.woff2"] }] }
} };
const game = { settings: { get: (scope, key) => scope === "core" && key === "fonts" ? { "Bebas Neue": { editor: true, fonts: [{ urls: ["assets/bebas.woff2"] }] } } : undefined } };

test("text layers accept any plain family name, including Foundry and custom fonts", () => {
  for (const name of ["Modesto Condensed", "Bebas Neue", "Signika", "Roboto Slab 2", "Noto Sans JP", "Golos-Text", "Times New Roman"]) assert.equal(isFontFamily(name), true, name);
  for (const name of ["", " Arial", "Arial ", 'Arial", serif', "url(x)", "a;b", "a\\b", "x".repeat(65), 7]) assert.equal(isFontFamily(name), false, String(name));
  const layer = validateLayer({ ...createLayer("text"), fontFamily: "Modesto Condensed" });
  assert.equal(layer.fontFamily, "Modesto Condensed");
  assert.equal(fontStack("Modesto Condensed"), '"Modesto Condensed", sans-serif');
  assert.throws(() => validateLayer({ ...createLayer("text"), fontFamily: "x; color: red" }), /font family/);
});

test("the font list puts browser-safe fonts first, then Foundry's and the world's custom fonts", () => {
  assert.deepEqual(fontFamilies({ game, config }), [...FONT_FAMILIES, "Bebas Neue", "Modesto Condensed", "Signika"]);
  assert.deepEqual(fontFamilies({ game: {}, config: {} }), [...FONT_FAMILIES]);
});

test("font files load once through Foundry's FontConfig, and a slow file never holds up the overlay", async () => {
  const calls = [];
  const FontConfig = { loadFont: async (family, definition, options) => { calls.push([family, definition.fonts.length, !!options.document]); return true; } };
  const document = { fonts: [{ family: '"Signika"' }] };
  await loadFoundryFonts({ game, config, document, FontConfig });
  assert.deepEqual(calls, [["Modesto Condensed", 1, true], ["Bebas Neue", 1, true]], "System fonts, invalid names and already loaded faces are skipped");
  await loadFoundryFonts({ game, config, document, FontConfig });
  assert.equal(calls.length, 2, "Each family loads once");
  const started = Date.now();
  await loadFoundryFonts({ game, config: { fontDefinitions: { Slow: { fonts: [{ urls: ["slow.woff2"] }] } } }, document, timeout: 20,
    FontConfig: { loadFont: () => new Promise(() => {}) } });
  assert(Date.now() - started < 1000);
  await loadFoundryFonts({ game, config, document, FontConfig: undefined });
});
