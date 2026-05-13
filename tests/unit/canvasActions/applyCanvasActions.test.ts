import { describe, it, expect, vi } from "vitest";
import { applyCanvasActions } from "../../../src/lib/canvasActions/applyCanvasActions";
import { estimateCreateTextBounds } from "../../../src/lib/canvasActions/estimateCreateTextBounds";
import type { Editor, TLShapeId } from "tldraw";
import { aabbStrictlyOverlaps } from "../../../src/types/spatial";

describe("applyCanvasActions", () => {
  it("creates a text shape for create_text", () => {
    const createShape = vi.fn();
    const editor = { createShape } as unknown as Editor;
    const r = applyCanvasActions(editor, [
      { _type: "create_text", x: 12, y: 34, text: "ok" },
    ]);
    expect(r.applied).toBe(1);
    expect(r.dropped).toBe(0);
    expect(createShape).toHaveBeenCalled();
    const call = createShape.mock.calls[0]![0];
    expect(call.type).toBe("text");
    expect(call.x).toBe(12);
    expect(call.y).toBe(34);
  });

  it("deletes existing shape ids", () => {
    const id = "shape:abc" as TLShapeId;
    const deleteShapes = vi.fn();
    const getShape = vi.fn((x: string) => (x === id ? { id, type: "text" } : null));
    const editor = { deleteShapes, getShape } as unknown as Editor;
    const r = applyCanvasActions(editor, [
      { _type: "delete_shapes", shapeIds: [id, "missing"] },
    ]);
    expect(r.applied).toBe(1);
    expect(deleteShapes).toHaveBeenCalledWith([id]);
  });

  it("moves existing shapes", () => {
    const id = "shape:mv" as TLShapeId;
    const updateShape = vi.fn();
    const run = vi.fn((fn: () => void) => fn());
    const getShape = vi.fn(() => ({
      id,
      type: "text",
      x: 0,
      y: 0,
    }));
    const editor = { updateShape, run, getShape } as unknown as Editor;
    const r = applyCanvasActions(editor, [
      { _type: "move_shapes", shapeIds: [id], dx: 5, dy: -1 },
    ]);
    expect(r.applied).toBe(1);
    expect(updateShape).toHaveBeenCalled();
  });

  it("drops invalid array entries", () => {
    const editor = { createShape: vi.fn() } as unknown as Editor;
    const r = applyCanvasActions(editor, [{ _type: "create_text" } as never]);
    expect(r.applied).toBe(0);
    expect(r.dropped).toBe(1);
  });

  it("nudges create_text out of planner forbidden rect when layout is provided", () => {
    let placed = { x: 0, y: 0 };
    const createShape = vi.fn((opts: { x: number; y: number }) => {
      placed = { x: opts.x, y: opts.y };
    });
    const getShapePageBounds = vi.fn(() => ({
      x: placed.x,
      y: placed.y,
      w: 72,
      h: 32,
    }));
    const editor = { createShape, getShapePageBounds } as unknown as Editor;
    const r = applyCanvasActions(
      editor,
      [{ _type: "create_text", x: 5, y: 5, text: "A" }],
      {
        forbidden: { x: 0, y: 0, width: 120, height: 120 },
        obstacles: [],
        viewport: { x: 0, y: 0, width: 800, height: 800 },
        gap: 16,
      },
    );
    expect(r.applied).toBe(1);
    const arg = createShape.mock.calls[0]![0] as { x: number; y: number };
    const box = estimateCreateTextBounds(arg.x, arg.y, "A");
    expect(
      aabbStrictlyOverlaps(box, { x: 0, y: 0, width: 120, height: 120 }),
    ).toBe(false);
  });

  it("creates a geo shape for create_geo", () => {
    const createShape = vi.fn();
    const editor = { createShape } as unknown as Editor;
    const r = applyCanvasActions(editor, [
      {
        _type: "create_geo",
        geo: "rectangle",
        x: 10,
        y: 20,
        w: 120,
        h: 60,
        text: "Node",
        color: "blue",
      },
    ]);
    expect(r.applied).toBe(1);
    const call = createShape.mock.calls[0]![0];
    expect(call.type).toBe("geo");
    expect(call.x).toBe(10);
    expect(call.y).toBe(20);
    expect(call.props.geo).toBe("rectangle");
    expect(call.props.w).toBe(120);
    expect(call.props.h).toBe(60);
    expect(call.props.text).toBe("Node");
    expect(call.props.color).toBe("blue");
  });

  it("creates an arrow from (x1,y1) to (x2,y2)", () => {
    const createShape = vi.fn();
    const editor = { createShape } as unknown as Editor;
    const r = applyCanvasActions(editor, [
      { _type: "create_arrow", x1: 100, y1: 50, x2: 200, y2: 80 },
    ]);
    expect(r.applied).toBe(1);
    const call = createShape.mock.calls[0]![0];
    expect(call.type).toBe("arrow");
    expect(call.x).toBe(100);
    expect(call.y).toBe(50);
    expect(call.props.start).toEqual({ x: 0, y: 0 });
    expect(call.props.end).toEqual({ x: 100, y: 30 });
  });

  it("creates a draw shape with shape-local points", () => {
    const createShape = vi.fn();
    const editor = { createShape } as unknown as Editor;
    const r = applyCanvasActions(editor, [
      {
        _type: "create_draw",
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
          { x: 50, y: 25 },
        ],
      },
    ]);
    expect(r.applied).toBe(1);
    const call = createShape.mock.calls[0]![0];
    expect(call.type).toBe("draw");
    expect(call.x).toBe(10);
    expect(call.y).toBe(20);
    const pts = call.props.segments[0].points as Array<{ x: number; y: number }>;
    expect(pts[0]).toEqual({ x: 0, y: 0, z: 0.5 });
    expect(pts[2].x).toBe(40);
    expect(pts[2].y).toBe(5);
  });

  it("nudges all creation actions by a single delta (preserves arrow/box alignment)", () => {
    const calls: Array<{
      type: string;
      x: number;
      y: number;
      props?: Record<string, unknown>;
    }> = [];
    const createShape = vi.fn((opts: { type: string; x: number; y: number; props?: Record<string, unknown> }) => {
      calls.push({ type: opts.type, x: opts.x, y: opts.y, props: opts.props });
    });
    const editor = { createShape } as unknown as Editor;

    // Box A at (0,0)-(100,60); arrow from right-edge midpoint of A to left-edge midpoint of B; box B at (200,0)-(300,60).
    const r = applyCanvasActions(
      editor,
      [
        { _type: "create_geo", geo: "rectangle", x: 0, y: 0, w: 100, h: 60 },
        { _type: "create_arrow", x1: 100, y1: 30, x2: 200, y2: 30 },
        { _type: "create_geo", geo: "rectangle", x: 200, y: 0, w: 100, h: 60 },
      ],
      {
        forbidden: { x: 0, y: 0, width: 400, height: 100 },
        obstacles: [],
        viewport: { x: 0, y: 0, width: 2000, height: 2000 },
      },
    );
    expect(r.applied).toBe(3);

    const boxA = calls[0]!;
    const arrow = calls[1]!;
    const boxB = calls[2]!;

    const dx = boxA.x - 0;
    const dy = boxA.y - 0;

    // Same delta applied to all:
    expect(arrow.x).toBe(100 + dx);
    expect(arrow.y).toBe(30 + dy);
    expect(boxB.x).toBe(200 + dx);
    expect(boxB.y).toBe(0 + dy);

    // Arrow right endpoint (arrow.x + end.x, arrow.y + end.y) still meets left edge of box B.
    const end = (arrow.props!.end as { x: number; y: number });
    const arrowEndX = arrow.x + end.x;
    expect(arrowEndX).toBe(boxB.x);

    // Moved entirely out of forbidden rect.
    expect(boxA.x >= 400 || boxA.y >= 100 || boxA.x + 100 <= 0 || boxA.y + 60 <= 0).toBe(true);
  });
});
