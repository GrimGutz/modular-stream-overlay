import { OverlayRenderer } from "../render/renderer.js";
import { setAttr } from "../ui/i18n.js";
import { clone } from "../core/schema.js";
import { nativePoint, moveGeometry, resizeGeometry, shortcutCommand } from "./geometry.js";
import { snapMove, snapResize, snapTargets } from "./snapping.js";
import { boundsOf, containsBox } from "./arrange.js";
import { CanvasRulers, RULER_SIZE } from "./rulers.js";

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
// Snapping reach in screen pixels, so it feels the same at every zoom level.
const SNAP_DISTANCE = 6;
// A press that moves less than this many screen pixels is a click, not a selection rectangle.
const CLICK_DISTANCE = 3;
const additive = event => event.shiftKey || event.ctrlKey || event.metaKey;
// Rotation snaps to straight angles within this many degrees; Shift snaps to 15° steps.
const STRAIGHT_SNAP = 2;
const normalizeAngle = angle => { const value = ((angle + 180) % 360 + 360) % 360 - 180; return value === -180 ? 180 : value; };

/**
 * Editor-only interaction surface. The broadcast renderer never constructs this class.
 * Several layers can be selected; the primary one (the last clicked) owns the resize and
 * rotation handles and the editor's property panel. Clicking a grouped layer selects its group.
 * Rulers, guides ({x: [], y: []} positions) and the grid are editor aids only.
 */
export class LayerCanvas {
  constructor({ host, keyboardRoot = host, widgets, context, getOverlay, onChange = () => {}, onSelect = () => {}, onCommand = () => {}, copyText = () => null, onGuides = () => {}, isBlocked = () => false }) {
    this.host = host;
    this.getOverlay = getOverlay;
    this.onChange = onChange;
    this.onSelect = onSelect;
    this.onCommand = onCommand;
    this.copyText = copyText;
    this.onGuides = onGuides;
    this.isBlocked = isBlocked;
    this.guides = { x: [], y: [] };
    this.rulersOn = false;
    this.grid = 0;
    this.selectedIds = [];
    this.primaryId = null;
    this.snapping = true;
    this.zoom = "fit";
    this.gesture = null;
    this.marquee = null;
    this.pendingClipboard = null;
    this.disposed = false;
    this.renderGeneration = 0;
    this.pendingRenderGeneration = null;
    this.listeners = [];
    this.host.classList.add("mso-design-viewport");
    this.host.tabIndex = 0;
    setAttr(this.host, "aria-label", "Canvas.Description");
    this.surface = document.createElement("div");
    this.surface.className = "mso-design-surface";
    this.host.replaceChildren(this.surface);
    this.rulers = new CanvasRulers(host);
    this.rulers.attach();
    this.renderer = new OverlayRenderer(this.surface, { widgets, context, preview: true, onLayout: layout => this.layoutControls(layout) });
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(host);
    this.listen(host, "pointerdown", event => this.pointerDown(event));
    this.listen(host, "pointermove", event => this.pointerMove(event));
    this.listen(host, "pointerup", event => this.pointerUp(event));
    this.listen(host, "pointercancel", event => this.pointerCancel(event));
    this.listen(host, "lostpointercapture", event => this.pointerCancel(event));
    this.listen(host, "dragstart", event => event.preventDefault());
    this.listen(host, "scroll", () => this.drawRulers());
    this.listen(keyboardRoot, "keydown", event => this.keyDown(event), true);
    // Clipboard events target the page body when no text is selected; only a canvas that is
    // waiting for one after its own shortcut reacts.
    const page = host.ownerDocument ?? globalThis.document;
    if (typeof page?.addEventListener === "function") for (const name of ["copy", "cut", "paste"]) this.listen(page, name, event => this.clipboardEvent(event), true);
  }

  /** The primary selected layer. */
  get selectedId() { return this.primaryId; }

  listen(element, name, handler, capture = false) {
    element.addEventListener(name, handler, capture);
    this.listeners.push(() => element.removeEventListener(name, handler, capture));
  }

