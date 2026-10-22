import { MODULE_ID, SCHEMA_VERSION, createOverlay, validateOverlay } from "./core/schema.js";
import { OverlayStore, registerSettings } from "./core/store.js";
import { WidgetRegistry, AdapterRegistry } from "./core/registry.js";
import { genericAdapter } from "./adapters/generic.js";
import { cainAdapter } from "./adapters/cain.js";
import { dnd5eAdapter } from "./adapters/dnd5e.js";
import { WidgetPresetStore, registerWidgetSettings } from "./core/widget-presets.js";
import { CharacterDataService, validateAdapterPreferences } from "./data/character-data.js";
import { validateMappings } from "./data/mappings.js";
import { validateCharacterProfiles } from "./data/profiles.js";
import { OverlayRenderer } from "./render/renderer.js";
import { OverlayEditor, configureEditor, refreshEditors } from "./ui/editor.js";
import { WidgetPresetManager, configureWidgetEditor, openWidgetManager, openWidgetPreset, refreshWidgetEditors } from "./ui/widget-editor.js";
import { isOverlayRequest, overlayURL, isViewerAllowed, viewerAccessMessage, watchForConnector } from "./integration/obs.js";
import { defaultAnimationRegistry } from "./animation/playback.js";
import { registerTriggerEvent } from "./animation/triggers.js";
import { AnimationCommands } from "./animation/commands.js";
import { StreamCommandTransport } from "./animation/transport.js";
import { effectiveWidgetMotion, refreshAnimationPreferences, registerAnimationAction } from "./render/motion.js";
import { configureLiveControls, openLiveControls, refreshLiveControls, LiveControls } from "./ui/live-controls.js";
import { resolveCarouselSettings } from "./carousel/schema.js";
import { installDemo } from "./demo/install.js";
import { installCainPresets } from "./demo/cain.js";
import { DEMO_CHARACTERS } from "./demo/data.js";
import { t, errorText, setText, localizeSetting, registerLocalization, refreshLanguage, localizeSettingsDOM,
  getLanguage, getLanguagePreference, setLanguagePreference } from "./ui/i18n.js";

const broadcast = isOverlayRequest(window.location);
// Set this before Foundry's stream chat renders. Join and normal game pages stay usable.
if (broadcast) document.documentElement.classList.add("mso-broadcast");

const widgets = new WidgetRegistry();
const adapters = new AdapterRegistry();
adapters.register(genericAdapter);
adapters.register(cainAdapter);
adapters.register(dnd5eAdapter);
let store;
let widgetPresets;
let characterData;
let animationCommands;
let commandTransport;
let editor;
let output;
let renderer;
let streamReady = false;
let status;
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
const animationContext = {
  animationRegistry: defaultAnimationRegistry,
  debug: () => game.settings.get(MODULE_ID, "debugAnimations") === true,
  onDiagnostic: event => { if (game.settings.get(MODULE_ID, "debugAnimations") === true) console.debug("Modular Stream Overlay | Animation diagnostics", event); },
  animationsEnabled: () => game.settings.get(MODULE_ID, "animationsEnabled") !== false,
  reducedMotion: () => game.settings.get(MODULE_ID, "respectReducedMotion") !== false && Boolean(reducedMotion?.matches)
};
reducedMotion?.addEventListener?.("change", refreshAnimationPreferences);
// Commands cross PCs (GM -> OBS); Foundry's server-synchronized clock avoids local drift.
function serverNow() {
  const time = game.time?.serverTime;
  return Number.isFinite(time) ? Math.round(time) : Date.now();
}

function notifyError(error) {
  console.error("Modular Stream Overlay |", error);
  if (game.user?.isGM) ui.notifications?.error(`Modular Stream Overlay: ${errorText(error)}`);
}

