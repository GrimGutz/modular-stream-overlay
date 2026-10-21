import { permittedActor } from "./generic.js";

// Only these explicitly selected, public Character collections enter the scalar provider.
// The renderer never receives Item documents, IDs, HTML, flags, or permission metadata.
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_REFERENCES = 32;
const MAX_TEXT_INPUT = 20000;
const MAX_ENTRY_TEXT = 800;
const MAX_ENTRY_DESCRIPTION = 6000;
const MAX_PREVIEW = 90;
const MAX_SUMMARY = 6000;
const EMPTY = "—";
const BLOCKS = new Set(["P", "DIV", "SECTION", "ARTICLE", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "TR"]);
const PRIVATE_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED", "HEAD"]);
const CAT_TOKEN = /\{(?:<CAT([/*+-]\d{1,6})?>|&lt;CAT([/*+-]\d{1,6})?&gt;)\s+([A-Za-z_]+)(?:\s+([+-]?\d{1,6}))?\}/g;

// Display vocabulary from CAIN 1.3.26's formatCatText table. Only this bounded
// token grammar is supported: no formulas, helpers, rolls or user code execute.
const CAT_KEYS = ["people", "size", "area", "range", "speed", "magnitude"];
const CAT_DISPLAY = Object.freeze([
  ["one", "human size", "personal", "touch", "average human", "small"],
  ["a few", "heavy furniture", "a few people", "same room", "fast human", "noticable"],
  ["small group", "large animal", "entire room", "across the street", "fast animal", "large"],
  ["large group", "vehicle", "a few rooms", "down the block", "car", "very large"],
  ["a crowd", "large vehicle", "whole building", "a few blocks away", "train", "massive"],
  ["a huge crowd", "building", "a city block", "across town", "maglev", "destructive"],
  ["thousands of people", "large building", "a whole neighborhood", "visual range", "airliner", "overwhelming"],
  ["many thousands of people", "skyscraper", "a whole town", "over the horizon", "jet fighter", "cataclysmic"]
].map(Object.freeze));

export function cainCatText(value, category) {
  if (typeof value !== "string" || value.length > MAX_TEXT_INPUT) return null;
  return value.replace(CAT_TOKEN,
    (token, rawOperation, encodedOperation, type, rawModifier) => {
      const operation = rawOperation ?? encodedOperation ?? "";
      // Unknown future table keys remain a visible literal CAT expression rather
      // than becoming HTML tags or the misleading string "undefined".
      const literal = token.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      if (!Number.isInteger(category) || category < 0 || category > 7) return literal;
      const index = CAT_KEYS.indexOf(type);
      if (index < 0 && type !== "CAT") return literal;
      let operated = category;
      if (operation) {
        const operand = Number(operation.slice(1));
        if (operation[0] === "/") { if (operand === 0) return literal; operated = Math.ceil(category / operand); }
        else if (operation[0] === "*") operated *= operand;
        else if (operation[0] === "+") operated += operand;
        else operated -= operand;
      }
      const final = Math.max(0, Math.min(7, operated + Number(rawModifier ?? 0)));
      return type === "CAT" ? String(final) : CAT_DISPLAY[final][index];
    });
}

const collectionDefinitions = [
  ["afflictions.summary", "Current afflictions"],
  ["powers.summary", "Acquired blasphemy powers"],
  ["agendaAbilities.summary", "Acquired agenda abilities"],
  ["agendaTasks.summary", "Current agenda tasks"],
  ["sinMarks.summary", "Current sin marks"],
  ["agenda.label", "Current agenda name"],
  ["blasphemy.label", "Current blasphemy names"]
];
for (const [group, label] of [["powers", "Power"], ["agendaAbilities", "Agenda ability"]]) {
  for (let index = 1; index <= 3; index++) {
    collectionDefinitions.push([`${group}.entry${index}.name`, `${label} ${index} name`]);
    collectionDefinitions.push([`${group}.entry${index}.description`, `${label} ${index} description`]);
    collectionDefinitions.push([`${group}.entry${index}.preview`, `${label} ${index} preview`]);
  }
}
collectionDefinitions.push(["powers.count", "Acquired blasphemy power count", "number"], ["agendaAbilities.count", "Acquired agenda ability count", "number"]);
export const CAIN_COLLECTION_FIELDS = Object.freeze(collectionDefinitions.map(([suffix, label, type = "string"]) => Object.freeze({ id: `character.cain.${suffix}`, label, type, group: "Character details", role: type === "number" ? "count" : "summary",
  actorTypes: Object.freeze(["character"]), testedSystemVersions: Object.freeze(["1.3.26"]) })));
const SUPPORTED = new Set(CAIN_COLLECTION_FIELDS.map(field => field.id));

/** Inert browser parsing removes hidden/secret content before extracting bounded plain text. */
export function cainPlainText(value, limit = MAX_ENTRY_TEXT) {
  if (typeof value !== "string" || value.length > MAX_TEXT_INPUT) return null;
  let text = value;
  // A future CAT table key is display notation, never an HTML element. Mask only
  // the strict system token grammar before inert parsing and restore afterwards.
  let prefix = "__MSO_CAT_LITERAL_";
  while (text.includes(prefix)) prefix = `_${prefix}`;
  const catLiterals = [];
  text = text.replace(CAT_TOKEN, token => {
    catLiterals.push(token.replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
    return `${prefix}${catLiterals.length - 1}__`;
  });
  if (/<|&(?:#x?[0-9a-f]+|[a-z][a-z0-9]+);/i.test(text)) {
    // A detached template parses an inert fragment: scripts never run and image/iframe
    // resources never load. Refuse rich input without a browser parser rather than
    // approximating secret removal with regular expressions.
    if (typeof globalThis.document?.createElement !== "function") return null;
    let root;
    try {
      const template = globalThis.document.createElement("template");
      if (!template.content || template.content.nodeType !== 11) return null;
      template.innerHTML = text;
      root = template.content;
    }
    catch { return null; }
    if (!root) return null;
    const pieces = [];
    let visited = 0, total = 0;
    const walk = node => {
      if (++visited > 5000 || total > MAX_TEXT_INPUT) throw new Error("Text is too complex");
      if (node.nodeType === 3) {
        const part = node.textContent ?? ""; total += part.length; pieces.push(part); return;
      }
      if (node.nodeType === 11) { for (const child of node.childNodes ?? []) walk(child); return; }
      if (node.nodeType !== 1) return;
      const tag = String(node.tagName).toUpperCase();
      if (PRIVATE_TAGS.has(tag) || node.hasAttribute?.("hidden") || node.hasAttribute?.("data-secret")
        || node.getAttribute?.("aria-hidden")?.toLowerCase() === "true"
        || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(node.getAttribute?.("style") ?? "")
        || [...(node.classList ?? [])].some(name => /^(?:secret|gm-only|gm-secret|private)$/i.test(name))) return;
      if (tag === "BR" || BLOCKS.has(tag)) pieces.push("\n");
      for (const child of node.childNodes ?? []) walk(child);
      if (BLOCKS.has(tag)) pieces.push("\n");
    };
    try { walk(root); text = pieces.join(""); }
    catch { return null; }
  }
  for (let index = 0; index < catLiterals.length; index++) text = text.split(`${prefix}${index}__`).join(catLiterals[index]);
  return text.replace(/@(?:UUID|Item|Actor|Compendium)\[[^\]]*\](?:\{([^}]*)\})?/g, (_match, label) => label || "…")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n").replace(/[ \t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, limit);
}

function excerpt(value, limit) {
  if (value.length <= limit) return value;
  const part = value.slice(0, limit - 1);
  const boundary = part.lastIndexOf(" ");
  return `${(boundary >= Math.floor(limit * 0.6) ? part.slice(0, boundary) : part).trimEnd().replace(/[\uD800-\uDBFF]$/, "")}…`;
}

function references(value) {
  if (!Array.isArray(value) || value.length > MAX_REFERENCES || value.some(id => typeof id !== "string" || !ID.test(id))) return null;
  return [...new Set(value)];
}

function permittedItem(item, actor, user, expectedType) {
  if (!item || (item.documentName ?? item.constructor?.documentName) !== "Item" || item.pack || item.type !== expectedType) return false;
  if (item.parent) return item.parent === actor && permittedActor(actor, user);
  return typeof item.testUserPermission === "function" && item.testUserPermission(user, "OBSERVER");
}

function selectedItems(value, actor, user, expectedType, worldItems, { worldOnly = false } = {}) {
  const ids = references(value);
  if (!ids) return null;
  const items = [];
  for (const id of ids) {
    // Match CAIN's sheet: a personal embedded copy wins over a catalog record.
    // An inaccessible/malformed embedded match must never fall back to the world copy.
    const item = (worldOnly ? undefined : actor.items?.get?.(id)) ?? worldItems?.get?.(id);
    if (item?.id !== id || !permittedItem(item, actor, user, expectedType)) return null;
    items.push(item);
  }
  return items;
}

function itemText(item, nameKey, descriptionKey, category) {
  const rawName = nameKey === null ? item.name : item.system?.[nameKey] || item.name;
  const name = cainPlainText(rawName, 160);
  if (!name) return null;
  if (!descriptionKey) return name;
  const rawDescription = item.system?.[descriptionKey];
  const description = rawDescription === undefined || rawDescription === "" ? "" : cainPlainText(cainCatText(rawDescription, category));
  if (description === null) return null;
  return description ? `${name}\n${description}` : name;
}

function summary(items, nameKey, descriptionKey, category) {
  if (!items) return null;
  if (!items.length) return EMPTY;
  const entries = items.map(item => itemText(item, nameKey, descriptionKey, category));
  if (entries.includes(null)) return null;
  const text = entries.join("\n\n");
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1).trimEnd()}…` : text;
}

/** Called only for known selected fields after CAIN version/type and Actor permission checks. */
export function normalizeCainCollection(actor, field, { user, worldItems = globalThis.game?.items } = {}) {
  if (!SUPPORTED.has(field) || !permittedActor(actor, user)) return null;
  const items = (value, type) => selectedItems(value, actor, user, type, worldItems);
  const entry = /^character\.cain\.(powers|agendaAbilities)\.entry([1-3])\.(name|description|preview)$/.exec(field);
  if (entry || field === "character.cain.powers.count" || field === "character.cain.agendaAbilities.count") {
    const group = entry?.[1] ?? (field === "character.cain.powers.count" ? "powers" : "agendaAbilities");
    const powers = group === "powers";
    const selected = items(actor.system[powers ? "currentBlasphemyPowers" : "currentAgendaAbilities"], powers ? "blasphemyPower" : "agendaAbility");
    if (!selected) return null;
    if (!entry) return selected.length;
    const item = selected[Number(entry[2]) - 1];
    if (!item) return "";
    if (entry[3] === "name") return itemText(item, powers ? "powerName" : "abilityName");
    const raw = item.system?.[powers ? "powerDescription" : "abilityDescription"];
    const description = raw === undefined || raw === "" ? "" : cainPlainText(cainCatText(raw, actor.system.CATLEVEL?.value), MAX_ENTRY_DESCRIPTION + 1);
    if (description === null) return null;
    return entry[3] === "preview" ? excerpt(description.replace(/\s+/g, " ").trim(), MAX_PREVIEW) : excerpt(description, MAX_ENTRY_DESCRIPTION);
  }
  switch (field) {
    case "character.cain.afflictions.summary": return summary(items(actor.system.afflictions, "affliction"), "afflictionName");
    case "character.cain.powers.summary": return summary(items(actor.system.currentBlasphemyPowers, "blasphemyPower"), "powerName", "powerDescription", actor.system.CATLEVEL?.value);
    case "character.cain.agendaAbilities.summary": return summary(items(actor.system.currentAgendaAbilities, "agendaAbility"), "abilityName", "abilityDescription", actor.system.CATLEVEL?.value);
    case "character.cain.sinMarks.summary": return summary(items(actor.system.sinMarks, "sinMark"), "name");
    case "character.cain.agendaTasks.summary": {
      const ordinary = items(actor.system.currentUnboldedAgendaTasks, "agendaTask"), bold = items(actor.system.currentBoldedAgendaTasks, "agendaTask");
      if (!ordinary || !bold) return null;
      const entries = [...ordinary.map(item => [item, "▸"]), ...bold.map(item => [item, "◆"])].map(([item, prefix]) => {
        const text = cainPlainText(item.system?.task || item.name); return text ? `${prefix} ${text}` : null;
      });
      if (entries.includes(null)) return null;
      return entries.length ? entries.join("\n").slice(0, MAX_SUMMARY) : EMPTY;
    }
    case "character.cain.agenda.label": {
      const id = actor.system.currentAgenda;
      if (id === "INVALID" || id === "") return EMPTY;
      // The actual Character sheet displays currentAgenda.name, not the legacy
      // system.agendaName, which may retain an untranslated catalog caption.
      return summary(selectedItems([id], actor, user, "agenda", worldItems, { worldOnly: true }), null);
    }
    case "character.cain.blasphemy.label": return summary(items(actor.system.currentBlasphemies, "blasphemy"), "blasphemyName");
    default: return null;
  }
}

/** Existing service routes world Item create/update/delete hooks through this predicate. */
export function cainCollectionAffected(event, { actor, document } = {}) {
  if (!/^(?:create|update|delete)Item$/.test(event) || actor?.type !== "character"
    || !document || document.parent || document.pack || (document.documentName ?? document.constructor?.documentName) !== "Item"
    || typeof document.id !== "string" || !ID.test(document.id)) return false;
  const system = actor.system;
  if (system?.currentAgenda === document.id) return true;
  return ["afflictions", "currentBlasphemyPowers", "currentAgendaAbilities", "currentUnboldedAgendaTasks", "currentBoldedAgendaTasks", "sinMarks", "currentBlasphemies"]
    .some(key => Array.isArray(system?.[key]) && system[key].includes(document.id));
}
