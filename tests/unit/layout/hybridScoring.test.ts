import { describe, expect, it } from "vitest";
import {
  chooseBestHybridCandidate,
  computeHybridFusionScore,
} from "../../../src/lib/layout/hybridScoring";

describe("hybrid scoring", () => {
  it("computes deterministic fusion score", () => {
    const score = computeHybridFusionScore({
      candidate_id: "a",
      side: "below",
      clearance_ok: true,
      overlap_count: 0,
      aspect_ratio_delta: 0.1,
      continuity_score: 0.8,
      score_breakdown: {
        side_bias: 0.9,
        aspect_match: 0.7,
        clearance: 1,
        reading_continuity: 0.8,
      },
    });
    expect(score).toBe(3.4);
  });

  it("prefers clearance-safe candidate when scores are close", () => {
    const best = chooseBestHybridCandidate([
      {
        candidate_id: "unsafe",
        side: "below",
        clearance_ok: false,
        overlap_count: 1,
        aspect_ratio_delta: 0.1,
        continuity_score: 0.8,
        score_breakdown: {
          side_bias: 0.8,
          aspect_match: 0.8,
          clearance: 0.2,
          reading_continuity: 0.7,
        },
      },
      {
        candidate_id: "safe",
        side: "right",
        clearance_ok: true,
        overlap_count: 0,
        aspect_ratio_delta: 0.2,
        continuity_score: 0.8,
        score_breakdown: {
          side_bias: 0.7,
          aspect_match: 0.8,
          clearance: 1,
          reading_continuity: 0.7,
        },
      },
    ]);

    expect(best?.candidate_id).toBe("safe");
  });
});
