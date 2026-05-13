import { useMemo } from "react";

export type ToolPillStatus = "idle" | "running" | "used" | "error";

/** OpenAI function names — single source for labels and request payload. */
export const AGENT_TOOLS_META: readonly {
  id: string;
  label: string;
  hint: string;
}[] = [
  {
    id: "get_current_time",
    label: "Time",
    hint: "Current time (UTC) for relative dates",
  },
  {
    id: "search_local_docs",
    label: "Local PDFs",
    hint: "Search indexed documents under data/",
  },
  { id: "web_search", label: "Web", hint: "Search the public web" },
  { id: "fetch_url", label: "Fetch URL", hint: "Read a public page" },
  { id: "read_file", label: "Read", hint: "Read a sandbox file" },
  { id: "grep_repo", label: "Grep", hint: "Search file contents" },
  { id: "list_dir", label: "List", hint: "List a directory" },
] as const;

export function defaultAgentToolsEnabled(): Record<string, boolean> {
  return Object.fromEntries(AGENT_TOOLS_META.map((m) => [m.id, true]));
}

export function AgentToolsStatus({
  enabledByTool,
  onToggleTool,
  statusByTool,
  togglesDisabled = false,
}: {
  enabledByTool: Record<string, boolean>;
  onToggleTool: (toolId: string) => void;
  statusByTool: Record<string, ToolPillStatus>;
  /** e.g. while a request is in flight — toggles apply to the next request. */
  togglesDisabled?: boolean;
}) {
  const rows = useMemo(() => {
    return AGENT_TOOLS_META.map((m) => ({
      ...m,
      on: enabledByTool[m.id] !== false,
      s: statusByTool[m.id] ?? "idle",
    }));
  }, [enabledByTool, statusByTool]);

  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[9px] font-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Agent tools
      </span>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            role="switch"
            aria-checked={r.on}
            title={r.hint}
            aria-label={`${r.label}. ${r.hint}. ${r.on ? "Enabled" : "Disabled"} for the next request.`}
            disabled={togglesDisabled}
            onClick={() => onToggleTool(r.id)}
            className={`inline-flex w-full min-h-[2.25rem] items-center justify-center gap-1.5 rounded-lg border-2 px-2 py-1.5 text-center shadow-sm transition-colors ${
              r.on
                ? "border-emerald-500 bg-emerald-100/90 text-emerald-950 hover:bg-emerald-200/95 dark:border-emerald-400 dark:bg-emerald-950/55 dark:text-emerald-50 dark:hover:bg-emerald-900/65"
                : "border-rose-500 bg-rose-100/90 text-rose-950 hover:bg-rose-200/90 dark:border-rose-400 dark:bg-rose-950/50 dark:text-rose-50 dark:hover:bg-rose-900/60"
            } ${togglesDisabled ? "cursor-not-allowed opacity-75" : "cursor-pointer active:scale-[0.98]"}`}
          >
            <span
              className={`h-2 w-2 rounded-full shrink-0 ring-1 ring-black/10 dark:ring-white/10 ${
                r.s === "running"
                  ? "bg-amber-400 animate-pulse"
                  : r.s === "used"
                    ? "bg-emerald-600 dark:bg-emerald-300"
                    : r.s === "error"
                      ? "bg-rose-600 dark:bg-rose-400"
                      : r.on
                        ? "bg-emerald-500 dark:bg-emerald-400"
                        : "bg-rose-500 dark:bg-rose-400"
              }`}
            />
            <span className="text-[9px] font-label font-bold leading-snug text-balance">
              {r.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
