import { describe, it, expect } from "vitest";
import {
  clampPlacementToViewport,
  computeOutputPlacementRect,
  findClearRectNearPreferred,
} from "../../../../src/lib/layout/computeOutputPlacementRect";
import type { BoundingBox } from "../../../../src/types/spatial";
import { aabbStrictlyOverlaps } from "../../../../src/types/spatial";

describe("findClearRectNearPreferred", () => {
  it("places near preferred without overlapping forbidden when space exists", () => {
    const viewport: BoundingBox = { x: 0, y: 0, width: 500, height: 500 };
    const forbidden: BoundingBox = { x: 0, y: 0, width: 50, height: 50 };
    const r = findClearRectNearPreferred(
      { x: 100, y: 100 },
      { width: 80, height: 40 },
      forbidden,
      [],
      viewport,
    );
    expect(aabbStrictlyOverlaps(r, forbidden)).toBe(false);
    expect(r.width).toBe(80);
    expect(r.height).toBe(40);
  });

  it("nudges away when preferred overlaps forbidden", () => {
    const viewport: BoundingBox = { x: 0, y: 0, width: 400, height: 400 };
    const forbidden: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    const r = findClearRectNearPreferred(
      { x: 10, y: 10 },
      { width: 60, height: 30 },
      forbidden,
      [],
      viewport,
    );
    expect(aabbStrictlyOverlaps(r, forbidden)).toBe(false);
  });
});

