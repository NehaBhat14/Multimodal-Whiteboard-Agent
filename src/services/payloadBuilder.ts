import type { Editor } from "tldraw";
import { blobToBase64 } from "../lib/utils/blobToBase64";
import {
  exportSelectionToBlob,
  exportViewportToBlob,
} from "../lib/tldraw/exportSelection";
import {
  DEFAULT_LANGUAGE_KEY,
  LANGUAGE_CATALOG,
  type LanguageKey,
} from "../lib/i18n/languages";
import {
  DEFAULT_SELECTION_QUERY,
  type CanvasContext,
  type ConversationTurn,
  type VlmInferenceRequest,
} from "../types/vlm";
import type { SpatialPayload } from "../types/spatial";
import type { HybridLayoutAnalysis } from "../lib/layout/hybridTypes";
import {
  buildCanvasContext,
  trimCanvasContextForBudget,
} from "../lib/tldraw/canvasContext";

/**
 * Strict-JSON instruction + language directive. "Auto" defers to user
 * intent: match the writing language unless the user explicitly asks for a
 * different one inside the question (e.g. "in French", "in Hindi").
 */
function buildQueryText(language: LanguageKey | "auto"): string {
  if (language === "auto") {
    return (
      `${DEFAULT_SELECTION_QUERY}\n\n` +
      `Respond in the same language the user wrote in, unless the user explicitly ` +
      `requests a different language in the question itself (e.g. "in French", "in Hindi"). ` +
      `If they explicitly request a language, honor that request.`
    );
  }
  const promptName = LANGUAGE_CATALOG[language].promptName;
  return `${DEFAULT_SELECTION_QUERY}\n\nRespond in ${promptName}.`;
}

/** Soft cap for UI buffer capacity (JSON size of a typical request). */
export const VLM_REQUEST_SIZE_BUDGET_BYTES = 2_500_000;

/** UTF-8 byte length of JSON.stringify(request); stable proxy for wire size. */
export function estimateVlmRequestBytes(request: VlmInferenceRequest): number {
  return new TextEncoder().encode(JSON.stringify(request)).length;
}

export interface PayloadBuildTimings {
  export_ms: number;
  base64_ms: number;
  /** PNG byte size; 0 when export was skipped or failed. */
  png_bytes: number;
}

export interface TimedPayloadBuildResult {
  request: VlmInferenceRequest;
  timings: PayloadBuildTimings;
}

export async function buildVlmInferenceRequest(args: {
  editor: Editor;
  selectedShapeIds: readonly string[];
  spatial: SpatialPayload;
  /** Defaults to English for back-compat. `"auto"` → "Respond in the same language the user wrote in." */
  language?: LanguageKey | "auto";
  layoutAnalysis?: HybridLayoutAnalysis;
  /** Prior turns (client-trimmed). Omitted = no history. */
  conversationContext?: readonly ConversationTurn[] | null;
  userMessage?: string | null;
  /** Subset of agent tool names; omit = server allows all tools. */
  enabledAgentTools?: readonly string[] | null;
}): Promise<VlmInferenceRequest> {
  const { request } = await buildVlmInferenceRequestTimed(args);
  return request;
}

