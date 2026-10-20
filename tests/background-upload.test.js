import test from "node:test";
import assert from "node:assert/strict";
import {
  uploadBackground, createBackgroundUploadId, BackgroundUploadTimeoutError, BACKGROUND_STORAGE_PATH,
  MAX_BACKGROUND_UPLOAD_BYTES, DEFAULT_BACKGROUND_UPLOAD_TIMEOUT_MS
} from "../scripts/core/background-upload.js";
import { MODULE_ID, createOverlay, createState } from "../scripts/core/schema.js";
import { OverlayStore } from "../scripts/core/store.js";
import { OverlayRenderer } from "../scripts/render/renderer.js";

const UUID_ONE = "11111111-1111-4111-8111-111111111111";
const UUID_TWO = "22222222-2222-4222-8222-222222222222";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x48, 0x44, 0x52]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const imageFile = (name = "original.png", bytes = PNG, type = "image/png") => new File([bytes], name, { type });

function fixture(overrides = {}) {
  const calls = [];
  let closes = 0;
  const options = {
    user: { isGM: true, can: permission => permission === "FILES_UPLOAD" },
    picker: {
      async browse(...args) { calls.push(["browse", ...args]); return { target: BACKGROUND_STORAGE_PATH, files: [] }; },
      async createDirectory(...args) { calls.push(["createDirectory", ...args]); return { path: BACKGROUND_STORAGE_PATH }; },
      async uploadPersistent(...args) {
        calls.push(["uploadPersistent", ...args]);
        return { path: `${BACKGROUND_STORAGE_PATH}/${args[2].name}` };
      }
    },
    async createImageBitmap(file) { calls.push(["decode", file]); return { width: 1920, height: 1080, close: () => { closes++; } }; },
    FileClass: File,
    makeId: () => UUID_ONE,
    ...overrides
  };
  return { calls, options, closes: () => closes };
}

test("upload uses module persistent storage with a unique safe name and keeps the caller's file and draft unchanged", async () => {
  const { calls, options, closes } = fixture();
  const file = imageFile("../../old <frame>.PNG");
  const draft = createOverlay("Draft");
  draft.background.src = "worlds/example/existing.png";
  const beforeDraft = structuredClone(draft);
  const path = await uploadBackground(file, options);
  assert.equal(path, `${BACKGROUND_STORAGE_PATH}/background-${UUID_ONE}.png`);
  assert.equal(file.name, "../../old <frame>.PNG");
  assert.deepEqual(draft, beforeDraft);
  assert.equal(closes(), 1);
  assert.deepEqual(calls.map(call => call[0]), ["decode", "browse", "uploadPersistent"]);
  assert.deepEqual(calls[1], ["browse", "data", BACKGROUND_STORAGE_PATH, {}]);
  const [, packageId, folder, uploaded, body, uploadOptions] = calls[2];
  assert.equal(packageId, MODULE_ID);
  assert.equal(folder, "");
  assert.equal(uploaded.name, `background-${UUID_ONE}.png`);
  assert.equal(uploaded.type, "image/png");
  assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()), PNG);
  assert.deepEqual(body, {});
  assert.deepEqual(uploadOptions, { notify: false });
});

test("PNG, JPG, JPEG and WebP accept matching signatures and MIME types, including empty MIME", async () => {
  const formats = [
    ["frame.png", PNG, "image/png"], ["frame.jpg", JPEG, "image/jpeg"],
    ["frame.JPEG", JPEG, "image/jpeg"], ["frame.webp", WEBP, "image/webp"], ["frame.png", PNG, ""]
  ];
  for (const [name, bytes, type] of formats) {
    const { calls, options } = fixture();
    const path = await uploadBackground(imageFile(name, bytes, type), options);
    assert.match(path, new RegExp(`\\.${name.split(".").at(-1).toLowerCase()}$`));
    assert.equal(calls.filter(call => call[0] === "uploadPersistent").length, 1);
  }
});

test("only a GM with FILES_UPLOAD permission can upload or even read a selected file", async () => {
  for (const user of [null, {}, { isGM: false, can: () => true }, { isGM: true }, { isGM: true, can: () => false }]) {
    const { calls, options } = fixture({ user });
    await assert.rejects(uploadBackground(imageFile(), options), /Game Master|file upload permission/);
    assert.equal(calls.length, 0);
  }
});

