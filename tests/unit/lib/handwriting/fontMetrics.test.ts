import { describe, it, expect } from "vitest";
import type { Font } from "opentype.js";
import {
  adaptiveViewportCaps,
  computeAdaptivePreferredSize,
  getFontVerticalMetrics,
  MAX_ADAPTIVE_HEIGHT,
  MAX_ADAPTIVE_WIDTH,
  MIN_ADAPTIVE_HEIGHT,
  MIN_ADAPTIVE_WIDTH,
  wrapByAdvance,
} from "../../../../src/lib/handwriting/fontMetrics";

/**
 * Minimal Font stub with deterministic advance widths. Each non-whitespace
 * char is `advancePerChar` em-units; whitespace is half that. Vertical
 * metrics mirror a typical handwriting font (ascender ~1600, descender -500,
 * unitsPerEm 2000).
 */
function makeStubFont(args?: {
  advancePerChar?: number;
  withOs2?: boolean;
}): Font {
  const advancePerChar = args?.advancePerChar ?? 500;
  const unitsPerEm = 2000;

  return {
    unitsPerEm,
    ascender: 1600,
    descender: -500,
    tables: args?.withOs2
      ? { os2: { sxHeight: 900, sCapHeight: 1300 } }
      : {},
    getAdvanceWidth: (text: string, fontSize: number) => {
      const scale = fontSize / unitsPerEm;
      let w = 0;
      for (const c of text) {
        const isSpace = /\s/.test(c);
        w += (isSpace ? advancePerChar * 0.5 : advancePerChar) * scale;
      }
      return w;
    },
  } as unknown as Font;
}

describe("getFontVerticalMetrics", () => {
  it("scales em-unit metrics by fontSize / unitsPerEm", () => {
    const font = makeStubFont({ withOs2: true });
    const m = getFontVerticalMetrics(font, 100);
    // unitsPerEm 2000, fontSize 100 → scale = 0.05.
    // ascender 1600 × 0.05 = 80, |descender| 500 × 0.05 = 25.
    expect(m.ascent).toBeCloseTo(80, 5);
    expect(m.descent).toBeCloseTo(25, 5);
    // lineHeight = (80 + 25) × 1.08 = 113.4
    expect(m.lineHeight).toBeCloseTo(113.4, 5);
    expect(m.xHeight).toBeCloseTo(45, 5); // 900 × 0.05
    expect(m.capHeight).toBeCloseTo(65, 5); // 1300 × 0.05
  });

  it("returns zero for xHeight/capHeight when the OS/2 table is missing", () => {
    const font = makeStubFont({ withOs2: false });
    const m = getFontVerticalMetrics(font, 50);
    expect(m.xHeight).toBe(0);
    expect(m.capHeight).toBe(0);
    // ascent/descent/lineHeight should still be correct.
    expect(m.ascent).toBeGreaterThan(0);
    expect(m.descent).toBeGreaterThan(0);
    expect(m.lineHeight).toBeGreaterThan(0);
  });
});

