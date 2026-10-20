import test from "node:test";
import assert from "node:assert/strict";
import {
  MODULE_ID, SCHEMA_VERSION, BUILTIN_PRESETS, clone, createOverlay, createState,
  validateAssetPath, validateOverlay, validateState
} from "../scripts/core/schema.js";
import { SETTINGS_KEY, OverlayStore, OverlayConflictError, registerSettings } from "../scripts/core/store.js";
import { WidgetRegistry, AdapterRegistry } from "../scripts/core/registry.js";
import { createLayer } from "../scripts/core/layers.js";

function fixture(initial = createState()) {
  let value = clone(initial);
  let user = { isGM: true };
  let failNextWrite = false;
  const writes = [];
  const changes = [];
  const settings = {
    get(moduleId, key) {
      assert.equal(moduleId, MODULE_ID);
      assert.equal(key, SETTINGS_KEY);
      return value;
    },
    async set(moduleId, key, next) {
      assert.equal(moduleId, MODULE_ID);
      assert.equal(key, SETTINGS_KEY);
      if (failNextWrite) { failNextWrite = false; throw new Error("Write failed"); }
      value = clone(next);
      writes.push(clone(next));
      return value;
    }
  };
  const store = new OverlayStore({ settings, getUser: () => user, onChange: state => changes.push(state) });
  return {
    store, settings, writes, changes,
    setExternal: state => { value = clone(state); },
    setUser: next => { user = next; },
    failNext: () => { failNextWrite = true; }
  };
}

test("default overlays and states are versioned, independent, transparent and system-neutral", () => {
  const first = createOverlay();
  const second = createOverlay("  Session two  ");
  assert.equal(MODULE_ID, "modular-stream-overlay");
  assert.equal(SCHEMA_VERSION, 6);
  assert.notEqual(first.id, second.id);
  assert.equal(second.name, "Session two");
  assert.deepEqual(first.canvas, { width: 1920, height: 1080 });
  assert.deepEqual(first.background, { src: "", opacity: 1, fit: "cover" });
  assert.deepEqual(first.adapter, { id: "generic", config: {} });
  first.canvas.width = 640;
  assert.equal(second.canvas.width, 1920);
  assert.deepEqual(validateState(createState()), createState());
});

test("asset references accept managed paths and reject executable, remote and traversal paths", () => {
  for (const path of ["", "worlds/my-world/images/Scene background.webp", "modules/my-module/assets/example.svg", "icons/svg/mystery-man.svg"]) {
    assert.equal(validateAssetPath(path), path);
  }
  for (const path of ["https://example.com/a.png", "http://localhost/a.png", "//example.com/a", "/icons/a.svg", "data:image/png;base64,A", "javascript:alert(1)", "file:///image.png", "../secret", "worlds/../secret", "worlds/%2e%2e/secret", "%2f%2fexample.com/a", "%6Aavascript:alert(1)", "worlds/%252e%252e/secret", "worlds\\secret.png", "\nicons/image.png", " icons/image.png", "icons/%00image.png", "icons/bad%XX.png"]) {
    assert.throws(() => validateAssetPath(path), TypeError, path);
  }
});

test("overlay validation bounds dimensions, opacity, fit, names and future schema versions", () => {
  const source = createOverlay();
  for (const width of [0, 63, 7681, Infinity, NaN, 1920.5, "1920"]) {
    assert.throws(() => validateOverlay({ ...source, canvas: { width, height: 1080 } }), TypeError);
  }
  for (const height of [0, 63, 7681, -1]) {
    assert.throws(() => validateOverlay({ ...source, canvas: { width: 1920, height } }), TypeError);
  }
  for (const opacity of [-1, 1.01, Infinity, "0.5"]) {
    assert.throws(() => validateOverlay({ ...source, background: { ...source.background, opacity } }), TypeError);
  }
  assert.throws(() => validateOverlay({ ...source, background: { ...source.background, fit: "fill" } }), TypeError);
  assert.throws(() => validateOverlay({ ...source, schemaVersion: SCHEMA_VERSION + 1 }), /version/);
  assert.throws(() => validateOverlay({ ...source, schemaVersion: undefined }), /version/);
  assert.throws(() => createOverlay(" "), TypeError);
  assert.throws(() => createOverlay("A".repeat(81)), TypeError);
  assert.throws(() => createOverlay("Name\nwith newline"), TypeError);
  const smallest = validateOverlay({ ...source, canvas: { width: 64, height: 64 } });
  assert.equal(smallest.canvas.width, 64);
  assert.equal(validateOverlay({ ...source, canvas: { width: 7680, height: 7680 } }).canvas.height, 7680);
});

