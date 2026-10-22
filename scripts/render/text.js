/** Shared text and box presentation for static and character layers. Values are always text nodes. */
const COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
export const safeColor = value => typeof value === "string" && COLOR.test(value) ? value : null;

export function fontStack(family) {
  return `"${family}", ${["Georgia", "Times New Roman"].includes(family) ? "serif" : family === "Courier New" ? "monospace" : "sans-serif"}`;
}

/** True when content needs inline spans rather than a single text node. */
export const usesSpans = layer => layer.richText === true || !!layer.highlightColor;

/** Literal text with optional `**bold**` markup; no field tokens are resolved here. */
export function markupLines(text, richText = false) {
  return String(text ?? "").split("\n").map(line => (richText ? line.split("**") : [line])
    .map((part, index) => ({ text: part, strong: index % 2 === 1 })).filter(segment => segment.text));
}

export function createTextElement(layer, { color } = {}) {
  const element = document.createElement("div");
  element.className = "mso-text-content";
  Object.assign(element.style, {
    fontFamily: fontStack(layer.fontFamily), fontSize: `${layer.fontSize}px`, fontWeight: String(layer.fontWeight),
    color: color ?? layer.color, textAlign: layer.align, textShadow: layer.shadow ? "0 2px 4px rgba(0,0,0,0.8)" : "none"
  });
  if (layer.lineHeight !== undefined) element.style.lineHeight = String(layer.lineHeight);
  if (layer.letterSpacing !== undefined) element.style.letterSpacing = `${layer.letterSpacing}px`;
  if (layer.uppercase) element.style.textTransform = "uppercase";
  if (layer.padding !== undefined) element.style.padding = `${layer.padding}px`;
  if (layer.verticalAlign && layer.verticalAlign !== "top") {
    Object.assign(element.style, { display: "flex", flexDirection: "column",
      justifyContent: layer.verticalAlign === "middle" ? "center" : "flex-end" });
  }
  return element;
}

/**
 * Write a plain string or template lines ({text, strong} segments). Plain content
 * stays a single text node; markup and highlights use one wrapper so flex
 * alignment treats every line as one block.
 */
export function writeTextContent(element, layer, content, { accent = null } = {}) {
  const lines = typeof content === "string" ? content.split("\n").map(text => text ? [{ text, strong: false }] : []) : content;
  if (typeof content === "string" && !usesSpans(layer)) {
    if (element.textContent !== content || element.children.length) element.textContent = content;
    return;
  }
  const wrapper = document.createElement("div");
  wrapper.className = "mso-text-lines";
  lines.forEach((segments, index) => {
    if (index) { const lineBreak = document.createElement("span"); lineBreak.textContent = "\n"; wrapper.append(lineBreak); }
    for (const segment of segments) {
      const span = document.createElement(segment.strong ? "strong" : "span");
      span.textContent = segment.text;
      if (segment.strong) {
        span.style.fontWeight = "700";
        const strongColor = layer.strongAccent ? accent ?? layer.strongColor : layer.strongColor;
        if (strongColor) span.style.color = strongColor;
        if (layer.strongFontSize !== undefined) span.style.fontSize = `${layer.strongFontSize}px`;
      }
      if (layer.highlightColor) {
        span.className = "mso-text-highlight";
        span.style.backgroundColor = layer.highlightColor;
      }
      wrapper.append(span);
    }
  });
  element.replaceChildren(wrapper);
}

/** CSS clip-path for a layer shape; `size` is the corner cut or slant in pixels. */
export function clipPath(shape, size = 24) {
  const cut = `${size}px`, far = value => `calc(100% - ${value})`;
  switch (shape) {
    case "circle": return "circle(closest-side at 50% 50%)";
    case "ellipse": return "ellipse(50% 50% at 50% 50%)";
    case "hexagon": return "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)";
    case "diamond": return "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)";
    case "triangle": return "polygon(50% 0, 100% 100%, 0 100%)";
    case "chamfer": return `polygon(${cut} 0, ${far(cut)} 0, 100% ${cut}, 100% ${far(cut)}, ${far(cut)} 100%, ${cut} 100%, 0 ${far(cut)}, 0 ${cut})`;
    case "parallelogram": return `polygon(${cut} 0, 100% 0, ${far(cut)} 100%, 0 100%)`;
    default: return "";
  }
}

