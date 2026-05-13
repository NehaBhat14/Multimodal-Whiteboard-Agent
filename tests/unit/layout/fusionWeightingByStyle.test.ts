import { describe, expect, it } from "vitest";
import { fusePlacementCandidates } from "../../../src/lib/layout/fusePlacementCandidates";

describe("fusePlacementCandidates style weighting", () => {
  it("prioritizes below in columnar contexts", () => {
    const out = fusePlacementCandidates({
      candidates: ["right", "below", "left", "above"],
      layoutStyle: "COLUMNAR",
      geometryFeatures: {
        columnScore: 0.9,
        verticalStackScore: 0.3,
        layoutHint: "COLUMNAR",
      },
      inheritedWidth: null,
      wMaxBySide: {},
    });
    expect(out.orderedSides[0]).toBe("below");
  });
});
