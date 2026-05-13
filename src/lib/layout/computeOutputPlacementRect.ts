import type { BoundingBox } from "../../types/spatial";
import { aabbStrictlyOverlaps } from "../../types/spatial";

export type PlacementSide = "below" | "right" | "left" | "above";

export interface ComputeOutputPlacementRectInput {
  forbidden: BoundingBox;
  preferredSize: { width: number; height: number };
  gap: number;
  candidates: readonly PlacementSide[];
  obstacles: readonly BoundingBox[];
  /** Page-space visible region; caps preferred size and clamps the chosen rect. */
  viewport?: BoundingBox;
  /**
   * Override Y anchor for `right`/`left` candidates. Used for cross-divider
   * placements where the answer should sit at the TOP of the target lane
   * (mirroring newspaper column reading order), not parallel to the
   * selection's Y. Ignored for `above`/`below`.
   */
  sideAnchorY?: number;
}

/**
 * Shared with {@link ./probeMaxUsableWidth} for side-anchored probe rects.
 *
 * `sideAnchorY` overrides the Y origin for `right`/`left` only. Defaults to
 * `forbidden.y` so existing callers (probe, same-lane placement) keep their
 * parallel-to-selection behavior.
 */
export function placementRectForSide(
  side: PlacementSide,
  forbidden: BoundingBox,
  gap: number,
  w: number,
  h: number,
  sideAnchorY?: number,
): BoundingBox {
  const { x: fx, y: fy, width: fw, height: fh } = forbidden;
  const left = fx;
  const right = fx + fw;
  const top = fy;
  const bottom = fy + fh;
  const sideTop = typeof sideAnchorY === "number" ? sideAnchorY : top;

  switch (side) {
    case "below":
      return { x: left, y: bottom + gap, width: w, height: h };
    case "right":
      return { x: right + gap, y: sideTop, width: w, height: h };
    case "left":
      return { x: left - gap - w, y: sideTop, width: w, height: h };
    case "above":
      return { x: left, y: top - gap - h, width: w, height: h };
  }
}

function overlapsForbidden(rect: BoundingBox, forbidden: BoundingBox): boolean {
  return aabbStrictlyOverlaps(rect, forbidden);
}

function overlapsAnyObstacle(
  rect: BoundingBox,
  obstacles: readonly BoundingBox[],
): boolean {
  return obstacles.some((o) => aabbStrictlyOverlaps(rect, o));
}

export function clampPlacementToViewport(
  rect: BoundingBox,
  viewport: BoundingBox,
): BoundingBox {
  const w = Math.max(0, Math.min(rect.width, viewport.width));
  const h = Math.max(0, Math.min(rect.height, viewport.height));
  const x = Math.max(
    viewport.x,
    Math.min(rect.x, viewport.x + viewport.width - w),
  );
  const y = Math.max(
    viewport.y,
    Math.min(rect.y, viewport.y + viewport.height - h),
  );
  return { x, y, width: w, height: h };
}

const GRID_COLS = 12;
const GRID_ROWS = 12;
const SHRINK_STEP = 0.9;
const MIN_SHRINK = 0.4;
/** Right/left candidates are skipped when narrower than this (not readable). */
const MIN_SIDE_CANDIDATE_WIDTH = 200;
const STACK_SCAN_STEP = 24;

/**
 * Grid-sample viewport positions and pick the clean one closest to "below
 * forbidden". `checkObstacles=false` only rejects forbidden overlap — used
 * as a last resort on crowded canvases.
 */
/**
 * Grid-sample the viewport and pick a non-overlapping rect whose top-left is
 * closest to `preferred` (for diagram labels / canvasActions nudging).
 */
function gridSearchNearPreferred(
  preferred: { x: number; y: number },
  forbidden: BoundingBox,
  obstacles: readonly BoundingBox[],
  viewport: BoundingBox,
  w: number,
  h: number,
  checkObstacles: boolean,
): BoundingBox | null {
  const minX = viewport.x;
  const minY = viewport.y;
  const maxX = viewport.x + viewport.width - w;
  const maxY = viewport.y + viewport.height - h;
  if (maxX < minX || maxY < minY) return null;

  const stepX = GRID_COLS > 1 ? (maxX - minX) / (GRID_COLS - 1) : 0;
  const stepY = GRID_ROWS > 1 ? (maxY - minY) / (GRID_ROWS - 1) : 0;

  let bestRect: BoundingBox | null = null;
  let bestScore = Infinity;

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x = minX + col * stepX;
      const y = minY + row * stepY;
      const rect: BoundingBox = { x, y, width: w, height: h };

      if (overlapsForbidden(rect, forbidden)) continue;
      if (checkObstacles && overlapsAnyObstacle(rect, obstacles)) continue;

      const dx = x - preferred.x;
      const dy = y - preferred.y;
      const score = dx * dx + dy * dy * 0.85;
      if (score < bestScore) {
        bestScore = score;
        bestRect = rect;
      }
    }
  }

  return bestRect;
}

