import test from "node:test";
import assert from "node:assert/strict";
import { AdapterRegistry } from "../scripts/core/registry.js";
import { genericAdapter } from "../scripts/adapters/generic.js";
import { cainAdapter } from "../scripts/adapters/cain.js";
import { cainBlasphemyColor, CAIN_VIOLET } from "../scripts/adapters/cain-collections.js";
import { CharacterDataService } from "../scripts/data/character-data.js";
import { ACCENT_FIELD } from "../scripts/data/bindings.js";
import { ruleColor, validateAccentRules } from "../scripts/data/accent-rules.js";

test("color rules are validated: a field, unique values and hex colors; empty entries are dropped", () => {
  assert.deepEqual(validateAccentRules({}), { field: "", colors: {} });
  assert.deepEqual(validateAccentRules({ field: " character.cain.blasphemy.label ", colors: { " Sympathy ": "#9966FF", Bind: "", "": "#000000" } }),
    { field: "character.cain.blasphemy.label", colors: { Sympathy: "#9966ff" } });
  for (const bad of [[], { field: "character name" }, { colors: { Bind: "violet" } }, { colors: { Bind: "#fff" } }, { colors: { Bind: "#111111", " bind ": "#222222" } },
    { colors: Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`v${index}`, "#000000"])) }]) assert.throws(() => validateAccentRules(bad));
  const rules = validateAccentRules({ colors: { Путы: "#9966ff", Ardence: "#ff3300" } });
  assert.equal(ruleColor(rules, " путы "), "#9966ff", "Case and spaces do not matter");
  assert.equal(ruleColor(rules, "Пыл\nПуты"), "#9966ff", "Several names: the first listed one with a color");
  assert.equal(ruleColor(rules, "Vector"), "");
  assert.equal(ruleColor(rules, null), "");
});

test("CAIN's magenta sheets become violet; adapters may suggest the field color rules use", () => {
  assert.equal(cainBlasphemyColor({ accentColor: "#ff00ff", textColor: "#ffffff", primaryColor: "#2a2a2a" }), CAIN_VIOLET);
  assert.equal(CAIN_VIOLET, "#9966ff");
  assert.equal(cainBlasphemyColor({ accentColor: "#9427cc", textColor: "#ffffff" }), "#9427cc", "MOTHER's own purple stays");
  const registry = new AdapterRegistry();
  assert.equal(registry.register(cainAdapter).accentKeyField, "character.cain.blasphemy.label");
  assert.throws(() => registry.register({ id: "bad", label: "Bad", systemId: "other", accentKeyField: "character.missing", normalize: () => ({}) }), /accentKeyField/);
});

function service({ rules = {}, profiles = {}, mappings = [] } = {}) {
  const user = { id: "viewer" };
  const actors = [["one", "Sympathy", "#ff00ff"], ["two", "Ardence\nBind", "#ff0000"], ["three", "", ""]].map(([id, blasphemy, color]) => ({
    uuid: `Actor.${id}`, documentName: "Actor", type: "character", name: id, system: { blasphemy, color, cls: id === "one" ? "Wizard" : "Fighter" },
    testUserPermission: (viewer, permission) => viewer?.id === user.id && permission === "OBSERVER" }));
  const registry = new AdapterRegistry(); registry.register(genericAdapter);
  registry.register({ id: "colors", label: "Colors", systemId: "test", accentField: "character.test.color", accentKeyField: "character.test.blasphemy",
    fields: [{ id: "character.test.color", label: "Color", type: "string" }, { id: "character.test.blasphemy", label: "Blasphemy", type: "string" }],
    normalize: (actor, { fields }) => Object.fromEntries(fields.map(field => [field, field.endsWith("color") ? actor.system.color : actor.system.blasphemy])) });
  const state = { rules, profiles };
  const data = new CharacterDataService({ adapters: registry, getUser: () => user, getSystemId: () => "test", getActors: () => ({ contents: actors }),
    resolveUuid: async uuid => actors.find(actor => actor.uuid === uuid), hooks: null, getProfiles: () => state.profiles, getAccentRules: () => state.rules,
    getMappings: () => mappings });
  const accent = async id => (await data.resolve(`Actor.${id}`, [ACCENT_FIELD])).values[ACCENT_FIELD];
  return { data, state, accent };
}

test("a character's color: its own, else its value's rule, else the system's color", async () => {
  const { data, state, accent } = service();
  assert.deepEqual(data.accentFields(), { keyField: "character.test.blasphemy", suggestedKeyField: "character.test.blasphemy", colorField: "character.test.color" });
  assert.deepEqual([await accent("one"), await accent("two"), await accent("three")], ["#ff00ff", "#ff0000", ""], "No rules: the system's colors");
  state.rules = { colors: { sympathy: "#9966ff", Bind: "#00aa88" } };
  assert.deepEqual([await accent("one"), await accent("two")], ["#9966ff", "#00aa88"], "Rules by the suggested field; a second blasphemy still matches");
  state.profiles = { "Actor.one": { accent: "#123456" } };
  assert.equal(await accent("one"), "#123456", "The character's own color wins");
  state.rules = { colors: { Sympathy: "violet" } };
  state.profiles = {};
  assert.equal(await accent("one"), "#ff00ff", "Invalid rules are ignored rather than shown");
  const result = await data.resolve("Actor.one", [ACCENT_FIELD]);
  assert.deepEqual(Object.keys(result.values), [ACCENT_FIELD], "The rule's field is read but not returned");
});

test("rules can use any text field, such as a mapped class for a system without colors", async () => {
  const mappings = [{ id: "character.custom.class", label: "Class", type: "string", path: "system.cls" }];
  const { data, state, accent } = service({ mappings, rules: { field: "character.custom.class", colors: { Wizard: "#3355ff" } } });
  assert.equal(data.accentFields().keyField, "character.custom.class");
  assert.deepEqual([await accent("one"), await accent("two")], ["#3355ff", "#ff0000"], "A Fighter without a rule keeps the system color");
  state.rules = { field: "character.profile.accent", colors: { x: "#000000" } };
  assert.equal(await accent("one"), "#ff00ff", "A profile field cannot drive its own color");
});
