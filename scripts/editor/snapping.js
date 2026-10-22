/**
 * Editor snapping in native overlay pixels: a moved or resized box sticks to other boxes'
 * edges and centers, the canvas edges and middle, and to equal spacing between neighbours.
 * Boxes are unrotated {x, y, width, height} rectangles; no DOM or Foundry dependency.
 */
const AXES = Object.freeze({ x: { start: "x", size: "width", cross: "y" }, y: { start: "y", size: "height", cross: "x" } });
const EPSILON = 0.5;

const start = (box, axis) => box[AXES[axis].start];
const size = (box, axis) => box[AXES[axis].size];
const end = (box, axis) => start(box, axis) + size(box, axis);
const crossAxis = axis => AXES[axis].cross;
const overlaps = (a, b, axis) => start(a, axis) < end(b, axis) && start(b, axis) < end(a, axis);

/** Lines a box edge or center can stick to on one axis, with what produced them. */
function lines(axis, targets, canvas) {
  const extent = axis === "x" ? canvas.width : canvas.height;
  const result = [0, extent / 2, extent].map(position => ({ position, target: null }));
  for (const target of targets) {
    for (const position of [start(target, axis), start(target, axis) + size(target, axis) / 2, end(target, axis)]) result.push({ position, target });
  }
  return result;
}

/** Equal-spacing positions for the box's start on one axis, among boxes sharing its cross-axis band. */
function spacingCandidates(box, axis, targets) {
  const cross = crossAxis(axis);
  const neighbours = targets.filter(target => overlaps(box, target, cross)).sort((a, b) => start(a, axis) - start(b, axis));
  const candidates = [], length = size(box, axis);
  const gaps = [];
  for (let index = 0; index < neighbours.length; index++) for (let next = index + 1; next < neighbours.length; next++) {
    const before = neighbours[index], after = neighbours[next], gap = start(after, axis) - end(before, axis);
    if (gap <= 0) continue;
    gaps.push({ before, after, gap });
    // Centred between two neighbours: equal space on both sides.
    if (gap > length) candidates.push({ value: (end(before, axis) + start(after, axis) - length) / 2, kind: "between", before, after });
  }
  // The same spacing as an existing pair, continuing a row on either side of a neighbour.
  for (const reference of gaps) for (const neighbour of neighbours) {
    candidates.push({ value: end(neighbour, axis) + reference.gap, kind: "after", neighbour, reference });
    candidates.push({ value: start(neighbour, axis) - reference.gap - length, kind: "before", neighbour, reference });
  }
  // A spaced position must land in free space, not on top of another neighbour.
  return candidates.filter(candidate => neighbours.every(neighbour =>
    candidate.value + length <= start(neighbour, axis) + EPSILON || candidate.value >= end(neighbour, axis) - EPSILON));
}

function bestOffset(box, axis, targets, canvas, threshold, { spacing = true } = {}) {
  let best = null;
  const anchors = [start(box, axis), start(box, axis) + size(box, axis) / 2, end(box, axis)];
  for (const line of lines(axis, targets, canvas)) for (const anchor of anchors) {
    const offset = line.position - anchor;
    if (Math.abs(offset) <= threshold && (!best || Math.abs(offset) < Math.abs(best.offset))) best = { offset, kind: "align" };
  }
  if (spacing) for (const candidate of spacingCandidates(box, axis, targets)) {
    const offset = candidate.value - start(box, axis);
    // Alignment wins ties: it is the more common intent.
    if (Math.abs(offset) <= threshold && (!best || Math.abs(offset) < Math.abs(best.offset) - EPSILON)) best = { offset, ...candidate };
  }
  return best;
}

/** Guide lines for every edge or center of the box that now lies on a line. */
function alignmentGuides(box, axis, targets, canvas) {
  const cross = crossAxis(axis), guides = new Map();
  const anchors = [start(box, axis), start(box, axis) + size(box, axis) / 2, end(box, axis)];
  for (const line of lines(axis, targets, canvas)) {
    if (!anchors.some(anchor => Math.abs(anchor - line.position) < EPSILON)) continue;
    const key = Math.round(line.position * 2) / 2;
    const span = line.target ? [Math.min(start(box, cross), start(line.target, cross)), Math.max(end(box, cross), end(line.target, cross))]
      : [0, cross === "x" ? canvas.width : canvas.height];
    const current = guides.get(key);
    guides.set(key, { type: "line", axis, position: line.position, from: Math.min(span[0], current?.from ?? Infinity), to: Math.max(span[1], current?.to ?? -Infinity), canvas: !line.target || current?.canvas === true });
  }
  return [...guides.values()];
}

