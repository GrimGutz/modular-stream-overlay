import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { generateOverlayBundle, validateOverlayBundle, installOverlayBundle } from "../scripts/authoring/bundle.js";
import { MODULE_ID, SCHEMA_VERSION, WIDGET_PRESET_SCHEMA_VERSION, createState, createOverlay,
  validateOverlay, validateWidgetPreset } from "../scripts/core/schema.js";
import { OverlayStore, SETTINGS_KEY } from "../scripts/core/store.js";
import { WidgetPresetStore, WIDGET_SETTINGS_KEY, createWidgetPresetState, createWidgetPreset } from "../scripts/core/widget-presets.js";

const example = async name => JSON.parse(await readFile(new URL(`../examples/authoring/${name}.json`, import.meta.url), "utf8"));
const instance = bundle => bundle.overlays[0].layers.find(layer => layer.type === "character-widget");
const actorChoices = { hero: "Actor.hero", companion: "Actor.companion" };
const expectedOrder = ["Actor.hero", "Actor.fixed", "Actor.companion"];

async function orderedSource() {
  const source = await example("animated");
  const layer = source.overlays[0].layers.find(layer => layer.type === "character-widget");
  layer.actorUuids = ["$actor:hero", "Actor.fixed", "$actor:companion"];
  layer.carousel.actorStartUuid = "$actor:companion";
  return source;
}

function gmContext(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "game");
  Object.defineProperty(globalThis, "game", { configurable: true, writable: true, value: { user: { id: "gm", isGM: true } } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "game", previous);
    else delete globalThis.game;
  });
}

/** Real stores with private in-memory settings; never use a Foundry settings service. */
function memoryStores() {
  const existingOverlay = createOverlay("Existing active output");
  existingOverlay.id = "existing-active-overlay";
  const initialState = { ...createState(), revision: 7, activeOverlayId: existingOverlay.id, overlays: [existingOverlay] };
  const existingPreset = createWidgetPreset("Existing custom widget");
  existingPreset.id = "existing-widget-preset";
  const initialPresets = { ...createWidgetPresetState(), revision: 3, presets: [existingPreset] };
  const settingsMap = new Map([[SETTINGS_KEY, initialState], [WIDGET_SETTINGS_KEY, initialPresets]]);
  const writes = [], resolvedActors = [];
  const settings = {
    get(moduleId, key) {
      assert.equal(moduleId, MODULE_ID);
      assert.ok(settingsMap.has(key));
      return structuredClone(settingsMap.get(key));
    },
    async set(moduleId, key, value) {
      assert.equal(moduleId, MODULE_ID);
      assert.ok(settingsMap.has(key));
      writes.push({ key, value: structuredClone(value) });
      settingsMap.set(key, structuredClone(value));
      return structuredClone(value);
    }
  };
  const getUser = () => globalThis.game.user;
  const api = { schemaVersion: SCHEMA_VERSION,
    store: new OverlayStore({ settings, getUser }), widgetPresets: new WidgetPresetStore({ settings, getUser }),
    characterData: { async resolveActor(uuid) { resolvedActors.push(uuid); return { uuid }; } } };
  return { api, writes, resolvedActors, settingsMap, existingOverlay, existingPreset,
    snapshot: () => structuredClone([...settingsMap]) };
}

test("authoring examples generate real overlay and widget schemas with their intended content", async () => {
  for (const name of ["basic", "character", "animated"]) {
    const source = await example(name), before = structuredClone(source);
    const bundle = generateOverlayBundle(source);
    assert.deepEqual(source, before, "Generation must not mutate authoring source");
    assert.equal(bundle.overlaySchemaVersion, 6);
    assert.equal(bundle.widgetPresetSchemaVersion, 4);
    assert.equal(bundle.overlaySchemaVersion, SCHEMA_VERSION);
    assert.equal(bundle.widgetPresetSchemaVersion, WIDGET_PRESET_SCHEMA_VERSION);
    assert.deepEqual(validateOverlayBundle(JSON.parse(JSON.stringify(bundle))), bundle);
    for (const overlay of bundle.overlays) assert.deepEqual(validateOverlay(overlay), overlay);
    for (const preset of bundle.widgetPresets) assert.deepEqual(validateWidgetPreset(preset), preset);
    if (name === "basic") {
      assert.equal(bundle.widgetPresets.length, 0);
      assert.ok(bundle.overlays[0].layers.some(layer => layer.type === "image"));
      assert.ok(bundle.overlays[0].layers.some(layer => layer.type === "text"));
    } else {
      assert.equal(instance(bundle).presetId, bundle.widgetPresets[0].id);
      assert.equal(instance(bundle).dataSource, "actors");
      assert.deepEqual(instance(bundle).actorUuids, []);
      assert.equal(bundle.actorBindings.length, 1);
      assert.ok(bundle.widgetPresets[0].layers.some(layer => layer.type === "resource-bar") || name === "animated");
    }
    if (name === "animated") {
      const preset = bundle.widgetPresets[0];
      assert.equal(preset.pages.length, 3);
      assert.equal(preset.cycling.mode, "combined");
      assert.equal(preset.cycling.traversal, "pages-first");
      assert.equal(preset.animations.entrance.type, "fade-in");
      assert.equal(preset.animations.exit.type, "fade-out");
      assert.equal(preset.animations.emphasis.type, "pulse");
      assert.ok(preset.pages.some(page => page.layers.some(layer => layer.type === "resource-bar")));
    }
  }
});

