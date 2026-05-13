import { describe, expect, it } from "vitest";
import { planIntentAwareWrapping } from "../../../src/lib/layout/intentAwarePlanner";
import { interpretSemanticLabels } from "../../../src/lib/layout/semanticLabelInterpreter";

describe("intent-aware generation flow", () => {
  it("maps semantic hints into columnar wrapping plan", () => {
    const semantic = interpretSemanticLabels({
      my_response: "hello",
      what_i_see: "two columns",
      spatial: { x: 0, y: 0, width: 10, height: 10 },
      status: "COMPLETED",
      started_at: "a",
      finished_at: "b",
      timings: { provider: "mock", inference_ms: 0, parse_ms: 0, total_ms: 0 },
      layoutStyle: "COLUMNAR",
      intent_hint: "comparison",
    });
    const plan = planIntentAwareWrapping({
      layoutStyle: semantic.layoutStyle,
      intentHint: semantic.intentHint,
    });

    expect(plan.density).toBe("tight");
    expect(plan.maxLines).toBeGreaterThan(10);
  });
});
