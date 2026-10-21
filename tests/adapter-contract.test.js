import test from "node:test";
import assert from "node:assert/strict";
import { AdapterRegistry } from "../scripts/core/registry.js";
import { genericAdapter } from "../scripts/adapters/generic.js";
import { CharacterDataService, validateAdapterPreferences } from "../scripts/data/character-data.js";
import { validateMappings } from "../scripts/data/mappings.js";

const user = { id: "viewer" };
const makeActor = (id = "one") => ({ uuid: `Actor.${id}`, documentName: "Actor", type: "character", name: `Actor ${id}`,
  system: { focus: { value: 3, max: 6 }, alternate: 5 }, allowed: true,
  testUserPermission(viewer, permission) { return this.allowed && viewer?.id === user.id && permission === "OBSERVER"; } });
const field = (id, metadata = {}) => ({ id, label: id, type: "number", ...metadata });
function adapter(id, value = 3, metadata = {}) {
  return { id, label: id, systemId: "test", fields: [field("character.focus")],
    normalize: (_actor, { fields }) => Object.fromEntries(fields.map(id => [id, value])), ...metadata };
}
function setup(definitions = [adapter("first")], options = {}) {
  const actors = options.actors ?? [makeActor()];
  const registry = new AdapterRegistry(); registry.register(genericAdapter);
  for (const definition of definitions) registry.register(definition);
  const service = new CharacterDataService({ adapters: registry, getUser: () => user, getSystemId: () => "test", getSystemVersion: () => "1.0",
    getActors: () => ({ contents: actors }), resolveUuid: async uuid => actors.find(actor => actor.uuid === uuid), hooks: null, ...options });
  return { service, registry, actors };
}

test("legacy v1 registration still resolves scalars and unresolved maximum targets validate against the complete catalog", async () => {
  const legacy = adapter("legacy", 3, { fields: [field("character.focus", { maxField: "character.focusMax" })] });
  const { service } = setup([legacy], { getMappings: () => [{ id: "character.focusMax", label: "Maximum", type: "number", path: "system.focus.max" }] });
  assert.deepEqual((await service.resolve("Actor.one", ["character.focus", "character.focusMax"])).values, { "character.focus": 3, "character.focusMax": 6 });
  assert.equal(setup([legacy]).service.fieldDefinitions().find(field => field.id === "character.focus").status, "unavailable");
  const unknown = await service.resolve("Actor.one", ["character.unknown"]);
  assert.deepEqual(unknown.values, {}); assert.equal(unknown.fieldStatus["character.unknown"], "unsupported-field");
});

test("provider auto preserves registration order, explicit preferences select one provider, and failures retain only generic identity", async () => {
  let preferences = {};
  const { service } = setup([adapter("first", 3), adapter("second", 9)], { getAdapterPreferences: () => preferences });
  let result = await service.resolve("Actor.one", ["character.name", "character.focus"]);
  assert.equal(result.values["character.focus"], 3); assert.match(result.warning, /Several adapters/);
  assert.deepEqual(service.getAdapterState().candidateIds, ["first", "second"]);
  preferences = { test: "second" };
  result = await service.resolve("Actor.one", ["character.focus"]);
  assert.equal(result.values["character.focus"], 9); assert.equal(result.warning, null);
  for (const selected of ["missing", "generic"]) {
    preferences = { test: selected };
    result = await service.resolve("Actor.one", ["character.name", "character.focus"]);
    assert.deepEqual(result.values, { "character.name": "Actor one" });
    assert.equal(result.fieldStatus["character.focus"], "unsupported-field");
    assert.match(result.warning, /missing or incompatible/);
  }
  preferences = JSON.parse('{"__proto__":"first"}');
  assert.equal(service.getAdapterState().adapterId, "generic");
  assert.match(service.getAdapterState().warning, /invalid/);
});

