import type { VlmInferenceRequest, VlmInferenceResponse } from "../types/vlm";
import { getApiBaseUrl } from "../services/reasoningApi";

const STREAM_PATH = "/api/v1/reason/stream";

export type StreamHandlers = {
  onStage?: (e: { name: string; t_ms?: number; detail?: unknown }) => void;
  onToolResult?: (e: {
    name: string;
    ms?: number;
    ok?: boolean;
    bytes?: number;
  }) => void;
  onError?: (message: string) => void;
};

/**
 * POST JSON, consume SSE, return final VlmInferenceResponse.
 */
export async function postReasoningStream(
  request: VlmInferenceRequest,
  handlers: StreamHandlers = {},
): Promise<VlmInferenceResponse> {
  const response = await fetch(
    `${getApiBaseUrl()}${STREAM_PATH}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!response.ok || !response.body) {
    let details = "";
    try {
      details = JSON.stringify(await response.json());
    } catch {
      details = (await response.text().catch(() => "")) as string;
    }
    throw new Error(
      `Stream failed (${response.status})${details ? `: ${details}` : ""}`,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      if (!block.trim() || !block.startsWith("data: ")) continue;
      const raw = block.slice(6).trim();
      if (!raw) continue;
      let j: { type?: string; [k: string]: unknown };
      try {
        j = JSON.parse(raw) as { type?: string };
      } catch {
        continue;
      }
      if (j.type === "error") {
        const msg = String((j as { message?: string }).message || "stream error");
        handlers.onError?.(msg);
        throw new Error(msg);
      }
      if (j.type === "stage" && (j as { name?: string }).name != null) {
        handlers.onStage?.({
          name: String((j as { name: string }).name),
          t_ms: (j as { t_ms?: number }).t_ms,
          detail: (j as { detail?: unknown }).detail,
        });
      }
      if (j.type === "tool_result" && (j as { name?: string }).name != null) {
        handlers.onToolResult?.({
          name: String((j as { name: string }).name),
          ms: (j as { ms?: number }).ms,
          ok: (j as { ok?: boolean }).ok,
          bytes: (j as { bytes?: number }).bytes,
        });
      }
      if (j.type === "final" && (j as { body?: VlmInferenceResponse }).body) {
        return (j as { body: VlmInferenceResponse }).body;
      }
    }
  }
  throw new Error("Stream ended before final event");
}

export function isReasonStreamEnabled(): boolean {
  return import.meta.env.VITE_REASON_STREAMING !== "0";
}
