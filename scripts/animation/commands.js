import { validateState } from "../core/schema.js";
import { isViewerAllowed } from "../integration/obs.js";
import { validateAnimationConfig } from "./schema.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const KINDS = new Set(["play", "manual", "reset", "event", "carousel", "entrance", "exit", "demo"]);
const OPTIONS = new Set(["kind", "animation", "ruleId", "eventType", "action", "pageId", "actorUuid"]);
const COMMAND_KEYS = new Set(["id", "overlayId", "layerId", "createdAt", "expiresAt", ...OPTIONS]);
const ANIMATION_KEYS = new Set(["type", "duration", "delay", "easing", "direction", "intensity", "repeat", "color"]);

function strictObject(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).some(key => !allowed.has(key))) throw new TypeError(`${label} contains unsupported data.`);
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}

function commandOptions(input = { kind: "play" }) {
  strictObject(input, OPTIONS, "Animation command");
  const kind = input.kind ?? "play";
  if (!KINDS.has(kind)) throw new TypeError("Choose a supported animation command.");
  const result = { kind };
  if (input.animation !== undefined) {
    if (kind !== "play") throw new TypeError("An animation is only valid for a play command.");
    strictObject(input.animation, ANIMATION_KEYS, "Animation");
    result.animation = validateAnimationConfig(input.animation);
  }
  if (input.ruleId !== undefined) {
    if (kind !== "manual") throw new TypeError("A rule ID is only valid for a manual trigger.");
    result.ruleId = identifier(input.ruleId, "Trigger rule ID");
  }
  if (input.eventType !== undefined) {
    if (kind !== "event") throw new TypeError("An event type is only valid for an event command.");
    result.eventType = identifier(input.eventType, "Trigger event type");
  }
  if (kind === "event" && !result.eventType) throw new TypeError("Choose a named trigger event.");
  if (kind === "demo") {
    if (!["damage", "healing"].includes(input.action)) throw new TypeError("Choose a supported DEMO DATA action.");
    result.action = input.action;
  } else if (input.action !== undefined || kind === "carousel") {
    if (kind !== "carousel" || !["select", "select-actor", "next", "previous", "next-page", "previous-page", "next-actor", "previous-actor", "pause", "resume", "reset"].includes(input.action)) throw new TypeError("Choose a supported page command.");
    result.action = input.action;
  }
  if (input.pageId !== undefined) {
    if (kind !== "carousel" || result.action !== "select") throw new TypeError("A page ID is only valid for a page selection.");
    result.pageId = identifier(input.pageId, "Page ID");
  }
  if (kind === "carousel" && result.action === "select" && !result.pageId) throw new TypeError("Choose an information page.");
  if (input.actorUuid !== undefined) {
    if (kind !== "carousel" || !["select", "select-actor"].includes(result.action)
      || typeof input.actorUuid !== "string" || !/^(?:Actor\.[A-Za-z0-9_-]{1,64}|Demo\.(?:warrior|mage))$/.test(input.actorUuid)) throw new TypeError("Choose an assigned character for this carousel command.");
    result.actorUuid = input.actorUuid;
  }
  if (kind === "carousel" && result.action === "select-actor" && !result.actorUuid) throw new TypeError("Choose an assigned character.");
  return result;
}

/**
 * Validate ephemeral GM controls independently of their delivery transport.
 * There is no durable command history, retry queue, or Actor payload.
 */
export class AnimationCommands {
  constructor({ getState, getUser = () => globalThis.game?.user, getViewer = () => null, getRenderer = () => null,
    isReceiver = () => false, send, now = () => Date.now(), createId = () => globalThis.crypto.randomUUID() } = {}) {
    if (typeof getState !== "function") throw new TypeError("Animation commands require a saved-state reader.");
    this.getState = getState;
    this.getUser = getUser;
    this.getViewer = getViewer;
    this.getRenderer = getRenderer;
    this.isReceiver = isReceiver;
    this.send = send;
    this.now = now;
    this.createId = createId;
    this.eventIds = new Set();
  }

  _target(overlayId, layerId) {
    const state = validateState(this.getState());
    if (!state.activeOverlayId || overlayId !== state.activeOverlayId) throw new Error("The animation target is not on the current live overlay.");
    const overlay = state.overlays.find(entry => entry.id === state.activeOverlayId);
    if (!overlay || ![...overlay.layers, ...overlay.widgets].some(entry => entry.id === layerId)) {
      throw new Error("The animation target is missing from the current live overlay.");
    }
    return overlay;
  }

