/**
 * Player streams. The GM only chooses which players may stream from their own account. Such a
 * player opens the overlay editor from their Settings sidebar and runs their stream themselves:
 * their own studio, live controls, the account their OBS signs in with and the OBS connector on
 * their PC. This window shows what each one has on stream, through which account, and which of its
 * characters that account cannot observe.
 */
import { t, setText, setAttr, errorText } from "./i18n.js";
import { validateState } from "../core/schema.js";
import { STUDIO_SETTINGS, overlayActorUuids, validateStreamers } from "../core/streamers.js";

const MODULE_ID = "modular-stream-overlay";
const { ApplicationV2 } = foundry.applications.api;
let managerApp = null;

const api = () => game.modules.get(MODULE_ID)?.api;

function element(tag, { className, key, params, text } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (key) setText(node, key, params);
  else if (text !== undefined) node.textContent = text;
  return node;
}

/** World characters an overlay shows that this account cannot observe. */
function hiddenCharacters(overlay, user) {
  return overlayActorUuids(overlay).map(uuid => game.actors?.get(uuid.slice(6)) ?? null)
    .filter(actor => !actor?.testUserPermission?.(user, "OBSERVER"));
}

/** A player's studio as saved under their account; null before they save anything. */
function studioState(user) {
  try {
    const value = game.settings.storage?.get("world")?.getSetting?.(`${MODULE_ID}.${STUDIO_SETTINGS.state}`, user.id)?.value;
    return value ? validateState(value) : null;
  } catch { return null; }
}

/** The stream address with a copy button; it is the same for every account. */
function addressRow() {
  const url = api().getOBSUrl();
  const row = element("label", { className: "mso-field" });
  row.append(element("span", { key: "Streams.Address" }));
  const line = element("div", { className: "mso-input-row" });
  const input = element("input"); input.type = "text"; input.readOnly = true; input.value = url;
  setAttr(input, "aria-label", "Streams.Address");
  const copy = element("button", { key: "Streams.Copy" }); copy.type = "button";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(url); ui.notifications.info(t("Streams.Copied")); }
    catch { input.select(); }
  });
  line.append(input, copy);
  row.append(line);
  return row;
}

export async function openPlayerStreams() {
  if (!game.user?.isGM) throw new Error(t("Streams.GMOnly"));
  managerApp ??= new PlayerStreams();
  await managerApp.render({ force: true });
  return managerApp;
}

/** The list or the users changed elsewhere: reload the open window, keeping the GM's unsaved choices. */
export function refreshPlayerStreams() {
  if (managerApp?.rendered && !managerApp._dirty && !managerApp._saving) { managerApp._draft = null; void managerApp.render(); }
}

