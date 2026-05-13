import { describe, it, expect } from "vitest";
import { computeStrokePlacementLinkage } from "../../../../src/lib/layout/strokePlacementLinkage";

describe("computeStrokePlacementLinkage", () => {
  const placement = { x: 100, y: 100, width: 80, height: 40 };

  it("returns null union when no strokes", () => {
    const r = computeStrokePlacementLinkage({
      userStrokeBboxes: [],
      placementBBox: placement,
    });
    expect(r.userStrokeBBox).toBeNull();
    expect(r.iou).toBe(0);
    expect(r.overlap_any).toBe(false);
  });

  it("detects disjoint stroke union", () => {
    const r = computeStrokePlacementLinkage({
      userStrokeBboxes: [{ x: 0, y: 0, width: 10, height: 10 }],
      placementBBox: placement,
    });
    expect(r.overlap_any).toBe(false);
    expect(r.iou).toBe(0);
  });

  it("detects partial overlap", () => {
    const r = computeStrokePlacementLinkage({
      userStrokeBboxes: [{ x: 120, y: 110, width: 40, height: 40 }],
      placementBBox: placement,
    });
    expect(r.overlap_any).toBe(true);
    expect(r.iou).toBeGreaterThan(0);
    expect(r.iou).toBeLessThanOrEqual(1);
  });

  it("nested union bbox", () => {
    const r = computeStrokePlacementLinkage({
      userStrokeBboxes: [
        { x: 50, y: 50, width: 20, height: 20 },
        { x: 55, y: 55, width: 20, height: 20 },
      ],
      placementBBox: { x: 60, y: 60, width: 100, height: 100 },
    });
    expect(r.userStrokeBBox).not.toBeNull();
    expect(r.userStrokeBBox!.width).toBeGreaterThanOrEqual(20);
  });
});
