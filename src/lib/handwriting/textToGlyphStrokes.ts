import type { Font, PathCommand } from "opentype.js";
import {
  HANDWRITING_LETTER_SPACING_FRACTION,
  wrapByAdvance,
} from "./fontMetrics";
import type {
  GlyphSubpath,
  HandwritingPlan,
  HandwritingPoint,
  LaidOutGlyph,
} from "./types";

/** More samples = smoother curves but slower animation. */
const BEZIER_SAMPLES = 4;
const DEFAULT_FONT_SIZE_FRACTION = 0.3;
const DEFAULT_LINE_HEIGHT_FACTOR = 1.6;

export interface PlanHandwritingInput {
  text: string;
  font: Font;
  placement: { x: number; y: number; width: number; height: number };
  fontSize?: number;
  lineHeightFactor?: number;
  /** Explicit line height (canvas units). Wins over `lineHeightFactor × fontSize`. */
  lineHeight?: number;
  /** Skip internal wrapping — use these lines from the adaptive pass as-is. */
  preWrappedLines?: readonly string[];
  /** Extra units between glyphs. Defaults to ``fontSize × 0.18``. */
  letterSpacing?: number;
}

function sampleQuadratic(
  p0: HandwritingPoint,
  c: HandwritingPoint,
  p1: HandwritingPoint,
  steps: number,
): HandwritingPoint[] {
  const out: HandwritingPoint[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
    });
  }
  return out;
}

function sampleCubic(
  p0: HandwritingPoint,
  c1: HandwritingPoint,
  c2: HandwritingPoint,
  p1: HandwritingPoint,
  steps: number,
): HandwritingPoint[] {
  const out: HandwritingPoint[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    out.push({
      x: uu * u * p0.x + 3 * uu * t * c1.x + 3 * u * tt * c2.x + tt * t * p1.x,
      y: uu * u * p0.y + 3 * uu * t * c1.y + 3 * u * tt * c2.y + tt * t * p1.y,
    });
  }
  return out;
}

/** Convert opentype.js path commands to connected subpaths with sampled bezier points. */
export function pathCommandsToSubpaths(
  commands: readonly PathCommand[],
): GlyphSubpath[] {
  const subpaths: GlyphSubpath[] = [];
  let current: HandwritingPoint[] = [];
  let cursor: HandwritingPoint = { x: 0, y: 0 };
  let subpathStart: HandwritingPoint = { x: 0, y: 0 };

  const flush = (closed: boolean): void => {
    if (current.length >= 2) {
      subpaths.push({ points: current, closed });
    }
    current = [];
  };

  for (const cmd of commands) {
    switch (cmd.type) {
      case "M": {
        flush(false);
        cursor = { x: cmd.x, y: cmd.y };
        subpathStart = cursor;
        current.push(cursor);
        break;
      }
      case "L": {
        const next = { x: cmd.x, y: cmd.y };
        current.push(next);
        cursor = next;
        break;
      }
      case "Q": {
        const c = { x: cmd.x1, y: cmd.y1 };
        const next = { x: cmd.x, y: cmd.y };
        current.push(...sampleQuadratic(cursor, c, next, BEZIER_SAMPLES));
        cursor = next;
        break;
      }
      case "C": {
        const c1 = { x: cmd.x1, y: cmd.y1 };
        const c2 = { x: cmd.x2, y: cmd.y2 };
        const next = { x: cmd.x, y: cmd.y };
        current.push(...sampleCubic(cursor, c1, c2, next, BEZIER_SAMPLES));
        cursor = next;
        break;
      }
      case "Z": {
        current.push(subpathStart);
        cursor = subpathStart;
        flush(true);
        break;
      }
      default:
        break;
    }
  }
  flush(false);
  return subpaths;
}

/** Lay out `text` as glyph subpaths inside `placement` using real font metrics. */
export function planHandwriting(input: PlanHandwritingInput): HandwritingPlan {
  const placement = input.placement;
  const fontSize =
    input.fontSize ??
    Math.max(8, placement.height * DEFAULT_FONT_SIZE_FRACTION);
  const lineHeightFactor = input.lineHeightFactor ?? DEFAULT_LINE_HEIGHT_FACTOR;
  const lineHeight = input.lineHeight ?? fontSize * lineHeightFactor;
  const letterSpacing =
    input.letterSpacing ?? fontSize * HANDWRITING_LETTER_SPACING_FRACTION;

  const fromAdaptive = input.preWrappedLines !== undefined;
  const lines = input.preWrappedLines
    ? [...input.preWrappedLines]
    : wrapByAdvance(
        input.font,
        fontSize,
        input.text,
        placement.width,
        letterSpacing,
      );

  const maxLines = Math.max(1, Math.floor(placement.height / lineHeight));
  const truncated = fromAdaptive ? false : lines.length > maxLines;
  const finalLines =
    truncated && !fromAdaptive ? lines.slice(0, maxLines) : lines;

  // First baseline sits one fontSize below the top so ascenders stay inside the rect.
  const glyphs: LaidOutGlyph[] = [];
  const baseline0 = placement.y + fontSize;

  for (let row = 0; row < finalLines.length; row++) {
    const line = finalLines[row];
    const baselineY = baseline0 + row * lineHeight;
    let penX = placement.x;

    for (const char of line) {
      const glyph = input.font.charToGlyph(char);
      const path = glyph.getPath(penX, baselineY, fontSize);
      const subpaths = pathCommandsToSubpaths(path.commands);

      if (subpaths.length > 0) {
        glyphs.push({
          char,
          origin: { x: penX, y: baselineY },
          subpaths,
        });
      }

      const advance =
        (glyph.advanceWidth ?? input.font.unitsPerEm) *
        (fontSize / input.font.unitsPerEm);
      penX += advance + letterSpacing;
    }
  }

  const textLength = finalLines.reduce((n, l) => n + l.length, 0);

  return {
    glyphs,
    fontSize,
    lineHeight,
    lineCount: finalLines.length,
    textLength,
    placement,
    truncated,
  };
}