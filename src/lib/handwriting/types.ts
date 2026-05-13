export interface HandwritingPoint {
  x: number;
  y: number;
}

/** One connected sub-path of a glyph. "i" produces two (stem + dot); "o" produces one. */
export interface GlyphSubpath {
  points: HandwritingPoint[];
  /** True when the source command closed (Z) the subpath. */
  closed: boolean;
}

export interface LaidOutGlyph {
  char: string;
  /** Baseline origin in canvas coordinates. */
  origin: HandwritingPoint;
  subpaths: GlyphSubpath[];
}

export interface HandwritingPlan {
  glyphs: LaidOutGlyph[];
  fontSize: number;
  lineHeight: number;
  /** Number of rendered lines (post-truncation). */
  lineCount: number;
  /** Total character count across rendered lines. */
  textLength: number;
  placement: { x: number; y: number; width: number; height: number };
  truncated: boolean;
}
