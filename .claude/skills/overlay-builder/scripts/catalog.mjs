// Shared by fields.mjs and preview.mjs: locates the module and reads its real field catalog.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MODULE_ID = "modular-stream-overlay";

/** The module root is four folders above this script: <root>/.claude/skills/overlay-builder/scripts. */
export async function moduleRoot() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const manifest = JSON.parse(await readFile(path.join(root, "module.json"), "utf8"));
  if (manifest.id !== MODULE_ID) throw Error(`Expected the ${MODULE_ID} module at ${root}, found ${manifest.id}.`);
  return { root, version: manifest.version };
}

export const load = async (root, relative) => import(pathToFileURL(path.join(root, relative)).href);

/**
 * Every field a layout can bind, by provider: Actor basics, Character profiles and each built-in
 * system adapter. Fields for other systems come from the GM's field mappings in the world.
 */
export async function fieldCatalog(root) {
  const [{ GENERIC_FIELDS }, { PROFILE_FIELDS }, ...adapters] = await Promise.all([
    load(root, "scripts/adapters/generic.js"), load(root, "scripts/data/profiles.js"),
    load(root, "scripts/adapters/cain.js"), load(root, "scripts/adapters/dnd5e.js"),
    load(root, "scripts/adapters/pf2e.js"), load(root, "scripts/adapters/cyberpunk-red.js")]);
  const entry = (provider, system) => field => ({ provider, system, id: field.id, label: field.label, type: field.type,
    group: field.group ?? "", role: field.role ?? "", maxField: field.maxField ?? "", unit: field.unit ?? "" });
  return [
    ...GENERIC_FIELDS.map(entry("generic", "any")),
    ...PROFILE_FIELDS.map(entry("profile", "any")),
    ...adapters.flatMap(module => Object.values(module).filter(value => value?.systemId && Array.isArray(value.fields)))
      .flatMap(adapter => adapter.fields.map(entry(adapter.id, adapter.systemId)))
  ];
}
