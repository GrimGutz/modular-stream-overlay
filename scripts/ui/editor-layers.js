/**
 * The Layers panel: rows in stacking order (top first), groups with their members, visibility
 * and lock toggles, and drag and drop that restacks layers or moves them into or out of groups.
 * Groups are layers sharing a group ID; they move, hide and lock together.
 */
import { layerOrder, groupLayers, ungroupLayers, renameGroup, moveLayers } from "../core/layers.js";
import { t, setText, setAttr } from "./i18n.js";
import { L, writeText, writeAttr } from "./editor-text.js";

const TYPE_ICONS = { text: "T", image: "▧" };

export const LayerList = Base => class extends Base {
  _layerButton(label, command, id, { disabled = false, pressed } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    writeText(button, label);
    writeAttr(button, "title", label);
    writeAttr(button, "aria-label", label);
    button.dataset.layerCommand = command;
    button.disabled = disabled || this._uploading;
    if (pressed !== undefined) button.setAttribute("aria-pressed", String(pressed));
    button.addEventListener("click", event => {
      event.preventDefault();
      const toggle = command === "select" && (event.shiftKey || event.ctrlKey || event.metaKey);
      void this._draftOperation(() => toggle ? this._toggleSelection(id) : this._layerCommand(command, id));
    });
    return button;
  }

  _layerOrder() { return this._editingOverlay() ? layerOrder(this._editingOverlay()) : []; }
  _groupMembers(groupId) { return this._layerOrder().filter(layer => layer.groupId === groupId); }

  _renderLayerPanel() {
    const list = this.element?.querySelector("[data-layer-list]");
    if (!list) return;
    list.replaceChildren();
    const order = this._layerOrder();
    if (!order.length) {
      const message = document.createElement("p");
      message.className = "mso-help";
      setText(message, "Editor.EmptyLayers");
      list.append(message);
    }
    const selected = new Set(this._selectedLayerIds);
    this._collapsedGroups ??= new Set();
    const shown = new Set();
    for (const layer of order) {
      if (!layer.groupId) { list.append(this._layerRow(layer, selected)); continue; }
      if (shown.has(layer.groupId)) continue;
      shown.add(layer.groupId);
      const members = order.filter(entry => entry.groupId === layer.groupId);
      list.append(this._groupRow(layer.groupId, members, selected));
      if (!this._collapsedGroups.has(layer.groupId)) for (const member of members) list.append(this._layerRow(member, selected, true));
    }
    const count = this.element.querySelector("[data-layer-count]");
    if (count) count.textContent = String(order.length);
    this._renderLayerProperties();
  }

  _layerRow(layer, selected, member = false) {
    const row = document.createElement("div");
    row.className = `mso-layer-row${member ? " mso-group-member" : ""}${selected.has(layer.id) ? " selected" : ""}${layer.id === this._selectedLayerId ? " primary" : ""}`;
    row.dataset.layerId = layer.id;
    const select = this._layerButton(layer.name, "select", layer.id, { pressed: selected.has(layer.id) });
    select.className = "mso-layer-select";
    select.textContent = "";
    const icon = document.createElement("span");
    icon.className = "mso-layer-type";
    icon.textContent = TYPE_ICONS[layer.type] ?? "■";
    icon.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.dataset.layerName = "";
    name.textContent = layer.name;
    select.append(icon, name);
    const visible = this._layerButton(layer.visible ? L("Editor.Visible") : L("Editor.Hidden"), "visible", layer.id, { pressed: layer.visible });
    visible.className = "mso-layer-toggle";
    const locked = this._layerButton(layer.locked ? L("Editor.Locked") : L("Editor.Unlocked"), "locked", layer.id, { pressed: !!layer.locked });
    locked.className = "mso-layer-toggle";
    row.append(select, visible, locked);
    // Dragging a selected layer carries the whole selection.
    this._dragRow(row, () => selected.has(layer.id) && selected.size > 1 ? this._selectedLayers().map(entry => entry.id) : [layer.id]);
    return row;
  }

  _groupRow(groupId, members, selected) {
    const all = members.every(layer => selected.has(layer.id));
    const row = document.createElement("div");
    row.className = `mso-layer-row mso-group-row${all ? " selected" : ""}`;
    row.dataset.groupId = groupId;
    const collapsed = this._collapsedGroups.has(groupId);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "mso-group-toggle";
    toggle.textContent = collapsed ? "▸" : "▾";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    setAttr(toggle, "aria-label", collapsed ? "Editor.ExpandGroup" : "Editor.CollapseGroup");
    setAttr(toggle, "title", collapsed ? "Editor.ExpandGroup" : "Editor.CollapseGroup");
    toggle.addEventListener("click", event => {
      event.preventDefault();
      if (collapsed) this._collapsedGroups.delete(groupId); else this._collapsedGroups.add(groupId);
      this._renderLayerPanel();
    });
    const select = document.createElement("button");
    select.type = "button";
    select.className = "mso-layer-select";
    select.setAttribute("aria-pressed", String(all));
    const icon = document.createElement("span");
    icon.className = "mso-layer-type"; icon.textContent = "❐"; icon.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.dataset.groupName = "";
    name.textContent = members[0]?.groupName ?? t("Editor.GroupName", { index: "" }).trim();
    const count = document.createElement("span");
    count.className = "mso-muted"; count.textContent = ` ${members.length}`;
    select.append(icon, name, count);
    select.title = name.textContent;
    select.disabled = this._uploading;
    select.addEventListener("click", event => {
      event.preventDefault();
      const ids = members.map(layer => layer.id);
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        const current = this._selectedLayerIds;
        this._selectLayers(all ? current.filter(id => !ids.includes(id)) : [...current, ...ids.filter(id => !current.includes(id))]);
      } else this._selectLayers(ids, ids[0]);
    });
    const visible = members.every(layer => layer.visible), locked = members.every(layer => layer.locked);
    const toggles = [["visible", visible, L("Editor.Visible"), L("Editor.Hidden")], ["locked", locked, L("Editor.Locked"), L("Editor.Unlocked")]].map(([command, active, yes, no]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mso-layer-toggle";
      button.dataset.groupCommand = command;
      writeText(button, active ? yes : no); writeAttr(button, "title", active ? yes : no); writeAttr(button, "aria-label", active ? yes : no);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = this._uploading;
      button.addEventListener("click", event => { event.preventDefault(); void this._draftOperation(() => this._groupCommand(groupId, command)); });
      return button;
    });
    row.append(toggle, select, ...toggles);
    this._dragRow(row, () => members.map(layer => layer.id), groupId);
    return row;
  }

  /** Show, hide, lock or unlock every member of a group. */
  async _groupCommand(groupId, command) {
    if (!["visible", "locked"].includes(command)) return;
    return this._historyStep(async () => {
      const members = this._groupMembers(groupId);
      if (!members.length) return;
      const value = !members.every(layer => (command === "visible" ? layer.visible : layer.locked));
      for (const layer of members) layer[command] = value;
      await this._afterLayerEdit();
    });
  }

  /** Group the selected layers (Ctrl/Cmd+G). */
  async _groupSelection() {
    const layers = this._selectedLayers();
    if (layers.length < 2) { ui.notifications.info(t("Editor.GroupNeedsTwo")); return; }
    return this._historyStep(async () => {
      const groups = new Set(this._allLayers().map(layer => layer.groupId).filter(Boolean));
      groupLayers(this._editingOverlay(), layers.map(layer => layer.id), t("Editor.GroupName", { index: groups.size + 1 }));
      await this._afterLayerEdit();
    });
  }

  /** Ungroup every group touched by the selection (Ctrl/Cmd+Shift+G). */
  async _ungroupSelection() {
    const groups = new Set(this._selectedLayers().map(layer => layer.groupId).filter(Boolean));
    if (!groups.size) return;
    return this._historyStep(async () => {
      ungroupLayers(this._editingOverlay(), groups);
      await this._afterLayerEdit();
    });
  }

  async _renameGroup(groupId, name) {
    const value = String(name ?? "").trim();
    if (!value || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) return false;
    await this._historyStep(async () => {
      renameGroup(this._editingOverlay(), groupId, value);
      this._markDirty();
      this.element?.querySelectorAll(`[data-group-id="${globalThis.CSS?.escape?.(groupId) ?? groupId}"] [data-group-name]`).forEach(node => { node.textContent = value; });
    });
    return true;
  }

  async _afterLayerEdit() {
    this._markDirty();
    await this._updatePreview();
    this._selectLayers(this._selectedLayerIds, this._selectedLayerId);
  }

  _dragRow(row, ids, groupId = null) {
    row.draggable = !this._uploading;
    const half = event => { const bounds = row.getBoundingClientRect(); return event.clientY - bounds.top > bounds.height / 2; };
    const clear = () => this.element?.querySelectorAll(".mso-drop-before, .mso-drop-after").forEach(node => node.classList.remove("mso-drop-before", "mso-drop-after"));
    row.addEventListener("dragstart", event => {
      this._listDrag = { ids: ids(), groupId };
      event.dataTransfer?.setData?.("text/plain", "");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      row.classList.add("mso-dragging");
    });
    row.addEventListener("dragend", () => { this._listDrag = null; row.classList.remove("mso-dragging"); clear(); });
    row.addEventListener("dragover", event => {
      if (!this._listDrag) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const after = half(event);
      row.classList.toggle("mso-drop-after", after);
      row.classList.toggle("mso-drop-before", !after);
    });
    row.addEventListener("dragleave", () => row.classList.remove("mso-drop-before", "mso-drop-after"));
    row.addEventListener("drop", event => {
      const drag = this._listDrag;
      if (!drag) return;
      event.preventDefault(); event.stopPropagation();
      this._listDrag = null; clear();
      void this._draftOperation(() => this._dropInList(drag, { layerId: row.dataset.layerId, groupId: row.dataset.groupId, after: half(event) }));
    });
  }

  /**
   * Restack dragged layers before or after the row they were dropped on. Dropping on a group's
   * member joins that group; on an ungrouped layer or above a group's row leaves groups; below
   * a group's row puts them at its top. A dragged group stays whole and never nests.
   */
  async _dropInList(drag, target) {
    return this._historyStep(async () => {
      const composition = this._editingOverlay();
      const moving = new Set(drag.ids);
      if (!composition || !moving.size || (target.layerId && moving.has(target.layerId))) return;
      const rest = layerOrder(composition).filter(layer => !moving.has(layer.id));
      const block = id => { const members = rest.filter(layer => layer.groupId === id); return [rest.indexOf(members[0]), rest.indexOf(members.at(-1))]; };
      let index, groupId;
      if (!target.layerId && target.groupId) {
        if (drag.groupId === target.groupId) return;
        const [first, last] = block(target.groupId);
        if (first < 0) return;
        if (drag.groupId) index = target.after ? last + 1 : first;
        else { index = first; groupId = target.after ? target.groupId : null; }
      } else {
        const layer = rest.find(entry => entry.id === target.layerId);
        if (!layer) return;
        if (drag.groupId && layer.groupId) { const [first, last] = block(layer.groupId); index = target.after ? last + 1 : first; }
        else index = rest.indexOf(layer) + (target.after ? 1 : 0);
        if (!drag.groupId) groupId = layer.groupId ?? null;
      }
      moveLayers(composition, drag.ids, index, groupId);
      await this._afterLayerEdit();
    });
  }
};