function getViewerUserId() { return game.settings.get(MODULE_ID, "viewerUserId"); }
function getPresentationUser() {
  const id = getViewerUserId();
  const viewer = game.users?.get(id);
  return isViewerAllowed(viewer, id) && (game.user?.isGM || game.user?.id === id) ? viewer : null;
}
function showMessage(message) {
  if (!output) return;
  output.querySelector(".mso-message")?.remove();
  if (!message) return;
  const element = document.createElement("div");
  element.className = "mso-message";
  element.textContent = message;
  output.append(element);
}

// Widget preset IDs reachable from the on-air overlay, including presets nested in presets.
function usedPresets(overlay) {
  const all = new Map((widgetPresets.list() ?? []).map(preset => [preset.id, preset]));
  const used = new Map(), pending = [overlay];
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) { pending.push(...value); continue; }
    if (!value || typeof value !== "object") continue;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "presetId" && typeof entry === "string" && all.has(entry) && !used.has(entry)) {
        used.set(entry, all.get(entry)); pending.push(all.get(entry));
      } else if (entry && typeof entry === "object") pending.push(entry);
    }
  }
  return [...used.keys()].sort().map(id => used.get(id));
}

let outputSignature = null;
async function refreshOutput({ skipUnchanged = false } = {}) {
  if (!broadcast || !streamReady || status === "disconnected" || status === "shutdown") return;
  try {
    const denied = viewerAccessMessage(game.user, getViewerUserId());
    const state = denied ? null : store.getState();
    const overlay = state?.overlays.find(item => item.id === state.activeOverlayId) ?? null;
    // Saves of other overlays or unused presets must not rebuild the stage, restart carousels or re-resolve Actors.
    const signature = JSON.stringify({ viewer: getViewerUserId(), denied, overlay, presets: overlay ? usedPresets(overlay) : [] });
    if (skipUnchanged && signature === outputSignature) return;
    outputSignature = signature;
    if (denied) {
      await renderer.render(null);
      showMessage(denied);
      return;
    }
    await renderer.render(overlay, { animateExit: true });
    // A null active selection is an intentional transparent scene, with no status text on air.
    showMessage("");
  } catch (error) {
    outputSignature = null;
    await renderer.render(null);
    showMessage("The saved overlay could not be loaded. Check the overlay editor in Foundry.");
    notifyError(error);
  }
}

function settingsChanged() {
  // Settings are updated by Foundry's authenticated database socket, including /stream.
  characterData?.refresh();
  void refreshEditors({ external: true }).catch(notifyError);
  void refreshWidgetEditors({ external: true }).catch(notifyError);
  void refreshOutput({ skipUnchanged: true });
  void refreshLiveControls().catch(notifyError);
}

function widgetSettingsChanged() {
  settingsChanged();
}

function mappingsChanged() {
  characterData?.refresh();
  void refreshEditors({ external: true }).catch(notifyError);
  void refreshWidgetEditors({ external: true }).catch(notifyError);
}

