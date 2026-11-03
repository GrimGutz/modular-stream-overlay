/**
 * Images inside transfer files. An export embeds the PNG, JPEG, WebP and GIF files its overlays,
 * widget designs and fragments show (backgrounds, image and portrait sources, masks). An SVG
 * goes in as a PNG drawn at the largest size it is shown, with a fingerprint of the original:
 * an SVG from someone else's file could run scripts on this server, a PNG cannot. An import
 * keeps a path whose file this server already has (the same bytes, or the SVG the PNG was drawn
 * from); other images go into this module's storage and the records point at them. Video and
 * files the exporter cannot read stay references by path.
 */
import { MODULE_ID, validateAssetPath } from "../core/schema.js";
import { fingerprint, storeImportedImage } from "../core/background-upload.js";

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const MAX_ASSETS_BYTES = 100 * 1024 * 1024;
export const MAX_ASSETS = 200;
export const MAX_RASTER_SIZE = 4096;
export const ASSET_TYPES = Object.freeze({ png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" });
const EXTENSIONS = new Map(Object.entries(ASSET_TYPES).map(([extension, type]) => [type, extension]));
// Files this module ships are on every server at the same path.
const SHIPPED = new RegExp(`^modules/${MODULE_ID}/assets/(?:basic-background|demo-mage|demo-warrior)\\.svg$`);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const FINGERPRINT = /^[0-9a-f]{16}-[0-9a-z]{1,8}$/;

/** The image type its first bytes show, or null for anything else (SVG, video, text). */
export function imageType(bytes) {
  const at = (offset, values) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ASSET_TYPES.png;
  if (at(0, [0xff, 0xd8, 0xff])) return ASSET_TYPES.jpg;
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return ASSET_TYPES.webp;
  if (at(0, [0x47, 0x49, 0x46, 0x38]) && [0x37, 0x39].includes(bytes[4]) && bytes[5] === 0x61) return ASSET_TYPES.gif;
  return null;
}

/** Whether the bytes look like an SVG document (only to decide whether to draw it). */
export function isSvg(bytes) {
  return /<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 4096)));
}

export function toBase64(bytes) {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(text);
}

export function fromBase64(text) {
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(text);
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function sameBytes(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

/** Each image path the records show with the largest box it fills, in first-use order. */
export function assetSizes({ overlays = [], widgetPresets = [], layers = null } = {}) {
  const sizes = new Map();
  const note = (path, width, height) => {
    if (!path) return;
    const known = sizes.get(path) ?? { width: 0, height: 0 };
    sizes.set(path, { width: Math.max(known.width, Number(width) || 0), height: Math.max(known.height, Number(height) || 0) });
  };
  const visit = layer => { for (const key of ["src", "maskSrc"]) note(layer?.[key], layer?.width, layer?.height); };
  for (const record of [...overlays, ...widgetPresets]) {
    note(record.background?.src, record.canvas?.width, record.canvas?.height);
    record.layers?.forEach(visit);
  }
  layers?.forEach(visit);
  return sizes;
}

/** Image paths the records show, each once in first-use order. */
export const assetPaths = records => [...assetSizes(records).keys()];

/** Copies of the records with the image paths `paths` (old → new) replaced. */
export function relinkAssets({ overlays = [], widgetPresets = [], layers = null } = {}, paths = new Map()) {
  const swap = value => paths.get(value) ?? value;
  const layer = entry => {
    const result = { ...entry };
    for (const key of ["src", "maskSrc"]) if (result[key]) result[key] = swap(result[key]);
    return result;
  };
  const record = entry => ({ ...entry, ...(entry.background ? { background: { ...entry.background, src: swap(entry.background.src) } } : {}),
    layers: (entry.layers ?? []).map(layer) });
  return { overlays: overlays.map(record), widgetPresets: widgetPresets.map(record), layers: layers?.map(layer) ?? null };
}

/**
 * Read the images these paths name for a file. `sizes` gives the box each fills, for drawing
 * SVGs. Returns { assets, skipped }; skipped lists { path, reason } for paths left as
 * references: "missing" (this server does not serve it), "format" (not an image this can carry)
 * or "size".
 */
export async function collectAssets(paths, { readFile, rasterize = null }, sizes = new Map()) {
  const assets = [], skipped = [];
  const attempt = operation => Promise.resolve().then(operation).catch(() => null);
  let total = 0;
  for (const path of paths) {
    if (SHIPPED.test(path)) continue;
    const bytes = await attempt(() => readFile(path));
    if (!bytes?.length) { skipped.push({ path, reason: "missing" }); continue; }
    let data = bytes, original = null;
    if (!imageType(bytes) && rasterize && isSvg(bytes)) {
      data = await attempt(() => rasterize(bytes, sizes.get(path) ?? null));
      original = fingerprint(bytes);
    }
    const type = data?.length ? imageType(data) : null;
    if (!type) { skipped.push({ path, reason: "format" }); continue; }
    if (data.length > MAX_ASSET_BYTES || total + data.length > MAX_ASSETS_BYTES || assets.length >= MAX_ASSETS) {
      skipped.push({ path, reason: "size" }); continue;
    }
    total += data.length;
    assets.push({ path, type, data: toBase64(data), ...(original ? { original } : {}) });
  }
  return { assets, skipped };
}

/** The images of a transfer file: [{ path, type, data, original? }], data in base64. */
export function validateAssets(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_ASSETS) throw new TypeError(`A file carries at most ${MAX_ASSETS} images.`);
  const seen = new Set();
  let total = 0;
  return input.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("Each image in the file needs a path, a type and its data.");
    const path = validateAssetPath(entry.path);
    if (!path || seen.has(path)) throw new TypeError("Each image in the file needs its own path.");
    seen.add(path);
    if (!EXTENSIONS.has(entry.type)) throw new TypeError("Images in the file must be PNG, JPEG, WebP or GIF.");
    const data = entry.data;
    if (typeof data !== "string" || !data.length || data.length % 4 || !BASE64.test(data) || imageType(fromBase64(data.slice(0, 24))) !== entry.type
      || (entry.original !== undefined && !FINGERPRINT.test(entry.original))) {
      throw new TypeError("An image in the file is damaged.");
    }
    const size = data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
    if (size > MAX_ASSET_BYTES) throw new TypeError("Each image in the file must be at most 25 MiB.");
    total += size;
    if (total > MAX_ASSETS_BYTES) throw new TypeError("The images in a file must be at most 100 MiB together.");
    return { path, type: entry.type, data, ...(entry.original !== undefined ? { original: entry.original } : {}) };
  });
}

