import test from "node:test";
import assert from "node:assert/strict";
import { cainAdapter } from "../scripts/adapters/cain.js";
import { buildCainCatalog, cainTranslationsWanted, loadCainTranslations, useCainTranslations } from "../scripts/adapters/cain-translations.js";
import { CAIN_VIEWER as viewer, createCainCharacter } from "./fixtures/cain-1.3.26.js";

// Shapes of cain-ru 0.1.1's compendium/cain/*.json and data/originals.json, reduced to a few entries.
const FILES = [
  ["blasphemies", { mapping: { name: "name", blasphemyName: "system.blasphemyName", powerName: "system.powerName", powerDescription: "system.powerDescription" },
    entries: { Ardence: { name: "Пыл", blasphemyName: "Пыл" }, Fling: { name: "Бросок", powerName: "Бросок", powerDescription: "Придайте скорость" } } }],
  ["agendas", { mapping: { name: "name", task: "system.task", agendaName: "system.agendaName", abilityName: "system.abilityName" },
    entries: { Beast: { name: "Зверь", agendaName: "Зверь" }, "Get into a fight": { name: "Ввязаться в драку", task: "Ввязаться в драку" },
      "Red Muscle": { name: "Красные мышцы", abilityName: "Красные мышцы" } } }]
];
const ORIGINALS = { packs: {
  blasphemies: { Ardence: { id: "drJMo9pGRGW82myi", type: "blasphemy", fields: { name: "Ardence", "system.blasphemyName": "Ardence" } },
    Fling: { id: "fling", type: "blasphemyPower", fields: { name: "Fling", "system.powerName": "Fling", "system.powerDescription": "Give speed" } } },
  agendas: { Beast: { id: "beast", type: "agenda", fields: { name: "Beast" } },
    "Get into a fight": { id: "fight", type: "agendaTask", fields: { name: "Get into a fight", "system.task": "Get into a fight" } },
    "Red Muscle": { id: "muscle", type: "agendaAbility", fields: { name: "Red Muscle", "system.abilityName": "Red Muscle" } } }
} };

function character(items) {
  const actor = createCainCharacter();
  Object.assign(actor.system, { currentAgenda: "agenda", currentBlasphemies: ["blasphemy"], currentBlasphemyPowers: ["power"],
    afflictions: [], currentAgendaAbilities: ["ability"], currentUnboldedAgendaTasks: ["task"], currentBoldedAgendaTasks: ["own"], sinMarks: [] });
  actor.items = new Map();
  const world = new Map(items.map(([id, type, name, system, extra = {}]) => [id, { documentName: "Item", id, type, name, system, parent: null, ...extra,
    testUserPermission: (user, permission) => user?.id === viewer.id && permission === "OBSERVER" }]));
  const fields = ["blasphemy.label", "agenda.label", "agendaTasks.summary", "agendaAbilities.entry1.name", "powers.entry1.name", "powers.entry1.description"].map(suffix => `character.cain.${suffix}`);
  return () => cainAdapter.normalize(actor, { user: viewer, fields, systemVersion: "1.3.26", worldItems: world });
}

const ITEMS = [
  // Imported from the homebrew pack, which cain-ru does not apply: found by its name instead.
  ["blasphemy", "blasphemy", "Ardence", { blasphemyName: "Ardence" }, { _stats: { compendiumSource: "Compendium.cain.homebrew.Item.utIRL9nZsnGRKBMu" } }],
  ["agenda", "agenda", "Beast", { agendaName: "Beast" }],
  ["task", "agendaTask", "Get into a fight", { task: "Get into a fight" }],
  ["own", "agendaTask", "Hold Back", { task: "Hold Back" }],
  ["ability", "agendaAbility", "Red Muscle", { abilityName: "Red Muscle" }],
  // A renamed copy is still recognized by the catalog entry it came from.
  ["power", "blasphemyPower", "Custom", { powerName: "Fling", powerDescription: "Give speed" }, { _stats: { compendiumSource: "Compendium.cain.blasphemies.Item.fling" } }]
];

test("the stream shows cain-ru's Russian catalog names while untranslated and player text stays as written", t => {
  t.after(() => useCainTranslations(null));
  const normalize = character(ITEMS);
  assert.equal(normalize()["character.cain.blasphemy.label"], "Ardence", "Nothing is translated before cain-ru's files load");
  useCainTranslations(buildCainCatalog(FILES, ORIGINALS));
  assert.deepEqual(normalize(), {
    "character.cain.blasphemy.label": "Пыл", "character.cain.agenda.label": "Зверь",
    "character.cain.agendaTasks.summary": "▸ Ввязаться в драку\n◆ Hold Back",
    "character.cain.agendaAbilities.entry1.name": "Красные мышцы",
    "character.cain.powers.entry1.name": "Бросок", "character.cain.powers.entry1.description": "Придайте скорость"
  });
  const edited = character(ITEMS.map(item => item[0] === "power" ? [...item.slice(0, 3), { powerName: "Fling", powerDescription: "My own wording" }, item[4]] : item));
  assert.equal(edited()["character.cain.powers.entry1.description"], "My own wording", "A player's edit is not replaced");
  const alreadyRussian = character(ITEMS.map(item => item[0] === "blasphemy" ? [item[0], item[1], "Пыл", { blasphemyName: "Пыл" }] : item));
  assert.equal(alreadyRussian()["character.cain.blasphemy.label"], "Пыл");
});

test("cain-ru's files are loaded only for a Russian CAIN world with catalog translation enabled", async t => {
  t.after(() => useCainTranslations(null));
  const game = (overrides = {}) => ({ system: { id: "cain" }, i18n: { lang: "ru" }, modules: new Map([["cain-ru", { active: true }]]),
    settings: { get: () => overrides.setting ?? true }, ...overrides });
  assert.equal(cainTranslationsWanted(game()), true);
  assert.equal(cainTranslationsWanted(game({ i18n: { lang: "en" } })), false);
  assert.equal(cainTranslationsWanted(game({ system: { id: "dnd5e" } })), false);
  assert.equal(cainTranslationsWanted(game({ modules: new Map([["cain-ru", { active: false }]]) })), false);
  assert.equal(cainTranslationsWanted(game({ setting: false })), false);
  assert.equal(cainTranslationsWanted(game({ settings: { get: () => { throw new Error("Not registered"); } } })), true);

  const requested = [];
  const fetch = async url => {
    requested.push(url);
    const pack = /cain\.([a-z-]+)\.json$/.exec(url)?.[1];
    const data = url.endsWith("originals.json") ? ORIGINALS : FILES.find(([name]) => name === pack)?.[1];
    return data ? { ok: true, json: async () => data } : { ok: false, status: 404 };
  };
  assert.equal(await loadCainTranslations({ game: game({ i18n: { lang: "en" } }), fetch }), false);
  assert.equal(requested.length, 0, "Nothing is fetched when the files do not apply");
  assert.equal(await loadCainTranslations({ game: game(), fetch, route: path => `/foundry/${path}` }), true, "Missing optional files are skipped");
  assert(requested.includes("/foundry/modules/cain-ru/compendium/cain/cain.blasphemies.json"));
  assert(!requested.some(url => url.includes("homebrew")));
  assert.equal(character(ITEMS)()["character.cain.blasphemy.label"], "Пыл");
});
