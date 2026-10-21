#!/usr/bin/env node
import { readFile, writeFile, mkdir, access, realpath } from "node:fs/promises";
import path from "node:path";
import { generateOverlayBundle, validateOverlayBundle, unresolvedActorSlots } from "../scripts/authoring/bundle.js";

const usage = `Overlay authoring (Node >=22; no dependencies)
  node tools/overlay-author.mjs generate INPUT.json --out BUNDLE.json [--macro INSTALL.js]
       [--actor hero=Actor.ID] [--ref card=existing-preset-id] [--force]
  node tools/overlay-author.mjs validate BUNDLE.json
Generation uses the real module schemas. Run INSTALL.js as a GM Script Macro in Foundry.
Unresolved Actor slots are prompted at installation. Existing Foundry IDs are never replaced.`;

async function canonical(filename) {
  const absolute = path.resolve(filename);
  try { return await realpath(absolute); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (path.dirname(absolute) === absolute) throw error;
    return path.join(await canonical(path.dirname(absolute)), path.basename(absolute));
  }
}

try {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help")) { console.log(usage); }
  else {
    const [command, inputFile, ...options] = args;
    if (!["generate", "validate"].includes(command) || !inputFile || inputFile.startsWith("--")) throw Error(usage);
    const settings = { actors: {}, refs: {} };
    for (let index = 0; index < options.length; index++) {
      const key = options[index];
      if (key === "--force") { settings.force = true; continue; }
      if (!["--out", "--macro", "--actor", "--ref"].includes(key) || !options[index + 1] || options[index + 1].startsWith("--")) throw Error(`Unknown or incomplete argument: ${key}`);
      const value = options[++index];
      if (key === "--actor" || key === "--ref") {
        const at = value.indexOf("=");
        if (at < 1 || at === value.length - 1) throw Error(`${key} requires name=value.`);
        const name = value.slice(0, at), target = key === "--actor" ? settings.actors : settings.refs;
        if (["__proto__", "constructor", "prototype"].includes(name) || Object.hasOwn(target, name)) throw Error(`Duplicate or unsafe argument: ${name}`);
        target[name] = value.slice(at + 1);
      } else {
        const name = key.slice(2); if (settings[name]) throw Error(`Duplicate argument: ${key}`); settings[name] = value;
      }
    }
    if (command === "validate" && options.length) throw Error("validate accepts only the bundle path.");
    const text = await readFile(inputFile, "utf8");
    if (text.length > 3000000) throw Error("Input JSON exceeds 3 MB.");
    const input = JSON.parse(text.replace(/^\uFEFF/, ""));
    const bundle = command === "generate" ? generateOverlayBundle(input, settings) : validateOverlayBundle(input);
    if (command === "generate") {
      if (!settings.out) throw Error("generate requires --out BUNDLE.json.");
      const targets = [settings.out, settings.macro].filter(Boolean).map(value => path.resolve(value));
      const identities = await Promise.all([inputFile, ...targets].map(canonical));
      if (new Set(identities.map(value => process.platform === "win32" ? value.toLowerCase() : value)).size !== targets.length + 1) throw Error("Input, bundle and macro paths must be different.");
      for (const target of targets) {
        if (!settings.force) {
          try { await access(target); throw Error(`Output exists: ${target}. Use --force to replace generated files.`); }
          catch (error) { if (error.code !== "ENOENT") throw error; }
        }
      }
      const json = JSON.stringify(bundle, null, 2) + "\n";
      const macro = `// Generated overlay bundle. Run as a GM Script Macro in Foundry; review before installing.\nconst { importOverlayBundle } = await import(foundry.utils.getRoute("modules/modular-stream-overlay/scripts/authoring/bundle.js"));\nawait importOverlayBundle({ bundle: ${JSON.stringify(bundle, null, 2)} });\n`;
      for (const [filename, contents] of [[settings.out, json], [settings.macro, macro]]) if (filename) {
        await mkdir(path.dirname(path.resolve(filename)), { recursive: true });
        await writeFile(filename, contents, { flag: settings.force ? "w" : "wx" });
      }
      console.log(`Generated ${settings.out}${settings.macro ? ` and ${settings.macro}` : ""}.`);
    }
    console.log(`Valid: ${bundle.overlays.length} overlays, ${bundle.widgetPresets.length} widget presets; Actor slots awaiting installation: ${unresolvedActorSlots(bundle).join(", ") || "none"}.`);
  }
} catch (error) { console.error(`Overlay author: ${error.message}`); process.exitCode = 1; }