  layers() { return (this.getOverlay?.() ?? this.overlay)?.layers ?? []; }

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
      const present = new Set(this.layers().map(layer => layer.id));
      this.selectedIds = this.selectedIds.filter(id => present.has(id));
      if (!this.selectedIds.includes(this.primaryId)) this.primaryId = this.selectedIds.at(-1) ?? null;
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

  setSnapping(enabled) { this.snapping = enabled === true; }

  /** Rulers also show the guides; snapping uses guides only while they are shown. */
  setRulers(enabled) {
    this.rulersOn = enabled === true;
    this.rulers.setVisible(this.rulersOn);
    this.host.classList.toggle?.("mso-with-rulers", this.rulersOn);
    this.layout();
    this.renderControls();
  }

  /** Grid step in native pixels; 0 turns the grid off. */
  setGrid(step) {
    this.grid = Number.isFinite(step) && step > 0 ? step : 0;
    this.renderControls();
  }

  setGuides(guides) {
    const clean = values => [...new Set((Array.isArray(values) ? values : []).filter(Number.isFinite).map(Math.round))].slice(0, 100);
    this.guides = { x: clean(guides?.x), y: clean(guides?.y) };
    this.renderControls();
  }

  snapOptions() { return { guides: this.rulersOn ? this.guides : undefined, grid: this.grid }; }

  drawRulers() { this.rulers.draw(this.renderer.layout, (this.getOverlay?.() ?? this.overlay)?.canvas); }

  /** Native canvas coordinates of a screen point, for drops. */
  nativeAt(clientX, clientY) {
    const rect = this.controls?.getBoundingClientRect?.();
    return rect ? nativePoint(clientX, clientY, rect, this.renderer.layout?.scale ?? 1) : null;
  }
  layout() {
    if (!this.overlay || this.disposed) return;
    const bounds = this.host.getBoundingClientRect();
    const { width, height } = this.overlay.canvas;
    // Fitting leaves room for the rulers on every side, so the canvas stays centered.
    const margin = 32 + (this.rulersOn ? 2 * RULER_SIZE : 0);
    const scale = this.zoom === "fit" ? Math.max(0.01, Math.min(Math.max(1, bounds.width - margin) / width, Math.max(1, bounds.height - margin) / height)) : this.zoom;
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
    this.controls.style.setProperty("--mso-guide-font", `${11 / layout.scale}px`);
    this.controls.style.setProperty("--mso-rotate-offset", `${-26 / layout.scale}px`);
    this.drawRulers();
  }

  select(id, { notify = true } = {}) { this.setSelection(id ? [id] : [], id, { notify }); }

  /** Select layers by ID; unknown IDs are dropped and the primary defaults to the last one. */
  setSelection(ids, primary = ids.at(-1), { notify = true } = {}) {
    const present = new Set(this.layers().map(layer => layer.id));
    const chosen = [...new Set(ids)].filter(id => present.has(id));
    const next = chosen.includes(primary) ? primary : chosen.at(-1) ?? null;
    const changed = next !== this.primaryId || chosen.length !== this.selectedIds.length || chosen.some((id, index) => id !== this.selectedIds[index]);
    this.selectedIds = chosen;
    this.primaryId = next;
    this.renderControls();
    if (notify && changed) this.onSelect(next, [...chosen]);
  }

