import { describe, it, expect } from "vitest";
import { applyCollisionAwarePadding } from "../../../src/lib/spatial/applyCollisionAwarePadding";
import type { BoundingBox } from "../../../src/types/spatial";

describe("applyCollisionAwarePadding", () => {
  it("expands by maxPadding when there are no other boxes", () => {
    const selection: BoundingBox = { x: 0, y: 0, width: 10, height: 10 };
    const result = applyCollisionAwarePadding(selection, [], 16);

    expect(result).toEqual({
      x: -16,
      y: -16,
      width: 10 + 2 * 16,
      height: 10 + 2 * 16,
    });
  });

  it("returns the strict selection when padding=0 already overlaps", () => {
    const selection: BoundingBox = { x: 0, y: 0, width: 10, height: 10 };
    // Overlaps in both axes at padding=0.
    const other: BoundingBox = { x: 5, y: 5, width: 10, height: 10 };

    const result = applyCollisionAwarePadding(selection, [other], 16);
    expect(result).toEqual(selection);
  });

  it("reduces padding so expanded bbox does not strictly overlap (gap-limited)", () => {
    const selection: BoundingBox = { x: 0, y: 0, width: 10, height: 10 };
    // Other box begins 6 units to the right of selection's right edge.
    // Safe padding is therefore p=6 (at p=6 edges touch => no strict overlap).
    const other: BoundingBox = { x: 16, y: 0, width: 10, height: 10 };

    const result = applyCollisionAwarePadding(selection, [other], 16);

    expect(result.x).toBeCloseTo(-6, 5);
    expect(result.y).toBeCloseTo(-6, 5);
    expect(result.width).toBeCloseTo(22, 4); // 10 + 2*6
    expect(result.height).toBeCloseTo(22, 4); // 10 + 2*6
  });

  it("handles degenerate selections (width=0) by expanding outward", () => {
    const selection: BoundingBox = { x: 0, y: 0, width: 0, height: 0 };
    const result = applyCollisionAwarePadding(selection, [], 16);

    expect(result).toEqual({ x: -16, y: -16, width: 32, height: 32 });
  });
});

