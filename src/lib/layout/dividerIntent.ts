import type { RectLike } from "./projectionProfiling";

export type DividerIntentResult = {
  dividerIntent: boolean;
  splitColumnContext: boolean;
  strength: number;
  dividerX: number | null;
  dividerY: number | null;
  verticalDividerXs: number[];
  horizontalDividerYs: number[];
};

function isLikelyVertical(width: number, height: number): boolean {
  if (height <= 0) return false;
  return width / height <= 0.2;
}

function isLikelyHorizontal(width: number, height: number): boolean {
  if (width <= 0) return false;
  return height / width <= 0.2;
}

function weightedCenter(
  rects: readonly RectLike[],
  axis: "x" | "y",
  weightAxis: "width" | "height",
): number | null {
  const weightSum = rects.reduce(
    (sum, rect) => sum + Math.max(1, rect[weightAxis]),
    0,
  );
  if (weightSum === 0) return null;
  return (
    rects.reduce((sum, rect) => {
      const center =
        axis === "x" ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
      return sum + center * Math.max(1, rect[weightAxis]);
    }, 0) / weightSum
  );
}

export function detectDividerIntent(rects: readonly RectLike[]): DividerIntentResult {
  if (rects.length === 0) {
    return {
      dividerIntent: false,
      splitColumnContext: false,
      strength: 0,
      dividerX: null,
      dividerY: null,
      verticalDividerXs: [],
      horizontalDividerYs: [],
    };
  }

  const verticalCandidates = rects.filter((r) =>
    isLikelyVertical(Math.max(0, r.width), Math.max(0, r.height)),
  );

  const horizontalCandidates = rects.filter((r) =>
    isLikelyHorizontal(Math.max(0, r.width), Math.max(0, r.height)),
  );

  if (verticalCandidates.length === 0 && horizontalCandidates.length === 0) {
    return {
      dividerIntent: false,
      splitColumnContext: false,
      strength: 0,
      dividerX: null,
      dividerY: null,
      verticalDividerXs: [],
      horizontalDividerYs: [],
    };
  }

  const longVerticalSegments = verticalCandidates.filter(
    (r) => r.height >= 120,
  ).length;
  const shortVerticalSegments = verticalCandidates.length - longVerticalSegments;
  const verticalStrength = Math.min(
    1,
    longVerticalSegments * 0.6 + shortVerticalSegments * 0.2,
  );

  const longHorizontalSegments = horizontalCandidates.filter(
    (r) => r.width >= 120,
  ).length;
  const shortHorizontalSegments =
    horizontalCandidates.length - longHorizontalSegments;
  const horizontalStrength = Math.min(
    1,
    longHorizontalSegments * 0.6 + shortHorizontalSegments * 0.2,
  );
  const strength = Math.max(verticalStrength, horizontalStrength);

  const verticalDividerXs = verticalCandidates
    .map((rect) => rect.x + rect.width / 2)
    .sort((a, b) => a - b);
  const horizontalDividerYs = horizontalCandidates
    .map((rect) => rect.y + rect.height / 2)
    .sort((a, b) => a - b);

  return {
    dividerIntent: strength >= 0.5,
    splitColumnContext: verticalStrength >= 0.5,
    strength,
    dividerX: weightedCenter(verticalCandidates, "x", "height"),
    dividerY: weightedCenter(horizontalCandidates, "y", "width"),
    verticalDividerXs,
    horizontalDividerYs,
  };
}
