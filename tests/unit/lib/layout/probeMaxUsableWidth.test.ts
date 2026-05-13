import { describe, it, expect } from "vitest";
import { probeMaxUsableWidth } from "../../../../src/lib/layout/probeMaxUsableWidth";
import type { BoundingBox } from "../../../../src/types/spatial";

describe("probeMaxUsableWidth", () => {
  it("returns four sides in canonical order", () => {
    const forbidden: BoundingBox = { x: 100, y: 100, width: 50, height: 40 };
    const viewport: BoundingBox = { x: 0, y: 0, width: 800, height: 600 };
    const rows = probeMaxUsableWidth({
      forbidden,
      viewport,
      gap: 8,
      obstacles: [],
      text: "hello world",
      inheritWidthCap: null,
    });
    expect(rows.map((r) => r.side)).toEqual([
      "below",
      "right",
      "left",
      "above",
    ]);
    for (const r of rows) {
      expect(r.wMax).toBeGreaterThan(0);
      expect(r.hRequired).toBeGreaterThan(0);
    }
  });

  it("caps width by inheritWidthCap", () => {
    const forbidden: BoundingBox = { x: 10, y: 10, width: 20, height: 20 };
    const viewport: BoundingBox = { x: 0, y: 0, width: 2000, height: 2000 };
    const uncapped = probeMaxUsableWidth({
      forbidden,
      viewport,
      gap: 4,
      obstacles: [],
      text: "hi",
      inheritWidthCap: null,
    })[0]!;
    const capped = probeMaxUsableWidth({
      forbidden,
      viewport,
      gap: 4,
      obstacles: [],
      text: "hi",
      inheritWidthCap: 80,
    })[0]!;
    expect(capped.wMax).toBeLessThanOrEqual(80);
    expect(uncapped.wMax).toBeGreaterThanOrEqual(capped.wMax);
  });
});
