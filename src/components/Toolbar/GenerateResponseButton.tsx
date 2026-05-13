import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "tldraw";
import type { SpatialPayload } from "../../types/spatial";
import {
  buildVlmInferenceRequestTimed,
  estimateVlmRequestBytes,
} from "../../services/payloadBuilder";
import { postReasoningRequest } from "../../services/reasoningApi";
import {
  isReasonStreamEnabled,
  postReasoningStream,
} from "../../hooks/reasoningStreamParser";
import { ThinkingIndicator } from "../reasoning/ThinkingIndicator";
import {
  DEFAULT_LANGUAGE_KEY,
  type LanguageKey,
} from "../../lib/i18n/languages";
import type { HybridLayoutAnalysis } from "../../lib/layout/hybridTypes";
import type { ConversationTurn, VlmInferenceRequest, VlmInferenceResponse } from "../../types/vlm";
import {
  CONVERSATION_TEXT_BUDGET_BYTES,
  SELECTION_FORK_DISTANCE_THRESHOLD,
} from "../../lib/reasoning/conversationConstants";
import {
  estimateConversationBytes,
  isNearConversationBudget,
  trimConversationContext,
} from "../../lib/reasoning/trimConversationContext";

export type GenerateResponseVisualState = "idle" | "loading" | "success" | "error";

export interface ClientRequestStages {
  export_ms: number;
  base64_ms: number;
  network_ms: number;
  client_total_ms: number;
  request_bytes: number;
  png_bytes: number;
  /** Outbound request (includes conversation fields when present). */
  request: VlmInferenceRequest;
  usedLastSelection: boolean;
  /** Shape ids used for this generate (for lastSelection bookkeeping). */
  effectiveSelectedShapeIds: readonly string[];
  conversationBytes: number;
  turnIndex: number;
  conversationNearBudget: boolean;
  responseMode?: "answer" | "coding" | null;
  toolTraceLength?: number;
}

function centerDistance(a: SpatialPayload, b: SpatialPayload): number {
  const cxa = a.x + a.width / 2;
  const cya = a.y + a.height / 2;
  const cxb = b.x + b.width / 2;
  const cyb = b.y + b.height / 2;
  return Math.hypot(cxa - cxb, cya - cyb);
}

