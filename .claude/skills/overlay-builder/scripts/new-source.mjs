#!/usr/bin/env node
// Starts an authoring source from a bundled recipe, renaming every "recipe-" ID to a fresh prefix.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const recipes = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/recipes");
const available = (await readdir(recipes)).filter(name => name.endsWith(".json")).map(name => name.slice(0, -5));
const usage = `Start an authoring source from a recipe
  node .claude/skills/overlay-builder/scripts/new-source.mjs RECIPE PREFIX --out work/authoring/NAME.json [--title "Display name"] [--force]
RECIPE  one of: ${available.join(", ")}
PREFIX  short unique ID prefix for this overlay, e.g. "pf2e-party" (letters, digits, - and _)
--title replaces "Recipe" in record names, e.g. "Recipe — Party card" becomes "<title> — Party card"`;

const args = process.argv.slice(2);
if (args.length < 2 || args.includes("--help")) { console.log(usage); process.exit(args.includes("--help") ? 0 : 1); }
const [recipe, prefix] = args;
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const out = option("--out"), title = option("--title");
if (!available.includes(recipe)) throw Error(`Unknown recipe "${recipe}". Choose: ${available.join(", ")}.`);
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/.test(prefix) || prefix.startsWith("recipe")) throw Error("PREFIX must be 1–41 letters, digits, - or _, and not \"recipe\".");
if (!out) throw Error("Pass --out work/authoring/NAME.json.");
if (title !== undefined && (!title.trim() || title.length > 60 || /["\\\u0000-\u001f]/.test(title))) throw Error("--title must be 1–60 printable characters without quotes or backslashes.");

let text = await readFile(path.join(recipes, `${recipe}.json`), "utf8");
text = text.replaceAll('"recipe-', `"${prefix}-`);
if (title) text = text.replaceAll('"Recipe — ', `"${title.trim()} — `);
await mkdir(path.dirname(path.resolve(out)), { recursive: true });
await writeFile(out, text, { flag: args.includes("--force") ? "w" : "wx" });
console.log(`Wrote ${out} from recipe ${recipe}; IDs start with "${prefix}-". Edit it, then generate with tools/overlay-author.mjs.`);
