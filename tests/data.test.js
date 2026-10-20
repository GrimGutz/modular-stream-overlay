import test from "node:test";
import assert from "node:assert/strict";
import { AdapterRegistry } from "../scripts/core/registry.js";
import { genericAdapter, safePortrait } from "../scripts/adapters/generic.js";
import { cainAdapter } from "../scripts/adapters/cain.js";
import { CharacterDataService, actorReference } from "../scripts/data/character-data.js";
import { requestedFields, renderTemplate, templateFields } from "../scripts/data/bindings.js";
import { validateMappings, readMappedField } from "../scripts/data/mappings.js";

const viewer = { id: "viewer", isGM: false };
const gm = { id: "gm", isGM: true };
function actor(id = "one", data = {}) {
  return { documentName: "Actor", uuid: `Actor.${id}`, id, name: `Hero ${id}`, type: "character", img: "assets/portrait.webp",
    prototypeToken: { texture: { src: "assets/token.webp" } },
    system: { health: { value: 7, max: 10 }, attributes: { level: { value: 3 } }, power: { value: 4, max: 6 },
      stress: { value: 2, max: 5 }, psyche: 2, biography: "PRIVATE NOTES" },
    testUserPermission: (user, permission) => permission === "OBSERVER" && [viewer.id, gm.id].includes(user?.id), ...data };
}
function setup({ actors = [actor()], system = "cain", mappings = [], ...options } = {}) {
  const adapters = new AdapterRegistry();
  adapters.register(genericAdapter);
  adapters.register(cainAdapter);
  return new CharacterDataService({ adapters, getUser: () => viewer, getSystemId: () => system, getMappings: () => mappings,
    resolveUuid: async uuid => actors.find(document => document.uuid === uuid), getActors: () => ({ contents: actors }), ...options });
}

test("field metadata is validated, isolated, and selected by the active system", () => {
  const adapters = new AdapterRegistry();
  const fields = [{ id: "character.hp.current", label: "HP", type: "number", maxField: "character.hp.max", format: "integer" }];
  const definition = adapters.register({ id: "custom", label: "Custom", fields, normalize: () => ({}) });
  fields[0].label = "Changed";
  assert.equal(definition.fields[0].label, "HP");
  assert.ok(Object.isFrozen(definition.fields[0]));
  for (const field of [{ id: "notes", label: "Notes", type: "string" }, { id: "character.x", label: "X", type: "object" }]) {
    assert.throws(() => adapters.register({ id: "bad", label: "Bad", fields: [field], normalize: () => ({}) }), TypeError);
  }
  assert.equal(setup({ system: "unknown" }).fieldDefinitions().some(field => field.id === "character.hp.current"), false);
  assert.equal(setup().fieldDefinitions().some(field => field.id === "character.hp.current"), true);
});

test("only supported explicitly selected scalar fields are returned, including safe token artwork", async () => {
  const service = setup();
  assert.deepEqual(await service.resolve("Actor.one", ["character.name"]), { values: { "character.name": "Hero one" }, warning: null });
  const resolved = await service.resolve("Actor.one", ["character.hp.current", "character.hp.max", "character.hp.percent", "character.level"]);
  assert.deepEqual(resolved.values, { "character.hp.current": 7, "character.hp.max": 10, "character.hp.percent": 70, "character.level": 3 });
  assert.equal(resolved.warning, null);
  assert.equal(JSON.stringify(resolved).includes("PRIVATE"), false);
  assert.equal((await service.resolve("Actor.one", ["character.portrait"], { portraitSource: "token" })).values["character.portrait"], "assets/token.webp");
  service.resolveUuid = async () => actor("one", { prototypeToken: { texture: { src: "" } } });
  assert.equal((await service.resolve("Actor.one", ["character.portrait"], { portraitSource: "token" })).values["character.portrait"], "assets/portrait.webp");
  const unsupported = await service.resolve("Actor.one", ["character.biography", "character.ac"]);
  assert.deepEqual(unsupported.values, {});
  assert.match(unsupported.warning, /unavailable/);
  assert.deepEqual((await service.resolve("Actor.one", [])).values, {});
});

test("CAIN resources derive safe percentages without fabricating missing fields", async () => {
  const source = actor();
  const service = setup({ actors: [source] });
  source.system.health.max = 0;
  assert.equal((await service.resolve(source.uuid, ["character.hp.percent"])).values["character.hp.percent"], null);
  source.system.health.max = 10;
  source.system.health.value = 20;
  assert.equal((await service.resolve(source.uuid, ["character.hp.percent"])).values["character.hp.percent"], 100);
  source.system.health.value = -3;
  assert.equal((await service.resolve(source.uuid, ["character.hp.percent"])).values["character.hp.percent"], 0);
  delete source.system.attributes;
  assert.equal((await service.resolve(source.uuid, ["character.level"])).values["character.level"], null);
});