export class PlayerStreams extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "modular-stream-overlay-player-streams", classes: ["mso-editor", "mso-player-streams"],
    window: { title: "modular-stream-overlay.Streams.Title", icon: "fa-solid fa-tower-broadcast", resizable: true },
    position: { width: 720, height: 620 }
  };

  constructor(options = {}) {
    super(options);
    this._draft = null;
    this._dirty = false;
    this._saving = false;
  }

  get title() { return t("Streams.Title"); }
  _canRender(options) { return game.user?.isGM ? super._canRender(options) : false; }

  async _renderHTML() {
    this._draft ??= new Set(api().getStreamers());
    const viewerId = api().getViewerUserId();
    const viewer = game.users?.get(viewerId);
    const root = element("div", { className: "mso-colors-content" });
    root.append(element("p", { className: "mso-help", key: "Streams.Help" }));
    root.append(element("p", { className: "mso-help", ...viewer ? { key: "Streams.MainViewer", params: { name: viewer.name } } : { key: "Streams.NoMainViewer" } }));
    const section = element("section", { className: "mso-voice-section" });
    // GMs and Assistant GMs already edit the world library; the viewer account shows the main stream.
    const players = [...game.users].filter(user => !user.isGM && user.id !== viewerId).sort((left, right) => left.name.localeCompare(right.name));
    // Free accounts a studio's stream signs in with, by the player whose stream they carry.
    this._carried = new Map(api().getStreamers().map(id => [api().getStudioAccountFor?.(id) ?? id, id]).filter(([account, id]) => account !== id));
    if (!players.length) section.append(element("p", { className: "mso-help", key: "Streams.NoPlayers" }));
    for (const user of players) section.append(this._row(user));
    root.append(section, addressRow(), element("p", { className: "mso-help", key: "Streams.AddressHelp" }));
    const footer = element("div", { className: "mso-voice-footer" });
    const save = element("button", { key: "Streams.Save" });
    save.type = "button"; save.dataset.streamsSave = ""; save.disabled = this._saving;
    save.addEventListener("click", () => { void this._save(); });
    footer.append(save);
    root.append(footer);
    return root;
  }

  _replaceHTML(result, content) { content.replaceChildren(result); }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const title = this.element?.querySelector(".window-title");
    if (title) setText(title, "Streams.Title");
  }

  _onClose(options) { this._draft = null; this._dirty = false; super._onClose(options); }

  _row(user) {
    const row = element("div", { className: "mso-streams-row" });
    row.dataset.streamUser = user.id;
    const name = element("div", { className: "mso-colors-name" });
    name.append(element("strong", { text: user.name }), element("span", { key: user.active ? "Streams.Online" : "Streams.Offline" }));
    const toggle = element("label", { className: "mso-checkbox-field" });
    const box = element("input"); box.type = "checkbox"; box.checked = this._draft.has(user.id); box.dataset.streamAllowed = "";
    toggle.append(box, element("span", { key: "Streams.MayStream" }));
    const status = element("p", { className: "mso-help mso-streams-status" });
    const describe = () => {
      status.replaceChildren();
      const carried = game.users?.get(this._carried?.get(user.id));
      if (!this._draft.has(user.id)) {
        if (carried) status.append(element("span", { key: "Streams.CarriesStudio", params: { name: carried.name } }));
        return;
      }
      const state = studioState(user);
      const account = game.users?.get(api().getStudioAccountFor?.(user.id)) ?? user;
      if (account.id !== user.id) status.append(element("span", { key: "Streams.StudioAccount", params: { name: account.name } }), " ");
      const overlay = state?.overlays.find(entry => entry.id === state.activeOverlayId);
      const summary = element("span", { key: !state?.overlays.length ? "Streams.StudioEmpty"
        : overlay ? "Streams.StudioLive" : "Streams.StudioIdle", params: { count: state?.overlays.length ?? 0, name: overlay?.name ?? "" } });
      status.append(summary);
      if (!overlay) return;
      const hidden = hiddenCharacters(overlay, account);
      const access = !overlayActorUuids(overlay).length ? { key: "Streams.NoCharacters" }
        : hidden.length ? { key: "Streams.Hidden", params: { names: hidden.map(actor => actor?.name ?? t("Streams.UnknownCharacter")).join(", ") } }
          : { key: "Streams.AllVisible" };
      status.append(" ", element("span", access));
    };
    box.addEventListener("change", () => {
      if (box.checked) this._draft.add(user.id);
      else this._draft.delete(user.id);
      this._dirty = true;
      describe();
    });
    describe();
    row.append(name, toggle, status);
    return row;
  }

  async _save() {
    if (this._saving) return;
    let value;
    try { value = validateStreamers([...this._draft]); } catch (error) { ui.notifications.error(errorText(error)); return; }
    this._saving = true;
    try {
      await api().setStreamers(value);
      this._draft = null; this._dirty = false;
      ui.notifications.info(t("Streams.Saved"));
    } catch (error) { ui.notifications.error(errorText(error)); }
    finally { this._saving = false; if (this.rendered) void this.render(); }
  }
}
