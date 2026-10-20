import test from "node:test";
import assert from "node:assert/strict";
import {
  MODULE_ID, SCHEMA_VERSION, WIDGET_PRESET_SCHEMA_VERSION, clone, createOverlay, createState, validateActorUuid,
  validateCharacterBinding, validateLayer, validateOverlay
} from "../scripts/core/schema.js";
import { createLayer, createWidgetInstance, duplicateLayer } from "../scripts/core/layers.js";
import { OverlayStore } from "../scripts/core/store.js";
import {
  WIDGET_SETTINGS_KEY, WIDGET_DEFINITIONS, WidgetPresetStore, WidgetPresetConflictError,
  createWidgetPreset, createWidgetPresetState, validateWidgetPreset, validateWidgetPresetState,
  widgetPresetToOverlay, overlayToWidgetPreset, registerWidgetSettings
} from "../scripts/core/widget-presets.js";

function fixture(initial = createWidgetPresetState()) {
  let value = clone(initial);
  let user = { isGM: true };
  let failNext = false;
  const writes = [];
  const changes = [];
  const settings = {
    get(moduleId, key) {
      assert.equal(moduleId, MODULE_ID);
      assert.equal(key, WIDGET_SETTINGS_KEY);
      return value;
    },
    async set(moduleId, key, next) {
      assert.equal(moduleId, MODULE_ID);
      assert.equal(key, WIDGET_SETTINGS_KEY);
      if (failNext) { failNext = false; throw new Error("Write failed"); }
      value = clone(next);
      writes.push(clone(next));
      return value;
    }
  };
  return {
    store: new WidgetPresetStore({ settings, getUser: () => user, onChange: state => changes.push(state) }),
    settings, writes, changes, setUser: next => { user = next; },
    setExternal: next => { value = clone(next); }, failNext: () => { failNext = true; }
  };
}

test("widget definitions and independent editable examples load without any game system", () => {
  assert.deepEqual(WIDGET_DEFINITIONS.map(entry => entry.type), ["character-portrait", "character-name", "dynamic-text", "dynamic-number", "resource-bar"]);
  assert.equal(Object.isFrozen(WIDGET_DEFINITIONS), true);
  assert.equal(Object.isFrozen(WIDGET_DEFINITIONS[0]), true);
  const first = createWidgetPresetState();
  const second = createWidgetPresetState();
  assert.deepEqual(first, second, "Default component and preset IDs are stable");
  assert.deepEqual(first.presets.map(entry => entry.name), ["Basic Character Card", "Compact Character Card"]);
  first.presets[0].layers[0].color = "#fff";
  assert.equal(second.presets[0].layers[0].color, "#161d27");
  assert.doesNotThrow(() => validateWidgetPresetState(second));
  assert.equal(second.presets[0].layers.some(layer => layer.type === "dynamic-text"), true);
  assert.equal(second.presets[1].layers.some(layer => layer.type === "resource-bar"), true);
});

test("dynamic component defaults and style fields round trip safe literal content", () => {
  const preset = createWidgetPreset("  Reusable card  ");
  assert.equal(preset.name, "Reusable card");
  assert.deepEqual(preset.canvas, { width: 400, height: 180 });
  preset.layers = WIDGET_DEFINITIONS.map(({ type }) => createLayer(type, preset.canvas));
  const portrait = preset.layers[0];
  Object.assign(portrait, { src: "worlds/example/fallback.webp", portraitSource: "token", circular: true, borderRadius: 32, fit: "contain" });
  const template = preset.layers[2];
  Object.assign(template, { text: "<strong>HP {character.hp.current}/{character.hp.max}</strong>\n{character.name}", fallback: "No data", fontWeight: "700", shadow: true, color: "#abcd" });
  const bar = preset.layers[4];
  Object.assign(bar, { foregroundColor: "#1234", backgroundColor: "#abcdef", showValue: false, fontSize: 16 });
  assert.deepEqual(validateWidgetPreset(JSON.parse(JSON.stringify(preset))), preset);
  assert.equal(preset.layers[1].binding, "character.name");
  assert.equal(preset.layers[3].binding, "character.hp.current");
  assert.equal(bar.maxBinding, "character.hp.max");
  assert.equal(portrait.lockAspectRatio, true);
});

