import test from "node:test";
import assert from "node:assert/strict";
import { cainAdapter } from "../scripts/adapters/cain.js";
import { CAIN_COLLECTION_FIELDS } from "../scripts/adapters/cain-collections.js";
import { validateCharacterBinding } from "../scripts/core/schema.js";
import { CAIN_EXPECTED_VALUES, CAIN_SKILL_KEYS, CAIN_VIEWER, createCainCharacter } from "./fixtures/cain-1.3.26.js";

const normalize = (actor, fields, options = {}) => cainAdapter.normalize(actor, { user: CAIN_VIEWER, fields, systemVersion: "1.3.26", ...options });

test("CAIN 1.3.26 exposes the complete prepared scalar projection without mutating the Actor", () => {
  const actor = createCainCharacter(), before = structuredClone(actor.system);
  const fields = Object.keys(CAIN_EXPECTED_VALUES);
  assert.equal(cainAdapter.fields.length, 84);
  assert.equal(new Set(cainAdapter.fields.map(field => field.id)).size, 84);
  assert.deepEqual(new Set(cainAdapter.fields.map(field => field.id)), new Set([...fields, ...CAIN_COLLECTION_FIELDS.map(field => field.id)]));
  for (const field of cainAdapter.fields) assert.doesNotThrow(() => validateCharacterBinding(field.id));
  assert.deepEqual(normalize(actor, fields), CAIN_EXPECTED_VALUES);
  assert.deepEqual(actor.system, before);
  assert.equal(cainAdapter.interfaceVersion, 1);
  assert.equal(cainAdapter.actorTypes, undefined, "Adapter-wide type limits must not suppress older legacy reads");
});

test("CAIN reads prepared Psyche and independent CAT, level, Power and Psyche Bursts", () => {
  const actor = createCainCharacter();
  for (const [cat, preparedPsyche] of [[0, 1], [1, 1], [3, 2], [7, 4]]) {
    actor.system.CATLEVEL.value = cat; actor.system.psyche = preparedPsyche;
    assert.deepEqual(normalize(actor, ["character.cain.cat", "character.psyche", "character.level"]), {
      "character.cain.cat": cat, "character.psyche": preparedPsyche, "character.level": 1
    });
  }
  actor.system.psyche = 9;
  assert.equal(normalize(actor, ["character.psyche"])["character.psyche"], 9, "An effect-modified prepared value is read rather than recomputed from CAT");
  assert.deepEqual(normalize(actor, ["character.power.current", "character.cain.psycheBurst.current"]), {
    "character.power.current": 4, "character.cain.psycheBurst.current": 2
  });
});

test("native CAIN guards reject unsupported model/version but keep all legacy values and old missing behavior", () => {
  const actor = createCainCharacter();
  const fields = ["character.hp.current", "character.hp.percent", "character.level", "character.power.current", "character.stress.current", "character.psyche", "character.cain.cat", "character.cain.xid"];
  for (const actorType of ["sin", "npc", "mundane", "opponent", "unknown", undefined]) {
    actor.type = actorType;
    assert.deepEqual(normalize(actor, fields), {
      "character.hp.current": 7, "character.hp.percent": 70, "character.level": 1, "character.power.current": 4,
      "character.stress.current": 2, "character.psyche": 2, "character.cain.cat": null, "character.cain.xid": null
    });
  }
  actor.type = "character";
  for (const systemVersion of ["1.3.25", "1.3.27"]) assert.equal(normalize(actor, fields, { systemVersion })["character.cain.cat"], 3);
  for (const systemVersion of ["1.4.0", "1.3.27-beta", "2.0.0", "", null]) {
    assert.equal(normalize(actor, fields, { systemVersion })["character.cain.cat"], null);
    assert.equal(normalize(actor, fields, { systemVersion })["character.hp.current"], 7);
  }
  delete actor.system.health; delete actor.system.attributes; delete actor.system.stress; delete actor.system.psyche;
  assert.deepEqual(normalize(actor, fields), {
    "character.hp.current": null, "character.hp.percent": null, "character.level": null, "character.power.current": 4,
    "character.stress.current": null, "character.psyche": null, "character.cain.cat": 3, "character.cain.xid": "TEST-001"
  });
});

test("native direct callers can use installed CAIN version context without assuming another game's version", t => {
  const previous = globalThis.game;
  t.after(() => { if (previous === undefined) delete globalThis.game; else globalThis.game = previous; });
  const actor = createCainCharacter(), fields = ["character.cain.cat"];
  globalThis.game = { system: { id: "cain", version: "1.3.26" } };
  assert.equal(normalize(actor, fields, { systemVersion: undefined })[fields[0]], 3);
  assert.equal(normalize(actor, fields, { systemVersion: "1.2.9" })[fields[0]], null);
  globalThis.game.system.id = "different";
  assert.equal(normalize(actor, fields, { systemVersion: undefined })[fields[0]], null);
  delete globalThis.game;
  assert.equal(normalize(actor, fields, { systemVersion: undefined })[fields[0]], null);
});