test("validation strips unknown structure and preserves isolated safe extension configuration", () => {
  const source = createOverlay();
  source.privateActor = { secret: "not an overlay field" };
  source.canvas.unknown = true;
  source.background.unknown = true;
  source.widgets.push({ id: "name-1", type: "example:names", x: 10, width: 300, height: 120, config: { actorIds: ["a"], nested: { enabled: true } }, secret: "strip" });
  source.adapter = { id: "example.system", config: { resources: ["focus", 10, null] }, secret: "strip" };
  const result = validateOverlay(source);
  assert.equal(result.privateActor, undefined);
  assert.equal(result.canvas.unknown, undefined);
  assert.equal(result.background.unknown, undefined);
  assert.equal(result.widgets[0].secret, undefined);
  assert.equal(result.adapter.secret, undefined);
  assert.deepEqual(result.widgets[0].config, source.widgets[0].config);
  result.widgets[0].config.actorIds.push("b");
  assert.deepEqual(source.widgets[0].config.actorIds, ["a"]);
  assert.equal(result.widgets[0].visible, true);
  assert.equal(result.widgets[0].opacity, 1);
});

test("JSON extension configuration rejects prototypes, cycles, executable values and excessive data", () => {
  const input = createOverlay();
  const circular = {};
  circular.self = circular;
  for (const config of [circular, { fn: () => {} }, { x: undefined }, { x: NaN }, new Date(), JSON.parse('{"__proto__":{"polluted":true}}'), { constructor: {} }, { value: "a".repeat(65537) }]) {
    assert.throws(() => validateOverlay({ ...input, adapter: { id: "generic", config } }), TypeError);
  }
  assert.equal({}.polluted, undefined);
  assert.throws(() => clone({ value: BigInt(1) }), TypeError);
  let nested = {};
  for (let index = 0; index < 30; index++) nested = { nested };
  assert.throws(() => clone(nested), /deeply nested/);
});

test("layer and widget validation applies geometry defaults and rejects unsafe or duplicated records", () => {
  const source = createOverlay();
  source.layers = [
    { id: "matte", type: "color", color: "#12345678" },
    { id: "image", type: "image", src: "worlds/test/frame.png", fit: "stretch", opacity: 0.7, z: 10 }
  ];
  source.widgets = [{ id: "custom", type: "other-module:custom", config: {} }];
  const result = validateOverlay(source);
  assert.equal(result.layers[0].width, 1920);
  assert.equal(result.layers[1].name, "Image layer");
  assert.equal(result.layers[1].fit, "stretch");
  assert.equal(result.widgets[0].height, 1080);
  for (const invalid of [
    { id: "one", type: "invalid type", markup: "<script>" },
    { id: "one", type: "color", color: "url(javascript:alert(1))" },
    { id: "one", type: "image", src: "https://example.com/a.png" },
    { id: "one", type: "color", width: 0 },
    { id: "one", type: "color", x: Infinity },
    { id: "one", type: "color", visible: "false" },
    { id: "one", type: "color", z: 0.1 }
  ]) assert.throws(() => validateOverlay({ ...source, layers: [invalid] }), TypeError);
  assert.throws(() => validateOverlay({ ...source, widgets: [source.widgets[0], source.widgets[0]] }), /duplicate/);
  assert.throws(() => validateOverlay({ ...source, layers: Array(101).fill(source.layers[0]) }), /100/);
});