Hooks.once("init", () => {
  registerLocalization();
  registerSettings(settingsChanged);
  registerWidgetSettings(widgetSettingsChanged);
  // The capture PC's motion preference is not the audience's, so broadcasts animate by default.
  for (const [key, initial] of [["animationsEnabled", true], ["respectReducedMotion", false]]) game.settings.register(MODULE_ID, key,
    localizeSetting({ scope: "world", config: true, restricted: true,
      type: Boolean, default: initial, onChange: refreshAnimationPreferences },
    { name: `Settings.${key}.Name`, hint: `Settings.${key}.Hint` }));
  game.settings.register(MODULE_ID, "debugAnimations", localizeSetting({
    scope: "world", config: true, restricted: true, type: Boolean, default: false
  }, { name: "Settings.debugAnimations.Name", hint: "Settings.debugAnimations.Hint" }));
  game.settings.register(MODULE_ID, "canvasSnapping", { scope: "client", config: false, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "viewerUserId", {
    name: "Overlay viewer account", scope: "world", config: false, type: String,
    default: "", onChange: settingsChanged
  });
  game.settings.register(MODULE_ID, "fieldMappings", {
    name: "Character field mappings", scope: "world", config: false, type: Array,
    restricted: true, default: [], onChange: mappingsChanged
  });
  game.settings.register(MODULE_ID, "adapterPreferences", {
    name: "Character data providers", scope: "world", config: false, type: Object,
    restricted: true, default: {}, onChange: mappingsChanged
  });
  // Values reach widgets through the data service, so no stage rebuild is needed.
  game.settings.register(MODULE_ID, "characterProfiles", {
    name: "Character profiles", scope: "world", config: false, type: Object,
    restricted: true, default: {}, onChange: mappingsChanged
  });
  store = new OverlayStore();
  widgetPresets = new WidgetPresetStore();
  characterData = new CharacterDataService({ adapters, getUser: getPresentationUser,
    getSystemVersion: () => game.system?.version ?? "",
    getAdapterPreferences: () => game.settings.get(MODULE_ID, "adapterPreferences") ?? {},
    getMappings: () => game.settings.get(MODULE_ID, "fieldMappings") ?? [],
    getProfiles: () => game.settings.get(MODULE_ID, "characterProfiles") ?? {} });
  animationCommands = new AnimationCommands({ getState: () => store.getState(), getUser: () => game.user,
    getViewer: () => game.users?.get(getViewerUserId()), getRenderer: () => renderer,
    send: command => commandTransport.send(command), now: serverNow,
    isReceiver: () => broadcast && streamReady && status !== "disconnected" && status !== "shutdown" && isViewerAllowed(game.user, getViewerUserId()) });
  commandTransport = new StreamCommandTransport({ socket: game.socket, getUser: () => game.user, now: serverNow,
    getViewer: () => game.users?.get(getViewerUserId()), getUserById: id => game.users?.get(id),
    isReceiver: () => broadcast && streamReady && status !== "disconnected" && status !== "shutdown",
    receive: (command, context) => animationCommands.receive(command, context) });
  commandTransport.start();
  const liveControls = {
    getState() {
      const state = store.getState(), overlay = state.overlays.find(item => item.id === state.activeOverlayId);
      const names = new Map([...characterData.listActors(), ...DEMO_CHARACTERS].map(actor => [actor.uuid, actor.name]));
      return { overlays: state.overlays.map(({ id, name }) => ({ id, name })), activeOverlayId: state.activeOverlayId,
        layers: (overlay?.layers ?? []).map(layer => {
          const preset = layer.type === "character-widget" ? widgetPresets.list().find(preset => preset.id === layer.presetId) : null;
          const configuration = preset ? resolveCarouselSettings(layer, preset) : null;
          return { ...layer, ...(preset ? { ...effectiveWidgetMotion(layer, preset),
            pages: configuration.pages.map(({ id, name }) => ({ id, name })),
            hasCarousel: configuration.pages.length > 0 || configuration.actors.length !== 1 || configuration.settings.mode !== "information",
            hasCharacterChoice: configuration.actors.length > 1,
            characters: configuration.actors.map(uuid => ({ uuid, name: names.get(uuid) ?? t("Settings.UnavailableCharacter") })) } : {}) };
        }) };
    },
    setActive: id => store.setActive(id || null),
    async setVisibility(id, visible) {
      if (!game.user?.isGM) throw Error("Only a GM can control the live overlay.");
      if (typeof visible !== "boolean") throw Error("Choose show or hide.");
      const state = store.getState(), overlay = state.overlays.find(item => item.id === state.activeOverlayId);
      const layer = overlay?.layers.find(layer => layer.id === id);
      if (!layer) throw Error("This layer is no longer on the active overlay.");
      layer.visible = visible;
      return store.saveOverlay(overlay, { expectedRevision: state.revision });
    },
    play: (id, options = {}) => animationCommands.publish(id, { ...options, kind: options.ruleId ? "manual" : "play" }),
    carousel: (id, action, pageId, actorUuid) => animationCommands.publish(id, { kind: "carousel", action,
      ...(pageId === undefined ? {} : { pageId }), ...(actorUuid === undefined ? {} : { actorUuid }) }),
    reset: id => animationCommands.publish(id, { kind: "reset" }),
    testCommand: (id, command) => animationCommands.publish(id, command)
  };
  configureLiveControls({ liveControls });
  const installShowcase = ({ reset = false } = {}) => {
    if (!game.user?.isGM) throw Error("Only a GM can install the demonstration overlay.");
    return installDemo({ store, widgetPresets, characterData, reset });
  };
  const installCainExamples = () => {
    if (!game.user?.isGM) throw Error("Only a GM can install CAIN example presets.");
    return installCainPresets({ store, widgetPresets });
  };
  const getDebug = () => game.settings.get(MODULE_ID, "debugAnimations") === true;
  const setDebug = enabled => {
    if (!game.user?.isGM) throw Error("Only a GM can change animation diagnostics.");
    if (typeof enabled !== "boolean") throw Error("Choose whether diagnostics are enabled.");
    return game.settings.set(MODULE_ID, "debugAnimations", enabled);
  };
  const configuration = { store, widgets, widgetPresets, characterData, openWidgetManager, openWidgetPreset, openLiveControls,
    installDemo: installShowcase, publishTestCommand: liveControls.testCommand, getDebug, setDebug,
    context: { mode: "preview", widgetPresets, characterData, ...animationContext } };
  configureEditor(configuration);
  configureWidgetEditor(configuration);
  game.settings.registerMenu(MODULE_ID, "editor", localizeSetting({
    icon: "fa-solid fa-display",
    type: OverlayEditor, restricted: true
  }, { name: "Settings.Editor.Name", label: "Settings.Editor.Label", hint: "Settings.Editor.Hint" }));
  game.settings.registerMenu(MODULE_ID, "widgetPresets", localizeSetting({
    icon: "fa-solid fa-id-card",
    type: WidgetPresetManager, restricted: true
  }, { name: "Settings.Widgets.Name", label: "Settings.Widgets.Label", hint: "Settings.Widgets.Hint" }));
  game.settings.registerMenu(MODULE_ID, "liveControls", localizeSetting({
    icon: "fa-solid fa-play", type: LiveControls, restricted: true
  }, { name: "Settings.Live.Name", label: "Settings.Live.Label", hint: "Settings.Live.Hint" }));
  const api = Object.freeze({
    version: "0.6.0", schemaVersion: SCHEMA_VERSION, store, widgets, adapters, widgetPresets, characterData,
    localization: Object.freeze({ t, getLanguage, getPreference: getLanguagePreference, setPreference: setLanguagePreference }),
    createOverlay, validateOverlay,
    registerWidget: definition => widgets.register(definition),
    registerAdapter: definition => { const adapter = adapters.register(definition); mappingsChanged(); return adapter; },
    openWidgetManager, openWidgetPreset,
    openLiveControls, liveControls, installDemo: installShowcase, installCainPresets: installCainExamples,
    getDebug, setDebug,
    getDiagnostics: () => game.user?.isGM || isViewerAllowed(game.user, getViewerUserId()) ? renderer?.getDiagnostics() ?? [] : [],
    animations: Object.freeze({ registry: defaultAnimationRegistry, registerType: definition => defaultAnimationRegistry.register(definition),
      registerEvent: registerTriggerEvent, registerAction: registerAnimationAction,
      dispatch: (id, eventType) => animationCommands.publish(id, { kind: "event", eventType }) }),
    getFieldMappings: () => validateMappings(game.settings.get(MODULE_ID, "fieldMappings") ?? []),
    getAdapterPreferences: () => validateAdapterPreferences(game.settings.get(MODULE_ID, "adapterPreferences") ?? {}),
    async setAdapterPreferences(value) {
      if (!game.user?.isGM) throw Error("Only a GM can configure character data providers.");
      return game.settings.set(MODULE_ID, "adapterPreferences", validateAdapterPreferences(value));
    },
    async setFieldMappings(value) {
      if (!game.user?.isGM) throw Error("Only a GM can configure character fields.");
      return game.settings.set(MODULE_ID, "fieldMappings", validateMappings(value));
    },
    getCharacterProfiles: () => validateCharacterProfiles(game.settings.get(MODULE_ID, "characterProfiles") ?? {}),
    async setCharacterProfiles(value) {
      if (!game.user?.isGM) throw Error("Only a GM can configure character profiles.");
      return game.settings.set(MODULE_ID, "characterProfiles", validateCharacterProfiles(value));
    },
    getViewerUserId,
    async setViewerUserId(id) {
      if (!game.user?.isGM) throw Error("Only a GM can configure the overlay viewer.");
      if (id !== "" && !isViewerAllowed(game.users.get(id), id)) throw Error("Choose an existing user account.");
      return game.settings.set(MODULE_ID, "viewerUserId", id);
    },
    getOBSUrl: () => overlayURL({ origin: window.location.origin, getRoute: foundry.utils.getRoute }),
    getJoinUrl: () => new URL(foundry.utils.getRoute("join"), window.location.origin).href,
    openEditor() {
      if (!game.user?.isGM || game.view !== "game") throw Error("Open the overlay editor as a GM in the game view.");
      editor ??= new OverlayEditor();
      return editor.render({ force: true });
    }
  });
  game.modules.get(MODULE_ID).api = api;
  Hooks.callAll("modularStreamOverlayInit", api);
});

Hooks.once("ready", () => {
  characterData.start();
  if (!game.user?.isGM) return;
  try { store.getState(); }
  catch (error) { notifyError(error); }
});

Hooks.on("renderSettings", (_application, element) => {
  if (!game.user?.isGM) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root || root.querySelector("[data-mso-editor]")) return;
  const target = root.querySelector(".settings-sidebar") ?? root;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.msoEditor = "true";
  setText(button, "Settings.Editor.Label");
  button.addEventListener("click", () => { void game.modules.get(MODULE_ID).api.openEditor().catch(notifyError); });
  target.append(button);
});

