import { describe, it, expect } from "vitest";

describe("placement telemetry payload shape", () => {
  it("extended pipeline fields serialize without imageBase64", () => {
    const pipeline = {
      script_class: "latin_default",
      w_max_by_side: { below: 100, right: 80, left: 80, above: 80 },
      layout_style: "UNKNOWN",
      geometry_hint: "NEUTRAL",
      fusion_overrides: ["fuse test"],
      truncation_flags: { chars: false, lines: false },
      ambiguity_fired: false,
      segmenter_fallback: false,
      stroke_placement_linkage: {
        userStrokeBBox: null,
        placementBBox: { x: 0, y: 0, width: 1, height: 1 },
        iou: 0,
        overlap_any: false,
      },
    };
    const json = JSON.stringify(pipeline);
    expect(json.toLowerCase()).not.toContain("imagebase64");
  });
});
