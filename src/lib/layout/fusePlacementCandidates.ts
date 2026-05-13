import type { PlacementSide } from "./computeOutputPlacementRect";
import type { GeometryFeatures, LayoutStyle } from "./placementContextTypes";

/**
 * Soft reorder of placement candidates (research §8). Hard feasibility stays in
 * `computeOutputPlacementRect` collision loop.
 */
export function fusePlacementCandidates(args: {
  candidates: readonly PlacementSide[];
  layoutStyle: LayoutStyle;
  geometryFeatures: GeometryFeatures;
  inheritedWidth: number | null;
  wMaxBySide: Partial<Record<PlacementSide, number>>;
}): { orderedSides: PlacementSide[]; reasons: string[] } {
  const reasons: string[] = [];

  const prior = (side: PlacementSide): number => {
    let p = 0.5;
    if (
      args.layoutStyle === "COLUMNAR" ||
      args.geometryFeatures.layoutHint === "COLUMNAR"
    ) {
      if (side === "below") p += 0.25;
    }
    if (
      args.layoutStyle === "RESEARCH_STACK" ||
      args.geometryFeatures.layoutHint === "RESEARCH_STACK"
    ) {
      if (side === "below" || side === "above") p += 0.12;
    }
    if (args.inheritedWidth != null) {
      const w = args.wMaxBySide[side] ?? 0;
      if (w > 0 && args.inheritedWidth > 0) {
        const ratio =
          Math.min(w, args.inheritedWidth) /
          Math.max(w, args.inheritedWidth);
        p += ratio * 0.18;
      }
    }
    return p;
  };

  const idx = (s: PlacementSide) => args.candidates.indexOf(s);
  const ordered = [...args.candidates].sort((a, b) => {
    const d = prior(b) - prior(a);
    if (d !== 0) return d;
    return idx(a) - idx(b);
  });

  reasons.push(
    `fuse layoutStyle=${args.layoutStyle} hint=${args.geometryFeatures.layoutHint}`,
  );
  return { orderedSides: ordered, reasons };
}
