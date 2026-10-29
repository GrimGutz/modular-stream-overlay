import { MODULE_ID, SCHEMA_VERSION, createOverlay, validateOverlay } from "./core/schema.js";
import { OverlayStore, registerSettings } from "./core/store.js";
import { WidgetRegistry, AdapterRegistry } from "./core/registry.js";
import { genericAdapter } from "./adapters/generic.js";
import { cainAdapter } from "./adapters/cain.js";
import { dnd5eAdapter } from "./adapters/dnd5e.js";
import { loadCainTranslations } from "./adapters/cain-translations.js";
import { loadFoundryFonts } from "./integration/fonts.js";
import { WidgetPresetStore, registerWidgetSettings } from "./core/widget-presets.js";
import { CharacterDataService, validateAdapterPreferences } from "./data/character-data.js";
import { validateMappings } from "./data/mappings.js";
import { validateCharacterProfiles } from "./data/profiles.js";
import { ACCENT_RULES_SETTING, validateAccentRules } from "./data/accent-rules.js";
import { CharacterColors, configureCharacterColors, openCharacterColors, refreshCharacterColors } from "./ui/character-colors.js";
import { OverlayRenderer } from "./render/renderer.js";
import { OverlayEditor, configureEditor, refreshEditors, refreshFragmentLists } from "./ui/editor.js";
import { WidgetPresetManager, configureWidgetEditor, openWidgetManager, openWidgetPreset, refreshWidgetEditors } from "./ui/widget-editor.js";
import { isOverlayRequest, overlayURL, isViewerAllowed, viewerAccessMessage, watchForConnector } from "./integration/obs.js";
import { defaultAnimationRegistry } from "./animation/playback.js";
import { registerTriggerEvent } from "./animation/triggers.js";
import { AnimationCommands } from "./animation/commands.js";
import { SOCKET_NAME, StreamCommandTransport } from "./animation/transport.js";
import { VOICE_PATH, VoiceHub, connectVoice } from "./integration/voice.js";
import { VOICE_ROSTER_SETTING } from "./core/voice.js";
import { configureVoiceRoster, openVoiceRoster } from "./ui/voice-roster.js";
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
// Discord voice: the stream follows the OBS connector; GM editors preview it or mirror the stream.
let streamVoice = null;
let stopVoice = null;
let stopEditorVoice = null;
const editorVoice = new VoiceHub({ mode: "design" });
const DEFAULT_CONNECTOR = "http://localhost:30001";
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

function readVoiceRoster() {
  try { return game.settings.get(MODULE_ID, VOICE_ROSTER_SETTING) ?? {}; } catch { return {}; }
}

function voiceRosterChanged(roster) {
  editorVoice.setRoster(roster);
  streamVoice?.setRoster(roster);
}

/** Voice state from the stream page reaches GMs (for the editor), at most a few times a second. */
function sendVoice(state, recipients = game.users?.filter(user => user.isGM && user.active).map(user => user.id) ?? []) {
  if (!recipients.length || game.socket?.connected === false) return;
  try { game.socket.emit(SOCKET_NAME, { type: "voice", state }, { recipients }); } catch { /* The editor preview is optional. */ }
}
let voiceTimer = null, voicePending = null;
function forwardVoice(state) {
  voicePending = state;
  voiceTimer ??= setTimeout(() => { voiceTimer = null; sendVoice(voicePending); }, 150);
}
/**
 * A GM on the streaming PC reads voice straight from the OBS connector, so the editor shows it
 * even while OBS is closed. An unreachable connector is asked again on the next request.
 */
