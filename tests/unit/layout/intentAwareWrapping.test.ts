import { describe, expect, it } from "vitest";
import { planIntentAwareWrapping } from "../../../src/lib/layout/intentAwarePlanner";

describe("planIntentAwareWrapping", () => {
  it("returns tight wrapping for comparison/columnar contexts", () => {
    const plan = planIntentAwareWrapping({
      layoutStyle: "COLUMNAR",
      intentHint: "comparison",
    });
    expect(plan.density).toBe("tight");
    expect(plan.maxChars).toBeGreaterThan(500);
  });

  it("returns spacious wrapping for brainstorm contexts", () => {
    const plan = planIntentAwareWrapping({
      layoutStyle: "MIND_MAP",
      intentHint: "brainstorm",
    });
    expect(plan.density).toBe("spacious");
    expect(plan.maxLines).toBeLessThan(10);
  });
});