describe("wrapByAdvance", () => {
  it("returns the empty list for empty input", () => {
    const font = makeStubFont();
    expect(wrapByAdvance(font, 50, "", 1000)).toEqual([]);
  });

  it("keeps everything on one line when it fits", () => {
    const font = makeStubFont();
    expect(wrapByAdvance(font, 50, "hello world", 10_000)).toEqual([
      "hello world",
    ]);
  });

  it("wraps on word boundaries when the line exceeds maxAdvance", () => {
    // At fontSize=100, advancePerChar=500 → 25 px/char; space → 12.5 px.
    // "hello world" = 5*25 + 12.5 + 5*25 = 262.5. maxAdvance 200 → must wrap.
    const font = makeStubFont();
    const lines = wrapByAdvance(font, 100, "hello world", 200);
    expect(lines).toEqual(["hello", "world"]);
  });

  it("respects explicit newlines in the input", () => {
    const font = makeStubFont();
    const lines = wrapByAdvance(font, 100, "first\nsecond", 1_000);
    expect(lines).toEqual(["first", "second"]);
  });

  it("places an over-long single word on its own line rather than dropping it", () => {
    // Force a word longer than maxAdvance.
    const font = makeStubFont();
    const lines = wrapByAdvance(font, 100, "pneumonoultramicroscopicsilicovolcanoconiosis", 200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("pneumo");
  });

  it("wraps earlier when letterSpacing widens each line (matches handwriting layout)", () => {
    const font = makeStubFont();
    // Without extra spacing, "hello world" fits in 262.5px width (see test above).
    const noExtra = wrapByAdvance(font, 100, "hello world", 262.5, 0);
    expect(noExtra).toEqual(["hello world"]);
    const withSpacing = wrapByAdvance(font, 100, "hello world", 262.5, 12);
    expect(withSpacing).toEqual(["hello", "world"]);
  });
});

describe("computeAdaptivePreferredSize", () => {
  it("returns a small rect for short text", () => {
    const font = makeStubFont();
    const result = computeAdaptivePreferredSize({
      font,
      text: "Hi",
      fontSize: 100,
      maxWidth: 1000,
      maxHeight: 500,
    });
    // "Hi" = 2 × 25 = 50 px. width should be MIN_ADAPTIVE_WIDTH floor.
    expect(result.preferredSize.width).toBe(MIN_ADAPTIVE_WIDTH);
    expect(result.wrappedLines).toEqual(["Hi"]);
    expect(result.truncated).toBe(false);
  });

  it("grows width up to maxWidth before wrapping", () => {
    const font = makeStubFont();
    // 30 chars × 25 px = 750 px. Fits in 800 maxWidth → one line.
    const text = "abcdefghijklmnopqrstuvwxyz1234";
    const result = computeAdaptivePreferredSize({
      font,
      text,
      fontSize: 100,
      maxWidth: 800,
      maxHeight: 500,
    });
    expect(result.wrappedLines).toEqual([text]);
    expect(result.preferredSize.width).toBeLessThanOrEqual(800);
    // Width should reflect the measured advance (~750), not a hardcoded value.
    expect(result.preferredSize.width).toBeGreaterThanOrEqual(700);
  });

  it("keeps all wrapped lines regardless of maxHeight (height grows with content)", () => {
    const font = makeStubFont();
    // lineHeight at fontSize 100 = (80+25)*1.08 ≈ 113.4. Many short words at maxWidth 200 → several lines.
    const result = computeAdaptivePreferredSize({
      font,
      text: "one two three four five six seven eight nine ten",
      fontSize: 100,
      maxWidth: 200,
      maxHeight: 150,
    });
    expect(result.truncated).toBe(false);
    expect(result.wrappedLines.length).toBeGreaterThan(1);
    expect(result.preferredSize.height).toBeGreaterThan(150);
  });

  it("uses an explicit lineHeight override when provided", () => {
    const font = makeStubFont();
    const result = computeAdaptivePreferredSize({
      font,
      text: "line one\nline two",
      fontSize: 100,
      maxWidth: 1000,
      maxHeight: 500,
      lineHeight: 40,
    });
    expect(result.lineHeight).toBe(40);
    // Two lines × 40 = 80 px. Height floored to MIN_ADAPTIVE_HEIGHT.
    expect(result.preferredSize.height).toBe(MIN_ADAPTIVE_HEIGHT);
  });
});

describe("adaptiveViewportCaps", () => {
  it("takes 60% width / 50% height of a large viewport", () => {
    const caps = adaptiveViewportCaps({ width: 1600, height: 900 });
    expect(caps.maxWidth).toBeCloseTo(960, 5); // clamped by MAX at 1200, 960 < 1200
    expect(caps.maxHeight).toBeCloseTo(450, 5); // 900 × 0.5
  });

  it("clamps to the absolute maximums for huge viewports", () => {
    const caps = adaptiveViewportCaps({ width: 4000, height: 2000 });
    expect(caps.maxWidth).toBe(MAX_ADAPTIVE_WIDTH);
    expect(caps.maxHeight).toBe(MAX_ADAPTIVE_HEIGHT);
  });

  it("clamps to the absolute minimums for tiny viewports", () => {
    const caps = adaptiveViewportCaps({ width: 200, height: 150 });
    expect(caps.maxWidth).toBe(MIN_ADAPTIVE_WIDTH);
    expect(caps.maxHeight).toBe(MIN_ADAPTIVE_HEIGHT);
  });
});
