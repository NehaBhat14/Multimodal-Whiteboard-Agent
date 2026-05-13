import type { BoundingBox } from "../../types/spatial";
import { aabbStrictlyOverlaps } from "../../types/spatial";
import type { PerSideFeasibility } from "./placementContextTypes";
import type { PlacementSide } from "./computeOutputPlacementRect";
import { placementRectForSide } from "./computeOutputPlacementRect";
import { planTextLayout } from "./planTextLayout";
import { LINE_HEIGHT_MULT_LATIN, TLDRAW_LIKE_FONT_PX } from "./layoutConstants";

const CANONICAL_SIDES: PlacementSide[] = ["below", "right", "left", "above"];

function availableHeightForSide(
  side: PlacementSide,
  forbidden: BoundingBox,
  viewport: BoundingBox,
  gap: number,
): number {
  const bottom = forbidden.y + forbidden.height;
  const top = forbidden.y;
  switch (side) {
    case "below":
      return Math.max(0, viewport.y + viewport.height - (bottom + gap));
    case "above":
      return Math.max(0, top - gap - viewport.y);
    case "right":
    case "left":
      return Math.max(0, viewport.height);
    default:
      return viewport.height;
  }
}

function rectInsideViewport(
  rect: BoundingBox,
  vp: BoundingBox,
  eps = 1e-6,
): boolean {
  return (
    rect.x >= vp.x - eps &&
    rect.y >= vp.y - eps &&
    rect.x + rect.width <= vp.x + vp.width + eps &&
    rect.y + rect.height <= vp.y + vp.height + eps
  );
}

function maxWidthViewportFit(
  side: PlacementSide,
  forbidden: BoundingBox,
  viewport: BoundingBox,
  gap: number,
  hProbe: number,
): number {
  let lo = 1;
  let hi = Math.max(1, Math.ceil(viewport.width * 4));
  let best = 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const r = placementRectForSide(side, forbidden, gap, mid, hProbe);
    if (rectInsideViewport(r, viewport)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function strictRectOk(
  rect: BoundingBox,
  forbidden: BoundingBox,
  obstacles: readonly BoundingBox[],
): boolean {
  if (aabbStrictlyOverlaps(rect, forbidden)) return false;
  return !obstacles.some((o) => aabbStrictlyOverlaps(rect, o));
}

/**
 * Per-side maximum label width from geometric strip, inheritance cap, and
 * measured wrap height (research §5).
 */
export function probeMaxUsableWidth(args: {
  forbidden: BoundingBox;
  viewport: BoundingBox;
  gap: number;
  obstacles: readonly BoundingBox[];
  text: string;
  inheritWidthCap: number | null;
  maxLines?: number;
  maxChars?: number;
}): PerSideFeasibility[] {
  const hProbe = TLDRAW_LIKE_FONT_PX * LINE_HEIGHT_MULT_LATIN;

  return CANONICAL_SIDES.map((side) => {
    const availH = availableHeightForSide(
      side,
      args.forbidden,
      args.viewport,
      args.gap,
    );
    const wGeo = maxWidthViewportFit(
      side,
      args.forbidden,
      args.viewport,
      args.gap,
      hProbe,
    );
    const wCap = Math.min(wGeo, args.inheritWidthCap ?? wGeo);

    let bestW = 1;
    let lo = 1;
    let hi = Math.max(1, Math.floor(wCap));
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const plan = planTextLayout({
        placement: {
          x: 0,
          y: 0,
          width: mid,
          height: Math.max(availH, hProbe, 1),
        },
        text: args.text,
        maxLines: args.maxLines,
        maxChars: args.maxChars,
      });
      const hUsed = Math.max(plan.placement.height, hProbe);
      const rect = placementRectForSide(side, args.forbidden, args.gap, mid, hUsed);
      const fits =
        rectInsideViewport(rect, args.viewport) &&
        plan.placement.height <= availH + 1e-3;
      if (fits) {
        bestW = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const finalPlan = planTextLayout({
      placement: {
        x: 0,
        y: 0,
        width: bestW,
        height: Math.max(availH, hProbe, 1),
      },
      text: args.text,
      maxLines: args.maxLines,
      maxChars: args.maxChars,
    });
    const hReq = finalPlan.placement.height;
    const rect = placementRectForSide(
      side,
      args.forbidden,
      args.gap,
      bestW,
      hReq,
    );
    const strict = strictRectOk(rect, args.forbidden, args.obstacles);
    const relaxed = !aabbStrictlyOverlaps(rect, args.forbidden);

    return {
      side,
      wMax: bestW,
      hRequired: hReq,
      strictFeasible: strict,
      relaxedFeasible: relaxed,
    };
  });
}
