import type { BoundingBox } from "../../types/spatial";
import type { CanvasActionFromZod } from "./canvasActionSchema";

/** Matches applyCanvasActions default text `props.w`. */
export const DEFAULT_CREATE_TEXT_WRAP_WIDTH = 480;

/** Rough bounds for tldraw `text` shape (draw / m) before layout. */
export function estimateCreateTextBounds(
  x: number,
  y: number,
  text: string,
  wrapWidth: number = DEFAULT_CREATE_TEXT_WRAP_WIDTH,
): BoundingBox {
  const lines = text.split(/\r?\n/);
  const maxLineLen = Math.max(1, ...lines.map((l) => l.length));
  const charW = 7;
  const lineH = 28;
  const width = Math.min(
    wrapWidth,
    Math.max(64, maxLineLen * charW + 16),
  );
  const height = Math.max(lineH, lines.length * lineH + 8);
  return { x, y, width, height };
}

/** Unified pre-create bbox for any shape-emitting canvas action. */
export function estimateActionBounds(
  action: CanvasActionFromZod,
  wrapWidth: number = DEFAULT_CREATE_TEXT_WRAP_WIDTH,
): BoundingBox | null {
  switch (action._type) {
    case "create_text":
      return estimateCreateTextBounds(action.x, action.y, action.text, wrapWidth);
    case "create_geo":
      return { x: action.x, y: action.y, width: action.w, height: action.h };
    case "create_arrow": {
      const minX = Math.min(action.x1, action.x2);
      const minY = Math.min(action.y1, action.y2);
      const maxX = Math.max(action.x1, action.x2);
      const maxY = Math.max(action.y1, action.y2);
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    case "create_draw": {
      const xs = action.points.map((p) => p.x);
      const ys = action.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    default:
      return null;
  }
}

export function unionBoundingBoxes(boxes: BoundingBox[]): BoundingBox | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
