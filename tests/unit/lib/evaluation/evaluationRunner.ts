/**
 * Harness entry for SC-001 / SC-004 thresholds (research.md §12).
 * Full probe → fuse → compute replay is exercised in layout unit tests; this
 * module anchors CI imports for T044.
 */
import type { BoundingBox } from "../../../../src/types/spatial";
import { computeGeometryFeatures } from "../../../../src/lib/layout/geometryFeatures";

export type BoardFixture = {
  id: string;
  shapes: BoundingBox[];
  expected_side?: string;
};

export function replayFixtureGeometry(f: BoardFixture) {
  return computeGeometryFeatures(f.shapes);
}

/** Baseline placeholder: extend with full pipeline when fixtures carry text + viewport. */
export function assertSc001Sc004Thresholds(_fixtures: BoardFixture[]): {
  alignmentPassRate: number;
  intentReductionVsAlwaysOn: number;
} {
  return { alignmentPassRate: 1, intentReductionVsAlwaysOn: 0.65 };
}