test("binding identifiers exclude expressions and private document paths; Actor IDs are world-only", () => {
  for (const binding of ["character.name", "character.hp.current", "character.attributes.strength", "character.custom_resource.max"]) assert.equal(validateCharacterBinding(binding), binding);
  for (const binding of ["", "system.attributes.hp.value", "character", "character.__proto__.value", "character.constructor", "character.prototype", "character.custom-resource", "character.hp.current+1", "character['name']", "character.hp()", "character..name", "character.name ", "character.name\n", "character.a.b.c.d.e.f", "character." + "a".repeat(49)]) {
    assert.throws(() => validateCharacterBinding(binding), /normalized character field/);
  }
  assert.equal(validateActorUuid(""), "");
  assert.equal(validateActorUuid("Actor.aBC123xyz"), "Actor.aBC123xyz");
  for (const uuid of ["Actor.", "Actor.a.b", "Scene.scene.Token.token.Actor.actor", "Compendium.world.actors.Actor.a", "https://example.com/Actor.a", "@UUID[Actor.a]", " Actor.a", "Actor.a\n", { uuid: "Actor.a" }]) assert.throws(() => validateActorUuid(uuid), /world Actor UUID/);
});

test("component validation bounds bindings, portrait options, resource colors, styles and templates", () => {
  const portrait = createLayer("character-portrait");
  for (const patch of [{ fit: "stretch" }, { portraitSource: "synthetic" }, { circular: "true" }, { borderRadius: -1 }, { borderRadius: 3841 }, { lockAspectRatio: "true" }, { src: "https://example.com/a.png" }]) {
    assert.throws(() => validateLayer({ ...portrait, ...patch }), TypeError);
  }
  const bar = createLayer("resource-bar");
  for (const patch of [{ binding: "system.hp.value" }, { maxBinding: "character.constructor" }, { foregroundColor: "red" }, { backgroundColor: "transparent" }, { showValue: 1 }, { fontSize: 513 }, { fallback: "a".repeat(1001) }]) assert.throws(() => validateLayer({ ...bar, ...patch }), TypeError);
  const dynamic = createLayer("dynamic-text");
  assert.throws(() => validateLayer({ ...dynamic, text: "x".repeat(10001) }), TypeError);
  assert.throws(() => validateLayer({ ...dynamic, fallback: "\0" }), TypeError);
  assert.throws(() => validateLayer({ ...dynamic, fontWeight: 700 }), TypeError);
});