function gapGuide(axis, from, to, a, b) {
  const cross = crossAxis(axis);
  const low = Math.max(start(a, cross), start(b, cross)), high = Math.min(end(a, cross), end(b, cross));
  return { type: "gap", axis, from, to, cross: low < high ? (low + high) / 2 : (start(a, cross) + end(a, cross)) / 2, size: Math.round(to - from) };
}

function spacingGuides(box, axis, snap) {
  if (!snap || snap.kind === "align") return [];
  if (snap.kind === "between") return [gapGuide(axis, end(snap.before, axis), start(box, axis), box, snap.before), gapGuide(axis, end(box, axis), start(snap.after, axis), box, snap.after)];
  const reference = gapGuide(axis, end(snap.reference.before, axis), start(snap.reference.after, axis), snap.reference.before, snap.reference.after);
  const placed = snap.kind === "after" ? gapGuide(axis, end(snap.neighbour, axis), start(box, axis), box, snap.neighbour)
    : gapGuide(axis, end(box, axis), start(snap.neighbour, axis), box, snap.neighbour);
  return [reference, placed];
}

/** Snap a moved box. Returns its adjusted position and the guides to draw. */
export function snapMove(box, targets, canvas, threshold) {
  const result = { ...box };
  const snaps = {};
  for (const axis of ["x", "y"]) {
    const snap = bestOffset(result, axis, targets, canvas, threshold);
    if (snap) { result[AXES[axis].start] += snap.offset; snaps[axis] = snap; }
  }
  const guides = ["x", "y"].flatMap(axis => [...alignmentGuides(result, axis, targets, canvas), ...spacingGuides(result, axis, snaps[axis])]);
  return { x: result.x, y: result.y, guides };
}

/**
 * Snap the edges a resize handle moves (n/s/e/w and corners). The opposite edges stay put.
 * Returns the adjusted geometry and alignment guides.
 */
export function snapResize(box, handle, targets, canvas, threshold, { minSize = 8 } = {}) {
  const result = { ...box };
  for (const axis of ["x", "y"]) {
    const moving = axis === "x" ? (handle.includes("e") ? "end" : handle.includes("w") ? "start" : null)
      : (handle.includes("s") ? "end" : handle.includes("n") ? "start" : null);
    if (!moving) continue;
    const edge = moving === "end" ? end(result, axis) : start(result, axis);
    let best = null;
    for (const line of lines(axis, targets, canvas)) {
      const offset = line.position - edge;
      if (Math.abs(offset) <= threshold && (!best || Math.abs(offset) < Math.abs(best))) best = offset;
    }
    if (best === null) continue;
    const keys = AXES[axis];
    if (moving === "end" && result[keys.size] + best >= minSize) result[keys.size] += best;
    else if (moving === "start" && result[keys.size] - best >= minSize) { result[keys.start] += best; result[keys.size] -= best; }
  }
  const guides = ["x", "y"].flatMap(axis => alignmentGuides(result, axis, targets, canvas));
  return { x: result.x, y: result.y, width: result.width, height: result.height, guides };
}

/** Other visible, unrotated layers usable as snap targets; `exclude` is one ID or a Set of the moved ones. */
export function snapTargets(layers, exclude) {
  const excluded = exclude instanceof Set ? exclude : new Set([exclude]);
  const seen = new Set(), result = [];
  for (const layer of layers) {
    if (!layer || excluded.has(layer.id) || seen.has(layer.id) || layer.visible === false || ((layer.rotation ?? 0) % 360) !== 0) continue;
    seen.add(layer.id);
    result.push({ id: layer.id, x: layer.x, y: layer.y, width: layer.width, height: layer.height });
  }
  return result;
}
