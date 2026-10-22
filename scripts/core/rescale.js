/**
 * Rescale a whole overlay or widget design to a new canvas size. "fit" scales everything by one
 * factor and centers the result (letterboxing when the proportions differ); "stretch" scales
 * each axis to fill the new canvas. Sizes in a layer's style (fonts, borders, corners, shadows,
 * circles, padding) follow the smaller factor so text keeps fitting its box.
 */
import { clone, validateOverlay } from "./schema.js";

// Style sizes scaled with the layout, with the bounds the schema accepts.
const STYLE_SIZES = {
  fontSize: [1, 512], strongFontSize: [1, 512], minFontSize: [1, 512], letterSpacing: [-50, 200], padding: [0, 500],
  borderWidth: [0, 64], cornerRadius: [0, 3840], borderRadius: [0, 3840], boxShadowX: [-200, 200], boxShadowY: [-200, 200],
  boxShadowBlur: [0, 200], dotSize: [1, 256], dotGap: [0, 256], dotBorderWidth: [0, 32], clipSize: [0, 2000]
};
const clamp = (value, [low, high]) => Math.max(low, Math.min(high, value));
const exact = value => Math.round(value * 100) / 100;

export const RESCALE_MODES = Object.freeze(["fit", "stretch"]);

/** The factors and offsets that map old canvas coordinates onto the new canvas. */
export function rescaleTransform(from, to, mode = "fit") {
  if (!RESCALE_MODES.includes(mode)) throw new TypeError("Rescale with fit or stretch.");
  const sx = to.width / from.width, sy = to.height / from.height, uniform = Math.min(sx, sy);
  if (mode === "stretch") return { sx, sy, ox: 0, oy: 0, style: uniform };
  return { sx: uniform, sy: uniform, ox: (to.width - from.width * uniform) / 2, oy: (to.height - from.height * uniform) / 2, style: uniform };
}

function rescaleLayer(layer, transform) {
  const result = { ...layer };
  const width = clamp(layer.width * transform.sx, [1, 7680]), height = clamp(layer.height * transform.sy, [1, 7680]);
  // Scale around each layer's center so rotated layers stay where they were.
  const cx = (layer.x + layer.width / 2) * transform.sx + transform.ox, cy = (layer.y + layer.height / 2) * transform.sy + transform.oy;
  Object.assign(result, { x: exact(clamp(cx - width / 2, [-32768, 32768])), y: exact(clamp(cy - height / 2, [-32768, 32768])), width: exact(width), height: exact(height) });
  for (const [key, bounds] of Object.entries(STYLE_SIZES)) if (typeof layer[key] === "number") result[key] = exact(clamp(layer[key] * transform.style, bounds));
  return result;
}

export function rescaleOverlay(input, width, height, { mode = "fit" } = {}) {
  const overlay = clone(validateOverlay(input));
  const to = { width, height };
  const transform = rescaleTransform(overlay.canvas, to, mode);
  overlay.canvas = to;
  overlay.layers = overlay.layers.map(layer => rescaleLayer(layer, transform));
  overlay.widgets = overlay.widgets.map(widget => rescaleLayer(widget, transform));
  overlay.pages = overlay.pages.map(page => ({ ...page, layers: page.layers.map(layer => rescaleLayer(layer, transform)) }));
  return validateOverlay(overlay);
}
