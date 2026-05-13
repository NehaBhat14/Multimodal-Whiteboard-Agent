export type GraphemeSplit = {
  segments: string[];
  /** True when `Intl.Segmenter` was unavailable and code-point iteration was used. */
  usedCodePointFallback: boolean;
};

/**
 * Split `text` into user-perceived grapheme clusters when supported.
 */
export function splitGraphemeSegments(text: string): GraphemeSplit {
  try {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      const segments = Array.from(seg.segment(text), (s) => s.segment);
      return { segments, usedCodePointFallback: false };
    }
  } catch {
    // Engine claims Segmenter but throws (rare) — fall through.
  }
  return { segments: Array.from(text), usedCodePointFallback: true };
}
