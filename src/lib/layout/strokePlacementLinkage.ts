import type { BoundingBox } from "../../types/spatial";

function intersectArea(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function unionBounds(boxes: readonly BoundingBox[]): BoundingBox | null {
  if (boxes.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const b of boxes) {
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.width);
    y2 = Math.max(y2, b.y + b.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export type StrokePlacementLinkage = {
  userStrokeBBox: BoundingBox | null;
  placementBBox: BoundingBox;
  iou: number;
  overlap_any: boolean;
};

/**
 * Coarse linkage between user selection strokes and final label rect (data-model §8).
 */
export function computeStrokePlacementLinkage(args: {
  userStrokeBboxes: readonly BoundingBox[];
  placementBBox: BoundingBox;
}): StrokePlacementLinkage {
  const u = unionBounds(args.userStrokeBboxes);
  if (!u) {
    return {
      userStrokeBBox: null,
      placementBBox: args.placementBBox,
      iou: 0,
      overlap_any: false,
    };
  }
  const inter = intersectArea(u, args.placementBBox);
  const au = Math.max(1e-9, u.width * u.height);
  const ap = Math.max(1e-9, args.placementBBox.width * args.placementBBox.height);
  const unionA = au + ap - inter;
  const iou = unionA > 0 ? inter / unionA : 0;
  return {
    userStrokeBBox: u,
    placementBBox: args.placementBBox,
    iou,
    overlap_any: inter > 1e-9,
  };
}
