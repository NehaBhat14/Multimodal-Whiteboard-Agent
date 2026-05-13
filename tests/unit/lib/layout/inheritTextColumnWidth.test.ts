import { describe, it, expect } from "vitest";
import { inheritTextColumnWidth } from "../../../../src/lib/layout/inheritTextColumnWidth";

describe("inheritTextColumnWidth", () => {
  it("returns null when no text-like shapes", () => {
    expect(inheritTextColumnWidth([])).toBeNull();
    expect(
      inheritTextColumnWidth([{ type: "geo", width: 100 }]),
    ).toBeNull();
  });

  it("returns median width for text shapes", () => {
    expect(
      inheritTextColumnWidth([
        { type: "text", width: 100 },
        { type: "text", width: 140 },
      ]),
    ).toBe(120);
  });

  it("clamps to [40, 1200]", () => {
    expect(inheritTextColumnWidth([{ type: "text", width: 10 }])).toBe(40);
    expect(inheritTextColumnWidth([{ type: "text", width: 9999 }])).toBe(1200);
  });
});
