import { validateAssetPath, parseValueLabels } from "../core/schema.js";
import { ACCENT_FIELD, requestedFields, renderTemplate, renderTemplateLines } from "../data/bindings.js";
import { createTextElement, keepFitted, safeColor, usesSpans, writeTextContent } from "./text.js";

const TYPES = new Set(["character-portrait", "character-name", "dynamic-text", "dynamic-number", "resource-bar"]);
export const isCharacterComponent = type => TYPES.has(type);
const roundedDecimal = value => Math.abs(value) >= 1e15 ? value : Math.round((value + Math.sign(value) * Number.EPSILON * Math.max(1, Math.abs(value))) * 100) / 100;

/** One small live DOM binding. Documents and system paths never enter the renderer. */
export function mountCharacterComponent({ element, layer, context, resolveAsset, motion = null }) {
  const service = context.characterData;
  const actorUuid = context.actorUuid ?? context.previewActorUuid ?? "";
  let disposed = false, generation = 0;
  let previousValues = {}, actualValues = {}, displayValues = {}, resourceAvailable = false;
  let displayedPercent = 0;
  let image = null, track = null, fill = null, label = null, text = null, dotRow = null;
  let dotCount = 0;
  const numberFields = requestedFields(layer).filter(field => layer.type !== "character-portrait" && (layer.type !== "resource-bar" || layer.showValue));
  const displayedNumbers = new Map(), numberTokens = new Map(), numberKeys = new Set(), forcedFields = new Map();
  const keyFor = field => `component:${layer.id}:${field}`;
  const settings = () => motion?.settings?.transition ?? {};
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const labels = parseValueLabels(layer.valueLabels);
  // A character's profile accent replaces the authored color only when one is set.
  const accent = () => layer.accent || layer.strongAccent ? safeColor(actualValues[ACCENT_FIELD]) : null;
  const fillColor = () => (layer.accent ? accent() : null) ?? layer.foregroundColor;
  const maximumOf = values => layer.maxValue ?? values[layer.maxBinding];
  // Vertical columns fill from the top ("down") or like a gauge from the bottom ("up").
  const vertical = layer.dotDirection === "down" || layer.dotDirection === "up";
  const fillSide = { right: "to right", down: "to bottom", up: "to top" }[layer.dotDirection ?? "right"];
  const redrawDots = percent => {
    if (!dotRow || !dotCount) return;
    const units = Math.max(0, Math.min(dotCount, percent / 100 * dotCount)), color = fillColor();
    for (let index = 0; index < dotCount; index++) {
      const dot = dotRow.children[index], fraction = Math.round(Math.max(0, Math.min(1, units - index)) * 1e9) / 1e9;
      dot.dataset.resourceFill = String(fraction);
      dot.style.backgroundColor = fraction === 1 ? color : "transparent";
      dot.style.backgroundImage = fraction > 0 && fraction < 1
        ? `linear-gradient(${fillSide}, ${color} ${fraction * 100}%, transparent ${fraction * 100}%)` : "none";
    }
  };
  const prepareDots = (current, maximum) => {
    // One Document value can never allocate an unbounded number of DOM nodes.
    const dots = layer.display === "dots" && resourceAvailable && Number.isInteger(maximum) && maximum <= 60;
    const unavailable = layer.display === "dots" && !resourceAvailable;
    track.className = `mso-resource-track${dots || unavailable ? " mso-resource-dots" : ""}`;
    track.dataset.resourceDisplay = dots ? "dots" : unavailable ? "unavailable" : "bar";
    fill.style.display = dots || unavailable ? "none" : "";
    if (dotRow) dotRow.style.display = dots ? "" : "none";
    if (label) label.style.display = resourceAvailable && !layer.showValue ? "none" : "";
    if (!dots) return;
    if (!dotRow) {
      dotRow = document.createElement("div"); dotRow.className = "mso-resource-dot-row";
      if (vertical) {
        track.style.flexDirection = "column";
        Object.assign(dotRow.style, { flexDirection: layer.dotDirection === "up" ? "column-reverse" : "column", width: "100%", height: "auto" });
        if (label) label.style.margin = "8px 0 0";
      }
      // Keep the optional numeric label after the circles without overlaying their fill.
      track.replaceChildren(fill, dotRow, ...(label ? [label] : []));
    }
    if (dotCount !== maximum) {
      dotCount = maximum;
      const dots = Array.from({ length: dotCount }, () => {
        const dot = document.createElement("span"); dot.className = "mso-resource-dot";
        dot.style.borderColor = layer.backgroundColor;
        if (layer.dotBorderWidth !== undefined) dot.style.borderWidth = `${layer.dotBorderWidth}px`;
        return dot;
      });
      dotRow.replaceChildren(...dots);
    }
    const length = vertical ? layer.height : layer.width, cross = vertical ? layer.width : layer.height;
    const reserved = !layer.showValue ? 0 : vertical ? Math.min(length * .3, layer.fontSize * 1.3 + 8)
      : Math.min(layer.width * .55, `${current} / ${maximum}`.length * layer.fontSize * .62 + 8);
    const available = Math.max(1, length - reserved), unit = available / maximum;
    // Explicit circle metrics let pips line up with printed artwork.
    const gap = layer.dotGap ?? Math.min(8, unit * .3);
    const diameter = layer.dotSize ?? Math.max(.5, Math.min(32, cross, (available - gap * (maximum - 1)) / maximum));
    dotRow.style.gap = `${gap}px`;
    for (const dot of dotRow.children) { dot.style.width = `${diameter}px`; dot.style.height = `${diameter}px`; }
    redrawDots(displayedPercent);
  };
  const invalidate = field => {
    numberTokens.set(field, (numberTokens.get(field) ?? 0) + 1);
    motion?.controller?.cancelNumber?.(keyFor(field), { finish: false });
    numberKeys.delete(field);
  };
  const redrawText = () => {
    if (disposed) return;
    if (layer.type === "resource-bar") {
      if (label) label.textContent = resourceAvailable ? `${displayValues[layer.binding]} / ${maximumOf(displayValues)}` : context.mode === "preview" ? layer.fallback : "";
    } else if (text) {
      const color = (layer.accent ? accent() : null) ?? layer.color;
      if (text.style.color !== color) text.style.color = color;
      let content;
      if (layer.text && (usesSpans(layer) || layer.hideEmptyLines)) {
        content = renderTemplateLines(layer.text, displayValues, { fallback: layer.fallback, labels, richText: layer.richText, hideEmptyLines: layer.hideEmptyLines });
        if (!usesSpans(layer)) content = content.map(line => line.map(segment => segment.text).join("")).join("\n");
        else if (layer.emptyText && content.every(line => line.every(segment => !segment.text.trim()))) content = layer.emptyText;
      } else if (layer.text) content = renderTemplate(layer.text, displayValues, layer.fallback, { labels });
      else {
        const value = displayValues[layer.binding];
        const valid = layer.type === "dynamic-number" ? finite(actualValues[layer.binding])
          : typeof value === "string" || finite(value);
        content = valid ? String(value) : layer.fallback;
      }
      // An empty Actor list may have a meaningful caption, such as "none".
      if (typeof content === "string" && layer.emptyText && !content.trim()) content = layer.emptyText;
      writeTextContent(text, layer, content, { accent: accent() });
      keepFitted(text, layer);
    }
  };
  const animateField = (field, from, to, config) => {
    const token = (numberTokens.get(field) ?? 0) + 1;
    numberTokens.set(field, token);
    numberKeys.add(field);
    const integer = Number.isInteger(from) && Number.isInteger(to);
    const onValue = value => {
      if (disposed || numberTokens.get(field) !== token) return;
      displayedNumbers.set(field, value);
      displayValues[field] = value === to ? to : integer ? Math.round(value) : roundedDecimal(value);
      if (value === to) { numberKeys.delete(field); forcedFields.delete(field); }
      redrawText();
    };
    if (!motion?.controller?.transitionNumber) { onValue(to); return; }
    void motion.controller.transitionNumber(keyFor(field), displayedNumbers.get(field) ?? from, to, config, onValue);
  };
  const updateNumbers = () => {
    for (const field of numberFields) {
      const value = actualValues[field], previous = previousValues[field];
      if (forcedFields.has(field)) {
        if (value === forcedFields.get(field) && finite(displayedNumbers.get(field))) {
          displayValues[field] = Number.isInteger(value) ? Math.round(displayedNumbers.get(field)) : roundedDecimal(displayedNumbers.get(field));
          continue;
        }
        forcedFields.delete(field);
      }
      if (!finite(value) || !finite(previous) || !settings().numeric || !resourceAvailable && layer.type === "resource-bar") {
        invalidate(field);
        if (finite(value)) displayedNumbers.set(field, value); else displayedNumbers.delete(field);
        continue;
      }
      if (value !== previous) animateField(field, previous, value, settings());
      else if (numberKeys.has(field) && displayedNumbers.has(field)) {
        const displayed = displayedNumbers.get(field);
        displayValues[field] = displayed === value ? value : Number.isInteger(previous) && Number.isInteger(value) ? Math.round(displayed) : roundedDecimal(displayed);
      }
    }
  };
  const mount = child => {
    if (element.children[0] !== child || element.children.length !== 1) element.replaceChildren(child);
  };
  const paint = ({ values = {}, warning = null } = {}) => {
    if (disposed) return;
    if (motion && context.debug?.()) {
      motion.diagnostics.missingBindings = requestedFields(layer).filter(field => values[field] === undefined || values[field] === null);
      motion.diagnostics.resolutionError = Boolean(warning);
    }
    actualValues = { ...values };
    displayValues = { ...values };
    if (context.mode === "preview") {
      element.dataset.characterWarning = warning ?? "";
      element.title = warning ?? layer.name;
    }
    if (layer.type === "character-portrait") {
      const source = values[layer.binding] || layer.src;
      const imageURL = safePortraitURL(source, resolveAsset);
      if (!imageURL) { element.replaceChildren(); return; }
      if (!image) {
        image = document.createElement("img");
        image.alt = ""; image.draggable = false;
        image.className = "mso-character-portrait";
        Object.assign(image.style, { width: "100%", height: "100%", objectFit: layer.fit,
          borderRadius: layer.circular ? "50%" : `${layer.borderRadius}px` });
        if (layer.imagePosition) image.style.objectPosition = `center ${layer.imagePosition}`;
        image.addEventListener("error", () => { image.style.visibility = "hidden"; });
      }
      if (image.dataset.portraitSource !== imageURL) {
        image.style.visibility = "";
        image.dataset.portraitSource = imageURL;
        image.src = imageURL;
      }
      mount(image);
      return;
    }
    if (layer.type === "resource-bar") {
      const current = values[layer.binding], maximum = maximumOf(values);
      const previouslyAvailable = resourceAvailable;
      resourceAvailable = finite(current) && finite(maximum) && maximum > 0;
      if (!track) {
        track = document.createElement("div");
        track.className = "mso-resource-track";
        track.style.backgroundColor = layer.backgroundColor;
        fill = document.createElement("div");
        fill.className = "mso-resource-fill";
        track.append(fill);
        if (layer.showValue || layer.display === "dots") {
          label = createTextElement(layer);
          label.className += " mso-resource-label";
          track.append(label);
        }
      }
      fill.style.backgroundColor = fillColor();
      prepareDots(current, maximum);
      const targetPercent = resourceAvailable ? Math.max(0, Math.min(100, current / maximum * 100)) : 0;
      const barField = "$bar", token = (numberTokens.get(barField) ?? 0) + 1;
      const previousMaximum = maximumOf(previousValues);
      const previousPercent = finite(previousValues[layer.binding]) && finite(previousMaximum) && previousMaximum > 0
        ? Math.max(0, Math.min(100, previousValues[layer.binding] / previousMaximum * 100)) : 0;
      const onPercent = value => {
        if (disposed || numberTokens.get(barField) !== token) return;
        displayedPercent = value;
        fill.style.width = `${value}%`;
        redrawDots(value);
      };
      if (resourceAvailable && previouslyAvailable && settings().bar && targetPercent !== previousPercent && motion?.controller?.transitionNumber) {
        numberTokens.set(barField, token);
        numberKeys.add(barField);
        void motion.controller.transitionNumber(keyFor(barField), displayedPercent, targetPercent, settings(), onPercent);
      } else if (!resourceAvailable || !previouslyAvailable || !settings().bar || !motion?.controller?.transitionNumber) {
        invalidate(barField);
        displayedPercent = targetPercent;
        fill.style.width = `${targetPercent}%`;
        redrawDots(targetPercent);
      }
      if (!previouslyAvailable) previousValues = {};
      updateNumbers();
      redrawText();
      // Unsupported resources produce no pretend health indicator on air.
      if (resourceAvailable || context.mode === "preview") mount(track); else element.replaceChildren();
      previousValues = { ...values };
      return;
    }
    if (!text) text = createTextElement(layer);
    mount(text);
    updateNumbers();
    redrawText();
    previousValues = { ...values };
  };
  const refresh = async () => {
    const current = ++generation;
    let result;
    try {
      result = service && actorUuid ? await service.resolve(actorUuid, requestedFields(layer), { portraitSource: layer.portraitSource })
        : { values: {}, warning: "Assign an Actor and configure an OBS viewer to preview live data." };
    } catch { result = { values: {}, warning: "The assigned Actor could not be resolved." }; }
    if (!disposed && current === generation) paint(result);
  };
  paint();
  const unsubscribe = service && actorUuid ? service.subscribe(actorUuid, () => { void refresh(); }) : null;
  return {
    ready: refresh(),
    /** A visual action only; the Actor's authoritative value is never changed. */
    animateNumber(event, config = settings()) {
      if (disposed || layer.type === "resource-bar" && !resourceAvailable || !numberFields.includes(event?.field) || !finite(event.previous) || !finite(event.current)) return false;
      const field = event.field;
      actualValues[field] = event.current;
      displayValues[field] = displayedNumbers.get(field) ?? event.previous;
      forcedFields.set(field, event.current);
      animateField(field, event.previous, event.current, config);
      return true;
    },
    destroy() {
      disposed = true; generation++; unsubscribe?.();
      for (const field of [...numberKeys]) invalidate(field);
      numberTokens.clear(); displayedNumbers.clear(); forcedFields.clear();
    }
  };
}

/** Actor artwork may use a managed asset or a credential-free HTTP(S) image URL. */
export function safePortraitURL(value, resolveAsset = value => value) {
  if (typeof value !== "string" || !value || value.length > 4096) return "";
  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      return !url.username && !url.password && ["http:", "https:"].includes(url.protocol) ? url.href : "";
    }
    return resolveAsset(validateAssetPath(value));
  } catch { return ""; }
}
