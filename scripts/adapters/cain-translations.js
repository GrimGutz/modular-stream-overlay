/**
 * Russian CAIN catalog names on the stream page. The "CAIN | Русский перевод" module (cain-ru)
 * translates world Items in memory once the game view is ready, but Foundry's stream view never
 * fires "ready", so OBS would show the stored English names. This reads only the translation
 * files cain-ru publishes and changes no Documents, settings or other modules.
 */
export const CAIN_TRANSLATION_MODULE = "cain-ru";
// The catalog files cain-ru applies to world Items; its homebrew file only serves compendia.
const PACK_FILES = ["afflictions", "agendas", "blasphemies", "items", "sin-marks", "virtues"];
const LOOKUP_FIELDS = ["name", "system.agendaName", "system.task", "system.abilityName", "system.blasphemyName",
  "system.powerName", "system.virtueName", "system.afflictionName", "system.bodyPartName"];
const NAME_KEYS = new Set(LOOKUP_FIELDS.map(path => path.split(".").at(-1)));
const PROVENANCE = /^Compendium\.cain\.([^.]+)\.(?:Item\.)?([^.]+)$/;

let catalog = null;

const lookupKey = value => typeof value === "string" ? value.trim().toLowerCase() : "";
const read = (source, path) => path.split(".").reduce((value, key) => value?.[key], source);

/** Same conditions as cain-ru: a CAIN world, Russian client language and catalog translation on. */
export function cainTranslationsWanted(game = globalThis.game) {
  if (game?.system?.id !== "cain" || game.i18n?.lang !== "ru" || !game.modules?.get(CAIN_TRANSLATION_MODULE)?.active) return false;
  try { return game.settings.get(CAIN_TRANSLATION_MODULE, "translateCompendia") !== false; }
  catch { return true; }
}

/** Index cain-ru's [pack, file] entries by original and translated names and by catalog ID. */
export function buildCainCatalog(files, originals = {}) {
  const byName = new Map(), byId = new Map();
  const add = (key, record) => {
    if (!key) return;
    const list = byName.get(key) ?? [];
    if (!list.includes(record)) list.push(record);
    byName.set(key, list);
  };
  let size = 0;
  for (const [pack, data] of files) {
    const mapping = data?.mapping && typeof data.mapping === "object" ? data.mapping : {};
    for (const [originalName, entry] of Object.entries(data?.entries ?? {})) {
      if (!entry || typeof entry !== "object") continue;
      const original = originals?.packs?.[pack]?.[originalName];
      const record = { originalName, mapping, entry, original };
      size++;
      add(lookupKey(originalName), record);
      for (const [key, value] of [...Object.entries(entry), ...Object.entries(original?.previous ?? {})]) if (NAME_KEYS.has(key)) add(lookupKey(value), record);
      for (const id of [original?.id, ...(original?.variants ?? []).map(variant => variant?.id)]) if (typeof id === "string") byId.set(`${pack}.${id}`, record);
    }
  }
  return { byName, byId, size };
}

/** Replace the active catalog; null turns translation off. */
export function useCainTranslations(value) { catalog = value?.size ? value : null; }

/** Load cain-ru's files when they apply. Resolves false when nothing is translated. */
export async function loadCainTranslations({ game = globalThis.game, fetch = globalThis.fetch,
  route = path => globalThis.foundry?.utils?.getRoute?.(path) ?? path, timeout = 5000 } = {}) {
  if (!cainTranslationsWanted(game)) return false;
  const get = async path => {
    const response = await fetch(route(`modules/${CAIN_TRANSLATION_MODULE}/${path}`), { signal: AbortSignal.timeout?.(timeout) });
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.json();
  };
  const [originals, ...files] = await Promise.all([get("data/originals.json").catch(() => ({})),
    ...PACK_FILES.map(pack => get(`compendium/cain/cain.${pack}.json`).then(data => [pack, data], () => null))]);
  useCainTranslations(buildCainCatalog(files.filter(Boolean), originals));
  return catalog !== null;
}

function findRecord(item) {
  // cain-ru's order: a recorded original name, the catalog ID it came from, then its names.
  const flagged = item.flags?.[CAIN_TRANSLATION_MODULE]?.search?.originalName ?? item.flags?.babele?.originalName;
  let candidates = flagged ? catalog.byName.get(lookupKey(flagged)) ?? [] : [];
  const provenance = PROVENANCE.exec(item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? "");
  if (!candidates.length && provenance && catalog.byId.has(`${provenance[1]}.${provenance[2]}`)) return catalog.byId.get(`${provenance[1]}.${provenance[2]}`);
  for (const path of LOOKUP_FIELDS) {
    if (candidates.length) break;
    candidates = catalog.byName.get(lookupKey(read(item, path))) ?? [];
  }
  return candidates.find(record => record.original?.type === item.type) ?? candidates.find(record => !record.original?.type) ?? null;
}

/**
 * The Russian text for an Item field such as "name" or "system.blasphemyName". Like cain-ru,
 * only untouched catalog text is replaced; a player's own wording is shown as written.
 */
export function cainTranslated(item, path, value) {
  if (!catalog || !item || typeof value !== "string" || !value) return value;
  const record = findRecord(item);
  const key = record && Object.keys(record.mapping).find(entryKey => record.mapping[entryKey] === path);
  const translated = key ? record.entry[key] : undefined;
  if (typeof translated !== "string" || !translated) return value;
  const current = value.trim();
  const known = record.original
    ? [record.original.fields?.[path], record.original.previous?.[key], translated, ...(record.original.variants ?? []).map(variant => variant?.fields?.[path])]
    : NAME_KEYS.has(key) ? [record.originalName, translated] : [translated];
  return known.some(entry => typeof entry === "string" && entry.trim() === current) ? translated : value;
}
