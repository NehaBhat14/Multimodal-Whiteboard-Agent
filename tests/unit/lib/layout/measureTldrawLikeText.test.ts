import { describe, it, expect } from "vitest";
import { measureTldrawLikeTextWidth } from "../../../../src/lib/layout/measureTldrawLikeText";

describe("measureTldrawLikeTextWidth", () => {
  it("returns non-negative finite width", () => {
    const w = measureTldrawLikeTextWidth("hello");
    expect(w).toBeGreaterThan(0);
    expect(Number.isFinite(w)).toBe(true);
  });

  it("returns wider width for longer ASCII string", () => {
    const a = measureTldrawLikeTextWidth("a");
    const b = measureTldrawLikeTextWidth("aaa");
    expect(b).toBeGreaterThan(a);
  });

  it("accepts custom font css", () => {
    const w = measureTldrawLikeTextWidth("x", "40px monospace");
    expect(w).toBeGreaterThan(0);
  });
});