  _source(overlay, layerId, options) {
    const layer = overlay.layers.find(entry => entry.id === layerId);
    if ((options.kind === "demo" || options.actorUuid?.startsWith("Demo."))
      && (layer?.type !== "character-widget" || layer.dataSource !== "demo")) {
      throw new Error("Simulated character actions require a widget in DEMO DATA mode. Real Actors are never changed.");
    }
  }

  async publish(layerId, input = { kind: "play" }) {
    if (!this.getUser()?.isGM) throw new Error("Only a Game Master can control stream animations.");
    identifier(layerId, "Animation target ID");
    const options = commandOptions(input);
    const state = validateState(this.getState());
    this._source(this._target(state.activeOverlayId, layerId), layerId, options);
    const viewer = this.getViewer();
    if (!isViewerAllowed(viewer, viewer?.id)) throw new Error("Configure a Player overlay viewer account before using live animation controls.");
    if (!viewer.active) throw new Error("The overlay viewer is offline. Open or reconnect the OBS browser source, then try again.");
    if (typeof this.send !== "function") throw new Error("The live overlay command transport is unavailable.");
    const createdAt = this.now();
    if (!Number.isSafeInteger(createdAt)) throw new Error("The animation command clock is unavailable.");
    const command = { id: identifier(this.createId(), "Animation event ID"), overlayId: state.activeOverlayId,
      layerId, createdAt, expiresAt: createdAt + 10000, ...options };
    let result;
    try { result = await this.send(command); }
    catch (error) { throw new Error(`The overlay viewer did not accept the animation command: ${error?.message ?? "connection unavailable"}`); }
    if (result?.accepted !== true) throw new Error(`The overlay viewer did not accept the animation command: ${result?.reason ?? "no acknowledgement"}`);
    return result;
  }

  /** `user` must come from Foundry's authenticated transport, never command data. */
  async receive(input, { user } = {}) {
    const reject = reason => ({ accepted: false, reason });
    if (!user?.isGM) return reject("Only an authenticated Game Master can control stream animations.");
    const viewer = this.getViewer();
    if (!this.isReceiver() || !isViewerAllowed(viewer, viewer?.id) || !isViewerAllowed(this.getUser(), viewer.id)) {
      return reject("This client is not the configured overlay receiver.");
    }
    let command;
    try {
      strictObject(input, COMMAND_KEYS, "Animation command");
      if (!Object.hasOwn(input, "kind")) throw new TypeError("An animation command requires a kind.");
      const options = commandOptions(Object.fromEntries([...OPTIONS].filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]])));
      command = { id: identifier(input.id, "Animation event ID"), overlayId: identifier(input.overlayId, "Overlay ID"),
        layerId: identifier(input.layerId, "Animation target ID"), createdAt: input.createdAt, expiresAt: input.expiresAt, ...options };
      const currentTime = this.now();
      if (!Number.isSafeInteger(currentTime) || !Number.isSafeInteger(command.createdAt) || !Number.isSafeInteger(command.expiresAt)
        || command.createdAt > currentTime + 2000 || command.expiresAt <= currentTime
        || command.expiresAt <= command.createdAt || command.expiresAt - command.createdAt > 15000) {
        return reject("The animation command expired or has an invalid timestamp.");
      }
      this._source(this._target(command.overlayId, command.layerId), command.layerId, command);
    } catch (error) { return reject(error.message); }
    if (this.eventIds.has(command.id)) return reject("The animation command was already received.");
    const renderer = this.getRenderer();
    if (typeof renderer?.handleAnimationCommand !== "function") return reject("The overlay renderer is not ready.");
    // Reserve the ID before invoking a possibly asynchronous renderer to prevent concurrent duplicates.
    this.eventIds.add(command.id);
    if (this.eventIds.size > 256) this.eventIds.delete(this.eventIds.values().next().value);
    try {
      const result = await renderer.handleAnimationCommand(command);
      if (result === false) return reject("The live animation target is unavailable.");
      return { accepted: true };
    } catch (error) { return reject(`The animation command could not play: ${error?.message ?? "renderer unavailable"}`); }
  }
}
