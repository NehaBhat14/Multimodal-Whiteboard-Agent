import type { Editor } from "tldraw";
import type { CanvasViewBounds } from "../../types/vlm";
import type { SpatialPayload } from "../../types/spatial";

/** AABB in screen (component) space from a page axis-aligned box. */
export function pageBoxToScreenAabb(
  editor: Editor,
  page: { x: number; y: number; width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const c1 = editor.pageToScreen({ x: page.x, y: page.y });
  const c2 = editor.pageToScreen({ x: page.x + page.width, y: page.y });
  const c3 = editor.pageToScreen({ x: page.x, y: page.y + page.height });
  const c4 = editor.pageToScreen({
    x: page.x + page.width,
    y: page.y + page.height,
  });
  const xs = [c1.x, c2.x, c3.x, c4.x];
  const ys = [c1.y, c2.y, c3.y, c4.y];
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { left, top, width: right - left, height: bottom - top };
}

export function pageBoundsToScreen(
  editor: Editor,
  b: CanvasViewBounds | SpatialPayload,
): { left: number; top: number; width: number; height: number } {
  return pageBoxToScreenAabb(editor, {
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
  });
}
