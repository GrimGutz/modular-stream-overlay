import { validateMappings } from "../data/mappings.js";
import { t, uiText, errorText, localizeDOM, setText, setAttr } from "./i18n.js";

const STATUS_LABELS = Object.freeze({
  "unsupported-actor-type": "unavailable for this Actor type",
  "unverified-version": "system version not verified",
  "unsupported-field": "unsupported field",
  unavailable: "unavailable"
});

export function fieldLabel(field) {
  const custom = field.providerId === "mapping";
  const builtIn = ["generic", "cain", "dnd5e", "derived"].includes(field.providerId);
  const group = field.group ? `${builtIn ? uiText(field.group) : field.group} · ` : custom ? `${t("Fields.CustomFields")} · ` : "";
  const status = STATUS_LABELS[field.status] ? uiText(STATUS_LABELS[field.status]) : "";
  return `${group}${builtIn ? uiText(field.label) : field.label}${field.legacyGlobal ? ` · ${t("Fields.AllSystems")}` : ""}${status ? ` · ${status}` : ""}`;
}

/** Presentation only: preserve IDs and keep legacy fields available at the end. */
export function sortedFields(fields) {
  return [...fields].sort((a, b) => Number(/legacy/i.test(a.group ?? "")) - Number(/legacy/i.test(b.group ?? ""))
    || String(a.group ?? "").localeCompare(String(b.group ?? "")));
}

function option(select, value, label, selected = false) {
  const entry = document.createElement("option"); entry.value = value; entry.textContent = label;
  entry.defaultSelected = selected;
  select.append(entry); return entry;
}

function dialogMarkers(dialog, titleKey) {
  const root = dialog.element;
  const title = root?.querySelector(".window-title"); if (title) setText(title, titleKey);
  const ok = root?.querySelector('[data-action="ok"]'); if (ok) setText(ok, "Buttons.Save");
  localizeDOM(root);
}

export async function openAdapterSettings({ api, characterData }) {
  const state = characterData?.getAdapterState?.();
  if (!state?.systemId || !api?.setAdapterPreferences) throw new Error(t("Fields.ProvidersNotReady"));
  const preferences = api.getAdapterPreferences();
  const content = document.createElement("div");
  const help = document.createElement("p");
  setText(help, "Fields.ProviderHelp", { system: state.systemId, version: state.systemVersion || "", warning: state.warning ? errorText(state.warning) : "" });
  const label = document.createElement("label"), caption = document.createElement("span"); setText(caption, "Fields.ProviderTitle"); label.append(caption);
  const select = document.createElement("select"); select.name = "provider"; setAttr(select, "aria-label", "Fields.ProviderTitle");
  setText(option(select, "", "", !preferences[state.systemId]), "Fields.Auto");
  const candidates = api.adapters.list().filter(adapter => adapter.systemId === state.systemId);
  for (const adapter of candidates) {
    const entry = option(select, adapter.id, adapter.label, preferences[state.systemId] === adapter.id);
    const key = { cain: "Fields.CainProvider", dnd5e: "Fields.DndProvider" }[adapter.id];
    if (key) setText(entry, key);
  }
  if (preferences[state.systemId] && !candidates.some(adapter => adapter.id === preferences[state.systemId])) {
    setText(option(select, preferences[state.systemId], "", true), "Fields.UnavailableProvider", { name: preferences[state.systemId] });
  }
  label.append(select); content.append(help, label);
  const result = await foundry.applications.api.DialogV2.input({ window: { title: t("Fields.ProviderTitle") }, content, modal: true, rejectClose: false, ok: { label: t("Buttons.Save") },
    render: (_event, dialog) => dialogMarkers(dialog, "Fields.ProviderTitle") });
  if (!result) return;
  const next = { ...preferences };
  if (result.provider) next[state.systemId] = result.provider;
  else delete next[state.systemId];
  await api.setAdapterPreferences(next);
}

