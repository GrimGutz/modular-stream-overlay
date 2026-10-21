import { isViewerAllowed } from "../integration/obs.js";

export const SOCKET_NAME = "module.modular-stream-overlay";

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const COMMAND_KEYS = new Set(["id", "overlayId", "layerId", "createdAt", "expiresAt", "kind", "animation", "ruleId", "eventType", "action", "pageId", "actorUuid"]);
const ANIMATION_KEYS = new Set(["type", "duration", "delay", "easing", "direction", "intensity", "repeat", "color"]);
const OPEN_SOURCE = "Open or refresh the configured OBS overlay source, then try again. If you just updated the module, restart Foundry first.";
const MAX_PENDING = 64;
const MAX_SEEN = 256;
const MAX_IN_FLIGHT = 16;

function plain(value, keys) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Object.keys(value).every(key => keys.has(key)));
}

function identifier(value) { return typeof value === "string" && ID.test(value); }

/** Copy only bounded, declarative command metadata. No Actor documents or values travel here. */
function copyCommand(value) {
  if (!plain(value, COMMAND_KEYS) || !identifier(value.id) || !identifier(value.overlayId) || !identifier(value.layerId)
    || !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.expiresAt)
    || !["play", "manual", "reset", "event", "carousel", "entrance", "exit", "demo"].includes(value.kind)) throw new TypeError("The stream command contains unsupported metadata.");
  for (const [key, entry] of Object.entries(value)) {
    if (key === "animation") {
      if (!plain(entry, ANIMATION_KEYS)) throw new TypeError("The stream animation contains unsupported metadata.");
      for (const item of Object.values(entry)) {
        if (!((typeof item === "string" && item.length <= 160) || (typeof item === "number" && Number.isFinite(item)))) {
          throw new TypeError("The stream animation contains unsupported metadata.");
        }
      }
    } else if (!["createdAt", "expiresAt"].includes(key) && (typeof entry !== "string" || entry.length > 160)) {
      throw new TypeError("The stream command contains unsupported metadata.");
    }
  }
  return { ...value, ...(value.animation ? { animation: { ...value.animation } } : {}) };
}

function resultReason(value, fallback) {
  return typeof value === "string" && value.trim() ? value.slice(0, 300) : fallback;
}

/**
 * Native /stream accepts module socket events but does not listen for incoming User.query.
 * Foundry's module socket server supplies the authenticated sender as the second listener
 * argument. Never trust an identity claimed in a payload, and never accept a missing sender.
 */
export class StreamCommandTransport {
  constructor({ getUser = () => globalThis.game?.user, getViewer = () => null,
    getUserById = id => globalThis.game?.users?.get(id), isReceiver = () => false, receive,
    socket, now = () => Date.now(), setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timer => clearTimeout(timer), timeout = 6000 } = {}) {
    if (typeof receive !== "function") throw new TypeError("The stream transport requires a command receiver.");
    this.getUser = getUser;
    this.getViewer = getViewer;
    this.getUserById = getUserById;
    this.isReceiver = isReceiver;
    this.receive = receive;
    this.socket = socket;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timeout = Math.max(50, Math.min(15000, Number.isFinite(timeout) ? timeout : 6000));
    this.pending = new Map();
    this.seen = new Set();
    this.inFlight = new Set();
    this.started = false;
    this.epoch = 0;
    this._onMessage = (payload, senderId) => { void this._message(payload, senderId); };
    this._onDisconnect = () => this._cancel("The Foundry connection disconnected. Reconnect and refresh the OBS source, then try again.");
    this._onShutdown = () => this.stop("The Foundry world shut down. Reopen the world and refresh the OBS source, then try again.");
  }

  start(socket = this.socket ?? globalThis.game?.socket) {
    if (this.started) return true;
    if (!socket || typeof socket.on !== "function" || typeof socket.emit !== "function") return false;
    this.socket = socket;
    this.started = true;
    socket.on(SOCKET_NAME, this._onMessage);
    socket.on("disconnect", this._onDisconnect);
    socket.on("shutdown", this._onShutdown);
    return true;
  }

  stop(reason = "The stream controls were closed. Refresh the Foundry game and OBS source, then try again.") {
    this.started = false;
    this.socket?.off?.(SOCKET_NAME, this._onMessage);
    this.socket?.off?.("disconnect", this._onDisconnect);
    this.socket?.off?.("shutdown", this._onShutdown);
    this._cancel(reason);
  }

