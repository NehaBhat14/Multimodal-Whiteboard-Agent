export type InheritWidthShape = { type: string; width: number };

const MIN_W = 40;
const MAX_W = 1200;

/**
 * Median width of text-like shapes, clamped — selection column inheritance (spec FR-004).
 */
export function inheritTextColumnWidth(
  shapes: readonly InheritWidthShape[],
  isTextLike: (type: string) => boolean = (t) => t === "text",
): number | null {
  const widths = shapes
    .filter((s) => isTextLike(s.type) && Number.isFinite(s.width) && s.width > 0)
    .map((s) => s.width);
  if (widths.length === 0) return null;
  const sorted = [...widths].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.min(MAX_W, Math.max(MIN_W, median));
}