  renderControls() {
    if (!this.controls) return;
    this.controls.replaceChildren();
    const overlay = this.getOverlay?.() ?? this.overlay;
    if (!overlay) return;
    if (this.grid) {
      const grid = document.createElement("div");
      grid.className = "mso-grid";
      grid.style.setProperty("--mso-grid-size", `${this.grid}px`);
      this.controls.append(grid);
    }
    const selected = new Set(this.selectedIds);
    for (const layer of [...overlay.layers].sort((a, b) => a.z - b.z)) {
      if (!layer.visible) continue;
      const box = document.createElement("div");
      box.className = "mso-layer-hit";
      box.dataset.layerId = layer.id;
      if (selected.has(layer.id)) box.classList.add("selected");
      if (layer.locked) box.classList.add("locked");
      if (layer.locked) setAttr(box, "title", "Canvas.LockedLayer", { name: layer.name });
      else box.title = layer.name;
      this.boxGeometry(box, layer);
      this.controls.append(box);
    }
    // Keep handles above overlapping layers without changing their visual or hit-test order.
    const chosen = overlay.layers.filter(layer => selected.has(layer.id) && layer.visible);
    for (const layer of chosen) {
      const selection = document.createElement("div");
      selection.className = `mso-layer-selection${layer.locked ? " locked" : ""}`;
      selection.dataset.layerId = layer.id;
      this.boxGeometry(selection, layer);
      if (chosen.length === 1 && !layer.locked) {
        for (const direction of HANDLES) {
          const handle = document.createElement("span");
          handle.className = `mso-resize-handle mso-handle-${direction}`;
          handle.dataset.resizeHandle = direction;
          selection.append(handle);
        }
        const rotate = document.createElement("span");
        rotate.className = "mso-rotate-handle";
        rotate.dataset.rotateHandle = "";
        setAttr(rotate, "title", "Canvas.RotateHandle");
        selection.append(rotate);
      }
      this.controls.append(selection);
    }
    if (chosen.length > 1) {
      const group = document.createElement("div");
      group.className = "mso-group-selection";
      group.dataset.groupBounds = "";
      this.controls.append(group);
      this.groupGeometry(group, chosen);
    }
    if (this.rulersOn) for (const axis of ["x", "y"]) this.guides[axis].forEach((position, index) => {
      const guide = document.createElement("div");
      guide.className = `mso-guide mso-guide-${axis}`;
      guide.dataset.guideAxis = axis;
      guide.dataset.guideIndex = String(index);
      Object.assign(guide.style, axis === "x" ? { left: `${position}px`, top: "0px", height: `${overlay.canvas.height}px` }
        : { top: `${position}px`, left: "0px", width: `${overlay.canvas.width}px` });
      if (this.gesture?.guide?.axis === axis && this.gesture.guide.index === index) {
        const label = document.createElement("span");
        label.textContent = String(position);
        guide.append(label);
      }
      this.controls.append(guide);
    });
    if (this.marquee?.box) {
      const marquee = document.createElement("div");
      marquee.className = "mso-marquee";
      this.boxGeometry(marquee, this.marquee.box);
      this.controls.append(marquee);
    }
    this.layoutControls(this.renderer.layout ?? { width: overlay.canvas.width, height: overlay.canvas.height, left: 0, top: 0, scale: 1 });
  }

  boxGeometry(box, layer) {
    Object.assign(box.style, { left: `${layer.x}px`, top: `${layer.y}px`, width: `${layer.width}px`, height: `${layer.height}px`, transform: `rotate(${layer.rotation ?? 0}deg)` });
  }

  groupGeometry(group, layers) {
    const bounds = boundsOf(layers);
    if (bounds) this.boxGeometry(group, bounds);
  }

  /** Move hit boxes, outlines and the group frame with their layers, without rebuilding them. */
  updateBoxes(layers) {
    const byId = new Map(layers.map(layer => [layer.id, layer]));
    for (const box of this.controls?.children ?? []) {
      if (byId.has(box.dataset.layerId)) this.boxGeometry(box, byId.get(box.dataset.layerId));
      else if (box.dataset.groupBounds !== undefined) this.groupGeometry(box, this.layers().filter(layer => this.selectedIds.includes(layer.id) && layer.visible));
    }
  }

  /** Visible members of a layer's group, or just the layer. */
  groupOf(layer) {
    return layer.groupId ? this.layers().filter(entry => entry.groupId === layer.groupId && entry.visible).sort((a, b) => a.z - b.z).map(entry => entry.id) : [layer.id];
  }

