import { describe, expect, it } from "vitest";
import { detectDividerIntent } from "../../../src/lib/layout/dividerIntent";

describe("detectDividerIntent", () => {
  it("detects strong divider intent from a long vertical segment", () => {
    const result = detectDividerIntent([{ x: 200, y: 10, width: 8, height: 240 }]);
    expect(result.dividerIntent).toBe(true);
    expect(result.splitColumnContext).toBe(true);
    expect(result.strength).toBeGreaterThanOrEqual(0.5);
    expect(result.dividerX).toBeCloseTo(204);
    expect(result.verticalDividerXs.length).toBe(1);
  });

  it("detects divider intent from clustered short vertical marks", () => {
    const result = detectDividerIntent([
      { x: 210, y: 10, width: 8, height: 80 },
      { x: 212, y: 100, width: 10, height: 70 },
      { x: 211, y: 180, width: 9, height: 85 },
    ]);
    expect(result.dividerIntent).toBe(true);
  });

  it("does not mark divider intent for wide horizontal shapes", () => {
    const result = detectDividerIntent([{ x: 0, y: 0, width: 220, height: 20 }]);
    expect(result.dividerIntent).toBe(true);
    expect(result.splitColumnContext).toBe(false);
    expect(result.dividerX).toBeNull();
    expect(result.dividerY).toBeCloseTo(10);
    expect(result.horizontalDividerYs.length).toBe(1);
  });

  it("tracks multiple vertical divider centers for nearest-divider selection", () => {
    const result = detectDividerIntent([
      { x: 100, y: 0, width: 6, height: 260 },
      { x: 400, y: 0, width: 8, height: 280 },
    ]);

    expect(result.dividerIntent).toBe(true);
    expect(result.splitColumnContext).toBe(true);
    expect(result.verticalDividerXs.length).toBe(2);
    expect(result.verticalDividerXs[0]).toBeCloseTo(103);
    expect(result.verticalDividerXs[1]).toBeCloseTo(404);
  });
});
