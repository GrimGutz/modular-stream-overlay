/**
 * Character colors for every widget and voice glow: a color per value of one field (a CAIN
 * blasphemy, a D&D class, any text field) and a color per character. The order is the
 * character's own color, then its value's color, then the game system's color.
 */
import { t, setText, setAttr, errorText } from "./i18n.js";
import { fieldLabel } from "./field-settings.js";
import { ruleColor, validateAccentRules } from "../data/accent-rules.js";
import { validateCharacterProfiles } from "../data/profiles.js";

const MODULE_ID = "modular-stream-overlay";
const { ApplicationV2 } = foundry.applications.api;
const HEX = /^#[\da-f]{6}$/i;
let services = {};
let app = null;

export function configureCharacterColors(configuration) { services = { ...services, ...configuration }; }

export async function openCharacterColors() {
  if (!game.user?.isGM) throw new Error(t("Colors.GMOnly"));
  app ??= new CharacterColors();
  await app.render({ force: true });
  return app;
}

/** Saved colors changed elsewhere: reload the window unless it holds unsaved edits. */
export function refreshCharacterColors() {
  if (app?.rendered && !app._dirty && !app._saving) { app._draft = null; void app.render(); }
}

const api = () => game.modules.get(MODULE_ID)?.api;
const lineKey = value => value.trim().toLocaleLowerCase();

function element(tag, { className, key, params, text } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (key) setText(node, key, params);
  else if (text !== undefined) node.textContent = text;
  return node;
}

/** A color well plus its hex text; `onChange(hex)` gets "" when cleared. */
function colorInput(value, fallback, label, onChange) {
  const wrapper = element("span", { className: "mso-color-input" });
  const swatch = element("input"); swatch.type = "color"; swatch.value = value || fallback || "#ffffff";
  const text = element("input"); text.type = "text"; text.maxLength = 7; text.value = value ?? ""; text.placeholder = fallback || "#ffffff";
  setAttr(swatch, "aria-label", label); setAttr(text, "aria-label", label);
  swatch.addEventListener("input", () => { text.value = swatch.value; text.setCustomValidity(""); onChange(swatch.value); });
  text.addEventListener("input", () => {
    const hex = text.value.trim();
    if (!hex) { text.setCustomValidity(""); swatch.value = fallback || "#ffffff"; onChange(""); return; }
    if (!HEX.test(hex)) { text.setCustomValidity(t("Colors.HexHint")); return; }
    text.setCustomValidity(""); swatch.value = hex.toLowerCase(); onChange(hex.toLowerCase());
  });
  wrapper.append(swatch, text);
  return wrapper;
}