test("state validation detects invalid active IDs, duplicate IDs and reserved preset IDs", () => {
  const overlay = createOverlay();
  const state = { ...createState(), overlays: [overlay], activeOverlayId: overlay.id };
  assert.deepEqual(validateState(state), state);
  assert.throws(() => validateState({ ...state, activeOverlayId: "missing" }), /does not exist/);
  assert.throws(() => validateState({ ...state, overlays: [overlay, overlay] }), /duplicate/);
  assert.throws(() => validateState({ ...state, revision: -1 }), /revision/);
  assert.throws(() => validateState({ ...state, revision: 0.5 }), /revision/);
  assert.throws(() => validateState({ ...state, schemaVersion: 99 }), /version/);
  assert.throws(() => validateState({ ...state, presets: [{ schemaVersion: 1, id: "builtin-fake", name: "Fake", overlay }] }), /reserved/);
  assert.throws(() => validateState({ ...state, overlays: Array(101).fill(overlay) }), /100/);
});

test("store creates, saves, renames, selects and deletes overlays with persistent revisions", async () => {
  const { store, writes, changes } = fixture();
  const first = await store.createOverlay("Opening scene");
  const second = await store.createOverlay("Encounter");
  assert.equal(store.getState().activeOverlayId, first.id);
  assert.equal(store.getState().revision, 2);
  await store.renameOverlay(first.id, "  Opening  ");
  assert.equal(store.getState().overlays[0].name, "Opening");
  const draft = store.getState().overlays[0];
  draft.background.src = "worlds/example/background.webp";
  const saved = await store.saveOverlay(draft, { expectedRevision: 3 });
  saved.background.src = "icons/changed.svg";
  assert.equal(store.getState().overlays[0].background.src, draft.background.src);
  await store.setActive(second.id);
  assert.equal(store.getState().activeOverlayId, second.id);
  await store.deleteOverlay(second.id);
  assert.equal(store.getState().activeOverlayId, null);
  await store.deleteOverlay(first.id);
  assert.equal(store.getState().activeOverlayId, null);
  assert.equal(store.getState().revision, 7);
  assert.equal(writes.length, 7);
  assert.equal(changes.length, 7);
  changes[0].overlays.length = 0;
  assert.equal(writes[0].overlays.length, 1);
});

test("explicit None selection stays off air through saves, creates and preset loads", async () => {
  const { store } = fixture();
  const first = await store.createOverlay("First");
  await store.setActive(null);
  first.name = "Changed while off air";
  await store.saveOverlay(first);
  assert.equal(store.getState().activeOverlayId, null);
  await store.saveOverlay(createOverlay("New saved draft"));
  assert.equal(store.getState().activeOverlayId, null);
  await store.createOverlay("Another draft");
  assert.equal(store.getState().activeOverlayId, null);
  await store.loadPreset("builtin-background", first.id);
  assert.equal(store.getState().activeOverlayId, null);
  await store.loadPreset("builtin-transparent");
  assert.equal(store.getState().activeOverlayId, null);
  await store.setActive(first.id);
  await store.deleteOverlay(first.id);
  assert.equal(store.getState().activeOverlayId, null);
  assert.ok(store.getState().overlays.length > 0);
});

test("the first overlay from save or preset load becomes active in an empty world", async () => {
  const savedFixture = fixture();
  const saved = await savedFixture.store.saveOverlay(createOverlay("First saved overlay"));
  assert.equal(savedFixture.store.getState().activeOverlayId, saved.id);
  const loadedFixture = fixture();
  const loaded = await loadedFixture.store.loadPreset("builtin-background");
  assert.equal(loadedFixture.store.getState().activeOverlayId, loaded.id);
});

