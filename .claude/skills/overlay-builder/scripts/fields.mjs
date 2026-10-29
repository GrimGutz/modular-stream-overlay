#!/usr/bin/env node
// Lists the character fields an overlay can bind, read from the module's own adapters.
import { moduleRoot, fieldCatalog } from "./catalog.mjs";

const usage = `List bindable character fields
  node .claude/skills/overlay-builder/scripts/fields.mjs [--system any|cain|dnd5e|pf2e|cyberpunk-red-core|all] [--search TEXT] [--json]
--system ID    a game system's id (cain, dnd5e, pf2e, cyberpunk-red-core) plus the fields every system has;
               any = only Actor basics and Character profiles; all = everything (default)
--search TEXT  keep fields whose ID, label or group contains TEXT (case-insensitive)`;

const args = process.argv.slice(2);
if (args.includes("--help")) { console.log(usage); process.exit(0); }
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const system = option("--system") ?? "all", search = option("--search")?.toLowerCase();

const { root } = await moduleRoot();
let fields = await fieldCatalog(root);
if (system !== "all") fields = fields.filter(field => field.system === "any" || field.system === system);
if (search) fields = fields.filter(field => [field.id, field.label, field.group].some(value => value.toLowerCase().includes(search)));

if (args.includes("--json")) console.log(JSON.stringify(fields, null, 2));
else {
  let heading = "";
  for (const field of fields) {
    const title = `${field.provider === "generic" ? "Actor basics (any system)" : field.provider === "profile" ? "Character profiles (any system)" : `System: ${field.system}`}${field.group ? ` — ${field.group}` : ""}`;
    if (title !== heading) { console.log(`\n## ${title}`); heading = title; }
    const extras = [field.role, field.maxField && `max: ${field.maxField}`, field.unit].filter(Boolean).join(", ");
    console.log(`${field.id.padEnd(48)} ${field.type.padEnd(7)} ${field.label}${extras ? `  (${extras})` : ""}`);
  }
  console.log(`\n${fields.length} fields. Other systems: bind generic fields, or add GM field mappings (see references/fields-and-systems.md).`);
}
