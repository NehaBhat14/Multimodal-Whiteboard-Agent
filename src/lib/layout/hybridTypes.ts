export type HybridLayoutStyle = "COLUMNAR" | "MIND_MAP" | "FLOWING" | "UNKNOWN";

export type HybridIntentHint =
  | "comparison"
  | "brainstorm"
  | "notes"
  | "timeline"
  | "unknown";

export type HybridScriptDirection = "LTR" | "RTL" | "VERTICAL" | "UNKNOWN";

export type HybridWidthProfile = {
  w_avg: number;
  min_width: number;
  max_width: number;
  sample_count: number;
};

export type HybridLayoutAnalysis = {
  layout_style: HybridLayoutStyle;
  intent_hint: HybridIntentHint;
  script_direction: HybridScriptDirection;
  detected_language: string;
  detected_script: string;
  language_confidence: number;
  divider_intent: boolean;
  split_column_context: boolean;
  width_profile: HybridWidthProfile;
};

export type HybridScoreBreakdown = {
  side_bias: number;
  aspect_match: number;
  clearance: number;
  reading_continuity: number;
};

export type HybridPlacementCandidate = {
  candidate_id: string;
  side: "below" | "right" | "left" | "above" | "column_next" | "unknown";
  clearance_ok: boolean;
  overlap_count: number;
  aspect_ratio_delta: number;
  continuity_score: number;
  score_breakdown: HybridScoreBreakdown;
};
