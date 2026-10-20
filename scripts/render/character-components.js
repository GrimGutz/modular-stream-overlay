import { validateAssetPath } from "../core/schema.js";
import { requestedFields, renderTemplate } from "../data/bindings.js";

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
  let image = null, track = null, fill = null, label = null, text = null;
  const numberFields = requestedFields(layer).filter(field => layer.type !== "character-portrait" && (layer.type !== "resource-bar" || layer.showValue));
  const displayedNumbers = new Map(), numberTokens = new Map(), numberKeys = new Set(), forcedFields = new Map();
  const keyFor = field => `component:${layer.id}:${field}`;
  const settings = () => motion?.settings?.transition ?? {};
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const invalidate = field => {
    numberTokens.set(field, (numberTokens.get(field) ?? 0) + 1);
    motion?.controller?.cancelNumber?.(keyFor(field), { finish: false });
    numberKeys.delete(field);
  };
  const redrawText = () => {
    if (disposed) return;
    if (layer.type === "resource-bar") {
      if (label) label.textContent = resourceAvailable ? `${displayValues[layer.binding]} / ${displayValues[layer.maxBinding]}` : context.mode === "preview" ? layer.fallback : "";
    } else if (text) {
      if (layer.text) text.textContent = renderTemplate(layer.text, displayValues, layer.fallback);
      else {
        const value = displayValues[layer.binding];
        const valid = layer.type === "dynamic-number" ? finite(actualValues[layer.binding])
          : typeof value === "string" || finite(value);
        text.textContent = valid ? String(value) : layer.fallback;
      }
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
      const current = values[layer.binding], maximum = values[layer.maxBinding];
      const previouslyAvailable = resourceAvailable;
      resourceAvailable = finite(current) && finite(maximum) && maximum > 0;
      if (!track) {
        track = document.createElement("div");
        track.className = "mso-resource-track";
        track.style.backgroundColor = layer.backgroundColor;
        fill = document.createElement("div");
        fill.className = "mso-resource-fill";
        fill.style.backgroundColor = layer.foregroundColor;
        track.append(fill);
        if (layer.showValue) {
          label = textElement(layer, "");
          label.className += " mso-resource-label";
          track.append(label);
        }
      }
      const targetPercent = resourceAvailable ? Math.max(0, Math.min(100, current / maximum * 100)) : 0;
      const barField = "$bar", token = (numberTokens.get(barField) ?? 0) + 1;
      const previousPercent = finite(previousValues[layer.binding]) && finite(previousValues[layer.maxBinding]) && previousValues[layer.maxBinding] > 0
        ? Math.max(0, Math.min(100, previousValues[layer.binding] / previousValues[layer.maxBinding] * 100)) : 0;
      const onPercent = value => {
        if (disposed || numberTokens.get(barField) !== token) return;
        displayedPercent = value;
        fill.style.width = `${value}%`;
      };
      if (resourceAvailable && previouslyAvailable && settings().bar && targetPercent !== previousPercent && motion?.controller?.transitionNumber) {
        numberTokens.set(barField, token);
        numberKeys.add(barField);
        void motion.controller.transitionNumber(keyFor(barField), displayedPercent, targetPercent, settings(), onPercent);
      } else if (!resourceAvailable || !previouslyAvailable || !settings().bar || !motion?.controller?.transitionNumber) {
        invalidate(barField);
        displayedPercent = targetPercent;
        fill.style.width = `${targetPercent}%`;
      }
      if (!previouslyAvailable) previousValues = {};
      updateNumbers();
      redrawText();
      // Unsupported resources produce no pretend health indicator on air.
      if (resourceAvailable || context.mode === "preview") mount(track); else element.replaceChildren();
      previousValues = { ...values };
      return;
    }
    if (!text) text = textElement(layer, "");
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

function textElement(layer, value) {
  const element = document.createElement("div");
  element.className = "mso-text-content";
  element.textContent = value ?? "";
  Object.assign(element.style, {
    fontFamily: `"${layer.fontFamily}", ${["Georgia", "Times New Roman"].includes(layer.fontFamily) ? "serif" : layer.fontFamily === "Courier New" ? "monospace" : "sans-serif"}`,
    fontSize: `${layer.fontSize}px`, fontWeight: layer.fontWeight, color: layer.color,
    textAlign: layer.align, textShadow: layer.shadow ? "0 2px 4px rgba(0,0,0,0.8)" : "none"
  });
  return element;
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