/** Same as {@link buildVlmInferenceRequest} but returns per-stage timings. */
export async function buildVlmInferenceRequestTimed(args: {
  editor: Editor;
  selectedShapeIds: readonly string[];
  spatial: SpatialPayload;
  language?: LanguageKey | "auto";
  layoutAnalysis?: HybridLayoutAnalysis;
  conversationContext?: readonly ConversationTurn[] | null;
  userMessage?: string | null;
  enabledAgentTools?: readonly string[] | null;
}): Promise<TimedPayloadBuildResult> {
  const spatialCopy = {
    x: args.spatial.x,
    y: args.spatial.y,
    width: args.spatial.width,
    height: args.spatial.height,
  };

  const queryText = buildQueryText(args.language ?? DEFAULT_LANGUAGE_KEY);
  const conv =
    args.conversationContext && args.conversationContext.length > 0
      ? [...args.conversationContext]
      : undefined;
  const umsg =
    args.userMessage != null && String(args.userMessage).trim() !== ""
      ? String(args.userMessage).trim()
      : undefined;
  const placementContext = args.layoutAnalysis
    ? {
        divider_intent: args.layoutAnalysis.divider_intent,
        split_column_context: args.layoutAnalysis.split_column_context,
        script_direction: args.layoutAnalysis.script_direction,
        width_profile: args.layoutAnalysis.width_profile,
      }
    : undefined;

  const enabledField =
    args.enabledAgentTools != null
      ? { enabledAgentTools: [...args.enabledAgentTools] }
      : ({} as Record<string, never>);

  const emptyTimings: PayloadBuildTimings = {
    export_ms: 0,
    base64_ms: 0,
    png_bytes: 0,
  };

  let canvasContext: CanvasContext | undefined;
  try {
    canvasContext = trimCanvasContextForBudget(
      buildCanvasContext(
        args.editor,
        args.selectedShapeIds,
        args.selectedShapeIds.length > 0 ? spatialCopy : null,
      ),
    );
  } catch (err) {
    console.warn("[payloadBuilder] canvasContext skipped", err);
  }
  const canvasContextField = canvasContext
    ? { canvasContext }
    : ({} as Record<string, never>);

  const tryBuildSpatialContextImageBase64 = async (): Promise<string> => {
    // Bound method invocation — tldraw exposes `getCurrentPageShapeIds` on the
    // editor; we call it via the editor instance so `this` is preserved.
    let allShapeIds: readonly string[] = [];
    try {
      const editor = args.editor as unknown as {
        getCurrentPageShapeIds?: () => Iterable<string>;
      };
      if (typeof editor.getCurrentPageShapeIds !== "function") {
        console.warn(
          "[payloadBuilder] spatial context skipped: editor.getCurrentPageShapeIds is not a function",
        );
        return "";
      }
      allShapeIds = Array.from(editor.getCurrentPageShapeIds());
    } catch (err) {
      console.warn(
        "[payloadBuilder] spatial context skipped: failed to enumerate page shapes",
        err,
      );
      return "";
    }
    if (allShapeIds.length === 0) return "";

    // Prefer the viewport-bounded export so the VLM sees empty canvas space
    // (crucial for "is there room on the right side of the divider?"
    // decisions). If that fails for any reason (e.g. zero-size viewport in
    // the JSDOM test harness), fall back to the tight shape-bounds crop so
    // the spatial pass still has *something* to look at.
    try {
      const blob = await exportViewportToBlob(args.editor, allShapeIds);
      return await blobToBase64(blob);
    } catch (viewportErr) {
      console.warn(
        "[payloadBuilder] viewport-bounded spatial export failed; falling back to shape-crop",
        viewportErr,
      );
      try {
        const blob = await exportSelectionToBlob(args.editor, allShapeIds);
        return await blobToBase64(blob);
      } catch (cropErr) {
        console.warn(
          "[payloadBuilder] shape-crop spatial export also failed — no spatial context image will be sent",
          cropErr,
        );
        return "";
      }
    }
  };

  // Empty selection → empty image payload.
  if (args.selectedShapeIds.length === 0) {
    const spatialContextImageBase64 = await tryBuildSpatialContextImageBase64();
    return {
      request: {
        imageBase64: "",
        spatialContextImageBase64,
        ...canvasContextField,
        spatial: spatialCopy,
        queryText,
        conversationContext: conv,
        userMessage: umsg ?? null,
        placementContext,
        ...enabledField,
      },
      timings: emptyTimings,
    };
  }

  try {
    const exportStart = performance.now();
    const [blob, spatialContextImageBase64] = await Promise.all([
      exportSelectionToBlob(args.editor, args.selectedShapeIds),
      tryBuildSpatialContextImageBase64(),
    ]);
    const export_ms = performance.now() - exportStart;

    const base64Start = performance.now();
    const imageBase64 = await blobToBase64(blob);
    const base64_ms = performance.now() - base64Start;

    return {
      request: {
        imageBase64,
        spatialContextImageBase64,
        ...canvasContextField,
        spatial: spatialCopy,
        queryText,
        conversationContext: conv,
        userMessage: umsg ?? null,
        placementContext,
        ...enabledField,
      },
      timings: {
        export_ms: Math.round(export_ms * 1000) / 1000,
        base64_ms: Math.round(base64_ms * 1000) / 1000,
        png_bytes: blob.size,
      },
    };
  } catch {
    // Export failure → empty image payload; preserve spatial + queryText.
    const spatialContextImageBase64 = await tryBuildSpatialContextImageBase64();
    return {
      request: {
        imageBase64: "",
        spatialContextImageBase64,
        ...canvasContextField,
        spatial: spatialCopy,
        queryText,
        conversationContext: conv,
        userMessage: umsg ?? null,
        placementContext,
        ...enabledField,
      },
      timings: emptyTimings,
    };
  }
}

