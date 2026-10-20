import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createWorkflow } from "../tools/foundry-dev.mjs";

const ID = "modular-stream-overlay";
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-workflow-test-"));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), "mso-workflow-test-")));
    await fs.rm(root, { recursive: true, force: true });
  });
  const source = path.join(root, "staging");
  const dataPath = path.join(root, "actual-foundry-data");
  const target = path.join(dataPath, "Data/modules", ID);
  const config = path.join(dataPath, "Config/options.json");
  async function write(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value); }
  for (const directory of [source, target]) {
    await write(path.join(directory, "module.json"), JSON.stringify({ id: ID }));
    await write(path.join(directory, "scripts/main.js"), "original");
  }
  await write(config, JSON.stringify({ dataPath }));
  return { root, source, target, config, write };
}

test("resolves actual dataPath and checks without writing", async t => {
  const f = await fixture(t);
  await f.write(path.join(f.source, "scripts/main.js"), "changed");
  const workflow = await createWorkflow(f);
  assert.equal(workflow.target, f.target);
  assert.deepEqual((await workflow.check()).map(change => change.relative), [path.join("scripts", "main.js")]);
  assert.equal(await fs.readFile(path.join(f.target, "scripts/main.js"), "utf8"), "original");
});

test("requires explicit config outside canonical and validates both ids", async t => {
  const f = await fixture(t);
  await assert.rejects(createWorkflow({ source: f.source }), /--config/);
  await f.write(path.join(f.target, "module.json"), '{"id":"wrong"}');
  await assert.rejects(createWorkflow(f), /Installed module id/);
  await f.write(path.join(f.source, "module.json"), '{"id":"wrong"}');
  await assert.rejects(createWorkflow(f), /Source module id/);
});

test("selectively updates, backs up originals and preserves custom assets/storage", async t => {
  const f = await fixture(t);
  for (const name of ["assets/custom.jpg", "storage/live.png", ".git/config", "worlds/world.json"]) {
    await f.write(path.join(f.source, name), "must not copy");
    await f.write(path.join(f.target, name), "keep mine");
  }
  await f.write(path.join(f.source, "scripts/main.js"), "changed");
  const workflow = await createWorkflow(f);
  const result = await workflow.apply();
  assert.deepEqual(result.copied, [path.join("scripts", "main.js")]);
  assert.equal(await fs.readFile(path.join(result.backupDirectory, "scripts/main.js"), "utf8"), "original");
  assert.equal(await fs.readFile(path.join(f.target, "scripts/main.js"), "utf8"), "changed");
  for (const name of ["assets/custom.jpg", "storage/live.png", ".git/config", "worlds/world.json"]) {
    assert.equal(await fs.readFile(path.join(f.target, name), "utf8"), "keep mine");
  }
});

test("watch-session baseline rejects outside edits and stale check plans", async t => {
  const f = await fixture(t);
  const workflow = await createWorkflow(f);
  await f.write(path.join(f.source, "scripts/main.js"), "staged");
  const plan = await workflow.check();
  await f.write(path.join(f.target, "scripts/main.js"), "external edit");
  await assert.rejects(workflow.apply(plan), /changed outside this workflow/);
  assert.equal(await fs.readFile(path.join(f.target, "scripts/main.js"), "utf8"), "external edit");
});

test("canonical operation needs no deployment and nested copies are rejected", async t => {
  const f = await fixture(t);
  const direct = await createWorkflow({ source: f.target });
  assert.equal(direct.direct, true);
  assert.deepEqual(await direct.apply(), { copied: [], backupDirectory: null });
  const nested = path.join(f.target, "tools/staging");
  await f.write(path.join(nested, "module.json"), JSON.stringify({ id: ID }));
  await assert.rejects(createWorkflow({ source: nested, config: f.config }), /cannot contain one another/);
});

test("rejects symbolic-link or junction escapes", async t => {
  const f = await fixture(t);
  const outside = path.join(f.root, "outside");
  await fs.mkdir(outside);
  try { await fs.symlink(outside, path.join(f.target, "scripts/escape"), process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES"].includes(error.code)) return t.skip("OS does not permit test symlinks"); throw error; }
  await assert.rejects(createWorkflow(f), /links or junctions/);
});