/**
 * Resolve a size box near model-proposed (x, y) that does not overlap
 * `forbidden` or `obstacles`, staying inside `viewport`. Uses the same
 * overlap rules as {@link computeOutputPlacementRect}.
 */
export function findClearRectNearPreferred(
  preferred: { x: number; y: number },
  size: { width: number; height: number },
  forbidden: BoundingBox,
  obstacles: readonly BoundingBox[],
  viewport: BoundingBox,
): BoundingBox {
  let w = Math.max(40, size.width);
  let h = Math.max(24, size.height);

  let picked = gridSearchNearPreferred(
    preferred,
    forbidden,
    obstacles,
    viewport,
    w,
    h,
    true,
  );
  if (picked) return picked;

  let scale = 1.0;
  while (scale >= MIN_SHRINK) {
    const sw = Math.max(40, w * scale);
    const sh = Math.max(24, h * scale);
    picked = gridSearchNearPreferred(
      preferred,
      forbidden,
      obstacles,
      viewport,
      sw,
      sh,
      true,
    );
    if (picked) return picked;
    scale *= SHRINK_STEP;
  }

  picked = gridSearchNearPreferred(
    preferred,
    forbidden,
    obstacles,
    viewport,
    w,
    h,
    false,
  );
  if (picked) return picked;

  return clampPlacementToViewport(
    { x: preferred.x, y: preferred.y, width: w, height: h },
    viewport,
  );
}

function gridSearchClean(
  forbidden: BoundingBox,
  obstacles: readonly BoundingBox[],
  viewport: BoundingBox,
  gap: number,
  w: number,
  h: number,
  checkObstacles: boolean = true,
): BoundingBox | null {
  const minX = viewport.x;
  const minY = viewport.y;
  const maxX = viewport.x + viewport.width - w;
  const maxY = viewport.y + viewport.height - h;
  if (maxX < minX || maxY < minY) return null;

  const stepX = GRID_COLS > 1 ? (maxX - minX) / (GRID_COLS - 1) : 0;
  const stepY = GRID_ROWS > 1 ? (maxY - minY) / (GRID_ROWS - 1) : 0;

  // Ideal anchor: just below the forbidden region.
  const idealX = forbidden.x;
  const idealY = forbidden.y + forbidden.height + gap;

  let bestRect: BoundingBox | null = null;
  let bestScore = Infinity;

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x = minX + col * stepX;
      const y = minY + row * stepY;
      const rect: BoundingBox = { x, y, width: w, height: h };

      if (overlapsForbidden(rect, forbidden)) continue;
      if (checkObstacles && overlapsAnyObstacle(rect, obstacles)) continue;

      // Y downweighted 0.6× so "sideways but on level" beats "below but far".
      const dx = x - idealX;
      const dy = y - idealY;
      const score = dx * dx + dy * dy * 0.6;
      if (score < bestScore) {
        bestScore = score;
        bestRect = rect;
      }
    }
  }

  return bestRect;
}

function scanColumnSideSlots(
  side: "right" | "left",
  forbidden: BoundingBox,
  obstacles: readonly BoundingBox[],
  viewport: BoundingBox,
  gap: number,
  w: number,
  h: number,
  sideAnchorY?: number,
): BoundingBox | null {
  const base = placementRectForSide(side, forbidden, gap, w, h, sideAnchorY);
  const maxY = viewport.y + viewport.height - h;
  if (base.y > maxY) return null;

  // Stay in the same side-column and scan downward before changing sides.
  const step = Math.max(STACK_SCAN_STEP, Math.floor(h * 0.5));
  for (let y = Math.max(viewport.y, base.y); y <= maxY; y += step) {
    const rect = { x: base.x, y, width: w, height: h };
    if (overlapsForbidden(rect, forbidden)) continue;
    if (overlapsAnyObstacle(rect, obstacles)) continue;
    return rect;
  }
  return null;
}

