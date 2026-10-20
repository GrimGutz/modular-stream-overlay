import { genericAdapter, permittedActor, safePortrait } from "../adapters/generic.js";
import { FIELD_ID } from "./bindings.js";
import { validateMappings, readMappedField } from "./mappings.js";
import { validateActorUuid } from "../core/schema.js";
import { DemoDataSource, DEMO_FIELDS, isDemoReference } from "../demo/data.js";

const WORLD_ACTOR = /^Actor\.[A-Za-z0-9_-]{1,64}$/;

/** Deliberately excludes scene Token synthetic Actors, compendiums, and external URLs. */
export function actorReference(reference) {
  if (typeof reference !== "string" || reference.length > 512) throw new TypeError("Enter a world Actor UUID or an @UUID Actor document link.");
  const input = reference.trim();
  const uuid = input.match(/^@UUID\[(Actor\.[A-Za-z0-9_-]{1,64})\](?:\{[^\r\n{}]{0,200}\})?$/)?.[1] ?? input;
  if (!WORLD_ACTOR.test(uuid)) throw new TypeError("Choose a world Actor. Compendium and unlinked Token Actors are not supported yet.");
  return validateActorUuid(uuid);
}

function worldActor(document, uuid) {
  return document && (document.documentName ?? document.constructor?.documentName) === "Actor"
    && document.uuid === uuid && !document.isToken && !document.pack && !document.parent;
}

function safeScalar(value, type) {
  if (type === "number") return typeof value === "number" && Number.isFinite(value) ? value : null;
  if (type === "image") return safePortrait(value);
  return typeof value === "string" ? value.slice(0, 10000) : null;
}

/**
 * Resolves only selected normalized fields from the authenticated client's Actor collection.
 * A GM preview supplies the configured OBS viewer via getUser, never the GM's privileges.
 * Actor lifecycle events invalidate subscribed instances; no Actor data is sent in module sockets.
 */
export class CharacterDataService {
  constructor({ adapters, getUser = () => globalThis.game?.user, resolveUuid = uuid => globalThis.foundry?.utils?.fromUuid(uuid),
    getSystemId = () => globalThis.game?.system?.id, getMappings = () => [], getActors = () => globalThis.game?.actors,
    hooks = globalThis.Hooks, debounceMs = 40, demoData = new DemoDataSource(), onError = error => console.error("Modular Stream Overlay |", error) } = {}) {
    this.adapters = adapters;
    this.getUser = getUser;
    this.resolveUuid = resolveUuid;
    this.getSystemId = getSystemId;
    this.getMappings = getMappings;
    this.getActors = getActors;
    this.hooks = hooks;
    this.debounceMs = Math.max(0, Math.min(1000, Number(debounceMs) || 0));
    this.onError = onError;
    this.demoData = demoData;
    this.subscriptions = new Map();
    this.pending = new Set();
    this.hookIds = [];
    this.timer = null;
  }

  _adapters() {
    const definitions = this.adapters?.list?.() ?? [];
    const generic = definitions.find(adapter => adapter.id === "generic") ?? genericAdapter;
    const system = definitions.find(adapter => adapter.systemId && adapter.systemId === this.getSystemId());
    return system ? [generic, system] : [generic];
  }

  _mappings() { return validateMappings(this.getMappings() ?? []); }

  fieldDefinitions({ dataSource = "actors" } = {}) {
    if (dataSource === "demo") return DEMO_FIELDS.map(field => ({ ...field }));
    const result = new Map();
    for (const adapter of this._adapters()) for (const field of adapter.fields ?? []) result.set(field.id, { ...field });
    for (const { id, label, type } of this._mappings()) result.set(id, { id, label, type });
    if (!result.has("character.hp.percent") && result.get("character.hp.current")?.type === "number"
      && result.get("character.hp.max")?.type === "number") result.set("character.hp.percent", {
      id: "character.hp.percent", label: "Health percent", type: "number", format: "percent"
    });
    return [...result.values()];
  }