  /** IDs plus every visible member of their groups. */
  withGroups(ids) {
    const chosen = new Set(ids);
    const groups = new Set(this.layers().filter(layer => chosen.has(layer.id) && layer.groupId).map(layer => layer.groupId));
    return [...ids, ...this.layers().filter(layer => groups.has(layer.groupId) && layer.visible && !chosen.has(layer.id)).sort((a, b) => a.z - b.z).map(layer => layer.id)];
  }

  pointerDown(event) {
    if (event.button !== 0 || this.disposed || this.pendingRenderGeneration !== null || this.isBlocked() || !this.overlay || this.gesture || this.marquee) return;
    const ruler = event.target.closest?.("[data-ruler]");
    const guide = event.target.closest?.("[data-guide-axis]");
    this.host.focus({ preventScroll: true });
    if (ruler || guide) { this.startGuide(event, ruler?.dataset.ruler ?? guide.dataset.guideAxis, guide ? Number(guide.dataset.guideIndex) : null); return; }
    const box = event.target.closest?.("[data-layer-id]");
    const handle = event.target.closest?.("[data-resize-handle]")?.dataset.resizeHandle;
    const rotate = event.target.closest?.("[data-rotate-handle]");
    const overlay = this.getOverlay?.() ?? this.overlay;
    const layer = box && overlay.layers.find(value => value.id === box.dataset.layerId);
    if (layer && rotate && !layer.locked && layer.visible) { this.startRotation(event, overlay, layer); return; }
    const previous = [...this.selectedIds];
    const members = layer ? this.groupOf(layer) : [];
    // Shift, Ctrl or Cmd adds a layer, or its whole group, to the selection or removes it.
    if (layer && !handle && additive(event)) {
      event.preventDefault(); event.stopPropagation();
      const removing = members.every(id => previous.includes(id));
      const ids = removing ? previous.filter(id => !members.includes(id)) : [...previous, ...members.filter(id => !previous.includes(id))];
      this.setSelection(ids, removing ? undefined : layer.id);
      return;
    }
    const grouped = !!layer && !handle && previous.length > 1 && previous.includes(layer.id);
    // A grouped layer selects its group first; clicking it again then picks just that layer.
    const groupFirst = !!layer && !handle && !grouped && members.length > 1;
    if (groupFirst) this.setSelection(members, layer.id);
    else if (!grouped && !(additive(event) && !layer)) this.select(layer?.id ?? null);
    // Empty space and locked layers start a selection rectangle; a plain click just selects.
    if (!layer || !layer.visible || layer.locked) {
      this.startMarquee(event, additive(event) ? previous : []);
      return;
    }
    event.preventDefault(); event.stopPropagation();
    const together = grouped || groupFirst ? new Set(this.selectedIds) : null;
    const moving = together ? overlay.layers.filter(entry => together.has(entry.id) && entry.visible && !entry.locked) : [layer];
    this.gesture = {
      pointerId: event.pointerId, overlay, layerId: layer.id, start: clone(layer), handle, grouped, moved: false,
      starts: new Map(moving.map(entry => [entry.id, clone(entry)])),
      clientX: event.clientX, clientY: event.clientY, scale: this.renderer.layout?.scale ?? 1
    };
    this.capture(event);
  }

  capture(event) {
    this.host.setPointerCapture(event.pointerId);
    this.host.classList.add("mso-manipulating");
  }

  /** Turn the layer around its center by dragging the handle above it. */
  startRotation(event, overlay, layer) {
    event.preventDefault(); event.stopPropagation();
    const rect = this.controls.getBoundingClientRect(), scale = this.renderer.layout?.scale ?? 1;
    const center = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
    const point = nativePoint(event.clientX, event.clientY, rect, scale);
    this.gesture = { pointerId: event.pointerId, overlay, layerId: layer.id, start: clone(layer), starts: new Map([[layer.id, clone(layer)]]), moved: false,
      rotate: { rect, scale, center, angle: Math.atan2(point.y - center.y, point.x - center.x) } };
    this.capture(event);
  }

