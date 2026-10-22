/** Keep authentication in Foundry; these helpers never put credentials into a URL. */
export function isOverlayRequest(location) {
  return /\/stream\/?$/.test(location.pathname) && new URLSearchParams(location.search).get("mso") === "1";
}

export function overlayURL({ origin, getRoute }) {
  const url = new URL(getRoute("stream"), origin);
  url.searchParams.set("mso", "1");
  return url.href;
}

/**
 * Only the explicitly selected account renders stream output. Any role is accepted:
 * Foundry's own permissions for that account decide which Actors it can read, so an
 * Assistant GM sees every character without per-Actor grants.
 */
export function isViewerAllowed(user, viewerUserId) {
  return Boolean(viewerUserId && user?.id === viewerUserId);
}

/** Set on every response of the optional local OBS connector (tools/obs-connector.mjs). */
export const CONNECTOR_HEADER = "x-mso-obs-connector";

/**
 * After a lost Foundry connection, reload once the OBS connector answers: it keeps a
 * transparent page until Foundry and the world are back and signs in again. Without the
 * connector nothing reloads, so OBS never shows Foundry's sign-in or error pages on air.
 */
export function watchForConnector({ url, reload, fetch = globalThis.fetch, interval = 5000,
  setTimer = globalThis.setInterval, clearTimer = globalThis.clearInterval } = {}) {
  let stopped = false;
  const timer = setTimer(async () => {
    try {
      const response = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (!stopped && response.headers.get(CONNECTOR_HEADER) === "1") { stop(); reload(); }
    } catch { /* Not reachable yet. */ }
  }, interval);
  // Browsers return a number; under Node the poll must not keep the process alive.
  timer?.unref?.();
  const stop = () => { stopped = true; clearTimer(timer); };
  return stop;
}

export function viewerAccessMessage(user, viewerUserId) {
  if (!viewerUserId) return "Overlay output is disabled. A GM must select a viewer account in the overlay editor.";
  if (!isViewerAllowed(user, viewerUserId)) return "Overlay output requires the selected viewer account. Use OBS Interact to log in through Foundry's Join page.";
  return "";
}