test("scope guards block only new fields before their data is read and leave legacy values available", async () => {
  let version = "2.0", nativeReads = 0;
  const source = makeActor();
  const definition = adapter("scoped", 0, { actorTypes: ["character", "npc"], testedSystemVersions: ["1.0"],
    fields: [field("character.focus"), field("character.native", { actorTypes: ["character"], testedSystemVersions: ["1.0"] })],
    normalize(_actor, { fields, systemVersion }) {
      assert.equal(systemVersion, version);
      if (fields.includes("character.native")) nativeReads++;
      return Object.fromEntries(fields.map(id => [id, id === "character.native" ? 8 : 3]));
    } });
  const { service } = setup([definition], { actors: [source], getSystemVersion: () => version });
  let result = await service.resolve(source.uuid, ["character.focus", "character.native"]);
  assert.deepEqual(result.values, { "character.focus": 3, "character.native": null });
  assert.equal(result.fieldStatus["character.native"], "unverified-version"); assert.equal(nativeReads, 0);
  version = "1.0"; source.type = "npc";
  result = await service.resolve(source.uuid, ["character.focus", "character.native"]);
  assert.equal(result.fieldStatus["character.native"], "unsupported-actor-type"); assert.equal(nativeReads, 0);
  source.type = "character";
  result = await service.resolve(source.uuid, ["character.native"]);
  assert.equal(result.values["character.native"], 8); assert.equal(nativeReads, 1);
});

test("system adapters cannot replace generic identity or leak unselected result fields and exception details", async () => {
  const definition = adapter("shadow", 3, { fields: [field("character.name", { type: "string" }), field("character.focus")],
    normalize: () => ({ "character.name": "PRIVATE", "character.focus": 3, biography: "PRIVATE" }) });
  const { service } = setup([definition]);
  const result = await service.resolve("Actor.one", ["character.name", "character.focus"]);
  assert.equal(result.values["character.name"], "Actor one"); assert(!JSON.stringify(result).includes("PRIVATE"));
  const broken = setup([adapter("broken", 0, { normalize() { throw new Error("PRIVATE ACTOR SNAPSHOT"); } })]).service;
  const failure = await broken.resolve("Actor.one", ["character.name", "character.focus"]);
  assert.equal(failure.values["character.name"], "Actor one"); assert.equal(failure.values["character.focus"], null);
  assert.equal(failure.fieldStatus["character.focus"], "unavailable"); assert(!JSON.stringify(failure).includes("PRIVATE"));
  broken.resolveUuid = async () => { throw new Error("PRIVATE RESOLVER RESPONSE"); };
  assert(!JSON.stringify(await broken.resolve("Actor.one", ["character.name"])).includes("PRIVATE"));
});

test("mapping scopes preserve global records, use supported overrides, and retain inactive custom fields without reading them", async () => {
  const source = makeActor();
  let version = "1.0";
  const mappings = [
    { id: "character.focus", label: "Override", type: "number", path: "system.alternate", systemId: "test", actorTypes: ["character"], testedSystemVersions: ["1.0"] },
    { id: "character.max", label: "Legacy max", type: "number", path: "system.focus.max" },
    { id: "character.other", label: "Other", type: "number", path: "system.alternate", systemId: "other" },
    { id: "character.onlyPc", label: "PC", type: "number", path: "system.alternate", actorTypes: ["character"] }
  ];
  const { service } = setup(undefined, { actors: [source], getMappings: () => mappings, getSystemVersion: () => version });
  assert.equal((await service.resolve(source.uuid, ["character.focus"])).values["character.focus"], 5);
  assert.equal(service.fieldDefinitions().find(field => field.id === "character.max").legacyGlobal, true);
  assert.equal(service.fieldDefinitions().some(field => field.id === "character.other"), false);
  version = "2.0";
  assert.equal((await service.resolve(source.uuid, ["character.focus"])).values["character.focus"], 3);
  source.type = "npc";
  const result = await service.resolve(source.uuid, ["character.onlyPc"]);
  assert.equal(result.values["character.onlyPc"], null); assert.equal(result.fieldStatus["character.onlyPc"], "unsupported-actor-type");
});