function connectEditorVoice() {
  if (stopEditorVoice || broadcast || !game.user?.isGM) return;
  let url;
  try { url = new URL(VOICE_PATH, game.settings.get(MODULE_ID, "connectorUrl") || DEFAULT_CONNECTOR).href; } catch { url = new URL(VOICE_PATH, DEFAULT_CONNECTOR).href; }
  stopEditorVoice = connectVoice({ hub: editorVoice, url, retryAfter: 15000, maxRetry: 300000, waitForConnector: false,
    onGiveUp: () => { stopEditorVoice = null; } });
}
function requestVoice() {
  connectEditorVoice();
  const viewerId = getViewerUserId();
  if (!game.user?.isGM || !viewerId || !game.users?.get(viewerId)?.active) return;
  try { game.socket.emit(SOCKET_NAME, { type: "voice-request" }, { recipients: [viewerId] }); } catch { /* Offline. */ }
}
/** Only the configured viewer may report voice, and only GMs may ask for it. */
function onVoiceMessage(payload, senderId) {
  if (!payload || typeof payload !== "object" || typeof senderId !== "string") return;
  if (payload.type === "voice" && game.user?.isGM) {
    const viewerId = getViewerUserId();
    if (senderId === viewerId && isViewerAllowed(game.users?.get(senderId), viewerId)) editorVoice.setState(payload.state);
  } else if (payload.type === "voice-request" && streamVoice && game.users?.get(senderId)?.isGM) sendVoice(streamVoice.state, [senderId]);
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
  // Editor aids per browser: rulers with guides (kept per overlay or design ID) and a grid step.
  game.settings.register(MODULE_ID, "canvasRulers", { scope: "client", config: false, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "canvasGrid", { scope: "client", config: false, type: Number, default: 0 });
  game.settings.register(MODULE_ID, "canvasGuides", { scope: "client", config: false, type: Object, default: {} });
  // Saved layer fragments, shared by every GM of the world.
  game.settings.register(MODULE_ID, "layerFragments", { scope: "world", config: false, restricted: true, type: Array, default: [], onChange: () => refreshFragmentLists() });
  // Discord players (ID, name, character, glow color) and ignored accounts, shared by every GM.
  game.settings.register(MODULE_ID, VOICE_ROSTER_SETTING, { scope: "world", config: false, restricted: true, type: Object,
    default: { speakers: [], ignored: [] }, onChange: voiceRosterChanged });
  game.settings.register(MODULE_ID, "connectorUrl", localizeSetting({ scope: "client", config: true, type: String, default: DEFAULT_CONNECTOR,
    onChange: () => { stopEditorVoice?.(); stopEditorVoice = null; connectEditorVoice(); } },
    { name: "Settings.connectorUrl.Name", hint: "Settings.connectorUrl.Hint" }));
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
    restricted: true, default: {}, onChange: () => { mappingsChanged(); refreshCharacterColors(); }
  });
  // Character colors by the value of one field (a CAIN blasphemy, a D&D class), for every widget.
  game.settings.register(MODULE_ID, ACCENT_RULES_SETTING, {
    name: "Character color rules", scope: "world", config: false, type: Object,
    restricted: true, default: { field: "", colors: {} }, onChange: () => { mappingsChanged(); refreshCharacterColors(); }
  });
  store = new OverlayStore();
  widgetPresets = new WidgetPresetStore();
  characterData = new CharacterDataService({ adapters, getUser: getPresentationUser,
    getSystemVersion: () => game.system?.version ?? "",
    getAdapterPreferences: () => game.settings.get(MODULE_ID, "adapterPreferences") ?? {},
    getMappings: () => game.settings.get(MODULE_ID, "fieldMappings") ?? [],
    getProfiles: () => game.settings.get(MODULE_ID, "characterProfiles") ?? {},
    getAccentRules: () => game.settings.get(MODULE_ID, ACCENT_RULES_SETTING) ?? {} });
  animationCommands = new AnimationCommands({ getState: () => store.getState(), getUser: () => game.user,
    getViewer: () => game.users?.get(getViewerUserId()), getRenderer: () => renderer,
    send: command => commandTransport.send(command), now: serverNow,
    isReceiver: () => broadcast && streamReady && status !== "disconnected" && status !== "shutdown" && isViewerAllowed(game.user, getViewerUserId()) });
  commandTransport = new StreamCommandTransport({ socket: game.socket, getUser: () => game.user, now: serverNow,
    getViewer: () => game.users?.get(getViewerUserId()), getUserById: id => game.users?.get(id),
    isReceiver: () => broadcast && streamReady && status !== "disconnected" && status !== "shutdown",
    receive: (command, context) => animationCommands.receive(command, context) });
  commandTransport.start();
  game.socket?.on?.(SOCKET_NAME, onVoiceMessage);
  editorVoice.setRoster(readVoiceRoster());
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
    voice: editorVoice, openVoiceRoster, requestVoice,
    context: { mode: "preview", widgetPresets, characterData, voice: editorVoice, ...animationContext } };
  configureVoiceRoster({ voice: editorVoice, characterData, requestVoice });
  configureCharacterColors({ characterData });
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
  game.settings.registerMenu(MODULE_ID, "characterColors", localizeSetting({
    icon: "fa-solid fa-palette", type: CharacterColors, restricted: true
  }, { name: "Settings.Colors.Name", label: "Settings.Colors.Label", hint: "Settings.Colors.Hint" }));
  game.settings.registerMenu(MODULE_ID, "liveControls", localizeSetting({
    icon: "fa-solid fa-play", type: LiveControls, restricted: true
  }, { name: "Settings.Live.Name", label: "Settings.Live.Label", hint: "Settings.Live.Hint" }));
  const api = Object.freeze({
    version: "0.7.0", schemaVersion: SCHEMA_VERSION, store, widgets, adapters, widgetPresets, characterData,
    localization: Object.freeze({ t, getLanguage, getPreference: getLanguagePreference, setPreference: setLanguagePreference }),
    createOverlay, validateOverlay,
    registerWidget: definition => widgets.register(definition),
    registerAdapter: definition => { const adapter = adapters.register(definition); mappingsChanged(); return adapter; },
    openWidgetManager, openWidgetPreset, openVoiceRoster, openCharacterColors,
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
    getAccentRules: () => validateAccentRules(game.settings.get(MODULE_ID, ACCENT_RULES_SETTING) ?? {}),
    async setAccentRules(value) {
      if (!game.user?.isGM) throw Error("Only a GM can configure character colors.");
      return game.settings.set(MODULE_ID, ACCENT_RULES_SETTING, validateAccentRules(value));
    },
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
  requestVoice();
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
  streamVoice = new VoiceHub({ roster: readVoiceRoster(), mode: "live" });
  renderer = new OverlayRenderer(output, { widgets, context: { viewerUserId: game.userId, widgetPresets, characterData, voice: streamVoice, ...animationContext } });
  // Behind the OBS connector with Discord voice set up, voice layers follow who is speaking.
  stopVoice = connectVoice({ hub: streamVoice, onState: forwardVoice });
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
  // cain-ru translates CAIN catalog names, and Foundry loads its font files, only in the game
  // view; load both before the first frame.
  void Promise.all([
    loadCainTranslations().catch(error => console.warn("Modular Stream Overlay | CAIN translations unavailable", error)),
    loadFoundryFonts().catch(error => console.warn("Modular Stream Overlay | Fonts unavailable", error))
  ]).finally(() => { characterData.refresh(); void refreshOutput(); });
});

Hooks.on("updateUser", user => {
  if (broadcast && user.id === game.userId) void refreshOutput();
});
Hooks.on("deleteUser", user => {
  if (broadcast && user.id === game.userId) { outputSignature = null; void renderer?.render(null); }
});

window.addEventListener("pagehide", () => {
  stopVoice?.(); stopEditorVoice?.(); game.socket?.off?.(SOCKET_NAME, onVoiceMessage); renderer?.destroy(); characterData?.stop(); reducedMotion?.removeEventListener?.("change", refreshAnimationPreferences);
  commandTransport?.stop();
});
