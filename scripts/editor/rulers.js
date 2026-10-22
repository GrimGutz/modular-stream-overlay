/**
 * Rulers along the top and left of the canvas viewport, marked in native overlay pixels. They
 * stay at the viewport edges while it scrolls. The top ruler (data-ruler="y") makes horizontal
 * guides and the left one (data-ruler="x") vertical guides; LayerCanvas handles the dragging.
 */
export const RULER_SIZE = 18;
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
const COLORS = { background: "#1b1f27", canvas: "#272c37", tick: "#6f7889", text: "#aab4c7", edge: "#39404f" };

/** Labelled steps at least 60 screen pixels apart, with small ticks at least 6 pixels apart. */
export function rulerSteps(scale) {
  const major = STEPS.find(step => step * scale >= 60) ?? STEPS.at(-1);
  const minor = STEPS.find(step => step < major && major % step === 0 && step * scale >= 6) ?? major;
  return { major, minor };
}

export class CanvasRulers {
  constructor(host) {
    this.host = host;
    this.visible = false;
    this.top = this.strip("y");
    this.left = this.strip("x");
    this.corner = document.createElement("div");
    this.corner.className = "mso-ruler-corner";
    this.elements = [this.top, this.left, this.corner];
    for (const element of this.elements) element.hidden = true;
  }

  strip(guideAxis) {
    const element = document.createElement("canvas");
    element.className = `mso-ruler mso-ruler-${guideAxis === "y" ? "top" : "left"}`;
    element.dataset.ruler = guideAxis;
    return element;
  }

  /** The surface is replaced on render, so the rulers are attached after it each time. */
  attach() { this.host.append(...this.elements); }

  setVisible(visible) {
    this.visible = visible === true;
    for (const element of this.elements) element.hidden = !this.visible;
  }

  draw(layout, canvas) {
    if (!this.visible || !layout || !canvas) return;
    const { scrollLeft = 0, scrollTop = 0, clientWidth = 0, clientHeight = 0 } = this.host;
    // Absolute children scroll with the viewport; moving them back keeps them at its edges.
    for (const element of this.elements) element.style.transform = `translate(${scrollLeft}px, ${scrollTop}px)`;
    this.paint(this.top, "x", Math.max(0, clientWidth - RULER_SIZE), layout.left - scrollLeft - RULER_SIZE, layout.scale, canvas.width);
    this.paint(this.left, "y", Math.max(0, clientHeight - RULER_SIZE), layout.top - scrollTop - RULER_SIZE, layout.scale, canvas.height);
  }

  /** Draw one ruler: `origin` is where native 0 falls on it, in screen pixels. */
  paint(element, axis, length, origin, scale, extent) {
    const context = element.getContext?.("2d");
    if (!context || !(scale > 0)) return;
    const ratio = globalThis.devicePixelRatio || 1;
    const across = axis === "x" ? [length, RULER_SIZE] : [RULER_SIZE, length];
    element.style.width = `${across[0]}px`; element.style.height = `${across[1]}px`;
    element.width = Math.round(across[0] * ratio); element.height = Math.round(across[1] * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = COLORS.background;
    context.fillRect(0, 0, across[0], across[1]);
    const at = value => origin + value * scale;
    // The canvas extent is lighter, so its edges read at a glance.
    context.fillStyle = COLORS.canvas;
    if (axis === "x") context.fillRect(at(0), 0, extent * scale, RULER_SIZE);
    else context.fillRect(0, at(0), RULER_SIZE, extent * scale);
    const { major, minor } = rulerSteps(scale);
    const first = Math.floor(-origin / scale / minor) * minor, last = (length - origin) / scale;
    context.strokeStyle = COLORS.tick; context.fillStyle = COLORS.text; context.lineWidth = 1;
    context.font = "9px sans-serif"; context.textBaseline = "top";
    context.beginPath();
    for (let value = first; value <= last; value += minor) {
      const position = Math.round(at(value)) + 0.5;
      const tick = value % major === 0 ? RULER_SIZE - 2 : value % (major / 2) === 0 ? 7 : 4;
      if (axis === "x") { context.moveTo(position, RULER_SIZE); context.lineTo(position, RULER_SIZE - tick); }
      else { context.moveTo(RULER_SIZE, position); context.lineTo(RULER_SIZE - tick, position); }
    }
    context.stroke();
    for (let value = Math.floor(first / major) * major; value <= last; value += major) {
      const position = at(value);
      if (axis === "x") context.fillText(String(value), position + 3, 2);
      else {
        context.save(); context.translate(2, position - 3); context.rotate(-Math.PI / 2);
        context.fillText(String(value), 0, 0); context.restore();
      }
    }
    context.strokeStyle = COLORS.edge; context.beginPath();
    if (axis === "x") { context.moveTo(0, RULER_SIZE - 0.5); context.lineTo(length, RULER_SIZE - 0.5); }
    else { context.moveTo(RULER_SIZE - 0.5, 0); context.lineTo(RULER_SIZE - 0.5, length); }
    context.stroke();
  }

  /** True when a screen point lies on the ruler for this guide axis, where a guide is removed. */
  contains(axis, clientX, clientY) {
    const bounds = this.host.getBoundingClientRect();
    return axis === "y" ? clientY - bounds.top < RULER_SIZE : clientX - bounds.left < RULER_SIZE;
  }

  destroy() { for (const element of this.elements) element.remove?.(); }
}
