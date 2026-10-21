import test from "node:test";
import assert from "node:assert/strict";
import { isOverlayRequest, overlayURL, isViewerAllowed, viewerAccessMessage } from "../scripts/integration/obs.js";
import { genericAdapter } from "../scripts/adapters/generic.js";

test("OBS URLs honor a reverse-proxy route prefix and contain no authentication data", () => {
  assert.equal(overlayURL({ origin: "https://game.example", getRoute: route => `/foundry/${route}` }), "https://game.example/foundry/stream?mso=1");
});

test("normal game, login, and default stream view are left intact", () => {
  for (const href of ["https://a/game?mso=1", "https://a/join?mso=1", "https://a/stream", "https://a/stream?mso=0"]) {
    assert.equal(isOverlayRequest(new URL(href)), false);
  }
  assert.equal(isOverlayRequest(new URL("https://a/foundry/stream?mso=1")), true);
});

test("viewer must be explicitly selected and may have any role", () => {
  const player = { id: "stream", role: 1, isGM: false };
  assert.equal(isViewerAllowed(player, "stream"), true);
  assert.equal(isViewerAllowed(player, "other"), false);
  assert.equal(isViewerAllowed(player, ""), false);
  assert.equal(isViewerAllowed(undefined, "stream"), false);
  // Foundry's own permissions for the account decide what it reads; an Assistant GM observes every Actor.
  for (const role of [2, 3, 4]) assert.equal(isViewerAllowed({ ...player, role, isGM: role >= 3 }, "stream"), true);
  assert.match(viewerAccessMessage({ ...player, id: "other" }, "stream"), /selected viewer account/);
  assert.equal(viewerAccessMessage(player, "stream"), "");
  assert.match(viewerAccessMessage(player, ""), /disabled/);
});

test("generic adapter requires document permission and explicit field choices", () => {
  const actor = { uuid: "Actor.one", name: "Public name", img: "assets/portrait.webp", system: { secret: "private" },
    testUserPermission: (_user, permission) => permission === "OBSERVER" };
  const user = { id: "stream" };
  assert.equal(genericAdapter.normalize(actor, { user }), null);
  assert.equal(genericAdapter.normalize(actor, { fields: ["name"] }), null);
  const data = genericAdapter.normalize(actor, { user, fields: ["name"] });
  assert.equal(data.name, "Public name");
  assert.equal(data.portrait, null);
  assert.equal("system" in data, false);
  actor.testUserPermission = () => false;
  assert.equal(genericAdapter.normalize(actor, { user, fields: ["portrait"] }), null);
});