export function GenerateResponseButton({
  editor,
  payload,
  selectedShapeIds,
  language = DEFAULT_LANGUAGE_KEY,
  priorTurns = [],
  userMessage = "",
  useLastSelection = false,
  lastSelection = null,
  onDistantFromLastSelection,
  visualState = "idle",
  isLoading = false,
  onRequestStart,
  onRequestBuilt,
  onRequestSuccess,
  onRequestError,
  onRequestSizeBytes,
  onRequestSizeMetrics,
  onStreamStage,
  onStreamToolPill,
  className,
  layoutAnalysis,
  enabledAgentTools,
}: {
  editor: Editor | null;
  payload: SpatialPayload | null;
  selectedShapeIds: readonly string[];
  language?: LanguageKey | "auto";
  /** Prior completed turns in this session (oldest first). */
  priorTurns?: readonly ConversationTurn[];
  /** Free-text follow-up, separate from template queryText. */
  userMessage?: string;
  useLastSelection?: boolean;
  lastSelection?: {
    selectedShapeIds: readonly string[];
    spatial: SpatialPayload;
  } | null;
  /** Fires when current selection is far from last success selection (009 fork). */
  onDistantFromLastSelection?: () => void;
  /** Allowed OpenAI tool names for this request; omit for server default (all tools). */
  enabledAgentTools?: readonly string[] | null;
  visualState?: GenerateResponseVisualState;
  isLoading?: boolean;
  className?: string;
  onRequestStart?: () => void;
  onRequestBuilt?: (request: VlmInferenceRequest) => void;
  onRequestSuccess?: (
    response: VlmInferenceResponse,
    stages: ClientRequestStages,
  ) => void;
  onRequestError?: (error: string) => void;
  /** Legacy: wire / full JSON size only. */
  onRequestSizeBytes?: (bytes: number) => void;
  onRequestSizeMetrics?: (m: {
    wireBytes: number;
    conversationBytes: number;
    turnIndex: number;
    conversationNearBudget: boolean;
  }) => void;
  onStreamStage?: (name: string) => void;
  onStreamToolPill?: (toolName: string) => void;
  layoutAnalysis?: HybridLayoutAnalysis;
}) {
  const [streamStage, setStreamStage] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const t0Ref = useRef(0);
  const stream = isReasonStreamEnabled();
  const { effectiveSelectedIds, effectivePayload } = useMemo(() => {
    if (useLastSelection && lastSelection) {
      return {
        effectiveSelectedIds: lastSelection.selectedShapeIds,
        effectivePayload: lastSelection.spatial,
      };
    }
    return { effectiveSelectedIds: selectedShapeIds, effectivePayload: payload };
  }, [useLastSelection, lastSelection, selectedShapeIds, payload]);

  useEffect(() => {
    if (!isLoading) {
      setStreamStage(null);
      setElapsedSec(0);
      return;
    }
    t0Ref.current = performance.now();
    const id = window.setInterval(() => {
      setElapsedSec((performance.now() - t0Ref.current) / 1000);
    }, 400);
    return () => clearInterval(id);
  }, [isLoading]);

  const disabled = useMemo(() => {
    if (!editor || isLoading) return true;
    if (useLastSelection) {
      return !lastSelection || lastSelection.selectedShapeIds.length === 0;
    }
    return !payload || selectedShapeIds.length === 0;
  }, [editor, isLoading, useLastSelection, lastSelection, payload, selectedShapeIds.length]);

  const buttonClass = useMemo(() => {
    const base =
      "w-full min-h-[2.85rem] max-h-[2.85rem] px-2 py-0 text-xs font-label font-bold uppercase tracking-widest rounded-lg border transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden flex items-center justify-center relative";
    switch (visualState) {
      case "loading":
        return `${base} border-amber-400/70 bg-amber-50/95 text-amber-950 dark:bg-amber-950/55 dark:text-amber-100 dark:border-amber-500/55 ring-2 ring-amber-400/45 generate-response-btn--working`;
      case "success":
        return `${base} border-emerald-500/70 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100 dark:border-emerald-500/60 ring-2 ring-emerald-500/40`;
      case "error":
        return `${base} border-rose-500/70 bg-rose-50 text-rose-950 dark:bg-rose-950/40 dark:text-rose-100 dark:border-rose-500/60 ring-2 ring-rose-500/60`;
      default:
        return `${base} border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700`;
    }
  }, [visualState]);

  const handleClick = useCallback(async () => {
    if (disabled) return;
    if (!editor) return;
    if (!useLastSelection && !payload) return;
    if (!useLastSelection && selectedShapeIds.length === 0) return;
    if (useLastSelection && (!lastSelection || lastSelection.selectedShapeIds.length === 0))
      return;

    if (
      !useLastSelection &&
      lastSelection &&
      payload &&
      onDistantFromLastSelection
    ) {
      const d = centerDistance(lastSelection.spatial, payload);
      if (d > SELECTION_FORK_DISTANCE_THRESHOLD) {
        onDistantFromLastSelection();
      }
    }

    const start = performance.now();
    onRequestStart?.();
    const effPl = effectivePayload;
    if (!effPl) return;
    if (effectiveSelectedIds.length === 0) return;

    try {
      const trimmed = trimConversationContext(
        Array.from(priorTurns),
        userMessage,
        CONVERSATION_TEXT_BUDGET_BYTES,
      );
      const conv = trimmed.conversationContext;
      const umsg = trimmed.userMessage;
      const turnIndex = priorTurns.length;
      const convBytes = estimateConversationBytes(
        conv.length > 0 ? conv : undefined,
        umsg,
      );
      const near = isNearConversationBudget(convBytes);

      const { request, timings: buildTimings } =
        await buildVlmInferenceRequestTimed({
          editor,
          selectedShapeIds: effectiveSelectedIds,
          spatial: effPl,
          language,
          layoutAnalysis,
          conversationContext: conv.length > 0 ? conv : undefined,
          userMessage: umsg,
          enabledAgentTools: enabledAgentTools ?? undefined,
        });
      onRequestBuilt?.(request);
      const request_bytes = estimateVlmRequestBytes(request);
      onRequestSizeBytes?.(request_bytes);
      onRequestSizeMetrics?.({
        wireBytes: request_bytes,
        conversationBytes: convBytes,
        turnIndex,
        conversationNearBudget: near,
      });

      const networkStart = performance.now();
      let response: VlmInferenceResponse;
      if (stream) {
        setStreamStage("reading_canvas");
        response = await postReasoningStream(request, {
          onStage: (e) => {
            setStreamStage(e.name);
            onStreamStage?.(e.name);
          },
          onToolResult: (e) => {
            onStreamToolPill?.(e.name);
          },
        });
      } else {
        response = await postReasoningRequest(request);
      }
      const network_ms = performance.now() - networkStart;
      const client_total_ms = performance.now() - start;

      const stages: ClientRequestStages = {
        export_ms: buildTimings.export_ms,
        base64_ms: buildTimings.base64_ms,
        network_ms: Math.round(network_ms * 1000) / 1000,
        client_total_ms: Math.round(client_total_ms * 1000) / 1000,
        request_bytes,
        png_bytes: buildTimings.png_bytes,
        request,
        usedLastSelection: Boolean(useLastSelection && lastSelection),
        effectiveSelectedShapeIds: effectiveSelectedIds,
        conversationBytes: convBytes,
        turnIndex,
        conversationNearBudget: near,
        responseMode: response.mode ?? null,
        toolTraceLength: response.tool_trace?.length,
      };

      onRequestSuccess?.(response, stages);
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      onRequestError?.(errorMessage);
      console.log(`Generate Response failed in ${durationMs}ms`, err);
    }
  }, [
    disabled,
    editor,
    useLastSelection,
    lastSelection,
    payload,
    onRequestStart,
    onDistantFromLastSelection,
    effectivePayload,
    effectiveSelectedIds,
    language,
    layoutAnalysis,
    enabledAgentTools,
    priorTurns,
    userMessage,
    onRequestBuilt,
    onRequestError,
    onRequestSizeBytes,
    onRequestSizeMetrics,
    onRequestSuccess,
    selectedShapeIds,
    stream,
    onStreamStage,
    onStreamToolPill,
  ]);

  return (
    <button
      type="button"
      aria-label="Generate response"
      disabled={disabled}
      onClick={() => {
        void handleClick();
      }}
      className={className ? `${buttonClass} ${className}` : buttonClass}
    >
      {isLoading ? (
        <ThinkingIndicator
          active
          stageName={stream ? streamStage : null}
          elapsedSec={elapsedSec}
          compact
        />
      ) : (
        <span className="block w-full truncate px-1 text-center leading-tight">
          Generate Response
        </span>
      )}
    </button>
  );
}