export async function previewFieldMappings(service, reference, text) {
  let input;
  try { input = JSON.parse(text); } catch { throw new Error(t("Fields.ValidJSONRequired")); }
  const mappings = validateMappings(input);
  if (!reference) throw new Error(t("Fields.ChooseVisibleCharacter"));
  if (!service?.previewMappings) throw new Error(t("Fields.PreviewNotReady"));
  const result = await service.previewMappings(reference, mappings);
  return { values: result.values, fieldStatus: result.fieldStatus, warning: result.warning };
}

/** DialogV2 rebuilds content from HTML, so defaults are serialized and listeners bind on render. */
export async function openFieldMappings({ api, characterData }) {
  const content = document.createElement("div");
  const help = document.createElement("p");
  setText(help, "Fields.MappingHelp");
  const textarea = document.createElement("textarea"); textarea.name = "mappings"; textarea.rows = 14; textarea.style.width = "100%";
  setAttr(textarea, "aria-label", "Fields.MappingJSON");
  textarea.textContent = JSON.stringify(api?.getFieldMappings?.() ?? [], null, 2);
  const label = document.createElement("label"), caption = document.createElement("span"); setText(caption, "Fields.PreviewCharacter"); label.append(caption);
  const select = document.createElement("select"); select.name = "mappingPreviewActor"; setAttr(select, "aria-label", "Fields.PreviewCharacter");
  setText(option(select, "", "", true), "Fields.ChoosePermittedCharacter");
  for (const actor of characterData?.listActors?.() ?? []) option(select, actor.uuid, actor.name);
  label.append(select);
  const button = document.createElement("button"); button.type = "button"; setText(button, "Fields.PreviewMappings"); button.setAttribute("data-mapping-preview", "");
  const output = document.createElement("pre"); output.setAttribute("data-mapping-result", ""); output.setAttribute("aria-live", "polite");
  output.style.whiteSpace = "pre-wrap"; output.style.maxHeight = "240px"; output.style.overflow = "auto";
  content.append(help, textarea, label, button, output);
  let active = true, generation = 0;
  let result;
  try {
    result = await foundry.applications.api.DialogV2.input({ window: { title: t("Fields.MappingTitle") }, content, modal: true, rejectClose: false, ok: { label: t("Buttons.Save") },
      render: (_event, dialog) => {
        dialogMarkers(dialog, "Fields.MappingTitle");
        const root = dialog.element, editor = root.querySelector('[name="mappings"]');
        const actor = root.querySelector('[name="mappingPreviewActor"]'), preview = root.querySelector("[data-mapping-preview]");
        const status = root.querySelector("[data-mapping-result]");
        const invalidate = () => { generation++; preview.disabled = false; setText(status, "Fields.PreviewOutdated"); };
        editor.addEventListener("input", invalidate); actor.addEventListener("change", invalidate);
        preview.addEventListener("click", () => {
          const current = ++generation; preview.disabled = true; setText(status, "Fields.ReadingFields");
          void previewFieldMappings(characterData, actor.value, editor.value).then(value => {
            if (active && generation === current) setText(status, "Fields.PreviewResult", { result: JSON.stringify({ ...value, warning: value.warning ? errorText(value.warning) : value.warning }, null, 2) });
          }, error => {
            if (active && generation === current) setText(status, "Fields.PreviewResult", { result: errorText(error) || t("Fields.UnavailableFields") });
          }).finally(() => { if (active && generation === current) preview.disabled = false; });
        });
      }
    });
  } finally { active = false; generation++; }
  if (!result) return;
  let mappings;
  try { mappings = JSON.parse(result.mappings); } catch { throw new Error(t("Fields.JSONArrayRequired")); }
  mappings = validateMappings(mappings);
  if (!api?.setFieldMappings) throw new Error(t("Fields.MappingsNotReady"));
  await api.setFieldMappings(mappings);
}