export class CharacterColors extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "modular-stream-overlay-character-colors", classes: ["mso-editor", "mso-character-colors"],
    window: { title: "modular-stream-overlay.Colors.Title", icon: "fa-solid fa-palette", resizable: true },
    position: { width: 760, height: 760 }
  };

  constructor(options = {}) {
    super(options);
    this._draft = null;
    this._dirty = false;
    this._saving = false;
  }

  get title() { return t("Colors.Title"); }
  _canRender(options) { return game.user?.isGM ? super._canRender(options) : false; }

  /** Saved settings, the world's characters and, for each, the chosen field's value and the system color. */
  async _load() {
    const data = services.characterData ?? api()?.characterData;
    this._draft ??= { rules: structuredClone(api().getAccentRules()), profiles: structuredClone(api().getCharacterProfiles()) };
    const sources = data.accentFields();
    const field = this._draft.rules.field || sources.suggestedKeyField;
    const fields = data.fieldDefinitions().filter(entry => entry.type === "string" && entry.status === "available" && entry.providerId !== "profile")
      .sort((left, right) => fieldLabel(left).localeCompare(fieldLabel(right)));
    let actors = [];
    try { actors = data.listActors(); } catch { /* No viewer account: characters cannot be read yet. */ }
    const characters = await Promise.all(actors.map(async actor => {
      const wanted = [field, sources.colorField].filter(Boolean);
      let values = {};
      try { values = wanted.length ? (await data.resolve(actor.uuid, wanted)).values ?? {} : {}; } catch { /* Shown without a value. */ }
      return { uuid: actor.uuid, name: actor.name, value: typeof values[field] === "string" ? values[field] : "",
        systemColor: HEX.test(values[sources.colorField] ?? "") ? values[sources.colorField] : "" };
    }));
    // One row per value; a character listing two names (two blasphemies) appears under both.
    const groups = new Map();
    const group = value => {
      const id = lineKey(value);
      if (!groups.has(id)) groups.set(id, { value: value.trim(), names: [], systemColor: "" });
      return groups.get(id);
    };
    for (const character of characters) character.value.split(/\r?\n/).filter(line => line.trim()).forEach((line, index) => {
      const entry = group(line);
      entry.names.push(character.name);
      // The system's color belongs to the first listed value.
      if (index === 0 && character.systemColor) entry.systemColor ||= character.systemColor;
    });
    for (const value of Object.keys(this._draft.rules.colors)) group(value);
    return { field, sources, fields, characters, values: [...groups.values()].sort((left, right) => left.value.localeCompare(right.value)) };
  }

  async _renderHTML() {
    const state = await this._load();
    // Character swatches follow value colors as they change, before saving.
    this._painters = [];
    const root = element("div", { className: "mso-colors-content" });
    root.append(element("p", { className: "mso-help", key: "Colors.Help" }));
    root.append(this._valuesSection(state), this._charactersSection(state));
    const footer = element("div", { className: "mso-voice-footer" });
    const save = element("button", { key: "Colors.Save" });
    save.type = "button"; save.dataset.colorsSave = ""; save.disabled = this._saving;
    save.addEventListener("click", () => { void this._save(); });
    footer.append(save);
    root.append(footer);
    return root;
  }

  _replaceHTML(result, content) { content.replaceChildren(result); }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const title = this.element?.querySelector(".window-title");
    if (title) setText(title, "Colors.Title");
  }

  _onClose(options) { this._draft = null; this._dirty = false; super._onClose(options); }

  _change() { this._dirty = true; }

  _valuesSection({ field, sources, fields, values }) {
    const section = element("section", { className: "mso-voice-section" });
    section.append(element("h3", { key: "Colors.ValuesHeading" }));
    const label = element("label", { className: "mso-layer-field" });
    const select = element("select"); select.dataset.colorsField = "";
    setAttr(select, "aria-label", "Colors.Field");
    const suggested = fields.find(entry => entry.id === sources.suggestedKeyField);
    const first = element("option", suggested ? { key: "Colors.SystemField", params: { field: fieldLabel(suggested) } } : { key: "Colors.NoField" });
    first.value = ""; select.append(first);
    for (const entry of fields) { const option = element("option", { text: fieldLabel(entry) }); option.value = entry.id; select.append(option); }
    select.value = this._draft.rules.field;
    select.addEventListener("change", () => {
      this._draft.rules.field = select.value;
      this._change();
      void this.render();
    });
    label.append(element("span", { key: "Colors.Field" }), select);
    section.append(label);
    if (!field) { section.append(element("p", { className: "mso-help", key: "Colors.ChooseField" })); return section; }
    for (const entry of values) {
      const row = element("div", { className: "mso-colors-row" });
      row.dataset.colorsValue = entry.value;
      const name = element("div", { className: "mso-colors-name" });
      name.append(element("strong", { text: entry.value }),
        element("span", entry.names.length ? { text: entry.names.join(", ") } : { key: "Colors.NoCharacters" }));
      const system = element("span", { className: "mso-colors-swatch" });
      system.style.background = entry.systemColor || "transparent";
      setAttr(system, "title", entry.systemColor ? "Colors.SystemColor" : "Colors.NoSystemColor", { color: entry.systemColor });
      const current = Object.entries(this._draft.rules.colors).find(([value]) => lineKey(value) === lineKey(entry.value))?.[1] ?? "";
      const input = colorInput(current, entry.systemColor, "Colors.ValueColor", hex => {
        for (const value of Object.keys(this._draft.rules.colors)) if (lineKey(value) === lineKey(entry.value)) delete this._draft.rules.colors[value];
        if (hex) this._draft.rules.colors[entry.value] = hex;
        this._change();
        for (const paint of this._painters) paint();
      });
      row.append(name, system, input);
      section.append(row);
    }
    // A value no character has yet, typed by hand.
    const add = element("div", { className: "mso-colors-add" });
    const text = element("input"); text.type = "text"; text.maxLength = 200; setAttr(text, "placeholder", "Colors.NewValue"); setAttr(text, "aria-label", "Colors.NewValue");
    const button = element("button", { key: "Colors.AddValue" }); button.type = "button";
    button.addEventListener("click", () => {
      const value = text.value.trim();
      if (!value || ruleColor(this._draft.rules, value)) return;
      this._draft.rules.colors[value] = "#9966ff";
      this._change();
      void this.render();
    });
    add.append(text, button);
    section.append(add, element("p", { className: "mso-help", key: "Colors.ValuesHelp" }));
    return section;
  }

  _charactersSection({ characters }) {
    const section = element("section", { className: "mso-voice-section" });
    section.append(element("h3", { key: "Colors.CharactersHeading" }));
    if (!characters.length) { section.append(element("p", { className: "mso-help", key: "Colors.NoViewer" })); return section; }
    for (const character of characters) {
      const row = element("div", { className: "mso-colors-row" });
      row.dataset.colorsActor = character.uuid;
      const effective = () => this._draft.profiles[character.uuid]?.accent || ruleColor(this._draft.rules, character.value) || character.systemColor || "";
      const name = element("div", { className: "mso-colors-name" });
      name.append(element("strong", { text: character.name }), element("span", { text: character.value.split(/\r?\n/).join(", ") }));
      const swatch = element("span", { className: "mso-colors-swatch" });
      const paint = () => { swatch.style.background = effective() || "transparent"; };
      paint();
      this._painters.push(paint);
      setAttr(swatch, "title", "Colors.Effective");
      const input = colorInput(this._draft.profiles[character.uuid]?.accent ?? "", ruleColor(this._draft.rules, character.value) || character.systemColor, "Colors.CharacterColor", hex => {
        const profile = { ...(this._draft.profiles[character.uuid] ?? {}) };
        if (hex) profile.accent = hex; else delete profile.accent;
        if (Object.keys(profile).length) this._draft.profiles[character.uuid] = profile; else delete this._draft.profiles[character.uuid];
        this._change();
        paint();
      });
      row.append(name, swatch, input);
      section.append(row);
    }
    section.append(element("p", { className: "mso-help", key: "Colors.CharactersHelp" }));
    return section;
  }

  async _save() {
    if (this._saving) return;
    let rules, profiles;
    try {
      rules = validateAccentRules(this._draft.rules);
      profiles = validateCharacterProfiles(this._draft.profiles);
    } catch (error) { ui.notifications.error(errorText(error)); return; }
    this._saving = true;
    try {
      await api().setAccentRules(rules);
      await api().setCharacterProfiles(profiles);
      this._draft = null; this._dirty = false;
      ui.notifications.info(t("Colors.Saved"));
    } catch (error) { ui.notifications.error(errorText(error)); }
    finally { this._saving = false; if (this.rendered) void this.render(); }
  }
}
