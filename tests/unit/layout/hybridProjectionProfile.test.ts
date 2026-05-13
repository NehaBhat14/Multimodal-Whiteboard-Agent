import { describe, expect, it } from "vitest";
import { buildProjectionProfile } from "../../../src/lib/layout/projectionProfiling";

describe("buildProjectionProfile", () => {
  it("computes width profile and projections from rectangles", () => {
    const profile = buildProjectionProfile([
      { x: 0, y: 0, width: 100, height: 40 },
      { x: 120, y: 10, width: 80, height: 35 },
    ]);

    expect(profile.sampleCount).toBe(2);
    expect(profile.wAvg).toBe(90);
    expect(profile.minWidth).toBe(80);
    expect(profile.maxWidth).toBe(100);
    expect(profile.xProjection.length).toBeGreaterThan(0);
    expect(profile.yProjection.length).toBeGreaterThan(0);
  });

  it("returns empty profile for empty input", () => {
    const profile = buildProjectionProfile([]);
    expect(profile.sampleCount).toBe(0);
    expect(profile.wAvg).toBe(0);
    expect(profile.xProjection).toEqual([]);
    expect(profile.yProjection).toEqual([]);
  });
});
