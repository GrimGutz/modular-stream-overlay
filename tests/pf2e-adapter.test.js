import test from "node:test";
import assert from "node:assert/strict";
import { pf2eAdapter } from "../scripts/adapters/pf2e.js";
import { genericAdapter } from "../scripts/adapters/generic.js";
import { AdapterRegistry } from "../scripts/core/registry.js";
import { CharacterDataService } from "../scripts/data/character-data.js";
import { createPf2eCharacter, createPf2eNpc } from "./fixtures/pf2e-8.6.1.js";

const user = { id: "viewer" };
const normalize = (actor, fields, options = {}) => pf2eAdapter.normalize(actor, { user, fields, systemVersion: "8.6.1", ...options });
function service(actor, version = "8.6.1") {
  const adapters = new AdapterRegistry();
  adapters.register(genericAdapter);
  adapters.register(pf2eAdapter);
  return new CharacterDataService({ adapters, getUser: () => user, getSystemId: () => "pf2e",
    getSystemVersion: () => version, resolveUuid: async () => actor, getActors: () => ({ contents: [actor] }) });
}

test("PF2e registers versioned metadata, resource pairs and a class color key", () => {
  const registered = new AdapterRegistry().register(pf2eAdapter);
  assert.equal(registered.systemId, "pf2e");
  assert.deepEqual(registered.actorTypes, ["character", "npc"]);
  assert.deepEqual(registered.testedSystemVersions, ["8.6.1"]);
  assert.equal(registered.accentKeyField, "character.pf2e.class");
  assert.equal(registered.fields.length, 34);
  const fields = new Map(registered.fields.map(field => [field.id, field]));
  for (const field of fields.values()) {
    assert.ok(field.group, field.id);
    assert.deepEqual(field.testedSystemVersions, ["8.6.1"]);
    assert.equal(genericAdapter.fields.some(generic => generic.id === field.id), false);
    if (field.maxField) assert.equal(fields.get(field.maxField)?.type, "number", field.id);
  }
  for (const id of ["character.pf2e.heroPoints.current", "character.pf2e.xp.max", "character.pf2e.class"]) assert.deepEqual(fields.get(id).actorTypes, ["character"]);
  for (const resource of registered.resources) assert.equal(fields.get(resource.currentField)?.maxField, resource.maxField, resource.id);
  assert.deepEqual(registered.resources.filter(resource => resource.polarity === "higher-is-worse").map(resource => resource.id), ["dying", "wounded", "doomed"]);
});

test("PF2e reads prepared health, defenses, saves and attribute modifiers without changing the Actor", () => {
  const actor = createPf2eCharacter(), before = structuredClone(actor.system);
  actor.prepareData = actor.update = actor.getRollData = () => { throw new Error("Adapter must only read"); };
  assert.deepEqual(normalize(actor, ["character.hp.current", "character.hp.max", "character.hp.temp", "character.hp.percent", "character.ac", "character.level",
    "character.pf2e.perception", "character.pf2e.saves.fortitude", "character.pf2e.saves.reflex", "character.pf2e.saves.will",
    "character.abilities.str.modifier", "character.abilities.int.modifier"]), {
    "character.hp.current": 31, "character.hp.max": 52, "character.hp.temp": 5, "character.hp.percent": 31 / 52 * 100, "character.ac": 21, "character.level": 4,
    "character.pf2e.perception": 9, "character.pf2e.saves.fortitude": 12, "character.pf2e.saves.reflex": 7, "character.pf2e.saves.will": 10,
    "character.abilities.str.modifier": 4, "character.abilities.int.modifier": -1
  });
  assert.deepEqual(actor.system, before);
});

test("PF2e reads death track, resources, shield, experience and identity", () => {
  const actor = createPf2eCharacter();
  assert.deepEqual(normalize(actor, ["character.pf2e.dying.current", "character.pf2e.dying.max", "character.pf2e.wounded.current", "character.pf2e.doomed.current",
    "character.pf2e.heroPoints.current", "character.pf2e.heroPoints.max", "character.pf2e.focus.current", "character.pf2e.focus.max",
    "character.pf2e.shield.current", "character.pf2e.shield.max", "character.pf2e.xp.current", "character.pf2e.xp.max",
    "character.pf2e.class", "character.pf2e.ancestry", "character.pf2e.heritage"]), {
    "character.pf2e.dying.current": 1, "character.pf2e.dying.max": 4, "character.pf2e.wounded.current": 1, "character.pf2e.doomed.current": 0,
    "character.pf2e.heroPoints.current": 2, "character.pf2e.heroPoints.max": 3, "character.pf2e.focus.current": 1, "character.pf2e.focus.max": 2,
    "character.pf2e.shield.current": 14, "character.pf2e.shield.max": 20, "character.pf2e.xp.current": 650, "character.pf2e.xp.max": 1000,
    "character.pf2e.class": "Champion", "character.pf2e.ancestry": "Dwarf", "character.pf2e.heritage": "Forge Dwarf"
  });
  actor.system.details.heritage = null;
  assert.equal(normalize(actor, ["character.pf2e.heritage"])["character.pf2e.heritage"], null);
});

