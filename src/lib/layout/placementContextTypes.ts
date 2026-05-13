import type { BoundingBox } from "../../types/spatial";
import type { PlacementSide } from "./computeOutputPlacementRect";

/** Dominant script for sizing / telemetry (see data-model §2). */
export type ScriptClass =
  | "indic_devanagari"
  | "latin_accented"
  | "latin_default"
  | "other";

/** Geometry-only hint from shape analysis (distinct from VLM `layout_style`). */
export type GeometryLayoutHint = "COLUMNAR" | "RESEARCH_STACK" | "NEUTRAL";

/** Serializable `geometryFeatures` DTO (wire + planner). */
export type GeometryFeatures = {
  columnScore: number;
  verticalStackScore: number;
  layoutHint: GeometryLayoutHint;
};

/** Per-side probe outcome attached to optional `placementContext`. */
export type PerSideFeasibility = {
  side: PlacementSide;
  wMax: number;
  hRequired: number;
  strictFeasible: boolean;
  relaxedFeasible: boolean;
};

/** Optional request extension for reasoning + placement (contract §1). */
export type PlacementContext = {
  viewport: BoundingBox;
  forbidden: BoundingBox;
  /** Canonical order: below, right, left, above. */
  perSide: readonly PerSideFeasibility[];
  geometryFeatures?: GeometryFeatures;
  inheritedWidth?: number | null;
};

/** Normalized optional layout intent from provider (contract §2). */
export type LayoutStyle =
  | "COLUMNAR"
  | "MIND_MAP"
  | "FLOWING"
  | "RESEARCH_STACK"
  | "UNKNOWN";
