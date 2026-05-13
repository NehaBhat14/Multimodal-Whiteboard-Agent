import type { BoundingBox } from "../../types/spatial";
import type {
  GeometryFeatures,
  GeometryLayoutHint,
} from "./placementContextTypes";

/**
 * Deterministic coarse geometry from page-space shape bounds (plan Slice B1).
 */
export function computeGeometryFeatures(
  shapeBounds: readonly BoundingBox[],
): GeometryFeatures {
  if (shapeBounds.length === 0) {
    return {
      columnScore: 0,
      verticalStackScore: 0,
      layoutHint: "NEUTRAL",
    };
  }

  const minX = Math.min(...shapeBounds.map((b) => b.x));
  const maxX = Math.max(...shapeBounds.map((b) => b.x + b.width));
  const span = Math.max(1e-6, maxX - minX);
  const bins = 12;
  const counts = new Array(bins).fill(0);
  for (const b of shapeBounds) {
    const cx = b.x + b.width / 2;
    const i = Math.min(
      bins - 1,
      Math.max(0, Math.floor(((cx - minX) / span) * bins)),
    );
    counts[i] = (counts[i] ?? 0) + 1;
  }
  const maxPeak = Math.max(...counts);
  const columnScore = Math.min(
    1,
    maxPeak / Math.max(1, shapeBounds.length * 0.45),
  );

  let ux = Infinity;
  let uy = Infinity;
  let uX = -Infinity;
  let uY = -Infinity;
  for (const b of shapeBounds) {
    ux = Math.min(ux, b.x);
    uy = Math.min(uy, b.y);
    uX = Math.max(uX, b.x + b.width);
    uY = Math.max(uY, b.y + b.height);
  }
  const uw = Math.max(1e-6, uX - ux);
  const uh = uY - uy;
  const ar = uh / uw;
  const verticalStackScore = Math.min(1, ar / 2.8);

  let layoutHint: GeometryLayoutHint = "NEUTRAL";
  if (columnScore > 0.5 && verticalStackScore < 0.55) layoutHint = "COLUMNAR";
  else if (verticalStackScore > 0.48) layoutHint = "RESEARCH_STACK";

  return { columnScore, verticalStackScore, layoutHint };
}
