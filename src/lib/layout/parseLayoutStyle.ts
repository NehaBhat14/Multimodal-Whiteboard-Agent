import type { LayoutStyle } from "./placementContextTypes";

const ALLOWED = new Set<LayoutStyle>([
  "COLUMNAR",
  "MIND_MAP",
  "FLOWING",
  "RESEARCH_STACK",
  "UNKNOWN",
]);

/**
 * Normalize provider layout tag to closed vocabulary (contract §2).
 */
export function parseLayoutStyle(raw: string | undefined | null): LayoutStyle {
  if (raw == null || typeof raw !== "string") return "UNKNOWN";
  const u = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (ALLOWED.has(u as LayoutStyle)) return u as LayoutStyle;
  return "UNKNOWN";
}
