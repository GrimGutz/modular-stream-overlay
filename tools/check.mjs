import { readdir, readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "module.json"), "utf8"));
if (manifest.id !== "modular-stream-overlay" || manifest.compatibility.minimum !== "14") throw Error("Invalid module manifest");
if (manifest.persistentStorage !== true) throw Error("Direct uploads require persistentStorage in module.json");
if (manifest.socket !== true) throw Error("Live controls require the module socket in module.json");
for (const file of [...manifest.esmodules, ...manifest.styles, "templates/editor.hbs", "assets/basic-background.svg"]) {
  await access(path.join(root, file));
}
let checked = 0;
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") await walk(file); }
    else if (/\.(?:js|mjs)$/.test(file)) {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
      checked++;
      const source = await readFile(file, "utf8");
      for (const [, relative] of source.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g)) await access(path.resolve(path.dirname(file), relative));
    }
  }
}
await walk(root);
console.log(`Manifest, assets, relative imports and syntax verified (${checked} JavaScript files).`);
