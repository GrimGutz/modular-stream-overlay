import { MODULE_ID, SCHEMA_VERSION, createOverlay, validateOverlay } from "./core/schema.js";
import { OverlayStore, registerSettings } from "./core/store.js";
import { WidgetRegistry, AdapterRegistry } from "./core/registry.js";
import { genericAdapter } from "./adapters/generic.js";
import { cainAdapter } from "./adapters/cain.js";
import { WidgetPresetStore, registerWidgetSettings } from "./core/widget-presets.js";
import { CharacterDataService } from "./data/character-data.js";
import { validateMappings } from "./data/mappings.js";
import { OverlayRenderer } from "./render/renderer.js";
import { OverlayEditor, configureEditor, refreshEditors } from "./ui/editor.js";
import { WidgetPresetManager, configureWidgetEditor, openWidgetManager, openWidgetPreset, refreshWidgetEditors } from "./ui/widget-editor.js";
import { isOverlayRequest, overlayURL, isViewerAllowed, viewerAccessMessage } from "./integration/obs.js";
import { defaultAnimationRegistry } from "./animation/playback.js";
import { registerTriggerEvent } from "./animation/triggers.js";
import { AnimationCommands } from "./animation/commands.js";
import { StreamCommandTransport } from "./animation/transport.js";
import { effectiveWidgetMotion, refreshAnimationPreferences, registerAnimationAction } from "./render/motion.js";
import { configureLiveControls, openLiveControls, refreshLiveControls, LiveControls } from "./ui/live-controls.js";
import { resolveCarouselSettings } from "./carousel/schema.js";
import { installDemo } from "./demo/install.js";
import { DEMO_CHARACTERS } from "./demo/data.js";

const broadcast = isOverlayRequest(window.location);
// Set this before Foundry's stream chat renders. Join and normal game pages stay usable.
if (broadcast) document.documentElement.classList.add("mso-broadcast");

const widgets = new WidgetRegistry();
const adapters = new AdapterRegistry();
adapters.register(genericAdapter);
adapters.register(cainAdapter);
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