test("unsaved mapping preview is isolated and enforces final viewer permission", async () => {
  const source = makeActor(), saved = [{ id: "character.saved", label: "Saved", type: "number", path: "system.focus.value" }];
  const { service } = setup(undefined, { actors: [source], getMappings: () => saved });
  const draft = [{ id: "character.draft", label: "Draft", type: "number", path: "system.alternate", systemId: "test" }];
  assert.deepEqual((await service.previewMappings(source.uuid, draft)).values, { "character.draft": 5 });
  assert.deepEqual(service._mappings(), saved); assert.equal(service.subscriptions.size, 0);
  assert.deepEqual((await service.resolve(source.uuid, ["character.saved", "character.draft"])).values, { "character.saved": 3 });
  service.resolveUuid = async () => { source.allowed = false; return source; };
  assert.equal((await service.previewMappings(source.uuid, draft)).values["character.draft"], null);
  await assert.rejects(service.previewMappings(source.uuid, [{ ...draft[0], path: "system.biography" }]), /public system/);
});

test("resource and scope metadata are bounded and isolated; malformed maxima and preferences are rejected", () => {
  const fields = [field("character.focus", { maxField: "character.max", actorTypes: ["character"], testedSystemVersions: ["1.0"], group: "Resources", unit: "points", role: "current" }), field("character.max")];
  const resources = [{ id: "focus", label: "Focus", currentField: "character.focus", maxField: "character.max", polarity: "neutral" }];
  const { registry, service } = setup([adapter("metadata", 0, { interfaceVersion: 1, fields, resources })]);
  fields[0].actorTypes[0] = "other"; resources[0].label = "Modified";
  assert.equal(registry.get("metadata").fields[0].actorTypes[0], "character");
  assert.equal(service.resourceDefinitions()[0].label, "Focus");
  assert(Object.isFrozen(registry.get("metadata").resources[0]));
  for (const bad of [{ interfaceVersion: 2 }, { actorTypes: [] }, { testedSystemVersions: ["*"] }, { affectsChange: true },
    { fields: [field("character.focus", { maxField: "character.max" }), field("character.max", { type: "string" })] },
    { resources: [{ ...resources[0], maxField: "character.missing" }] }]) assert.throws(() => setup([adapter("bad", 0, bad)]), TypeError);
  for (const input of [null, [], { test: "" }, JSON.parse('{"constructor":"x"}'), Object.create({ test: "x" })]) assert.throws(() => validateAdapterPreferences(input), TypeError);
  for (const mapping of [{ actorTypes: [] }, { testedSystemVersions: ["*"] }, { maxField: "character.name" }]) {
    assert.throws(() => validateMappings([{ id: "character.x", label: "X", type: "number", path: "system.alternate", ...mapping }], { fields: genericAdapter.fields }), TypeError);
  }
});

test("an asynchronous adapter cannot return values after permission or viewer identity changes", async () => {
  const source = makeActor(); let release;
  const { service } = setup([adapter("slow", 0, { async normalize() { await new Promise(resolve => { release = resolve; }); return { "character.focus": 9 }; } })], { actors: [source] });
  const pending = service.resolve(source.uuid, ["character.name", "character.focus"]);
  await new Promise(resolve => setImmediate(resolve)); source.allowed = false; release();
  const result = await pending;
  assert.deepEqual(result.values, { "character.name": null, "character.focus": null });
  assert.equal(result.fieldStatus["character.focus"], "unavailable");
});

function hooksMock() {
  let next = 0; const listeners = new Map();
  return { listeners, on(name, callback) { listeners.set(++next, { name, callback }); return next; }, off(_name, id) { listeners.delete(id); },
    fire(name, ...args) { for (const listener of listeners.values()) if (listener.name === name) listener.callback(...args); } };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 8));
