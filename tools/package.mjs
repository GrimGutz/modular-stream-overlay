#!/usr/bin/env node
/**
 * Release archive: dist/module.zip with the committed module files (without tests, internal
 * reports and development tools, as listed with export-ignore in .gitattributes) and
 * dist/module.json for the manifest URL. Only Git's files go in, so uploads, local assets,
 * work files and settings outside Git can never end up in a release.
 *
 *   node tools/package.mjs            # from the last commit; refuses uncommitted changes
 *   node tools/package.mjs --staged   # from the staged files, to try a release before committing
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

export async function packageModule({ staged = false, log = console.log } = {}) {
  const manifest = JSON.parse(await readFile(path.join(root, "module.json"), "utf8"));
  if (!manifest.download?.includes(`v${manifest.version}/`)) throw new Error(`module.json "download" must point at the v${manifest.version} release.`);
  let tree;
  if (staged) tree = git("write-tree");
  else {
    if (git("status", "--porcelain", "--untracked-files=no")) throw new Error("Commit or stash your changes first, or use --staged to try the staged files.");
    tree = "HEAD";
  }
  const dist = path.join(root, "dist");
  await mkdir(dist, { recursive: true });
  const zip = path.join(dist, "module.zip");
  // The working tree's .gitattributes decides what is left out, so a new rule applies at once.
  git("archive", "--format=zip", "--worktree-attributes", "-o", zip, tree);
  await writeFile(path.join(dist, "module.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`Built ${path.relative(root, zip)} (version ${manifest.version}) and dist/module.json from ${staged ? "the staged files" : "HEAD"}.`);
  log(`Attach both to the GitHub release v${manifest.version}; module.json's manifest URL points at the latest release's module.json.`);
  return { zip, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packageModule({ staged: process.argv.includes("--staged") }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
