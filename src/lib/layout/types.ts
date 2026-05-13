import type { SpatialPayload } from "../../types/spatial";

export type TldrawTextFont = "draw" | "mono" | "sans" | "serif";
export type TldrawTextSize = "s" | "m" | "l" | "xl";
export type TldrawTextAlign = "start" | "middle" | "end";

export type TextLayoutPlacement = SpatialPayload;

export interface TextLayoutTextShapeProps {
  text: string;
  /** Wrap width in page units, mapped 1:1 to tldraw `props.w`. */
  w: number;
  autoSize: false;
  font: TldrawTextFont;
  size: TldrawTextSize;
  textAlign: TldrawTextAlign;
  color: string;
  scale: number;
}

export interface TextLayoutPlan {
  version: 1;
  placement: TextLayoutPlacement;
  /** Multiline text joined with `\n` between lines. */
  text: string;
  /** Number of logical lines in `text`. */
  lineCount: number;
  /** Whether input was truncated due to char/width/height constraints. */
  truncated: boolean;
  textShapeProps: TextLayoutTextShapeProps;
}

export interface PlanTextLayoutInput {
  placement: TextLayoutPlacement;
  text: string;
  /**
   * Absolute caps for determinism. If not provided, defaults follow
   * the feature spec assumptions (10 lines / 500 chars).
   */
  maxLines?: number;
  maxChars?: number;
}

