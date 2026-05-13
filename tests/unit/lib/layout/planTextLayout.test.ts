import { describe, it, expect } from "vitest";
import { planTextLayout } from "../../../../src/lib/layout/planTextLayout";
import type { SpatialPayload } from "../../../../src/types/spatial";

describe("planTextLayout (deterministic)", () => {
  it("is deterministic for identical inputs", () => {
    const placement: SpatialPayload = { x: 10, y: 20, width: 12, height: 25 };
    const text = "hello";

    const r1 = planTextLayout({ placement, text });
    const r2 = planTextLayout({ placement, text });

    expect(r1).toEqual(r2);
  });

  it("wraps a long single token by width units (no spaces)", () => {
    const placement: SpatialPayload = { x: 0, y: 0, width: 3, height: 25 };
    const text = "abcdef";

    const result = planTextLayout({ placement, text });

    // Expected policy for the MVP: width=3 means 3 chars per line,
    // and long tokens are split deterministically into fixed-width chunks.
    expect(result.text).toBe("abc\ndef");
    expect(result.lineCount).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("truncates by height when wrapped lines exceed available rows", () => {
    const placement: SpatialPayload = { x: 0, y: 0, width: 3, height: 0.1 };
    const text = "abcdef"; // would wrap into 2 lines at width=3

    const result = planTextLayout({ placement, text });

    expect(result.lineCount).toBe(1);
    expect(result.text).toBe("abc");
    expect(result.truncated).toBe(true);
  });

  it("truncates by maxChars when width permits a single line", () => {
    const placement: SpatialPayload = { x: 0, y: 0, width: 100, height: 25 };
    const text = "abcdefghij";

    const result = planTextLayout({ placement, text, maxChars: 5, maxLines: 10 });

    expect(result.text).toBe("abcde");
    expect(result.lineCount).toBe(1);
    expect(result.truncated).toBe(true);
  });
});

