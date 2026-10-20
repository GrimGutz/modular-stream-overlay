/** Explicit, non-document identities; no user-supplied synthetic namespaces are accepted. */
export const DEMO_ACTOR_UUIDS = Object.freeze(["Demo.warrior", "Demo.mage"]);
export function isDemoReference(value) { return DEMO_ACTOR_UUIDS.includes(value); }