test("public document hooks keep identity fresh, filter world references, recover from failed change callbacks and clean up", async () => {
  const hooks = hooksMock(), one = makeActor(), two = makeActor("two"); let behavior = "normal";
  const { service } = setup([adapter("references", 3, { affectsChange(event, { actor, document }) {
    if (behavior === "throw") throw new Error("PRIVATE CHANGE DETAILS");
    if (behavior === "async") return Promise.reject(new Error("PRIVATE ASYNC DETAILS"));
    return event === "updateItem" && document.id === "catalog" && actor.uuid === one.uuid;
  } })], { actors: [one, two], hooks, debounceMs: 0 });
  const calls = []; service.subscribe(one.uuid, uuid => calls.push(uuid)); service.subscribe(two.uuid, uuid => calls.push(uuid)); service.start();
  hooks.fire("updateItem", { documentName: "Item", id: "catalog" }); await tick();
  assert.deepEqual(calls, [one.uuid]); calls.length = 0;
  hooks.fire("updateActor", two, { name: "Changed" }); await tick();
  assert.deepEqual(calls, [two.uuid], "A false system filter cannot suppress generic identity updates");
  behavior = "throw"; hooks.fire("updateActor", one); await tick();
  let result = await service.resolve(one.uuid, ["character.name", "character.focus"]);
  assert.equal(result.values["character.name"], one.name); assert.equal(result.values["character.focus"], null);
  assert(!JSON.stringify(result).includes("PRIVATE"));
  behavior = "normal"; hooks.fire("updateActor", one); await tick();
  assert.equal((await service.resolve(one.uuid, ["character.focus"])).values["character.focus"], 3);
  behavior = "async"; hooks.fire("updateActor", one); await tick();
  assert.equal((await service.resolve(one.uuid, ["character.focus"])).values["character.focus"], null);
  service.stop(); assert.equal(hooks.listeners.size, 0); assert.equal(service.subscriptions.size, 0); assert.equal(service.pending.size, 0);
});

test("an explicit unavailable provider suppresses advanced values while ordinary unknown systems can still use mappings", async () => {
  const mapping = { id: "character.extra", label: "Extra", type: "number", path: "system.alternate" };
  const { service } = setup(undefined, { getMappings: () => [mapping], getAdapterPreferences: () => ({ test: "missing" }) });
  assert.deepEqual((await service.resolve("Actor.one", ["character.name", mapping.id])).values, { "character.name": "Actor one" });
  service.getAdapterPreferences = () => ({}); service.getSystemId = () => "unknown";
  assert.equal((await service.resolve("Actor.one", [mapping.id])).values[mapping.id], 5);
});

test("mapped health dependencies preserve derived and explicit percentage precedence", async () => {
  const source = makeActor();
  const mappings = [
    { id: "character.hp.current", label: "HP", type: "number", path: "system.focus.value" },
    { id: "character.hp.max", label: "Max", type: "number", path: "system.focus.max" }
  ];
  const { service } = setup([], { actors: [source], getMappings: () => mappings });
  assert.deepEqual((await service.resolve(source.uuid, ["character.hp.percent"])).values, { "character.hp.percent": 50 });
  mappings.push({ id: "character.hp.percent", label: "Custom percent", type: "number", path: "system.alternate" });
  assert.equal((await service.resolve(source.uuid, ["character.hp.percent"])).values["character.hp.percent"], 5);
  source.system.focus.max = 0;
  assert.equal((await service.resolve(source.uuid, ["character.hp.percent"])).values["character.hp.percent"], 5);
  mappings.pop(); assert.equal((await service.resolve(source.uuid, ["character.hp.percent"])).values["character.hp.percent"], null);
});

test("scope/provider maximum errors and malformed saved mappings cannot blank generic identity or unrelated fields", async () => {
  const mappings = [
    { id: "character.extra", label: "Extra", type: "number", path: "system.alternate", systemId: "test", maxField: "character.otherMax" },
    { id: "character.otherMax", label: "Other maximum", type: "number", path: "system.focus.max", systemId: "other" }
  ];
  assert.doesNotThrow(() => validateMappings(mappings));
  const { service } = setup(undefined, { getMappings: () => mappings });
  const result = await service.resolve("Actor.one", ["character.name", "character.focus", "character.extra"]);
  assert.deepEqual(result.values, { "character.name": "Actor one", "character.focus": 3, "character.extra": null });
  const invalid = service.fieldDefinitions().find(field => field.id === "character.extra");
  assert.equal(invalid.invalidMaximum, true); assert.equal(invalid.maxField, undefined);
  service.getMappings = () => [{ ...mappings[0], path: "system.biography" }];
  const malformed = await service.resolve("Actor.one", ["character.name", "character.focus"]);
  assert.deepEqual(malformed.values, { "character.name": "Actor one", "character.focus": 3 });
  assert.match(malformed.warning, /mappings are invalid/);
  await assert.rejects(service.previewMappings("Demo.warrior", []), /world Actor/);
});
