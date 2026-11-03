import test from "node:test";
import assert from "node:assert/strict";
import { ASSET_TYPES, MAX_ASSETS_BYTES, MAX_ASSET_BYTES, assetPaths, assetSizes, collectAssets, fromBase64, imageType, installAssets, isSvg, relinkAssets, toBase64,
  validateAssets } from "../scripts/authoring/transfer-assets.js";
import { exportBundle, readTransferFile } from "../scripts/authoring/transfer.js";
import { installOverlayBundle } from "../scripts/authoring/bundle.js";
import { BACKGROUND_STORAGE_PATH, fingerprint, storeImportedImage } from "../scripts/core/background-upload.js";
import { SCHEMA_VERSION, createOverlay, createState } from "../scripts/core/schema.js";
import { createLayer } from "../scripts/core/layers.js";
import { createWidgetPreset, createWidgetPresetState } from "../scripts/core/widget-presets.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);
const OTHER_PNG = new Uint8Array([...PNG.slice(0, 16), 9, 9, 9, 9]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const SHIPPED = "modules/modular-stream-overlay/assets/basic-background.svg";

/** An overlay with a background, an image with a mask, a portrait and a widget design with its own image. */
function records() {
  const overlay = createOverlay("Stream");
  overlay.background.src = "worlds/w/background.png";
  overlay.layers.push(Object.assign(createLayer("image", overlay.canvas), { id: "logo", src: "worlds/w/logo.gif", maskSrc: "worlds/w/mask.webp" }),
    Object.assign(createLayer("image", overlay.canvas), { id: "again", src: "worlds/w/background.png" }));
  const preset = createWidgetPreset("Card");
  preset.layers.push(Object.assign(createLayer("image", preset.canvas), { id: "frame", src: "worlds/w/frame.svg" }));
  return { overlay, preset };
}

const files = entries => {
  const map = new Map(entries);
  return { map, readFile: async path => map.get(path) ?? null, exists: async path => map.has(path) };
};

test("image types come from the bytes; SVG and anything else are not images to carry", () => {
  assert.equal(imageType(PNG), "image/png");
  assert.equal(imageType(GIF), "image/gif");
  assert.equal(imageType(WEBP), "image/webp");
  assert.equal(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(imageType(SVG), null);
  assert.equal(isSvg(SVG), true); assert.equal(isSvg(PNG), false);
  assert.deepEqual(fromBase64(toBase64(PNG)), PNG);
});

test("a file's images are its backgrounds, image and portrait sources and masks, each once", () => {
  const { overlay, preset } = records();
  assert.deepEqual(assetPaths({ overlays: [overlay], widgetPresets: [preset] }),
    ["worlds/w/background.png", "worlds/w/logo.gif", "worlds/w/mask.webp", "worlds/w/frame.svg"]);
  assert.deepEqual(assetPaths({ layers: [{ type: "character-portrait", src: "a.png" }, { type: "text", maskSrc: "b.png" }] }), ["a.png", "b.png"]);
  const moved = relinkAssets({ overlays: [overlay] }, new Map([["worlds/w/background.png", "new/background.png"]]));
  assert.equal(moved.overlays[0].background.src, "new/background.png");
  assert.deepEqual(moved.overlays[0].layers.map(layer => [layer.src, layer.maskSrc]), [["worlds/w/logo.gif", "worlds/w/mask.webp"], ["new/background.png", undefined]]);
  assert.equal(overlay.background.src, "worlds/w/background.png", "The records themselves are untouched");
  const sizes = assetSizes({ overlays: [overlay] });
  assert.deepEqual(sizes.get("worlds/w/background.png"), { width: 1920, height: 1080 }, "The largest box an image fills, here the canvas");
  assert.deepEqual(sizes.get("worlds/w/logo.gif"), { width: overlay.layers[0].width, height: overlay.layers[0].height });
});

test("export carries PNG, JPEG, WebP and GIF files; without a way to draw SVGs, they, missing and oversized files stay paths", async () => {
  const source = files([["worlds/w/background.png", PNG], ["worlds/w/logo.gif", GIF], ["worlds/w/frame.svg", SVG], [SHIPPED, SVG]]);
  const { assets, skipped } = await collectAssets(["worlds/w/background.png", "worlds/w/logo.gif", "worlds/w/mask.webp", "worlds/w/frame.svg", SHIPPED], source);
  assert.deepEqual(assets.map(asset => [asset.path, asset.type]), [["worlds/w/background.png", "image/png"], ["worlds/w/logo.gif", "image/gif"]]);
  assert.deepEqual(fromBase64(assets[0].data), PNG);
  assert.deepEqual(skipped, [{ path: "worlds/w/mask.webp", reason: "missing" }, { path: "worlds/w/frame.svg", reason: "format" }],
    "The module's own artwork is on every server and is neither carried nor reported");
  const big = new Uint8Array(MAX_ASSET_BYTES + 1); big.set(PNG);
  assert.deepEqual((await collectAssets(["big.png"], files([["big.png", big]]))).skipped, [{ path: "big.png", reason: "size" }]);
  assert.ok(MAX_ASSETS_BYTES >= MAX_ASSET_BYTES);
});

test("an SVG goes into the file as a PNG drawn at the box it fills, with the original's fingerprint", async () => {
  const drawn = [];
  const source = { ...files([["worlds/w/frame.svg", SVG], ["worlds/w/notes.txt", new TextEncoder().encode("plain text")]]),
    rasterize: async (bytes, box) => { drawn.push(box); return PNG; } };
  const { assets, skipped } = await collectAssets(["worlds/w/frame.svg", "worlds/w/notes.txt"], source, new Map([["worlds/w/frame.svg", { width: 640, height: 360 }]]));
  assert.deepEqual(assets, [{ path: "worlds/w/frame.svg", type: "image/png", data: toBase64(PNG), original: fingerprint(SVG) }]);
  assert.deepEqual(drawn, [{ width: 640, height: 360 }]);
  assert.deepEqual(skipped, [{ path: "worlds/w/notes.txt", reason: "format" }], "Only SVGs are drawn");
  const failed = await collectAssets(["worlds/w/frame.svg"], { ...source, rasterize: async () => new TextEncoder().encode("<svg>") });
  assert.deepEqual(failed.skipped, [{ path: "worlds/w/frame.svg", reason: "format" }], "A drawing that is not an image is not carried");
});

test("a file's images are checked: safe paths, known types, intact data and size", () => {
  const asset = { path: "worlds/w/a.png", type: "image/png", data: toBase64(PNG) };
  assert.deepEqual(validateAssets([asset]), [asset]);
  assert.deepEqual(validateAssets([{ ...asset, original: fingerprint(SVG) }]), [{ ...asset, original: fingerprint(SVG) }]);
  assert.deepEqual(validateAssets(undefined), []);
  for (const [bad, pattern] of [
    [{ ...asset, path: "../secret.png" }, /inside Foundry's managed files/], [{ ...asset, path: "https://example.com/a.png" }, /relative path/],
    [{ ...asset, type: "image/svg+xml" }, /PNG, JPEG, WebP or GIF/], [{ ...asset, data: "not base64!" }, /damaged/],
    [{ ...asset, data: toBase64(SVG) }, /damaged/], [{ ...asset, type: "image/gif" }, /damaged/], [{ ...asset, original: "../x" }, /damaged/],
    [null, /path, a type and its data/]
  ]) assert.throws(() => validateAssets([bad]), pattern);
  assert.throws(() => validateAssets([asset, asset]), /its own path/);
  assert.throws(() => validateAssets({}), /at most 200 images/);
});

test("exported overlays and fragments read back with their images", () => {
  const { overlay } = records();
  const bundle = { ...exportBundle({ overlays: [overlay] }), assets: [{ path: "worlds/w/background.png", type: ASSET_TYPES.png, data: toBase64(PNG) }] };
  const read = readTransferFile(JSON.stringify(bundle));
  assert.equal(read.bundle.assets[0].path, "worlds/w/background.png");
  assert.equal(readTransferFile(JSON.stringify(exportBundle({ overlays: [overlay] }))).bundle.assets, undefined, "Files without images stay as before");
  const fragment = { format: "mso-layer-fragment", version: 1, moduleId: "modular-stream-overlay", name: "Logo", layers: [overlay.layers[0]],
    assets: [{ path: "worlds/w/logo.gif", type: ASSET_TYPES.gif, data: toBase64(GIF) }] };
  assert.deepEqual(readTransferFile(JSON.stringify(fragment)).assets.map(asset => asset.type), ["image/gif"]);
  assert.throws(() => readTransferFile(JSON.stringify({ ...bundle, assets: [{ ...bundle.assets[0], extra: 1 }] })), /Unsupported field/);
});

test("import keeps images this server already has, stores the rest and reports what it could not place", async () => {
  const assets = [["worlds/w/background.png", PNG], ["worlds/w/logo.gif", GIF], ["worlds/w/mask.webp", WEBP]]
    .map(([path, bytes]) => ({ path, type: imageType(bytes), data: toBase64(bytes) }));
  const here = files([["worlds/w/background.png", PNG], ["worlds/w/logo.gif", OTHER_PNG], ["worlds/w/frame.svg", SVG]]);
  const stored = [];
  const store = async (bytes, extension) => { stored.push([bytes, extension]); return `${BACKGROUND_STORAGE_PATH}/image-${stored.length}.${extension}`; };
  const used = ["worlds/w/background.png", "worlds/w/logo.gif", "worlds/w/mask.webp", "worlds/w/frame.svg", "worlds/w/gone.png", SHIPPED];
  const result = await installAssets(assets, used, { ...here, store, canStore: true });
  assert.deepEqual([...result.paths], [["worlds/w/logo.gif", `${BACKGROUND_STORAGE_PATH}/image-1.gif`], ["worlds/w/mask.webp", `${BACKGROUND_STORAGE_PATH}/image-2.webp`]],
    "The same path with other bytes gets its own copy");
  assert.deepEqual([result.stored, result.kept, result.missing], [2, 1, ["worlds/w/gone.png"]]);
  assert.deepEqual(stored[0][0], GIF);
  const blocked = await installAssets(assets, used, { ...here, store, canStore: false });
  assert.deepEqual([blocked.paths.size, blocked.blocked], [0, ["worlds/w/logo.gif", "worlds/w/mask.webp"]], "Without upload permission paths stay");
  const failed = await installAssets(assets, used, { ...here, store: async () => { throw new Error("offline"); }, canStore: true });
  assert.deepEqual(failed.failed, ["worlds/w/logo.gif", "worlds/w/mask.webp"]);
  // An SVG drawn as a PNG stays the SVG where this server has that very SVG, and arrives as the PNG elsewhere.
  const drawn = [{ path: "worlds/w/frame.svg", type: "image/png", data: toBase64(PNG), original: fingerprint(SVG) }];
  assert.deepEqual((await installAssets(drawn, ["worlds/w/frame.svg"], { ...here, store, canStore: true })).kept, 1);
  const changed = files([["worlds/w/frame.svg", new TextEncoder().encode("<svg><rect/></svg>")]]);
  const elsewhere = await installAssets(drawn, ["worlds/w/frame.svg"], { ...changed, store, canStore: true });
  assert.equal(elsewhere.paths.get("worlds/w/frame.svg"), `${BACKGROUND_STORAGE_PATH}/image-${stored.length}.png`);
});

test("imported images get names from their bytes: the same image reuses its file, another one never overwrites it", async () => {
  const uploads = [];
  let listing = [];
  const picker = {
    browse: async () => ({ target: BACKGROUND_STORAGE_PATH, files: listing }),
    createDirectory: async () => ({}),
    uploadPersistent: async (_module, _folder, file) => { uploads.push(file); return { path: `${BACKGROUND_STORAGE_PATH}/${file.name}` }; }
  };
  const user = { isGM: true, can: permission => permission === "FILES_UPLOAD" };
  const options = { user, picker, FileClass: File, makeId: () => "11111111-1111-4111-8111-111111111111" };
  const first = await storeImportedImage(PNG, "png", options);
  assert.match(first, new RegExp(`^${BACKGROUND_STORAGE_PATH}/image-[0-9a-f]{16}-k\\.png$`));
  assert.equal(await storeImportedImage(PNG, "png", options), first, "The name depends only on the bytes");
  listing = [first];
  assert.equal(await storeImportedImage(PNG, "png", { ...options, readFile: async () => PNG }), first);
  assert.equal(uploads.length, 2, "An identical file already stored is reused without uploading");
  const other = await storeImportedImage(PNG, "png", { ...options, readFile: async () => OTHER_PNG });
  assert.equal(other, `${BACKGROUND_STORAGE_PATH}/background-11111111-1111-4111-8111-111111111111.png`);
  await assert.rejects(storeImportedImage(PNG, "svg", options), /PNG, JPEG, WebP or GIF/);
  await assert.rejects(storeImportedImage(PNG, "png", { ...options, user: { isGM: true, can: () => false } }), /FILES_UPLOAD/);
  await assert.rejects(storeImportedImage(PNG, "png", { ...options, user: { isGM: false, can: () => true } }), /Only a Game Master/);
});

test("the authoring installer places a bundle's images before saving and points the records at them", async () => {
  const { overlay } = records();
  overlay.layers = overlay.layers.slice(0, 1);
  const bundle = { ...exportBundle({ overlays: [overlay] }), assets: [{ path: "worlds/w/background.png", type: ASSET_TYPES.png, data: toBase64(PNG) }] };
  const state = createState(), saved = [];
  const api = { schemaVersion: SCHEMA_VERSION, canEditLibrary: () => true,
    store: { getState: () => state, saveOverlay: async value => { saved.push(value); return value; } },
    widgetPresets: { getState: () => createWidgetPresetState(), save: async value => value } };
  const assetIO = { ...files([]), canStore: true, store: async (_bytes, extension) => `${BACKGROUND_STORAGE_PATH}/image-a.${extension}` };
  const dry = await installOverlayBundle(bundle, { api, dryRun: true, assetIO: { ...assetIO, store: () => assert.fail("A dry run stores nothing") } });
  assert.equal(dry.images, undefined);
  const summary = await installOverlayBundle(bundle, { api, assetIO });
  assert.equal(saved[0].background.src, `${BACKGROUND_STORAGE_PATH}/image-a.png`);
  assert.deepEqual(summary.images, { stored: 1, kept: 0, blocked: [], failed: [], missing: ["worlds/w/logo.gif", "worlds/w/mask.webp"] });
});
