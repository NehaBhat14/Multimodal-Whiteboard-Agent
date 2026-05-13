import type { BoundingBox } from "../../types/spatial";
import { aabbStrictlyOverlaps } from "../../types/spatial";

function expandBoundingBox(b: BoundingBox, padding: number): BoundingBox {
  return {
    x: b.x - padding,
    y: b.y - padding,
    width: b.width + 2 * padding,
    height: b.height + 2 * padding,
  };
}

/**
 * Expands `selectionBBox` by up to `maxPadding` (uniform on all sides),
 * reducing padding so the expanded bbox would not strictly AABB-overlap any
 * `otherBBoxes`.
 *
 * Collision rule (strict AABB overlap):
 * - overlap area must be > 0 on both axes
 * - edge-touching / zero-overlap is NOT considered an intersection
 *
 * Safety behavior:
 * - If the strict selection bbox (padding=0) already intersects at least one
 *   unselected bbox, safe padding is `0` (return the original selection bbox).
 * - If no collision occurs even at `maxPadding`, return the fully expanded
 *   bbox (`p = maxPadding`).
 *
 * Padding selection:
 * - Otherwise, find the maximum safe uniform padding `p` in `[0, maxPadding]`
 *   via monotonic binary search (more padding => larger expanded bbox => if it
 *   collides at `p`, it will also collide for any larger `p`).
 *
 * Degenerate selection:
 * - If `selectionBBox.width` and/or `selectionBBox.height` is `0`, the expanded
 *   size still follows `width + 2p` / `height + 2p`, so the maximum padded size
 *   along a degenerate axis is `2 * maxPadding` (32x32 when `maxPadding = 16`).
 */
export function applyCollisionAwarePadding(
  selectionBBox: BoundingBox,
  otherBBoxes: readonly BoundingBox[],
  maxPadding: number,
): BoundingBox {
  if (maxPadding <= 0 || otherBBoxes.length === 0) {
    return expandBoundingBox(selectionBBox, Math.max(0, maxPadding));
  }

  const overlapsAt = (padding: number) => {
    const expanded = expandBoundingBox(selectionBBox, padding);
    return otherBBoxes.some((b) => aabbStrictlyOverlaps(expanded, b));
  };

  // If we already collide at padding=0, safe padding is 0.
  if (overlapsAt(0)) {
    return selectionBBox;
  }

  // If we don't collide even at maxPadding, use full padding.
  if (!overlapsAt(maxPadding)) {
    return expandBoundingBox(selectionBBox, maxPadding);
  }

  // Binary search for the maximum safe padding where overlapsAt(padding) is false.
  let lo = 0;
  let hi = maxPadding;

  // Fixed-iteration search for deterministic results (stable unit tests).
  for (let i = 0; i < 45; i++) {
    const mid = (lo + hi) / 2;
    if (overlapsAt(mid)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return expandBoundingBox(selectionBBox, lo);
}

