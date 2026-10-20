const MODULE_ID = "modular-stream-overlay";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
let services = {};
let panel;

export function configureLiveControls(configuration) { services = { ...services, ...configuration }; }
export async function openLiveControls() {
  if (!game.user?.isGM) throw new Error("Only a Game Master can control the live stream.");
  panel ??= new LiveControls();
  await panel.render({ force: true });
  return panel;
}
export async function refreshLiveControls() { if (panel?.rendered && !panel._busy) await panel.render({ force: true }); }

/** A compact control surface for saved, live overlays. Draft previews never call this API. */
export class LiveControls extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "modular-stream-overlay-live-controls", classes: ["mso-editor", "mso-live-controls"],
    window: { title: "Stream Live Controls", icon: "fa-solid fa-play", resizable: true },
    position: { width: 500, height: 600 }
  };
  static PARTS = { controls: { template: `modules/${MODULE_ID}/templates/live-controls.hbs` } };
  constructor(options = {}) { super(options); this._busy = false; }
  get controls() { return services.liveControls ?? game.modules.get(MODULE_ID)?.api?.liveControls; }
  _canRender(options) { return game.user?.isGM ? super._canRender(options) : false; }
  async _prepareContext(options) {
    if (!game.user?.isGM) throw new Error("Only a Game Master can control the live stream.");
    const state = await this.controls.getState();
    return {
      ...await super._prepareContext(options),
      overlays: state.overlays.map(overlay => ({ ...overlay, active: overlay.id === state.activeOverlayId })),
      layers: (state.layers ?? []).map(layer => ({ ...layer, rules: (layer.triggers ?? []).filter(rule => rule.enabled && rule.event === "manual") })),
      hasActive: !!state.activeOverlayId
    };
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelector("[data-live-overlay]")?.addEventListener("change", event => {
      void this._perform(() => this.controls.setActive(event.currentTarget.value || null));
    });
    for (const select of this.element.querySelectorAll("[data-live-page]")) select.addEventListener("change", event => {
      const id = event.currentTarget.value;
      if (id) void this._perform(() => this.controls.carousel(event.currentTarget.dataset.layerId, "select", id));
    });
    for (const select of this.element.querySelectorAll("[data-live-character]")) select.addEventListener("change", event => {
      const uuid = event.currentTarget.value;
      if (uuid) void this._perform(() => this.controls.carousel(event.currentTarget.dataset.layerId, "select-actor", undefined, uuid));
    });
    for (const button of this.element.querySelectorAll("[data-live-command]")) button.addEventListener("click", () => {
      void this._perform(() => this._command(button.dataset.liveCommand, button.dataset.layerId, button.dataset.ruleId));
    });
  }
  async _command(command, layerId, ruleId) {
    if (!game.user?.isGM) throw new Error("Only a Game Master can control the live stream.");
    if (command === "show" || command === "hide") return this.controls.setVisibility(layerId, command === "show");
    if (command === "play") return this.controls.play(layerId, ruleId ? { ruleId } : {});
    if (command === "reset") return this.controls.reset(layerId);
    if (["next", "previous", "pause", "resume", "reset-sequence"].includes(command)) return this.controls.carousel(layerId, command === "reset-sequence" ? "reset" : command);
    throw new Error("Choose an available live command.");
  }
  async _perform(operation) {
    if (this._busy) return;
    this._busy = true;
    this.element?.querySelectorAll("button, select").forEach(control => { control.disabled = true; });
    let failure;
    try {
      if (!game.user?.isGM) throw new Error("Only a Game Master can control the live stream.");
      await operation();
    }
    catch (error) { failure = error; }
    finally {
      this._busy = false;
      try { if (this.rendered) await this.render({ force: true }); }
      catch (error) { failure ??= error; }
    }
    if (failure) {
      console.error(`${MODULE_ID} | Live control failed`, failure);
      ui.notifications.error(failure.message || "The live stream could not be updated.");
    }
  }
}
