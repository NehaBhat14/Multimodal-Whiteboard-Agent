import { describe, it, expect } from "vitest";
import type { PathCommand } from "opentype.js";
import { pathCommandsToSubpaths } from "../../../../src/lib/handwriting/textToGlyphStrokes";

describe("pathCommandsToSubpaths", () => {
  it("returns no subpath when there is only a move command (degenerate)", () => {
    const cmds = [{ type: "M", x: 0, y: 0 }] as PathCommand[];
    expect(pathCommandsToSubpaths(cmds)).toEqual([]);
  });

  it("produces one open subpath with straight-line sampling", () => {
    const cmds = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 10, y: 0 },
      { type: "L", x: 10, y: 10 },
    ] as PathCommand[];
    const subs = pathCommandsToSubpaths(cmds);
    expect(subs).toHaveLength(1);
    expect(subs[0].closed).toBe(false);
    expect(subs[0].points[0]).toEqual({ x: 0, y: 0 });
    expect(subs[0].points.at(-1)).toEqual({ x: 10, y: 10 });
  });

  it("splits multiple M...Z runs into separate subpaths and marks closed=true", () => {
    const cmds = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 1, y: 0 },
      { type: "L", x: 1, y: 1 },
      { type: "Z" },
      { type: "M", x: 5, y: 5 },
      { type: "L", x: 6, y: 5 },
    ] as PathCommand[];
    const subs = pathCommandsToSubpaths(cmds);
    expect(subs).toHaveLength(2);
    expect(subs[0].closed).toBe(true);
    // Closed subpath ends at the subpath start (0, 0).
    expect(subs[0].points.at(-1)).toEqual({ x: 0, y: 0 });
    expect(subs[1].closed).toBe(false);
    expect(subs[1].points[0]).toEqual({ x: 5, y: 5 });
  });

  it("samples quadratic bezier curves with endpoints preserved", () => {
    const cmds = [
      { type: "M", x: 0, y: 0 },
      { type: "Q", x: 10, y: 0, x1: 5, y1: 10 },
    ] as PathCommand[];
    const subs = pathCommandsToSubpaths(cmds);
    expect(subs).toHaveLength(1);
    // Start + samples. Must include the endpoint exactly.
    expect(subs[0].points[0]).toEqual({ x: 0, y: 0 });
    expect(subs[0].points.at(-1)).toEqual({ x: 10, y: 0 });
    expect(subs[0].points.length).toBeGreaterThan(2);
  });

  it("samples cubic bezier curves with endpoints preserved", () => {
    const cmds = [
      { type: "M", x: 0, y: 0 },
      { type: "C", x: 30, y: 0, x1: 10, y1: 20, x2: 20, y2: -20 },
    ] as PathCommand[];
    const subs = pathCommandsToSubpaths(cmds);
    expect(subs[0].points[0]).toEqual({ x: 0, y: 0 });
    expect(subs[0].points.at(-1)).toEqual({ x: 30, y: 0 });
  });

  it("discards subpaths with fewer than two points", () => {
    const cmds = [
      { type: "M", x: 0, y: 0 },
      { type: "M", x: 10, y: 10 },
      { type: "L", x: 20, y: 10 },
    ] as PathCommand[];
    const subs = pathCommandsToSubpaths(cmds);
    // First M-only subpath has 1 point → discarded. Second M+L has 2 → kept.
    expect(subs).toHaveLength(1);
    expect(subs[0].points[0]).toEqual({ x: 10, y: 10 });
  });
});