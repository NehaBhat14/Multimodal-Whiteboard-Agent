import { describe, it, expect } from "vitest";
import { computeGeometryFeatures } from "../../../../src/lib/layout/geometryFeatures";
import type { BoundingBox } from "../../../../src/types/spatial";

describe("computeGeometryFeatures", () => {
  it("returns neutral for empty input", () => {
    const g = computeGeometryFeatures([]);
    expect(g.layoutHint).toBe("NEUTRAL");
    expect(g.columnScore).toBe(0);
  });

  it("detects column-like x alignment for stacked vertical strips", () => {
    const boxes: BoundingBox[] = [
      { x: 100, y: 0, width: 40, height: 20 },
      { x: 102, y: 30, width: 38, height: 20 },
      { x: 101, y: 60, width: 39, height: 20 },
    ];
    const g = computeGeometryFeatures(boxes);
    expect(g.columnScore).toBeGreaterThan(0.4);
    expect(["COLUMNAR", "NEUTRAL", "RESEARCH_STACK"]).toContain(g.layoutHint);
  });
});
