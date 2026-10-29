import { genericAdapter, permittedActor, playerAvatar, safePortrait } from "../adapters/generic.js";
import { FIELD_ID } from "./bindings.js";
import { validateMappings, readMappedField } from "./mappings.js";
import { validateActorUuid } from "../core/schema.js";
import { DemoDataSource, DEMO_FIELDS, isDemoReference } from "../demo/data.js";
import { versionCompatible } from "../core/versions.js";
import { PROFILE_FIELDS, profileValue, validateCharacterProfiles } from "./profiles.js";
import { ruleColor, validateAccentRules } from "./accent-rules.js";

const WORLD_ACTOR = /^Actor\.[A-Za-z0-9_-]{1,64}$/;
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const IDENTITY_FIELDS = new Set(["character.name", "character.callsign", "character.realName", "character.portrait", "character.tokenPortrait", "character.playerAvatar", "character.uuid", "character.type"]);
const ACCENT = "character.profile.accent", REAL_NAME = "character.realName";
const COLOR = /^#(?:[\da-f]{6}|[\da-f]{8})$/i;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
const RESOLUTION_ERRORS = new Set([
  "Configure an overlay viewer account before assigning a character.",
  "The world Actor is missing or unavailable.",
  "The overlay viewer needs Observer permission for this Actor.",
  "Enter a world Actor UUID or an @UUID Actor document link.",
  "Choose a world Actor. Compendium and unlinked Token Actors are not supported yet."
]);

export function validateAdapterPreferences(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Object.keys(input).length > 64) throw new TypeError("Adapter preferences must be a plain map of at most 64 systems.");
  const result = {};
  for (const [systemId, adapterId] of Object.entries(input)) {
    if (!PROVIDER_ID.test(systemId) || FORBIDDEN.has(systemId) || typeof adapterId !== "string"
      || !PROVIDER_ID.test(adapterId) || FORBIDDEN.has(adapterId)) throw new TypeError("Adapter preferences require supported system and adapter IDs.");
    result[systemId] = adapterId;
  }
  return result;
}

function applicability(field, actorType, systemVersion, parent = {}) {
  const actorTypes = field.actorTypes ?? parent.actorTypes;
  if (actorType !== undefined && actorTypes && !actorTypes.includes(actorType)) return "unsupported-actor-type";
  // Adapter-level tested versions document verification; only field versions gate values.
  // Patch releases of a tested major.minor line count as available.
  if (field.testedSystemVersions && !versionCompatible(field.testedSystemVersions, systemVersion)) return "unverified-version";
  return "available";
}

