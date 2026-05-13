import type { VlmInferenceResponse } from "../../types/vlm";
import { AGENT_TOOLS_META } from "../Toolbar/AgentToolsStatus";
import { reasoningStageLabel } from "./ThinkingIndicator";

function agentToolLabel(toolId: string): string {
  return AGENT_TOOLS_META.find((m) => m.id === toolId)?.label ?? toolId;
}

/**
 * Shows whether the agent path used tools and the ordered pipeline stages
 * returned on the final response (stream path).
 */
export function ReasoningTraceSummary({
  response,
}: {
  response: VlmInferenceResponse;
}) {
  const trace = response.tool_trace;
  const stages = response.stages;
  const mode = response.mode ?? "answer";
  const hasTools = trace != null && trace.length > 0;

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-label uppercase tracking-widest font-bold text-slate-400">
        Reasoning path
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[9px] font-sans text-slate-600 dark:text-slate-400">
        <span
          className={`rounded px-1.5 py-0.5 font-label font-bold uppercase tracking-wide ${
            mode === "coding"
              ? "bg-violet-100 text-violet-900 dark:bg-violet-950/60 dark:text-violet-200"
              : "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
          }`}
        >
          {mode === "coding" ? "Agent + tools" : "Direct answer"}
        </span>
        <span className="text-slate-500 dark:text-slate-500">
          {hasTools
            ? `${trace!.length} tool call${trace!.length === 1 ? "" : "s"}`
            : "No tools executed"}
        </span>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 space-y-1.5">
        <div className="text-[9px] font-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Tool calls
        </div>
        {!hasTools ? (
          <p className="text-[9px] text-slate-500 dark:text-slate-400 leading-snug">
            The model answered without calling search, files, or other agent
            tools (or tools are unavailable on this code path).
          </p>
        ) : (
          <ul className="space-y-1.5">
            {trace!.map((t, i) => (
              <li
                key={`${t.name}-${i}`}
                className="rounded border border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/40 px-2 py-1.5 text-[9px] leading-snug"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <span className="font-label font-bold text-slate-800 dark:text-slate-200">
                    {agentToolLabel(t.name)}
                  </span>
                  <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                    {Math.round(t.ms)} ms
                    {t.bytes ? ` · ${t.bytes} B` : ""}
                    <span
                      className={
                        t.ok
                          ? " text-emerald-600 dark:text-emerald-400"
                          : " text-rose-600 dark:text-rose-400"
                      }
                    >
                      {t.ok ? " · ok" : " · failed"}
                    </span>
                  </span>
                </div>
                {t.args ? (
                  <pre className="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-[8px] text-slate-600 dark:text-slate-400 border-t border-slate-200/80 dark:border-slate-800 pt-1">
                    {t.args}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {stages != null && stages.length > 0 ? (
        <details className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 group">
          <summary className="cursor-pointer text-[9px] font-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 list-none flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <span>Pipeline stages ({stages.length})</span>
            <span className="material-symbols-outlined text-[14px] text-slate-400 group-open:rotate-180 transition-transform">
              expand_more
            </span>
          </summary>
          <ul className="mt-2 space-y-0.5 max-h-40 overflow-y-auto font-mono text-[8px] text-slate-600 dark:text-slate-400">
            {stages.map((s, i) => (
              <li key={`${s.name}-${i}`} className="flex justify-between gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-0.5 last:border-0">
                <span className="min-w-0 truncate" title={s.name}>
                  {reasoningStageLabel(s.name)}
                </span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {Math.round(s.t_ms)} ms
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