  listActors() {
    const user = this.getUser();
    if (!user) return [];
    const collection = this.getActors();
    const actors = collection?.contents ?? (collection ? [...collection] : []);
    return actors.filter(actor => WORLD_ACTOR.test(actor.uuid) && worldActor(actor, actor.uuid) && permittedActor(actor, user))
      .map(actor => ({ uuid: actor.uuid, name: String(actor.name ?? "Unnamed Actor").slice(0, 10000),
        portrait: safePortrait(actor.img) ?? "", type: String(actor.type ?? "").slice(0, 128) }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async resolveActor(reference, { user = this.getUser() } = {}) {
    const uuid = actorReference(reference);
    if (!user) throw new Error("Configure an overlay viewer account before assigning a character.");
    const actor = await this.resolveUuid(uuid);
    if (!worldActor(actor, uuid)) throw new Error("The world Actor is missing or unavailable.");
    if (!permittedActor(actor, user)) throw new Error("The overlay viewer needs Observer permission for this Actor.");
    return actor;
  }

  async resolve(reference, fields = [], { portraitSource = "profile" } = {}) {
    const requested = [...new Set(Array.isArray(fields) ? fields.filter(field => typeof field === "string" && FIELD_ID.test(field)).slice(0, 128) : [])];
    if (isDemoReference(reference)) return this.demoData.resolve(reference, requested);
    const values = {};
    let definitions;
    try { definitions = new Map(this.fieldDefinitions().map(field => [field.id, field])); }
    catch { return { values, warning: "Character field mappings are invalid. Ask a GM to review them." }; }
    const supported = requested.filter(field => definitions.has(field));
    for (const field of supported) values[field] = null;
    if (!reference) return { values, warning: "Assign a character to preview live values." };
    try {
      // Capture permission identity for the whole asynchronous read and verify it again afterwards.
      const user = this.getUser();
      const actor = await this.resolveActor(reference, { user });
      const mappings = this._mappings();
      const deriveHealthPercent = supported.includes("character.hp.percent") && !mappings.some(mapping => mapping.id === "character.hp.percent")
        && definitions.get("character.hp.current")?.type === "number" && definitions.get("character.hp.max")?.type === "number";
      // Percentage dependencies are read internally; only the explicitly requested result is returned.
      const readFields = deriveHealthPercent ? [...new Set([...supported, "character.hp.current", "character.hp.max"])] : supported;
      const resolved = {};
      for (const adapter of this._adapters()) {
        const adapterFields = readFields.filter(field => adapter.fields?.some(definition => definition.id === field));
        if (!adapterFields.length) continue;
        const normalized = await adapter.normalize(actor, { user, fields: adapterFields, portraitSource });
        if (!normalized || typeof normalized !== "object") continue;
        for (const field of adapterFields) resolved[field] = safeScalar(normalized[field], definitions.get(field).type);
      }
      for (const mapping of mappings) if (readFields.includes(mapping.id)) resolved[mapping.id] = readMappedField(actor, mapping);
      if (deriveHealthPercent) {
        const current = resolved["character.hp.current"], max = resolved["character.hp.max"];
        resolved["character.hp.percent"] = typeof current === "number" && typeof max === "number" && max > 0
          ? Math.max(0, Math.min(100, current / max * 100)) : null;
      }
      for (const field of supported) values[field] = resolved[field] ?? null;
      const currentUser = this.getUser();
      if (!currentUser || currentUser.id !== user?.id || !permittedActor(actor, currentUser)) {
        for (const field of supported) values[field] = null;
        return { values, warning: "The overlay viewer no longer has permission to view this Actor." };
      }
      return { values, warning: supported.length !== requested.length || supported.some(field => values[field] === null)
        ? "Some selected character fields are unavailable for this Actor or game system." : null };
    } catch (error) {
      for (const field of supported) values[field] = null;
      return { values, warning: error instanceof Error ? error.message : "The character could not be loaded." };
    }
  }

  subscribe(reference, callback) {
    const uuid = isDemoReference(reference) ? reference : actorReference(reference);
    if (typeof callback !== "function") throw new TypeError("Character subscriptions require a callback.");
    const callbacks = this.subscriptions.get(uuid) ?? new Set();
    callbacks.add(callback);
    this.subscriptions.set(uuid, callbacks);
    return () => {
      callbacks.delete(callback);
      if (!callbacks.size && this.subscriptions.get(uuid) === callbacks) this.subscriptions.delete(uuid);
    };
  }

  /** Transient simulation uses the same subscriptions and production trigger/value update path. */
  simulateDemo(reference, action) {
    const accepted = this.demoData.simulate(reference, action);
    this._schedule(reference);
    return accepted;
  }

  listDemoActors() { return this.demoData.list(); }

  _schedule(uuid) {
    if (!this.subscriptions.has(uuid)) return;
    this.pending.add(uuid);
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const pending = [...this.pending];
      this.pending.clear();
      for (const actorUuid of pending) for (const callback of this.subscriptions.get(actorUuid) ?? []) {
        try { Promise.resolve(callback(actorUuid)).catch(this.onError); }
        catch (error) { this.onError(error); }
      }
    }, this.debounceMs);
  }

  /** Used after field mapping or viewer account changes; does not alter saved overlay state. */
  refresh() { for (const uuid of this.subscriptions.keys()) this._schedule(uuid); }

  start() {
    if (this.hookIds.length || !this.hooks?.on) return this;
    const on = (name, callback) => this.hookIds.push([name, this.hooks.on(name, callback)]);
    const actorChanged = actor => { if (worldActor(actor, actor?.uuid)) this._schedule(actor.uuid); };
    for (const operation of ["create", "update", "delete"]) {
      on(`${operation}Actor`, actorChanged);
      for (const type of ["Item", "ActiveEffect"]) on(`${operation}${type}`, document => {
        let parent = document?.parent;
        if ((parent?.documentName ?? parent?.constructor?.documentName) === "Item") parent = parent.parent;
        actorChanged(parent);
      });
      on(`${operation}Token`, token => {
        // Only linked world Actors; synthetic Token data must never replace a world binding.
        if (token?.actorLink) actorChanged(token.actor);
      });
    }
    for (const operation of ["update", "delete"]) on(`${operation}User`, user => {
      // getUser may return null after deletion, so invalidate all to clear stale on-air content.
      if (!this.getUser() || user?.id === this.getUser()?.id) this.refresh();
    });
    return this;
  }

  stop() {
    for (const [name, id] of this.hookIds) this.hooks?.off?.(name, id);
    this.hookIds.length = 0;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    this.subscriptions.clear();
  }
}
