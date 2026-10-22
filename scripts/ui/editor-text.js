/**
 * Interface text for the overlay editor and its panels. Labels are `L(key)` dictionary keys or
 * `S(literal)` engine captions, so a language change can relabel nodes in place.
 */
import { t, uiText, errorText, localizeDOM, setText, setAttr } from "./i18n.js";

export const L = (key, params = {}) => ({ key, params });
export const S = literal => ({ literal });
export const labelText = label => label?.key ? t(label.key, label.params) : label?.literal !== undefined ? uiText(label.literal) : String(label ?? "");

const errorNodes = new WeakMap();
const validityMessages = new WeakMap();
const editorErrors = new WeakMap();

/** An Error whose message follows the interface language. */
export function editorError(key) {
  const error = new Error(t(key));
  editorErrors.set(error, L(key));
  return error;
}

export function writeText(element, label) {
  if (label?.key) {
    element.textContent = "";
    setText(element, label.key, label.params);
  }
  else {
    element.removeAttribute?.("data-i18n");
    element.textContent = labelText(label);
  }
  if (element.dataset) {
    if (label?.literal !== undefined) element.dataset.editorUiText = label.literal;
    else delete element.dataset.editorUiText;
  }
}

export function writeAttr(element, attribute, label) {
  if (label?.key) setAttr(element, attribute, label.key, label.params);
  else element.setAttribute(attribute, labelText(label));
}

export function writeError(element, error, prefixKey) {
  errorNodes.set(element, { error, prefixKey });
  if (element.dataset) element.dataset.editorError = "";
  const message = editorErrors.has(error) ? labelText(editorErrors.get(error)) : errorText(error);
  writeText(element, prefixKey ? L(prefixKey, { error: message }) : message);
}

export function setValidity(input, message) {
  validityMessages.set(input, message);
  if (input.dataset) input.dataset.editorValidity = "";
  input.setCustomValidity(message?.key ? labelText(message) : editorErrors.has(message) ? labelText(editorErrors.get(message)) : errorText(message));
}

export function markDialog(dialog, title, affirmative) {
  const heading = dialog.element?.querySelector(".window-title");
  if (heading) writeText(heading, title);
  const button = affirmative && dialog.element?.querySelector('[data-action="yes"]');
  if (button) writeText(button, affirmative);
  const ok = dialog.element?.querySelector('[data-action="ok"]');
  if (ok) setText(ok, "Buttons.Confirm");
  const no = dialog.element?.querySelector('[data-action="no"]');
  if (no) setText(no, "Buttons.Cancel");
  localizeDOM(dialog.element);
}

/** Relabel engine captions, error messages and validity messages written by these helpers. */
export function relabelEditorText(root) {
  for (const node of root.querySelectorAll("[data-editor-ui-text]")) node.textContent = uiText(node.dataset.editorUiText);
  for (const node of root.querySelectorAll("[data-editor-error]")) {
    const source = errorNodes.get(node);
    if (source) writeError(node, source.error, source.prefixKey);
  }
  for (const input of root.querySelectorAll("[data-editor-validity]")) {
    if (validityMessages.has(input)) setValidity(input, validityMessages.get(input));
  }
}
