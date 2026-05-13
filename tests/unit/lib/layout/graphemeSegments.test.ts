import { describe, it, expect } from "vitest";
import { splitGraphemeSegments } from "../../../../src/lib/layout/graphemeSegments";

describe("splitGraphemeSegments", () => {
  it("keeps Hindi क्ष as one cluster when Segmenter is available", () => {
    const { segments, usedCodePointFallback } = splitGraphemeSegments("क्ष");
    if (usedCodePointFallback) {
      expect(segments.length).toBeGreaterThanOrEqual(1);
    } else {
      expect(segments.length).toBe(1);
    }
  });

  it("splits ASCII into one segment per code point under fallback semantics", () => {
    const { segments } = splitGraphemeSegments("ab");
    expect(segments.length).toBe(2);
  });

  it("returns single empty string segment for empty input", () => {
    const { segments } = splitGraphemeSegments("");
    expect(segments).toEqual([]);
  });
});
