import { describe, it, expect, vi } from "vitest";
import type { Editor } from "tldraw";
import type { TextLayoutPlan } from "../../../src/lib/layout/types";
import { renderLayoutTextShape } from "../../../src/lib/tldraw/renderLayoutTextShape";
import type { SpatialPayload } from "../../../src/types/spatial";

describe("renderLayoutTextShape", () => {
  it("creates a native tldraw text shape with expected props", () => {
    const createShape = vi.fn();
    const editor = { createShape } as unknown as Editor;

    const placement: SpatialPayload = { x: 1, y: 2, width: 3, height: 4 };
    const plan: TextLayoutPlan = {
      version: 1,
      placement,
      text: "hello",
      lineCount: 1,
      truncated: false,
      textShapeProps: {
        text: "hello",
        w: 3,
        autoSize: false,
        font: "draw",
        size: "m",
        textAlign: "start",
        color: "black",
        scale: 1,
      },
    };

    renderLayoutTextShape(editor, plan);

    expect(createShape).toHaveBeenCalledTimes(1);
    expect(createShape).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "text",
        x: placement.x,
        y: placement.y,
        props: expect.objectContaining({
          text: "hello",
          w: 3,
          autoSize: false,
          font: "draw",
          size: "m",
          textAlign: "start",
          color: "black",
          scale: 1,
        }),
      }),
    );
  });
});