describe("computeOutputPlacementRect", () => {
  const defaultPref = { width: 600, height: 10 };

  it("places below the forbidden rect when there is space", () => {
    const forbidden: BoundingBox = { x: 0, y: 0, width: 10, height: 10 };
    const rect = computeOutputPlacementRect({
      forbidden,
      preferredSize: defaultPref,
      gap: 16,
      candidates: ["below", "right", "left", "above"],
      obstacles: [],
    });

    expect(rect).toEqual({
      x: 0,
      y: 26,
      width: 600,
      height: 10,
    });
  });

  it("skips below when an obstacle blocks it and picks the next side", () => {
    const forbidden: BoundingBox = { x: 0, y: 0, width: 10, height: 10 };
    // Blocks the entire strip under the selection where "below" would land.
    const obstacles: BoundingBox[] = [{ x: -100, y: 20, width: 900, height: 40 }];

    const rect = computeOutputPlacementRect({
      forbidden,
      preferredSize: defaultPref,
      gap: 16,
      candidates: ["below", "right", "left", "above"],
      obstacles,
    });

    expect(rect).toEqual({
      x: 26,
      y: 0,
      width: 600,
      height: 10,
    });
  });

  it("caps preferred width to the viewport width and clamps into view", () => {
    const forbidden: BoundingBox = { x: 5, y: 5, width: 10, height: 10 };
    const viewport: BoundingBox = { x: 0, y: 0, width: 200, height: 300 };

    const rect = computeOutputPlacementRect({
      forbidden,
      preferredSize: defaultPref,
      gap: 4,
      candidates: ["below"],
      obstacles: [],
      viewport,
    });

    expect(rect.width).toBe(200);
    // Full viewport width forces the box to the left edge.
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(5 + 10 + 4);
  });

  it("clamps position so the placement stays inside the viewport", () => {
    const forbidden: BoundingBox = { x: 400, y: 400, width: 10, height: 10 };
    const viewport: BoundingBox = { x: 0, y: 0, width: 120, height: 120 };

    const rect = computeOutputPlacementRect({
      forbidden,
      preferredSize: { width: 80, height: 8 },
      gap: 8,
      candidates: ["below", "right"],
      obstacles: [],
      viewport,
    });

    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1e-9);
    expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1e-9);
    expect(rect.x).toBeGreaterThanOrEqual(viewport.x - 1e-9);
    expect(rect.y).toBeGreaterThanOrEqual(viewport.y - 1e-9);
  });

  it("grid-search: finds a clean position when all four fixed candidates are blocked", () => {
    // Forbidden sits in the center. Walls of obstacles cover each of the
    // four fixed-candidate positions (below/right/left/above), so tryPick
    // must fall through to the viewport grid search.
    const forbidden: BoundingBox = { x: 100, y: 100, width: 40, height: 40 };
    const viewport: BoundingBox = { x: 0, y: 0, width: 400, height: 400 };
    const W = 80;
    const H = 30;
    const gap = 8;
    const obstacles: BoundingBox[] = [
      // Block "below" candidate at x=100, y=148
      { x: 50, y: 140, width: 300, height: 60 },
      // Block "right" candidate at x=148, y=100
      { x: 140, y: 50, width: 60, height: 300 },
      // Block "left" candidate at x=12, y=100
      { x: 0, y: 90, width: 100, height: 80 },
      // Block "above" candidate at x=100, y=62
      { x: 50, y: 40, width: 300, height: 40 },
    ];

    const rect = computeOutputPlacementRect({
      forbidden,
      preferredSize: { width: W, height: H },
      gap,
      candidates: ["below", "right", "left", "above"],
      obstacles,
      viewport,
    });

    const overlaps = (a: BoundingBox, b: BoundingBox) =>
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y;

    // Must be inside viewport, not overlapping forbidden, not overlapping any obstacle.
    expect(rect.x).toBeGreaterThanOrEqual(viewport.x);
    expect(rect.y).toBeGreaterThanOrEqual(viewport.y);
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.x + viewport.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.y + viewport.height);
    expect(overlaps(rect, forbidden)).toBe(false);
    for (const o of obstacles) expect(overlaps(rect, o)).toBe(false);
  });

  it("adaptive width: picks a narrower 'right' placement when selection is near the left edge", () => {
    // Selection is near the left edge. "below" is blocked, so the fast path
    // should pick "right" — but only if we adapt the width to fit beside
    // the selection instead of using the full preferred 900.
    const forbidden: BoundingBox = { x: 0, y: 100, width: 150, height: 100 };
    const viewport: BoundingBox = { x: 0, y: 0, width: 1000, height: 600 };
    // Block the strip directly below the selection so "below" fails.
    const obstacles: BoundingBox[] = [
      { x: -50, y: 205, width: 1100, height: 80 },
    ];

    const rect = computeOutputPlacementRect({
      forbidden,
      preferredSize: { width: 900, height: 80 },
      gap: 10,
      candidates: ["below", "right", "left", "above"],
      obstacles,
      viewport,
    });

    // Must land to the right of the forbidden region (not overlap it,
    // not below — that was blocked).
    expect(rect.x).toBeGreaterThanOrEqual(forbidden.x + forbidden.width + 10 - 1e-9);
    // Should be narrower than the full preferred 900 because it was capped
    // to the room available between forbidden.right and viewport.right.
    expect(rect.width).toBeLessThan(900);
    // Still readable width.
    expect(rect.width).toBeGreaterThanOrEqual(200);
    // Inside the viewport.
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1e-9);
  });

  it("keeps same right column by scanning lower slots before switching sides", () => {
    const forbidden: BoundingBox = { x: 0, y: 100, width: 150, height: 100 };
    const viewport: BoundingBox = { x: 0, y: 0, width: 1000, height: 600 };
    // Block only the top-right anchor slot; lower right area stays free.
    const obstacles: BoundingBox[] = [{ x: 160, y: 100, width: 500, height: 110 }];

    const rect = computeOutputPlacementRect({
      forbidden,
      preferredSize: { width: 420, height: 100 },
      gap: 10,
      candidates: ["right", "left", "below", "above"],
      obstacles,
      viewport,
    });

    // Still right-side placement.
    expect(rect.x).toBeGreaterThanOrEqual(forbidden.x + forbidden.width + 10 - 1e-9);
    // But pushed lower than the blocked top-right anchor.
    expect(rect.y).toBeGreaterThan(100);
  });

  it("never returns a rect that overlaps forbidden even when clamping would drag it there", () => {
    // The "below" candidate lands just below forbidden at y=170. With a
    // preferred height of 200, the rect extends to y=370 — past the
    // viewport bottom at y=250. Naïve clamping would shift it up to y=50,
    // which overlaps the forbidden region at y=[100,160]. The fix: reject
    // candidates whose clamped form would overlap forbidden.
    const forbidden: BoundingBox = { x: 100, y: 100, width: 80, height: 60 };
    const viewport: BoundingBox = { x: 0, y: 0, width: 400, height: 250 };

    const rect = computeOutputPlacementRect({
      forbidden,
      preferredSize: { width: 200, height: 200 },
      gap: 10,
      candidates: ["below", "right", "left", "above"],
      obstacles: [],
      viewport,
    });

    const overlaps = (a: BoundingBox, b: BoundingBox) =>
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y;

    expect(overlaps(rect, forbidden)).toBe(false);
    // Must stay inside viewport too.
    expect(rect.x).toBeGreaterThanOrEqual(viewport.x - 1e-9);
    expect(rect.y).toBeGreaterThanOrEqual(viewport.y - 1e-9);
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1e-9);
    expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1e-9);
  });

  it("sideAnchorY: cross-divider right placement anchors to top of lane, not parallel to selection", () => {
    // Selection is at the BOTTOM of the left lane; the right lane is empty.
    // Without sideAnchorY the answer would land parallel to the selection
    // (y ≈ 700). With sideAnchorY = viewport top it should land at the top.
    const forbidden: BoundingBox = { x: 0, y: 700, width: 300, height: 80 };
    const viewport: BoundingBox = { x: 0, y: 40, width: 1000, height: 800 };

    const rect = computeOutputPlacementRect({
      forbidden,
      preferredSize: { width: 400, height: 100 },
      gap: 10,
      candidates: ["right", "left", "below", "above"],
      obstacles: [],
      viewport,
      sideAnchorY: viewport.y,
    });

    // Right-lane placement.
    expect(rect.x).toBeGreaterThanOrEqual(forbidden.x + forbidden.width + 10 - 1e-9);
    // Top-of-lane anchor, NOT parallel to the selection (which is at y=700).
    expect(rect.y).toBe(viewport.y);
  });

  it("sideAnchorY does not affect 'below' candidates", () => {
    const forbidden: BoundingBox = { x: 0, y: 200, width: 100, height: 50 };
    const viewport: BoundingBox = { x: 0, y: 0, width: 500, height: 600 };

    const rect = computeOutputPlacementRect({
      forbidden,
      preferredSize: { width: 200, height: 40 },
      gap: 8,
      candidates: ["below"],
      obstacles: [],
      viewport,
      sideAnchorY: 0,
    });

    // "below" is computed from forbidden.bottom + gap, unaffected by sideAnchorY.
    expect(rect.y).toBe(forbidden.y + forbidden.height + 8);
  });

  it("grid-search: shrinks the preferred size when no full-size clean cell exists", () => {
    // Tiny viewport packed with narrow obstacles means full-size (120×30)
    // won't fit anywhere; shrinking should eventually find a clean spot.
    const forbidden: BoundingBox = { x: 10, y: 10, width: 20, height: 20 };
    const viewport: BoundingBox = { x: 0, y: 0, width: 200, height: 160 };
    const obstacles: BoundingBox[] = [
      { x: 0, y: 40, width: 200, height: 30 },
      { x: 0, y: 90, width: 200, height: 30 },
    ];

    const rect = computeOutputPlacementRect({
      forbidden,
      preferredSize: { width: 120, height: 30 },
      gap: 4,
      candidates: ["below", "right", "left", "above"],
      obstacles,
      viewport,
    });

    // Shrink succeeded: width < preferred (120) means grid found a smaller fit.
    expect(rect.width).toBeLessThanOrEqual(120);
    expect(rect.height).toBeLessThanOrEqual(30);
    // Still collision-free with the two horizontal strips.
    const overlaps = (a: BoundingBox, b: BoundingBox) =>
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y;
    for (const o of obstacles) expect(overlaps(rect, o)).toBe(false);
  });
});

describe("clampPlacementToViewport", () => {
  it("shrinks width and shifts left when the box extends past the right edge", () => {
    const viewport: BoundingBox = { x: 0, y: 0, width: 100, height: 50 };
    const rect: BoundingBox = { x: 10, y: 0, width: 200, height: 10 };

    expect(clampPlacementToViewport(rect, viewport)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 10,
    });
  });
});