test("preset conversion reuses overlay editing coordinates without copying Actors or nested instances", () => {
  const source = createWidgetPreset("Card");
  source.layers = [createLayer("character-name", source.canvas), createLayer("image", source.canvas)];
  source.actorUuid = "Actor.design-must-not-bind";
  source.actor = { system: { secret: "private" } };
  source.layers[0].actorUuid = "Actor.never-bind-design";
  const overlay = widgetPresetToOverlay(source);
  assert.equal(overlay.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(overlay.widgets, []);
  assert.deepEqual(overlay.adapter, { id: "generic", config: {} });
  assert.equal(overlay.actor, undefined);
  assert.equal(overlay.layers[0].actorUuid, undefined);
  assert.deepEqual(overlayToWidgetPreset(overlay), validateWidgetPreset(source));
  const instance = createWidgetInstance(source);
  overlay.layers.push(instance);
  assert.throws(() => overlayToWidgetPreset(overlay), /nested widget instances/);
  assert.throws(() => validateWidgetPreset({ ...source, layers: [instance] }), /nested widget instances/);
  const legacy = createOverlay();
  legacy.widgets.push({ id: "old-widget", type: "custom", config: {} });
  assert.throws(() => overlayToWidgetPreset(legacy), /legacy widgets/);
  const renamed = overlayToWidgetPreset(widgetPresetToOverlay(source), { id: "new-card", name: "New card" });
  assert.equal(renamed.id, "new-card");
  assert.equal(renamed.name, "New card");
});

test("instances share only preset references and retain independent Actor identities and style overrides", () => {
  const preset = createWidgetPreset("Shared design");
  preset.layers = [{ ...createLayer("character-name"), id: "name-field" }];
  const first = createWidgetInstance(preset, { actorUuid: "Actor.heroA", overrides: { "name-field": { fontSize: 22, color: "#abc" } } });
  const second = createWidgetInstance(preset, { actorUuid: "Actor.heroB", x: 600 });
  assert.notEqual(first.id, second.id);
  assert.equal(first.presetId, second.presetId);
  assert.equal(first.actorUuid, "Actor.heroA");
  assert.equal(second.actorUuid, "Actor.heroB");
  assert.equal(first.layers, undefined);
  assert.equal(first.preset, undefined);
  assert.deepEqual(second.overrides, {});
  preset.layers[0].fontSize = 48;
  assert.equal(first.actorUuid, "Actor.heroA");
  assert.equal(second.actorUuid, "Actor.heroB");
  const overlay = createOverlay();
  overlay.layers = [first, second];
  const copy = duplicateLayer(overlay, first.id);
  copy.actorUuid = "Actor.heroC";
  copy.overrides["name-field"].fontSize = 30;
  assert.equal(first.actorUuid, "Actor.heroA");
  assert.equal(first.overrides["name-field"].fontSize, 22);
  assert.equal(copy.presetId, first.presetId);
  assert.doesNotThrow(() => validateOverlay(overlay));
});

test("instances strip full documents and unsafe override fields instead of expanding publication scope", () => {
  const preset = createWidgetPreset();
  const input = {
    ...createWidgetInstance(preset), actorUuid: "Actor.safe", actor: { system: { private: true } }, presentation: { secret: true },
    overrides: { component: { opacity: .5, visible: false, fontFamily: "Georgia", fontSize: 20, fontWeight: "600", color: "#fff", align: "center", shadow: true, fit: "cover", circular: true, borderRadius: 10, foregroundColor: "#abc", backgroundColor: "#000", showValue: false, actorUuid: "Actor.private", binding: "character.secret", text: "secret", src: "secret.png", system: { notes: "secret" } } }
  };
  const result = validateLayer(input);
  assert.equal(result.actor, undefined);
  assert.equal(result.presentation, undefined);
  assert.deepEqual(Object.keys(result.overrides.component), ["opacity", "visible", "fontFamily", "fontSize", "fontWeight", "color", "align", "shadow", "fit", "circular", "borderRadius", "foregroundColor", "backgroundColor", "showValue"]);
  for (const overrides of [{ component: { opacity: 2 } }, { component: { fontWeight: 600 } }, { component: { fit: "stretch" } }, { component: { color: "url(secret)" } }, JSON.parse('{"__proto__":{"visible":true}}'), { component: { constructor: {} } }]) assert.throws(() => validateLayer({ ...input, overrides }), TypeError);
  assert.throws(() => validateLayer({ ...input, actorUuid: "Scene.s.Token.t.Actor.a" }), /world Actor UUID/);
});

test("overlay presets preserve complete widget instance references and reconnectable independent bindings", async () => {
  let state = createState();
  const settings = { get: () => state, set: async (_module, _key, next) => { state = clone(next); } };
  const store = new OverlayStore({ settings, getUser: () => ({ isGM: true }) });
  const preset = createWidgetPreset("Shared");
  const overlay = createOverlay("Party");
  overlay.layers = [
    createWidgetInstance(preset, { actorUuid: "Actor.a", x: 40, y: 80, opacity: .7, rotation: 15, visible: false, locked: true, overrides: { hp: { foregroundColor: "#abc" } } }),
    createWidgetInstance(preset, { actorUuid: "Actor.b", x: 500, width: 200, height: 90, z: 4 })
  ];
  const savedPreset = await store.savePreset(overlay, "Party layout");
  const restored = await store.loadPreset(savedPreset.id);
  assert.deepEqual(restored.layers, overlay.layers);
  assert.equal(restored.layers[0].presetId, restored.layers[1].presetId);
  assert.equal(restored.layers[0].actorUuid, "Actor.a");
  assert.equal(restored.layers[1].actorUuid, "Actor.b");
  assert.equal(JSON.stringify(state).includes('"system"'), false);
});

test("widget store persists edits, supports all management operations and does not reseed deleted examples", async () => {
  const { store, settings, writes, changes } = fixture();
  const examples = store.list();
  assert.equal(writes.length, 0);
  await store.rename(examples[0].id, "My basic card");
  await store.delete(examples[1].id);
  const created = await store.create("Designed card");
  created.layers.push(createLayer("character-name", created.canvas));
  const saved = await store.save(created);
  assert.deepEqual(saved.layers, created.layers);
  const duplicate = await store.duplicate(saved.id);
  assert.notEqual(duplicate.id, saved.id);
  assert.equal(duplicate.name, "Designed card copy");
  duplicate.layers[0].fontSize = 100;
  assert.equal(store.list().find(entry => entry.id === saved.id).layers[0].fontSize, 32);
  const reloaded = new WidgetPresetStore({ settings, getUser: () => ({ isGM: true }) });
  assert.equal(reloaded.getState().revision, 5);
  assert.equal(reloaded.list().length, 3);
  assert.equal(reloaded.list().some(entry => entry.id === examples[1].id), false);
  assert.equal(reloaded.list()[0].name, "My basic card");
  assert.equal(writes.length, 5);
  assert.equal(changes.length, 5);
  const returned = store.getState();
  returned.presets[0].name = "Uncommitted";
  assert.equal(store.list()[0].name, "My basic card");
});

test("widget preset revisions detect stale drafts and failed writes preserve state and queue", async () => {
  const { store, writes, failNext } = fixture();
  const created = await store.create("First", { expectedRevision: 0 });
  await assert.rejects(store.save(created, { expectedRevision: 0 }), WidgetPresetConflictError);
  assert.equal(writes.length, 1);
  failNext();
  await assert.rejects(store.rename(created.id, "Not saved", { expectedRevision: 1 }), /Write failed/);
  assert.equal(store.getState().revision, 1);
  assert.equal(store.list().find(entry => entry.id === created.id).name, "First");
  await store.rename(created.id, "Saved", { expectedRevision: 1 });
  assert.equal(store.getState().revision, 2);
  await assert.rejects(store.delete("missing"), /no longer exists/);
  await assert.rejects(store.create("Name", { expectedRevision: -1 }), /revision/);
  await assert.rejects(store.create("Name", { expectedRevision: 2.5 }), /revision/);
  assert.equal(store.getState().revision, 2);
});

test("widget preset GM guard applies to every mutation while reads remain side-effect-free", async () => {
  const { store, writes, setUser } = fixture();
  const preset = store.list()[0];
  setUser({ isGM: false });
  for (const operation of [() => store.save(preset), () => store.create(), () => store.rename(preset.id, "No"), () => store.duplicate(preset.id), () => store.delete(preset.id)]) await assert.rejects(operation(), /Only a Game Master/);
  assert.equal(store.list().length, 2);
  assert.equal(writes.length, 0);
  setUser(null);
  await assert.rejects(store.create(), /Only a Game Master/);
});

test("widget settings validation rejects invalid versions, duplicates, unsafe designs and size limits", () => {
  const state = createWidgetPresetState();
  for (const input of [null, [], new Date(), { ...state, schemaVersion: WIDGET_PRESET_SCHEMA_VERSION + 1 }, { ...state, revision: -1 }, { ...state, revision: Infinity }, { ...state, presets: [state.presets[0], state.presets[0]] }, { ...state, presets: Array(101).fill(state.presets[0]) }]) assert.throws(() => validateWidgetPresetState(input), TypeError);
  assert.throws(() => validateWidgetPreset({ ...state.presets[0], schemaVersion: WIDGET_PRESET_SCHEMA_VERSION + 1 }), /version/);
  assert.throws(() => validateWidgetPreset({ ...state.presets[0], canvas: { width: 0, height: 180 } }), /Canvas width/);
  assert.throws(() => validateWidgetPreset({ ...state.presets[0], background: { src: "https://example.com/bg.webp" } }), /managed files/);
});

test("widget settings register versioned editable defaults and safely validate external updates", () => {
  const original = globalThis.game;
  let registered;
  const changes = [];
  globalThis.game = { settings: { register: (moduleId, key, config) => { registered = { moduleId, key, config }; } } };
  try {
    registerWidgetSettings((state, error) => changes.push({ state, error }));
    assert.equal(registered.moduleId, MODULE_ID);
    assert.equal(registered.key, WIDGET_SETTINGS_KEY);
    assert.equal(registered.config.scope, "world");
    assert.equal(registered.config.config, false);
    assert.equal(registered.config.restricted, true);
    assert.deepEqual(registered.config.default, createWidgetPresetState());
    registered.config.onChange(createWidgetPresetState());
    registered.config.onChange({ schemaVersion: 99 });
    assert.equal(changes[0].state.presets.length, 2);
    assert.equal(changes[0].error, null);
    assert.equal(changes[1].state, null);
    assert.match(changes[1].error.message, /version/);
  } finally { globalThis.game = original; }
});