test("unresolved, mixed, and resolved Actor slots preserve declared order and carousel start", async () => {
  const source = await orderedSource();
  for (const actors of [{}, { hero: "Actor.hero" }, actorChoices]) {
    const bundle = generateOverlayBundle(source, { actors });
    const ordered = [actors.hero ?? "$actor:hero", "Actor.fixed", actors.companion ?? "$actor:companion"];
    const layer = instance(bundle);
    assert.deepEqual(layer.actorUuids, ordered.filter(value => !value.startsWith("$actor:")));
    assert.equal(layer.actorUuid, layer.actorUuids[0] ?? "");
    if (!actors.companion) {
      assert.deepEqual(bundle.actorBindings, [{ overlayId: bundle.overlays[0].id, layerId: layer.id,
        actors: ordered, startActor: "$actor:companion" }]);
      assert.equal(layer.carousel.actorStartUuid, null);
    } else {
      assert.deepEqual(bundle.actorBindings, []);
      assert.deepEqual(layer.actorUuids, expectedOrder);
      assert.equal(layer.carousel.actorStartUuid, "Actor.companion");
    }
    assert.deepEqual(validateOverlayBundle(bundle), bundle);
  }
});

test("external presets require an explicit reference, and unsupported layer styles are reported", async t => {
  gmContext(t);
  const fixture = memoryStores();
  const source = await example("character");
  source.widgetPresets = [];
  source.presetRefs = { shared: "Existing shared widget preset" };
  source.overlays[0].layers[0].presetId = "$preset:shared";
  assert.throws(() => generateOverlayBundle(source), /--ref shared=/);
  const bundle = generateOverlayBundle(source, { actors: { hero: "Actor.hero" }, refs: { shared: fixture.existingPreset.id } });
  assert.equal(instance(bundle).presetId, fixture.existingPreset.id);
  assert.deepEqual(bundle.widgetPresets, []);
  const result = await installOverlayBundle(bundle, { api: fixture.api, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(fixture.writes.length, 0);

  const invalidSource = await example("basic");
  invalidSource.overlays[0].layers[0].style = { transform: "scale(2)" };
  assert.throws(() => generateOverlayBundle(invalidSource), /Unsupported field: layer .*\.style/);
  const invalidBundle = structuredClone(bundle);
  instance(invalidBundle).style = { opacity: 0.5 };
  assert.throws(() => validateOverlayBundle(invalidBundle), /Unsupported field: Overlays\.layers\.0\.style/);
});

test("dry run writes nothing, then real stores install ordered Actors while preserving active output and saved presets", async t => {
  gmContext(t);
  const fixture = memoryStores(), before = fixture.snapshot();
  const bundle = generateOverlayBundle(await orderedSource(), { actors: { hero: "Actor.hero" } });
  const portable = structuredClone(bundle);
  const choices = { companion: "Actor.companion" };
  const dry = await installOverlayBundle(bundle, { api: fixture.api, actors: choices, dryRun: true });
  assert.equal(dry.activeOverlayId, fixture.existingOverlay.id);
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.actorSlotsResolved, ["companion"]);
  assert.equal(fixture.writes.length, 0);
  assert.deepEqual(fixture.snapshot(), before);
  assert.deepEqual(fixture.resolvedActors, expectedOrder);
  fixture.resolvedActors.length = 0;

  const installed = await installOverlayBundle(bundle, { api: fixture.api, actors: choices });
  assert.equal(installed.dryRun, false);
  assert.deepEqual(installed.overlayIds, [bundle.overlays[0].id]);
  assert.deepEqual(installed.widgetPresetIds, [bundle.widgetPresets[0].id]);
  assert.deepEqual(fixture.resolvedActors, expectedOrder);
  assert.deepEqual(fixture.writes.map(write => write.key), [WIDGET_SETTINGS_KEY, SETTINGS_KEY]);
  const overlays = fixture.api.store.getState(), presets = fixture.api.widgetPresets.getState();
  assert.equal(overlays.activeOverlayId, fixture.existingOverlay.id);
  assert.deepEqual(overlays.overlays.find(overlay => overlay.id === fixture.existingOverlay.id), validateOverlay(fixture.existingOverlay));
  assert.deepEqual(presets.presets.find(preset => preset.id === fixture.existingPreset.id), validateWidgetPreset(fixture.existingPreset));
  assert.equal(overlays.revision, 8);
  assert.equal(presets.revision, 4);
  const savedLayer = overlays.overlays.find(overlay => overlay.id === bundle.overlays[0].id).layers.find(layer => layer.type === "character-widget");
  assert.deepEqual(savedLayer.actorUuids, expectedOrder);
  assert.equal(savedLayer.actorUuid, "Actor.hero");
  assert.equal(savedLayer.carousel.actorStartUuid, "Actor.companion");
  assert.equal(savedLayer.actorBindings, undefined);
  assert.deepEqual(bundle, portable, "Installation metadata and slot replacement must not mutate the portable bundle");
});

test("collisions, missing presets, unresolved slots, and viewer permission failures preflight before any settings write", async t => {
  gmContext(t);
  const fixture = memoryStores(), before = fixture.snapshot();
  const bundle = generateOverlayBundle(await orderedSource(), { actors: actorChoices });
  const overlayCollision = structuredClone(bundle);
  overlayCollision.overlays[0].id = fixture.existingOverlay.id;
  await assert.rejects(installOverlayBundle(overlayCollision, { api: fixture.api }), /Overlay ID already exists/);
  const presetCollision = structuredClone(bundle);
  presetCollision.widgetPresets[0].id = fixture.existingPreset.id;
  await assert.rejects(installOverlayBundle(presetCollision, { api: fixture.api }), /Widget preset ID already exists/);
  const missingPreset = structuredClone(bundle);
  missingPreset.widgetPresets = [];
  await assert.rejects(installOverlayBundle(missingPreset, { api: fixture.api }), /Widget preset is missing/);
  await assert.rejects(installOverlayBundle(generateOverlayBundle(await orderedSource()), { api: fixture.api }), /Choose a world Actor UUID/);

  const checked = [];
  fixture.api.characterData.resolveActor = async uuid => {
    checked.push(uuid);
    if (uuid === "Actor.companion") throw new Error("The overlay viewer needs Observer permission for this Actor.");
    return { uuid };
  };
  await assert.rejects(installOverlayBundle(bundle, { api: fixture.api }), /Observer permission/);
  assert.deepEqual(checked, expectedOrder, "Even a later permission rejection must precede the first write");
  globalThis.game.user = { id: "player", isGM: false };
  await assert.rejects(installOverlayBundle(bundle, { api: fixture.api }), /as a GM/);
  assert.equal(fixture.writes.length, 0);
  assert.deepEqual(fixture.snapshot(), before);
});

test("the real authoring CLI generates a validated bundle and macro without overwriting its source or existing output", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "mso-authoring-cli-"));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith("mso-authoring-cli-"));
    await rm(resolved, { recursive: true, force: true });
  });
  const inputFile = path.join(directory, "source.json"), outputFile = path.join(directory, "generated", "bundle.json");
  const macroFile = path.join(directory, "generated", "install.js");
  const original = await readFile(new URL("../examples/authoring/basic.json", import.meta.url), "utf8");
  await writeFile(inputFile, original);
  const cli = fileURLToPath(new URL("../tools/overlay-author.mjs", import.meta.url));
  const run = args => execFileSync(process.execPath, [cli, ...args], { cwd: directory, encoding: "utf8", stdio: "pipe" });
  const args = ["generate", inputFile, "--out", outputFile, "--macro", macroFile];
  assert.match(run(args), /Generated .*Valid:/s);
  const output = await readFile(outputFile, "utf8"), macro = await readFile(macroFile, "utf8");
  const bundle = JSON.parse(output);
  assert.deepEqual(validateOverlayBundle(bundle), bundle);
  assert.equal(bundle.overlays[0].id, "author-basic-overlay");
  assert.ok(macro.includes(JSON.stringify(bundle, null, 2)), "The macro must contain the generated portable bundle");
  assert.match(macro, /await importOverlayBundle\(\{ bundle:/);
  assert.match(run(["validate", outputFile]), /Valid: 1 overlays, 0 widget presets/);

  assert.throws(() => run(args), error => error.status === 1 && /Output exists:/.test(String(error.stderr)));
  assert.equal(await readFile(outputFile, "utf8"), output);
  assert.equal(await readFile(macroFile, "utf8"), macro);
  assert.throws(() => run(["generate", inputFile, "--out", inputFile, "--force"]),
    error => error.status === 1 && /paths must be different/.test(String(error.stderr)));
  assert.equal(await readFile(inputFile, "utf8"), original);
  if (process.platform === "win32") {
    assert.throws(() => run(["generate", inputFile, "--out", inputFile.toUpperCase(), "--force"]),
      error => error.status === 1 && /paths must be different/.test(String(error.stderr)));
    assert.equal(await readFile(inputFile, "utf8"), original);
  }
});
