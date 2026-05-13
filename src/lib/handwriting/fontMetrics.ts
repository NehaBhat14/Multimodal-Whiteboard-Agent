import type { Font } from "opentype.js";

/** Viewport-derived caps for adaptive placement (floor / ceiling, canvas units). */
export const MIN_ADAPTIVE_WIDTH = 320;
export const MAX_ADAPTIVE_WIDTH = 1200;
export const MIN_ADAPTIVE_HEIGHT = 120;
export const MAX_ADAPTIVE_HEIGHT = 600;
export const MIN_FONT_SIZE = 20;
export const DEFAULT_FONT_SIZE = 26;

/** Must match handwriting rendering in `textToGlyphStrokes` (between-glyph gap). */
export const HANDWRITING_LETTER_SPACING_FRACTION = 0.18;

const WIDTH_FRACTION = 0.6;
const HEIGHT_FRACTION = 0.5;

/** Extra breathing room above the tight (ascent + descent) metric box. */
const LINE_HEIGHT_AIR = 1.08;

export interface AdaptiveViewportCaps {
  maxWidth: number;
  maxHeight: number;
}

export function adaptiveViewportCaps(viewport: {
  width: number;
  height: number;
}): AdaptiveViewportCaps {
  const w = Math.max(
    MIN_ADAPTIVE_WIDTH,
    Math.min(MAX_ADAPTIVE_WIDTH, viewport.width * WIDTH_FRACTION),
  );
  const h = Math.max(
    MIN_ADAPTIVE_HEIGHT,
    Math.min(MAX_ADAPTIVE_HEIGHT, viewport.height * HEIGHT_FRACTION),
  );
  return { maxWidth: w, maxHeight: h };
}

export interface FontVerticalMetrics {
  ascent: number;
  /** Positive value (absolute, opentype's descender is negative). */
  descent: number;
  lineHeight: number;
  /** 0 when the OS/2 table is absent. */
  xHeight: number;
  /** 0 when the OS/2 table is absent. */
  capHeight: number;
}

export function getFontVerticalMetrics(
  font: Font,
  fontSize: number,
): FontVerticalMetrics {
  const scale = fontSize / font.unitsPerEm;
  const ascent = font.ascender * scale;
  const descent = Math.abs(font.descender * scale);
  const os2 = font.tables?.os2 as
    | { sxHeight?: number; sCapHeight?: number }
    | undefined;
  const xHeight = os2?.sxHeight ? os2.sxHeight * scale : 0;
  const capHeight = os2?.sCapHeight ? os2.sCapHeight * scale : 0;
  const lineHeight = (ascent + descent) * LINE_HEIGHT_AIR;
  return { ascent, descent, lineHeight, xHeight, capHeight };
}

export function measureLineAdvance(
  font: Font,
  fontSize: number,
  text: string,
): number {
  if (text.length === 0) return 0;
  return font.getAdvanceWidth(text, fontSize);
}

/** Width of `text` as laid out: advances plus per-gap letter spacing (matches `planHandwriting`). */
export function measureLineWidthWithLetterSpacing(
  font: Font,
  fontSize: number,
  text: string,
  letterSpacing: number,
): number {
  if (text.length === 0) return 0;
  return (
    font.getAdvanceWidth(text, fontSize) +
    letterSpacing * Math.max(0, text.length - 1)
  );
}

/**
 * Greedy word-wrap. Preserves explicit `\n`. An over-long single word goes
 * on its own line rather than being dropped.
 */
export function wrapByAdvance(
  font: Font,
  fontSize: number,
  text: string,
  maxAdvance: number,
  /** When > 0, must match the value used when drawing glyphs (between-character spacing). */
  letterSpacing = 0,
): string[] {
  if (maxAdvance <= 0 || text.length === 0) return text.length === 0 ? [] : [text];

  const measure = (s: string): number =>
    measureLineWidthWithLetterSpacing(font, fontSize, s, letterSpacing);

  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }

    const words = paragraph.split(/(\s+)/);
    let current = "";

    for (const word of words) {
      const candidate = current + word;
      if (measure(candidate) <= maxAdvance) {
        current = candidate;
        continue;
      }
      if (current.length > 0) {
        lines.push(current.trimEnd());
        current = word.replace(/^\s+/, "");
      } else {
        lines.push(word);
        current = "";
      }
    }

    if (current.length > 0) lines.push(current.trimEnd());
  }
  return lines.length > 0 ? lines : [""];
}

export interface AdaptivePreferredSizeInput {
  font: Font;
  text: string;
  fontSize?: number;
  maxWidth: number;
  /** Unused for line clipping; preferred height follows full wrapped content. */
  maxHeight: number;
  /** Override the font-metric-derived line height. */
  lineHeight?: number;
}

export interface AdaptivePreferredSizeResult {
  preferredSize: { width: number; height: number };
  wrappedLines: string[];
  lineHeight: number;
  fontSize: number;
  truncated: boolean;
}

/**
 * Minimally-enclosing placement rect for `text` in `font` at `fontSize`.
 * Wrapping uses the same width rule as `planHandwriting` (advances + letter spacing).
 * All wrapped lines are kept (`truncated` is always false); height grows with line count.
 * `maxHeight` is kept on the input for callers but does not clip lines.
 */
export function computeAdaptivePreferredSize(
  input: AdaptivePreferredSizeInput,
): AdaptivePreferredSizeResult {
  const fontSize = Math.max(MIN_FONT_SIZE, input.fontSize ?? DEFAULT_FONT_SIZE);
  const metrics = getFontVerticalMetrics(input.font, fontSize);
  const lineHeight = input.lineHeight ?? metrics.lineHeight;

  const maxWidth = Math.max(MIN_ADAPTIVE_WIDTH, input.maxWidth);
  const letterSpacing = fontSize * HANDWRITING_LETTER_SPACING_FRACTION;

  const wrappedLines = wrapByAdvance(
    input.font,
    fontSize,
    input.text,
    maxWidth,
    letterSpacing,
  );

  let widest = 0;
  for (const line of wrappedLines) {
    const w = measureLineWidthWithLetterSpacing(
      input.font,
      fontSize,
      line,
      letterSpacing,
    );
    if (w > widest) widest = w;
  }

  const width = Math.max(
    MIN_ADAPTIVE_WIDTH,
    Math.min(maxWidth, Math.ceil(widest)),
  );
  const height = Math.max(
    MIN_ADAPTIVE_HEIGHT,
    Math.ceil(wrappedLines.length * lineHeight),
  );

  return {
    preferredSize: { width, height },
    wrappedLines,
    lineHeight,
    fontSize,
    truncated: false,
  };
}