test("current/max metadata links actual numeric fields with independent field applicability", () => {
  const descriptors = new Map(cainAdapter.fields.map(field => [field.id, field]));
  for (const field of cainAdapter.fields) {
    assert.equal(typeof field.group, "string"); assert.equal(typeof field.role, "string");
    if (field.id.startsWith("character.cain.")) {
      assert.deepEqual(field.actorTypes, ["character"]); assert.deepEqual(field.testedSystemVersions, ["1.3.26"]);
    } else {
      assert.equal(field.actorTypes, undefined); assert.equal(field.testedSystemVersions, undefined);
    }
    if (field.maxField) assert.equal(descriptors.get(field.maxField)?.type, "number");
  }
  for (const resource of cainAdapter.resources) {
    assert.equal(descriptors.get(resource.currentField)?.type, "number");
    assert.equal(descriptors.get(resource.maxField)?.type, "number");
    assert.equal(descriptors.get(resource.currentField).maxField, resource.maxField);
  }
  const polarity = Object.fromEntries(cainAdapter.resources.map(resource => [resource.id, resource.polarity]));
  assert.equal(polarity["cain.stress"], "higher-is-worse");
  assert.equal(polarity["cain.sinOverflow"], "higher-is-worse");
  assert.equal(polarity["cain.psycheBurst"], "lower-is-worse");
  assert.equal(polarity["cain.divineAgony"], "neutral");
});

test("all ten skill ratings and maxima retain zero and change independently", () => {
  const actor = createCainCharacter();
  for (const skill of CAIN_SKILL_KEYS) {
    actor.system.skills[skill] = { value: 0, max: 0 };
    const rating = `character.cain.skills.${skill}.rating`, maximum = `character.cain.skills.${skill}.max`;
    assert.deepEqual(normalize(actor, [rating, maximum]), { [rating]: 0, [maximum]: 0 });
    actor.system.skills[skill] = { value: 3, max: 4 };
    assert.deepEqual(normalize(actor, [rating, maximum]), { [rating]: 3, [maximum]: 4 });
  }
});

test("CAIN preserves raw current/max numbers and does not fabricate values for invalid inputs", () => {
  const actor = createCainCharacter(), current = "character.cain.injuries.current", maximum = "character.cain.injuries.max";
  for (const [value, max] of [[0, 0], [7, 3], [-1, 3], [2, -1], [2.5, 3.5]]) {
    actor.system.injuries = { value, max };
    assert.deepEqual(normalize(actor, [current, maximum]), { [current]: value, [maximum]: max });
  }
  for (const value of [undefined, null, NaN, Infinity, -Infinity, "2", {}, [], true]) {
    actor.system.injuries.value = value;
    assert.equal(normalize(actor, [current])[current], null);
  }
  delete actor.system.injuries;
  assert.deepEqual(normalize(actor, [current, maximum]), { [current]: null, [maximum]: null });
});

test("legacy HP percentage keeps clamping and missing/zero-max semantics", () => {
  const actor = createCainCharacter(), id = "character.hp.percent";
  for (const [value, max, expected] of [[0, 10, 0], [20, 10, 100], [-3, 10, 0], [4, 0, null], [4, -1, null], ["4", 10, null]]) {
    actor.system.health = { value, max };
    assert.equal(normalize(actor, [id])[id], expected);
  }
});

test("only selected scalars are read, with no rolls, catalog resolution, collections, or document writes", () => {
  const actor = createCainCharacter();
  const forbidden = () => { throw new Error("Unselected or side-effectful access"); };
  for (const property of ["items", "effects"]) Object.defineProperty(actor, property, { get: forbidden });
  for (const method of ["update", "getRollData", "roll", "toObject", "toPlainObject"]) actor[method] = forbidden;
  Object.defineProperty(actor.system, "biography", { get: forbidden });
  Object.defineProperty(actor.system, "stress", { get: forbidden });
  assert.deepEqual(normalize(actor, ["character.cain.cat", "character.cain.xid", "character.biography", "character.cain.afflictions"]), {
    "character.cain.cat": 3, "character.cain.xid": "TEST-001"
  });
  assert.deepEqual(normalize(actor, []), {});
});

test("native text is bounded and type checked while permission denial prevents extraction", () => {
  const actor = createCainCharacter(), id = "character.cain.agenda";
  actor.system.agenda = "<img onerror=alert(1)>";
  assert.equal(normalize(actor, [id])[id], actor.system.agenda, "The adapter returns a literal string; rendering remains textContent");
  actor.system.agenda = "x".repeat(1500);
  assert.equal(normalize(actor, [id])[id].length, 1000);
  actor.system.agenda = ""; assert.equal(normalize(actor, [id])[id], "");
  for (const value of [null, 4, true, {}, []]) { actor.system.agenda = value; assert.equal(normalize(actor, [id])[id], null); }
  assert.equal(normalize(actor, [id], { user: { id: "other" } }), null);
  assert.equal(normalize(actor, [id], { user: null }), null);
  assert.equal(normalize(actor, null), null);
});
