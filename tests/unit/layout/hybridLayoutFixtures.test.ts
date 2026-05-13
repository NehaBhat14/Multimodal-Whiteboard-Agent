import { describe, expect, it } from "vitest";
import type { HybridLayoutAnalysis } from "../../../src/lib/layout/hybridTypes";

function createFixture(overrides: Partial<HybridLayoutAnalysis> = {}): HybridLayoutAnalysis {
  return {
    layout_style: "COLUMNAR",
    intent_hint: "comparison",
    script_direction: "LTR",
    detected_language: "en",
    detected_script: "Latin",
    language_confidence: 0.94,
    divider_intent: true,
    split_column_context: true,
    width_profile: {
      w_avg: 280,
      min_width: 240,
      max_width: 320,
      sample_count: 6,
    },
    ...overrides,
  };
}

describe("hybrid layout fixtures", () => {
  it("creates deterministic baseline fixture", () => {
    const fixture = createFixture();
    expect(fixture.layout_style).toBe("COLUMNAR");
    expect(fixture.split_column_context).toBe(true);
    expect(fixture.width_profile.sample_count).toBeGreaterThan(0);
  });

  it("accepts selective override values", () => {
    const fixture = createFixture({ script_direction: "RTL" });
    expect(fixture.script_direction).toBe("RTL");
    expect(fixture.layout_style).toBe("COLUMNAR");
  });
});