  rotateMove(gesture, layer, event) {
    const { rect, scale, center, angle } = gesture.rotate;
    const point = nativePoint(event.clientX, event.clientY, rect, scale);
    const turned = (Math.atan2(point.y - center.y, point.x - center.x) - angle) * 180 / Math.PI;
    let rotation = normalizeAngle((gesture.start.rotation ?? 0) + turned);
    if (event.shiftKey) rotation = normalizeAngle(Math.round(rotation / 15) * 15);
    else {
      rotation = Math.round(rotation * 10) / 10;
      const straight = Math.round(rotation / 90) * 90;
      if (this.snapping && !event.altKey && Math.abs(rotation - straight) < STRAIGHT_SNAP) rotation = normalizeAngle(straight);
    }
    this.showAngle(layer, rotation);
    if (layer.rotation === rotation) return;
    gesture.moved = true;
    layer.rotation = rotation;
    this.renderer.updateLayer(layer);
    this.updateBoxes([layer]);
    this.onChange(layer);
  }

  showAngle(layer, rotation) {
    if (!this.controls) return;
    this.angleLabel ??= document.createElement("div");
    this.angleLabel.className = "mso-angle-label";
    this.angleLabel.textContent = `${rotation}°`;
    Object.assign(this.angleLabel.style, { left: `${layer.x + layer.width / 2}px`, top: `${layer.y + layer.height / 2}px` });
    if (this.angleLabel.parentElement !== this.controls) this.controls.append(this.angleLabel);
  }

  /** Drag a new guide out of a ruler, or move an existing one; dropping it on the ruler removes it. */
  startGuide(event, axis, index) {
    if (!this.rulersOn || !["x", "y"].includes(axis) || !this.controls) return;
    event.preventDefault(); event.stopPropagation();
    const previous = { x: [...this.guides.x], y: [...this.guides.y] };
    if (index === null) { this.guides[axis].push(0); index = this.guides[axis].length - 1; }
    this.gesture = { pointerId: event.pointerId, overlay: this.getOverlay?.() ?? this.overlay, guide: { axis, index },
      previous, rect: this.controls.getBoundingClientRect(), scale: this.renderer.layout?.scale ?? 1 };
    this.capture(event);
    this.guideMove(event);
  }

  guideMove(event) {
    const { guide, rect, scale } = this.gesture;
    const point = nativePoint(event.clientX, event.clientY, rect, scale);
    this.guides[guide.axis][guide.index] = Math.round(point[guide.axis]);
    this.renderControls();
  }

