import { useEffect, useMemo, useState } from "react";

const FALLBACK_PHRASES = [
  "Looking at the canvas",
  "Thinking",
  "Pondering the layout",
  "Still on it—this one’s a bit tricky",
] as const;

const STAGE_LABELS: Record<string, string> = {
  reading_canvas: "Reading the canvas",
  spatial_pass: "Pondering layout",
  answer_pass: "Drafting your answer",
  parsing: "Wiring the response",
  finalizing: "Finishing up",
  tool_call: "Calling a tool",
  tool_result: "Tool finished",
};

/** Human-readable label for SSE / pipeline stage names (shared with telemetry UI). */
export function reasoningStageLabel(name: string | null | undefined): string {
  if (!name) return "";
  if (STAGE_LABELS[name]) return STAGE_LABELS[name]!;
  if (name.startsWith("tool_")) {
    return name.replace("tool_", "").replace(/_/g, " ");
  }
  return name.replace(/_/g, " ");
}

export function ThinkingIndicator({
  active,
  stageName,
  elapsedSec,
  compact = false,
}: {
  active: boolean;
  stageName: string | null;
  /** Seconds since request start */
  elapsedSec: number;
  /** Compact = button row */
  compact?: boolean;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  const { main, sub } = useMemo(() => {
    if (!active) {
      return { main: "Generate", sub: null as string | null };
    }
    const s = (stageName || "").trim();
    if (s) {
      return {
        main: reasoningStageLabel(s) || "Working…",
        sub: null as string | null,
      };
    }
    if (tick > 1) {
      const i = (Math.floor(tick - 0.5) % FALLBACK_PHRASES.length) as number;
      return { main: FALLBACK_PHRASES[i]!, sub: "Taking a moment…" };
    }
    return { main: "Starting…", sub: null as string | null };
  }, [active, stageName, tick]);

  const patient = useMemo(() => {
    if (elapsedSec >= 25) return "This one needs a careful answer.";
    if (elapsedSec >= 10) return "Working on something a bit more complex…";
    if (elapsedSec >= 4) return "Taking a moment…";
    return null;
  }, [elapsedSec]);

  if (!active) {
    return null;
  }

  const mainClass = `${compact ? "text-[9px]" : "text-[10px]"} font-label font-bold leading-tight tracking-tight bg-gradient-to-r from-slate-600 via-amber-600/95 to-amber-500/85 dark:from-slate-300 dark:via-amber-400/95 dark:to-amber-300/75 bg-clip-text text-transparent`;

  if (compact) {
    return (
      <span className="flex w-full min-w-0 max-w-full items-center justify-center gap-1.5 px-0.5">
        <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
          <span className="h-1 w-1 rounded-full bg-amber-500 shadow-sm animate-pulse" />
          <span className="h-1 w-1 rounded-full bg-amber-500/75 animate-pulse [animation-delay:180ms]" />
          <span className="h-1 w-1 rounded-full bg-amber-500/55 animate-pulse [animation-delay:360ms]" />
        </span>
        <span className={`min-w-0 flex-1 truncate text-center ${mainClass}`}>
          {main}
        </span>
      </span>
    );
  }

  return (
    <span className="flex flex-col items-start min-w-0 w-full text-left">
      <span className={`inline-block w-full drop-shadow-sm animate-pulse ${mainClass}`}>
        {main}
      </span>
      {patient && (
        <span className="text-[8px] font-label text-amber-700/90 dark:text-amber-300/90 mt-0.5 max-w-full truncate">
          {patient}
        </span>
      )}
      {sub && !patient && (
        <span className="text-[8px] text-slate-500 dark:text-slate-400 font-label mt-0.5">
          {sub}
        </span>
      )}
    </span>
  );
}