test("permissions are checked again immediately before the upload request", async () => {
  const user = { isGM: true, can: () => true };
  const { calls, options } = fixture({ user });
  options.picker.browse = async (...args) => {
    calls.push(["browse", ...args]);
    user.isGM = false;
    return { target: BACKGROUND_STORAGE_PATH, files: [] };
  };
  await assert.rejects(uploadBackground(imageFile(), options), /Game Master/);
  assert.equal(calls.some(call => call[0] === "uploadPersistent"), false);
});

test("empty, excessive, invalid-sized and non-file inputs fail before decoding or storage calls", async () => {
  for (const file of [undefined, {}, imageFile("empty.png", new Uint8Array()), ...[NaN, Infinity, -1, MAX_BACKGROUND_UPLOAD_BYTES + 1].map(size => {
    const value = imageFile();
    Object.defineProperty(value, "size", { value: size });
    return value;
  })]) {
    const { calls, options } = fixture();
    await assert.rejects(uploadBackground(file, options), /file|size|25 MiB/);
    assert.equal(calls.length, 0);
  }
});

test("extension, MIME type and file header must all agree and SVG uploads are rejected", async () => {
  const invalid = [
    imageFile("frame.svg", new TextEncoder().encode("<svg/>"), "image/svg+xml"),
    imageFile("frame.gif", PNG, "image/png"), imageFile("frame", PNG, "image/png"),
    imageFile("frame.png", PNG, "text/html"), imageFile("frame.jpg", PNG, "image/jpeg"),
    imageFile("frame.png", JPEG, "image/png"), imageFile("frame.webp", JPEG, "image/webp"),
    imageFile("frame.png", new Uint8Array([0x89, 0x50]), "image/png"),
    imageFile("frame.png", new TextEncoder().encode("<script>alert(1)</script>"), "image/png")
  ];
  for (const file of invalid) {
    const { calls, options } = fixture();
    await assert.rejects(uploadBackground(file, options), /PNG|JPEG|WebP|file type|contents/);
    assert.equal(calls.length, 0);
  }
});

test("validation only reads the first 16 bytes before browser decoding", async () => {
  const file = imageFile();
  const originalSlice = file.slice.bind(file);
  const slices = [];
  Object.defineProperty(file, "slice", { value: (start, end) => { slices.push([start, end]); return originalSlice(start, end); } });
  const { options } = fixture();
  await uploadBackground(file, options);
  assert.deepEqual(slices, [[0, 16]]);
});

test("file read errors, unavailable image decoding and failed decodes do not touch storage", async () => {
  const unreadable = imageFile();
  Object.defineProperty(unreadable, "slice", { value: () => ({ arrayBuffer: async () => { throw new Error("Disk read failed"); } }) });
  const readFixture = fixture();
  await assert.rejects(uploadBackground(unreadable, readFixture.options), /could not be read/);
  assert.equal(readFixture.calls.length, 0);
  const unavailable = fixture({ createImageBitmap: null });
  await assert.rejects(uploadBackground(imageFile(), unavailable.options), /cannot validate image files/);
  assert.equal(unavailable.calls.length, 0);
  const rejected = fixture({ createImageBitmap: async () => { throw new Error("Not an image"); } });
  await assert.rejects(uploadBackground(imageFile(), rejected.options), /could not be decoded/);
  assert.equal(rejected.calls.length, 0);
  let closed = false;
  const zero = fixture({ createImageBitmap: async () => ({ width: 0, height: 10, close: () => { closed = true; } }) });
  await assert.rejects(uploadBackground(imageFile(), zero.options), /could not be decoded/);
  assert.equal(closed, true);
  assert.equal(zero.calls.length, 0);
});

test("a missing directory is created once and confirmed before upload", async () => {
  const { calls, options } = fixture();
  let browses = 0;
  options.picker.browse = async (...args) => {
    calls.push(["browse", ...args]);
    if (++browses === 1) throw new Error("Does not exist");
    return { target: BACKGROUND_STORAGE_PATH, files: [] };
  };
  await uploadBackground(imageFile(), options);
  assert.deepEqual(calls.map(call => call[0]), ["decode", "browse", "createDirectory", "browse", "uploadPersistent"]);
  assert.deepEqual(calls[2], ["createDirectory", "data", BACKGROUND_STORAGE_PATH, { notify: false }]);
});

test("directory creation races recover only when a second browse confirms the exact target", async () => {
  const { calls, options } = fixture();
  let browses = 0;
  options.picker.browse = async (...args) => {
    calls.push(["browse", ...args]);
    if (++browses === 1) throw new Error("Missing");
    return { target: `${BACKGROUND_STORAGE_PATH}/`, files: [] };
  };
  options.picker.createDirectory = async (...args) => { calls.push(["createDirectory", ...args]); throw new Error("Already exists"); };
  assert.match(await uploadBackground(imageFile(), options), /background-/);
  assert.equal(browses, 2);
});

