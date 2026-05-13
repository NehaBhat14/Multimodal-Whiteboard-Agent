import type { TextLayoutPlan, PlanTextLayoutInput } from "./types";

/**
 * Deterministic text layout within a placement rectangle.
 */
export function planTextLayout(input: PlanTextLayoutInput): TextLayoutPlan {
  const placement = input.placement;
  const maxLinesCap = input.maxLines ?? 10;
  const maxCharsCap = input.maxChars ?? 500;

  const textInput = input.text ?? "";

  // Deterministic “metrical policy” for the MVP:
  // - each character consumes 1 width unit
  // - each line consumes 1 height unit
  const lineHeightUnits = 1;
  const safeHeight = Math.max(0, placement.height);
  const safeWidth = Math.max(0, placement.width);

  const charsPerLine = Math.max(1, Math.floor(safeWidth));
  const maxLinesFromHeight = Math.max(1, Math.floor(safeHeight / lineHeightUnits));
  const allowedMaxLines = Math.max(
    1,
    Math.min(Math.max(1, maxLinesCap), maxLinesFromHeight),
  );

  const truncatedByChars = textInput.length > maxCharsCap;
  const cappedText = truncatedByChars
    ? textInput.slice(0, Math.max(0, maxCharsCap))
    : textInput;

  const wrapLines = (s: string): string[] => {
    if (s.length === 0) return [""];
    const lines: string[] = [];
    for (let i = 0; i < s.length; i += charsPerLine) {
      lines.push(s.slice(i, i + charsPerLine));
    }
    return lines.length > 0 ? lines : [""];
  };

  const allLines = wrapLines(cappedText);

  const truncatedByHeight = allLines.length > allowedMaxLines;
  const finalLines = truncatedByHeight ? allLines.slice(0, allowedMaxLines) : allLines;

  const text = finalLines.join("\n");

  return {
    version: 1,
    placement,
    text,
    lineCount: finalLines.length,
    truncated: truncatedByChars || truncatedByHeight,
    textShapeProps: {
      text,
      // Keep rendering wrap width aligned with the placement width.
      w: safeWidth,
      autoSize: false,
      font: "draw",
      size: "m",
      textAlign: "start",
      color: "black",
      scale: 1,
    },
  };
}

