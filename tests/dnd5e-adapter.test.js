import test from "node:test";
import assert from "node:assert/strict";
import { dnd5eAdapter } from "../scripts/adapters/dnd5e.js";
import { genericAdapter } from "../scripts/adapters/generic.js";
import { AdapterRegistry } from "../scripts/core/registry.js";
import { CharacterDataService } from "../scripts/data/character-data.js";
import { createDnd5e533Actor } from "./fixtures/dnd5e-5.3.3.js";
import { createDnd5e606ResearchActor } from "./fixtures/dnd5e-6.0.6.js";

const user = { id: "viewer" };
const normalize = (actor, fields, options = {}) => dnd5eAdapter.normalize(actor, { user, fields, systemVersion: "5.3.3", ...options });
function service(actor, version = "5.3.3") {
  const adapters = new AdapterRegistry();
  adapters.register(genericAdapter);
  adapters.register(dnd5eAdapter);
  return new CharacterDataService({ adapters, getUser: () => user, getSystemId: () => "dnd5e",
    getSystemVersion: () => version, resolveUuid: async () => actor, getActors: () => ({ contents: [actor] }) });
}

test("D&D5e exposes PC-only versioned metadata and explicit resource pairs", () => {
  assert.equal(dnd5eAdapter.interfaceVersion, 1);
  assert.deepEqual(dnd5eAdapter.actorTypes, ["character"]);
  assert.deepEqual(dnd5eAdapter.testedSystemVersions, ["5.3.3"]);
  assert.equal(dnd5eAdapter.fields.length, 28);
  const fields = new Map(dnd5eAdapter.fields.map(field => [field.id, field]));
  for (const field of fields.values()) {
    assert.deepEqual(field.actorTypes, ["character"]);
    assert.deepEqual(field.testedSystemVersions, ["5.3.3"]);
    assert.ok(field.group);
    assert.equal(genericAdapter.fields.some(generic => generic.id === field.id), false);
  }
  assert.equal(dnd5eAdapter.resources.length, 4);
  for (const resource of dnd5eAdapter.resources) {
    assert.equal(fields.get(resource.currentField)?.type, "number");
    assert.equal(fields.get(resource.maxField)?.type, "number");
    assert.equal(fields.get(resource.currentField)?.maxField, resource.maxField);
  }
  assert.equal(dnd5eAdapter.resources[0].polarity, "lower-is-worse");
  assert.ok(dnd5eAdapter.resources.slice(1).every(resource => resource.polarity === "neutral"));
});

test("D&D5e uses effective HP maximum and keeps temporary hit points separate", () => {
  const actor = createDnd5e533Actor();
  assert.deepEqual(normalize(actor, ["character.hp.current", "character.hp.max", "character.hp.baseMax", "character.hp.temp", "character.hp.percent"]), {
    "character.hp.current": 36, "character.hp.max": 48, "character.hp.baseMax": 40, "character.hp.temp": 7, "character.hp.percent": 75
  });
  actor.system.attributes.hp.value = 100;
  assert.equal(normalize(actor, ["character.hp.percent"])["character.hp.percent"], 100);
  actor.system.attributes.hp.value = -4;
  assert.equal(normalize(actor, ["character.hp.percent"])["character.hp.percent"], 0);
  actor.system.attributes.hp.effectiveMax = 0;
  assert.equal(normalize(actor, ["character.hp.percent"])["character.hp.percent"], null);
  delete actor.system.attributes.hp.effectiveMax;
  assert.equal(normalize(actor, ["character.hp.max"])["character.hp.max"], null);
});

test("D&D5e reads prepared AC, abilities, and multiclass level without preparing or mutating the Actor", () => {
  const actor = createDnd5e533Actor();
  const before = structuredClone(actor.system);
  actor.getRollData = actor.prepareData = actor.update = () => { throw new Error("Adapter must only read"); };
  Object.defineProperty(actor, "items", { get() { throw new Error("Use prepared character level"); } });
  Object.defineProperty(actor, "effects", { get() { throw new Error("Use prepared effect values"); } });
  assert.deepEqual(normalize(actor, ["character.ac", "character.level", "character.abilities.str.score", "character.abilities.str.modifier",
    "character.abilities.int.modifier", "character.abilities.wis.modifier"]), {
    "character.ac": 19, "character.level": 5, "character.abilities.str.score": 18, "character.abilities.str.modifier": 4,
    "character.abilities.int.modifier": -1, "character.abilities.wis.modifier": 0
  });
  assert.deepEqual(actor.system, before);
  assert.equal(actor._source.system.abilities.str.value, 14);
  assert.equal(actor.system.attributes.ac.value, 19);
  assert.equal(actor.system.details.level, 5);
});