Hooks.on("i18nInit", refreshLanguage);
Hooks.on("renderSettingsConfig", (_application, element) => localizeSettingsDOM(element instanceof HTMLElement ? element : element?.[0]));

Hooks.once("streamReady", () => {
  if (!broadcast) return;
  streamReady = true;
  characterData.start();
  output = document.createElement("main");
  output.id = "mso-output";
  document.body.append(output);
  renderer = new OverlayRenderer(output, { widgets, context: { viewerUserId: game.userId, widgetPresets, characterData, ...animationContext } });
  // Updates while reconnecting must not leave a stale scene on air.
  // Foundry's socket stops retrying after a few seconds; behind the OBS connector the page
  // reloads itself once Foundry is reachable again, so OBS needs no manual refresh.
  let stopRecovery = null;
  const recover = () => { stopRecovery ??= watchForConnector({ url: window.location.href, reload: () => window.location.reload() }); };
  game.socket.on("disconnect", () => {
    status = "disconnected";
    characterData.stop();
    outputSignature = null;
    void renderer.render(null);
    // Transparent while disconnected; never fall through to the built-in chat page.
    recover();
  });
  game.socket.on("connect", () => {
    if (status === "disconnected") window.location.reload(); // Re-fetch authoritative state after reconnect.
  });
  game.socket.on("shutdown", () => { status = "shutdown"; characterData.stop(); outputSignature = null; void renderer.render(null); recover(); });
  void refreshOutput();
});

Hooks.on("updateUser", user => {
  if (broadcast && user.id === game.userId) void refreshOutput();
});
Hooks.on("deleteUser", user => {
  if (broadcast && user.id === game.userId) { outputSignature = null; void renderer?.render(null); }
});

window.addEventListener("pagehide", () => {
  renderer?.destroy(); characterData?.stop(); reducedMotion?.removeEventListener?.("change", refreshAnimationPreferences);
  commandTransport?.stop();
});
