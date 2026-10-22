/**
 * Distances shown while Alt is held: from a box to the nearest layer on each side, or to the
 * edge of the frame (the canvas, or a hovered layer that contains the box) when none lies that
 * way. Boxes are unrotated {x, y, width, height}; no DOM or Foundry dependency.
 */
const AXES = { x: ["x", "width", "y", "height"], y: ["y", "height", "x", "width"] };

function sideDistances(box, others, frame, axis) {
  const [start, size, crossStart, crossSize] = AXES[axis];
  const end = value => value[start] + value[size];
  const overlaps = other => other[crossStart] < box[crossStart] + box[crossSize] && box[crossStart] < other[crossStart] + other[crossSize];
  // The line runs through the middle of the span both boxes share, or the box's own middle.
  const cross = other => other
    ? (Math.max(box[crossStart], other[crossStart]) + Math.min(box[crossStart] + box[crossSize], other[crossStart] + other[crossSize])) / 2
    : box[crossStart] + box[crossSize] / 2;
  const before = others.filter(other => overlaps(other) && end(other) <= box[start]).sort((a, b) => end(b) - end(a))[0];
  const after = others.filter(other => overlaps(other) && other[start] >= end(box)).sort((a, b) => a[start] - b[start])[0];
  return [
    { axis, from: before ? end(before) : frame[start], to: box[start], cross: cross(before) },
    { axis, from: end(box), to: after ? after[start] : frame[start] + frame[size], cross: cross(after) }
  ];
}

/** Measurement segments {axis, from, to, cross, size}; zero and negative distances are left out. */
export function measureDistances(box, others, frame) {
  return ["x", "y"].flatMap(axis => sideDistances(box, others, frame, axis))
    .map(segment => ({ ...segment, size: Math.round((segment.to - segment.from) * 10) / 10 }))
    .filter(segment => segment.size > 0);
}

export function containsPoint(box, x, y) {
  return x >= box.x && y >= box.y && x <= box.x + box.width && y <= box.y + box.height;
}
