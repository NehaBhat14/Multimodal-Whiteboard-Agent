import type { VlmInferenceResponse } from "../../types/vlm";
import { parseLayoutStyle } from "./parseLayoutStyle";
import type { HybridIntentHint, HybridScriptDirection } from "./hybridTypes";

const INTENT_VALUES = new Set<HybridIntentHint>([
  "comparison",
  "brainstorm",
  "notes",
  "timeline",
  "unknown",
]);

const SCRIPT_DIR_VALUES = new Set<HybridScriptDirection>([
  "LTR",
  "RTL",
  "VERTICAL",
  "UNKNOWN",
]);
const PREFERRED_SIDE_VALUES = new Set(["right", "left", "below", "above", "unknown"]);
const PLACEMENT_MODE_VALUES = new Set(["same_lane", "cross_divider", "unknown"]);

export type SemanticLabelInterpretation = {
  layoutStyle: ReturnType<typeof parseLayoutStyle>;
  intentHint: HybridIntentHint;
  scriptDirection: HybridScriptDirection;
  detectedLanguage: string;
  detectedScript: string;
  preferredSide: "right" | "left" | "below" | "above" | null;
  placementMode: "same_lane" | "cross_divider" | null;
  spatialConfidence: number;
};

export function interpretSemanticLabels(
  response: VlmInferenceResponse,
): SemanticLabelInterpretation {
  const rawIntent = (response.intent_hint ?? "unknown").toString().toLowerCase();
  const rawDir = (response.script_direction ?? "UNKNOWN")
    .toString()
    .toUpperCase();
  const rawPreferredSide = (response.preferred_side ?? "unknown")
    .toString()
    .toLowerCase();
  const rawSpatialConfidence = response.spatial_confidence;
  const rawPlacementMode = (response.placement_mode ?? "unknown")
    .toString()
    .toLowerCase();

  return {
    layoutStyle: parseLayoutStyle(
      typeof response.layoutStyle === "string" ? response.layoutStyle : null,
    ),
    intentHint: INTENT_VALUES.has(rawIntent as HybridIntentHint)
      ? (rawIntent as HybridIntentHint)
      : "unknown",
    scriptDirection: SCRIPT_DIR_VALUES.has(rawDir as HybridScriptDirection)
      ? (rawDir as HybridScriptDirection)
      : "UNKNOWN",
    detectedLanguage:
      typeof response.detected_language === "string"
        ? response.detected_language
        : "unknown",
    detectedScript:
      typeof response.detected_script === "string"
        ? response.detected_script
        : "unknown",
    preferredSide:
      PREFERRED_SIDE_VALUES.has(rawPreferredSide) && rawPreferredSide !== "unknown"
        ? (rawPreferredSide as "right" | "left" | "below" | "above")
        : null,
    placementMode:
      PLACEMENT_MODE_VALUES.has(rawPlacementMode) && rawPlacementMode !== "unknown"
        ? (rawPlacementMode as "same_lane" | "cross_divider")
        : null,
    spatialConfidence:
      typeof rawSpatialConfidence === "number" &&
      Number.isFinite(rawSpatialConfidence) &&
      rawSpatialConfidence >= 0 &&
      rawSpatialConfidence <= 1
        ? rawSpatialConfidence
        : 0,
  };
}
