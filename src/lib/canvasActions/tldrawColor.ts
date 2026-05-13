/** Subset of tldraw default colors we accept via canvasActions. */
export type TldrawAgentColor =
  | "black"
  | "grey"
  | "violet"
  | "light-violet"
  | "blue"
  | "light-blue"
  | "yellow"
  | "orange"
  | "green"
  | "light-green"
  | "red"
  | "light-red";

const KNOWN: Set<string> = new Set([
  "black",
  "grey",
  "violet",
  "light-violet",
  "blue",
  "light-blue",
  "yellow",
  "orange",
  "green",
  "light-green",
  "red",
  "light-red",
]);

const ALIAS: Record<string, TldrawAgentColor> = {
  gray: "grey",
  purple: "violet",
  indigo: "violet",
  pink: "light-red",
  magenta: "violet",
  cyan: "light-blue",
  teal: "blue",
  lime: "light-green",
  navy: "blue",
};

export function normalizeTldrawColor(
  input?: string | null,
  fallback: TldrawAgentColor = "black",
): TldrawAgentColor {
  if (!input) return fallback;
  const key = String(input).trim().toLowerCase();
  if (KNOWN.has(key)) return key as TldrawAgentColor;
  const mapped = ALIAS[key];
  if (mapped) return mapped;
  return fallback;
}
