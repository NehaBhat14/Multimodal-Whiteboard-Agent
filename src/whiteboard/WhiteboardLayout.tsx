import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DefaultToolbar, Tldraw, type Editor, type TLComponents } from "tldraw";
import { useTldrawSelectionSpatialPayload as useSelectionPayload } from "../hooks/useTldrawSelectionSpatialPayload";
import { GenerateResponseButton } from "../components/Toolbar/GenerateResponseButton";
import {
  AGENT_TOOLS_META,
  AgentToolsStatus,
  defaultAgentToolsEnabled,
  type ToolPillStatus,
} from "../components/Toolbar/AgentToolsStatus";
import {
  computeOutputPlacementRect,
  planTextLayout,
} from "../lib/layout";
import { computeGeometryFeatures } from "../lib/layout/geometryFeatures";
import { fusePlacementCandidates } from "../lib/layout/fusePlacementCandidates";
import { parseLayoutStyle } from "../lib/layout/parseLayoutStyle";
import { detectDividerIntent } from "../lib/layout/dividerIntent";
import { planColumnContinuation } from "../lib/layout/continuationPlanner";
import { planIntentAwareWrapping } from "../lib/layout/intentAwarePlanner";
import { interpretSemanticLabels } from "../lib/layout/semanticLabelInterpreter";
import { animateTypingTextShape } from "../lib/tldraw/animateTypingTextShape";
import { animateHandwriting } from "../lib/handwriting/animateHandwriting";
import {
  DEFAULT_HANDWRITING_FONT_KEY,
  FONT_CATALOG,
  loadHandwritingFont,
  type HandwritingFontKey,
} from "../lib/handwriting/fontLoader";
import { planResponseHandwriting } from "../lib/handwriting/planResponseHandwriting";
import { planHandwriting } from "../lib/handwriting/textToGlyphStrokes";
import {
  adaptiveViewportCaps,
  computeAdaptivePreferredSize,
  DEFAULT_FONT_SIZE,
} from "../lib/handwriting/fontMetrics";
import {
  AUTO_LANGUAGE_LABEL,
  DEFAULT_LANGUAGE_KEY,
  DEFAULT_RESPONSE_LANGUAGE,
  fontSupportsLanguage,
  LANGUAGE_CATALOG,
  type LanguageKey,
} from "../lib/i18n/languages";
import { resolveAutoLanguageDecision } from "../lib/i18n/autoLanguageDecision";
import { applyCanvasActions } from "../lib/canvasActions/applyCanvasActions";
import { ReasoningTraceSummary } from "../components/reasoning/ReasoningTraceSummary";
import { ModelViewOverlay } from "../components/whiteboard/ModelViewOverlay";
import { deriveEditorSelection } from "../lib/tldraw/editorSelectionAdapter";
import { computeEnclosingBoundingBox } from "../lib/spatial/computeEnclosingBoundingBox";
import {
  aabbStrictlyOverlaps,
  type BoundingBox,
} from "../types/spatial";
import { VLM_REQUEST_SIZE_BUDGET_BYTES } from "../services/payloadBuilder";
import { getApiBaseUrl } from "../services/reasoningApi";
import type { SpatialPayload } from "../types/spatial";
import type {
  ConversationTurn,
  VlmInferenceRequest,
  TokenUsage,
  VlmInferenceResponse,
} from "../types/vlm";
import { CONVERSATION_TEXT_BUDGET_BYTES } from "../lib/reasoning/conversationConstants";
import {
  clearSessionStore,
  loadSession,
  saveSession,
} from "../lib/reasoning/persistSession";
import type {
  ClientRequestStages,
  GenerateResponseVisualState,
} from "../components/Toolbar/GenerateResponseButton";
import type { HybridLayoutAnalysis } from "../lib/layout/hybridTypes";

function useTldrawSelectionSpatialPayload() {
  const [editor, setEditor] = useState<Editor | null>(null);

  const handleMount = useCallback((mountedEditor: Editor) => {
    setEditor(mountedEditor);
  }, []);

  const { payload, selectedShapeIds } = useSelectionPayload(editor);

  return { payload, selectedShapeIds, handleMount, editor };
}

const SUCCESS_FLASH_MS = 1800;

const AGENT_TOOLS_STORAGE_KEY = "agentToolsEnabled";

function loadAgentToolsEnabledFromStorage(): Record<string, boolean> {
  const base = { ...defaultAgentToolsEnabled() };
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(AGENT_TOOLS_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const id of Object.keys(base)) {
      if (typeof parsed[id] === "boolean") base[id] = parsed[id] as boolean;
    }
    return base;
  } catch {
    return base;
  }
}

interface PipelineStages {
  font_load_ms: number;
  placement_ms: number;
  layout_ms: number;
  text_length: number;
  line_count: number;
  truncated: boolean;
  /** SC-003: count of unselected shapes strictly overlapping the placement rect. */
  collisions_count: number;
  placement_side: "below" | "right" | "left" | "above" | "unknown";
  render_total_ms: number;
  font: string;
  language: string;
  /** Normalized `layoutStyle` from the VLM (or "UNKNOWN"). */
  layoutStyle: string;
  /** ISO 639-1 code or "unknown" reported by the VLM. */
  detected_language: string | null;
  detected_script: string | null;
  script_direction: "LTR" | "RTL" | "VERTICAL" | "UNKNOWN";
  intent_hint: "comparison" | "brainstorm" | "notes" | "timeline" | "unknown";
  divider_intent: boolean;
  split_column_context: boolean;
  continuation_mode: "same_column" | "next_column_top" | "truncated";
  vlm_preferred_side: "right" | "left" | "below" | "above" | null;
  vlm_placement_mode: "same_lane" | "cross_divider" | null;
  spatial_confidence: number | null;
  language_selection_source:
    | "manual"
    | "detected"
    | "workspace_dominant"
    | "app_default";
  language_fallback_applied: boolean;
  language_fallback_reason: string | null;
  width_source: "inherited" | "adaptive" | "baseline";
  placement_rect: { x: number; y: number; w: number; h: number };
  out_of_bounds: boolean;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function placementTelemetryFields(
  rect: { x: number; y: number; width: number; height: number },
  viewport: { x: number; y: number; width: number; height: number },
  widthSource: "inherited" | "adaptive" | "baseline",
): Pick<PipelineStages, "width_source" | "placement_rect" | "out_of_bounds"> {
  const eps = 0.5;
  const out =
    rect.x < viewport.x - eps ||
    rect.y < viewport.y - eps ||
    rect.x + rect.width > viewport.x + viewport.width + eps ||
    rect.y + rect.height > viewport.y + viewport.height + eps;
  return {
    width_source: widthSource,
    placement_rect: {
      x: round3(rect.x),
      y: round3(rect.y),
      w: round3(rect.width),
      h: round3(rect.height),
    },
    out_of_bounds: out,
  };
}

async function copyTextToClipboard(text: string): Promise<void> {
  const legacyCopy = (): boolean => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  };

  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to legacy strategy.
    }
  }

  if (legacyCopy()) return;

  // Last-chance fallback for environments where selection APIs are restricted.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  ta.style.pointerEvents = "none";
  document.body.appendChild(ta);
  ta.focus({ preventScroll: true });
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) {
    throw new Error("Clipboard copy failed");
  }
}

type SidebarTab = "reasoning" | "raw";
type TimelineStatus = "pending" | "success" | "error";

type GenerationTimelineEntry = {
  id: string;
  startedAt: string;
  request: VlmInferenceRequest;
  response: VlmInferenceResponse | null;
  responseAt: string | null;
  error: string | null;
  status: TimelineStatus;
};

type BufferTimelineEntry = {
  id: string;
  recordedAt: string;
  requestBytes: number;
  percent: number;
  turnIndex: number;
  conversationBytes: number;
  conversationPercent: number;
  conversationNearWarn: boolean;
};

/** "unknown" means the rect overlaps forbidden (viewport clamp edge case). */
function inferPlacementSide(
  rect: BoundingBox,
  forbidden: BoundingBox,
): "below" | "right" | "left" | "above" | "unknown" {
  if (rect.y >= forbidden.y + forbidden.height) return "below";
  if (rect.x >= forbidden.x + forbidden.width) return "right";
  if (rect.x + rect.width <= forbidden.x) return "left";
  if (rect.y + rect.height <= forbidden.y) return "above";
  return "unknown";
}

function newSessionId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Bounds for explicit shape ids (009 use last selection) — read-only, does not change editor selection. */
function selectionPageBoundsForIds(
  editor: Editor,
  ids: readonly string[],
): { selectedBounds: BoundingBox[]; unselectedBounds: BoundingBox[] } {
  const selectedSet = new Set(ids);
  const toBox = (id: string): BoundingBox | null => {
    const b = editor.getShapePageBounds(id as never);
    if (!b) return null;
    return { x: b.x, y: b.y, width: b.maxX - b.x, height: b.maxY - b.y };
  };
  const allIds = Array.from(
    editor.getCurrentPageShapeIds() as unknown as string[],
  );
  const selectedBounds: BoundingBox[] = [];
  for (const id of ids) {
    const b = toBox(id);
    if (b) selectedBounds.push(b);
  }
  const unselectedBounds: BoundingBox[] = [];
  for (const id of allIds) {
    if (selectedSet.has(id)) continue;
    const b = toBox(id);
    if (b) unselectedBounds.push(b);
  }
  return { selectedBounds, unselectedBounds };
}

function isLikelyDividerProbeRect(rect: BoundingBox): boolean {
  if (rect.height < 80 || rect.width <= 0) return false;
  return rect.width / rect.height <= 0.25;
}

function prioritizeSide(
  candidates: readonly ("below" | "right" | "left" | "above")[],
  preferred: "below" | "right" | "left" | "above" | null,
): ("below" | "right" | "left" | "above")[] {
  if (!preferred) return [...candidates];
  const preferredOrder: ("below" | "right" | "left" | "above")[] =
    preferred === "right"
      ? ["right", "left", "below", "above"]
      : preferred === "left"
        ? ["left", "right", "below", "above"]
        : preferred === "below"
          ? ["below", "right", "left", "above"]
          : ["above", "right", "left", "below"];
  return preferredOrder.filter((side) => candidates.includes(side));
}

