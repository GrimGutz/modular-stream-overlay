/** Geometry uses native overlay pixels; it has no DOM or Foundry dependency. */
const DIRECTIONS = Object.freeze({ nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = value => typeof value === "number" && Number.isFinite(value);

export function nativePoint(clientX, clientY, rect, scale) {
  if (![clientX, clientY, rect?.left, rect?.top, scale].every(finite) || scale <= 0) throw new TypeError("Invalid canvas coordinates or scale.");
  return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
}

export function moveGeometry(start, delta) {
  if (![start.x, start.y, delta.x, delta.y].every(finite)) throw new TypeError("Invalid movement.");
  return { x: clamp(start.x + delta.x, -32768, 32768), y: clamp(start.y + delta.y, -32768, 32768) };
}

/** Resize in the layer's rotated axes, keeping the opposite edge/corner fixed. */
export function resizeGeometry(start, handle, delta, { aspectLocked = start.lockAspectRatio === true, minSize = 8, maxSize = 7680 } = {}) {
  const direction = DIRECTIONS[handle];
  if (!direction || ![start.x, start.y, start.width, start.height, start.rotation ?? 0, delta.x, delta.y, minSize, maxSize].every(finite)
    || start.width <= 0 || start.height <= 0 || minSize <= 0 || maxSize < minSize) throw new TypeError("Invalid resize geometry.");
  const [hx, hy] = direction;
  const angle = (start.rotation ?? 0) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = delta.x * cos + delta.y * sin;
  const dy = -delta.x * sin + delta.y * cos;
  let width = start.width + hx * dx;
  let height = start.height + hy * dy;
  if (aspectLocked) {
    const sx = hx ? width / start.width : 1;
    const sy = hy ? height / start.height : 1;
    let factor = !hx ? sy : !hy ? sx : Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    const maximumFactor = Math.min(maxSize / start.width, maxSize / start.height);
    const preferredMinimumFactor = Math.max(minSize / start.width, minSize / start.height);
    // Extreme but valid imported proportions cannot meet the editor's 8px minimum
    // on both axes. Keep the schema's 1px minimum rather than exceeding 7680px.
    const minimumFactor = preferredMinimumFactor <= maximumFactor ? preferredMinimumFactor : Math.min(maximumFactor, Math.max(1 / start.width, 1 / start.height));
    factor = clamp(factor, minimumFactor, maximumFactor);
    width = start.width * factor;
    height = start.height * factor;
  } else {
    width = clamp(width, minSize, maxSize);
    height = clamp(height, minSize, maxSize);
  }
  const localShiftX = hx * (width - start.width) / 2;
  const localShiftY = hy * (height - start.height) / 2;
  const centerX = start.x + start.width / 2 + localShiftX * cos - localShiftY * sin;
  const centerY = start.y + start.height / 2 + localShiftX * sin + localShiftY * cos;
  return { x: clamp(centerX - width / 2, -32768, 32768), y: clamp(centerY - height / 2, -32768, 32768), width, height };
}

export function shortcutCommand(event) {
  const target = event.target;
  if (target?.isContentEditable || target?.closest?.("input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox']")) return null;
  if (event.altKey) return null;
  if (event.ctrlKey || event.metaKey) {
    // Physical keys keep Ctrl+C/V/Z working with non-Latin keyboard layouts.
    const key = event.code?.startsWith("Key") ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
    if (key === "z") return { action: event.shiftKey ? "redo" : "undo" };
    const actions = { d: "duplicate", c: "copy", x: "cut", v: "paste", y: "redo" };
    return actions[key] && !event.shiftKey ? { action: actions[key] } : null;
  }
  if (event.key === "Delete" || event.key === "Backspace") return { action: "delete" };
  const step = event.shiftKey ? 10 : 1;
  const directions = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (directions[event.key]) return { action: "move", x: directions[event.key][0], y: directions[event.key][1] };
  return null;
}
