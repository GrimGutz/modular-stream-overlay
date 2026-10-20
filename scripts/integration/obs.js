/** Keep authentication in Foundry; these helpers never put credentials into a URL. */
export function isOverlayRequest(location) {
  return /\/stream\/?$/.test(location.pathname) && new URLSearchParams(location.search).get("mso") === "1";
}

export function overlayURL({ origin, getRoute }) {
  const url = new URL(getRoute("stream"), origin);
  url.searchParams.set("mso", "1");
  return url.href;
}

/** Only an explicitly selected, lowest-role account can render stream output. */
export function isViewerAllowed(user, viewerUserId) {
  return Boolean(viewerUserId && user?.id === viewerUserId && user.role === 1 && !user.isGM);
}

export function viewerAccessMessage(user, viewerUserId) {
  if (!viewerUserId) return "Overlay output is disabled. A GM must select a Player account in the overlay editor.";
  if (!isViewerAllowed(user, viewerUserId)) return "Overlay output requires the selected Player account. Use OBS Interact to log in through Foundry's Join page.";
  return "";
}
