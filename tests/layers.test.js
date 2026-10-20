import test from "node:test";
import assert from "node:assert/strict";
import { SCHEMA_VERSION, clone, createOverlay, createState, validateLayer, validateOverlay, validateState, FONT_FAMILIES, FONT_WEIGHTS } from "../scripts/core/schema.js";
import { createLayer, duplicateLayer, deleteLayer, reorderLayer } from "../scripts/core/layers.js";

test("new layers have independent IDs, native geometry and safe image/text defaults", () => {
  const image = createLayer("image");
  const second = createLayer("image");
  const text = createLayer("text", { width: 320, height: 180 });
  assert.notEqual(image.id, second.id);
  assert.equal(image.lockAspectRatio, true);
  assert.equal(image.fit, "contain");
  assert.equal(image.visible, true);
  assert.equal(image.locked, false);
  assert.equal(image.rotation, 0);
  assert.equal(image.opacity, 1);
  assert.equal(text.width, 320);
  assert.equal(text.height, 120);
  assert.equal(text.fontFamily, "Arial");
  assert.equal(text.fontWeight, "400");
  assert.equal(FONT_FAMILIES.length, 6);
  assert.deepEqual(FONT_WEIGHTS, ["400", "600", "700"]);
  assert.equal(Object.isFrozen(FONT_FAMILIES), true);
});

test("current compositions round trip every text/image property and isolate extension JSON", () => {
  const source = createOverlay("Full composition");
  const image = Object.assign(createLayer("image"), {
    src: "modules/modular-stream-overlay/storage/frame.webp", x: -50, y: 12.5, width: 900, height: 500,
    rotation: -45, opacity: 0.5, visible: false, locked: true, z: -3, fit: "stretch", lockAspectRatio: false
  });
  const text = Object.assign(createLayer("text"), {
    text: "First line\n<em>literal text</em>\r\nLast line", fontFamily: "Courier New", fontSize: 75.5,
    fontWeight: "700", color: "#aabbccdd", align: "right", shadow: true, x: 400, y: 600,
    width: 800, height: 200, rotation: 360, z: 20
  });
  source.layers = [image, text, validateLayer({ id: "future", type: "future:health-bar", name: "Future widget", x: 0, y: 0, width: 300, height: 100, visible: true, locked: false, rotation: 0, opacity: 1, z: 30, config: { resource: "hp", nested: [1, true] } })];
  const normalized = validateOverlay(source);
  assert.deepEqual(normalized, source);
  assert.deepEqual(validateOverlay(JSON.parse(JSON.stringify(normalized))), normalized);
  normalized.layers[2].config.nested.push("isolated");
  assert.deepEqual(source.layers[2].config.nested, [1, true]);
  const state = { ...createState(), overlays: [source], activeOverlayId: source.id, presets: [{ schemaVersion: SCHEMA_VERSION, id: "composition", name: "Composition", overlay: source }] };
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))), state);
});

test("migration accepts mixed supported schema versions and preserves legacy color/image layers", () => {
  const legacy = createOverlay("Old");
  legacy.schemaVersion = 1;
  legacy.layers = [{ id: "old-color", type: "color", color: "transparent", z: -5 }, { id: "old-image", type: "image", src: "worlds/test/frame.png", fit: "cover", z: 7 }];
  const original = clone(legacy);
  const migrated = validateOverlay(legacy);
  assert.deepEqual(legacy, original);
  assert.equal(migrated.layers[0].color, "transparent");
  assert.equal(migrated.layers[1].src, legacy.layers[1].src);
  assert.equal(migrated.layers[1].lockAspectRatio, false);
  const state = { ...createState(), schemaVersion: 1, overlays: [legacy], presets: [{ schemaVersion: 1, id: "old", name: "Old", overlay: { ...legacy, schemaVersion: 2 } }] };
  const checked = validateState(state);
  assert.equal(checked.schemaVersion, SCHEMA_VERSION);
  assert.equal(checked.presets[0].overlay.schemaVersion, SCHEMA_VERSION);
  assert.equal(checked.overlays[0].layers[0].id, "old-color");
  assert.equal(checked.overlays[0].layers[0].z, -5);
});

