/**
 * Align and distribute in native overlay pixels on unrotated {id, x, y, width, height} boxes.
 * Functions return new positions by ID and never change their input; no DOM or Foundry dependency.
 */
export const ALIGNMENTS = Object.freeze(["left", "center", "right", "top", "middle", "bottom"]);
const exact = value => Math.round(value * 100) / 100;

export function boundsOf(boxes) {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function containsBox(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/** Positions that put each box's edge or center on the same edge or center of `frame`. */
export function alignPositions(boxes, edge, frame) {
  if (!ALIGNMENTS.includes(edge)) throw new TypeError("Choose left, center, right, top, middle or bottom.");
  const positions = new Map();
  for (const box of boxes) {
    let { x, y } = box;
    if (edge === "left") x = frame.x;
    else if (edge === "center") x = frame.x + (frame.width - box.width) / 2;
    else if (edge === "right") x = frame.x + frame.width - box.width;
    else if (edge === "top") y = frame.y;
    else if (edge === "middle") y = frame.y + (frame.height - box.height) / 2;
    else y = frame.y + frame.height - box.height;
    positions.set(box.id, { x: exact(x), y: exact(y) });
  }
  return positions;
}

/**
 * Equal gaps between three or more boxes along "x" or "y". The first and last boxes in that
 * direction stay where they are; the others keep their order.
 */
export function distributePositions(boxes, axis) {
  if (!["x", "y"].includes(axis)) throw new TypeError("Distribute along x or y.");
  const size = axis === "x" ? "width" : "height";
  const ordered = [...boxes].sort((a, b) => a[axis] - b[axis] || a[size] - b[size]);
  const positions = new Map(boxes.map(box => [box.id, { x: box.x, y: box.y }]));
  if (ordered.length < 3) return positions;
  const first = ordered[0], last = ordered.at(-1);
  const span = last[axis] + last[size] - first[axis];
  const gap = (span - ordered.reduce((total, box) => total + box[size], 0)) / (ordered.length - 1);
  let cursor = first[axis];
  for (const box of ordered) {
    positions.get(box.id)[axis] = exact(cursor);
    cursor += box[size] + gap;
  }
  return positions;
}
