import { permittedActor } from "./generic.js";
import { CAIN_FIELDS, CAIN_LEGACY_PATHS, CAIN_NATIVE_PATHS, CAIN_RESOURCES, CAIN_SYSTEM_VERSION } from "./cain-fields.js";
import { CAIN_COLLECTION_FIELDS, cainCollectionAffected, normalizeCainCollection } from "./cain-collections.js";
import { versionCompatible } from "../core/versions.js";

const number = value => typeof value === "number" && Number.isFinite(value) ? value : null;
const read = (actor, path) => path?.reduce((value, key) => value?.[key], actor.system);
const legacyNumber = (actor, field) => number(read(actor, CAIN_LEGACY_PATHS[field]));
const nativeTypes = new Map(CAIN_FIELDS.filter(field => Object.hasOwn(CAIN_NATIVE_PATHS, field.id)).map(field => [field.id, field.type]));
const collectionFields = new Set(CAIN_COLLECTION_FIELDS.map(field => field.id));

export const cainAdapter = {
  id: "cain", label: "CAIN character resources", systemId: "cain",
  interfaceVersion: 1, testedSystemVersions: [CAIN_SYSTEM_VERSION],
  fields: CAIN_FIELDS, resources: CAIN_RESOURCES,
  // Characters take their stream accent from their blasphemy unless a profile sets one.
  accentField: "character.cain.blasphemy.color",
  affectsChange: cainCollectionAffected,
  normalize(actor, { user, fields = [], systemVersion, worldItems } = {}) {
    if (!Array.isArray(fields) || !permittedActor(actor, user)) return null;
    const version = systemVersion === undefined ? (globalThis.game?.system?.id === "cain" ? globalThis.game.system.version : undefined) : systemVersion;
    const nativeAvailable = actor.type === "character" && versionCompatible([CAIN_SYSTEM_VERSION], version);
    const result = {};
    for (const field of fields) {
      if (typeof field !== "string") continue;
      if (Object.hasOwn(CAIN_LEGACY_PATHS, field)) result[field] = legacyNumber(actor, field);
      else if (field === "character.hp.percent") {
        const current = legacyNumber(actor, "character.hp.current"), maximum = legacyNumber(actor, "character.hp.max");
        result[field] = current !== null && maximum > 0 ? Math.max(0, Math.min(100, current / maximum * 100)) : null;
      } else if (Object.hasOwn(CAIN_NATIVE_PATHS, field)) {
        const value = nativeAvailable ? read(actor, CAIN_NATIVE_PATHS[field]) : null;
        result[field] = nativeTypes.get(field) === "number" ? number(value) : typeof value === "string" ? value.slice(0, 1000) : null;
      } else if (collectionFields.has(field)) result[field] = nativeAvailable ? normalizeCainCollection(actor, field, { user, worldItems }) : null;
    }
    return result;
  }
};
