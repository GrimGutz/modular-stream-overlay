/**
 * Layer properties for the overlay editor and widget designer: geometry, content, typography,
 * optional styles and animations. Edits change only the private draft.
 */
import { validateLayer, validateAssetPath, FONT_WEIGHTS, OPTIONAL_LAYER_KEYS, CLIP_SHAPES, FADE_EDGES } from "../core/schema.js";
import { fontFamilies } from "../integration/fonts.js";
import { createLayer } from "../core/layers.js";
import { renderAnimationControls } from "./animation-controls.js";
import { validateAnimationSettings, validateTriggerRules } from "../animation/schema.js";
import { fieldLabel } from "./field-settings.js";
import { t, setText, setAttr } from "./i18n.js";
import { L, S, writeText, writeAttr, setValidity } from "./editor-text.js";

const BOX_KEYS = ["borderWidth", "borderColor", "cornerRadius", "boxShadowX", "boxShadowY", "boxShadowBlur", "boxShadowColor"];
const SHAPE_KEYS = ["clipShape", "clipSize", "maskSrc", "fadeEdge", "fadeSize"];
const TEXT_KEYS = ["lineHeight", "letterSpacing", "uppercase", "verticalAlign", "padding", "highlightColor", "richText", "strongColor", "strongFontSize", "accent", "strongAccent", "emptyText", "hideEmptyLines", "valueLabels", "autoFit", "minFontSize"];
const DOT_KEYS = ["accent", "maxValue", "dotSize", "dotGap", "dotBorderWidth", "dotDirection"];
const OPTIONAL_NUMBERS = ["borderWidth", "cornerRadius", "boxShadowX", "boxShadowY", "boxShadowBlur", "lineHeight", "letterSpacing", "padding", "strongFontSize", "maxValue", "dotSize", "dotGap", "dotBorderWidth", "minFontSize", "clipSize", "fadeSize", "gradientAngle"];
const clone = value => foundry.utils.deepClone(value);
const ALIGN_BUTTONS = [
  ["left", "Editor.ArrangeLeft", "fa-objects-align-left"], ["center", "Editor.ArrangeCenter", "fa-objects-align-center-horizontal"],
  ["right", "Editor.ArrangeRight", "fa-objects-align-right"], ["top", "Editor.ArrangeTop", "fa-objects-align-top"],
  ["middle", "Editor.ArrangeMiddle", "fa-objects-align-center-vertical"], ["bottom", "Editor.ArrangeBottom", "fa-objects-align-bottom"]
];
const DISTRIBUTE_BUTTONS = [["distribute-x", "Editor.DistributeHorizontal", "fa-distribute-spacing-horizontal"], ["distribute-y", "Editor.DistributeVertical", "fa-distribute-spacing-vertical"]];

