import type { HybridPlacementCandidate } from "./hybridTypes";

export const HYBRID_SCORE_EPSILON = 0.02;

export function computeHybridFusionScore(
  candidate: HybridPlacementCandidate,
): number {
  const base =
    candidate.score_breakdown.side_bias +
    candidate.score_breakdown.aspect_match +
    candidate.score_breakdown.clearance +
    candidate.score_breakdown.reading_continuity;
  return Number(base.toFixed(6));
}

/**
 * Deterministic chooser:
 * - Prefer clearance-safe candidates.
 * - Prefer higher fusion score.
 * - If scores are close, prefer lower aspect-ratio delta.
 * - Final tie-break by side priority for stable ordering.
 */
export function chooseBestHybridCandidate(
  candidates: readonly HybridPlacementCandidate[],
): HybridPlacementCandidate | null {
  if (candidates.length === 0) return null;

  const sidePriority: Record<HybridPlacementCandidate["side"], number> = {
    below: 0,
    column_next: 1,
    right: 2,
    left: 3,
    above: 4,
    unknown: 5,
  };

  return [...candidates].sort((a, b) => {
    if (a.clearance_ok !== b.clearance_ok) return a.clearance_ok ? -1 : 1;

    const aScore = computeHybridFusionScore(a);
    const bScore = computeHybridFusionScore(b);
    const scoreDelta = bScore - aScore;

    if (Math.abs(scoreDelta) > HYBRID_SCORE_EPSILON) return scoreDelta;

    const aspectDelta = a.aspect_ratio_delta - b.aspect_ratio_delta;
    if (aspectDelta !== 0) return aspectDelta;

    if (a.overlap_count !== b.overlap_count) {
      return a.overlap_count - b.overlap_count;
    }

    return sidePriority[a.side] - sidePriority[b.side];
  })[0];
}
