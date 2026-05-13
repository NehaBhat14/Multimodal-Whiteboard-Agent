import { describe, it, expect } from "vitest";
import { computeEnclosingBoundingBox } from "../../../src/lib/spatial/computeEnclosingBoundingBox";
import type { BoundingBox } from "../../../src/types/spatial";

describe("computeEnclosingBoundingBox", () => {
  it("encloses multiple boxes (positive coordinates)", () => {
    const bounds: BoundingBox[] = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 10, width: 5, height: 20 },
    ];

    expect(computeEnclosingBoundingBox(bounds)).toEqual({
      x: 0,
      y: 0,
      width: 25,
      height: 30,
    });
  });

  it("encloses negative coordinates", () => {
    const bounds: BoundingBox[] = [
      { x: -10, y: -5, width: 4, height: 3 },
      { x: -3, y: 2, width: 10, height: 1 },
    ];

    expect(computeEnclosingBoundingBox(bounds)).toEqual({
      x: -10,
      y: -5,
      width: 17, // ( -3 + 10 ) - ( -10 )
      height: 8, // (2+1) - (-5)
    });
  });

  it("returns the original box for a single input", () => {
    const box: BoundingBox = { x: 7, y: 8, width: 9, height: 10 };
    expect(computeEnclosingBoundingBox([box])).toEqual(box);
  });

  it("throws on empty input", () => {
    expect(() => computeEnclosingBoundingBox([])).toThrow(
      /bounds must be non-empty/i,
    );
  });
});