export const LayerInspector = Base => class extends Base {
  /** Browser-safe and Foundry fonts; a saved family missing from this world stays selectable. */
  _fontChoices(current) {
    const families = fontFamilies();
    return current && !families.includes(current) ? [...families, current] : families;
  }

  /** Align buttons: to the canvas for one layer, to the selection with distribution for several. */
  _renderArrangeButtons(host, { several = false, distribute = false, disabled = false } = {}) {
    const section = document.createElement("div");
    section.className = "mso-arrange";
    const title = document.createElement("span");
    setText(title, several ? "Editor.AlignSelection" : "Editor.AlignOnCanvas");
    const buttons = document.createElement("div");
    buttons.className = "mso-arrange-buttons";
    for (const [action, key, icon] of several ? [...ALIGN_BUTTONS, ...DISTRIBUTE_BUTTONS] : ALIGN_BUTTONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mso-icon-button";
      button.dataset.arrange = action;
      setAttr(button, "title", key); setAttr(button, "aria-label", key);
      const glyph = document.createElement("i"); glyph.className = `fa-solid ${icon}`; glyph.setAttribute("aria-hidden", "true");
      button.append(glyph);
      button.disabled = disabled || this._uploading || (action.startsWith("distribute-") && !distribute);
      button.addEventListener("click", () => { void this._draftOperation(() => this._arrange(action)); });
      buttons.append(button);
    }
    section.append(title, buttons);
    host.append(section);
  }

  /** Several selected layers: their group, shared properties, alignment and commands for all of them. */
  _renderSelectionProperties(host, layers) {
    const movable = layers.filter(layer => !layer.locked);
    const count = document.createElement("p");
    count.className = "mso-selection-count";
    setText(count, "Editor.SelectionCount", { count: layers.length });
    host.append(count);
    this._renderGroupControls(host, layers);
    this._renderSharedProperties(host, layers);
    this._renderArrangeButtons(host, { several: true, distribute: movable.length >= 3, disabled: !movable.length });
    const commands = document.createElement("div");
    commands.className = "mso-layer-commands";
    for (const [key, command] of [["Editor.BringFront", "front"], ["Editor.SendBack", "back"], ["Editor.Duplicate", "duplicate"], ["Editor.Delete", "delete"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.selectionCommand = command;
      setText(button, key);
      button.disabled = this._uploading || (command === "delete" && !movable.length);
      button.addEventListener("click", () => { void this._draftOperation(() => this._selectionCommand(command)); });
      commands.append(button);
    }
    host.append(commands);
    const help = document.createElement("p");
    help.className = "mso-help";
    setText(help, "Editor.SelectionHelp");
    host.append(help);
  }

  /** Exactly one whole group: its name and Ungroup. Anything else: Group. */
  _renderGroupControls(host, layers) {
    const groups = new Set(layers.map(layer => layer.groupId));
    const [groupId] = groups;
    const whole = groups.size === 1 && groupId && this._allLayers().filter(layer => layer.groupId === groupId).length === layers.length;
    const section = document.createElement("div");
    section.className = "mso-group-controls";
    if (whole) {
      const label = document.createElement("label"); label.className = "mso-layer-field";
      const caption = document.createElement("span"); setText(caption, "Editor.GroupNameField");
      const input = document.createElement("input"); input.type = "text"; input.maxLength = 80; input.dataset.groupNameField = "";
      input.value = layers[0].groupName ?? ""; input.disabled = this._uploading;
      setAttr(input, "aria-label", "Editor.GroupNameField");
      input.addEventListener("change", () => {
        void this._draftOperation(async () => {
          if (!await this._renameGroup(groupId, input.value)) { input.value = layers[0].groupName ?? ""; }
        });
      });
      label.append(caption, input);
      section.append(label);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.groupAction = whole ? "ungroup" : "group";
    setText(button, whole ? "Editor.Ungroup" : "Editor.Group");
    button.disabled = this._uploading;
    button.addEventListener("click", () => { void this._draftOperation(() => whole ? this._ungroupSelection() : this._groupSelection()); });
    section.append(button);
    if (!whole && [...groups].some(Boolean)) {
      const ungroup = document.createElement("button");
      ungroup.type = "button"; ungroup.dataset.groupAction = "ungroup";
      setText(ungroup, "Editor.Ungroup"); ungroup.disabled = this._uploading;
      ungroup.addEventListener("click", () => { void this._draftOperation(() => this._ungroupSelection()); });
      section.append(ungroup);
    }
    host.append(section);
  }

  /**
   * Fields every selected layer can share: opacity, visibility, lock and, where layers have them,
   * font, size, weight and color. A blank field or "mixed" choice means the values differ.
   */
  _renderSharedProperties(host, layers) {
    const section = document.createElement("div");
    section.className = "mso-shared-properties";
    const grid = document.createElement("div");
    grid.className = "mso-property-grid";
    const field = (parent, key, label, { type = "text", options, min, max, step } = {}) => {
      const applicable = layers.filter(layer => Object.hasOwn(layer, key));
      if (!applicable.length) return;
      const values = new Set(applicable.map(layer => String(layer[key])));
      const mixed = values.size > 1;
      const wrapper = document.createElement("label");
      wrapper.className = `mso-layer-field${type === "checkbox" ? " mso-checkbox-field" : ""}`;
      const caption = document.createElement("span"); setText(caption, label);
      const input = document.createElement(options ? "select" : "input");
      input.dataset.sharedField = key;
      setAttr(input, "aria-label", label);
      if (options) {
        if (mixed) { const option = document.createElement("option"); option.value = ""; setText(option, "Editor.MixedValues"); input.append(option); }
        for (const value of options) { const option = document.createElement("option"); option.value = String(value); option.textContent = String(value); input.append(option); }
        input.value = mixed ? "" : String(applicable[0][key]);
      } else {
        input.type = type;
        if (type === "checkbox") { input.checked = applicable.every(layer => layer[key]); input.indeterminate = mixed; }
        else { input.value = mixed ? "" : String(applicable[0][key]); if (mixed) setAttr(input, "placeholder", "Editor.MixedValues"); }
        for (const [name, value] of Object.entries({ min, max, step })) if (value !== undefined) input[name] = String(value);
      }
      input.disabled = this._uploading;
      input.addEventListener(options || type === "checkbox" ? "change" : "input", () => this._onSharedInput(input, applicable, key));
      if (type === "checkbox") wrapper.append(input, caption); else wrapper.append(caption, input);
      parent.append(wrapper);
    };
    field(grid, "opacity", "Editor.Opacity", { type: "number", min: 0, max: 1, step: .01 });
    field(grid, "fontSize", "Editor.FontSize", { type: "number", min: 1, max: 512, step: "any" });
    field(grid, "fontWeight", "Editor.FontWeight", { options: FONT_WEIGHTS });
    field(grid, "color", "Editor.Color", {});
    section.append(grid);
    const fonts = layers.filter(layer => Object.hasOwn(layer, "fontFamily"));
    field(section, "fontFamily", "Editor.Font", { options: [...new Set(fonts.flatMap(layer => this._fontChoices(layer.fontFamily)))] });
    const toggles = document.createElement("div");
    toggles.className = "mso-property-grid";
    field(toggles, "visible", "Editor.Visible", { type: "checkbox" });
    field(toggles, "locked", "Editor.Locked", { type: "checkbox" });
    section.append(toggles);
    host.append(section);
  }

  _onSharedInput(input, layers, key) {
    if (this._busy || this._uploading || !layers.every(layer => this._allLayers().includes(layer))) return;
    let value = input.type === "checkbox" ? input.checked : input.value;
    if (value === "") return;
    if (["opacity", "fontSize"].includes(key)) value = input.value.trim() === "" ? NaN : Number(input.value);
    try {
      const validated = layers.map(layer => validateLayer({ ...layer, [key]: value }, this._draft.canvas));
      layers.forEach((layer, index) => Object.assign(layer, validated[index]));
      setValidity(input, "");
      if (input.type === "checkbox") input.indeterminate = false;
      this._markDirty();
      void this._updatePreview().then(() => { if (["visible", "locked"].includes(key)) this._renderLayerPanel(); });
    }
    catch (error) { setValidity(input, error); }
  }

  _layerField(host, layer, field, label, { type = "text", min, max, step, options, maxLength } = {}) {
    const wrapper = document.createElement("label");
    wrapper.className = `mso-layer-field${type === "checkbox" ? " mso-checkbox-field" : ""}`;
    const title = document.createElement("span");
    writeText(title, label);
    const input = document.createElement(options ? "select" : type === "textarea" ? "textarea" : "input");
    if (!options && type !== "textarea") input.type = type;
    input.dataset.layerField = field;
    writeAttr(input, "aria-label", label);
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    if (step !== undefined) input.step = String(step);
    if (maxLength !== undefined) input.maxLength = maxLength;
    if (options) {
      for (const option of options) {
        const entry = document.createElement("option");
        entry.value = String(option.value ?? option);
        writeText(entry, option.label ?? option);
        if (option.fieldId) entry.dataset.editorFieldId = option.fieldId;
        input.append(entry);
      }
    }
    if (type === "checkbox") input.checked = !!layer[field];
    else input.value = String(layer[field] ?? "");
    const invalidKey = `layer.${layer.id}.${field}`;
    if (this._invalidInputs.has(invalidKey)) {
      if (type === "checkbox") input.checked = this._invalidInputs.get(invalidKey);
      else input.value = this._invalidInputs.get(invalidKey);
      setValidity(input, L("Editor.CorrectLayer"));
    }
    input.disabled = this._uploading;
    input.addEventListener("input", event => this._onLayerInput(event));
    if (type === "checkbox") wrapper.append(input, title);
    else wrapper.append(title, input);
    host.append(wrapper);
    return input;
  }

  _renderLayerProperties() {
    this._actorStatusUnsubscribe?.();
    this._actorStatusUnsubscribe = null;
    this._carouselPanel = null;
    this._carouselLabelsGeneration = (this._carouselLabelsGeneration ?? 0) + 1;
    const host = this.element?.querySelector("[data-layer-properties]");
    if (!host) return;
    host.replaceChildren();
    const selection = this._selectedLayers();
    if (selection.length > 1) { this._renderSelectionProperties(host, selection); return; }
    const layer = this._selectedLayer();
    const note = document.createElement("p");
    note.className = "mso-help";
    if (!layer) {
      setText(note, "Editor.SelectLayerHelp");
      host.append(note);
      return;
    }
    this._layerField(host, layer, "name", L("Editor.LayerName"), { maxLength: 80 });
    const geometry = document.createElement("div");
    geometry.className = "mso-property-grid";
    for (const [field, label, min, max] of [
      ["x", "X", -32768, 32768], ["y", "Y", -32768, 32768],
      ["width", L("Editor.Width"), 1, 7680], ["height", L("Editor.Height"), 1, 7680],
      ["rotation", L("Editor.Rotation"), -360, 360], ["opacity", L("Editor.Opacity"), 0, 1]
    ]) this._layerField(geometry, layer, field, label, { type: "number", min, max, step: field === "opacity" ? .01 : "any" });
    host.append(geometry);
    this._renderArrangeButtons(host, { disabled: !!layer.locked });
    const toggles = document.createElement("div");
    toggles.className = "mso-property-grid";
    this._layerField(toggles, layer, "visible", L("Editor.Visible"), { type: "checkbox" });
    this._layerField(toggles, layer, "locked", L("Editor.Locked"), { type: "checkbox" });
    host.append(toggles);
    if (layer.type === "image") {
      this._layerField(host, layer, "src", L("Editor.ImageSource"), { maxLength: 4096 });
      const images = document.createElement("div");
      images.className = "mso-image-actions";
      for (const [label, callback] of [[L("Editor.UploadImage"), () => this._uploadImage()], [L("Editor.BrowseExisting"), () => { void this._draftOperation(() => this._browseImage()); }]]) {
        const button = document.createElement("button");
        button.type = "button";
        writeText(button, label);
        button.disabled = this._uploading;
        button.addEventListener("click", callback);
        images.append(button);
      }
      host.append(images);
      this._layerField(host, layer, "fit", L("Editor.ImageScaling"), { options: ["contain", "cover", "stretch"].map(value => ({ value, label: S(value) })) });
      this._layerField(host, layer, "lockAspectRatio", L("Editor.LockAspect"), { type: "checkbox" });
      if (!layer.src) {
        const hint = document.createElement("p");
        hint.className = "mso-help";
        setText(hint, "Editor.EmptyImageHelp");
        host.append(hint);
      }
    }
    else if (layer.type === "text") {
      this._layerField(host, layer, "text", L("Editor.TextContent"), { type: "textarea", maxLength: 10000 });
      this._layerField(host, layer, "fontFamily", L("Editor.Font"), { options: this._fontChoices(layer.fontFamily) });
      const typography = document.createElement("div");
      typography.className = "mso-property-grid";
      this._layerField(typography, layer, "fontSize", L("Editor.FontSize"), { type: "number", min: 1, max: 512, step: "any" });
      this._layerField(typography, layer, "fontWeight", L("Editor.FontWeight"), { options: FONT_WEIGHTS });
      this._layerField(typography, layer, "color", L("Editor.TextColor"), { maxLength: 9 });
      this._layerField(typography, layer, "align", L("Editor.Alignment"), { options: ["left", "center", "right"].map(value => ({ value, label: S(value) })) });
      host.append(typography);
      this._layerField(host, layer, "shadow", L("Editor.TextShadow"), { type: "checkbox" });
    }
    else if (layer.type === "color") {
      this._layerField(host, layer, "color", L("Editor.Color"));
      // An optional second color turns the fill into a gradient.
      const gradient = document.createElement("div"); gradient.className = "mso-property-grid";
      this._layerField(gradient, layer, "gradientTo", L("Editor.GradientTo"), { maxLength: 11 });
      this._layerField(gradient, layer, "gradientType", L("Editor.GradientType"), { options: [{ value: "", label: L("Editor.GradientLinear") }, { value: "radial", label: L("Editor.GradientRadial") }] });
      this._layerField(gradient, layer, "gradientAngle", L("Editor.GradientAngle"), { type: "number", min: 0, max: 360, step: 1 });
      host.append(gradient);
    }
    this._renderComponentProperties(host, layer);
    this._renderStyleProperties(host, layer);
    this._renderAnimationControls(host, layer);
    const commands = document.createElement("div");
    commands.className = "mso-layer-commands";
    for (const [label, command] of [[L("Editor.MoveUp"), "up"], [L("Editor.MoveDown"), "down"], [L("Editor.BringFront"), "front"], [L("Editor.SendBack"), "back"], [L("Editor.Duplicate"), "duplicate"], [L("Editor.Delete"), "delete"]]) {
      commands.append(this._layerButton(label, command, layer.id, { disabled: command === "delete" && layer.locked }));
    }
    host.append(commands);
    setText(note, "Editor.KeyboardHelp");
    host.append(note);
  }

  _renderAnimationControls(host, target, { wholeDesign = false } = {}) {
    const preset = target.type === "character-widget" ? this.widgetPresets?.list().find(entry => entry.id === target.presetId) : null;
    const targets = this._animationTargets(target, { wholeDesign, preset });
    const controls = document.createElement("div");
    controls.className = "mso-animation-controls";
    const key = `animation.${wholeDesign ? "self" : target.id}`;
    if (preset) {
      const inheritLabel = document.createElement("label"); inheritLabel.className = "mso-layer-field mso-checkbox-field";
      const inherit = document.createElement("input"); inherit.type = "checkbox"; inherit.dataset.animationControl = ""; inherit.checked = !target.animationOverrides; inherit.disabled = this._uploading;
      const caption = document.createElement("span"); setText(caption, "Editor.InheritMotion");
      inherit.addEventListener("change", () => {
        if (this._uploading || this._busy) return;
        target.animationOverrides = !inherit.checked;
        if (target.animationOverrides) { target.animations = clone(preset.animations); target.triggers = clone(preset.triggers); }
        this._invalidInputs.delete(key); this._animationEdits.delete(key); this._markDirty(); this._animationPreviewUpdate = this._updatePreview(); this._renderLayerProperties();
      });
      inheritLabel.append(inherit, caption); host.append(inheritLabel);
      if (!target.animationOverrides) {
        const note = document.createElement("p"); note.className = "mso-help"; setText(note, "Editor.InheritedMotionHelp"); host.append(note);
      }
    }
    const inherited = !!preset && !target.animationOverrides;
    const effective = inherited ? preset : target;
    renderAnimationControls(controls, {
      value: { animations: effective.animations, triggers: effective.triggers },
      draftValue: this._animationEdits.get(key),
      fields: this._fieldDefinitions(target), targets,
      disabled: this._uploading, readOnly: inherited,
      onChange: value => {
        if (this._busy || this._uploading || inherited) return;
        target.animations = validateAnimationSettings(value.animations);
        target.triggers = validateTriggerRules(value.triggers);
        this._invalidInputs.delete(key); this._animationEdits.delete(key); this._markDirty();
        this._animationPreviewUpdate = this._updatePreview();
      },
      onDraftChange: value => { this._animationEdits.set(key, value); this._markDirty(); },
      onInvalid: message => { if (message) this._invalidInputs.set(key, message); else this._invalidInputs.delete(key); },
      onPreview: config => this._previewAnimation(wholeDesign ? "self" : target.id, config),
      onReset: () => this._preview?.renderer?.resetAnimations(wholeDesign ? "self" : target.id),
      onTriggerPreview: ruleId => this._previewTrigger(wholeDesign ? "self" : target.id, ruleId)
    });
    host.append(controls);
  }

  _renderSharedWidgetAnimations() {
    const host = this.element?.querySelector("[data-widget-animations]");
    if (!host || !this.widgetMode || !this._draft) return;
    host.replaceChildren();
    this._renderAnimationControls(host, this._draft, { wholeDesign: true });
  }

  async _previewAnimation(id, configuration) {
    await this._animationPreviewUpdate;
    return this._preview?.renderer?.previewAnimation(id, configuration);
  }

  async _previewTrigger(id, ruleId) {
    await this._animationPreviewUpdate;
    return this._preview?.renderer?.previewTrigger(id, ruleId);
  }

  _renderComponentProperties(host, layer) {
    if (layer.type === "character-widget") { this._renderWidgetProperties(host, layer); return; }
    if (!this.widgetMode) return;
    if (["image", "text", "character-portrait", "character-name", "dynamic-text", "dynamic-number"].includes(layer.type)) {
      const label = document.createElement("label"); label.className = "mso-layer-field"; setText(label, "Editor.ContentSource");
      const source = document.createElement("select"); setAttr(source, "aria-label", "Editor.ContentSource");
      for (const [value, text] of [["static", L("Editor.StaticContent")], ["dynamic", L("Editor.DynamicContent")]]) { const option = document.createElement("option"); option.value = value; writeText(option, text); source.append(option); }
      source.value = ["image", "text"].includes(layer.type) ? "static" : "dynamic";
      source.addEventListener("change", () => { void this._draftOperation(() => this._setContentSource(source.value)); });
      label.append(source); host.append(label);
    }
    const dynamic = ["character-name", "dynamic-text", "dynamic-number", "resource-bar"].includes(layer.type);
    if (layer.type === "character-portrait") {
      this._layerField(host, layer, "portraitSource", L("Editor.PortraitArtwork"), { options: [{ value: "profile", label: L("Editor.ProfileImage") }, { value: "token", label: L("Editor.TokenArtwork") }] });
      this._layerField(host, layer, "fit", L("Editor.ImageScaling"), { options: ["contain", "cover"].map(value => ({ value, label: S(value) })) });
      this._layerField(host, layer, "circular", L("Editor.CircularPortrait"), { type: "checkbox" });
      this._layerField(host, layer, "borderRadius", L("Editor.CornerRadius"), { type: "number", min: 0, max: 3840 });
      this._layerField(host, layer, "lockAspectRatio", L("Editor.LockAspect"), { type: "checkbox" });
      this._layerField(host, layer, "src", L("Editor.FallbackImage"), { maxLength: 4096 });
    }
    if (dynamic) {
      const fields = this._fieldDefinitions(layer);
      const choices = fields.filter(field => !["dynamic-number", "resource-bar"].includes(layer.type) || field.type === "number").map(field => ({ value: field.id, label: fieldLabel(field), fieldId: field.id }));
      const optionsFor = value => choices.some(option => option.value === value) ? choices : [{ value: value ?? "", label: value ? L("Editor.FieldUnavailable", { field: value }) : L("Editor.NoNumericFields") }, ...choices];
      this._layerField(host, layer, "binding", L("Editor.CharacterField"), { options: optionsFor(layer.binding) });
      if (layer.type === "resource-bar") {
        this._layerField(host, layer, "maxBinding", L("Editor.MaximumField"), { options: optionsFor(layer.maxBinding) });
        const pair = document.createElement("button"); pair.type = "button"; setText(pair, "Editor.MatchingMaximum"); pair.disabled = this._uploading;
        pair.addEventListener("click", () => {
          if (this._busy || this._uploading) return;
          if (!this._useResourceMaximum(layer)) ui.notifications.info(t("Editor.NoMaximum"));
        });
        host.append(pair);
        this._layerField(host, layer, "display", L("Editor.ResourceDisplay"), { options: [
          { value: "bar", label: L("Editor.ResourceBar") }, { value: "dots", label: L("Editor.ResourceDots") }
        ] });
        const displayHelp = document.createElement("p"); displayHelp.className = "mso-help"; setText(displayHelp, "Editor.ResourceDotsHelp"); host.append(displayHelp);
        this._layerField(host, layer, "foregroundColor", L("Editor.FillColor"), { maxLength: 9 });
        this._layerField(host, layer, "backgroundColor", L("Editor.TrackColor"), { maxLength: 9 });
        this._layerField(host, layer, "showValue", L("Editor.ShowValues"), { type: "checkbox" });
      }
      else {
        const template = this._layerField(host, layer, "text", L("Editor.TextTemplate"), { type: "textarea", maxLength: 10000 });
        const insertLabel = document.createElement("label"); insertLabel.className = "mso-layer-field"; setText(insertLabel, "Editor.InsertFieldTemplate");
        const insert = document.createElement("select"); setAttr(insert, "aria-label", "Editor.InsertTemplateField");
        for (const field of fields) { const option = document.createElement("option"); option.value = field.id; option.dataset.editorFieldId = field.id; option.textContent = fieldLabel(field); insert.append(option); }
        const button = document.createElement("button"); button.type = "button"; setText(button, "Editor.InsertField"); button.disabled = !fields.length;
        button.addEventListener("click", () => {
          const token = `{${insert.value}}`; const start = template.selectionStart ?? template.value.length; const end = template.selectionEnd ?? start;
          template.value = `${template.value.slice(0, start)}${token}${template.value.slice(end)}`;
          this._onLayerInput({ currentTarget: template }); template.focus();
        });
        insertLabel.append(insert, button); host.append(insertLabel);
      }
      this._layerField(host, layer, "fallback", L("Editor.MissingValue"), { maxLength: 1000 });
      this._layerField(host, layer, "fontFamily", L("Editor.Font"), { options: this._fontChoices(layer.fontFamily) });
      this._layerField(host, layer, "fontSize", L("Editor.FontSize"), { type: "number", min: 1, max: 512, step: "any" });
      this._layerField(host, layer, "fontWeight", L("Editor.FontWeight"), { options: FONT_WEIGHTS });
      this._layerField(host, layer, "color", L("Editor.TextColor"), { maxLength: 9 });
      this._layerField(host, layer, "align", L("Editor.Alignment"), { options: ["left", "center", "right"].map(value => ({ value, label: S(value) })) });
      this._layerField(host, layer, "shadow", L("Editor.TextShadow"), { type: "checkbox" });
      const help = document.createElement("p"); help.className = "mso-help"; setText(help, "Editor.FieldsHelp"); host.append(help);
    }
  }

  /** Optional presentation; an empty field keeps the default look. */
  _renderStyleProperties(host, layer) {
    const textual = ["text", "character-name", "dynamic-text", "dynamic-number"].includes(layer.type);
    const dynamic = textual && layer.type !== "text";
    const section = (key, open = false) => {
      const details = document.createElement("details"); details.className = "mso-style-section"; details.open = open;
      const summary = document.createElement("summary"); setText(summary, key); details.append(summary);
      host.append(details); return details;
    };
    const grid = parent => { const element = document.createElement("div"); element.className = "mso-property-grid"; parent.append(element); return element; };
    const number = (parent, field, key, min, max, step = "any") => this._layerField(parent, layer, field, L(key), { type: "number", min, max, step });
    const color = (parent, field, key) => this._layerField(parent, layer, field, L(key), { maxLength: 9 });
    const check = (parent, field, key) => this._layerField(parent, layer, field, L(key), { type: "checkbox" });
    if (textual) {
      const text = section("Editor.TextLayoutSection", TEXT_KEYS.some(key => layer[key] !== undefined));
      const metrics = grid(text);
      number(metrics, "lineHeight", "Editor.LineHeight", 0.5, 5, 0.05);
      number(metrics, "letterSpacing", "Editor.LetterSpacing", -50, 200);
      number(metrics, "padding", "Editor.TextPadding", 0, 500);
      this._layerField(metrics, layer, "verticalAlign", L("Editor.VerticalAlign"), { options: [
        { value: "", label: L("Editor.StyleDefault") }, { value: "top", label: L("Editor.AlignTop") },
        { value: "middle", label: L("Editor.AlignMiddle") }, { value: "bottom", label: L("Editor.AlignBottom") }] });
      check(text, "uppercase", "Editor.Uppercase");
      const fit = grid(text);
      check(fit, "autoFit", "Editor.AutoFit");
      number(fit, "minFontSize", "Editor.MinFontSize", 1, 512);
      color(text, "highlightColor", "Editor.HighlightColor");
      check(text, "richText", "Editor.RichText");
      const strong = grid(text);
      color(strong, "strongColor", "Editor.StrongColor");
      number(strong, "strongFontSize", "Editor.StrongFontSize", 1, 512);
      if (dynamic) {
        check(text, "accent", "Editor.AccentText");
        check(text, "strongAccent", "Editor.StrongAccent");
        check(text, "hideEmptyLines", "Editor.HideEmptyLines");
        this._layerField(text, layer, "emptyText", L("Editor.EmptyText"), { maxLength: 1000 });
        this._layerField(text, layer, "valueLabels", L("Editor.ValueLabels"), { type: "textarea", maxLength: 4000 });
      }
      const help = document.createElement("p"); help.className = "mso-help"; setText(help, dynamic ? "Editor.TextLayoutHelp" : "Editor.StaticMarkupHelp"); text.append(help);
    }
    if (layer.type === "resource-bar") {
      const dots = section("Editor.CirclesSection", DOT_KEYS.some(key => layer[key] !== undefined));
      check(dots, "accent", "Editor.AccentFill");
      const metrics = grid(dots);
      number(metrics, "maxValue", "Editor.FixedMaximum", 1, 60, 1);
      number(metrics, "dotSize", "Editor.DotSize", 1, 256);
      number(metrics, "dotGap", "Editor.DotGap", 0, 256);
      number(metrics, "dotBorderWidth", "Editor.DotBorderWidth", 0, 32);
      this._layerField(metrics, layer, "dotDirection", L("Editor.DotDirection"), { options: [
        { value: "", label: L("Editor.StyleDefault") }, { value: "right", label: L("Editor.DotRight") },
        { value: "down", label: L("Editor.DotDown") }, { value: "up", label: L("Editor.DotUp") }] });
      const help = document.createElement("p"); help.className = "mso-help"; setText(help, "Editor.CirclesHelp"); dots.append(help);
    }
    if (layer.type === "character-portrait") {
      this._layerField(host, layer, "imagePosition", L("Editor.ImagePosition"), { options: [
        { value: "", label: L("Editor.StyleDefault") }, { value: "top", label: L("Editor.AlignTop") },
        { value: "center", label: L("Editor.AlignMiddle") }, { value: "bottom", label: L("Editor.AlignBottom") }] });
    }
    const box = section("Editor.BoxStyleSection", BOX_KEYS.some(key => layer[key] !== undefined));
    const border = grid(box);
    number(border, "borderWidth", "Editor.BorderWidth", 0, 64);
    color(border, "borderColor", "Editor.BorderColor");
    number(border, "cornerRadius", "Editor.BoxCornerRadius", 0, 3840);
    const shadow = grid(box);
    number(shadow, "boxShadowX", "Editor.ShadowX", -200, 200);
    number(shadow, "boxShadowY", "Editor.ShadowY", -200, 200);
    number(shadow, "boxShadowBlur", "Editor.ShadowBlur", 0, 200);
    color(shadow, "boxShadowColor", "Editor.ShadowColor");
    const help = document.createElement("p"); help.className = "mso-help"; setText(help, "Editor.BoxStyleHelp"); box.append(help);
    // Shape, mask image and faded edges clip the whole layer.
    const shape = section("Editor.ShapeSection", SHAPE_KEYS.some(key => layer[key] !== undefined));
    const outline = grid(shape);
    this._layerField(outline, layer, "clipShape", L("Editor.ClipShape"), { options: [{ value: "", label: L("Editor.ShapeRectangle") }, ...CLIP_SHAPES.map(value => ({ value, label: L(`Editor.Shape.${value}`) }))] });
    number(outline, "clipSize", "Editor.ClipSize", 0, 2000);
    const mask = this._layerField(shape, layer, "maskSrc", L("Editor.MaskImage"), { maxLength: 4096 });
    const browse = document.createElement("button"); browse.type = "button"; setText(browse, "Editor.BrowseExisting"); browse.disabled = this._uploading;
    browse.addEventListener("click", () => { void this._draftOperation(() => this._browseLayerAsset(layer, "maskSrc", mask)); });
    shape.append(browse);
    const fade = grid(shape);
    this._layerField(fade, layer, "fadeEdge", L("Editor.FadeEdge"), { options: [{ value: "", label: L("Editor.FadeNone") }, ...FADE_EDGES.map(value => ({ value, label: L(`Editor.Fade.${value}`) }))] });
    number(fade, "fadeSize", "Editor.FadeSize", 1, 100, 1);
    const shapeHelp = document.createElement("p"); shapeHelp.className = "mso-help"; setText(shapeHelp, "Editor.ShapeHelp"); shape.append(shapeHelp);
  }

  /** Pick an image from Foundry's files for a layer field such as a mask. */
  async _browseLayerAsset(layer, field, input) {
    const draft = this._draft;
    const picker = new foundry.applications.apps.FilePicker.implementation({ type: "image", current: layer[field] ?? "", allowUpload: false,
      callback: path => {
        if (this._draft !== draft || !this._allLayers().includes(layer)) return;
        void this._draftOperation(async () => {
          Object.assign(layer, validateLayer({ ...layer, [field]: validateAssetPath(path) }, this._draft.canvas));
          if (input) input.value = layer[field] ?? "";
          this._invalidInputs.delete(`layer.${layer.id}.${field}`);
          this._markDirty();
          await this._updatePreview();
        });
      } });
    await picker.render({ force: true });
  }

  _useResourceMaximum(layer = this._selectedLayer()) {
    if (layer?.type !== "resource-bar") return false;
    const fields = this._fieldDefinitions(layer);
    const maximum = fields.find(field => field.id === layer.binding)?.maxField;
    if (!maximum || fields.find(field => field.id === maximum)?.type !== "number") return false;
    Object.assign(layer, validateLayer({ ...layer, maxBinding: maximum }, this._draft.canvas));
    this._invalidInputs.delete(`layer.${layer.id}.maxBinding`);
    this._markDirty(); this._syncLayerFields(layer); void this._updatePreview();
    return true;
  }

  async _setContentSource(source) {
    const layer = this._selectedLayer(); if (!layer) return;
    const image = ["image", "character-portrait"].includes(layer.type);
    const type = source === "static" ? image ? "image" : "text" : image ? "character-portrait" : "dynamic-text";
    if (type === layer.type) return;
    const replacement = { ...createLayer(type, this._draft.canvas), ...layer, type };
    if (source === "dynamic" && !image) { replacement.binding = "character.name"; replacement.text = "{character.name}"; }
    Object.assign(layer, validateLayer(replacement, this._draft.canvas));
    this._markDirty(); await this._updatePreview(); this._renderLayerProperties();
  }

  _onLayerInput(event) {
    if (this._busy || this._uploading) return;
    const layer = this._selectedLayer();
    if (!layer) return;
    const input = event.currentTarget;
    const field = input.dataset.layerField;
    const numeric = new Set(["x", "y", "width", "height", "rotation", "opacity", "fontSize", "borderRadius", ...OPTIONAL_NUMBERS]);
    const allowed = new Set(["name", "x", "y", "width", "height", "rotation", "opacity", "visible", "locked", "src", "fit", "lockAspectRatio", "text", "fontFamily", "fontSize", "fontWeight", "color", "align", "shadow", "binding", "maxBinding", "fallback", "portraitSource", "circular", "borderRadius", "foregroundColor", "backgroundColor", "showValue", "display", ...OPTIONAL_LAYER_KEYS]);
    if (!allowed.has(field)) return;
    let value = input.type === "checkbox" ? input.checked : input.value;
    // Clearing an optional style restores its default instead of failing validation.
    if (OPTIONAL_LAYER_KEYS.includes(field) && input.type !== "checkbox" && input.value.trim() === "") value = undefined;
    else if (numeric.has(field)) value = input.value.trim() === "" ? NaN : Number(input.value);
    try {
      const patch = { [field]: value };
      if (field === "binding" && layer.text === `{${layer.binding}}`) patch.text = `{${value}}`;
      const validated = validateLayer({ ...layer, ...patch }, this._draft.canvas, this._editingLayers().indexOf(layer));
      for (const key of OPTIONAL_LAYER_KEYS) if (!Object.hasOwn(validated, key)) delete layer[key];
      Object.assign(layer, validated);
      setValidity(input, "");
      this._invalidInputs.delete(`layer.${layer.id}.${field}`);
      this._markDirty();
      this._syncLayerFields(layer, { skip: input });
      this._updateLayerRow(layer);
      void this._updatePreview();
    }
    catch (error) {
      setValidity(input, error);
      this._invalidInputs.set(`layer.${layer.id}.${field}`, input.type === "checkbox" ? input.checked : input.value);
      this._markDirty();
    }
  }

  _syncLayerFields(layer, { skip } = {}) {
    if (!layer || layer.id !== this._selectedLayerId) return;
    this.element?.querySelectorAll("[data-layer-field]").forEach(input => {
      if (input === skip) return;
      const field = input.dataset.layerField;
      // Keep unfinished entries visible until that property is corrected or reloaded.
      if (this._invalidInputs.has(`layer.${layer.id}.${field}`)) return;
      if (input.type === "checkbox") input.checked = !!layer[field];
      else input.value = String(layer[field] ?? "");
      setValidity(input, "");
      this._invalidInputs.delete(`layer.${layer.id}.${field}`);
    });
    this.element?.querySelectorAll('[data-layer-command="delete"]').forEach(button => {
      button.disabled = !!layer.locked || this._uploading;
    });
  }

  _updateLayerRow(layer) {
    this.element?.querySelectorAll("[data-layer-id]").forEach(row => {
      if (row.dataset.layerId !== layer.id) return;
      const name = row.querySelector("[data-layer-name]");
      if (name) name.textContent = layer.name;
      for (const [command, active, yes, no] of [["visible", layer.visible, L("Editor.Visible"), L("Editor.Hidden")], ["locked", !!layer.locked, L("Editor.Locked"), L("Editor.Unlocked")]]) {
        const button = row.querySelector(`[data-layer-command="${command}"]`);
        if (!button) continue;
        writeText(button, active ? yes : no);
        writeAttr(button, "title", active ? yes : no);
        writeAttr(button, "aria-label", active ? yes : no);
        button.setAttribute("aria-pressed", String(active));
      }
    });
  }
};