function notifyError(error) {
  console.error("Modular Stream Overlay |", error);
  if (game.user?.isGM) ui.notifications?.error(`Modular Stream Overlay: ${error.message}`);
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

async function refreshOutput() {
  if (!broadcast || !streamReady || status === "disconnected" || status === "shutdown") return;
  try {
    const denied = viewerAccessMessage(game.user, getViewerUserId());
    if (denied) {
      await renderer.render(null);
      showMessage(denied);
      return;
    }
    const state = store.getState();
    const overlay = state.overlays.find(item => item.id === state.activeOverlayId) ?? null;
    await renderer.render(overlay, { animateExit: true });
    // A null active selection is an intentional transparent scene, with no status text on air.
    showMessage("");
  } catch (error) {
    await renderer.render(null);
    showMessage("The saved overlay could not be loaded. Check the overlay editor in Foundry.");
    notifyError(error);
  }
}

function settingsChanged() {
  // Settings are updated by Foundry's authenticated database socket, including /stream.
  void refreshEditors({ external: true }).catch(notifyError);
  void refreshWidgetEditors({ external: true }).catch(notifyError);
  void refreshOutput();
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
  registerSettings(settingsChanged);
  registerWidgetSettings(widgetSettingsChanged);
  for (const [key, name, hint] of [
    ["animationsEnabled", "Enable overlay animations", "Disable to finish value transitions immediately and stop temporary visual effects."],
    ["respectReducedMotion", "Respect reduced motion", "Suppress all overlay effects, including fades, Pulse and carousel transitions, when the output browser requests reduced motion. Turn this off to play your authored overlay animations; Windows and Foundry interface preferences remain unchanged."]
  ]) game.settings.register(MODULE_ID, key, { name, hint, scope: "world", config: true, restricted: true,
    type: Boolean, default: true, onChange: refreshAnimationPreferences });
  game.settings.register(MODULE_ID, "debugAnimations", {
    name: "Animation and carousel debug mode", hint: "Record actual playback, motion blockers, computed styles and interruption reasons; no Actor statistics are logged.",
    scope: "world", config: true, restricted: true, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, "viewerUserId", {
    name: "Overlay viewer account", scope: "world", config: false, type: String,
    default: "", onChange: settingsChanged
  });
  game.settings.register(MODULE_ID, "fieldMappings", {
    name: "Character field mappings", scope: "world", config: false, type: Array,
    restricted: true, default: [], onChange: mappingsChanged
  });
  store = new OverlayStore();
  widgetPresets = new WidgetPresetStore();
  characterData = new CharacterDataService({ adapters, getUser: getPresentationUser,
    getMappings: () => game.settings.get(MODULE_ID, "fieldMappings") ?? [] });
  animationCommands = new AnimationCommands({ getState: () => store.getState(), getUser: () => game.user,
    getViewer: () => game.users?.get(getViewerUserId()), getRenderer: () => renderer,
    send: command => commandTransport.send(command),
    isReceiver: () => broadcast && streamReady && status !== "disconnected" && status !== "shutdown" && isViewerAllowed(game.user, getViewerUserId()) });
  commandTransport = new StreamCommandTransport({ socket: game.socket, getUser: () => game.user,
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
            characters: configuration.actors.map(uuid => ({ uuid, name: names.get(uuid) ?? "Unavailable character" })) } : {}) };
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
  game.settings.registerMenu(MODULE_ID, "editor", {
    name: "Modular Stream Overlay", label: "Open Overlay Editor", icon: "fa-solid fa-display",
    hint: "Design overlays, add character widgets, and configure the OBS viewer.",
    type: OverlayEditor, restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "widgetPresets", {
    name: "Character Widget Presets", label: "Manage Character Widgets", icon: "fa-solid fa-id-card",
    hint: "Design reusable character cards, then assign different Actors to each overlay instance.",
    type: WidgetPresetManager, restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "liveControls", { name: "Live Overlay Controls", label: "Open Live Controls",
    icon: "fa-solid fa-play", hint: "Show, hide, and animate saved layers on the active stream overlay.", type: LiveControls, restricted: true });
  const api = Object.freeze({
    version: "0.5.5", schemaVersion: SCHEMA_VERSION, store, widgets, adapters, widgetPresets, characterData,
    createOverlay, validateOverlay,
    registerWidget: definition => widgets.register(definition),
    registerAdapter: definition => adapters.register(definition),
    openWidgetManager, openWidgetPreset,
    openLiveControls, liveControls, installDemo: installShowcase,
    getDebug, setDebug,
    getDiagnostics: () => game.user?.isGM || isViewerAllowed(game.user, getViewerUserId()) ? renderer?.getDiagnostics() ?? [] : [],
    animations: Object.freeze({ registry: defaultAnimationRegistry, registerType: definition => defaultAnimationRegistry.register(definition),
      registerEvent: registerTriggerEvent, registerAction: registerAnimationAction,
      dispatch: (id, eventType) => animationCommands.publish(id, { kind: "event", eventType }) }),
    getFieldMappings: () => validateMappings(game.settings.get(MODULE_ID, "fieldMappings") ?? []),
    async setFieldMappings(value) {
      if (!game.user?.isGM) throw Error("Only a GM can configure character fields.");
      return game.settings.set(MODULE_ID, "fieldMappings", validateMappings(value));
    },
    getViewerUserId,
    async setViewerUserId(id) {
      if (!game.user?.isGM) throw Error("Only a GM can configure the overlay viewer.");
      if (id !== "" && !isViewerAllowed(game.users.get(id), id)) throw Error("Choose a dedicated account with the Player role.");
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
  button.textContent = "Open Overlay Editor";
  button.addEventListener("click", () => { void game.modules.get(MODULE_ID).api.openEditor().catch(notifyError); });
  target.append(button);
});

Hooks.once("streamReady", () => {
  if (!broadcast) return;
  streamReady = true;
  characterData.start();
  output = document.createElement("main");
  output.id = "mso-output";
  document.body.append(output);
  renderer = new OverlayRenderer(output, { widgets, context: { viewerUserId: game.userId, widgetPresets, characterData, ...animationContext } });
  // Updates while reconnecting must not leave a stale scene on air.
  game.socket.on("disconnect", () => {
    status = "disconnected";
    characterData.stop();
    void renderer.render(null);
    // Transparent while disconnected; never fall through to the built-in chat page.
  });
  game.socket.on("connect", () => {
    if (status === "disconnected") window.location.reload(); // Re-fetch authoritative state after reconnect.
  });
  game.socket.on("shutdown", () => { status = "shutdown"; characterData.stop(); void renderer.render(null); });
  void refreshOutput();
});

Hooks.on("updateUser", user => {
  if (broadcast && user.id === game.userId) void refreshOutput();
});
Hooks.on("deleteUser", user => {
  if (broadcast && user.id === game.userId) void renderer?.render(null);
});

window.addEventListener("pagehide", () => {
  renderer?.destroy(); characterData?.stop(); reducedMotion?.removeEventListener?.("change", refreshAnimationPreferences);
  commandTransport?.stop();
});
