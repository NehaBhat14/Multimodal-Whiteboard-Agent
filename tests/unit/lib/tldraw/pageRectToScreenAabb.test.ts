import { describe, it, expect } from "vitest";
import { pageBoxToScreenAabb } from "../../../../src/lib/tldraw/pageRectToScreenAabb";
import type { Editor } from "tldraw";

describe("pageBoxToScreenAabb", () => {
  it("maps page rect corners through pageToScreen and returns AABB", () => {
    const editor = {
      pageToScreen: (p: { x: number; y: number }) => ({ x: p.x * 2, y: p.y * 2 }),
    } as unknown as Editor;
    const r = pageBoxToScreenAabb(editor, { x: 0, y: 0, width: 10, height: 5 });
    expect(r).toEqual({ left: 0, top: 0, width: 20, height: 10 });
  });
});
