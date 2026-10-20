import { OverlayRenderer } from "../render/renderer.js";
import { clone } from "../core/schema.js";
import { nativePoint, moveGeometry, resizeGeometry, shortcutCommand } from "./geometry.js";

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Editor-only interaction surface. The broadcast renderer never constructs this class. */
export class LayerCanvas {
  constructor({ host, keyboardRoot = host, widgets, context, getOverlay, onChange = () => {}, onSelect = () => {}, onCommand = () => {}, isBlocked = () => false }) {
    this.host = host;
    this.getOverlay = getOverlay;
    this.onChange = onChange;
    this.onSelect = onSelect;
    this.onCommand = onCommand;
    this.isBlocked = isBlocked;
    this.selectedId = null;
    this.zoom = "fit";
    this.gesture = null;
    this.disposed = false;
    this.renderGeneration = 0;
    this.pendingRenderGeneration = null;
    this.listeners = [];
    this.host.classList.add("mso-design-viewport");
    this.host.tabIndex = 0;
    this.host.setAttribute("aria-label", "Overlay design canvas. Select layers, drag, or use arrow keys.");
    this.surface = document.createElement("div");
    this.surface.className = "mso-design-surface";
    this.host.replaceChildren(this.surface);
    this.renderer = new OverlayRenderer(this.surface, { widgets, context, preview: true, onLayout: layout => this.layoutControls(layout) });
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(host);
    this.listen(host, "pointerdown", event => this.pointerDown(event));
    this.listen(host, "pointermove", event => this.pointerMove(event));
    this.listen(host, "pointerup", event => this.pointerUp(event));
    this.listen(host, "pointercancel", event => this.pointerCancel(event));
    this.listen(host, "lostpointercapture", event => this.pointerCancel(event));
    this.listen(host, "dragstart", event => event.preventDefault());
    this.listen(keyboardRoot, "keydown", event => this.keyDown(event), true);
  }

  listen(element, name, handler, capture = false) {
    element.addEventListener(name, handler, capture);
    this.listeners.push(() => element.removeEventListener(name, handler, capture));
  }

  async render(overlay) {
    if (this.disposed) return;
    const generation = ++this.renderGeneration;
    this.pendingRenderGeneration = generation;
    try {
      this.cancelGesture();
      this.overlay = overlay;
      this.layout();
      await this.renderer.render(overlay);
      if (this.disposed || generation !== this.renderGeneration) return;
      if (!(this.getOverlay?.() ?? overlay)?.layers.some(layer => layer.id === this.selectedId)) this.selectedId = null;
      this.controls = document.createElement("div");
      this.controls.className = "mso-canvas-controls";
      this.controls.setAttribute("aria-hidden", "true");
      this.surface.append(this.controls);
      this.renderControls();
      this.layout();
    } finally {
      // A stale completion must never unlock a newer scene that is still rendering.
      if (this.pendingRenderGeneration === generation) this.pendingRenderGeneration = null;
    }
  }

  setZoom(value) {
    if (value !== "fit" && (typeof value !== "number" || !Number.isFinite(value) || value < 0.05 || value > 4)) throw new TypeError("Zoom must be Fit or 5–400%.");
    this.cancelGesture();
    this.zoom = value;
    this.layout();
  }

  layout() {
    if (!this.overlay || this.disposed) return;
    const bounds = this.host.getBoundingClientRect();
    const { width, height } = this.overlay.canvas;
    const scale = this.zoom === "fit" ? Math.max(0.01, Math.min(Math.max(1, bounds.width - 32) / width, Math.max(1, bounds.height - 32) / height)) : this.zoom;
    this.surface.style.width = `${Math.max(bounds.width - 2, width * scale + 32)}px`;
    this.surface.style.height = `${Math.max(bounds.height - 2, height * scale + 32)}px`;
    this.renderer.setScale(scale);
  }

  layoutControls(layout) {
    if (!this.controls) return;
    Object.assign(this.controls.style, {
      width: `${layout.width}px`, height: `${layout.height}px`, left: `${layout.left}px`, top: `${layout.top}px`, transform: `scale(${layout.scale})`
    });
    this.controls.style.setProperty("--mso-handle-size", `${9 / layout.scale}px`);
    this.controls.style.setProperty("--mso-outline-size", `${1.5 / layout.scale}px`);
  }

  select(id, { notify = true } = {}) {
    if (!(this.getOverlay?.() ?? this.overlay)?.layers.some(layer => layer.id === id)) id = null;
    const changed = id !== this.selectedId;
    this.selectedId = id;
    this.renderControls();
    if (notify && changed) this.onSelect(id);
  }

