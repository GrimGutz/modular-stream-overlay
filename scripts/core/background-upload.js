import { MODULE_ID, validateAssetPath } from "./schema.js";

export const BACKGROUND_STORAGE_PATH = `modules/${MODULE_ID}/storage`;
export const MAX_BACKGROUND_UPLOAD_BYTES = 25 * 1024 * 1024;
export const DEFAULT_BACKGROUND_UPLOAD_TIMEOUT_MS = 60_000;

const FORMATS = Object.freeze({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class BackgroundUploadTimeoutError extends Error {
  constructor(operation) {
    const retry = operation === "uploading the background image"
      ? "Reconnect to Foundry and check Browse Existing before retrying; the file may have uploaded. The current background has not changed."
      : "Reconnect to Foundry, then retry.";
    super(`The Foundry connection timed out while ${operation}. ${retry}`);
    this.name = "BackgroundUploadTimeoutError";
    this.code = "BACKGROUND_UPLOAD_TIMEOUT";
  }
}

const isTimeout = error => error?.code === "BACKGROUND_UPLOAD_TIMEOUT";

async function withTimeout(operation, description, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new BackgroundUploadTimeoutError(description)), timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
}

/** Secure UUID names also work on LAN HTTP, where randomUUID may be unavailable. */
export function createBackgroundUploadId(cryptoSource = globalThis.crypto) {
  if (typeof cryptoSource?.randomUUID === "function") return cryptoSource.randomUUID();
  if (typeof cryptoSource?.getRandomValues !== "function") throw new Error("This browser cannot generate a secure upload filename. Use a supported Foundry browser.");
  const bytes = new Uint8Array(16);
  cryptoSource.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function assertPermission(user) {
  if (!user?.isGM) throw new Error("Only a Game Master can upload overlay backgrounds.");
  if (typeof user.can !== "function" || !user.can("FILES_UPLOAD")) {
    throw new Error("Your Foundry account needs file upload permission (FILES_UPLOAD) to upload a background.");
  }
}

function matchesSignature(bytes, extension) {
  if (extension === "png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
  }
  if (extension === "jpg" || extension === "jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

async function validateImage(file, FileClass, decodeImage) {
  if (typeof FileClass !== "function") throw new Error("This browser cannot prepare image files for upload. Use a supported Foundry browser.");
  if (!(file instanceof FileClass) || typeof file.name !== "string" || typeof file.slice !== "function") {
    throw new TypeError("Choose a PNG, JPEG, or WebP image file to upload.");
  }
  if (typeof file.size !== "number" || !Number.isFinite(file.size) || file.size <= 0) {
    throw new TypeError("The selected image file is empty or has an invalid size.");
  }
  if (file.size > MAX_BACKGROUND_UPLOAD_BYTES) throw new Error("Background images must be 25 MiB or smaller.");
  const extension = file.name.match(/\.([^.]+)$/)?.[1].toLowerCase();
  if (!Object.hasOwn(FORMATS, extension)) throw new TypeError("Choose a PNG, JPEG, or WebP image. SVG and other formats are not supported for upload.");
  if (typeof file.type !== "string" || (file.type !== "" && file.type.toLowerCase() !== FORMATS[extension])) {
    throw new TypeError("The image file type does not match its filename. Choose a PNG, JPEG, or WebP image.");
  }
  let bytes;
  try { bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer()); }
  catch (cause) { throw new Error("The selected image file could not be read.", { cause }); }
  if (!matchesSignature(bytes, extension)) throw new TypeError("The file contents do not match its PNG, JPEG, or WebP filename.");
  if (typeof decodeImage !== "function") throw new Error("This browser cannot validate image files. Use a supported Foundry browser with image decoding support.");
  let bitmap;
  try {
    bitmap = await decodeImage(file);
    if (!bitmap || !Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height) || bitmap.width <= 0 || bitmap.height <= 0) {
      throw new Error("The decoded image has no usable dimensions.");
    }
  } catch (cause) {
    throw new Error("The image could not be decoded. Choose a valid PNG, JPEG, or WebP file.", { cause });
  } finally { bitmap?.close?.(); }
  return extension;
}

async function browseStorage(picker, timeoutMs) {
  // Use the static API: an application instance may silently fall back to its root directory.
  const result = await withTimeout(() => picker.browse("data", BACKGROUND_STORAGE_PATH, {}), "checking the background storage directory", timeoutMs);
  if (!result || typeof result !== "object" || Array.isArray(result) || result.error || result.success === false
    || typeof result.target !== "string" || result.target.replace(/\/$/, "") !== BACKGROUND_STORAGE_PATH
    || !Array.isArray(result.files) || result.files.some(path => typeof path !== "string")) {
    throw new Error("Foundry did not confirm the overlay background storage directory.");
  }
  return result.files;
}

async function ensureStorage(picker, timeoutMs) {
  try { return await browseStorage(picker, timeoutMs); }
  catch (error) {
    if (isTimeout(error)) throw error;
    // The persistent directory may not have been created yet.
  }
  let creationError;
  try { await withTimeout(() => picker.createDirectory("data", BACKGROUND_STORAGE_PATH, { notify: false }), "creating the background storage directory", timeoutMs); }
  catch (error) {
    if (isTimeout(error)) throw error;
    creationError = error;
  }
  try {
    // Also handles another GM creating the directory between browse and createDirectory.
    return await browseStorage(picker, timeoutMs);
  } catch (cause) {
    if (isTimeout(cause)) throw cause;
    throw new Error("Foundry could not access or create the overlay background storage directory. Check the server's file permissions and try again.", { cause: creationError ?? cause });
  }
}

function existingFilenames(paths) {
  return new Set(paths.map(path => {
    let normalized = path.split(/[?#]/)[0];
    try { normalized = decodeURIComponent(normalized); }
    catch { /* Keep the original name when a listing contains a literal percent sign. */ }
    return normalized.replace(/\\/g, "/").split("/").at(-1).toLowerCase();
  }));
}

function uniqueFilename(extension, files, makeId) {
  if (typeof makeId !== "function") throw new Error("This browser cannot generate a secure upload filename. Use a supported Foundry browser.");
  const existing = existingFilenames(files);
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = makeId();
    if (typeof id !== "string" || !UUID.test(id)) throw new Error("A secure upload filename could not be generated. Try again in a supported Foundry browser.");
    const name = `background-${id.toLowerCase()}.${extension}`;
    if (!existing.has(name.toLowerCase())) return name;
  }
  throw new Error("A unique background filename could not be selected. No existing image was overwritten; try again.");
}

/**
 * Upload one validated local image to this module's persistent storage. Requires
 * module.json persistentStorage:true. Returns a managed relative path; never saves
 * overlay settings or changes the caller's draft. UUID names and a directory
 * preflight avoid existing files; Foundry does not expose an atomic no-overwrite API.
 */
export async function uploadBackground(file, {
  user = globalThis.game?.user,
  picker = globalThis.foundry?.applications?.apps?.FilePicker?.implementation,
  createImageBitmap = globalThis.createImageBitmap,
  FileClass = globalThis.File,
  makeId = createBackgroundUploadId,
  timeoutMs = DEFAULT_BACKGROUND_UPLOAD_TIMEOUT_MS
} = {}) {
  assertPermission(user);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new TypeError("The upload request timeout must be a positive duration in milliseconds.");
  const extension = await validateImage(file, FileClass, createImageBitmap);
  if (!picker || ["browse", "createDirectory", "uploadPersistent"].some(name => typeof picker[name] !== "function")) {
    throw new Error("Foundry's persistent file upload API is unavailable. Reload Foundry and try again.");
  }
  const files = await ensureStorage(picker, timeoutMs);
  const filename = uniqueFilename(extension, files, makeId);
  let uploadFile;
  try { uploadFile = new FileClass([file], filename, { type: FORMATS[extension] }); }
  catch (cause) { throw new Error("The browser could not prepare the background image for upload.", { cause }); }
  assertPermission(user);
  let response;
  try { response = await withTimeout(() => picker.uploadPersistent(MODULE_ID, "", uploadFile, {}, { notify: false }), "uploading the background image", timeoutMs); }
  catch (cause) {
    if (isTimeout(cause)) throw cause;
    throw new Error("The background upload failed. Check Foundry's file permissions and server connection, then try again.", { cause });
  }
  const expectedPath = `${BACKGROUND_STORAGE_PATH}/${filename}`;
  if (!response || typeof response !== "object" || Array.isArray(response) || response.error || response.success === false || response.ok === false || response.status === "error") {
    throw new Error("Foundry did not confirm a successful background upload. The current background has not changed.");
  }
  let path;
  try {
    path = validateAssetPath(response.path);
    if (!path.startsWith(`${BACKGROUND_STORAGE_PATH}/`) || decodeURIComponent(path) !== expectedPath) throw new Error("Unexpected uploaded image path.");
  } catch (cause) {
    throw new Error("Foundry returned an invalid background upload path. The current background has not changed.", { cause });
  }
  return path;
}