/** A mask that fades the given edges out over `size` percent of the layer. */
export function fadeMask(edge, size = 25) {
  const fade = `transparent 0%, #000 ${size}%`, both = `transparent 0%, #000 ${size}%, #000 ${100 - size}%, transparent 100%`;
  const direction = { top: "to bottom", bottom: "to top", left: "to right", right: "to left", vertical: "to bottom", horizontal: "to right" }[edge];
  if (!direction) return "";
  return `linear-gradient(${direction}, ${edge === "vertical" || edge === "horizontal" ? both : fade})`;
}

/** Linear or radial fill from the layer color to its gradient color. */
export function gradientFill(layer) {
  if (!layer.gradientTo) return "";
  return layer.gradientType === "radial" ? `radial-gradient(circle at center, ${layer.color}, ${layer.gradientTo})`
    : `linear-gradient(${layer.gradientAngle ?? 180}deg, ${layer.color}, ${layer.gradientTo})`;
}

/**
 * Border, rounded corners, drop shadow, shape, mask image and faded edges on a layer's own
 * geometry element. Masks are also set with the -webkit- prefix for OBS's older Chromium.
 */
export function applyBoxStyle(element, layer, resolveAsset = null) {
  const width = layer.borderWidth ?? 0;
  element.style.border = width > 0 ? `${width}px solid ${layer.borderColor ?? "#000000"}` : "";
  element.style.borderRadius = layer.cornerRadius ? `${layer.cornerRadius}px` : "";
  element.style.boxShadow = layer.boxShadowColor
    ? `${layer.boxShadowX ?? 0}px ${layer.boxShadowY ?? 0}px ${layer.boxShadowBlur ?? 0}px ${layer.boxShadowColor}` : "";
  element.style.clipPath = clipPath(layer.clipShape, layer.clipSize ?? 24);
  const masks = [];
  if (layer.maskSrc && resolveAsset) masks.push(`url("${String(resolveAsset(layer.maskSrc)).replace(/["\\]/g, encodeURIComponent)}")`);
  if (layer.fadeEdge) masks.push(fadeMask(layer.fadeEdge, layer.fadeSize ?? 25));
  const image = masks.join(", ");
  for (const prefix of ["webkitMask", "mask"]) {
    element.style[`${prefix}Image`] = image;
    element.style[`${prefix}Size`] = image ? "100% 100%" : "";
    element.style[`${prefix}Repeat`] = image ? "no-repeat" : "";
  }
  element.style.webkitMaskComposite = masks.length > 1 ? "source-in" : "";
  element.style.maskComposite = masks.length > 1 ? "intersect" : "";
}

// Text with "fit to box" shrinks until it fits; it refits when its box, content or fonts change.
const fitLayers = new WeakMap();
const fitting = new Set();
let fitObserver = null;
let fontsWatched = false;

/** Shrink a text element's font (and bold text in proportion) until its content fits its box. */
export function fitText(element, layer = fitLayers.get(element)) {
  if (!layer?.autoFit || !element?.isConnected) return;
  if (!(element.clientHeight > 0 && element.clientWidth > 0)) return;
  const base = layer.fontSize, minimum = Math.min(base, layer.minFontSize ?? 6);
  const apply = size => {
    element.style.fontSize = `${size}px`;
    if (layer.strongFontSize !== undefined) for (const strong of element.querySelectorAll?.("strong") ?? []) strong.style.fontSize = `${layer.strongFontSize * size / base}px`;
  };
  const fits = () => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
  apply(base);
  if (fits()) return;
  let low = minimum, high = base;
  for (let step = 0; step < 12 && high - low > 0.25; step++) {
    const middle = (low + high) / 2;
    apply(middle);
    if (fits()) low = middle; else high = middle;
  }
  apply(Math.floor(low * 4) / 4);
}

/** Keep a text element fitted after content or size changes; does nothing unless the layer asks for it. */
export function keepFitted(element, layer) {
  if (!layer?.autoFit) {
    if (fitLayers.has(element)) { fitLayers.delete(element); fitting.delete(element); fitObserver?.unobserve?.(element); element.style.fontSize = `${layer?.fontSize ?? 48}px`; }
    return;
  }
  fitLayers.set(element, layer);
  if (!fitting.has(element) && typeof globalThis.ResizeObserver === "function") {
    fitObserver ??= new globalThis.ResizeObserver(entries => {
      for (const { target } of entries) {
        if (target.isConnected === false) { fitObserver.unobserve?.(target); fitting.delete(target); continue; }
        fitText(target);
      }
    });
    fitObserver.observe(element);
    fitting.add(element);
  }
  if (!fontsWatched && typeof globalThis.document?.fonts?.addEventListener === "function") {
    fontsWatched = true;
    globalThis.document.fonts.addEventListener("loadingdone", () => { for (const target of fitting) fitText(target); });
  }
  fitText(element, layer);
}
