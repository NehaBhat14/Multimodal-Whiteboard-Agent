import { describe, it, expect } from "vitest";
import { shouldInvokeLayoutIntent } from "../../../../src/lib/layout/ambiguityGate";
import type { PerSideFeasibility } from "../../../../src/lib/layout/placementContextTypes";

function row(
  side: PerSideFeasibility["side"],
  w: number,
  strict: boolean,
  relaxed: boolean,
): PerSideFeasibility {
  return {
    side,
    wMax: w,
    hRequired: 20,
    strictFeasible: strict,
    relaxedFeasible: relaxed,
  };
}

describe("shouldInvokeLayoutIntent", () => {
  it("fires when two strict sides tie on wMax", () => {
    expect(
      shouldInvokeLayoutIntent([
        row("below", 100, true, true),
        row("right", 100, true, true),
        row("left", 40, false, true),
        row("above", 40, false, false),
      ]),
    ).toBe(true);
  });

  it("does not fire when a single strict winner dominates wMax", () => {
    expect(
      shouldInvokeLayoutIntent([
        row("below", 200, true, true),
        row("right", 80, true, true),
        row("left", 40, false, true),
        row("above", 40, false, false),
      ]),
    ).toBe(false);
  });

  it("fires when no strict but relaxed exists", () => {
    expect(
      shouldInvokeLayoutIntent([
        row("below", 10, false, true),
        row("right", 10, false, true),
        row("left", 10, false, false),
        row("above", 10, false, false),
      ]),
    ).toBe(true);
  });
});