test("directory failures and browse fallbacks cannot send a file to another directory", async () => {
  for (const browseResult of [undefined, {}, { target: "modules", files: [] }, { target: BACKGROUND_STORAGE_PATH, files: null }, { target: BACKGROUND_STORAGE_PATH, files: [], error: "Denied" }]) {
    const { calls, options } = fixture();
    options.picker.browse = async (...args) => { calls.push(["browse", ...args]); return browseResult; };
    options.picker.createDirectory = async (...args) => { calls.push(["createDirectory", ...args]); throw new Error("Permission denied"); };
    await assert.rejects(uploadBackground(imageFile(), options), /storage directory.*file permissions/);
    assert.equal(calls.some(call => call[0] === "uploadPersistent"), false);
  }
});

test("existing filenames trigger another UUID and are never selected for replacement", async () => {
  const { calls, options } = fixture();
  let attempts = 0;
  options.makeId = () => ++attempts === 1 ? UUID_ONE : UUID_TWO;
  options.picker.browse = async () => ({ target: BACKGROUND_STORAGE_PATH, files: [`${BACKGROUND_STORAGE_PATH}/background-${UUID_ONE}.png`] });
  const path = await uploadBackground(imageFile(), options);
  assert.equal(path, `${BACKGROUND_STORAGE_PATH}/background-${UUID_TWO}.png`);
  assert.equal(calls.find(call => call[0] === "uploadPersistent")[3].name, `background-${UUID_TWO}.png`);
  assert.equal(attempts, 2);
});

test("collision checks compare decoded basenames case-insensitively and stop after repeated collisions", async () => {
  const { calls, options } = fixture();
  options.picker.browse = async () => ({ target: BACKGROUND_STORAGE_PATH, files: [`https://host/prefix/${BACKGROUND_STORAGE_PATH}/BACKGROUND-%31${UUID_ONE.slice(1)}.PNG`] });
  await assert.rejects(uploadBackground(imageFile(), options), /unique background filename.*No existing image was overwritten/);
  assert.equal(calls.some(call => call[0] === "uploadPersistent"), false);
});

test("separate uploads use separate generated names without mutating the original filename", async () => {
  const { options } = fixture();
  let counter = 0;
  options.makeId = () => counter++ === 0 ? UUID_ONE : UUID_TWO;
  const file = imageFile("same.png");
  const first = await uploadBackground(file, options);
  const second = await uploadBackground(file, options);
  assert.notEqual(first, second);
  assert.equal(file.name, "same.png");
});