/**
 * Pick a page-space rect for AI text beside `forbidden`. Strategy:
 * fixed-candidate fast path → grid search → shrink-and-retry grid search →
 * last-resort first-candidate. Final clamp to viewport when provided.
 */
export function computeOutputPlacementRect(
  input: ComputeOutputPlacementRectInput,
): BoundingBox {
  const gap = Math.max(0, input.gap);
  let prefW = Math.max(0, input.preferredSize.width);
  let prefH = Math.max(0, input.preferredSize.height);

  if (input.viewport) {
    const vp = input.viewport;
    prefW = Math.min(prefW, vp.width);
    prefH = Math.min(prefH, vp.height);
  }

  // Below/above use prefW as-is; right/left shrink to the room available
  // beside the selection so a wide preferred doesn't overflow into clamp hell.
  const widthForSide = (side: PlacementSide): number => {
    if (!input.viewport) return prefW;
    const vp = input.viewport;
    if (side === "right") {
      const available =
        vp.x + vp.width - (input.forbidden.x + input.forbidden.width) - gap;
      return Math.max(0, Math.min(prefW, available));
    }
    if (side === "left") {
      const available = input.forbidden.x - vp.x - gap;
      return Math.max(0, Math.min(prefW, available));
    }
    return prefW;
  };

  const sideAnchor = input.sideAnchorY;
  const tryFixedCandidates = (requireClearObstacles: boolean): BoundingBox | null => {
    for (const side of input.candidates) {
      const w = widthForSide(side);
      if ((side === "right" || side === "left") && w < MIN_SIDE_CANDIDATE_WIDTH) {
        continue;
      }
      const rect = placementRectForSide(
        side,
        input.forbidden,
        gap,
        w,
        prefH,
        side === "right" || side === "left" ? sideAnchor : undefined,
      );
      if (overlapsForbidden(rect, input.forbidden)) continue;
      // Pre-check the clamp: a rect partly outside the viewport gets
      // dragged inward by clampPlacementToViewport, which can move it
      // INTO forbidden. Reject here instead of after the fact.
      if (input.viewport) {
        const clamped = clampPlacementToViewport(rect, input.viewport);
        if (overlapsForbidden(clamped, input.forbidden)) continue;
      }
      if (requireClearObstacles && overlapsAnyObstacle(rect, input.obstacles)) {
        if (
          input.viewport &&
          (side === "right" || side === "left") &&
          !overlapsForbidden(rect, input.forbidden)
        ) {
          const stacked = scanColumnSideSlots(
            side,
            input.forbidden,
            input.obstacles,
            input.viewport,
            gap,
            w,
            prefH,
            sideAnchor,
          );
          if (stacked) return stacked;
        }
        continue;
      }
      return rect;
    }
    return null;
  };

  let picked: BoundingBox | null = tryFixedCandidates(true);

  if (!picked && input.viewport) {
    let scale = 1.0;
    while (scale >= MIN_SHRINK) {
      const w = prefW * scale;
      const h = prefH * scale;
      const found = gridSearchClean(
        input.forbidden,
        input.obstacles,
        input.viewport,
        gap,
        w,
        h,
      );
      if (found) {
        picked = found;
        break;
      }
      scale *= SHRINK_STEP;
    }
  }

  if (!picked) {
    const lastResortSide = input.candidates[0] ?? "below";
    picked =
      tryFixedCandidates(false) ??
      placementRectForSide(
        lastResortSide,
        input.forbidden,
        gap,
        widthForSide(lastResortSide),
        prefH,
        lastResortSide === "right" || lastResortSide === "left"
          ? sideAnchor
          : undefined,
      );
  }

  if (input.viewport) {
    const clamped = clampPlacementToViewport(picked, input.viewport);
    // Post-clamp rescue: if the final rect landed inside forbidden after
    // clamp, do a forbidden-only grid search to guarantee we clear it.
    if (overlapsForbidden(clamped, input.forbidden)) {
      const rescued = gridSearchClean(
        input.forbidden,
        input.obstacles,
        input.viewport,
        gap,
        clamped.width,
        clamped.height,
        /* checkObstacles */ false,
      );
      if (rescued) return rescued;
    }
    return clamped;
  }
  return picked;
}
