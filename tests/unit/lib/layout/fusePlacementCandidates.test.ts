import { describe, it, expect } from "vitest";
import { fusePlacementCandidates } from "../../../../src/lib/layout/fusePlacementCandidates";

describe("fusePlacementCandidates", () => {
  it("boosts below when columnar layout style", () => {
    const base = ["right", "below", "left", "above"] as const;
    const { orderedSides } = fusePlacementCandidates({
      candidates: [...base],
      layoutStyle: "COLUMNAR",
      geometryFeatures: {
        columnScore: 0.2,
        verticalStackScore: 0.2,
        layoutHint: "NEUTRAL",
      },
      inheritedWidth: null,
      wMaxBySide: {},
    });
    expect(orderedSides[0]).toBe("below");
  });

  it("preserves stable tie-break toward earlier base order", () => {
    const { orderedSides } = fusePlacementCandidates({
      candidates: ["below", "right", "left", "above"],
      layoutStyle: "UNKNOWN",
      geometryFeatures: {
        columnScore: 0,
        verticalStackScore: 0,
        layoutHint: "NEUTRAL",
      },
      inheritedWidth: null,
      wMaxBySide: {},
    });
    expect(orderedSides).toEqual(["below", "right", "left", "above"]);
  });
});
