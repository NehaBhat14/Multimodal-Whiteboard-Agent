import type { HybridIntentHint } from "./hybridTypes";
import type { LayoutStyle } from "./placementContextTypes";

export type IntentAwareLayoutPlan = {
  maxLines: number;
  maxChars: number;
  density: "tight" | "balanced" | "spacious";
};

export function planIntentAwareWrapping(args: {
  layoutStyle: LayoutStyle;
  intentHint: HybridIntentHint;
}): IntentAwareLayoutPlan {
  if (args.layoutStyle === "COLUMNAR" || args.intentHint === "comparison") {
    return { maxLines: 12, maxChars: 650, density: "tight" };
  }
  if (args.layoutStyle === "MIND_MAP" || args.intentHint === "brainstorm") {
    return { maxLines: 8, maxChars: 420, density: "spacious" };
  }
  return { maxLines: 10, maxChars: 500, density: "balanced" };
}