test("Actor references accept only world UUIDs and supported document links", async () => {
  assert.equal(actorReference(" @UUID[Actor.one]{Character One} "), "Actor.one");
  const service = setup();
  assert.equal((await service.resolveActor("@UUID[Actor.one]{Hero}")).uuid, "Actor.one");
  for (const reference of ["https://example.com/Actor.one", "Compendium.world.actors.Actor.one", "Scene.one.Token.two.Actor.one", "@Actor[one]{Hero}", "Actor.one.Item.two", "@UUID[Actor.one]{<x>}{extra}"]) {
    await assert.rejects(() => service.resolveActor(reference), /world Actor|UUID/);
  }
  await assert.rejects(() => setup({ actors: [actor("one", { isToken: true })] }).resolveActor("Actor.one"), /missing/);
  await assert.rejects(() => setup({ actors: [actor("one", { documentName: "Item" })] }).resolveActor("Actor.one"), /missing/);
});

test("GM previews and Actor lists enforce the configured viewer rather than GM permission", async () => {
  const hidden = actor("hidden", { testUserPermission: user => Boolean(user?.isGM) });
  const service = setup({ actors: [actor(), hidden] });
  assert.deepEqual(service.listActors().map(document => document.uuid), ["Actor.one"]);
  await assert.rejects(() => service.resolveActor(hidden.uuid), /Observer/);
  assert.equal((await service.resolve(hidden.uuid, ["character.name"])).values["character.name"], null);
  assert.equal((await service.resolveActor(hidden.uuid, { user: gm })).uuid, hidden.uuid);
  const noViewer = setup({ getUser: () => null });
  assert.deepEqual(noViewer.listActors(), []);
  assert.match((await noViewer.resolve("Actor.one", ["character.name"])).warning, /viewer account/);
  assert.match((await service.resolve("Actor.missing", ["character.name"])).warning, /missing/);
});

test("permission revocation and viewer changes during asynchronous normalization clear all selected values", async () => {
  let allowed = true;
  const source = actor("one", { testUserPermission: () => allowed });
  const service = setup({ actors: [source] });
  let release;
  service.resolveUuid = async () => { await new Promise(resolve => { release = resolve; }); return source; };
  const pending = service.resolve(source.uuid, ["character.name", "character.hp.current"]);
  allowed = false;
  release();
  assert.deepEqual((await pending).values, { "character.name": null, "character.hp.current": null });
  allowed = true;
  service.resolveUuid = async () => source;
  let reads = 0;
  service.getUser = () => ++reads < 2 ? viewer : null;
  assert.equal((await service.resolve(source.uuid, ["character.name"])).values["character.name"], null);
});

test("field mappings allow bounded system scalars and reject private paths and expressions", async () => {
  const mapping = { id: "character.ac", label: "Armor", type: "number", path: "system.armor.value" };
  assert.deepEqual(validateMappings([mapping]), [mapping]);
  for (const path of ["name", "system.biography", "system.notes.gm", "system.gm.secret", "system.privateValue", "system.__proto__.x", "system.constructor.x", "system.armor.value()", "system.armor[0]", "system.flags.x", "system.ownership.value"]) {
    assert.throws(() => validateMappings([{ ...mapping, path }]), /public system/);
  }
  assert.throws(() => validateMappings([{ ...mapping, id: "character.name" }]), /standard/);
  assert.throws(() => validateMappings([mapping, mapping]), /unique/);
  assert.throws(() => validateMappings([{ ...mapping, type: "object" }]), /numeric or text/);
  assert.equal(readMappedField({ system: Object.create({ armor: { value: 99 } }) }, mapping), null);
  const source = actor();
  source.system.armor = { value: 14 };
  const service = setup({ actors: [source], system: "unknown", mappings: [mapping] });
  assert.deepEqual((await service.resolve(source.uuid, ["character.ac"])).values, { "character.ac": 14 });
  source.system.armor.value = { secret: "hidden" };
  assert.equal((await service.resolve(source.uuid, ["character.ac"])).values["character.ac"], null);
  const mappedHealth = setup({ actors: [source], system: "unknown", mappings: [
    { id: "character.hp.current", label: "Health", type: "number", path: "system.health.value" },
    { id: "character.hp.max", label: "Maximum health", type: "number", path: "system.health.max" }
  ] });
  assert.equal(mappedHealth.fieldDefinitions().some(field => field.id === "character.hp.percent"), true);
  assert.deepEqual((await mappedHealth.resolve(source.uuid, ["character.hp.percent"])).values, { "character.hp.percent": 70 });
  source.system.armor.value = 1;
  const cainWithCustomHealth = setup({ actors: [source], mappings: [
    { id: "character.hp.current", label: "Alternate health", type: "number", path: "system.armor.value" }
  ] });
  assert.deepEqual((await cainWithCustomHealth.resolve(source.uuid, ["character.hp.percent"])).values, { "character.hp.percent": 10 });
  source.system.health.max = 0;
  assert.equal((await mappedHealth.resolve(source.uuid, ["character.hp.percent"])).values["character.hp.percent"], null);
});

