import test from "node:test";
import assert from "node:assert/strict";
import { cainAdapter } from "../scripts/adapters/cain.js";
import { cainPlainText, cainCatText, cainBlasphemyColor, CAIN_COLLECTION_FIELDS } from "../scripts/adapters/cain-collections.js";
import { AdapterRegistry } from "../scripts/core/registry.js";
import { genericAdapter } from "../scripts/adapters/generic.js";
import { CharacterDataService } from "../scripts/data/character-data.js";
import { CAIN_VIEWER as viewer, createCainCharacter } from "./fixtures/cain-1.3.26.js";

const id = suffix => `character.cain.${suffix}`;
const fields = CAIN_COLLECTION_FIELDS.map(field => field.id);
function fixture() {
  const actor = createCainCharacter();
  Object.assign(actor.system, { currentAgenda: "agenda", currentBlasphemies: ["blasphemy"], currentBlasphemyPowers: ["personal", "legacy"],
    afflictions: ["illness"], currentAgendaAbilities: ["ability"], currentUnboldedAgendaTasks: ["ordinary"], currentBoldedAgendaTasks: ["bold"], sinMarks: ["mark"] });
  actor.items = new Map();
  const world = new Map();
  const item = (itemId, type, name, system, parent = null) => ({ documentName: "Item", id: itemId, type, name, system, parent, allowed: true,
    testUserPermission(user, permission) { return this.allowed && user?.id === viewer.id && permission === "OBSERVER"; } });
  actor.items.set("personal", item("personal", "blasphemyPower", "Personal name", { powerName: "Personal power", powerDescription: "Personal edit" }, actor));
  for (const record of [item("personal", "blasphemyPower", "Wrong world copy", { powerName: "Wrong world copy", powerDescription: "Wrong world description" }),
    item("legacy", "blasphemyPower", "Legacy", { powerName: "Legacy power", powerDescription: "World description" }),
    item("illness", "affliction", "Affliction", { afflictionName: "Exhaustion", afflictionDescription: "Unrequested private description" }),
    item("ability", "agendaAbility", "Ability", { abilityName: "Care", abilityDescription: "Protect an ally" }),
    item("ordinary", "agendaTask", "Ordinary", { task: "Put people first" }), item("bold", "agendaTask", "Bold", { task: "Do no harm" }),
    item("mark", "sinMark", "Marked hand", { bodyPartName: "Hand" }), item("agenda", "agenda", "Agenda", { agendaName: "Temperance" }),
    // Catalog Smother colors: a grey accent with the signature color in its text color.
    item("blasphemy", "blasphemy", "Blasphemy", { blasphemyName: "Suppression", primaryColor: "#000000", accentColor: "#8f8f8f", textColor: "#ffe100" })]) world.set(record.id, record);
  const normalize = (requested = fields, options = {}) => cainAdapter.normalize(actor, { user: viewer, fields: requested, systemVersion: "1.3.26", worldItems: world, ...options });
  return { actor, world, normalize };
}

test("CAIN selected collections resolve embedded edits before world Items into bounded plain scalar summaries", () => {
  const { actor, normalize } = fixture(), before = structuredClone(actor.system);
  assert.deepEqual(normalize(), {
    [id("afflictions.summary")]: "Exhaustion",
    [id("powers.summary")]: "Personal power\nPersonal edit\n\nLegacy power\nWorld description",
    [id("agendaAbilities.summary")]: "Care\nProtect an ally",
    [id("agendaTasks.summary")]: "▸ Put people first\n◆ Do no harm",
    [id("sinMarks.summary")]: "Marked hand",
    [id("agenda.label")]: "Agenda", [id("blasphemy.label")]: "Suppression", [id("blasphemy.color")]: "#e8a000",
    [id("powers.entry1.name")]: "Personal power", [id("powers.entry1.description")]: "Personal edit",
    [id("powers.entry1.preview")]: "Personal edit",
    [id("powers.entry2.name")]: "Legacy power", [id("powers.entry2.description")]: "World description",
    [id("powers.entry2.preview")]: "World description",
    [id("powers.entry3.name")]: "", [id("powers.entry3.description")]: "",
    [id("powers.entry3.preview")]: "",
    [id("agendaAbilities.entry1.name")]: "Care", [id("agendaAbilities.entry1.description")]: "Protect an ally",
    [id("agendaAbilities.entry1.preview")]: "Protect an ally",
    [id("agendaAbilities.entry2.name")]: "", [id("agendaAbilities.entry2.description")]: "",
    [id("agendaAbilities.entry2.preview")]: "",
    [id("agendaAbilities.entry3.name")]: "", [id("agendaAbilities.entry3.description")]: "",
    [id("agendaAbilities.entry3.preview")]: "",
    [id("powers.count")]: 2, [id("agendaAbilities.count")]: 1
  });
  assert.deepEqual(actor.system, before);
  assert(!JSON.stringify(normalize()).includes("Unrequested private"));
  assert(!JSON.stringify(normalize()).includes("Wrong world"));
});