test("store reads current world state on each write and serializes concurrent local changes", async () => {
  const { store, setExternal } = fixture();
  const results = await Promise.all([store.createOverlay("First"), store.createOverlay("Second")]);
  assert.equal(store.getState().overlays.length, 2);
  const external = store.getState();
  external.revision += 1;
  external.overlays.push(createOverlay("Another GM"));
  setExternal(external);
  await store.renameOverlay(results[0].id, "Renamed");
  assert.equal(store.getState().overlays.length, 3);
  assert.equal(store.getState().overlays[2].name, "Another GM");
  assert.equal(store.getState().revision, 4);
});

test("stale expected revisions reject writes and leave saved data intact", async () => {
  const { store, writes } = fixture();
  const overlay = await store.createOverlay();
  overlay.name = "Stale edit";
  await assert.rejects(store.saveOverlay(overlay, { expectedRevision: 0 }), OverlayConflictError);
  await assert.rejects(store.deleteOverlay(overlay.id, { expectedRevision: 0 }), { code: "OVERLAY_REVISION_CONFLICT" });
  await assert.rejects(store.saveOverlay(overlay, { expectedRevision: "1" }), TypeError);
  assert.equal(writes.length, 1);
  assert.equal(store.getState().overlays[0].name, "New overlay");
  await store.saveOverlay(overlay, { expectedRevision: 1 });
  assert.equal(store.getState().overlays[0].name, "Stale edit");
});

test("GM authorization guards every mutation and is rechecked when queued operations run", async () => {
  const fixtureData = fixture();
  const { store, setUser, writes } = fixtureData;
  const overlay = await store.createOverlay();
  const preset = await store.savePreset(overlay, "Custom");
  setUser({ isGM: false });
  const attempts = [
    () => store.createOverlay(), () => store.saveOverlay(overlay), () => store.renameOverlay(overlay.id, "No"),
    () => store.deleteOverlay(overlay.id), () => store.setActive(null), () => store.savePreset(overlay),
    () => store.loadPreset(preset.id), () => store.renamePreset(preset.id, "No"),
    () => store.duplicatePreset(preset.id), () => store.deletePreset(preset.id)
  ];
  for (const attempt of attempts) await assert.rejects(attempt(), /Only a Game Master/);
  assert.equal(writes.length, 2);
  assert.equal(store.getState().overlays.length, 1);
  assert.equal(store.listPresets().length, 3);
  setUser(null);
  await assert.rejects(store.createOverlay(), /Only a Game Master/);
});

test("custom presets persist, load as copies and preserve a target overlay identity", async () => {
  const { store, settings } = fixture();
  const source = await store.createOverlay("Scene one");
  source.background = { src: "worlds/example/forest.webp", opacity: 0.4, fit: "contain" };
  source.layers = [
    Object.assign(createLayer("image"), { src: "worlds/example/frame.webp", x: 80, y: 120, width: 400, height: 500, rotation: 30, opacity: .6, locked: true, z: 4 }),
    Object.assign(createLayer("text"), { text: "Welcome\n<literal>", fontFamily: "Courier New", fontSize: 75.5, fontWeight: "700", color: "#abc8", align: "center", shadow: true, z: 8 })
  ];
  const preset = await store.savePreset(source, "Forest");
  source.background.src = "icons/changed.svg";
  assert.equal(store.listPresets().find(entry => entry.id === preset.id).overlay.background.src, "worlds/example/forest.webp");
  const target = await store.createOverlay("Target identity");
  const loaded = await store.loadPreset(preset.id, target.id);
  assert.equal(loaded.id, target.id);
  assert.equal(loaded.name, "Target identity");
  assert.equal(loaded.background.opacity, 0.4);
  assert.deepEqual(loaded.layers, source.layers, "Preset load preserves the complete visual composition");
  loaded.layers[1].text = "Private draft change";
  assert.equal(store.listPresets().find(entry => entry.id === preset.id).overlay.layers[1].text, "Welcome\n<literal>");
  const created = await store.loadPreset(preset.id);
  assert.notEqual(created.id, source.id);
  assert.notEqual(created.id, target.id);
  assert.equal(created.name, "Forest");
  await store.renamePreset(preset.id, "Dark forest");
  const copy = await store.duplicatePreset(preset.id);
  assert.notEqual(copy.id, preset.id);
  assert.equal(copy.name, "Dark forest copy");
  await store.deletePreset(preset.id);
  const reloaded = new OverlayStore({ settings, getUser: () => ({ isGM: true }) });
  assert.equal(reloaded.listPresets().filter(entry => !entry.builtin).length, 1);
  assert.equal(reloaded.listPresets().find(entry => entry.id === copy.id).name, "Dark forest copy");
  assert.deepEqual(reloaded.listPresets().find(entry => entry.id === copy.id).overlay.layers, source.layers);
});

