import { describe, expect, it } from "vitest";
import { planColumnContinuation } from "../../../src/lib/layout/continuationPlanner";

describe("planColumnContinuation", () => {
  it("continues to next column for LTR overflow", () => {
    const decision = planColumnContinuation({
      overflowDetected: true,
      currentColumnIndex: 0,
      availableColumnCount: 2,
      scriptDirection: "LTR",
    });
    expect(decision.continuationMode).toBe("next_column_top");
    expect(decision.toColumnIndex).toBe(1);
  });

  it("continues to previous column for RTL overflow", () => {
    const decision = planColumnContinuation({
      overflowDetected: true,
      currentColumnIndex: 1,
      availableColumnCount: 2,
      scriptDirection: "RTL",
    });
    expect(decision.continuationMode).toBe("next_column_top");
    expect(decision.toColumnIndex).toBe(0);
  });

  it("truncates when no additional column exists", () => {
    const decision = planColumnContinuation({
      overflowDetected: true,
      currentColumnIndex: 0,
      availableColumnCount: 1,
      scriptDirection: "LTR",
    });
    expect(decision.continuationMode).toBe("truncated");
    expect(decision.toColumnIndex).toBeNull();
  });
});