  _cancel(reason) {
    this.epoch++;
    for (const entry of this.pending.values()) {
      this.clearTimer(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
    this.inFlight.clear();
    this.seen.clear();
  }

  send(input) {
    const user = this.getUser(), viewer = this.getViewer();
    if (!user?.isGM) return Promise.reject(new Error("Only a Game Master can control stream animations."));
    if (!isViewerAllowed(viewer, viewer?.id)) return Promise.reject(new Error("Configure an overlay viewer account before using live animation controls."));
    if (!viewer.active) return Promise.reject(new Error(`The overlay viewer is offline. ${OPEN_SOURCE}`));
    if (!this.started || this.socket?.connected === false) return Promise.reject(new Error(`The Foundry stream connection is unavailable. ${OPEN_SOURCE}`));
    let command;
    try { command = copyCommand(input); } catch (error) { return Promise.reject(error); }
    const currentTime = this.now();
    if (!Number.isSafeInteger(currentTime) || command.expiresAt <= currentTime || command.createdAt > currentTime + 2000
      || command.expiresAt <= command.createdAt || command.expiresAt - command.createdAt > 15000) {
      return Promise.reject(new Error("The stream command expired or has an invalid timestamp."));
    }
    if (this.pending.has(command.id)) return Promise.reject(new Error("This stream command is already pending."));
    if (this.pending.size >= MAX_PENDING) return Promise.reject(new Error("Too many stream controls are waiting for OBS. Wait for the source to reconnect, then try again."));
    return new Promise((resolve, reject) => {
      const entry = { command, gmId: user.id, viewerId: viewer.id, resolve, reject, deadline: Math.min(currentTime + this.timeout, command.expiresAt), negative: null };
      entry.timer = this.setTimer(() => {
        this.pending.delete(command.id);
        if (entry.negative) resolve(entry.negative);
        else reject(new Error(`The overlay source did not acknowledge the command. ${OPEN_SOURCE}`));
      }, entry.deadline - currentTime);
      this.pending.set(command.id, entry);
      try { this.socket.emit(SOCKET_NAME, { type: "command", viewerId: viewer.id, command }, { recipients: [viewer.id] }); }
      catch (error) {
        this.clearTimer(entry.timer);
        this.pending.delete(command.id);
        reject(new Error(`The stream command could not be sent: ${resultReason(error?.message, "connection unavailable")}`));
      }
    });
  }

  _ack(input, senderId) {
    const user = this.getUser(), viewer = this.getViewer();
    if (!user?.isGM || !isViewerAllowed(viewer, viewer?.id) || senderId !== viewer.id
      || !isViewerAllowed(this.getUserById(senderId), viewer.id)
      || !plain(input, new Set(["type", "gmId", "id", "accepted", "reason"]))
      || input.gmId !== user.id || !identifier(input.id) || typeof input.accepted !== "boolean"
      || (input.reason !== undefined && (typeof input.reason !== "string" || input.reason.length > 300))) return;
    const entry = this.pending.get(input.id);
    if (!entry || entry.viewerId !== senderId || entry.gmId !== user.id || entry.deadline <= this.now()) return;
    const result = input.accepted ? { accepted: true } : { accepted: false, reason: resultReason(input.reason, "The overlay receiver could not accept the command.") };
    if (result.accepted) {
      this.clearTimer(entry.timer);
      this.pending.delete(input.id);
      entry.resolve(result);
    } else entry.negative = result;
  }

  async _message(payload, senderId) {
    if (!this.started || this.socket?.connected === false || !identifier(senderId)) return;
    if (payload?.type === "ack") { this._ack(payload, senderId); return; }
    const localUser = this.getUser(), viewer = this.getViewer();
    if (!this.isReceiver() || !isViewerAllowed(viewer, viewer?.id) || !isViewerAllowed(localUser, viewer.id)
      || !plain(payload, new Set(["type", "viewerId", "command"])) || payload.type !== "command" || payload.viewerId !== viewer.id) return;
    const gm = this.getUserById(senderId);
    if (!gm?.isGM || gm.id !== senderId) return;
    let command;
    try { command = copyCommand(payload.command); } catch { return; }
    const currentTime = this.now();
    if (!Number.isSafeInteger(currentTime) || command.expiresAt <= currentTime || command.createdAt > currentTime + 2000
      || command.expiresAt <= command.createdAt || command.expiresAt - command.createdAt > 15000) return;
    const eventId = `${senderId}:${command.id}`;
    if (this.seen.has(eventId) || this.inFlight.has(eventId) || this.inFlight.size >= MAX_IN_FLIGHT) return;
    this.seen.add(eventId);
    if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value);
    this.inFlight.add(eventId);
    const epoch = this.epoch;
    const active = () => this.started && epoch === this.epoch && this.socket?.connected !== false && this.isReceiver()
      && isViewerAllowed(this.getUser(), this.getViewer()?.id) && this.getViewer()?.id === payload.viewerId;
    try {
      let outcome;
      try { outcome = await this.receive(command, { user: gm }); }
      catch (error) { outcome = { accepted: false, reason: resultReason(error?.message, "The overlay renderer is unavailable.") }; }
      if (!active()) return;
      const ack = { type: "ack", gmId: senderId, id: command.id, accepted: outcome?.accepted === true };
      if (!ack.accepted) ack.reason = resultReason(outcome?.reason, "The overlay receiver could not accept the command.");
      this.socket.emit(SOCKET_NAME, ack, { recipients: [senderId] });
    } catch { /* Connection changes never create a retry or durable command queue. */ }
    finally { this.inFlight.delete(eventId); }
  }
}