  renderControls() {
    if (!this.controls) return;
    this.controls.replaceChildren();
    const overlay = this.getOverlay?.() ?? this.overlay;
    if (!overlay) return;
    for (const layer of [...overlay.layers].sort((a, b) => a.z - b.z)) {
      if (!layer.visible) continue;
      const box = document.createElement("div");
      box.className = "mso-layer-hit";
      box.dataset.layerId = layer.id;
      if (layer.id === this.selectedId) box.classList.add("selected");
      if (layer.locked) box.classList.add("locked");
      box.title = `${layer.name}${layer.locked ? " (locked)" : ""}`;
      this.boxGeometry(box, layer);
      this.controls.append(box);
    }
    // Keep handles above overlapping layers without changing their visual or hit-test order.
    const selected = overlay.layers.find(layer => layer.id === this.selectedId && layer.visible);
    if (selected) {
      const selection = document.createElement("div");
      selection.className = `mso-layer-selection${selected.locked ? " locked" : ""}`;
      selection.dataset.layerId = selected.id;
      this.boxGeometry(selection, selected);
      if (!selected.locked) for (const direction of HANDLES) {
        const handle = document.createElement("span");
        handle.className = `mso-resize-handle mso-handle-${direction}`;
        handle.dataset.resizeHandle = direction;
        selection.append(handle);
      }
      this.controls.append(selection);
    }
    this.layoutControls(this.renderer.layout ?? { width: overlay.canvas.width, height: overlay.canvas.height, left: 0, top: 0, scale: 1 });
  }

  boxGeometry(box, layer) {
    Object.assign(box.style, { left: `${layer.x}px`, top: `${layer.y}px`, width: `${layer.width}px`, height: `${layer.height}px`, transform: `rotate(${layer.rotation ?? 0}deg)` });
  }

  pointerDown(event) {
    if (event.button !== 0 || this.disposed || this.pendingRenderGeneration !== null || this.isBlocked() || !this.overlay || this.gesture) return;
    const box = event.target.closest?.("[data-layer-id]");
    const handle = event.target.closest?.("[data-resize-handle]")?.dataset.resizeHandle;
    const overlay = this.getOverlay?.() ?? this.overlay;
    const layer = box && overlay.layers.find(value => value.id === box.dataset.layerId);
    this.host.focus({ preventScroll: true });
    this.select(layer?.id ?? null);
    if (!layer || !layer.visible || layer.locked) return;
    event.preventDefault(); event.stopPropagation();
    this.gesture = {
      pointerId: event.pointerId, overlay, layerId: layer.id, start: clone(layer), handle,
      clientX: event.clientX, clientY: event.clientY, scale: this.renderer.layout?.scale ?? 1
    };
    this.host.setPointerCapture(event.pointerId);
    this.host.classList.add("mso-manipulating");
  }

  pointerMove(event) {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (this.pendingRenderGeneration !== null || this.isBlocked() || (this.getOverlay?.() ?? this.overlay) !== gesture.overlay) { this.cancelGesture(); return; }
    const layer = gesture.overlay.layers.find(value => value.id === gesture.layerId);
    if (!layer || layer.locked || !layer.visible) { this.cancelGesture(); return; }
    event.preventDefault(); event.stopPropagation();
    const delta = nativePoint(event.clientX, event.clientY, { left: gesture.clientX, top: gesture.clientY }, gesture.scale);
    const geometry = gesture.handle ? resizeGeometry(gesture.start, gesture.handle, delta) : moveGeometry(gesture.start, delta);
    if (Object.entries(geometry).every(([key, value]) => layer[key] === value)) return;
    Object.assign(layer, geometry);
    this.renderer.updateLayer(layer);
    for (const box of this.controls.children) if (box.dataset.layerId === layer.id) this.boxGeometry(box, layer);
    this.onChange(layer);
  }

  pointerUp(event) {
    if (this.gesture?.pointerId !== event.pointerId) return;
    this.pointerMove(event);
    this.finishGesture();
  }

  pointerCancel(event) {
    if (this.gesture?.pointerId === event.pointerId) this.cancelGesture();
  }

  finishGesture() {
    const gesture = this.gesture;
    this.gesture = null;
    this.host.classList.remove("mso-manipulating");
    if (gesture && this.host.hasPointerCapture?.(gesture.pointerId)) this.host.releasePointerCapture(gesture.pointerId);
  }

  cancelGesture() {
    const gesture = this.gesture;
    if (!gesture) return;
    const layer = gesture.overlay.layers.find(value => value.id === gesture.layerId);
    if (layer) {
      const changed = ["x", "y", "width", "height"].some(key => layer[key] !== gesture.start[key]);
      for (const key of ["x", "y", "width", "height"]) layer[key] = gesture.start[key];
      this.renderer.updateLayer(layer);
      if (changed) this.onChange(layer);
    }
    this.finishGesture();
    this.renderControls();
  }

  keyDown(event) {
    if (this.disposed || this.pendingRenderGeneration !== null || this.isBlocked() || !this.selectedId) return;
    if (event.key === "Escape" && this.gesture) { event.preventDefault(); event.stopPropagation(); this.cancelGesture(); return; }
    if (this.gesture) return;
    const command = shortcutCommand(event);
    if (!command) return;
    const overlay = this.getOverlay?.() ?? this.overlay;
    const layer = overlay?.layers.find(value => value.id === this.selectedId);
    if (!layer || (command.action === "move" && layer.locked)) return;
    event.preventDefault(); event.stopPropagation();
    if (command.action !== "move") { this.onCommand(command.action); return; }
    Object.assign(layer, moveGeometry(layer, { x: command.x, y: command.y }));
    this.renderer.updateLayer(layer);
    this.renderControls();
    this.onChange(layer);
  }

  destroy() {
    this.cancelGesture();
    this.disposed = true;
    ++this.renderGeneration;
    this.pendingRenderGeneration = null;
    this.resizeObserver.disconnect();
    for (const stop of this.listeners) stop();
    this.listeners = [];
    this.renderer.destroy();
    this.host.replaceChildren();
  }
}