test("built-ins are immutable and can be duplicated or loaded without editing source templates", async () => {
  const { store } = fixture();
  assert.equal(BUILTIN_PRESETS.length, 2);
  assert.throws(() => { BUILTIN_PRESETS[0].overlay.canvas.width = 10; }, TypeError);
  for (const id of ["builtin-transparent", "builtin-background"]) {
    await assert.rejects(store.renamePreset(id, "Changed"), /Built-in presets/);
    await assert.rejects(store.deletePreset(id), /Built-in presets/);
  }
  const listed = store.listPresets();
  listed[0].overlay.background.src = "icons/change.svg";
  assert.equal(store.listPresets()[0].overlay.background.src, "");
  const copy = await store.duplicatePreset("builtin-background", "My backdrop");
  assert.equal(copy.name, "My backdrop");
  assert.equal(store.getState().presets.length, 1);
  const loaded = await store.loadPreset("builtin-transparent");
  assert.equal(loaded.background.src, "");
  assert.equal(store.getState().activeOverlayId, loaded.id);
});

test("invalid mutations and failed persistence never advance revision and do not poison the queue", async () => {
  const { store, failNext, setExternal } = fixture();
  await assert.rejects(store.createOverlay(""), TypeError);
  assert.equal(store.getState().revision, 0);
  failNext();
  await assert.rejects(store.createOverlay("Failed"), /Write failed/);
  assert.equal(store.getState().revision, 0);
  const created = await store.createOverlay("Recovered");
  await assert.rejects(store.renameOverlay("missing", "Name"), /no longer exists/);
  await assert.rejects(store.loadPreset("missing", created.id), /no longer exists/);
  assert.equal(store.getState().revision, 1);
  setExternal({ ...store.getState(), schemaVersion: 99 });
  assert.throws(() => store.getState(), /version/);
  await assert.rejects(store.createOverlay(), /version/);
});

test("world settings registration exposes versioned defaults and validated external updates", () => {
  const original = globalThis.game;
  const events = [];
  let registered;
  globalThis.game = { settings: { register: (moduleId, key, config) => { registered = { moduleId, key, config }; } } };
  try {
    registerSettings((state, error) => events.push({ state, error }));
    assert.equal(registered.moduleId, MODULE_ID);
    assert.equal(registered.key, "state");
    assert.equal(registered.config.scope, "world");
    assert.equal(registered.config.type, Object);
    assert.equal(registered.config.config, false);
    assert.deepEqual(registered.config.default, createState());
    registered.config.onChange(createState());
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].state, createState());
    assert.equal(events[0].error, null);
    assert.doesNotThrow(() => registered.config.onChange({ ...createState(), schemaVersion: 99 }));
    assert.equal(events[1].state, null);
    assert.match(events[1].error.message, /version/);
  } finally { globalThis.game = original; }
});

