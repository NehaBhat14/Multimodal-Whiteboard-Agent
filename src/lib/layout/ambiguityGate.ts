import type { PerSideFeasibility } from "./placementContextTypes";

const EPS = 0.5;

/**
 * Deterministic ambiguity signal (research §9).
 */
export function shouldInvokeLayoutIntent(
  perSide: readonly PerSideFeasibility[],
): boolean {
  const strict = perSide.filter((p) => p.strictFeasible);
  if (strict.length >= 2) {
    const ws = strict.map((s) => s.wMax).sort((a, b) => b - a);
    if (Math.abs(ws[0]! - ws[1]!) < EPS) return true;
  }
  if (strict.length === 0 && perSide.some((p) => p.relaxedFeasible)) {
    return true;
  }
  return false;
}