test("D&D5e returns only requested known fields and bounded custom resource labels", () => {
  const actor = createDnd5e533Actor();
  const result = normalize(actor, ["character.resources.primary.current", "character.resources.primary.max", "character.resources.primary.label",
    "character.resources.secondary.current", "character.name", "character.conditions", "character.system", "__proto__", null, {}]);
  assert.deepEqual(result, {
    "character.resources.primary.current": 2, "character.resources.primary.max": 4,
    "character.resources.primary.label": "Focus", "character.resources.secondary.current": 0
  });
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  actor.system.resources.tertiary.label = "x".repeat(200);
  assert.equal(normalize(actor, ["character.resources.tertiary.label"])["character.resources.tertiary.label"].length, 80);
  actor.system.resources.tertiary.label = { secret: "not a label" };
  assert.equal(normalize(actor, ["character.resources.tertiary.label"])["character.resources.tertiary.label"], null);
  assert.deepEqual(normalize(actor, []), {});
});

test("D&D5e does not coerce strings, NaN, infinities, or absent prepared data into numbers", () => {
  for (const invalid of [NaN, Infinity, -Infinity, "12", null, undefined, {}, true]) {
    const actor = createDnd5e533Actor();
    actor.system.attributes.ac.value = invalid;
    actor.system.abilities.dex.mod = invalid;
    actor.system.resources.primary.value = invalid;
    const result = normalize(actor, ["character.ac", "character.abilities.dex.modifier", "character.resources.primary.current"]);
    assert.deepEqual(Object.values(result), [null, null, null]);
  }
  const actor = createDnd5e533Actor();
  delete actor.system;
  assert.deepEqual(normalize(actor, ["character.hp.current", "character.hp.percent", "character.level"]), {
    "character.hp.current": null, "character.hp.percent": null, "character.level": null
  });
});

test("D&D5e rejects unauthorized reads before touching system data and rejects other Actor types", () => {
  const actor = createDnd5e533Actor();
  let reads = 0;
  Object.defineProperty(actor, "system", { get() { reads++; throw new Error("No protected data reads"); } });
  assert.equal(normalize(actor, ["character.hp.current"], { user: null }), null);
  assert.equal(normalize(actor, ["character.hp.current"], { user: { id: "gm", isGM: true } }), null);
  assert.equal(normalize(actor, "character.hp.current"), null);
  assert.equal(reads, 0);
  for (const type of ["npc", "vehicle", "group", "encounter", "custom"]) {
    const unsupported = createDnd5e533Actor();
    unsupported.type = type;
    assert.equal(normalize(unsupported, ["character.hp.current"]), null);
  }
});

test("D&D5e patch releases of the tested 5.3 line keep reading prepared values", () => {
  const actor = createDnd5e533Actor();
  for (const systemVersion of ["5.3.2", "5.3.4"]) assert.notEqual(normalize(actor, ["character.hp.current"], { systemVersion }), null);
});

test("6.0.6 research data and other unverified versions remain unavailable", async () => {
  const actor = createDnd5e606ResearchActor();
  for (const systemVersion of ["6.0.6", "5.4.0", "5.3.3-custom", "", null]) {
    assert.equal(normalize(actor, ["character.hp.current", "character.ac"], { systemVersion }), null);
  }
  const result = await service(actor, "6.0.6").resolve(actor.uuid, ["character.name", "character.hp.current", "character.ac"]);
  assert.equal(result.values["character.name"], actor.name);
  assert.ok(result.values["character.hp.current"] == null);
  assert.ok(result.values["character.ac"] == null);
  assert.match(result.warning, /unavailable|version|support/i);
});

test("D&D5e selected fields combine with generic identity through the production data service", async () => {
  const actor = createDnd5e533Actor();
  const result = await service(actor).resolve(actor.uuid, ["character.name", "character.hp.percent", "character.level", "character.abilities.cha.score"]);
  assert.deepEqual(result, { values: {
    "character.name": "Synthetic adventurer", "character.hp.percent": 75, "character.level": 5, "character.abilities.cha.score": 16
  }, warning: null, status: "available", fieldStatus: {
    "character.name": "available", "character.hp.percent": "available", "character.level": "available", "character.abilities.cha.score": "available"
  } });
});

test("direct D&D5e calls require an explicit or matching installed tested version", t => {
  const previous = globalThis.game;
  t.after(() => { if (previous === undefined) delete globalThis.game; else globalThis.game = previous; });
  const actor = createDnd5e533Actor(), fields = ["character.ac"];
  delete globalThis.game;
  assert.equal(dnd5eAdapter.normalize(actor, { user, fields }), null);
  globalThis.game = { system: { id: "dnd5e", version: "5.3.3" } };
  assert.deepEqual(dnd5eAdapter.normalize(actor, { user, fields }), { "character.ac": 19 });
  globalThis.game.system.version = "6.0.6";
  assert.equal(dnd5eAdapter.normalize(actor, { user, fields }), null);
  assert.equal(dnd5eAdapter.normalize(actor, { user, fields, systemVersion: null }), null);
});
