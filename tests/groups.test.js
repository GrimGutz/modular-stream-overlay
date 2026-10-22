import test from "node:test";
import assert from "node:assert/strict";
import { createOverlay, validateLayer } from "../scripts/core/schema.js";
import { createLayer, groupLayers, ungroupLayers, moveLayers, reorderInGroup, stepLayer, layerOrder, pasteLayers, dissolveSmallGroups } from "../scripts/core/layers.js";

function overlayWith(...names) {
  const overlay = createOverlay();
  names.forEach((name, index) => overlay.layers.push(Object.assign(createLayer("color", overlay.canvas), { id: name, name, z: index })));
  return overlay;
}
const order = overlay => layerOrder(overlay).map(layer => layer.id);
const byId = (overlay, id) => overlay.layers.find(layer => layer.id === id);

test("group fields are optional, validated and ignored without a group ID", () => {
  const base = createLayer("text");
  assert.equal(Object.hasOwn(validateLayer(base), "groupId"), false, "Older layouts keep their exact normalized form");
  assert.deepEqual((({ groupId, groupName }) => ({ groupId, groupName }))(validateLayer({ ...base, groupId: "group-1", groupName: " Header " })), { groupId: "group-1", groupName: "Header" });
  assert.equal(Object.hasOwn(validateLayer({ ...base, groupName: "Orphan" }), "groupName"), false);
  assert.throws(() => validateLayer({ ...base, groupId: "bad id" }), /Group ID/);
});

test("grouping makes the members one block where the top-most was, and lone members ungroup", () => {
  const overlay = overlayWith("a", "b", "c", "d", "e");
  assert.deepEqual(order(overlay), ["e", "d", "c", "b", "a"]);
  const groupId = groupLayers(overlay, ["e", "b"], "Header");
  assert.match(groupId, /^group-/);
  assert.deepEqual(order(overlay), ["e", "b", "d", "c", "a"], "Members move next to the top-most member");
  assert.deepEqual(["e", "b"].map(id => byId(overlay, id).groupName), ["Header", "Header"]);
  assert.deepEqual(overlay.layers.map(layer => layer.z).sort(), [0, 1, 2, 3, 4], "The same stack values are reused");
  assert.equal(groupLayers(overlay, ["a"], "One"), null, "A group needs two layers");
  groupLayers(overlay, ["b", "d"], "Second");
  assert.equal(byId(overlay, "e").groupId, undefined, "The first group lost a member and dissolved");
  ungroupLayers(overlay, new Set([byId(overlay, "b").groupId]));
  assert(overlay.layers.every(layer => !layer.groupId));
});

test("moving layers in the list joins, leaves or keeps groups; grouped layers restack inside their group", () => {
  const overlay = overlayWith("a", "b", "c", "d", "e");
  const groupId = groupLayers(overlay, ["d", "c"], "Group");
  assert.deepEqual(order(overlay), ["e", "d", "c", "b", "a"]);
  moveLayers(overlay, ["a"], 2, groupId);
  assert.deepEqual(order(overlay), ["e", "d", "a", "c", "b"]); assert.equal(byId(overlay, "a").groupId, groupId);
  moveLayers(overlay, ["d"], 0, null);
  assert.deepEqual(order(overlay), ["d", "e", "a", "c", "b"]); assert.equal(byId(overlay, "d").groupId, undefined);
  assert.equal(reorderInGroup(overlay, "c", "front"), true);
  assert.deepEqual(order(overlay), ["d", "e", "c", "a", "b"]);
  assert.equal(reorderInGroup(overlay, "c", "up"), false, "Already first in its group");
  assert.equal(stepLayer(overlay, "b", "up"), true);
  assert.deepEqual(order(overlay), ["d", "e", "b", "c", "a"], "An ungrouped layer steps over the whole group");
  assert.equal(stepLayer(overlay, "e", "down"), true);
  assert.deepEqual(order(overlay), ["d", "b", "e", "c", "a"]);
  assert.equal(stepLayer(overlay, "e", "down"), true);
  assert.deepEqual(order(overlay), ["d", "b", "c", "a", "e"], "Stepping down also passes the whole group");
  assert.equal(stepLayer(overlay, "e", "down"), false);
});

test("pasted or copied groups become new groups; a single pasted member is an ordinary layer", () => {
  const overlay = overlayWith("a", "b", "c");
  const groupId = groupLayers(overlay, ["a", "b"], "Pair");
  const copies = pasteLayers(overlay, [byId(overlay, "a"), byId(overlay, "b")]);
  assert(copies.every(copy => copy.groupId && copy.groupId !== groupId && copy.groupName === "Pair"));
  assert.equal(new Set(copies.map(copy => copy.groupId)).size, 1);
  const [single] = pasteLayers(overlay, [byId(overlay, "a")]);
  assert.equal(single.groupId, undefined);
  dissolveSmallGroups(overlay);
  assert.equal(overlay.layers.filter(layer => layer.groupId === groupId).length, 2, "The original group is untouched");
});
