import { describe, it, expect } from "vitest";
import {
  buildCanvasContext,
  trimCanvasContextForBudget,
  CANVAS_CONTEXT_BUDGET_BYTES,
} from "../../../../src/lib/tldraw/canvasContext";
import type { Box, Editor, TLShapeId } from "tldraw";

function box(x: number, y: number, w: number, h: number): Box {
  return {
    x,
    y,
    w,
    h,
    minX: x,
    maxX: x + w,
    minY: y,
    maxY: y + h,
  } as unknown as Box;
}

describe("buildCanvasContext", () => {
  it("sets answerCrop when there is a selection and views.layoutViewport from viewport", () => {
    const s1 = "shape:text-1" as TLShapeId;
    const pageIds: TLShapeId[] = [s1, "shape:rect-1" as TLShapeId];
    const vp = box(0, 0, 800, 600);
    const tbox = box(10, 20, 100, 30);
    const editor = {
      getCurrentPageShapeIds: () => pageIds,
      getViewportPageBounds: () => vp,
      getShapePageBounds: (id: TLShapeId) => {
        if (id === s1) return tbox;
        return null;
      },
      getShape: (id: TLShapeId) =>
        id === s1
          ? { id, type: "text", x: 10, y: 20, props: { text: "Hello world" } }
          : null,
    } as unknown as Editor;

    const spatial = { x: 10, y: 20, width: 100, height: 30 };
    const ctx = buildCanvasContext(editor, [String(s1)], spatial);

    expect(ctx.version).toBe(1);
    expect(ctx.pageShapeCount).toBe(2);
    expect(ctx.views.answerCrop).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 30,
    });
    expect(ctx.views.layoutViewport).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    expect(ctx.selectionShapes[0]).toMatchObject({ type: "text" });
    expect(ctx.selectionShapes[0]?.text).toContain("Hello");
  });

  it("leaves answerCrop null when there is no selection", () => {
    const s1 = "shape:x1" as TLShapeId;
    const vp = box(0, 0, 400, 300);
    const editor = {
      getCurrentPageShapeIds: () => [s1],
      getViewportPageBounds: () => vp,
      getShapePageBounds: (id: TLShapeId) => (id === s1 ? box(5, 5, 20, 20) : null),
      getShape: (id: TLShapeId) => ({ id, type: "geo" }),
    } as unknown as Editor;
    const ctx = buildCanvasContext(editor, [], { x: 0, y: 0, width: 1, height: 1 });
    expect(ctx.views.answerCrop).toBeNull();
  });
});

describe("trimCanvasContextForBudget", () => {
  it("keeps small payloads unchanged", () => {
    const c = trimCanvasContextForBudget(
      {
        version: 1,
        pageShapeCount: 1,
        views: {
          answerCrop: null,
          layoutViewport: { x: 0, y: 0, width: 1, height: 1 },
        },
        selectionShapes: [],
        viewportShapes: [],
        peripheral: [],
      },
      CANVAS_CONTEXT_BUDGET_BYTES,
    );
    expect(c.viewportShapes).toEqual([]);
  });
});
