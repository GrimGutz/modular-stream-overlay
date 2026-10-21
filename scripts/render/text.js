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

/** Border, rounded corners and drop shadow on a layer's own geometry element. */
export function applyBoxStyle(element, layer) {
  const width = layer.borderWidth ?? 0;
  element.style.border = width > 0 ? `${width}px solid ${layer.borderColor ?? "#000000"}` : "";
  element.style.borderRadius = layer.cornerRadius ? `${layer.cornerRadius}px` : "";
  element.style.boxShadow = layer.boxShadowColor
    ? `${layer.boxShadowX ?? 0}px ${layer.boxShadowY ?? 0}px ${layer.boxShadowBlur ?? 0}px ${layer.boxShadowColor}` : "";
}
