/**
 * Discord players for voice layers: each player's Discord ID, a name, the character they play
 * and a glow color, plus accounts to ignore such as music bots. Who is in the voice channel
 * right now comes from the stream page, so an ID can be added with one click.
 */
import { t, setText, setAttr, errorText } from "./i18n.js";
import { VOICE_ROSTER_LIMIT, VOICE_ROSTER_SETTING, validateVoiceRoster } from "../core/voice.js";

const MODULE_ID = "modular-stream-overlay";
const { ApplicationV2 } = foundry.applications.api;
let services = {};
let app = null;

export function configureVoiceRoster(configuration) { services = { ...services, ...configuration }; }

export async function openVoiceRoster() {
  if (!game.user?.isGM) throw new Error(t("Voice.GMOnly"));
  app ??= new VoiceRosterEditor();
  await app.render({ force: true });
  return app;
}

function savedRoster() {
  try { return validateVoiceRoster(game.settings.get(MODULE_ID, VOICE_ROSTER_SETTING) ?? {}); }
  catch { return validateVoiceRoster({}); }
}

function element(tag, { className, key, params, text } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (key) setText(node, key, params);
  else if (text !== undefined) node.textContent = text;
  return node;
}

export class VoiceRosterEditor extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "modular-stream-overlay-voice-roster", classes: ["mso-editor", "mso-voice-roster"],
    window: { title: "modular-stream-overlay.Voice.Title", icon: "fa-brands fa-discord", resizable: true },
    position: { width: 720, height: 680 }
  };

  constructor(options = {}) {
    super(options);
    this._draft = null;
    this._saving = false;
    this._unsubscribe = null;
  }

  get title() { return t("Voice.Title"); }
  _canRender(options) { return game.user?.isGM ? super._canRender(options) : false; }

  async _renderHTML() {
    this._draft ??= structuredClone(savedRoster());
    const root = element("div", { className: "mso-voice-content" });
    root.append(element("p", { className: "mso-help", key: "Voice.Help" }));
    const live = element("section", { className: "mso-voice-section" });
    const members = element("div", { className: "mso-voice-members" });
    members.dataset.voiceLive = "";
    live.append(element("h3", { key: "Voice.LiveHeading" }), members);
    root.append(live, this._playersSection(), this._ignoredSection());
    const footer = element("div", { className: "mso-voice-footer" });
    const save = element("button", { key: "Voice.Save" });
    save.type = "button"; save.dataset.voiceSave = ""; save.disabled = this._saving;
    save.addEventListener("click", () => { void this._save(); });
    footer.append(save);
    root.append(footer);
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    this._renderLive();
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const title = this.element?.querySelector(".window-title");
    if (title) setText(title, "Voice.Title");
    this._unsubscribe ??= services.voice?.subscribe(() => this._renderLive()) ?? null;
    services.requestVoice?.();
  }

  _onClose(options) {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._draft = null;
    super._onClose(options);
  }

  _actors() {
    let actors = [];
    try { actors = services.characterData?.listActors?.() ?? []; } catch { /* No characters to offer. */ }
    return actors.map(actor => ({ uuid: actor.uuid, name: actor.name }));
  }

  _textInput(entry, field, key, { maxLength = 80, placeholder } = {}) {
    const label = element("label", { className: "mso-layer-field" });
    const caption = element("span", { key });
    const input = element("input");
    input.type = "text"; input.maxLength = maxLength; input.value = entry[field] ?? "";
    input.dataset.voiceField = field;
    setAttr(input, "aria-label", key);
    if (placeholder) input.placeholder = placeholder;
    input.addEventListener("input", () => { entry[field] = input.value.trim(); });
    label.append(caption, input);
    return label;
  }

  _removeButton(list, entry) {
    const button = element("button", { className: "mso-icon-button" });
    button.type = "button";
    setAttr(button, "title", "Voice.Remove"); setAttr(button, "aria-label", "Voice.Remove");
    button.append(Object.assign(document.createElement("i"), { className: "fa-solid fa-trash" }));
    button.addEventListener("click", () => {
      list.splice(list.indexOf(entry), 1);
      void this.render();
    });
    return button;
  }

  _playersSection() {
    const section = element("section", { className: "mso-voice-section" });
    section.append(element("h3", { key: "Voice.PlayersHeading" }));
    const actors = this._actors();
    for (const entry of this._draft.speakers) {
      const row = element("div", { className: "mso-voice-row mso-voice-player" });
      row.dataset.voiceUser = entry.userId;
      row.append(this._textInput(entry, "name", "Voice.Name"), this._textInput(entry, "userId", "Voice.DiscordId", { maxLength: 25 }));
      const characterLabel = element("label", { className: "mso-layer-field" });
      const character = element("select");
      setAttr(character, "aria-label", "Voice.Character");
      character.dataset.voiceField = "actorUuid";
      const none = element("option", { key: "Voice.NoCharacter" }); none.value = "";
      character.append(none);
      const choices = entry.actorUuid && !actors.some(actor => actor.uuid === entry.actorUuid) ? [...actors, { uuid: entry.actorUuid, name: entry.actorUuid }] : actors;
      for (const actor of choices) { const option = element("option", { text: actor.name }); option.value = actor.uuid; character.append(option); }
      character.value = entry.actorUuid ?? "";
      character.addEventListener("change", () => { entry.actorUuid = character.value; });
      characterLabel.append(element("span", { key: "Voice.Character" }), character);
      row.append(characterLabel, this._textInput(entry, "color", "Voice.Color", { maxLength: 7, placeholder: "#ffffff" }), this._removeButton(this._draft.speakers, entry));
      section.append(row);
    }
    const add = element("button", { key: "Voice.AddPlayer" });
    add.type = "button"; add.dataset.voiceAdd = "speaker";
    add.disabled = this._draft.speakers.length >= VOICE_ROSTER_LIMIT;
    add.addEventListener("click", () => { this._draft.speakers.push({ userId: "", name: "", actorUuid: "", color: "" }); void this.render(); });
    section.append(add, element("p", { className: "mso-help", key: "Voice.PlayersHelp" }));
    return section;
  }

  _ignoredSection() {
    const section = element("section", { className: "mso-voice-section" });
    section.append(element("h3", { key: "Voice.IgnoredHeading" }));
    for (const entry of this._draft.ignored) {
      const row = element("div", { className: "mso-voice-row mso-voice-ignored" });
      row.dataset.voiceUser = entry.userId;
      row.append(this._textInput(entry, "name", "Voice.Name"), this._textInput(entry, "userId", "Voice.DiscordId", { maxLength: 25 }), this._removeButton(this._draft.ignored, entry));
      section.append(row);
    }
    const add = element("button", { key: "Voice.AddIgnored" });
    add.type = "button"; add.dataset.voiceAdd = "ignored";
    add.disabled = this._draft.ignored.length >= VOICE_ROSTER_LIMIT;
    add.addEventListener("click", () => { this._draft.ignored.push({ userId: "", name: "" }); void this.render(); });
    section.append(add, element("p", { className: "mso-help", key: "Voice.IgnoredHelp" }));
    return section;
  }

  /** The channel as the stream page reports it; unknown people get Add and Ignore buttons. */
  _renderLive() {
    const host = this.element?.querySelector("[data-voice-live]");
    if (!host || !this._draft) return;
    const state = services.voice?.state;
    host.replaceChildren();
    if (!state?.connected) { host.append(element("p", { className: "mso-help", key: "Voice.LiveUnavailable" })); return; }
    if (!state.channel) { host.append(element("p", { className: "mso-help", key: "Voice.NotInChannel" })); return; }
    host.append(element("p", { className: "mso-voice-channel", key: "Voice.Channel", params: { name: state.channel.name } }));
    for (const member of state.members) {
      const row = element("div", { className: `mso-voice-member${member.speaking ? " speaking" : ""}` });
      row.dataset.voiceMember = member.id;
      row.append(element("span", { className: "mso-voice-dot" }), element("strong", { text: member.name }), element("code", { text: member.id }));
      if (member.bot) row.append(element("span", { className: "mso-voice-badge", key: "Voice.Bot" }));
      const player = this._draft.speakers.find(entry => entry.userId === member.id);
      const ignored = this._draft.ignored.some(entry => entry.userId === member.id);
      if (player || ignored) row.append(element("span", { className: "mso-voice-badge", key: player ? "Voice.IsPlayer" : "Voice.IsIgnored" }));
      else {
        for (const [key, list, entry] of [["Voice.AddAsPlayer", this._draft.speakers, { userId: member.id, name: member.name, actorUuid: "", color: "" }],
          ["Voice.Ignore", this._draft.ignored, { userId: member.id, name: member.name }]]) {
          const button = element("button", { key });
          button.type = "button"; button.dataset.voiceMemberAction = key === "Voice.Ignore" ? "ignore" : "player";
          button.disabled = list.length >= VOICE_ROSTER_LIMIT;
          button.addEventListener("click", () => { list.push(entry); void this.render(); });
          row.append(button);
        }
      }
      host.append(row);
    }
  }

  async _save() {
    if (this._saving) return;
    // Rows left completely empty are dropped instead of failing.
    const filled = entry => entry.userId || entry.name || entry.actorUuid || entry.color;
    let roster;
    try { roster = validateVoiceRoster({ speakers: this._draft.speakers.filter(filled), ignored: this._draft.ignored.filter(filled) }); }
    catch (error) { ui.notifications.error(errorText(error)); return; }
    this._saving = true;
    try {
      await game.settings.set(MODULE_ID, VOICE_ROSTER_SETTING, roster);
      this._draft = structuredClone(roster);
      ui.notifications.info(t("Voice.Saved"));
    } catch (error) { ui.notifications.error(errorText(error)); }
    finally { this._saving = false; if (this.rendered) void this.render(); }
  }
}