/**
 * Make a file's images available here for the paths the imported records use. Returns
 * { paths: Map(old → new), stored, kept, blocked, failed, missing }: stored went into this
 * module's storage, kept were already here; blocked (no upload permission) and failed keep their
 * old paths, and missing are neither in the file nor on this server.
 */
export async function installAssets(assets, used, { readFile, exists = async path => Boolean(await readFile(path)), store, canStore = false }) {
  const byPath = new Map(assets.map(asset => [asset.path, asset]));
  const result = { paths: new Map(), stored: 0, kept: 0, blocked: [], failed: [], missing: [] };
  const attempt = operation => Promise.resolve().then(operation).catch(() => null);
  for (const path of used) {
    const asset = byPath.get(path);
    if (!asset) {
      if (!SHIPPED.test(path) && !await attempt(() => exists(path))) result.missing.push(path);
      continue;
    }
    const bytes = fromBase64(asset.data), here = await attempt(() => readFile(path));
    if (here && (asset.original ? fingerprint(here) === asset.original : sameBytes(here, bytes))) { result.kept++; continue; }
    if (!canStore) { result.blocked.push(path); continue; }
    const stored = await attempt(() => store(bytes, EXTENSIONS.get(asset.type)));
    if (stored) { result.paths.set(path, stored); result.stored++; }
    else result.failed.push(path);
  }
  return result;
}

/** Draw an SVG as a PNG that covers `box` at the SVG's own proportions, at most 4096 pixels a side. */
async function rasterizeSvg(bytes, box) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/svg+xml" }));
  try {
    // As an <img>, an SVG runs no scripts and loads nothing else.
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth || box?.width || 1920, height = image.naturalHeight || box?.height || 1080;
    const scale = Math.min(box?.width && box?.height ? Math.max(box.width / width, box.height / height) : 1, MAX_RASTER_SIZE / width, MAX_RASTER_SIZE / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } finally { URL.revokeObjectURL(url); }
}

/** Reading, drawing and storing images in Foundry as this user; `allowed` decides who edits the library here. */
export function browserAssetIO({ allowed = user => Boolean(user?.isGM) } = {}) {
  const route = path => globalThis.foundry?.utils?.getRoute?.(path) ?? path;
  const readFile = async path => {
    const response = await fetch(route(path), { cache: "no-cache" });
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  };
  const user = globalThis.game?.user;
  return {
    readFile,
    exists: async path => (await fetch(route(path), { method: "HEAD", cache: "no-cache" })).ok,
    rasterize: rasterizeSvg,
    canStore: Boolean(allowed(user) && user?.can?.("FILES_UPLOAD")),
    store: (bytes, extension) => storeImportedImage(bytes, extension, { user, allowed, readFile })
  };
}
