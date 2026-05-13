import type { Editor, TLShapeId } from "tldraw";
import { createShapeId } from "@tldraw/tlschema";
import type { BoundingBox } from "../../types/spatial";
import { findClearRectNearPreferred } from "../layout/computeOutputPlacementRect";
import {
  canvasActionSchema,
  type CanvasActionFromZod,
} from "./canvasActionSchema";
import {
  DEFAULT_CREATE_TEXT_WRAP_WIDTH,
  estimateActionBounds,
  estimateCreateTextBounds,
  unionBoundingBoxes,
} from "./estimateCreateTextBounds";
import { normalizeTldrawColor } from "./tldrawColor";

/** Same forbidden / obstacle / viewport contract as handwriting placement. */
export interface CanvasActionLayoutContext {
  forbidden: BoundingBox;
  obstacles: readonly BoundingBox[];
  viewport: BoundingBox;
  /** Unused for overlap math; reserved for future margin tuning. */
  gap?: number;
}

export interface ApplyCanvasActionsResult {
  applied: number;
  dropped: number;
  /** Page-space bounds of shapes created in this batch (best-effort). */
  placedBounds: BoundingBox[];
}

const DEFAULT_TEXT_WRAP = DEFAULT_CREATE_TEXT_WRAP_WIDTH;

/**
 * Apply model-emitted canvas actions. Invalid entries are dropped (zod, per item).
 * Runs synchronously.
 *
 * When `layout` is set, **all creation actions are nudged as a group** by a
 * single (dx, dy) translation so relative positions (e.g. arrows anchored to
 * box corners) are preserved. The group's union bbox is moved to a clear spot
 * using the same strict AABB overlap rules as the handwriting planner.
 */
export function applyCanvasActions(
  editor: Editor,
  actions: readonly unknown[] | null | undefined,
  layout?: CanvasActionLayoutContext | null,
): ApplyCanvasActionsResult {
  if (!actions?.length) {
    return { applied: 0, dropped: 0, placedBounds: [] };
  }

  const parsed: CanvasActionFromZod[] = [];
  let dropped = 0;
  for (const raw of actions) {
    const result = canvasActionSchema.safeParse(raw);
    if (!result.success) {
      dropped += 1;
      continue;
    }
    parsed.push(result.data);
  }
  if (parsed.length === 0) {
    return { applied: 0, dropped, placedBounds: [] };
  }

  let delta = { x: 0, y: 0 };
  if (layout) {
    const bounds: BoundingBox[] = [];
    for (const a of parsed) {
      const b = estimateActionBounds(a, DEFAULT_TEXT_WRAP);
      if (b) bounds.push(b);
    }
    const union = unionBoundingBoxes(bounds);
    if (union && union.width >= 0 && union.height >= 0) {
      const cleared = findClearRectNearPreferred(
        { x: union.x, y: union.y },
        {
          width: Math.max(1, union.width),
          height: Math.max(1, union.height),
        },
        layout.forbidden,
        layout.obstacles,
        layout.viewport,
      );
      delta = { x: cleared.x - union.x, y: cleared.y - union.y };
    }
  }

  const placed: BoundingBox[] = [];
  let applied = 0;
  const getBounds = (id: TLShapeId): BoundingBox | null => {
    if (typeof editor.getShapePageBounds !== "function") return null;
    const b = editor.getShapePageBounds(id);
    return b ? { x: b.x, y: b.y, width: b.w, height: b.h } : null;
  };

  for (const action of parsed) {
    switch (action._type) {
      case "create_text": {
        const id = createShapeId();
        const x = action.x + delta.x;
        const y = action.y + delta.y;
        editor.createShape({
          id,
          type: "text",
          x,
          y,
          props: {
            text: action.text,
            w: DEFAULT_TEXT_WRAP,
            autoSize: true,
            font: "draw",
            size: "m",
            textAlign: "start",
            color: "black",
            scale: 1,
          },
        });
        const b = getBounds(id);
        placed.push(
          b ?? estimateCreateTextBounds(x, y, action.text, DEFAULT_TEXT_WRAP),
        );
        applied += 1;
        break;
      }
      case "create_geo": {
        const id = createShapeId();
        const x = action.x + delta.x;
        const y = action.y + delta.y;
        editor.createShape({
          id,
          type: "geo",
          x,
          y,
          props: {
            geo: action.geo,
            w: action.w,
            h: action.h,
            text: action.text ?? "",
            color: normalizeTldrawColor(action.color, "black"),
            labelColor: "black",
            fill: "none",
            dash: "draw",
            size: "m",
            font: "draw",
            align: "middle",
            verticalAlign: "middle",
            growY: 0,
            url: "",
            scale: 1,
          },
        });
        const b = getBounds(id);
        placed.push(b ?? { x, y, width: action.w, height: action.h });
        applied += 1;
        break;
      }
      case "create_arrow": {
        const id = createShapeId();
        const x1 = action.x1 + delta.x;
        const y1 = action.y1 + delta.y;
        const x2 = action.x2 + delta.x;
        const y2 = action.y2 + delta.y;
        editor.createShape({
          id,
          type: "arrow",
          x: x1,
          y: y1,
          props: {
            start: { x: 0, y: 0 },
            end: { x: x2 - x1, y: y2 - y1 },
            text: action.text ?? "",
            color: normalizeTldrawColor(action.color, "black"),
            labelColor: "black",
            fill: "none",
            dash: "draw",
            size: "m",
            font: "draw",
            arrowheadStart: "none",
            arrowheadEnd: "arrow",
            bend: 0,
            labelPosition: 0.5,
            scale: 1,
          },
        });
        const b = getBounds(id);
        placed.push(
          b ?? {
            x: Math.min(x1, x2),
            y: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
          },
        );
        applied += 1;
        break;
      }
      case "create_draw": {
        const id = createShapeId();
        const xs = action.points.map((p) => p.x + delta.x);
        const ys = action.points.map((p) => p.y + delta.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        const localPoints = action.points.map((p, i) => ({
          x: xs[i] - minX,
          y: ys[i] - minY,
          z: 0.5,
        }));
        editor.createShape({
          id,
          type: "draw",
          x: minX,
          y: minY,
          props: {
            segments: [{ type: "free", points: localPoints }],
            color: normalizeTldrawColor(action.color, "black"),
            size: "m",
            dash: "draw",
            fill: "none",
            isComplete: true,
            isClosed: false,
            isPen: false,
            scale: 1,
          },
        });
        const b = getBounds(id);
        placed.push(
          b ?? { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        );
        applied += 1;
        break;
      }
      case "delete_shapes": {
        const toDelete: TLShapeId[] = [];
        for (const sid of action.shapeIds) {
          if (editor.getShape(sid as TLShapeId)) toDelete.push(sid as TLShapeId);
        }
        if (toDelete.length) editor.deleteShapes(toDelete);
        applied += 1;
        break;
      }
      case "move_shapes": {
        editor.run(() => {
          for (const sid of action.shapeIds) {
            const sh = editor.getShape(sid as TLShapeId);
            if (!sh) continue;
            editor.updateShape({
              id: sh.id,
              type: sh.type,
              x: sh.x + action.dx,
              y: sh.y + action.dy,
            });
          }
        });
        applied += 1;
        break;
      }
      default: {
        const _exhaust: never = action;
        void _exhaust;
      }
    }
  }
  return { applied, dropped, placedBounds: placed };
}