test("legacy settings migrate in memory without writes and save complete migrated presets explicitly", async () => {
  const legacy = createOverlay("Legacy overlay");
  legacy.schemaVersion = 1;
  legacy.background = { src: "worlds/example/background.webp", opacity: 0.5, fit: "contain" };
  legacy.layers = [{ id: "image-frame", type: "image", src: "worlds/example/frame.webp", x: 100, y: 120, width: 500, height: 300 }];
  legacy.widgets = [{ id: "legacy-widget", type: "example:widget", config: { actorIds: ["abc"], enabled: true } }];
  const legacyPreset = clone(legacy);
  delete legacyPreset.layers;
  const saved = {
    schemaVersion: 1, revision: 7, activeOverlayId: legacy.id, overlays: [legacy],
    presets: [{ schemaVersion: 1, id: "legacy-preset", name: "Legacy preset", overlay: legacyPreset }]
  };
  const original = clone(saved);
  const { store, writes } = fixture(saved);
  const migrated = store.getState();
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.revision, 7);
  assert.equal(migrated.overlays[0].schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.overlays[0].id, legacy.id);
  assert.deepEqual(migrated.overlays[0].background, legacy.background);
  assert.deepEqual(migrated.overlays[0].widgets[0].config, legacy.widgets[0].config);
  assert.equal(migrated.overlays[0].layers[0].lockAspectRatio, false);
  assert.equal(migrated.overlays[0].layers[0].rotation, 0);
  assert.equal(migrated.overlays[0].layers[0].locked, false);
  assert.deepEqual(migrated.presets[0].overlay.layers, []);
  assert.equal(migrated.presets[0].schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(saved, original);
  assert.equal(writes.length, 0);
  const loaded = await store.loadPreset("legacy-preset", legacy.id);
  assert.equal(loaded.id, legacy.id);
  assert.deepEqual(loaded.layers, []);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].schemaVersion, SCHEMA_VERSION);
  assert.equal(writes[0].revision, 8);
  assert.deepEqual(writes[0].presets[0].overlay.widgets[0].config, legacy.widgets[0].config);
});

test("widget registry validates callbacks, protects registrations and preserves JSON configuration schemas", () => {
  const widgets = new WidgetRegistry();
  const render = () => {};
  const definition = { id: "example:portrait", label: "Portrait", render, update() {}, destroy() {}, defaults: { showName: true }, configSchema: { type: "object", properties: { showName: { type: "boolean" } } } };
  const registered = widgets.register(definition);
  assert.equal(widgets.get(definition.id), registered);
  assert.equal(registered.render, render);
  assert.equal(widgets.get("missing"), undefined);
  definition.defaults.showName = false;
  assert.equal(registered.defaults.showName, true);
  assert.throws(() => { registered.defaults.showName = false; }, TypeError);
  widgets.list().length = 0;
  assert.equal(widgets.list().length, 1);
  assert.throws(() => widgets.register(definition), /already exists/);
  assert.throws(() => widgets.register({ id: "bad", label: "Bad" }), /render/);
  assert.throws(() => widgets.register({ id: "has spaces", label: "Bad", render }), /ID/);
  assert.throws(() => widgets.register({ id: "empty", label: " ", render }), /label/);
  assert.throws(() => widgets.register({ id: "bad-update", label: "Bad", render, update: "function" }), /update/);
  assert.throws(() => widgets.register({ id: "bad-defaults", label: "Bad", render, defaults: { constructor: {} } }), /unsafe/);
});

test("adapter registry supports generic and system-specific adapters without core field assumptions", () => {
  const adapters = new AdapterRegistry();
  const normalize = (actor, { user }) => ({ id: actor.id, name: user ? actor.name : "" });
  const generic = adapters.register({ id: "generic", label: "Generic", systemId: null, normalize });
  const specific = adapters.register({ id: "my-system:adapter", label: "My system", systemId: "custom-system", normalize });
  assert.equal(generic.systemId, null);
  assert.equal(specific.systemId, "custom-system");
  assert.deepEqual(generic.normalize({ id: "a", name: "Hero" }, { user: {} }), { id: "a", name: "Hero" });
  assert.equal(adapters.list().length, 2);
  assert.throws(() => adapters.register({ id: "generic", label: "Generic", normalize }), /already exists/);
  assert.throws(() => adapters.register({ id: "bad", label: "Bad" }), /normalize/);
  assert.throws(() => adapters.register({ id: "bad", label: "Bad", systemId: "has spaces", normalize }), /systemId/);
});