test("blasphemy color picks the first saturated sheet color and stays empty without a blasphemy", () => {
  assert.equal(cainBlasphemyColor({ accentColor: "#0064FF", textColor: "#ffffff" }), "#0064ff");
  assert.equal(cainBlasphemyColor({ accentColor: "#000000", textColor: "#ffdc00", primaryColor: "#333333" }), "#e8a000", "Bright yellow becomes a readable yellow-orange");
  assert.equal(cainBlasphemyColor({ accentColor: "#f79646" }), "#f79646", "Orange is not treated as yellow");
  assert.equal(cainBlasphemyColor({ accentColor: "#aaff00" }), "#aaff00", "Lime is not treated as yellow");
  assert.equal(cainBlasphemyColor({ accentColor: "#555555", textColor: "#ffffff" }), "#555555", "Greyscale sheets keep their accent");
  assert.equal(cainBlasphemyColor({ accentColor: "magenta" }), "");
  const { actor, normalize } = fixture();
  actor.system.currentBlasphemies = [];
  assert.equal(normalize([id("blasphemy.color")])[id("blasphemy.color")], "");
});

test("agenda caption matches the actual Character sheet document name, including translated and personal names", () => {
  const { actor, world, normalize } = fixture();
  const agenda = world.get("agenda");
  agenda.name = "Умеренность";
  agenda.system.agendaName = "Temperance";
  assert.equal(normalize([id("agenda.label")])[id("agenda.label")], "Умеренность");
  agenda.name = "Мой подход";
  assert.equal(normalize([id("agenda.label")])[id("agenda.label")], "Мой подход");
  actor.items.set("agenda", { ...agenda, name: "Unselected embedded agenda", parent: actor });
  assert.equal(normalize([id("agenda.label")])[id("agenda.label")], "Мой подход", "Native Character heading resolves currentAgenda from world Items only");
});

test("indexed power and agenda fields preserve selected order, empty slots, CAT display, and permission revocation", () => {
  const { actor, world, normalize } = fixture();
  const selected = [id("powers.entry1.name"), id("powers.entry1.description"), id("powers.entry2.name"), id("powers.count"), id("agendaAbilities.count")];
  actor.system.currentBlasphemyPowers.reverse();
  world.get("legacy").system.powerDescription = "Reaches {<CAT> range}.";
  assert.deepEqual(normalize(selected), {
    [selected[0]]: "Legacy power", [selected[1]]: "Reaches down the block.", [selected[2]]: "Personal power", [selected[3]]: 2, [selected[4]]: 1
  });
  world.get("legacy").allowed = false;
  assert.deepEqual(normalize(selected), { [selected[0]]: null, [selected[1]]: null, [selected[2]]: null, [selected[3]]: null, [selected[4]]: 1 });
  actor.system.currentBlasphemyPowers = [];
  assert.deepEqual(normalize(selected), { [selected[0]]: "", [selected[1]]: "", [selected[2]]: "", [selected[3]]: 0, [selected[4]]: 1 });
});