function nearestDividerValue(
  values: readonly number[],
  fallback: number | null,
  target: number,
): number | null {
  const pool = values.length > 0 ? values : fallback == null ? [] : [fallback];
  if (pool.length === 0) return null;
  let best = pool[0];
  let bestDistance = Math.abs(best - target);
  for (let i = 1; i < pool.length; i++) {
    const candidate = pool[i];
    const distance = Math.abs(candidate - target);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function surroundingDividers(
  sortedValues: readonly number[],
  target: number,
): { left: number; right: number } | null {
  if (sortedValues.length < 2) return null;
  let left: number | null = null;
  let right: number | null = null;
  for (const value of sortedValues) {
    if (value < target) {
      left = value;
      continue;
    }
    if (value > target) {
      right = value;
      break;
    }
  }
  return left != null && right != null ? { left, right } : null;
}

type ReasonRunClientSnapshot = Pick<
  ClientRequestStages,
  | "export_ms"
  | "base64_ms"
  | "network_ms"
  | "client_total_ms"
  | "request_bytes"
  | "png_bytes"
>;

type ReasonRunRecord = {
  event: "reason_run";
  timestamp: string;
  session_id?: string;
  conversation_bytes?: number;
  client: ReasonRunClientSnapshot;
  server: {
    provider: string;
    inference_ms: number;
    parse_ms: number;
    total_ms: number;
    wall_clock_ms: number;
    overhead_ms: number;
    usage?: TokenUsage | null;
    usage_rounds?: TokenUsage[] | null;
    usage_total?: TokenUsage | null;
  };
  pipeline: PipelineStages | null;
  content: {
    my_response: string;
    what_i_see: string;
  };
  summary: {
    time_to_first_char_ms: number | null;
    end_to_end_ms: number;
  };
  reasoning_mode?: string | null;
  tool_trace_count?: number;
  tool_names?: string[];
};

function postReasonRunLog(record: ReasonRunRecord): void {
  // Fire-and-forget — metrics must never break the main flow.
  void fetch(`${getApiBaseUrl()}/api/v1/metrics/reason_run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
    keepalive: true,
  }).catch(() => {});
}

interface ReasonRunsApi {
  entries: ReasonRunRecord[];
  clear(): void;
  download(filename?: string): void;
  copy(): Promise<void>;
  summary(): void;
}

declare global {
  interface Window {
    __reasonRuns?: ReasonRunsApi;
  }
}

function getReasonRunsStore(): ReasonRunsApi | null {
  if (typeof window === "undefined") return null;
  if (window.__reasonRuns) return window.__reasonRuns;

  const api: ReasonRunsApi = {
    entries: [],
    clear() {
      api.entries.length = 0;
      console.log("[reason_runs] cleared");
    },
    download(filename = "reason_runs.json") {
      const blob = new Blob([JSON.stringify(api.entries, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    async copy() {
      const text = JSON.stringify(api.entries, null, 2);
      await navigator.clipboard.writeText(text);
      console.log(`[reason_runs] copied ${api.entries.length} entries`);
    },
    summary() {
      if (api.entries.length === 0) {
        console.log("[reason_runs] no entries");
        return;
      }
      const pct = (vals: number[], p: number): number => {
        const s = [...vals].sort((a, b) => a - b);
        const k = (s.length - 1) * (p / 100);
        const lo = Math.floor(k);
        const hi = Math.min(lo + 1, s.length - 1);
        return round3(s[lo] + (s[hi] - s[lo]) * (k - lo));
      };
      const pick = (fn: (e: ReasonRunRecord) => number): number[] =>
        api.entries.map(fn);
      const stats = (label: string, vals: number[]) => ({
        metric: label,
        n: vals.length,
        p50: pct(vals, 50),
        p95: pct(vals, 95),
        max: round3(Math.max(...vals)),
      });
      const pipelinesAll = api.entries
        .map((e) => e.pipeline)
        .filter((p): p is PipelineStages => p != null);
      const fontLoadVals = pipelinesAll.map((p) => p.font_load_ms);
      console.table([
        stats("export_ms", pick((e) => e.client.export_ms)),
        stats("network_ms", pick((e) => e.client.network_ms)),
        stats("client_total_ms", pick((e) => e.client.client_total_ms)),
        stats("server_total_ms", pick((e) => e.server.total_ms)),
        stats("font_load_ms", fontLoadVals),
        stats(
          "time_to_first_char_ms",
          pick((e) => e.summary.time_to_first_char_ms ?? 0),
        ),
        stats("end_to_end_ms", pick((e) => e.summary.end_to_end_ms)),
      ]);

      const n = api.entries.length;
      const pipelines = pipelinesAll;
      const sc001Pass = api.entries.filter(
        (e) =>
          e.summary.time_to_first_char_ms != null &&
          e.summary.time_to_first_char_ms < 2000,
      ).length;
      const sc003ZeroCollision = pipelines.filter(
        (p) => p.collisions_count === 0,
      ).length;
      const truncated = pipelines.filter((p) => p.truncated).length;

      const sideCounts: Record<string, number> = {};
      for (const p of pipelines)
        sideCounts[p.placement_side] = (sideCounts[p.placement_side] ?? 0) + 1;
      const fontCounts: Record<string, number> = {};
      for (const p of pipelines)
        fontCounts[p.font] = (fontCounts[p.font] ?? 0) + 1;
      const languageCounts: Record<string, number> = {};
      for (const p of pipelines)
        languageCounts[p.language] = (languageCounts[p.language] ?? 0) + 1;
      const layoutStyleCounts: Record<string, number> = {};
      for (const p of pipelines)
        layoutStyleCounts[p.layoutStyle] =
          (layoutStyleCounts[p.layoutStyle] ?? 0) + 1;
      const detectedLangCounts: Record<string, number> = {};
      for (const p of pipelines) {
        const key = p.detected_language ?? "—";
        detectedLangCounts[key] = (detectedLangCounts[key] ?? 0) + 1;
      }

      console.log(
        `[reason_runs] n=${n}  SC-001 (<2s ttfc): ${sc001Pass}/${n} (${Math.round((100 * sc001Pass) / n)}%)  SC-003 (zero collisions): ${sc003ZeroCollision}/${pipelines.length} (${pipelines.length ? Math.round((100 * sc003ZeroCollision) / pipelines.length) : 0}%)  truncated: ${truncated}/${pipelines.length}`,
      );
      console.log("[reason_runs] placement_side:", sideCounts);
      console.log("[reason_runs] font:", fontCounts);
      console.log("[reason_runs] language:", languageCounts);
      console.log("[reason_runs] layoutStyle:", layoutStyleCounts);
      console.log("[reason_runs] detected_language:", detectedLangCounts);
    },
  };

  window.__reasonRuns = api;
  console.log(
    "[reason_runs] helpers attached: window.__reasonRuns.{entries, summary(), copy(), download(), clear()}",
  );
  return api;
}

function logStageTimings(
  response: VlmInferenceResponse,
  client: ClientRequestStages,
  pipeline: PipelineStages | null,
  sessionId?: string,
): void {
  const backend = response.timings;
  const backend_wall_clock_ms =
    new Date(response.finished_at).getTime() -
    new Date(response.started_at).getTime();

  const server_overhead_ms = round3(
    Math.max(0, backend_wall_clock_ms - backend.total_ms),
  );

  const time_to_first_char_ms =
    pipeline != null
      ? round3(
          client.client_total_ms + pipeline.placement_ms + pipeline.layout_ms,
        )
      : null;

  const end_to_end_ms =
    pipeline != null
      ? round3(client.client_total_ms + pipeline.render_total_ms)
      : round3(client.client_total_ms);

  const clientSnapshot: ReasonRunClientSnapshot = {
    export_ms: client.export_ms,
    base64_ms: client.base64_ms,
    network_ms: client.network_ms,
    client_total_ms: client.client_total_ms,
    request_bytes: client.request_bytes,
    png_bytes: client.png_bytes,
  };
  const record: ReasonRunRecord = {
    event: "reason_run",
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    conversation_bytes: client.conversationBytes,
    client: clientSnapshot,
    server: {
      provider: backend.provider,
      inference_ms: backend.inference_ms,
      parse_ms: backend.parse_ms,
      total_ms: backend.total_ms,
      wall_clock_ms: backend_wall_clock_ms,
      overhead_ms: server_overhead_ms,
      usage: response.usage ?? response.usage_total ?? null,
      usage_rounds: response.usage_rounds ?? null,
      usage_total: response.usage_total ?? null,
    },
    pipeline,
    content: {
      my_response: response.my_response,
      what_i_see: response.what_i_see,
    },
    summary: {
      time_to_first_char_ms,
      end_to_end_ms,
    },
    reasoning_mode: (response as { mode?: string | null }).mode ?? null,
    tool_trace_count: response.tool_trace?.length,
    tool_names: response.tool_trace?.map((t) => t.name).filter(Boolean),
  };

  console.log("[reason_run]", JSON.stringify(record));
  getReasonRunsStore()?.entries.push(record);
  postReasonRunLog(record);
}

export function WhiteboardLayout() {
  const TELEMETRY_MIN_WIDTH_PX = 280;
  const TELEMETRY_MAX_WIDTH_PX = 720;
  const TELEMETRY_DEFAULT_WIDTH_PX = 360;

  const { payload, selectedShapeIds, handleMount, editor } =
    useTldrawSelectionSpatialPayload();
  const [isRequestLoading, setIsRequestLoading] = useState(false);
  const [reasoningResponse, setReasoningResponse] =
    useState<VlmInferenceResponse | null>(null);
  const [reasoningError, setReasoningError] = useState<string | null>(null);
  const [bufferPercent, setBufferPercent] = useState(0);
  const [generateVisual, setGenerateVisual] =
    useState<GenerateResponseVisualState>("idle");
  const [languageKey, setLanguageKey] = useState<LanguageKey | "auto">(() => {
    if (typeof window === "undefined") return DEFAULT_LANGUAGE_KEY;
    const stored = window.localStorage?.getItem("responseLanguageKey");
    if (stored === "auto") return "auto";
    if (stored && stored in LANGUAGE_CATALOG) {
      return stored as LanguageKey;
    }
    return DEFAULT_RESPONSE_LANGUAGE;
  });
  const [handwritingFontKey, setHandwritingFontKey] =
    useState<HandwritingFontKey>(() => {
      if (typeof window === "undefined") return DEFAULT_HANDWRITING_FONT_KEY;
      const stored = window.localStorage?.getItem("handwritingFontKey");
      if (stored && stored in FONT_CATALOG) {
        return stored as HandwritingFontKey;
      }
      return DEFAULT_HANDWRITING_FONT_KEY;
    });
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("reasoning");
  const [showTldrawToolbar, setShowTldrawToolbar] = useState(true);
  const [floatingToolsOpen, setFloatingToolsOpen] = useState(false);
  const [showModelViewOverlay, setShowModelViewOverlay] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage?.getItem("showModelViewOverlay") !== "0";
  });
  const [agentToolsEnabled, setAgentToolsEnabled] = useState<
    Record<string, boolean>
  >(() => loadAgentToolsEnabledFromStorage());
  const [telemetrySidebarOpen, setTelemetrySidebarOpen] = useState(true);
  const [telemetrySidebarWidthPx, setTelemetrySidebarWidthPx] = useState(
    TELEMETRY_DEFAULT_WIDTH_PX,
  );
  const [generationTimeline, setGenerationTimeline] = useState<
    GenerationTimelineEntry[]
  >([]);
  const [bufferTimeline, setBufferTimeline] = useState<BufferTimelineEntry[]>(
    [],
  );
  const [sessionId, setSessionId] = useState<string>(() => newSessionId());
  const [conversationTurns, setConversationTurns] = useState<ConversationTurn[]>([]);
  const [userFollowUpMessage, setUserFollowUpMessage] = useState("");
  const [conversationBufferPercent, setConversationBufferPercent] = useState(0);
  const [conversationNearWarn, setConversationNearWarn] = useState(false);
  const [useLastSelection, setUseLastSelection] = useState(false);
  const [lastSelection, setLastSelection] = useState<{
    selectedShapeIds: readonly string[];
    spatial: SpatialPayload;
  } | null>(null);
  const [forkHint, setForkHint] = useState(false);
  const [agentToolPills, setAgentToolPills] = useState<
    Record<string, ToolPillStatus>
  >({});
  const inFlightRequestSessionIdRef = useRef<string | null>(null);
  const sessionHydratedRef = useRef(false);
  const [copyStateByKey, setCopyStateByKey] = useState<
    Record<string, "idle" | "success" | "error">
  >({});
  const copyResetTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const pendingTimelineEntryIdRef = useRef<string | null>(null);
  const [autoLanguageHint, setAutoLanguageHint] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const resizeStateRef = useRef<{
    active: boolean;
    startX: number;
    startWidth: number;
    moved: boolean;
  }>({
    active: false,
    startX: 0,
    startWidth: 0,
    moved: false,
  });
  const suppressDividerClickRef = useRef(false);

  const tldrawComponents = useMemo((): TLComponents => {
    return { Toolbar: showTldrawToolbar ? DefaultToolbar : null };
  }, [showTldrawToolbar]);

  const typingRunRef = useRef<AbortController | null>(null);
  const successResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Fonts whose declared `scripts` cover every script the language requires.
   * When language is "auto", show every font — `planResponseHandwriting`
   * picks the right one from the actual response script at render time.
   */
  const availableFontKeys = useMemo<HandwritingFontKey[]>(() => {
    const allKeys = Object.keys(FONT_CATALOG) as HandwritingFontKey[];
    const keys =
      languageKey === "auto"
        ? allKeys
        : allKeys.filter((key) =>
            fontSupportsLanguage(FONT_CATALOG[key].scripts, languageKey),
          );
    return keys.sort((a, b) => {
      const ah = FONT_CATALOG[a].isHandwriting ? 0 : 1;
      const bh = FONT_CATALOG[b].isHandwriting ? 0 : 1;
      return ah - bh;
    });
  }, [languageKey]);

  const requestLayoutAnalysis = useMemo<HybridLayoutAnalysis | undefined>(() => {
    if (!payload) return undefined;
    return {
      layout_style: "UNKNOWN",
      intent_hint: "unknown",
      script_direction: "UNKNOWN",
      detected_language: "unknown",
      detected_script: "unknown",
      language_confidence: 0,
      divider_intent: false,
      split_column_context: false,
      width_profile: {
        w_avg: payload.width,
        min_width: payload.width,
        max_width: payload.width,
        sample_count: Math.max(1, selectedShapeIds.length),
      },
    };
  }, [payload, selectedShapeIds.length]);

  useEffect(() => {
    // Diagnostic: more than one mount log per page load = something is
    // remounting WhiteboardLayout and resetting the tldraw canvas.
    const mountId = Math.random().toString(36).slice(2, 8);
    console.log(`[WhiteboardLayout] mounted (${mountId})`);

    for (const key of Object.keys(FONT_CATALOG) as HandwritingFontKey[]) {
      const entry = FONT_CATALOG[key];
      const subsets = (entry as { subsets?: Readonly<Record<string, string>> })
        .subsets;
      const scripts = subsets ? ["latin", ...Object.keys(subsets)] : ["latin"];
      for (const script of scripts) {
        loadHandwritingFont(key, script).catch((err) => {
          console.warn(`[handwriting] preload failed for "${key}::${script}"`, err);
        });
      }
    }
    return () => {
      console.log(`[WhiteboardLayout] unmounted (${mountId})`);
      typingRunRef.current?.abort();
      for (const timer of Object.values(copyResetTimersRef.current)) {
        clearTimeout(timer);
      }
      copyResetTimersRef.current = {};
      if (successResetRef.current) {
        clearTimeout(successResetRef.current);
      }
    };
  }, []);

  useEffect(() => {
    getReasonRunsStore();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage?.setItem("handwritingFontKey", handwritingFontKey);
    } catch {}
  }, [handwritingFontKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage?.setItem("responseLanguageKey", languageKey);
    } catch {}
  }, [languageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage?.setItem(
        "showModelViewOverlay",
        showModelViewOverlay ? "1" : "0",
      );
    } catch {
      /* */
    }
  }, [showModelViewOverlay]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        AGENT_TOOLS_STORAGE_KEY,
        JSON.stringify(agentToolsEnabled),
      );
    } catch {
      /* */
    }
  }, [agentToolsEnabled]);

  const enabledAgentToolIds = useMemo(
    () =>
      AGENT_TOOLS_META.filter((m) => agentToolsEnabled[m.id] !== false).map(
        (m) => m.id,
      ),
    [agentToolsEnabled],
  );

  const toggleAgentTool = useCallback((toolId: string) => {
    setAgentToolsEnabled((prev) => {
      const curOn = prev[toolId] !== false;
      return { ...prev, [toolId]: !curOn };
    });
  }, []);

  // Auto-switch font when language changes to one the current font can't cover.
  useEffect(() => {
    if (availableFontKeys.length === 0) return;
    if (!availableFontKeys.includes(handwritingFontKey)) {
      const next = availableFontKeys[0];
      console.log(
        `[handwriting] auto-switching font: "${handwritingFontKey}" doesn't cover ${languageKey}, using "${next}"`,
      );
      setHandwritingFontKey(next);
    }
  }, [availableFontKeys, handwritingFontKey, languageKey]);

  useEffect(() => {
    if (sessionHydratedRef.current) return;
    sessionHydratedRef.current = true;
    const s = loadSession();
    if (s) {
      setSessionId(s.sessionId);
      setConversationTurns(s.turns);
      if (s.lastSelection) {
        setLastSelection({
          selectedShapeIds: s.lastSelection.selectedShapeIds,
          spatial: s.lastSelection.spatial,
        });
      }
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        saveSession({
          v: 1,
          sessionId,
          turns: conversationTurns,
          lastSelection: lastSelection
            ? {
                selectedShapeIds: [...lastSelection.selectedShapeIds],
                spatial: { ...lastSelection.spatial },
              }
            : null,
        });
      } catch {
        /* */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [sessionId, conversationTurns, lastSelection]);

  const handleRequestSizeBytes = useCallback(
    (bytes: number) => {
      setBufferPercent(
        Math.min(100, Math.round((100 * bytes) / VLM_REQUEST_SIZE_BUDGET_BYTES)),
      );
    },
    [],
  );

  const handleRequestSizeMetrics = useCallback(
    (m: {
      wireBytes: number;
      conversationBytes: number;
      turnIndex: number;
      conversationNearBudget: boolean;
    }) => {
      setBufferPercent(
        Math.min(
          100,
          Math.round((100 * m.wireBytes) / VLM_REQUEST_SIZE_BUDGET_BYTES),
        ),
      );
      setConversationBufferPercent(
        Math.min(
          100,
          Math.round(
            (100 * m.conversationBytes) / CONVERSATION_TEXT_BUDGET_BYTES,
          ),
        ),
      );
      setConversationNearWarn(m.conversationNearBudget);
      setBufferTimeline((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          recordedAt: new Date().toISOString(),
          requestBytes: m.wireBytes,
          percent: Math.min(
            100,
            Math.round((100 * m.wireBytes) / VLM_REQUEST_SIZE_BUDGET_BYTES),
          ),
          turnIndex: m.turnIndex,
          conversationBytes: m.conversationBytes,
          conversationPercent: Math.min(
            100,
            Math.round(
              (100 * m.conversationBytes) / CONVERSATION_TEXT_BUDGET_BYTES,
            ),
          ),
          conversationNearWarn: m.conversationNearBudget,
        },
        ...prev,
      ]);
    },
    [],
  );

  const handleRequestStart = useCallback(() => {
    inFlightRequestSessionIdRef.current = sessionId;
    setIsRequestLoading(true);
    setReasoningError(null);
    setGenerateVisual("loading");
    setAgentToolPills({});
  }, [sessionId]);

  const handleStreamToolPill = useCallback((name: string) => {
    setAgentToolPills((prev) => ({ ...prev, [name]: "used" }));
  }, []);

  const handleRequestBuilt = useCallback((request: VlmInferenceRequest) => {
    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date().toISOString();
    pendingTimelineEntryIdRef.current = entryId;
    setGenerationTimeline((prev) => [
      {
        id: entryId,
        startedAt,
        request,
        response: null,
        responseAt: null,
        error: null,
        status: "pending",
      },
      ...prev,
    ]);
  }, []);

  const handleRequestSuccess = useCallback(
    (response: VlmInferenceResponse, stages?: ClientRequestStages) => {
      const hasCanvas =
        (response.canvasActions && response.canvasActions.length > 0) ?? false;
      setIsRequestLoading(false);
      setReasoningResponse(response);
      setReasoningError(null);
      setGenerateVisual("success");
      const responseAt = new Date().toISOString();
      const pendingId = pendingTimelineEntryIdRef.current;
      if (pendingId) {
        setGenerationTimeline((prev) =>
          prev.map((entry) =>
            entry.id === pendingId
              ? {
                  ...entry,
                  response,
                  responseAt,
                  error: null,
                  status: "success",
                }
              : entry,
          ),
        );
        pendingTimelineEntryIdRef.current = null;
      }
      if (successResetRef.current) {
        clearTimeout(successResetRef.current);
      }
      successResetRef.current = setTimeout(() => {
        setGenerateVisual("idle");
        successResetRef.current = null;
      }, SUCCESS_FLASH_MS);

      if (inFlightRequestSessionIdRef.current !== null) {
        if (
          sessionId === inFlightRequestSessionIdRef.current &&
          (response.my_response || hasCanvas) &&
          stages
        ) {
          setConversationTurns((prev) => [
            ...prev,
            {
              at: responseAt,
              whatISee: response.what_i_see,
              myResponse: response.my_response ?? "",
              selectionRef: {
                x: stages.request.spatial.x,
                y: stages.request.spatial.y,
                width: stages.request.spatial.width,
                height: stages.request.spatial.height,
              },
            },
          ]);
          setLastSelection({
            selectedShapeIds: [...stages.effectiveSelectedShapeIds],
            spatial: {
              x: stages.request.spatial.x,
              y: stages.request.spatial.y,
              width: stages.request.spatial.width,
              height: stages.request.spatial.height,
            },
          });
          setUserFollowUpMessage("");
        }
        inFlightRequestSessionIdRef.current = null;
      }

      if (!editor) {
        if (stages) logStageTimings(response, stages, null, sessionId);
        return;
      }
      if (!response.my_response && !hasCanvas) {
        if (stages) logStageTimings(response, stages, null, sessionId);
        return;
      }

      const useStoredSelectionForPlacement =
        Boolean(
          stages?.usedLastSelection && stages.effectiveSelectedShapeIds.length > 0,
        );
      const { selectedBounds, unselectedBounds } = useStoredSelectionForPlacement
        ? selectionPageBoundsForIds(
            editor,
            stages!.effectiveSelectedShapeIds,
          )
        : deriveEditorSelection(editor);
      if (
        !useStoredSelectionForPlacement &&
        (!payload || selectedShapeIds.length === 0)
      ) {
        if (
          hasCanvas &&
          response.canvasActions?.length &&
          stages &&
          editor
        ) {
          const view = editor.getViewportPageBounds();
          const vp = {
            x: view.x,
            y: view.y,
            width: view.w,
            height: view.h,
          };
          const sp = stages.request.spatial;
          const m = 8;
          applyCanvasActions(editor, response.canvasActions, {
            forbidden: {
              x: sp.x - m,
              y: sp.y - m,
              width: sp.width + 2 * m,
              height: sp.height + 2 * m,
            },
            obstacles: [],
            viewport: vp,
            gap: 16,
          });
        }
        if (stages) logStageTimings(response, stages, null, sessionId);
        return;
      }
      if (useStoredSelectionForPlacement && selectedBounds.length === 0) {
        if (
          hasCanvas &&
          response.canvasActions?.length &&
          stages &&
          editor
        ) {
          const view = editor.getViewportPageBounds();
          const vp = {
            x: view.x,
            y: view.y,
            width: view.w,
            height: view.h,
          };
          const sp = stages.request.spatial;
          const m = 8;
          applyCanvasActions(editor, response.canvasActions, {
            forbidden: {
              x: sp.x - m,
              y: sp.y - m,
              width: sp.width + 2 * m,
              height: sp.height + 2 * m,
            },
            obstacles: [],
            viewport: vp,
            gap: 16,
          });
        }
        if (stages) logStageTimings(response, stages, null, sessionId);
        return;
      }

      const strictBBox = computeEnclosingBoundingBox(selectedBounds);
      const view = editor.getViewportPageBounds();
      const viewport = {
        x: view.x,
        y: view.y,
        width: view.w,
        height: view.h,
      };

      const forbiddenMargin = 8;
      const forbidden = {
        x: strictBBox.x - forbiddenMargin,
        y: strictBBox.y - forbiddenMargin,
        width: strictBBox.width + 2 * forbiddenMargin,
        height: strictBBox.height + 2 * forbiddenMargin,
      };

      typingRunRef.current?.abort();
      const ac = new AbortController();
      typingRunRef.current = ac;
      const renderStart = performance.now();

      const activeFontKey = handwritingFontKey;

      // Placement-context inputs. `fusePlacementCandidates` soft-reorders the
      // candidate sides based on layout style (from VLM) + geometry hints.
      const baselineCandidates = ["below", "right", "left", "above"] as const;
      const semantic = interpretSemanticLabels(response);
      const normalizedLayoutStyle = semantic.layoutStyle;
      const geometryFeatures = computeGeometryFeatures(selectedBounds);
      const selectionRects = selectedBounds.map((b) => ({
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      }));
      const dividerProbeRects = [
        ...selectionRects,
        ...unselectedBounds.filter(isLikelyDividerProbeRect),
      ];
      const dividerIntent = detectDividerIntent(dividerProbeRects);
      const fusedCandidates = fusePlacementCandidates({
        candidates: baselineCandidates,
        layoutStyle: normalizedLayoutStyle,
        geometryFeatures,
        // Not currently deriving inherited width or per-side wMax from the
        // editor — both helpers default gracefully when omitted.
        inheritedWidth: null,
        wMaxBySide: {},
      }).orderedSides;
      const selectionCenterX = strictBBox.x + strictBBox.width / 2;
      const selectionCenterY = strictBBox.y + strictBBox.height / 2;
      const nearestVerticalDividerX = nearestDividerValue(
        dividerIntent.verticalDividerXs,
        dividerIntent.dividerX,
        selectionCenterX,
      );
      const nearestHorizontalDividerY = nearestDividerValue(
        dividerIntent.horizontalDividerYs,
        dividerIntent.dividerY,
        selectionCenterY,
      );
      const boundedVerticalColumn = surroundingDividers(
        dividerIntent.verticalDividerXs,
        selectionCenterX,
      );
      const dividerPreferredSide =
        boundedVerticalColumn
          ? "below"
          : dividerIntent.splitColumnContext
            ? "below"
          : dividerIntent.dividerIntent &&
              typeof nearestHorizontalDividerY === "number"
            ? selectionCenterY < nearestHorizontalDividerY
              ? "below"
              : "above"
          : null;
      const vlmPreferredSide =
        semantic.spatialConfidence >= 0.55 ? semantic.preferredSide : null;
      const vlmPlacementMode =
        semantic.spatialConfidence >= 0.45 ? semantic.placementMode : null;
      let effectivePreferredSide: "right" | "left" | "below" | "above" | null =
        vlmPlacementMode === "same_lane"
          ? "below"
          : vlmPlacementMode === "cross_divider"
            ? (vlmPreferredSide ?? dividerPreferredSide)
            : (vlmPreferredSide ?? dividerPreferredSide);
      let promotedCrossLaneOverflow = false;
      // Geometry safety net: if VLM stays conservative (`same_lane` / `below`)
      // but the selected lane is already near the bottom and the opposite lane's
      // upper half is clearly open, promote to cross-divider overflow behavior.
      const likelySameLaneBelow =
        (vlmPlacementMode === "same_lane" || vlmPlacementMode === null) &&
        (vlmPreferredSide === null || vlmPreferredSide === "below");
      const selectionBottom = forbidden.y + forbidden.height;
      const selectionNearBottom =
        selectionBottom > viewport.y + viewport.height * 0.72;
      if (
        likelySameLaneBelow &&
        selectionNearBottom &&
        dividerIntent.splitColumnContext &&
        typeof nearestVerticalDividerX === "number"
      ) {
        const targetSide: "right" | "left" =
          selectionCenterX < nearestVerticalDividerX ? "right" : "left";
        const targetLaneLeft =
          targetSide === "right" ? nearestVerticalDividerX + forbiddenMargin : viewport.x;
        const targetLaneRight =
          targetSide === "right"
            ? viewport.x + viewport.width
            : nearestVerticalDividerX - forbiddenMargin;
        const topBandBottom = viewport.y + viewport.height * 0.45;
        const topLaneBlocked = unselectedBounds.some((b) => {
          // Ignore thin guide strokes (arrows/dividers) for occupancy checks.
          if (Math.min(b.width, b.height) < 24) return false;
          const bRight = b.x + b.width;
          const bBottom = b.y + b.height;
          return (
            bRight > targetLaneLeft &&
            b.x < targetLaneRight &&
            bBottom > viewport.y &&
            b.y < topBandBottom
          );
        });
        if (!topLaneBlocked) {
          effectivePreferredSide = targetSide;
          promotedCrossLaneOverflow = true;
        }
      }
      const placementForbidden =
        effectivePreferredSide === "right" &&
        typeof nearestVerticalDividerX === "number" &&
        nearestVerticalDividerX > forbidden.x + forbidden.width
          ? {
              ...forbidden,
              width: Math.max(
                forbidden.width,
                nearestVerticalDividerX - forbidden.x + forbiddenMargin,
              ),
            }
          : effectivePreferredSide === "left" &&
              typeof nearestVerticalDividerX === "number" &&
              nearestVerticalDividerX < forbidden.x
            ? {
                x: Math.min(forbidden.x, nearestVerticalDividerX - forbiddenMargin),
                y: forbidden.y,
                width:
                  forbidden.x +
                  forbidden.width -
                  Math.min(forbidden.x, nearestVerticalDividerX - forbiddenMargin),
                height: forbidden.height,
              }
            : effectivePreferredSide === "below" &&
                typeof nearestHorizontalDividerY === "number" &&
                nearestHorizontalDividerY > forbidden.y + forbidden.height
              ? {
                  ...forbidden,
                  height: Math.max(
                    forbidden.height,
                    nearestHorizontalDividerY - forbidden.y + forbiddenMargin,
                  ),
                }
              : effectivePreferredSide === "above" &&
                  typeof nearestHorizontalDividerY === "number" &&
                  nearestHorizontalDividerY < forbidden.y
                ? {
                    x: forbidden.x,
                    y: Math.min(
                      forbidden.y,
                      nearestHorizontalDividerY - forbiddenMargin,
                    ),
                    width: forbidden.width,
                    height:
                      forbidden.y +
                      forbidden.height -
                      Math.min(
                        forbidden.y,
                        nearestHorizontalDividerY - forbiddenMargin,
                      ),
                  }
                : forbidden;
      const placementCandidates = prioritizeSide(
        fusedCandidates,
        effectivePreferredSide,
      );
      // Cross-lane placements (right/left) should anchor to the TOP of the
      // target lane (newspaper column reading order), not parallel to the
      // selection. The user-visible symptom of the old behavior: selecting a
      // question at the BOTTOM of the left lane placed the answer at the
      // BOTTOM of the right lane — instead of at the top, which is where the
      // user drew their "Text should be here" arrow.
      //
      // We trigger anchor-top whenever the chosen side is right/left AND
      // there's any cross-divider signal: explicit VLM `cross_divider`, a
      // detected vertical divider between selection and target lane, or a
      // split-column context. Grid search / column-scan will still step
      // downward from the anchor to dodge any obstacles.
      const isCrossLaneSide =
        effectivePreferredSide === "right" || effectivePreferredSide === "left";
      const hasVerticalDividerBetween =
        typeof nearestVerticalDividerX === "number" &&
        ((effectivePreferredSide === "right" &&
          nearestVerticalDividerX > forbidden.x + forbidden.width) ||
          (effectivePreferredSide === "left" &&
            nearestVerticalDividerX < forbidden.x));
      const sideAnchorY =
        isCrossLaneSide &&
        (vlmPlacementMode === "cross_divider" ||
          promotedCrossLaneOverflow ||
          hasVerticalDividerBetween ||
          dividerIntent.splitColumnContext)
          ? viewport.y
          : undefined;
      const forceTopOfTargetLane =
        typeof sideAnchorY === "number" &&
        (vlmPlacementMode === "cross_divider" || promotedCrossLaneOverflow) &&
        semantic.spatialConfidence >= 0.7;
      // When users draw arrows/divider guides, those strokes are usually thin
      // line-like shapes. Treating them as hard placement obstacles can force
      // cross-divider answers down to the selection's Y-level even when the
      // intended target is the top of the adjacent lane.
      const baselineObstacles =
        typeof sideAnchorY === "number"
          ? unselectedBounds.filter((b) => Math.min(b.width, b.height) >= 24)
          : unselectedBounds;

      let canvasPlacedBounds: BoundingBox[] = [];
      if (hasCanvas && response.canvasActions && response.canvasActions.length > 0) {
        const result = applyCanvasActions(editor, response.canvasActions, {
          forbidden: placementForbidden,
          obstacles: baselineObstacles,
          viewport,
          gap: 16,
        });
        canvasPlacedBounds = result.placedBounds;
      }

      // Feed diagram rects back so the handwriting answer does not collide with them.
      const placementObstacles =
        canvasPlacedBounds.length > 0
          ? [...baselineObstacles, ...canvasPlacedBounds]
          : baselineObstacles;

      // Handwriting needs my_response; canvas-only turns stop here.
      if (!response.my_response) {
        if (stages) logStageTimings(response, stages, null, sessionId);
        return;
      }

      const languageDecision = resolveAutoLanguageDecision({
        selectedMode: languageKey,
        detectedLanguage: semantic.detectedLanguage,
        detectedScript: semantic.detectedScript,
        confidence:
          typeof response.language_confidence === "number"
            ? (response.language_confidence ?? 0)
            : semantic.detectedLanguage === "unknown"
              ? 0
              : 0.9,
        workspaceDominantLanguage: DEFAULT_LANGUAGE_KEY,
        appDefaultLanguage: DEFAULT_LANGUAGE_KEY,
      });
      const detectedLanguage =
        semantic.detectedLanguage === "unknown" ? null : semantic.detectedLanguage;
      setAutoLanguageHint(
        languageDecision.showFallbackHint
          ? `Auto fallback: ${languageDecision.source}`
          : null,
      );

      // Load font first so adaptive sizing can measure real glyph advances.
      // On font-load failure we fall through to the typewriter branch.
      void (async () => {
        const pipelineStages: PipelineStages = {
          font_load_ms: 0,
          placement_ms: 0,
          layout_ms: 0,
          text_length: response.my_response.length,
          line_count: 1,
          truncated: false,
          collisions_count: 0,
          placement_side: "unknown",
          render_total_ms: 0,
          font: activeFontKey,
          language: languageDecision.selectedLanguage,
          layoutStyle: normalizedLayoutStyle,
          detected_language: detectedLanguage,
          detected_script:
            semantic.detectedScript === "unknown" ? null : semantic.detectedScript,
          script_direction: semantic.scriptDirection,
          intent_hint: semantic.intentHint,
          divider_intent: dividerIntent.dividerIntent,
          split_column_context: dividerIntent.splitColumnContext,
          continuation_mode: "same_column",
          vlm_preferred_side: semantic.preferredSide,
          vlm_placement_mode: semantic.placementMode,
          spatial_confidence:
            semantic.spatialConfidence > 0 ? semantic.spatialConfidence : null,
          language_selection_source: languageDecision.source,
          language_fallback_applied: languageDecision.fallbackApplied,
          language_fallback_reason: languageDecision.fallbackReason,
          width_source: "adaptive",
          placement_rect: { x: 0, y: 0, w: 0, h: 0 },
          out_of_bounds: false,
        };

        const runTypewriterFallback = async (): Promise<void> => {
          // Fixed preferredSize — no font to measure; matches former catch path.
          const placementStart = performance.now();
          let outputPlacement = computeOutputPlacementRect({
            forbidden: placementForbidden,
            preferredSize: { width: 900, height: 120 },
            gap: 16,
            candidates: placementCandidates,
            obstacles: placementObstacles,
            viewport,
            sideAnchorY,
          });
          if (forceTopOfTargetLane) {
            outputPlacement = {
              ...outputPlacement,
              y: viewport.y,
            };
          }
          pipelineStages.placement_ms = round3(
            performance.now() - placementStart,
          );
          pipelineStages.collisions_count = unselectedBounds.filter((b) =>
            aabbStrictlyOverlaps(outputPlacement, b),
          ).length;
          pipelineStages.placement_side = inferPlacementSide(
            outputPlacement,
            placementForbidden,
          );
          Object.assign(
            pipelineStages,
            placementTelemetryFields(outputPlacement, viewport, "baseline"),
          );

          const layoutStart = performance.now();
          const intentPlan = planIntentAwareWrapping({
            layoutStyle: normalizedLayoutStyle,
            intentHint: semantic.intentHint,
          });
          const plan = planTextLayout({
            placement: outputPlacement,
            text: response.my_response,
            maxLines: intentPlan.maxLines,
            maxChars: intentPlan.maxChars,
          });
          pipelineStages.layout_ms = round3(performance.now() - layoutStart);
          pipelineStages.text_length = plan.textShapeProps.text.length;
          pipelineStages.line_count = plan.lineCount;
          pipelineStages.truncated = plan.truncated;
          pipelineStages.continuation_mode = planColumnContinuation({
            overflowDetected: plan.truncated,
            currentColumnIndex: 0,
            availableColumnCount: dividerIntent.splitColumnContext ? 2 : 1,
            scriptDirection: semantic.scriptDirection,
          }).continuationMode;

          try {
            await animateTypingTextShape(editor, plan, { signal: ac.signal });
          } catch (e2) {
            if (e2 instanceof DOMException && e2.name === "AbortError") return;
            console.error("typewriter fallback failed", e2);
            return;
          }
        };

        // planResponseHandwriting only uses languageKey as a script fallback
        // for non-Devanagari responses. "auto" has no canonical script, so
        // coerce to the default — script detection then runs on the response.
        const scriptFallbackLanguage: LanguageKey =
          languageKey === "auto" ? DEFAULT_LANGUAGE_KEY : languageKey;
        const hwPlan = planResponseHandwriting(
          response.my_response,
          scriptFallbackLanguage,
          activeFontKey,
        );
        if (hwPlan.mode === "typewriter") {
          await runTypewriterFallback();
        } else {
          try {
            const renderFontKey = hwPlan.fontKey;
            const fontLoadStart = performance.now();
            const font = await loadHandwritingFont(
              renderFontKey,
              hwPlan.opentypeScript,
            );
            pipelineStages.font_load_ms = round3(
              performance.now() - fontLoadStart,
            );
            pipelineStages.font = renderFontKey;

            const layoutStart = performance.now();
            const caps = adaptiveViewportCaps({
              width: viewport.width,
              height: viewport.height,
            });
            const adaptive = computeAdaptivePreferredSize({
              font,
              text: response.my_response,
              fontSize: DEFAULT_FONT_SIZE,
              maxWidth: caps.maxWidth,
              maxHeight: caps.maxHeight,
            });
            pipelineStages.layout_ms = round3(performance.now() - layoutStart);
            pipelineStages.text_length = response.my_response.length;
            pipelineStages.line_count = adaptive.wrappedLines.length;
            pipelineStages.truncated = adaptive.truncated;
            pipelineStages.continuation_mode = planColumnContinuation({
              overflowDetected: adaptive.truncated,
              currentColumnIndex: 0,
              availableColumnCount: dividerIntent.splitColumnContext ? 2 : 1,
              scriptDirection: semantic.scriptDirection,
            }).continuationMode;

            const placementStart = performance.now();
            let outputPlacement = computeOutputPlacementRect({
              forbidden: placementForbidden,
              preferredSize: adaptive.preferredSize,
              gap: 16,
              candidates: placementCandidates,
              obstacles: placementObstacles,
              viewport,
              sideAnchorY,
            });
            if (forceTopOfTargetLane) {
              outputPlacement = {
                ...outputPlacement,
                y: viewport.y,
              };
            }
            pipelineStages.placement_ms = round3(
              performance.now() - placementStart,
            );
            pipelineStages.collisions_count = unselectedBounds.filter((b) =>
              aabbStrictlyOverlaps(outputPlacement, b),
            ).length;
            pipelineStages.placement_side = inferPlacementSide(
              outputPlacement,
              placementForbidden,
            );
            const widthSrc: "inherited" | "adaptive" =
              (requestLayoutAnalysis?.split_column_context ?? false) &&
              normalizedLayoutStyle === "COLUMNAR"
                ? "inherited"
                : "adaptive";
            Object.assign(
              pipelineStages,
              placementTelemetryFields(outputPlacement, viewport, widthSrc),
            );

            const strokePlan = planHandwriting({
              text: response.my_response,
              font,
              placement: outputPlacement,
              fontSize: adaptive.fontSize,
              lineHeight: adaptive.lineHeight,
              preWrappedLines: adaptive.wrappedLines,
            });
            pipelineStages.text_length = strokePlan.textLength;
            pipelineStages.line_count = strokePlan.lineCount;
            pipelineStages.truncated = strokePlan.truncated;

            await animateHandwriting(editor, strokePlan, {
              signal: ac.signal,
              strokeScale: FONT_CATALOG[renderFontKey].strokeScale,
            });
          } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") return;
            console.warn("[handwriting] falling back to typewriter:", e);
            await runTypewriterFallback();
          }
        }
        pipelineStages.render_total_ms = round3(performance.now() - renderStart);
        if (stages) logStageTimings(response, stages, pipelineStages, sessionId);
      })();
    },
    [
      editor,
      payload,
      selectedShapeIds,
      handwritingFontKey,
      languageKey,
      sessionId,
      requestLayoutAnalysis,
    ],
  );

  const handleRequestError = useCallback((errorMessage: string) => {
    setIsRequestLoading(false);
    setReasoningError(errorMessage);
    setGenerateVisual("error");
    const pendingId = pendingTimelineEntryIdRef.current;
    if (!pendingId) return;
    setGenerationTimeline((prev) =>
      prev.map((entry) =>
        entry.id === pendingId
          ? { ...entry, error: errorMessage, status: "error" }
          : entry,
      ),
    );
    pendingTimelineEntryIdRef.current = null;
  }, []);

  const handleNewChat = useCallback(() => {
    clearSessionStore();
    setSessionId(newSessionId());
    setConversationTurns([]);
    setUserFollowUpMessage("");
    setUseLastSelection(false);
    setLastSelection(null);
    inFlightRequestSessionIdRef.current = null;
    setForkHint(false);
  }, []);

  const handleDividerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!telemetrySidebarOpen) return;
      const pointerId = e.pointerId;
      e.currentTarget.setPointerCapture(pointerId);

      resizeStateRef.current = {
        active: true,
        startX: e.clientX,
        startWidth: telemetrySidebarWidthPx,
        moved: false,
      };

      const onPointerMove = (ev: PointerEvent) => {
        if (!resizeStateRef.current.active) return;
        const mainEl = mainRef.current;
        if (!mainEl) return;
        const deltaX = resizeStateRef.current.startX - ev.clientX;
        if (Math.abs(deltaX) > 2) {
          resizeStateRef.current.moved = true;
        }
        const maxFromViewport = Math.max(
          TELEMETRY_MIN_WIDTH_PX,
          Math.min(
            TELEMETRY_MAX_WIDTH_PX,
            mainEl.clientWidth - TELEMETRY_MIN_WIDTH_PX,
          ),
        );
        const next = Math.max(
          TELEMETRY_MIN_WIDTH_PX,
          Math.min(maxFromViewport, resizeStateRef.current.startWidth + deltaX),
        );
        setTelemetrySidebarWidthPx(next);
      };

      const finish = () => {
        suppressDividerClickRef.current = resizeStateRef.current.moved;
        resizeStateRef.current.active = false;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", finish);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", finish);
    },
    [telemetrySidebarOpen, telemetrySidebarWidthPx],
  );

  const handleDividerClick = useCallback(() => {
    if (suppressDividerClickRef.current) {
      suppressDividerClickRef.current = false;
      return;
    }
    setTelemetrySidebarOpen(false);
  }, []);

  const handleCopy = useCallback(async (key: string, text: string) => {
    try {
      await copyTextToClipboard(text);
      setCopyStateByKey((prev) => ({ ...prev, [key]: "success" }));
    } catch (error) {
      console.warn("[telemetry] copy failed", error);
      setCopyStateByKey((prev) => ({ ...prev, [key]: "error" }));
    } finally {
      const existing = copyResetTimersRef.current[key];
      if (existing) clearTimeout(existing);
      copyResetTimersRef.current[key] = setTimeout(() => {
        setCopyStateByKey((prev) => ({ ...prev, [key]: "idle" }));
        delete copyResetTimersRef.current[key];
      }, 1600);
    }
  }, []);

  return (
    <div className="bg-surface text-on-surface font-body overflow-hidden h-screen flex flex-col">
      <header className="bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 flex justify-between items-center w-full px-6 h-14 z-50">
        <div className="flex items-center gap-3">
          <div className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 font-headline">
            Technical Atelier
          </div>
          <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-[10px] font-mono rounded text-slate-500 uppercase tracking-widest border border-slate-200/50">
            v0.4.2
          </span>
        </div>
        <div className="hidden md:flex items-center gap-8 h-full">
          <span className="text-slate-900 dark:text-slate-100 border-b-2 border-slate-900 dark:border-slate-100 h-full flex items-center font-medium text-sm transition-all duration-150">
            Project
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button className="material-symbols-outlined p-2 hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
            settings
          </button>
          <button className="material-symbols-outlined p-2 hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
            help
          </button>
          <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center overflow-hidden">
            <span className="material-symbols-outlined text-slate-500">
              account_circle
            </span>
          </div>
        </div>
      </header>

      <main ref={mainRef} className="flex-grow flex overflow-hidden relative">
        <section
          className="relative h-full min-w-0 dot-grid bg-white overflow-hidden flex-1"
          id="whiteboard-canvas"
        >
          <div className="absolute inset-0">
            <Tldraw onMount={handleMount} components={tldrawComponents} />
            <ModelViewOverlay
              editor={editor}
              answerCrop={payload}
              showAnswerCrop={Boolean(payload && selectedShapeIds.length > 0)}
              show={showModelViewOverlay && isRequestLoading}
            />
          </div>
          <div className="pointer-events-none absolute inset-0 z-[10050] flex flex-col justify-end items-end pb-3 pr-3 sm:pb-4 sm:pr-4">
            <div className="pointer-events-auto flex flex-col items-end gap-0">
              {floatingToolsOpen ? (
                <div className="w-[min(22rem,calc(100vw-1.5rem))] max-h-[min(85vh,calc(100vh-3.5rem))] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 shadow-lg backdrop-blur-sm px-3 py-2 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-700/80 pb-1.5 shrink-0">
                    <span className="font-label text-[9px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">
                      Tools
                    </span>
                    <button
                      type="button"
                      aria-label="Close"
                      onClick={() => setFloatingToolsOpen(false)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-[1.125rem] leading-none font-light"
                    >
                      ×
                    </button>
                  </div>

                  {/* Primary: generate + agent tools (no scrolling past this for the main action) */}
                  <div className="flex flex-col gap-1.5 rounded-lg border border-slate-200/90 dark:border-slate-600/80 bg-slate-50/60 dark:bg-slate-800/40 px-2 py-2">
                    <GenerateResponseButton
                      editor={editor}
                      payload={payload}
                      selectedShapeIds={selectedShapeIds}
                      language={languageKey}
                      priorTurns={conversationTurns}
                      userMessage={userFollowUpMessage}
                      useLastSelection={useLastSelection}
                      lastSelection={lastSelection}
                      onDistantFromLastSelection={() => setForkHint(true)}
                      layoutAnalysis={requestLayoutAnalysis}
                      enabledAgentTools={enabledAgentToolIds}
                      visualState={generateVisual}
                      isLoading={isRequestLoading}
                      onRequestStart={handleRequestStart}
                      onRequestBuilt={handleRequestBuilt}
                      onRequestSuccess={handleRequestSuccess}
                      onRequestError={handleRequestError}
                      onRequestSizeBytes={handleRequestSizeBytes}
                      onRequestSizeMetrics={handleRequestSizeMetrics}
                      onStreamToolPill={handleStreamToolPill}
                      className="!text-[9px] !leading-tight !tracking-wide"
                    />
                    <AgentToolsStatus
                      enabledByTool={agentToolsEnabled}
                      onToggleTool={toggleAgentTool}
                      statusByTool={agentToolPills}
                      togglesDisabled={isRequestLoading}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-[9px] font-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Display
                    </span>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                      <div className="flex items-center justify-between gap-1.5 min-w-0">
                        <span className="text-[8px] font-label font-bold text-slate-600 dark:text-slate-400 truncate">
                          Toolbar
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={showTldrawToolbar}
                          aria-label="Show tldraw toolbar"
                          onClick={() => setShowTldrawToolbar((v) => !v)}
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                            showTldrawToolbar
                              ? "bg-blue-600"
                              : "bg-slate-300 dark:bg-slate-600"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                              showTldrawToolbar ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-1.5 min-w-0">
                        <span className="text-[8px] font-label font-bold text-slate-600 dark:text-slate-400 truncate" title="Viewport overlay while generating">
                          Model view
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={showModelViewOverlay}
                          aria-label="Show viewport and selection crop overlay while generating a response"
                          onClick={() => setShowModelViewOverlay((v) => !v)}
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                            showModelViewOverlay
                              ? "bg-blue-600"
                              : "bg-slate-300 dark:bg-slate-600"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                              showModelViewOverlay ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-2">
                    <label className="flex flex-col gap-0.5 min-w-0 sm:col-span-2">
                      <span className="text-[9px] font-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Language
                      </span>
                      <select
                        value={languageKey}
                        onChange={(e) =>
                          setLanguageKey(e.target.value as LanguageKey | "auto")
                        }
                        title="Response language"
                        className="h-7 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 text-[10px] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="auto">{AUTO_LANGUAGE_LABEL} (detect)</option>
                        {(Object.entries(LANGUAGE_CATALOG) as [
                          LanguageKey,
                          (typeof LANGUAGE_CATALOG)[LanguageKey],
                        ][]).map(([key, meta]) => (
                          <option key={key} value={key}>
                            {meta.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-0.5 min-w-0 sm:col-span-2">
                      <span className="text-[9px] font-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Handwriting
                      </span>
                      <select
                        value={handwritingFontKey}
                        onChange={(e) =>
                          setHandwritingFontKey(e.target.value as HandwritingFontKey)
                        }
                        title="Handwriting font"
                        disabled={availableFontKeys.length === 0}
                        className="h-7 w-full min-w-0 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 text-[10px] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                      >
                        {availableFontKeys.length === 0 && (
                          <option value="">— no font —</option>
                        )}
                        {availableFontKeys.map((key) => {
                          const meta = FONT_CATALOG[key];
                          const tag = meta.isHandwriting ? "" : " (print)";
                          return (
                            <option key={key} value={key}>
                              {meta.label}
                              {tag} — {meta.hint}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  </div>

                  <div className="flex flex-col gap-1 rounded-lg border border-slate-200/80 dark:border-slate-600/60 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[9px] font-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Session
                      </span>
                      <button
                        type="button"
                        onClick={handleNewChat}
                        className="text-[9px] font-label font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                      >
                        New chat
                      </button>
                    </div>
                    <label className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[8px] text-slate-500 dark:text-slate-400">
                        Follow-up (optional)
                      </span>
                      <input
                        type="text"
                        value={userFollowUpMessage}
                        onChange={(e) => setUserFollowUpMessage(e.target.value)}
                        placeholder="e.g. Now explain (b)…"
                        className="h-6 w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 text-[10px] text-slate-900 dark:text-slate-100"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={useLastSelection}
                        onChange={(e) => setUseLastSelection(e.target.checked)}
                        disabled={!lastSelection}
                        className="rounded border-slate-400"
                      />
                      <span className="text-[9px] text-slate-600 dark:text-slate-300">
                        Use last selection
                      </span>
                    </label>
                    {forkHint && (
                      <p className="text-[8px] text-amber-700 dark:text-amber-300 leading-snug">
                        Selection is far from the last answer region — consider{" "}
                        <button
                          type="button"
                          className="font-bold underline"
                          onClick={handleNewChat}
                        >
                          New chat
                        </button>{" "}
                        to avoid mixed context.
                      </p>
                    )}
                  </div>

                  <div
                    className="rounded-lg border border-slate-200/80 dark:border-slate-600/60 px-2 py-1.5 space-y-2"
                    title="Request size budgets"
                  >
                    <div
                      className="space-y-0.5"
                      title={`Outbound JSON ~${bufferPercent}% of ~${Math.round(VLM_REQUEST_SIZE_BUDGET_BYTES / 1e6)} MB budget (wire size)`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[8px] font-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Buffer (wire)
                        </span>
                        <div className="flex items-center gap-0.5">
                          <span className="font-mono text-[8px] text-slate-500 font-bold tabular-nums">
                            {bufferPercent}%
                          </span>
                          <button
                            type="button"
                            title="Reset buffer meter — does not clear conversation"
                            aria-label="Reset buffer meter samples"
                            onClick={() => {
                              setBufferPercent(0);
                              setConversationBufferPercent(0);
                              setConversationNearWarn(false);
                              setBufferTimeline([]);
                            }}
                            className="material-symbols-outlined text-[14px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 leading-none p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            refresh
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[13px] text-slate-400 leading-none shrink-0">
                          memory
                        </span>
                        <div className="h-1 flex-1 min-w-0 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-[width] duration-300"
                            style={{ width: `${bufferPercent}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-0.5" title="Conversation text only">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[8px] font-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Conversation
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {conversationNearWarn && (
                            <span className="text-[7px] font-label font-bold text-amber-600 dark:text-amber-400">
                              Near limit
                            </span>
                          )}
                          <span className="font-mono text-[8px] text-slate-500 font-bold tabular-nums">
                            {conversationBufferPercent}%
                          </span>
                        </div>
                      </div>
                      <div className="h-1 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div
                          className="h-full bg-violet-500 rounded-full transition-[width] duration-300"
                          style={{ width: `${conversationBufferPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label="Export reasoning run telemetry as JSON"
                    title="Downloads reason_runs JSON (includes entries from this session once the store is initialized)"
                    onClick={() => {
                      const store = getReasonRunsStore();
                      if (!store) return;
                      const stamp = new Date()
                        .toISOString()
                        .replace(/[:.]/g, "-")
                        .slice(0, 19);
                      store.download(`reason_runs_${stamp}.json`);
                    }}
                    className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-[10px] font-label font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0"
                  >
                    <span className="material-symbols-outlined text-[16px] leading-none">
                      download
                    </span>
                    Export telemetry
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  aria-expanded={floatingToolsOpen}
                  aria-label="Open tools"
                  onClick={() => setFloatingToolsOpen(true)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 shadow-lg hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-xl transition-shadow transition-colors"
                >
                  <span className="material-symbols-outlined text-2xl text-blue-600 dark:text-blue-400 leading-none">
                    widgets
                  </span>
                </button>
              )}
            </div>
          </div>
        </section>

        {telemetrySidebarOpen ? (
          <>
            <button
              type="button"
              className="w-1 bg-slate-200 dark:bg-slate-800 relative cursor-pointer group flex-shrink-0 z-40 border-0 p-0 hover:bg-slate-300/80 dark:hover:bg-slate-700/80 transition-colors"
              onPointerDown={handleDividerPointerDown}
              onClick={handleDividerClick}
              aria-expanded={true}
              aria-controls="telemetry-sidebar"
              aria-label="Collapse telemetry panel"
              title="Collapse telemetry panel"
            >
              <span className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-blue-500/20 transition-colors pointer-events-none" />
              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-10 bg-white dark:bg-slate-900 rounded-full tldraw-divider-handle border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center gap-0.5 group-hover:border-blue-500 transition-colors pointer-events-none shadow-sm">
                <span className="w-0.5 h-0.5 bg-slate-400 rounded-full" />
                <span className="w-0.5 h-0.5 bg-slate-400 rounded-full" />
                <span className="w-0.5 h-0.5 bg-slate-400 rounded-full" />
              </span>
            </button>

            <aside
              id="telemetry-sidebar"
              className="h-full min-w-0 flex flex-col bg-slate-50 dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 z-30 shrink-0"
              style={{ width: telemetrySidebarWidthPx }}
            >
          <div className="p-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 bg-slate-900 text-white rounded text-[8px] font-mono font-bold">
                  TD
                </span>
                <h2 className="font-label text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold">
                  tldraw Agent
                </h2>
              </div>
              <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full border border-emerald-200/50 dark:border-emerald-800/50">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="font-label text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-tighter">
                  Live Sync
                </span>
              </div>
            </div>
            <h1 className="text-2xl font-headline text-slate-900 dark:text-slate-100">
              Telemetry
            </h1>
          </div>

          <div className="flex border-b border-slate-200 dark:border-slate-800">
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === "reasoning"}
              onClick={() => setSidebarTab("reasoning")}
              className={`flex-1 py-3 font-label text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 transition-colors ${
                sidebarTab === "reasoning"
                  ? "text-slate-900 dark:text-slate-100 font-bold border-b-2 border-slate-900 dark:border-slate-100 bg-white dark:bg-slate-950/50"
                  : "text-slate-400 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800/50"
              }`}
            >
              <span className="material-symbols-outlined text-sm">psychology</span>
              Reasoning
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === "raw"}
              onClick={() => setSidebarTab("raw")}
              className={`flex-1 py-3 font-label text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 transition-colors ${
                sidebarTab === "raw"
                  ? "text-slate-900 dark:text-slate-100 font-bold border-b-2 border-slate-900 dark:border-slate-100 bg-white dark:bg-slate-950/50"
                  : "text-slate-400 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800/50"
              }`}
            >
              <span className="material-symbols-outlined text-sm">terminal</span>
              Raw Output
            </button>
          </div>

          <div className="flex-grow p-4 overflow-y-auto font-mono text-xs bg-slate-100 dark:bg-slate-950/50">
            {sidebarTab === "reasoning" ? (
              <div className="space-y-4">
                <div className="flex gap-3">
                  <span className="text-slate-400 shrink-0 select-none">Now</span>
                  <div className="text-emerald-600 dark:text-emerald-500 font-bold">
                    SYSTEM
                  </div>
                  <span className="text-slate-600 dark:text-slate-400 italic">
                    Telemetry stream active.
                  </span>
                </div>
                <div className="relative group">
                  <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      aria-label="Copy selection JSON"
                      onClick={() => {
                        void copyTextToClipboard(
                          payload
                            ? JSON.stringify(payload, null, 2)
                            : "no active selection",
                        );
                      }}
                      className="p-1 hover:bg-slate-300 dark:hover:bg-slate-700 rounded transition-colors"
                    >
                      <span className="material-symbols-outlined text-xs text-slate-500">
                        content_copy
                      </span>
                    </button>
                  </div>
                  <pre className="p-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm text-slate-700 dark:text-slate-300 leading-relaxed overflow-x-hidden whitespace-pre-wrap break-words">
                    {payload
                      ? JSON.stringify(payload, null, 2)
                      : "no active selection"}
                  </pre>
                </div>
                <div className="flex gap-3">
                  <span className="text-slate-400 shrink-0 select-none">Live</span>
                  <div className="text-blue-600 dark:text-blue-400 font-bold">INFO</div>
                  <span className="text-slate-600 dark:text-slate-400">
                    {isRequestLoading
                      ? "Sending payload to backend..."
                      : "Select shapes on the board, then open Tools (widgets button, bottom-right) to generate."}
                  </span>
                </div>
                {reasoningResponse ? (
                  <div className="space-y-2">
                    <div className="text-[10px] font-label uppercase tracking-widest font-bold text-slate-400">
                      What I see
                    </div>
                    <pre className="p-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm text-slate-700 dark:text-slate-300 leading-relaxed overflow-x-hidden whitespace-pre-wrap break-words">
                      {reasoningResponse.what_i_see}
                    </pre>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <div className="text-[10px] font-label uppercase tracking-widest font-bold text-slate-400">
                    Generation timeline
                  </div>
                  {generationTimeline.length === 0 ? (
                    <pre className="p-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm text-slate-500 dark:text-slate-400 leading-relaxed overflow-x-hidden whitespace-pre-wrap break-words">
                      No generated items yet.
                    </pre>
                  ) : (
                    <div className="space-y-3">
                      {generationTimeline.map((entry) => (
                        <div
                          key={entry.id}
                          className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2 text-[10px]">
                            <span className="text-slate-500 dark:text-slate-400 font-sans tabular-nums">
                              {entry.startedAt}
                            </span>
                            <span
                              className={`font-label uppercase tracking-wide ${
                                entry.status === "success"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : entry.status === "error"
                                    ? "text-rose-600 dark:text-rose-400"
                                    : "text-amber-600 dark:text-amber-400"
                              }`}
                            >
                              {entry.status}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-label uppercase tracking-wider">
                            What I see
                          </div>
                          <pre className="p-2 bg-slate-50 dark:bg-slate-950 rounded border border-slate-100 dark:border-slate-800 whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
                            {entry.response?.what_i_see ??
                              (entry.error ? "Run failed before response." : "Waiting for response...")}
                          </pre>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-label uppercase tracking-wider">
                            Response
                          </div>
                          <pre className="p-2 bg-slate-50 dark:bg-slate-950 rounded border border-slate-100 dark:border-slate-800 whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
                            {entry.response?.my_response ??
                              (entry.error ?? "Waiting for response...")}
                          </pre>
                          {entry.status === "success" && entry.response ? (
                            <ReasoningTraceSummary response={entry.response} />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {reasoningError ? (
                  <div className="flex gap-3">
                    <span className="text-slate-400 shrink-0 select-none">Live</span>
                    <div className="text-rose-600 dark:text-rose-400 font-bold">ERROR</div>
                    <span className="text-rose-600 dark:text-rose-400 break-words">
                      {reasoningError}
                    </span>
                  </div>
                ) : null}
                {autoLanguageHint ? (
                  <div className="flex gap-3">
                    <span className="text-slate-400 shrink-0 select-none">Live</span>
                    <div className="text-amber-600 dark:text-amber-400 font-bold">HINT</div>
                    <span className="text-amber-600 dark:text-amber-400 break-words">
                      {autoLanguageHint}
                    </span>
                  </div>
                ) : null}
                <div className="flex items-center gap-2 text-blue-500/50">
                  <span className="animate-pulse">_</span>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-sans leading-snug">
                  Live spatial payload updates with the selection. Outbound and
                  response bodies refresh each time you run Generate from the
                  Tools panel (outbound is captured immediately before the network
                  call).
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-label uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">
                        Live selection (spatial)
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 font-sans">
                        Updates with the canvas selection
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Copy live selection JSON"
                      onClick={() => {
                        void copyTextToClipboard(
                          payload
                            ? JSON.stringify(payload, null, 2)
                            : "no active selection",
                        );
                      }}
                      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-colors shrink-0"
                    >
                      <span className="material-symbols-outlined text-sm text-slate-500">
                        content_copy
                      </span>
                    </button>
                  </div>
                  <pre className="p-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm text-slate-700 dark:text-slate-300 leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-48">
                    {payload
                      ? JSON.stringify(payload, null, 2)
                      : "no active selection"}
                  </pre>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-label uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">
                        Raw output timeline
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 font-sans">
                        Stores all outbound and response JSON per generate run
                      </div>
                    </div>
                  </div>
                  {generationTimeline.length === 0 ? (
                    <pre className="p-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm text-slate-700 dark:text-slate-300 leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-64">
                      Use Tools on the canvas, then Generate to build timeline entries.
                    </pre>
                  ) : (
                    <div className="space-y-4">
                      {generationTimeline.map((entry) => (
                        <div
                          key={`${entry.id}-raw`}
                          className="space-y-2 p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-sans tabular-nums">
                              {entry.startedAt}
                            </div>
                            <button
                              type="button"
                              aria-label="Copy raw timeline entry"
                              onClick={() => {
                                void handleCopy(
                                  `raw-entry-${entry.id}`,
                                  JSON.stringify(entry, null, 2),
                                );
                              }}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-colors shrink-0"
                            >
                              <span
                                className={`material-symbols-outlined text-sm ${
                                  copyStateByKey[`raw-entry-${entry.id}`] === "success"
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : copyStateByKey[`raw-entry-${entry.id}`] === "error"
                                      ? "text-rose-600 dark:text-rose-400"
                                      : "text-slate-500"
                                }`}
                              >
                                {copyStateByKey[`raw-entry-${entry.id}`] === "success"
                                  ? "check"
                                  : copyStateByKey[`raw-entry-${entry.id}`] === "error"
                                    ? "error"
                                    : "content_copy"}
                              </span>
                            </button>
                          </div>
                          <div className="text-[10px] font-label uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">
                            <div className="flex items-center justify-between gap-2">
                              <span>Outbound request JSON</span>
                              <button
                                type="button"
                                aria-label="Copy outbound request JSON"
                                onClick={() => {
                                  void handleCopy(
                                    `raw-outbound-${entry.id}`,
                                    JSON.stringify(entry.request, null, 2),
                                  );
                                }}
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-colors shrink-0"
                              >
                                <span
                                  className={`material-symbols-outlined text-sm ${
                                    copyStateByKey[`raw-outbound-${entry.id}`] ===
                                    "success"
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : copyStateByKey[`raw-outbound-${entry.id}`] ===
                                          "error"
                                        ? "text-rose-600 dark:text-rose-400"
                                        : "text-slate-500"
                                  }`}
                                >
                                  {copyStateByKey[`raw-outbound-${entry.id}`] ===
                                  "success"
                                    ? "check"
                                    : copyStateByKey[`raw-outbound-${entry.id}`] ===
                                        "error"
                                      ? "error"
                                      : "content_copy"}
                                </span>
                              </button>
                            </div>
                          </div>
                          <pre className="p-3 bg-slate-50 dark:bg-slate-950 rounded border border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300 leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-48">
                            {JSON.stringify(entry.request, null, 2)}
                          </pre>
                          <div className="text-[10px] font-label uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">
                            <div className="flex items-center justify-between gap-2">
                              <span>Response JSON</span>
                              <button
                                type="button"
                                aria-label="Copy response JSON"
                                onClick={() => {
                                  void handleCopy(
                                    `raw-response-${entry.id}`,
                                    entry.response
                                      ? JSON.stringify(entry.response, null, 2)
                                      : entry.error
                                        ? `Error: ${entry.error}`
                                        : "Waiting for response...",
                                  );
                                }}
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-colors shrink-0"
                              >
                                <span
                                  className={`material-symbols-outlined text-sm ${
                                    copyStateByKey[`raw-response-${entry.id}`] ===
                                    "success"
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : copyStateByKey[`raw-response-${entry.id}`] ===
                                          "error"
                                        ? "text-rose-600 dark:text-rose-400"
                                        : "text-slate-500"
                                  }`}
                                >
                                  {copyStateByKey[`raw-response-${entry.id}`] ===
                                  "success"
                                    ? "check"
                                    : copyStateByKey[`raw-response-${entry.id}`] ===
                                        "error"
                                      ? "error"
                                      : "content_copy"}
                                </span>
                              </button>
                            </div>
                          </div>
                          <pre className="p-3 bg-slate-50 dark:bg-slate-950 rounded border border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300 leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-48">
                            {entry.response
                              ? JSON.stringify(entry.response, null, 2)
                              : entry.error
                                ? `Error: ${entry.error}`
                                : "Waiting for response..."}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="text-[10px] font-label uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">
                    Buffer timeline
                  </div>
                  {bufferTimeline.length === 0 ? (
                    <pre className="p-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm text-slate-700 dark:text-slate-300 leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-48">
                      Buffer timeline is empty. Generate to record samples.
                    </pre>
                  ) : (
                    <div className="space-y-2">
                      {bufferTimeline.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2"
                        >
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums min-w-0">
                            {entry.recordedAt}
                          </span>
                          <div className="flex flex-col items-end gap-0.5 min-w-0 text-right">
                            <span className="text-[10px] text-slate-700 dark:text-slate-300 tabular-nums">
                              wire {entry.requestBytes.toLocaleString()} B · {entry.percent}%
                            </span>
                            <span className="text-[9px] text-slate-500 dark:text-slate-400 tabular-nums">
                              turn {entry.turnIndex} · conv {entry.conversationBytes.toLocaleString()}{" "}
                              B ({entry.conversationPercent}
                              %)
                              {entry.conversationNearWarn ? " · !" : ""}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
            </aside>
          </>
        ) : (
          <button
            type="button"
            className="flex h-full w-6 shrink-0 cursor-pointer flex-col items-center justify-center border-0 border-l border-slate-200 bg-slate-200 py-0 z-40 dark:border-slate-700 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
            onClick={() => setTelemetrySidebarOpen(true)}
            aria-expanded={false}
            aria-controls="telemetry-sidebar"
            aria-label="Expand telemetry panel"
            title="Show telemetry panel"
          >
            <span
              className="material-symbols-outlined text-slate-500 dark:text-slate-400 text-[18px] leading-none"
              aria-hidden
            >
              chevron_left
            </span>
          </button>
        )}
      </main>
    </div>
  );
}
