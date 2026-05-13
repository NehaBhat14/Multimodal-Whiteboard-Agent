import { describe, expect, it } from "vitest";
import {
  expandPlacementHeightForHandwriting,
  HANDWRITING_RENDER_LINE_HEIGHT_PX,
  probeLineHeightPxForScript,
} from "../../../../src/lib/layout/handwritingPlacementAdjust";

describe("handwritingPlacementAdjust", () => {
  it("probeLineHeightPxForScript matches planTextLayout latin line height", () => {
    const lh = probeLineHeightPxForScript("latin_default");
    expect(lh).toBeCloseTo(28 * 1.22, 5);
  });

  it("expands placement when probe box is one tldraw line tall", () => {
    const probeLh = probeLineHeightPxForScript("latin_default");
    const rect = { x: 0, y: 0, width: 400, height: probeLh };
    const viewport = { x: 0, y: 0, width: 1200, height: 800 };
    const out = expandPlacementHeightForHandwriting({
      rect,
      viewport,
      scriptClass: "latin_default",
    });
    expect(out.height).toBeGreaterThanOrEqual(HANDWRITING_RENDER_LINE_HEIGHT_PX);
    expect(out.height).toBe(HANDWRITING_RENDER_LINE_HEIGHT_PX);
  });

  it("scales line count for multi-line probe heights", () => {
    const probeLh = probeLineHeightPxForScript("latin_default");
    const rect = { x: 0, y: 0, width: 400, height: 3 * probeLh };
    const viewport = { x: 0, y: 0, width: 1200, height: 800 };
    const out = expandPlacementHeightForHandwriting({
      rect,
      viewport,
      scriptClass: "latin_default",
    });
    expect(out.height).toBe(3 * HANDWRITING_RENDER_LINE_HEIGHT_PX);
  });

  it("does not shrink indic probe heights below handwriting line height", () => {
    const probeLh = probeLineHeightPxForScript("indic_devanagari");
    expect(probeLh).toBeGreaterThan(HANDWRITING_RENDER_LINE_HEIGHT_PX);
    const rect = { x: 0, y: 0, width: 400, height: 2 * probeLh };
    const viewport = { x: 0, y: 0, width: 1200, height: 800 };
    const out = expandPlacementHeightForHandwriting({
      rect,
      viewport,
      scriptClass: "indic_devanagari",
    });
    expect(out.height).toBe(2 * probeLh);
  });
});
