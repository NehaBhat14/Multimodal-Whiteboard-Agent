import type { BoundingBox } from "../../types/spatial";
import type { ScriptClass } from "./placementContextTypes";
import { clampPlacementToViewport } from "./computeOutputPlacementRect";
import {
  LINE_HEIGHT_MULT_INDIC,
  LINE_HEIGHT_MULT_LATIN,
  TLDRAW_LIKE_FONT_PX,
} from "./layoutConstants";

/** Must match {@link DEFAULT_LINE_HEIGHT_FACTOR} in textToGlyphStrokes + WhiteboardLayout `planHandwriting`. */
const HANDWRITING_LINE_HEIGHT_FACTOR = 1.6;

/** Canvas units; must match `fontSize` passed to `planHandwriting` from the whiteboard. */
export const HANDWRITING_RENDER_FONT_PX = 26;

export const HANDWRITING_RENDER_LINE_HEIGHT_PX =
  HANDWRITING_RENDER_FONT_PX * HANDWRITING_LINE_HEIGHT_FACTOR;

/**
 * Line height used by `planTextLayout` inside `probeMaxUsableWidth` for the
 * same script class as the response text.
 */
export function probeLineHeightPxForScript(scriptClass: ScriptClass): number {
  const mult =
    scriptClass === "indic_devanagari"
      ? LINE_HEIGHT_MULT_INDIC
      : LINE_HEIGHT_MULT_LATIN;
  return TLDRAW_LIKE_FONT_PX * mult;
}

/**
 * `probeMaxUsableWidth` / `computeOutputPlacementRect` size the label box
 * using `planTextLayout` metrics (tldraw-like px). Handwriting uses real font
 * metrics with taller lines, so `planHandwriting`'s `maxLines` was too small
 * and wrapped text was truncated mid-response. Expand height to fit the same
 * inferred line count at handwriting line height, then clamp to the viewport.
 */
export function expandPlacementHeightForHandwriting(args: {
  rect: BoundingBox;
  viewport: BoundingBox;
  scriptClass: ScriptClass;
}): BoundingBox {
  const probeLh = probeLineHeightPxForScript(args.scriptClass);
  if (probeLh <= 0) {
    return clampPlacementToViewport(args.rect, args.viewport);
  }
  const lineCount = Math.max(
    1,
    Math.ceil(args.rect.height / probeLh - 1e-9),
  );
  const minHandwritingHeight = lineCount * HANDWRITING_RENDER_LINE_HEIGHT_PX;
  return clampPlacementToViewport(
    {
      ...args.rect,
      height: Math.max(args.rect.height, minHandwritingHeight),
    },
    args.viewport,
  );
}
