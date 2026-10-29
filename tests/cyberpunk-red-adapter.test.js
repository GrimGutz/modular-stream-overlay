import test from "node:test";
import assert from "node:assert/strict";
import { cyberpunkRedAdapter } from "../scripts/adapters/cyberpunk-red.js";
import { genericAdapter } from "../scripts/adapters/generic.js";
import { AdapterRegistry } from "../scripts/core/registry.js";
import { CharacterDataService } from "../scripts/data/character-data.js";
import { createCprCharacter, createCprMook } from "./fixtures/cyberpunk-red-0.92.4.js";

const user = { id: "viewer" };
const normalize = (actor, fields, options = {}) => cyberpunkRedAdapter.normalize(actor, { user, fields, systemVersion: "0.92.4", ...options });
function service(actor, version = "0.92.4") {
  const adapters = new AdapterRegistry();
  adapters.register(genericAdapter);
  adapters.register(cyberpunkRedAdapter);
  return new CharacterDataService({ adapters, getUser: () => user, getSystemId: () => "cyberpunk-red-core",
    getSystemVersion: () => version, resolveUuid: async () => actor, getActors: () => ({ contents: [actor] }) });
}

test("Cyberpunk RED registers versioned metadata, resource pairs and a role color key", () => {
  const registered = new AdapterRegistry().register(cyberpunkRedAdapter);
  assert.equal(registered.systemId, "cyberpunk-red-core");
  assert.deepEqual(registered.actorTypes, ["character", "mook"]);
  assert.deepEqual(registered.testedSystemVersions, ["0.92.4"]);
  assert.equal(registered.accentKeyField, "character.cpr.role");
  assert.equal(registered.fields.length, 29);
  const fields = new Map(registered.fields.map(field => [field.id, field]));
  for (const field of fields.values()) {
    assert.ok(field.group, field.id);
    if (field.maxField) assert.equal(fields.get(field.maxField)?.type, "number", field.id);
  }
  assert.deepEqual(fields.get("character.cpr.wealth").actorTypes, ["character"]);
  for (const resource of registered.resources) assert.equal(fields.get(resource.currentField)?.maxField, resource.maxField, resource.id);
});

test("Cyberpunk RED reads health, humanity, death save, stats, armor and identity without changing the Actor", () => {
  const actor = createCprCharacter(), before = structuredClone(actor.system);
  actor.update = actor.prepareData = () => { throw new Error("Adapter must only read"); };
  assert.deepEqual(normalize(actor, ["character.hp.current", "character.hp.max", "character.hp.percent", "character.cpr.humanity.current", "character.cpr.humanity.max",
    "character.cpr.deathSave", "character.cpr.deathSavePenalty", "character.cpr.stats.ref", "character.cpr.stats.luck", "character.cpr.stats.luckMax",
    "character.cpr.stats.emp", "character.cpr.stats.empMax", "character.cpr.armor.body.current", "character.cpr.armor.body.max", "character.cpr.armor.head.current",
    "character.cpr.armor.shield.max", "character.cpr.role", "character.cpr.reputation", "character.cpr.wealth"]), {
    "character.hp.current": 18, "character.hp.max": 40, "character.hp.percent": 45, "character.cpr.humanity.current": 47, "character.cpr.humanity.max": 52,
    "character.cpr.deathSave": 7, "character.cpr.deathSavePenalty": 1, "character.cpr.stats.ref": 8, "character.cpr.stats.luck": 3, "character.cpr.stats.luckMax": 6,
    "character.cpr.stats.emp": 5, "character.cpr.stats.empMax": 6, "character.cpr.armor.body.current": 9, "character.cpr.armor.body.max": 11,
    "character.cpr.armor.head.current": 11, "character.cpr.armor.shield.max": 0, "character.cpr.role": "Solo", "character.cpr.reputation": 3, "character.cpr.wealth": 1250
  });
  assert.deepEqual(actor.system, before);
  assert.equal(JSON.stringify(normalize(actor, cyberpunkRedAdapter.fields.map(field => field.id))).includes("PRIVATE"), false);
});

test("Cyberpunk RED shows the system's translated wound state, or English names without one", t => {
  const previous = globalThis.game;
  t.after(() => { if (previous === undefined) delete globalThis.game; else globalThis.game = previous; });
  const actor = createCprCharacter();
  delete globalThis.game;
  assert.equal(normalize(actor, ["character.cpr.woundState"])["character.cpr.woundState"], "Seriously wounded");
  globalThis.game = { i18n: { localize: key => key === "CPR.global.woundState.seriouslyWounded" ? "Серьёзное ранение" : key } };
  assert.equal(normalize(actor, ["character.cpr.woundState"])["character.cpr.woundState"], "Серьёзное ранение");
  actor.system.derivedStats.currentWoundState = "dead";
  assert.equal(normalize(actor, ["character.cpr.woundState"])["character.cpr.woundState"], "Dead");
  for (const invalid of ["__proto__", "toString", "", 3, null]) {
    actor.system.derivedStats.currentWoundState = invalid;
    assert.equal(normalize(actor, ["character.cpr.woundState"])["character.cpr.woundState"], null);
  }
});

test("Cyberpunk RED mooks share the common stats; character-only wealth stays empty", () => {
  const mook = createCprMook();
  assert.deepEqual(normalize(mook, ["character.hp.current", "character.cpr.stats.body", "character.cpr.role", "character.cpr.wealth"]), {
    "character.hp.current": 18, "character.cpr.stats.body": 7, "character.cpr.role": "", "character.cpr.wealth": null
  });
});

test("Cyberpunk RED never coerces invalid numbers and rejects other viewers, types and versions", () => {
  for (const invalid of [NaN, Infinity, "18", null, undefined, {}, true]) {
    const actor = createCprCharacter();
    actor.system.derivedStats.hp.value = invalid;
    actor.system.stats.ref.value = invalid;
    assert.deepEqual(Object.values(normalize(actor, ["character.hp.current", "character.cpr.stats.ref", "character.hp.percent"])), [null, null, null]);
  }
  const actor = createCprCharacter();
  let reads = 0;
  Object.defineProperty(actor, "system", { get() { reads++; throw new Error("No protected data reads"); } });
  assert.equal(normalize(actor, ["character.hp.current"], { user: null }), null);
  assert.equal(reads, 0);
  for (const type of ["blackIce", "demon", "container"]) {
    const other = createCprCharacter(); other.type = type;
    assert.equal(normalize(other, ["character.hp.current"]), null);
  }
  const current = createCprCharacter();
  assert.deepEqual(normalize(current, ["character.hp.max"], { systemVersion: "0.92.3" }), { "character.hp.max": 40 });
  for (const systemVersion of ["0.93", "0.93.0", "0.89.2", "DUMMY_VALUE", null]) assert.equal(normalize(current, ["character.hp.max"], { systemVersion }), null);
});

test("Cyberpunk RED fields combine with generic identity through the data service", async () => {
  const actor = createCprCharacter();
  const result = await service(actor).resolve(actor.uuid, ["character.name", "character.hp.current", "character.cpr.role"]);
  assert.deepEqual(result.values, { "character.name": "Synthetic solo", "character.hp.current": 18, "character.cpr.role": "Solo" });
  assert.equal(result.status, "available");
  assert.equal(service(actor).accentFields().suggestedKeyField, "character.cpr.role");
});
