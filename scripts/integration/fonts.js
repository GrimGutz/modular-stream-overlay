/**
 * Fonts for text layers: the browser-safe families plus every font Foundry knows, including
 * custom fonts added under Game Settings → Configure Fonts. Foundry loads font files only for
 * its own pages (the game canvas, setup), so the stream page and the editor load them here
 * through Foundry's public FontConfig.loadFont (or the browser's font loading for stylesheet fonts).
 */
import { FONT_FAMILIES, isFontFamily } from "../core/schema.js";

const loading = new Map();

function definitions(game = globalThis.game, config = globalThis.CONFIG) {
  let custom = {};
  try { custom = game?.settings?.get?.("core", "fonts") ?? {}; }
  catch { /* Not registered on this page. */ }
  return { ...(config?.fontDefinitions ?? {}), ...(custom && typeof custom === "object" ? custom : {}) };
}

/** Families for the font list: the browser-safe ones first, then Foundry's alphabetically. */
export function fontFamilies({ game, config } = {}) {
  const foundry = Object.keys(definitions(game, config)).filter(isFontFamily).sort((a, b) => a.localeCompare(b));
  return [...new Set([...FONT_FAMILIES, ...foundry])];
}

const loaded = (family, fonts) => [...(fonts ?? [])].some(face => String(face.family).replace(/^["']|["']$/g, "") === family);

/**
 * Load Foundry's font files into this page once each. Resolves when they are ready or after
 * `timeout` ms, so a missing file never holds up the overlay. System fonts need no files.
 */
export async function loadFoundryFonts({ game, config, document = globalThis.document, timeout = 4500,
  FontConfig = globalThis.foundry?.applications?.settings?.menus?.FontConfig } = {}) {
  if (typeof FontConfig?.loadFont !== "function") return;
  const pending = [];
  for (const [family, definition] of Object.entries(definitions(game, config))) {
    if (!isFontFamily(family) || !definition?.fonts?.length) continue;
    if (!loading.has(family)) {
      // Families declared by a stylesheet only need their files fetched before the first frame.
      loading.set(family, loaded(family, document?.fonts)
        ? Promise.resolve(document.fonts.load?.(`1em "${family}"`)).then(() => true, () => false)
        : Promise.resolve(FontConfig.loadFont(family, definition, { document })).catch(() => false));
    }
    pending.push(loading.get(family));
  }
  if (!pending.length) return;
  let timer;
  await Promise.race([Promise.all(pending), new Promise(resolve => { timer = setTimeout(resolve, timeout); timer?.unref?.(); })]);
  clearTimeout(timer);
}