test("PF2e lists condition Items with their values, one per line", () => {
  const actor = createPf2eCharacter();
  assert.equal(normalize(actor, ["character.pf2e.conditions"])["character.pf2e.conditions"], "Frightened 2\nOff-Guard");
  actor.items = { contents: [] };
  assert.equal(normalize(actor, ["character.pf2e.conditions"])["character.pf2e.conditions"], "");
  actor.items = [{ type: "condition", name: "Sickened", system: { value: { isValued: true, value: Infinity } } }];
  assert.equal(normalize(actor, ["character.pf2e.conditions"])["character.pf2e.conditions"], "Sickened");
});

test("PF2e NPCs read creature statistics; character-only fields stay empty", () => {
  const npc = createPf2eNpc();
  assert.deepEqual(normalize(npc, ["character.hp.current", "character.hp.percent", "character.ac", "character.level", "character.pf2e.saves.will",
    "character.pf2e.conditions", "character.pf2e.heroPoints.current", "character.pf2e.class"]), {
    "character.hp.current": 180, "character.hp.percent": 75, "character.ac": 33, "character.level": 12, "character.pf2e.saves.will": 23,
    "character.pf2e.conditions": "Frightened 1", "character.pf2e.heroPoints.current": null, "character.pf2e.class": null
  });
});

test("PF2e never coerces strings, non-finite values or missing data, and returns only known fields", () => {
  for (const invalid of [NaN, Infinity, "21", null, undefined, {}, true]) {
    const actor = createPf2eCharacter();
    actor.system.attributes.ac.value = invalid;
    actor.system.perception.totalModifier = invalid;
    actor.system.details.class = { name: typeof invalid === "string" ? 21 : invalid };
    assert.deepEqual(Object.values(normalize(actor, ["character.ac", "character.pf2e.perception", "character.pf2e.class"])), [null, null, null]);
  }
  const actor = createPf2eCharacter();
  assert.deepEqual(normalize(actor, ["character.name", "character.system", "__proto__", null, {}, "character.ac"]), { "character.ac": 21 });
  assert.equal(JSON.stringify(normalize(actor, pf2eAdapter.fields.map(field => field.id))).includes("PRIVATE"), false);
  actor.system.attributes.hp.max = 0;
  assert.equal(normalize(actor, ["character.hp.percent"])["character.hp.percent"], null);
});

test("PF2e rejects unauthorized viewers, other Actor types and unverified versions before reading", () => {
  const actor = createPf2eCharacter();
  let reads = 0;
  Object.defineProperty(actor, "system", { get() { reads++; throw new Error("No protected data reads"); } });
  assert.equal(normalize(actor, ["character.ac"], { user: null }), null);
  assert.equal(normalize(actor, ["character.ac"], { user: { id: "gm", isGM: true } }), null);
  assert.equal(reads, 0);
  for (const type of ["hazard", "vehicle", "familiar", "party", "loot"]) {
    const other = createPf2eCharacter(); other.type = type;
    assert.equal(normalize(other, ["character.ac"]), null);
  }
  const current = createPf2eCharacter();
  for (const systemVersion of ["8.6.0", "8.6.4"]) assert.deepEqual(normalize(current, ["character.ac"], { systemVersion }), { "character.ac": 21 });
  for (const systemVersion of ["8.7.0", "8.5.1", "7.12.2", "8.6.1-beta", "", null]) assert.equal(normalize(current, ["character.ac"], { systemVersion }), null);
});

test("PF2e fields combine with generic identity through the data service", async () => {
  const actor = createPf2eCharacter();
  const result = await service(actor).resolve(actor.uuid, ["character.name", "character.hp.current", "character.pf2e.class"]);
  assert.deepEqual(result.values, { "character.name": "Synthetic champion", "character.hp.current": 31, "character.pf2e.class": "Champion" });
  assert.equal(result.status, "available");
  const unverified = await service(actor, "8.7.0").resolve(actor.uuid, ["character.name", "character.hp.current"]);
  assert.equal(unverified.values["character.name"], "Synthetic champion");
  assert.ok(unverified.values["character.hp.current"] == null);
  assert.equal(unverified.fieldStatus["character.hp.current"], "unverified-version");
  assert.equal(service(actor).accentFields().suggestedKeyField, "character.pf2e.class");
});
