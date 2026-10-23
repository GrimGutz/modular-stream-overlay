/**
 * Who is speaking, for layers that react to Discord voice. The OBS connector reads the Discord
 * app on the streaming PC and serves its state at VOICE_PATH; the stream page follows it and
 * forwards it to GMs for the editor's live preview. Nothing here talks to Discord directly.
 */
import { CONNECTOR_HEADER } from "./obs.js";
import { EMPTY_VOICE_STATE, validateVoiceRoster, validateVoiceState } from "../core/voice.js";

/** Served by the connector only; Foundry itself has no such route. */
export const VOICE_PATH = "/mso-connector/voice";
/** design: no voice rules apply; present / speaking: everyone counts as in the channel / speaking; live: Discord. */
export const VOICE_PREVIEW_MODES = Object.freeze(["design", "present", "speaking", "live"]);
const MAX_SLOT = 20;

export class VoiceHub {
  constructor({ roster = {}, mode = "live" } = {}) {
    this.roster = validateVoiceRoster(roster);
    this.state = EMPTY_VOICE_STATE;
    this.mode = VOICE_PREVIEW_MODES.includes(mode) ? mode : "live";
    this.listeners = new Set();
    this.claims = new Map();
    this.scheduled = false;
  }

  setState(state) { this.state = validateVoiceState(state); this.#notify(); }
  setRoster(roster) {
    try { this.roster = validateVoiceRoster(roster ?? {}); }
    catch (error) { console.warn("Modular Stream Overlay | Discord player list ignored", error); this.roster = validateVoiceRoster({}); }
    this.#notify();
  }
  setMode(mode) {
    if (!VOICE_PREVIEW_MODES.includes(mode)) throw new TypeError("Choose a supported voice preview.");
    this.mode = mode;
    this.#notify();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Layers bound to a Discord user keep that person out of the free slots. */
  claim(userId) {
    if (!userId) return () => {};
    this.claims.set(userId, (this.claims.get(userId) ?? 0) + 1);
    this.#notify();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.claims.get(userId) ?? 1) - 1;
      if (count > 0) this.claims.set(userId, count); else this.claims.delete(userId);
      this.#notify();
    };
  }

  /** People in the channel no layer names: not listed, not ignored, not bots, in Discord's order. */
  freeMembers() {
    const known = new Set([...this.roster.speakers, ...this.roster.ignored].map(entry => entry.userId));
    return this.state.members.filter(member => !member.bot && !known.has(member.id) && !this.claims.has(member.id));
  }

  userFor(layer, actorUuid = "") {
    if (layer.voiceTarget === "user") return layer.voiceUser ?? "";
    if (layer.voiceTarget === "actor") return actorUuid ? this.roster.speakers.find(entry => entry.actorUuid === actorUuid)?.userId ?? "" : "";
    if (layer.voiceTarget === "slot") return this.freeMembers()[Math.min(MAX_SLOT, Math.max(1, layer.voiceSlot ?? 1)) - 1]?.id ?? "";
    return "";
  }

  /**
   * What a voice layer shows now: whose voice, its glow color (the layer's, else the player's,
   * else the character's accent, else white) and whether that person is present or speaking.
   */
  resolve(layer, actorUuid = "", { accent = "" } = {}) {
    const userId = this.userFor(layer, actorUuid);
    const speaker = userId ? this.roster.speakers.find(entry => entry.userId === userId) : null;
    const color = layer.voiceColor || speaker?.color || (/^#[\da-f]{3,8}$/i.test(accent) ? accent : "") || "#ffffff";
    if (this.mode === "design") return { userId, color, present: true, speaking: false, ignoreShow: true };
    if (this.mode !== "live") return { userId, color, present: true, speaking: this.mode === "speaking", ignoreShow: false };
    const member = userId ? this.state.members.find(entry => entry.id === userId) : null;
    return { userId, color, present: Boolean(member), speaking: Boolean(member?.speaking), ignoreShow: false };
  }

  // Many layers claim at once while a scene mounts; one pass after them is enough.
  #notify() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      for (const listener of [...this.listeners]) {
        try { listener(); } catch (error) { console.error("Modular Stream Overlay | Voice update failed", error); }
      }
    });
  }
}

/**
 * Follow the connector's voice feed: the stream page through the connector serving it, a GM's
 * editor at the connector's address on this PC. A server without the feed (Foundry itself, or a
 * connector without Discord voice) ends it after one probe. An unreachable connector is tried
 * again later, with growing pauses; with `waitForConnector: false` only once it has answered
 * before, otherwise `onGiveUp` is called. While the feed is away nobody counts as present.
 */
export function connectVoice({ hub, url = VOICE_PATH, fetch = globalThis.fetch, EventSourceClass = globalThis.EventSource, onState, onGiveUp,
  retryAfter = 5000, maxRetry = 60000, waitForConnector = true,
  setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = timer => clearTimeout(timer) } = {}) {
  let source = null, stopped = false, timer = null, delay = retryAfter, reached = false;
  // Browsers return a number; under Node a pending probe must not keep the process alive.
  const schedule = (callback, wait) => { const handle = setTimer(callback, wait); handle?.unref?.(); return handle; };
  const apply = state => { hub.setState(state); onState?.(hub.state); };
  const giveUp = () => { stopped = true; onGiveUp?.(); };
  const later = () => {
    if (stopped) return;
    if (!reached && !waitForConnector) return giveUp();
    timer = schedule(() => { timer = null; void probe(); }, delay);
    delay = Math.min(maxRetry, delay * 2);
  };
  const probe = async () => {
    let response;
    try { response = await fetch(url, { method: "HEAD", cache: "no-store" }); }
    catch { return later(); }
    if (stopped) return;
    if (!response.ok || response.headers.get(CONNECTOR_HEADER) !== "1" || typeof EventSourceClass !== "function") return giveUp();
    reached = true;
    delay = retryAfter;
    source = new EventSourceClass(url);
    source.onmessage = event => {
      let state;
      try { state = JSON.parse(event.data); } catch { return; }
      apply(state);
    };
    // The connector stopped or restarted: probe again rather than letting EventSource retry every few seconds.
    source.onerror = () => {
      source?.close();
      source = null;
      if (hub.state.connected || hub.state.channel) apply(EMPTY_VOICE_STATE);
      later();
    };
  };
  void probe();
  return () => {
    stopped = true;
    if (timer) clearTimer(timer);
    source?.close();
  };
}
