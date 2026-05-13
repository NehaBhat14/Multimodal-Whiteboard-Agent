import type { Editor } from "tldraw";
import type { TextLayoutPlan } from "../layout/types";

/**
 * Boundary for tldraw editor mutation:
 * converts a pure `TextLayoutPlan` into a native editable `text` shape.
 */
export function renderLayoutTextShape(
  editor: Editor,
  plan: TextLayoutPlan,
): void {
  editor.createShape({
    type: "text",
    x: plan.placement.x,
    y: plan.placement.y,
    props: {
      text: plan.textShapeProps.text,
      w: plan.textShapeProps.w,
      autoSize: false,
      font: plan.textShapeProps.font,
      size: plan.textShapeProps.size,
      textAlign: plan.textShapeProps.textAlign,
      color: plan.textShapeProps.color,
      scale: plan.textShapeProps.scale,
    },
  });
}