  startMarquee(event, base) {
    const rect = this.controls?.getBoundingClientRect?.();
    if (!rect) return;
    const scale = this.renderer.layout?.scale ?? 1;
    this.marquee = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, rect, scale, base, active: false,
      initial: [...this.selectedIds], origin: nativePoint(event.clientX, event.clientY, rect, scale) };
    this.host.setPointerCapture(event.pointerId);
  }

  pointerMove(event) {
    if (this.marquee && event.pointerId === this.marquee.pointerId) { this.marqueeMove(event); return; }
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (this.pendingRenderGeneration !== null || this.isBlocked() || (this.getOverlay?.() ?? this.overlay) !== gesture.overlay) { this.cancelGesture(); return; }
    if (gesture.guide) { event.preventDefault(); event.stopPropagation(); this.guideMove(event); return; }
    const layer = gesture.overlay.layers.find(value => value.id === gesture.layerId);
    if (!layer || layer.locked || !layer.visible) { this.cancelGesture(); return; }
    event.preventDefault(); event.stopPropagation();
    if (gesture.rotate) { this.rotateMove(gesture, layer, event); return; }
    const delta = nativePoint(event.clientX, event.clientY, { left: gesture.clientX, top: gesture.clientY }, gesture.scale);
    if (gesture.handle) {
      const geometry = resizeGeometry(gesture.start, gesture.handle, delta);
      this.showGuides(this.snapEdges(gesture, geometry, event));
      if (Object.entries(geometry).every(([key, value]) => layer[key] === value)) return;
      gesture.moved = true;
      Object.assign(layer, geometry);
      this.renderer.updateLayer(layer);
      this.updateBoxes([layer]);
      this.onChange(layer);
      return;
    }
    const offset = this.snapGroup(gesture, delta, event);
    const changed = [];
    for (const [id, start] of gesture.starts) {
      const target = gesture.overlay.layers.find(value => value.id === id);
      if (!target || target.locked) continue;
      const geometry = moveGeometry(start, offset);
      if (target.x === geometry.x && target.y === geometry.y) continue;
      Object.assign(target, geometry);
      this.renderer.updateLayer(target);
      changed.push(target);
    }
    if (!changed.length) return;
    gesture.moved = true;
    this.updateBoxes(changed);
    for (const target of changed) this.onChange(target);
  }

  /**
   * Stick the moved boxes, as one group, to other layers, the canvas middle and equal spacing.
   * Alt skips it, and so does any rotated layer in the group. Returns the movement to apply.
   */
  snapGroup(gesture, delta, event) {
    const starts = [...gesture.starts.values()];
    if (!this.snapping || event.altKey || starts.some(start => ((start.rotation ?? 0) % 360) !== 0)) { this.showGuides([]); return delta; }
    const bounds = boundsOf(starts);
    const targets = snapTargets([...(gesture.overlay.layers ?? []), ...(this.overlay?.layers ?? [])], new Set(gesture.starts.keys()));
    const canvas = gesture.overlay.canvas ?? this.overlay.canvas;
    const snapped = snapMove({ ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y }, targets, canvas, SNAP_DISTANCE / gesture.scale, this.snapOptions());
    this.showGuides(snapped.guides);
    return { x: snapped.x - bounds.x, y: snapped.y - bounds.y };
  }

  /** Resizing snaps the moving edges; rotated layers and aspect-locked resizing keep their exact geometry. */
  snapEdges(gesture, geometry, event) {
    if (!this.snapping || event.altKey || ((gesture.start.rotation ?? 0) % 360) !== 0 || gesture.start.lockAspectRatio === true) return [];
    const targets = snapTargets([...(gesture.overlay.layers ?? []), ...(this.overlay?.layers ?? [])], gesture.layerId);
    const canvas = gesture.overlay.canvas ?? this.overlay.canvas;
    const snapped = snapResize({ ...gesture.start, ...geometry }, gesture.handle, targets, canvas, SNAP_DISTANCE / gesture.scale, this.snapOptions());
    for (const key of Object.keys(geometry)) geometry[key] = snapped[key];
    return snapped.guides;
  }

  marqueeMove(event) {
    const marquee = this.marquee;
    if (this.pendingRenderGeneration !== null || this.isBlocked()) { this.cancelMarquee(); return; }
    if (!marquee.active && Math.hypot(event.clientX - marquee.clientX, event.clientY - marquee.clientY) < CLICK_DISTANCE) return;
    event.preventDefault(); event.stopPropagation();
    marquee.active = true;
    const point = nativePoint(event.clientX, event.clientY, marquee.rect, marquee.scale);
    marquee.box = { x: Math.min(point.x, marquee.origin.x), y: Math.min(point.y, marquee.origin.y),
      width: Math.abs(point.x - marquee.origin.x), height: Math.abs(point.y - marquee.origin.y) };
    // Layers entirely inside the rectangle; locked and hidden ones stay out, like a locked background.
    const inside = this.layers().filter(layer => layer.visible && !layer.locked && containsBox(marquee.box, layer)).sort((a, b) => a.z - b.z);
    this.setSelection(this.withGroups([...marquee.base, ...inside.map(layer => layer.id)]), undefined, { notify: false });
  }

  finishMarquee() {
    const marquee = this.marquee;
    this.marquee = null;
    if (this.host.hasPointerCapture?.(marquee.pointerId)) this.host.releasePointerCapture(marquee.pointerId);
    this.renderControls();
    if (marquee.active) this.onSelect(this.primaryId, [...this.selectedIds]);
  }

  cancelMarquee() {
    const marquee = this.marquee;
    if (!marquee) return;
    this.marquee = null;
    if (this.host.hasPointerCapture?.(marquee.pointerId)) this.host.releasePointerCapture(marquee.pointerId);
    this.setSelection(marquee.initial, undefined, { notify: marquee.active });
  }

  showGuides(guides) {
    if (!guides.length || !this.controls) { this.guideLayer?.remove(); this.guideLayer = null; return; }
    this.guideLayer ??= document.createElement("div");
    this.guideLayer.className = "mso-snap-guides";
    if (this.guideLayer.parentElement !== this.controls) this.controls.append(this.guideLayer);
    this.guideLayer.replaceChildren(...guides.map(guide => {
      const node = document.createElement("div");
      if (guide.type === "line") {
        node.className = `mso-snap-line mso-snap-line-${guide.axis}${guide.canvas ? " mso-snap-canvas" : ""}`;
        Object.assign(node.style, guide.axis === "x"
          ? { left: `${guide.position}px`, top: `${guide.from}px`, height: `${guide.to - guide.from}px` }
          : { top: `${guide.position}px`, left: `${guide.from}px`, width: `${guide.to - guide.from}px` });
      } else {
        node.className = `mso-snap-gap mso-snap-gap-${guide.axis}`;
        Object.assign(node.style, guide.axis === "x"
          ? { left: `${guide.from}px`, top: `${guide.cross}px`, width: `${guide.to - guide.from}px` }
          : { top: `${guide.from}px`, left: `${guide.cross}px`, height: `${guide.to - guide.from}px` });
        const label = document.createElement("span"); label.textContent = String(guide.size); node.append(label);
      }
      return node;
    }));
  }

  pointerUp(event) {
    if (this.marquee?.pointerId === event.pointerId) { this.marqueeMove(event); this.finishMarquee(); return; }
    if (this.gesture?.pointerId !== event.pointerId) return;
    this.pointerMove(event);
    const gesture = this.gesture;
    this.finishGesture();
    if (gesture?.guide) { this.finishGuide(gesture, event); return; }
    // A click on one layer of a selection, without dragging, selects just that layer.
    if (gesture?.grouped && !gesture.moved) this.select(gesture.layerId);
  }

  pointerCancel(event) {
    if (this.marquee?.pointerId === event.pointerId) this.cancelMarquee();
    else if (this.gesture?.pointerId === event.pointerId) this.cancelGesture();
  }

  finishGuide(gesture, event) {
    const { axis, index } = gesture.guide;
    if (this.rulers.contains(axis, event.clientX, event.clientY)) this.guides[axis].splice(index, 1);
    this.guides[axis] = [...new Set(this.guides[axis])];
    this.renderControls();
    if (JSON.stringify(this.guides) !== JSON.stringify(gesture.previous)) this.onGuides({ x: [...this.guides.x], y: [...this.guides.y] });
  }

  finishGesture() {
    const gesture = this.gesture;
    this.gesture = null;
    this.showGuides([]);
    this.angleLabel?.remove?.();
    this.angleLabel = null;
    this.host.classList.remove("mso-manipulating");
    if (gesture && this.host.hasPointerCapture?.(gesture.pointerId)) this.host.releasePointerCapture(gesture.pointerId);
  }

  cancelGesture() {
    this.cancelMarquee();
    const gesture = this.gesture;
    if (!gesture) return;
    if (gesture.guide) { this.guides = gesture.previous; this.finishGesture(); this.renderControls(); return; }
    const keys = ["x", "y", "width", "height", "rotation"];
    for (const [id, start] of gesture.handle ? [[gesture.layerId, gesture.start]] : gesture.starts) {
      const layer = gesture.overlay.layers.find(value => value.id === id);
      if (!layer) continue;
      const changed = keys.some(key => layer[key] !== start[key]);
      for (const key of keys) layer[key] = start[key];
      this.renderer.updateLayer(layer);
      if (changed) this.onChange(layer);
    }
    this.finishGesture();
    this.renderControls();
  }

  keyDown(event) {
    if (this.disposed || this.pendingRenderGeneration !== null || this.isBlocked()) return;
    if (event.key === "Escape" && (this.gesture || this.marquee)) { event.preventDefault(); event.stopPropagation(); this.cancelGesture(); return; }
    if (this.gesture || this.marquee) return;
    const command = shortcutCommand(event);
    if (!command) return;
    if (["copy", "cut", "paste"].includes(command.action)) { this.awaitClipboard(event, command.action); return; }
    // Undo, redo and select-all need no selected layer.
    if (["undo", "redo"].includes(command.action)) { event.preventDefault(); event.stopPropagation(); this.onCommand(command.action); return; }
    if (command.action === "selectAll") {
      event.preventDefault(); event.stopPropagation();
      this.setSelection(this.layers().filter(layer => layer.visible && !layer.locked).sort((a, b) => a.z - b.z).map(layer => layer.id));
      return;
    }
    if (!this.selectedIds.length) return;
    if (command.action === "deselect") { event.preventDefault(); event.stopPropagation(); this.select(null); return; }
    if (command.action !== "move") { event.preventDefault(); event.stopPropagation(); this.onCommand(command.action); return; }
    const moving = this.layers().filter(layer => this.selectedIds.includes(layer.id) && !layer.locked);
    if (!moving.length) return;
    event.preventDefault(); event.stopPropagation();
    for (const layer of moving) {
      Object.assign(layer, moveGeometry(layer, { x: command.x, y: command.y }));
      this.renderer.updateLayer(layer);
    }
    this.renderControls();
    for (const layer of moving) this.onChange(layer);
  }

  /**
   * Copy, cut and paste use the browser's clipboard events, which can read and write the system
   * clipboard. The key press is kept from Foundry; if no clipboard event follows, the editor
   * falls back to its in-memory copy.
   */
  awaitClipboard(event, action) {
    if (action !== "paste" && !this.selectedIds.length) return;
    event.stopPropagation();
    this.pendingClipboard = action;
    // Copy and cut can be raised during the key press itself, which works even where the browser
    // runs no copy command for a focused canvas; pasting has no such script access.
    if (action !== "paste") {
      try { globalThis.document?.execCommand?.(action); }
      catch { /* Not available; the browser's own command or the fallback below handles it. */ }
      if (!this.pendingClipboard) { event.preventDefault(); return; }
    }
    setTimeout(() => {
      if (this.pendingClipboard !== action || this.disposed) return;
      this.pendingClipboard = null;
      this.onCommand(action);
    }, 0);
  }

  clipboardEvent(event) {
    const action = this.pendingClipboard;
    if (!action || event.type !== action || this.disposed) return;
    this.pendingClipboard = null;
    event.preventDefault(); event.stopPropagation();
    if (action === "paste") {
      // A copied screenshot or image file arrives as a file rather than text.
      const files = [...(event.clipboardData?.files ?? [])].filter(file => /^image\//.test(file.type ?? ""));
      this.onCommand("paste", { text: event.clipboardData?.getData?.("text/plain") ?? "", ...(files.length ? { files } : {}) });
      return;
    }
    const text = this.copyText();
    if (text) event.clipboardData?.setData?.("text/plain", text);
    this.onCommand(action, { copied: !!text });
  }

  destroy() {
    this.cancelGesture();
    this.disposed = true;
    this.pendingClipboard = null;
    ++this.renderGeneration;
    this.pendingRenderGeneration = null;
    this.resizeObserver.disconnect();
    for (const stop of this.listeners) stop();
    this.listeners = [];
    this.rulers.destroy();
    this.renderer.destroy();
    this.host.replaceChildren();
  }
}
