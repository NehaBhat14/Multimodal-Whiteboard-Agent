import type { VlmInferenceRequest, VlmInferenceResponse } from "../types/vlm";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const REASON_ENDPOINT_PATH = "/api/v1/reason";

export function getApiBaseUrl(): string {
  const envBase = import.meta.env.VITE_REASONING_API_BASE_URL;
  if (typeof envBase === "string" && envBase.trim().length > 0) {
    return envBase.trim().replace(/\/+$/, "");
  }
  return DEFAULT_API_BASE_URL;
}

export async function postReasoningRequest(
  request: VlmInferenceRequest,
): Promise<VlmInferenceResponse> {
  const response = await fetch(`${getApiBaseUrl()}${REASON_ENDPOINT_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    let details = "";
    try {
      details = JSON.stringify(await response.json());
    } catch {
      details = await response.text();
    }
    throw new Error(
      `Reasoning request failed (${response.status} ${response.statusText})${details ? `: ${details}` : ""}`,
    );
  }

  return (await response.json()) as VlmInferenceResponse;
}

export type ReasoningRequestPayload = VlmInferenceRequest;
export type ReasoningResponsePayload = VlmInferenceResponse;