function resultStatus(statuses) {
  const values = Object.values(statuses);
  return values.length && values.every(value => value === values[0]) ? values[0] : values.some(value => value !== "available") ? "unavailable" : "available";
}

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
    getSystemId = () => globalThis.game?.system?.id, getSystemVersion = () => globalThis.game?.system?.version ?? "",
    getAdapterPreferences = () => ({}), getMappings = () => [], getActors = () => globalThis.game?.actors, getProfiles = null,
    getAccentRules = () => ({}), getUsers = () => globalThis.game?.users,
    hooks = globalThis.Hooks, debounceMs = 40, demoData = new DemoDataSource(), onError = error => console.error("Modular Stream Overlay |", error) } = {}) {
    this.adapters = adapters;
    this.getUser = getUser;
    this.resolveUuid = resolveUuid;
    this.getSystemId = getSystemId;
    this.getSystemVersion = getSystemVersion;
    this.getAdapterPreferences = getAdapterPreferences;
    this.getMappings = getMappings;
    this.getActors = getActors;
    this.getProfiles = getProfiles;
    this.getAccentRules = getAccentRules;
    this.getUsers = getUsers;
    this.hooks = hooks;
    this.debounceMs = Math.max(0, Math.min(1000, Number(debounceMs) || 0));
    this.onError = onError;
    this.demoData = demoData;
    this.subscriptions = new Map();
    this.pending = new Set();
    this.hookIds = [];
    this.timer = null;
    this.changeFailures = new Set();
  }

  _selection() {
    const definitions = this.adapters?.list?.() ?? [];
    const generic = definitions.find(adapter => adapter.id === "generic") ?? genericAdapter;
    const systemId = this.getSystemId(), systemVersion = this.getSystemVersion() ?? "";
    const candidates = definitions.filter(adapter => adapter.systemId && adapter.systemId === systemId);
    let preferences, warning = null, selected = null, explicit = false;
    try { preferences = validateAdapterPreferences(this.getAdapterPreferences() ?? {}); }
    catch { preferences = {}; warning = "Adapter preferences are invalid. Only standard Actor identity fields are available."; }
    if (!warning) {
      explicit = Object.hasOwn(preferences, systemId);
      selected = explicit ? definitions.find(adapter => adapter.id === preferences[systemId]) : candidates[0];
      if (selected && (selected.systemId !== systemId || (selected.interfaceVersion ?? 1) !== 1)) selected = null;
      if (explicit && !selected) warning = "The selected adapter is missing or incompatible with this system. Only standard Actor identity fields are available.";
      else if (!explicit && candidates.length > 1) warning = "Several adapters match this system. The first registered adapter is used; choose a provider explicitly to resolve the conflict.";
    }
    if (selected && this.changeFailures.has(selected.id)) warning = "The selected adapter change filter failed. Its fields are unavailable until a successful invalidation.";
    return { generic, selected, state: { systemId, systemVersion, adapterId: selected?.id ?? "generic", explicit,
      candidateIds: candidates.map(adapter => adapter.id), warning } };
  }

  getAdapterState() { return this._selection().state; }
  _adapters() { const { generic, selected } = this._selection(); return selected ? [generic, selected] : [generic]; }
  _mappings() { return validateMappings(this.getMappings() ?? []); }
  _profiles() {
    try { return validateCharacterProfiles(this.getProfiles?.() ?? {}); }
    catch { return {}; }
  }
  _accentRules() {
    try { return validateAccentRules(this.getAccentRules?.() ?? {}); }
    catch { return { field: "", colors: {} }; }
  }

  /**
   * Where character colors come from in this world: the field whose values color rules use
   * (the GM's choice, else the system's suggestion) and the system's own color field.
   */
  accentFields() {
    const { selected } = this._selection(), rules = this._accentRules();
    return { keyField: rules.field || selected?.accentKeyField || "", suggestedKeyField: selected?.accentKeyField ?? "", colorField: selected?.accentField ?? "" };
  }

  _catalog({ actorType } = {}) {
    const selection = this._selection(), { systemId, systemVersion } = selection.state;
    const result = new Map();
    for (const adapter of [selection.generic, selection.selected].filter(Boolean)) for (const field of adapter.fields ?? []) {
      if (adapter !== selection.generic && IDENTITY_FIELDS.has(field.id)) continue;
      result.set(field.id, { ...field, providerId: adapter.id,
        status: this.changeFailures.has(adapter.id) ? "unavailable" : applicability(field, actorType, systemVersion, adapter) });
    }
    // Module-owned presentation values are available for every system and Actor type.
    if (this.getProfiles) for (const field of PROFILE_FIELDS) {
      const { key: _key, ...metadata } = field;
      result.set(field.id, { ...metadata, providerId: "profile", status: "available" });
    }
    let mappings = [];
    if (!selection.state.warning || selection.selected) {
      try { mappings = this._mappings().filter(mapping => !mapping.systemId || mapping.systemId === systemId); }
      catch { selection.state.warning ??= "Character field mappings are invalid. Adapter fields remain available."; }
    }
    const activeMappings = [];
    for (const mapping of mappings) {
      const status = applicability(mapping, actorType, systemVersion);
      if (status !== "available" && result.has(mapping.id)) continue;
      const { path: _path, ...metadata } = mapping;
      result.set(mapping.id, { ...metadata, providerId: "mapping", status,
        legacyGlobal: !mapping.systemId && !mapping.actorTypes && !mapping.testedSystemVersions });
      activeMappings.push(mapping);
    }
    for (const field of result.values()) if (field.maxField !== undefined
      && (field.type !== "number" || result.get(field.maxField)?.type !== "number")) {
      // Scope/provider changes can remove a previously valid pair. Isolate the bad resource;
      // never blank name, portrait, or unrelated valid fields because one maximum is missing.
      field.status = "unavailable";
      field.invalidMaximum = true;
      delete field.maxField;
    }
    if (!result.has("character.hp.percent") && result.get("character.hp.current")?.type === "number"
      && result.get("character.hp.max")?.type === "number") result.set("character.hp.percent", {
      id: "character.hp.percent", label: "Health percent", type: "number", format: "percent", providerId: "derived", status: "available"
    });
    const percent = result.get("character.hp.percent");
    if (percent && percent.providerId !== "mapping") for (const dependency of ["character.hp.current", "character.hp.max"]) {
      const status = result.get(dependency)?.status;
      if (status && status !== "available") { percent.status = status; break; }
    }
    return { definitions: result, mappings: activeMappings, selection };
  }

  fieldDefinitions({ dataSource = "actors", actorType } = {}) {
    if (dataSource === "demo") return DEMO_FIELDS.map(field => ({ ...field }));
    return [...this._catalog({ actorType }).definitions.values()];
  }

  resourceDefinitions({ dataSource = "actors", actorType } = {}) {
    if (dataSource === "demo") return [];
    const { definitions, selection } = this._catalog({ actorType });
    return (selection.selected?.resources ?? []).map(resource => ({ ...resource, providerId: selection.selected.id,
      status: resultStatus(Object.fromEntries([resource.currentField, resource.maxField].map(id => [id, definitions.get(id)?.status ?? "unsupported-field"]))) }));
  }

  /** Unsaved JSON preview uses an isolated read-only service, never shared setting overrides. */
  async previewMappings(reference, input) {
    actorReference(reference);
    const mappings = validateMappings(input);
    const preview = new CharacterDataService({ adapters: this.adapters, getUser: this.getUser, resolveUuid: this.resolveUuid,
      getSystemId: this.getSystemId, getSystemVersion: this.getSystemVersion, getAdapterPreferences: this.getAdapterPreferences,
      getMappings: () => mappings, getActors: this.getActors, getProfiles: this.getProfiles, getAccentRules: this.getAccentRules, hooks: null, demoData: this.demoData });
    return preview.resolve(reference, mappings.map(mapping => mapping.id));
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
    const values = {}, fieldStatus = {};
    let catalog;
    try { catalog = this._catalog(); }
    catch { return { values, fieldStatus: Object.fromEntries(requested.map(id => [id, "unavailable"])), status: "unavailable",
      warning: "Character field mappings are invalid. Ask a GM to review them." }; }
    const supported = requested.filter(field => catalog.definitions.has(field));
    for (const field of requested) {
      fieldStatus[field] = catalog.definitions.get(field)?.status ?? "unsupported-field";
      if (catalog.definitions.has(field)) values[field] = null;
    }
    const unavailable = warning => {
      for (const field of supported) { values[field] = null; fieldStatus[field] = "unavailable"; }
      return { values, fieldStatus, status: resultStatus(fieldStatus), warning };
    };
    if (!reference) return unavailable("Assign a character to preview live values.");
    if (!supported.length) return { values, fieldStatus, status: resultStatus(fieldStatus), warning: catalog.selection.state.warning
      ?? (requested.length ? "Some selected character fields are unavailable for this Actor or game system." : null) };
    try {
      // The complete async operation uses the configured viewer, never caller-supplied GM privileges.
      const user = this.getUser();
      const actor = await this.resolveActor(reference, { user });
      catalog = this._catalog({ actorType: actor.type });
      const { definitions, mappings, selection } = catalog;
      for (const field of supported) fieldStatus[field] = definitions.get(field)?.status ?? "unsupported-field";
      const selected = supported.filter(field => fieldStatus[field] === "available");
      const deriveHealthPercent = selected.includes("character.hp.percent") && definitions.get("character.hp.percent")?.providerId !== "mapping"
        && definitions.get("character.hp.current")?.type === "number" && definitions.get("character.hp.max")?.type === "number";
      // An unset profile accent uses the system adapter's character color, read but not returned.
      const accentSource = selected.includes(ACCENT) ? selection.selected?.accentField : undefined;
      const accentReadable = accentSource && definitions.get(accentSource)?.providerId === selection.selected.id && definitions.get(accentSource)?.status === "available";
      // Then a color rule for the value of one field (a CAIN blasphemy, a class), also read but not returned.
      const rules = selected.includes(ACCENT) ? this._accentRules() : null;
      const ruleField = rules && Object.keys(rules.colors).length ? rules.field || selection.selected?.accentKeyField : undefined;
      const ruleReadable = ruleField && definitions.get(ruleField)?.type === "string" && definitions.get(ruleField)?.status === "available"
        && definitions.get(ruleField)?.providerId !== "profile";
      const readFields = [...new Set([...selected, ...(deriveHealthPercent ? ["character.hp.current", "character.hp.max"] : []),
        ...(accentReadable ? [accentSource] : []), ...(ruleReadable ? [ruleField] : [])])];
      const resolved = {};
      let failed = false;
      for (const adapter of [selection.generic, selection.selected].filter(Boolean)) {
        const adapterFields = readFields.filter(field => definitions.get(field)?.providerId === adapter.id && definitions.get(field)?.status === "available");
        if (!adapterFields.length) continue;
        try {
          const normalized = await adapter.normalize(actor, { user, fields: adapterFields, portraitSource, systemVersion: selection.state.systemVersion });
          if (!normalized || typeof normalized !== "object") continue;
          for (const field of adapterFields) resolved[field] = safeScalar(Object.hasOwn(normalized, field) ? normalized[field] : null, definitions.get(field).type);
        } catch { failed = true; }
      }
      for (const mapping of mappings) if (readFields.includes(mapping.id) && definitions.get(mapping.id)?.providerId === "mapping"
        && definitions.get(mapping.id)?.status === "available") {
        try { resolved[mapping.id] = readMappedField(actor, mapping); }
        catch { resolved[mapping.id] = null; failed = true; }
      }
      const profileFields = readFields.filter(field => definitions.get(field)?.providerId === "profile");
      if (profileFields.length || selected.includes(REAL_NAME)) {
        const profiles = this._profiles();
        for (const field of profileFields) resolved[field] = safeScalar(profileValue(profiles, actor.uuid, field), definitions.get(field).type)
          // Without separate art, a full-body slot shows the player's avatar, then the Actor's portrait.
          ?? (field === "character.profile.art" ? playerAvatar(actor, this.getUsers()) ?? safePortrait(actor.img) : null) ?? "";
        if (resolved[ACCENT] === "" && ruleReadable) resolved[ACCENT] = ruleColor(rules, resolved[ruleField]);
        if (resolved[ACCENT] === "" && accentReadable) resolved[ACCENT] = COLOR.test(resolved[accentSource] ?? "") ? resolved[accentSource] : "";
        // A profile full name replaces the name written in parentheses.
        const fullName = profileValue(profiles, actor.uuid, "character.profile.fullName");
        if (fullName && selected.includes(REAL_NAME) && definitions.get(REAL_NAME)?.status === "available") resolved[REAL_NAME] = fullName;
      }
      if (deriveHealthPercent) {
        const current = resolved["character.hp.current"], max = resolved["character.hp.max"];
        resolved["character.hp.percent"] = typeof current === "number" && typeof max === "number" && max > 0
          ? Math.max(0, Math.min(100, current / max * 100)) : null;
      }
      for (const field of selected) {
        values[field] = resolved[field] ?? null;
        fieldStatus[field] = values[field] === null ? "unavailable" : "available";
      }
      const currentUser = this.getUser();
      if (!currentUser || currentUser.id !== user?.id || !permittedActor(actor, currentUser)) {
        return unavailable("The overlay viewer no longer has permission to view this Actor.");
      }
      const warning = selection.state.warning ?? (failed ? "Some selected character fields could not be read safely."
        : Object.values(fieldStatus).some(status => status !== "available") ? "Some selected character fields are unavailable for this Actor or game system." : null);
      return { values, fieldStatus, status: resultStatus(fieldStatus), warning };
    } catch (error) {
      // Only our reference/permission errors are actionable. Adapter failures are caught above.
      return unavailable(RESOLUTION_ERRORS.has(error?.message) ? error.message : "The character could not be loaded.");
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

  _documentChanged(event, actor, document, changes, base = false) {
    if (!worldActor(actor, actor?.uuid)) return;
    let affected = base;
    const adapter = this._selection().selected;
    if (adapter?.affectsChange && permittedActor(actor, this.getUser())) {
      try {
        const result = adapter.affectsChange(event, { actor, document, changes });
        if (typeof result !== "boolean") {
          if (result && typeof result.then === "function") Promise.resolve(result).catch(() => {});
          throw new TypeError("Change filters must return a synchronous boolean.");
        }
        affected = affected || result || this.changeFailures.has(adapter.id);
        this.changeFailures.delete(adapter.id);
      } catch {
        this.changeFailures.add(adapter.id);
        this.refresh();
        return;
      }
    }
    // Base Actor/embedded events also affect generic identity and must never be filtered out.
    if (affected) this._schedule(actor.uuid);
  }

  start() {
    if (this.hookIds.length || !this.hooks?.on) return this;
    const on = (name, callback) => this.hookIds.push([name, this.hooks.on(name, callback)]);
    for (const operation of ["create", "update", "delete"]) {
      on(`${operation}Actor`, (actor, changes) => this._documentChanged(`${operation}Actor`, actor, actor, changes, true));
      for (const type of ["Item", "ActiveEffect"]) on(`${operation}${type}`, (document, changes) => {
        let parent = document?.parent;
        if ((parent?.documentName ?? parent?.constructor?.documentName) === "Item") parent = parent.parent;
        if (worldActor(parent, parent?.uuid)) this._documentChanged(`${operation}${type}`, parent, document, changes, true);
        else if (!document?.parent && this._selection().selected?.affectsChange) {
          const collection = this.getActors();
          for (const actor of collection?.contents ?? (collection ? [...collection] : [])) {
            if (this.subscriptions.has(actor?.uuid)) this._documentChanged(`${operation}${type}`, actor, document, changes);
          }
        }
      });
      on(`${operation}Token`, (token, changes) => {
        if (token?.actorLink) this._documentChanged(`${operation}Token`, token.actor, token, changes, true);
      });
    }
    for (const operation of ["update", "delete"]) on(`${operation}User`, (user, changes) => {
      // Player avatars and character assignments feed the player-avatar fields.
      if (!this.getUser() || user?.id === this.getUser()?.id || operation === "delete"
        || changes?.avatar !== undefined || changes?.character !== undefined) this.refresh();
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
    this.changeFailures.clear();
  }
}
