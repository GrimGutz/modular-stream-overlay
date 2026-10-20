#!/usr/bin/env node
/** Explicit, selective development sync. Nothing writes without --apply or --watch. */
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const ID = "modular-stream-overlay";
const SOURCE = fileURLToPath(new URL("../", import.meta.url));
const DIRECTORIES = ["scripts", "styles", "templates", "docs", "tests", "tools"];
const ROOT_FILES = ["module.json", "package.json", "README.md", "AGENTS.md", ".gitignore", "assets/basic-background.svg"];
const EXCLUDED = new Set([".git", "storage", "node_modules"]);
const key = value => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
const inside = (parent, child) => key(child).startsWith(`${key(parent)}${path.sep}`);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async file => JSON.parse(await fs.readFile(file, "utf8"));

async function optionalStat(file) {
  try { return await fs.lstat(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

/** Reject symlinks/junctions in every existing path component, including ancestors. */
async function noLinks(file) {
  const absolute = path.resolve(file);
  const { root } = path.parse(absolute);
  let current = root;
  for (const component of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await optionalStat(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) throw Error(`Symbolic links or junctions are not allowed: ${current}`);
    if (!stat.isDirectory() && key(current) !== key(absolute)) throw Error(`Not a directory: ${current}`);
  }
}

async function bytesAt(root, relative) {
  const file = path.resolve(root, relative);
  if (!inside(root, file)) throw Error(`Path escapes the module: ${relative}`);
  await noLinks(file);
  const stat = await optionalStat(file);
  if (!stat) return null;
  if (!stat.isFile()) throw Error(`Expected a regular file: ${file}`);
  return fs.readFile(file);
}

async function filesAt(root) {
  const files = new Map();
  async function visit(relative) {
    const file = path.join(root, relative);
    await noLinks(file);
    const stat = await optionalStat(file);
    if (!stat) return;
    if (stat.isFile()) files.set(relative, await fs.readFile(file));
    else if (stat.isDirectory()) {
      for (const entry of await fs.readdir(file)) {
        if (!EXCLUDED.has(entry)) await visit(path.join(relative, entry));
      }
    } else throw Error(`Expected a regular file or directory: ${file}`);
  }
  for (const relative of [...ROOT_FILES, ...DIRECTORIES]) await visit(relative);
  return files;
}

export async function createWorkflow({ source = SOURCE, config } = {}) {
  const explicitConfig = Boolean(config);
  source = path.resolve(source);
  await noLinks(source);
  if ((await json(path.join(source, "module.json"))).id !== ID) throw Error("Source module id does not match.");
  // A canonical module can locate its own server config; staging must specify it.
  const inferred = path.resolve(source, "../../..", "Config/options.json");
  if (!config) {
    if (!await optionalStat(inferred)) throw Error("Outside the installed module, --config <absolute Config/options.json> is required.");
    config = inferred;
  }
  if (!path.isAbsolute(config) || path.basename(config).toLowerCase() !== "options.json") {
    throw Error("--config must be the absolute path to Foundry's options.json.");
  }
  await noLinks(config);
  const options = await json(config);
  if (typeof options.dataPath !== "string" || !path.isAbsolute(options.dataPath)) throw Error("Foundry options.json must specify an absolute dataPath.");
  const target = path.resolve(options.dataPath, "Data/modules", ID);
  await noLinks(target);
  if (key(await fs.realpath(target)) !== key(target)) throw Error("Canonical module path resolves through another location.");
  if ((await json(path.join(target, "module.json"))).id !== ID) throw Error("Installed module id does not match.");
  const direct = key(source) === key(target);
  if (!direct && (inside(source, target) || inside(target, source))) throw Error("Source and target cannot contain one another.");
  if (!explicitConfig && !direct) throw Error("Outside the installed module, --config <absolute Config/options.json> is required.");
  const baseline = new Map([...await filesAt(target)].map(([relative, bytes]) => [relative, hash(bytes)]));
  const backups = new Set();
  let backupDirectory;

  async function check() {
    if (direct) return [];
    const sourceFiles = await filesAt(source);
    const changes = [];
    for (const [relative, bytes] of sourceFiles) {
      const existing = await bytesAt(target, relative);
      if (existing === null || hash(existing) !== hash(bytes)) changes.push({ relative, bytes, previous: existing === null ? null : hash(existing) });
    }
    return changes.sort((a, b) => a.relative.localeCompare(b.relative));
  }

  async function apply(changes) {
    changes ??= await check();
    if (direct) return { copied: [], backupDirectory: null };
    // Reject external edits before any writes. A new source path cannot clobber an untracked destination.
    for (const relative of new Set([...baseline.keys(), ...changes.map(change => change.relative)])) {
      const bytes = await bytesAt(target, relative);
      if ((bytes === null ? null : hash(bytes)) !== (baseline.get(relative) ?? null)) {
        throw Error(`Installed file changed outside this workflow; refusing to overwrite: ${relative}. Review it and restart with --check.`);
      }
    }
    for (const change of changes) {
      const destination = path.join(target, change.relative);
      await noLinks(destination);
      const existing = await bytesAt(target, change.relative);
      if ((existing === null ? null : hash(existing)) !== change.previous) throw Error(`Installed file changed after check: ${change.relative}`);
      if (existing !== null && !backups.has(change.relative)) {
        backupDirectory ??= await fs.mkdtemp(path.join(os.tmpdir(), "foundry-overlay-dev-"));
        const backup = path.join(backupDirectory, change.relative);
        await fs.mkdir(path.dirname(backup), { recursive: true });
        await fs.writeFile(backup, existing, { flag: "wx" });
        backups.add(change.relative);
      }
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await noLinks(destination);
      if (!inside(target, await fs.realpath(path.dirname(destination)))) {
        if (key(await fs.realpath(path.dirname(destination))) !== key(target)) throw Error("Destination parent escapes the module.");
      }
      await fs.writeFile(destination, change.bytes);
      baseline.set(change.relative, hash(change.bytes));
    }
    return { copied: changes.map(change => change.relative), backupDirectory: backupDirectory ?? null };
  }
  return { source, target, direct, check, apply };
}

async function main(args) {
  let config;
  let mode = "--check";
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--config") config = args[++index];
    else if (["--check", "--apply", "--watch"].includes(argument)) mode = argument;
    else throw Error(`Unknown argument: ${argument}`);
  }
  const workflow = await createWorkflow({ config });
  console.log(`Source: ${workflow.source}\nCanonical module: ${workflow.target}`);
  if (workflow.direct) return console.log("Running in the canonical module. Edit here directly; no deployment is needed.");
  do {
    const changes = await workflow.check();
    if (changes.length) console.log(changes.map(change => `  ${change.relative}`).join("\n"));
    if (mode === "--check") console.log(`${changes.length} differing source files. No files written. --apply or --watch explicitly replaces these source files; unknown files and storage stay untouched.`);
    else if (changes.length) {
      const result = await workflow.apply(changes);
      console.log(`Updated ${result.copied.length} files. Original replaced files: ${result.backupDirectory ?? "none"}`);
    }
    if (mode !== "--watch") return;
    await delay(1000);
  } while (true);
}

if (process.argv[1] && key(process.argv[1]) === key(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
