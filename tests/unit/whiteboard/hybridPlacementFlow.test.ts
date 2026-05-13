import { describe, expect, it } from "vitest";
import { detectDividerIntent } from "../../../src/lib/layout/dividerIntent";
import { planColumnContinuation } from "../../../src/lib/layout/continuationPlanner";

describe("hybrid placement flow primitives", () => {
  it("derives split-column continuation from divider signals", () => {
    const divider = detectDividerIntent([{ x: 100, y: 0, width: 6, height: 220 }]);
    const continuation = planColumnContinuation({
      overflowDetected: true,
      currentColumnIndex: 0,
      availableColumnCount: divider.splitColumnContext ? 2 : 1,
      scriptDirection: "LTR",
    });

    expect(divider.splitColumnContext).toBe(true);
    expect(continuation.continuationMode).toBe("next_column_top");
  });
});