test("secure UUID generation supports randomUUID and the getRandomValues fallback used on LAN HTTP", () => {
  assert.equal(createBackgroundUploadId({ randomUUID: () => UUID_ONE }), UUID_ONE);
  const generated = createBackgroundUploadId({ getRandomValues(bytes) { bytes.fill(0xff); return bytes; } });
  assert.equal(generated, "ffffffff-ffff-4fff-bfff-ffffffffffff");
  assert.match(generated, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.throws(() => createBackgroundUploadId({}), /secure upload filename/);
  assert.throws(() => createBackgroundUploadId(null), /secure upload filename/);
});

test("unavailable Foundry APIs and unsafe UUID generators fail without uploading", async () => {
  for (const dependencies of [
    { picker: null }, { picker: { browse() {}, createDirectory() {} } },
    { makeId: null }, { makeId: () => "../old-image" }, { makeId: () => undefined }
  ]) {
    const { calls, options } = fixture(dependencies);
    await assert.rejects(uploadBackground(imageFile(), options), /API is unavailable|secure upload filename/);
    assert.equal(calls.some(call => call[0] === "uploadPersistent"), false);
  }
});

test("false, empty, error and missing-path upload responses are never reported as success", async () => {
  for (const response of [undefined, null, false, {}, [], { path: "" }, { error: "Denied" }, { success: false }, { ok: false }, { status: "error" }]) {
    const { options } = fixture();
    options.picker.uploadPersistent = async () => response;
    await assert.rejects(uploadBackground(imageFile(), options), /did not confirm|invalid background upload path/);
  }
});

test("upload rejects server errors and paths outside the exact generated storage file", async () => {
  const failed = fixture();
  failed.options.picker.uploadPersistent = async () => { throw new Error("Network failure"); };
  await assert.rejects(uploadBackground(imageFile(), failed.options), /background upload failed/);
  const invalidPaths = [
    "https://example.com/frame.png", "data:image/png;base64,A", "/modules/modular-stream-overlay/storage/frame.png",
    `${BACKGROUND_STORAGE_PATH}/../frame.png`, `${BACKGROUND_STORAGE_PATH}/frame.png`,
    `worlds/example/background-${UUID_ONE}.png`, `${BACKGROUND_STORAGE_PATH}/background-${UUID_ONE}.png?secret=1`
  ];
  for (const path of invalidPaths) {
    const { options } = fixture();
    options.picker.uploadPersistent = async () => ({ path });
    await assert.rejects(uploadBackground(imageFile(), options), /invalid background upload path/);
  }
});

test("a correctly encoded generated filename remains a validated relative storage reference", async () => {
  const { options } = fixture();
  const path = `${BACKGROUND_STORAGE_PATH}/background-%31${UUID_ONE.slice(1)}.png`;
  options.picker.uploadPersistent = async () => ({ path });
  assert.equal(await uploadBackground(imageFile(), options), path);
});

test("a disconnected browse times out without creating a directory or continuing after a late response", async () => {
  const { calls, options } = fixture({ timeoutMs: 5 });
  let resolveBrowse;
  options.picker.browse = (...args) => {
    calls.push(["browse", ...args]);
    return new Promise(resolve => { resolveBrowse = resolve; });
  };
  await assert.rejects(uploadBackground(imageFile(), options), error => {
    assert.ok(error instanceof BackgroundUploadTimeoutError);
    assert.equal(error.code, "BACKGROUND_UPLOAD_TIMEOUT");
    assert.match(error.message, /connection timed out.*checking.*Reconnect.*retry/);
    return true;
  });
  assert.deepEqual(calls.map(call => call[0]), ["decode", "browse"]);
  resolveBrowse({ target: BACKGROUND_STORAGE_PATH, files: [] });
  await new Promise(setImmediate);
  assert.deepEqual(calls.map(call => call[0]), ["decode", "browse"]);
});

test("a disconnected directory creation times out without rebrowsing or uploading after late completion", async () => {
  const { calls, options } = fixture({ timeoutMs: 5 });
  let resolveDirectory;
  options.picker.browse = async (...args) => { calls.push(["browse", ...args]); throw new Error("Missing directory"); };
  options.picker.createDirectory = (...args) => {
    calls.push(["createDirectory", ...args]);
    return new Promise(resolve => { resolveDirectory = resolve; });
  };
  await assert.rejects(uploadBackground(imageFile(), options), error => {
    assert.equal(error.code, "BACKGROUND_UPLOAD_TIMEOUT");
    assert.match(error.message, /connection timed out.*creating.*Reconnect.*retry/);
    return true;
  });
  assert.deepEqual(calls.map(call => call[0]), ["decode", "browse", "createDirectory"]);
  resolveDirectory({ path: BACKGROUND_STORAGE_PATH });
  await new Promise(setImmediate);
  assert.deepEqual(calls.map(call => call[0]), ["decode", "browse", "createDirectory"]);
});

test("the confirmation browse after directory creation also preserves timeout errors", async () => {
  const { calls, options } = fixture({ timeoutMs: 5 });
  let browses = 0;
  let rejectBrowse;
  options.picker.browse = (...args) => {
    calls.push(["browse", ...args]);
    if (++browses === 1) return Promise.reject(new Error("Missing directory"));
    return new Promise((_resolve, reject) => { rejectBrowse = reject; });
  };
  await assert.rejects(uploadBackground(imageFile(), options), { code: "BACKGROUND_UPLOAD_TIMEOUT" });
  assert.deepEqual(calls.map(call => call[0]), ["decode", "browse", "createDirectory", "browse"]);
  rejectBrowse(new Error("Late socket disconnect"));
  await new Promise(setImmediate);
  assert.equal(calls.some(call => call[0] === "uploadPersistent"), false);
});

test("an upload timeout leaves the draft unchanged and cannot apply a late server success", async () => {
  const { calls, options } = fixture({ timeoutMs: 5 });
  let resolveUpload;
  let uploadName;
  options.picker.uploadPersistent = (...args) => {
    calls.push(["uploadPersistent", ...args]);
    uploadName = args[2].name;
    return new Promise(resolve => { resolveUpload = resolve; });
  };
  const draft = createOverlay();
  draft.background.src = "worlds/example/current.png";
  let applied = false;
  const operation = uploadBackground(imageFile(), options).then(path => { draft.background.src = path; applied = true; });
  await assert.rejects(operation, error => {
    assert.equal(error.code, "BACKGROUND_UPLOAD_TIMEOUT");
    assert.match(error.message, /connection timed out.*uploading.*Reconnect.*Browse Existing.*may have uploaded.*has not changed/);
    return true;
  });
  resolveUpload({ path: `${BACKGROUND_STORAGE_PATH}/${uploadName}` });
  await new Promise(setImmediate);
  assert.equal(applied, false);
  assert.equal(draft.background.src, "worlds/example/current.png");
  assert.deepEqual(calls.map(call => call[0]), ["decode", "browse", "uploadPersistent"]);
});

test("request timers are cleared after success, server errors and timeout errors", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Set();
  const durations = [];
  globalThis.setTimeout = (callback, duration, ...args) => {
    const timer = originalSetTimeout(() => { timers.delete(timer); callback(...args); }, duration);
    timers.add(timer);
    durations.push(duration);
    return timer;
  };
  globalThis.clearTimeout = timer => { timers.delete(timer); originalClearTimeout(timer); };
  try {
    const success = fixture();
    await uploadBackground(imageFile(), success.options);
    assert.equal(timers.size, 0);
    assert.deepEqual(durations, [DEFAULT_BACKGROUND_UPLOAD_TIMEOUT_MS, DEFAULT_BACKGROUND_UPLOAD_TIMEOUT_MS]);
    assert.equal(DEFAULT_BACKGROUND_UPLOAD_TIMEOUT_MS, 60_000);
    const failed = fixture();
    failed.options.picker.uploadPersistent = async () => { throw new Error("Server failed"); };
    await assert.rejects(uploadBackground(imageFile(), failed.options), /upload failed/);
    assert.equal(timers.size, 0);
    const timedOut = fixture({ timeoutMs: 5 });
    timedOut.options.picker.browse = () => new Promise(() => {});
    await assert.rejects(uploadBackground(imageFile(), timedOut.options), { code: "BACKGROUND_UPLOAD_TIMEOUT" });
    assert.equal(timers.size, 0);
  } finally {
    for (const timer of timers) originalClearTimeout(timer);
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("invalid timeout durations fail before file reads or storage requests", async () => {
  for (const timeoutMs of [0, -1, Infinity, NaN, "5", 0.5, 2_147_483_648]) {
    const { calls, options } = fixture({ timeoutMs });
    await assert.rejects(uploadBackground(imageFile(), options), /positive duration/);
    assert.equal(calls.length, 0);
  }
});

test("an uploaded image persists through overlays and presets and renders through Foundry's route prefix", async () => {
  const { options } = fixture();
  const path = await uploadBackground(imageFile(), options);
  let savedState = createState();
  const settings = { get: () => savedState, set: async (_moduleId, _key, state) => { savedState = structuredClone(state); } };
  const store = new OverlayStore({ settings, getUser: () => options.user });
  const overlay = await store.createOverlay("Uploaded frame");
  overlay.background = { src: path, opacity: 0.55, fit: "contain" };
  await store.saveOverlay(overlay);
  const preset = await store.savePreset(overlay, "Uploaded frame preset");
  const loaded = await store.loadPreset(preset.id);
  const reloadedStore = new OverlayStore({ settings, getUser: () => options.user });
  const persisted = reloadedStore.getState().overlays.find(entry => entry.id === loaded.id);
  assert.deepEqual(persisted.background, overlay.background);
  assert.equal(reloadedStore.listPresets().find(entry => entry.id === preset.id).overlay.background.src, path);

  class Element {
    constructor() { this.style = {}; this.children = []; this.dataset = {}; this.classList = { add() {} }; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener() {}
    getBoundingClientRect() { return { width: 1920, height: 1080 }; }
  }
  const originals = { document: globalThis.document, foundry: globalThis.foundry, ResizeObserver: globalThis.ResizeObserver };
  let renderer;
  try {
    globalThis.document = { createElement: () => new Element() };
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.foundry = { utils: { getRoute: asset => `/table/${asset}` } };
    renderer = new OverlayRenderer(new Element());
    await renderer.render(persisted);
    const background = renderer.root.children[0];
    assert.equal(background.src, `/table/${path}`);
    assert.equal(background.style.opacity, "0.55");
    assert.equal(background.style.objectFit, "contain");
  } finally {
    renderer?.destroy();
    Object.assign(globalThis, originals);
  }
});