test("CAT tokens in learned power and agenda descriptions display the Character's prepared category without HTML damage", () => {
  const { actor, world, normalize } = fixture();
  actor.system.CATLEVEL.value = 3;
  actor.items.get("personal").system.powerDescription = "Affects {<CAT> people}; reaches {<CAT/2> range 1}.";
  world.get("ability").system.abilityDescription = "Size {&lt;CAT+1&gt; size}; magnitude {<CAT> magnitude -2}.";
  const values = normalize([id("powers.summary"), id("agendaAbilities.summary")]);
  assert.match(values[id("powers.summary")], /Affects large group; reaches down the block\./);
  assert.equal(values[id("agendaAbilities.summary")], "Care\nSize large vehicle; magnitude noticable.");
  actor.system.CATLEVEL.value = 1;
  assert.match(normalize([id("powers.summary")])[id("powers.summary")], /Affects a few; reaches across the street\./);
  assert.equal(cainCatText("{<CAT*2> CAT 1}", 4), "7");
  assert.equal(cainCatText("{<CAT/0> range} {<CAT> future_key}", 3), "{<CAT/0> range} {<CAT> future_key}");
  assert.equal(cainCatText("{<CAT> range}", undefined), "{<CAT> range}");
  assert.equal(cainCatText("{<CAT> range} [[1d6]]", 0), "touch [[1d6]]");
  assert.equal(cainPlainText(cainCatText("Неизвестный {<CAT> distance_normal 0}", 1)), "Неизвестный {<CAT> distance_normal 0}");
  assert.equal(cainPlainText("{&lt;CAT&gt; future_key 0}"), "{<CAT> future_key 0}");
});

test("compact preview fields visibly abbreviate at a word boundary while separate descriptions preserve longer sheet text", () => {
  const { actor, normalize } = fixture();
  const full = "Способность сохраняет актуальное описание из листа персонажа и показывает его без изменения правил игры. ".repeat(10).trim();
  actor.items.get("personal").system.powerDescription = full;
  const result = normalize([id("powers.entry1.preview"), id("powers.entry1.description")]);
  assert.equal(result[id("powers.entry1.description")], full);
  const preview = result[id("powers.entry1.preview")];
  assert(preview.length <= 90 && preview.endsWith("…"));
  assert(full.startsWith(preview.slice(0, -1)));
  assert.equal(full[preview.length - 1], " ", "Visible abbreviation ends at a complete word");
});

test("empty collections differ from missing, inaccessible, malformed, wrong-type and compendium references", () => {
  const { actor, world, normalize } = fixture(), field = id("afflictions.summary");
  actor.system.afflictions = []; assert.equal(normalize([field])[field], "—");
  for (const value of [undefined, null, "illness", ["missing"], ["Item.illness"], Array(33).fill("illness"), ["illness", null]]) {
    actor.system.afflictions = value; assert.equal(normalize([field])[field], null);
  }
  actor.system.afflictions = ["illness"];
  const item = world.get("illness");
  item.allowed = false; assert.equal(normalize([field])[field], null);
  item.allowed = true; item.type = "item"; assert.equal(normalize([field])[field], null);
  item.type = "affliction"; item.pack = "world.private"; assert.equal(normalize([field])[field], null);
  delete item.pack; assert.equal(normalize([field])[field], "Exhaustion");
  actor.items.set("illness", { ...item, parent: { uuid: "Actor.other" } });
  assert.equal(normalize([field])[field], null, "A mismatched embedded copy cannot fall through to an accessible world Item");
});

test("collection selection, Actor permissions and exact version/type guards prevent unrelated reads", () => {
  const { actor, normalize } = fixture();
  Object.defineProperty(actor, "items", { get() { throw new Error("Collection must remain unselected"); } });
  assert.deepEqual(normalize(["character.cain.cat"]), { "character.cain.cat": 3 });
  assert.deepEqual(normalize(fields, { systemVersion: "1.4.0" }), Object.fromEntries(fields.map(field => [field, null])));
  actor.type = "sin"; assert.deepEqual(normalize(), Object.fromEntries(fields.map(field => [field, null])));
  assert.equal(normalize(fields, { user: { id: "other" } }), null);
});

test("collection text refuses rich input without an inert parser, strips UUID IDs and remains bounded", () => {
  const { world, normalize } = fixture(), field = id("powers.summary");
  world.get("legacy").system.powerDescription = "@UUID[Item.private]{Readable label} and @UUID[Item.other]";
  assert.match(normalize([field])[field], /Readable label and …/);
  assert(!normalize([field])[field].includes("Item.private"));
  world.get("legacy").system.powerDescription = "x".repeat(900);
  assert.equal(normalize([field])[field].match(/x+/)[0].length, 800);
  world.get("legacy").system.powerDescription = "x".repeat(20001);
  assert.equal(normalize([field])[field], null);
  assert.equal(cainPlainText("A & B\u0000\r\n next"), "A & B\nnext");
  assert.equal(cainPlainText('<p>Public</p><section class="secret">Hidden</section>'), null);
});

