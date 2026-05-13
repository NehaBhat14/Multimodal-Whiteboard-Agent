import type { BoundingBox } from "../../types/spatial";

export function computeEnclosingBoundingBox(
  bounds: readonly BoundingBox[],
): BoundingBox {
  if (bounds.length === 0) {
    throw new Error("computeEnclosingBoundingBox: bounds must be non-empty");
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const b of bounds) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