test("layer validation rejects invalid geometry and styles while retaining literal multiline content", () => {
  const source = createLayer("text");
  assert.equal(validateLayer({ ...source, text: "\n  <script>literal</script>\n  " }).text, "\n  <script>literal</script>\n  ");
  assert.equal(validateLayer({ ...source, text: "" }).text, "");
  assert.equal(validateLayer({ ...source, text: "x".repeat(10000) }).text.length, 10000);
  for (const patch of [
    { x: -32769 }, { y: Infinity }, { width: 0 }, { height: -1 }, { rotation: 361 }, { rotation: -361 },
    { rotation: "0" }, { opacity: NaN }, { opacity: 1.1 }, { z: 0.5 }, { locked: "false" },
    { text: "x".repeat(10001) }, { text: "a\u0000b" }, { fontFamily: "url(unsafe)" },
    { fontSize: 0 }, { fontSize: 513 }, { fontWeight: "500" }, { fontWeight: 400 },
    { color: "red" }, { color: "#12345" }, { color: "#1234567" }, { align: "justify" }, { shadow: "true" }
  ]) assert.throws(() => validateLayer({ ...source, ...patch }), TypeError, JSON.stringify(patch));
  assert.equal(validateLayer({ ...source, rotation: -360, fontSize: 1, color: "#abc" }).rotation, -360);
  assert.equal(validateLayer({ ...source, fontSize: 512, color: "#1234" }).fontSize, 512);
  assert.throws(() => validateLayer({ ...createLayer("image"), lockAspectRatio: "true" }), TypeError);
  assert.throws(() => validateLayer({ ...source, type: "invalid type" }), TypeError);
  assert.throws(() => validateLayer({ ...source, type: "custom", config: { constructor: {} } }), /unsafe/);
});

test("duplicate and delete mutate only draft layers with independent IDs, offsets and config", () => {
  const overlay = createOverlay();
  const source = Object.assign(createLayer("custom:widget"), { z: 5, config: { nested: [1] } });
  overlay.layers = [source];
  overlay.widgets = [{ id: "legacy", type: "legacy", z: 20, config: {} }];
  const copy = duplicateLayer(overlay, source.id);
  assert.equal(overlay.layers.length, 2);
  assert.equal(overlay.layers[1], copy);
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.x, source.x + 20);
  assert.equal(copy.y, source.y + 20);
  assert.equal(copy.z, 21);
  assert.equal(copy.name, `${source.name} copy`);
  copy.config.nested.push(2);
  assert.deepEqual(source.config.nested, [1]);
  assert.equal(deleteLayer(overlay, source.id), true);
  assert.equal(deleteLayer(overlay, source.id), false);
  assert.equal(deleteLayer(overlay, "legacy"), false);
  assert.equal(duplicateLayer(overlay, "missing"), null);
  assert.equal(overlay.widgets.length, 1);
});

test("duplicate handles upper geometry and stack bounds without making invalid saved layers", () => {
  const overlay = createOverlay();
  overlay.layers = [Object.assign(createLayer("image"), { x: 32765, y: 32768, z: 10000 })];
  const copy = duplicateLayer(overlay, overlay.layers[0].id);
  assert.equal(copy.x, 32768);
  assert.equal(copy.y, 32768);
  assert.equal(copy.z, 1);
  assert.doesNotThrow(() => validateOverlay(overlay));
  const original = clone(overlay);
  while (overlay.layers.length < 100) overlay.layers.push({ ...copy, id: `copy-${overlay.layers.length}` });
  assert.throws(() => duplicateLayer(overlay, original.layers[0].id), /100/);
  assert.equal(overlay.layers.length, 100);
});

test("layer ordering includes legacy widgets, honors stable ties and preserves other relative order", () => {
  const overlay = createOverlay();
  overlay.layers = ["a", "b", "c"].map((id, index) => ({ ...createLayer("image"), id, z: [0, 10, 30][index] }));
  overlay.widgets = [{ id: "legacy-1", type: "legacy", z: 10, config: {} }, { id: "legacy-2", type: "legacy", z: 20, config: {} }];
  const ordered = () => [...overlay.layers, ...overlay.widgets].sort((a, b) => a.z - b.z).map(entry => entry.id);
  assert.deepEqual(ordered(), ["a", "b", "legacy-1", "legacy-2", "c"]);
  assert.equal(reorderLayer(overlay, "b", "up"), true);
  assert.deepEqual(ordered(), ["a", "legacy-1", "b", "legacy-2", "c"]);
  assert.equal(reorderLayer(overlay, "b", "front"), true);
  assert.deepEqual(ordered(), ["a", "legacy-1", "legacy-2", "c", "b"]);
  assert.equal(reorderLayer(overlay, "b", "front"), false);
  assert.equal(reorderLayer(overlay, "b", "back"), true);
  assert.deepEqual(ordered(), ["b", "a", "legacy-1", "legacy-2", "c"]);
  assert.equal(reorderLayer(overlay, "b", "down"), false);
  assert.equal(reorderLayer(overlay, "b", "up"), true);
  assert.equal(reorderLayer(overlay, "b", "down"), true);
  assert.equal(reorderLayer(overlay, "missing", "up"), false);
  assert.equal(reorderLayer(overlay, "legacy-1", "up"), false);
  assert.throws(() => reorderLayer(overlay, "b", "invalid"), TypeError);
  assert.deepEqual(overlay.layers.map(entry => entry.id), ["a", "b", "c"]);
  assert.deepEqual(overlay.widgets.map(entry => entry.id), ["legacy-1", "legacy-2"]);
});