// Parsed DOM fixtures exercise our secret/text traversal. HTML grammar itself belongs to
// the browser's native inert template parser, not a second handwritten parser in the provider.
function text(value) { return { nodeType: 3, textContent: value }; }
function element(tagName, children = [], attributes = {}) {
  return { nodeType: 1, tagName, childNodes: children, classList: (attributes.class ?? "").split(/\s+/).filter(Boolean),
    hasAttribute: key => Object.hasOwn(attributes, key), getAttribute: key => attributes[key] ?? null };
}
test("parsed rich text removes nested Foundry secrets, hidden content and executable blocks before extracting text", t => {
  const previous = globalThis.document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  globalThis.document = {
    createElement(tag) { assert.equal(tag, "template"); return { content: { nodeType: 11, childNodes: [element("P", [text("Public & visible")]),
      element("SECTION", [text("SECRET"), element("P", [text("NESTED SECRET")])], { class: "secret revealed" }),
      element("DIV", [text("HIDDEN")], { hidden: "" }), element("DIV", [text("CSS HIDDEN")], { style: "display: none" }),
      element("SCRIPT", [text("EXECUTABLE")]), element("STYLE", [text("CSS")]), element("P", [text("Next"), element("BR"), text("line")])] } }; }
  };
  assert.equal(cainPlainText("<p>parsed content</p>"), "Public & visible\n\nNext\nline");
});

function hooksMock() {
  let next = 0; const listeners = new Map();
  return { listeners, on(name, callback) { listeners.set(++next, { name, callback }); return next; }, off(_name, key) { listeners.delete(key); },
    fire(name, ...args) { for (const listener of listeners.values()) if (listener.name === name) listener.callback(...args); } };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 8));
test("world Item edit/delete/permission changes invalidate only subscribed referencing Actors and clear stale summaries", async t => {
  const { actor, world } = fixture(), unrelated = createCainCharacter();
  unrelated.uuid = "Actor.unrelated"; unrelated.id = "unrelated";
  unrelated.system.afflictions = [];
  const hooks = hooksMock(), registry = new AdapterRegistry(); registry.register(genericAdapter); registry.register(cainAdapter);
  const previous = globalThis.game; globalThis.game = { items: world };
  t.after(() => { if (previous === undefined) delete globalThis.game; else globalThis.game = previous; });
  const service = new CharacterDataService({ adapters: registry, getUser: () => viewer, getSystemId: () => "cain", getSystemVersion: () => "1.3.26",
    getActors: () => ({ contents: [actor, unrelated] }), resolveUuid: uuid => [actor, unrelated].find(record => record.uuid === uuid), hooks, debounceMs: 0 });
  t.after(() => service.stop());
  const calls = [];
  service.subscribe(actor.uuid, uuid => calls.push(uuid)); service.subscribe(unrelated.uuid, uuid => calls.push(uuid)); service.start();
  const field = id("afflictions.summary"), item = world.get("illness");
  assert.equal((await service.resolve(actor.uuid, [field])).values[field], "Exhaustion");
  item.system.afflictionName = "Recovered affliction"; hooks.fire("updateItem", item); await tick();
  assert.deepEqual(calls, [actor.uuid]); calls.length = 0;
  assert.equal((await service.resolve(actor.uuid, [field])).values[field], "Recovered affliction");
  item.allowed = false; hooks.fire("updateItem", item, { ownership: {} }); await tick();
  assert.deepEqual(calls, [actor.uuid]); calls.length = 0;
  assert.equal((await service.resolve(actor.uuid, [field])).fieldStatus[field], "unavailable");
  world.delete(item.id); hooks.fire("deleteItem", item); await tick();
  assert.deepEqual(calls, [actor.uuid]); calls.length = 0;
  assert.equal((await service.resolve(actor.uuid, [field])).values[field], null);
  world.set(item.id, item); item.allowed = true; hooks.fire("createItem", item); await tick();
  assert.deepEqual(calls, [actor.uuid]);
  assert.equal((await service.resolve(actor.uuid, [field])).values[field], "Recovered affliction");
  service.stop(); assert.equal(hooks.listeners.size, 0);
});