test("safe templates interpolate selected scalars literally without evaluation or HTML interpretation", () => {
  const fields = requestedFields({ type: "resource-bar", binding: "character.hp.current", maxBinding: "character.hp.max" });
  assert.deepEqual(fields, ["character.hp.current", "character.hp.max"]);
  assert.deepEqual(templateFields("{character.name} / {character.name} {actor.system.notes}"), ["character.name"]);
  assert.deepEqual(requestedFields({ type: "text", text: "{character.name}" }), []);
  assert.deepEqual(requestedFields({ type: "dynamic-text", binding: "character.name", text: "HP: {character.hp.current}/{character.hp.max}" }),
    ["character.name", "character.hp.current", "character.hp.max"]);
  assert.equal(renderTemplate("{character.name} HP: {character.hp.current}/{character.hp.max}", { "character.name": "<img onerror=alert(1)>", "character.hp.current": 0 }), "<img onerror=alert(1)> HP: 0/—");
  assert.equal(renderTemplate("{character.name.toUpperCase()} ${alert(1)}", {}), "{character.name.toUpperCase()} ${alert(1)}");
  assert.equal(renderTemplate("{character.name}", Object.create({ "character.name": "inherited" }), "Missing"), "Missing");
  assert.equal(renderTemplate("{character.name}".repeat(500), { "character.name": "x".repeat(10000) }).length, 10000);
  assert.equal(renderTemplate("{character.name}", null), "—");
});

test("Actor portraits accept managed paths and credential-free HTTP images only", () => {
  assert.equal(safePortrait("assets/actor.webp"), "assets/actor.webp");
  assert.equal(safePortrait("https://example.com/actor.webp"), "https://example.com/actor.webp");
  for (const path of ["javascript:alert(1)", "data:image/svg+xml,evil", "https://user:secret@example.com/x", "../secret", "//example.com/x", "file:///secret", " https://example.com/x"]) assert.equal(safePortrait(path), null);
});

function hooksMock() {
  let nextId = 0;
  const handlers = new Map();
  return {
    handlers,
    on(name, callback) { const id = ++nextId; handlers.set(id, { name, callback }); return id; },
    off(name, id) { assert.equal(handlers.get(id)?.name, name); handlers.delete(id); },
    fire(name, ...args) { for (const handler of handlers.values()) if (handler.name === name) handler.callback(...args); }
  };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test("live document events debounce affected Actor subscriptions and preserve independent characters", async () => {
  const hooks = hooksMock();
  const one = actor(), two = actor("two");
  const service = setup({ hooks, actors: [one, two], debounceMs: 2 }).start();
  const calls = [];
  const unsubscribe = service.subscribe(one.uuid, uuid => calls.push(uuid));
  service.subscribe(two.uuid, uuid => calls.push(uuid));
  hooks.fire("updateActor", one);
  hooks.fire("updateActor", one);
  hooks.fire("updateItem", { parent: one });
  hooks.fire("updateActiveEffect", { parent: { documentName: "Item", parent: one } });
  hooks.fire("updateToken", { actorLink: false, actor: one });
  await settle();
  assert.deepEqual(calls, [one.uuid]);
  hooks.fire("updateActor", actor("synthetic", { isToken: true }));
  await settle();
  assert.equal(calls.length, 1);
  hooks.fire("updateToken", { actorLink: true, actor: two });
  await settle();
  assert.deepEqual(calls, [one.uuid, two.uuid]);
  unsubscribe();
  hooks.fire("updateActor", one);
  await settle();
  assert.equal(calls.length, 2);
  service.stop();
  assert.equal(hooks.handlers.size, 0);
});

test("initial reads reconstruct current state and deletion, permissions, refresh, and cleanup invalidate safely", async () => {
  const hooks = hooksMock();
  const source = actor();
  const service = setup({ hooks, actors: [source], debounceMs: 2 }).start();
  source.system.health.value = 2;
  assert.equal((await service.resolve(source.uuid, ["character.hp.current"])).values["character.hp.current"], 2);
  let calls = 0;
  service.subscribe(source.uuid, () => calls++);
  hooks.fire("deleteActor", source);
  hooks.fire("updateUser", viewer);
  await settle();
  assert.equal(calls, 1);
  hooks.fire("updateUser", { id: "other" });
  await settle();
  assert.equal(calls, 1);
  service.refresh();
  await settle();
  assert.equal(calls, 2);
  service.refresh();
  service.stop();
  await settle();
  assert.equal(calls, 2);
  assert.equal(service.subscriptions.size, 0);
});
