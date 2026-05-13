import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import type { SpatialPayload } from "../../../src/types/spatial";
import { DEFAULT_SELECTION_QUERY } from "../../../src/types/vlm";
import type { Editor } from "tldraw";
import { GenerateResponseButton } from "../../../src/components/Toolbar/GenerateResponseButton";
import { buildVlmInferenceRequestTimed } from "../../../src/services/payloadBuilder";
import { postReasoningRequest } from "../../../src/services/reasoningApi";

vi.mock("../../../src/services/payloadBuilder", () => ({
  buildVlmInferenceRequest: vi.fn(),
  buildVlmInferenceRequestTimed: vi.fn(),
  estimateVlmRequestBytes: vi.fn(() => 1234),
}));
vi.mock("../../../src/services/reasoningApi", () => ({
  postReasoningRequest: vi.fn(),
}));
vi.mock("../../../src/hooks/reasoningStreamParser", () => ({
  isReasonStreamEnabled: () => false,
  postReasoningStream: vi.fn(),
}));

const buildTimedMock = buildVlmInferenceRequestTimed as unknown as ReturnType<
  typeof vi.fn
>;
const postMock = postReasoningRequest as unknown as ReturnType<typeof vi.fn>;

const EMPTY_BUILD_TIMINGS = { export_ms: 0, base64_ms: 0, png_bytes: 0 };

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const value of Object.values(obj as any)) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

describe("GenerateResponseButton", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("builds payload and sends request to backend", async () => {
    const payload: SpatialPayload = { x: 1, y: 2, width: 3, height: 4 };
    const frozenPayload = deepFreeze(payload);

    const selectedIds = ["id1", "id2"] as const;
    const frozenSelectedIds = deepFreeze([...selectedIds]);

    const editorSelectedIds = deepFreeze(["shape-before-click"] as string[]);
    const editor = {
      getSelectedShapeIds: () => editorSelectedIds,
    } as unknown as Editor;

    const request = {
      imageBase64: "AAA",
      spatial: frozenPayload,
      queryText: DEFAULT_SELECTION_QUERY,
    };
    const response = {
      my_response: "mock my response",
      what_i_see: "mock what i see",
      spatial: frozenPayload,
      status: "COMPLETED",
      started_at: "2026-03-20T00:00:00Z",
      finished_at: "2026-03-20T00:00:01Z",
      timings: { provider: "mock", inference_ms: 0, parse_ms: 0, total_ms: 0 },
    };
    const onRequestSuccess = vi.fn();
    const onRequestSizeBytes = vi.fn();
    const onRequestBuilt = vi.fn();

    (buildTimedMock as any).mockResolvedValue({
      request,
      timings: EMPTY_BUILD_TIMINGS,
    });
    (postMock as any).mockResolvedValue(response);

    const nowSpy = vi.spyOn(window.performance, "now");
    nowSpy.mockImplementation(() => 1000);

    render(
      <GenerateResponseButton
        editor={editor}
        payload={frozenPayload}
        selectedShapeIds={frozenSelectedIds}
        onRequestSuccess={onRequestSuccess}
        onRequestSizeBytes={onRequestSizeBytes}
        onRequestBuilt={onRequestBuilt}
      />,
    );

    const button = screen.getByRole("button", { name: /generate response/i });

    fireEvent.click(button);

    await new Promise((r) => setTimeout(r, 0));

    expect(buildTimedMock).toHaveBeenCalledTimes(1);
    expect(buildTimedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        editor,
        selectedShapeIds: frozenSelectedIds,
        spatial: frozenPayload,
        // Default language when no `language` prop is supplied to the button.
        language: "en",
        layoutAnalysis: undefined,
        conversationContext: undefined,
        userMessage: null,
      }),
    );
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith(request);
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
    const [successResponse, successStages] = onRequestSuccess.mock.calls[0];
    expect(successResponse).toBe(response);
    expect(successStages).toMatchObject({
      export_ms: 0,
      base64_ms: 0,
      png_bytes: 0,
      request_bytes: 1234,
      usedLastSelection: false,
      turnIndex: 0,
      conversationNearBudget: false,
    });
    expect(successStages.effectiveSelectedShapeIds).toEqual(frozenSelectedIds);
    expect(typeof successStages.conversationBytes).toBe("number");
    expect(typeof successStages.network_ms).toBe("number");
    expect(typeof successStages.client_total_ms).toBe("number");
    expect(onRequestSizeBytes).toHaveBeenCalledWith(1234);
    expect(onRequestBuilt).toHaveBeenCalledTimes(1);
    expect(onRequestBuilt).toHaveBeenCalledWith(request);

    expect(Object.isFrozen(frozenPayload)).toBe(true);
    expect(frozenPayload).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(editor.getSelectedShapeIds()).toBe(editorSelectedIds);
  });

  it("fires onRequestStart before async work", async () => {
    const payload: SpatialPayload = { x: 0, y: 0, width: 10, height: 10 };
    const editor = {} as unknown as Editor;
    const selectedShapeIds = ["shape-1"];
    const onRequestStart = vi.fn();

    (buildTimedMock as any).mockResolvedValue({
      request: {
        imageBase64: "",
        spatial: payload,
        queryText: DEFAULT_SELECTION_QUERY,
      },
      timings: EMPTY_BUILD_TIMINGS,
    });
    (postMock as any).mockResolvedValue({
      my_response: "ok",
      what_i_see: "what i see",
      spatial: payload,
      status: "COMPLETED",
      started_at: "2026-03-20T00:00:00Z",
      finished_at: "2026-03-20T00:00:01Z",
      timings: { provider: "mock", inference_ms: 0, parse_ms: 0, total_ms: 0 },
    });

    const nowSpy = vi.spyOn(window.performance, "now");
    nowSpy.mockImplementation(() => 1000);

    render(
      <GenerateResponseButton
        editor={editor}
        payload={payload}
        selectedShapeIds={selectedShapeIds}
        onRequestStart={onRequestStart}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /generate response/i }));
    await new Promise((r) => setTimeout(r, 0));

    expect(onRequestStart).toHaveBeenCalledTimes(1);
  });

  it("catches backend errors and does not throw", async () => {
    const payload: SpatialPayload = { x: 1, y: 2, width: 3, height: 4 };
    const editor = {} as unknown as Editor;
    const selectedShapeIds = ["shape-1"];
    const onRequestError = vi.fn();

    (buildTimedMock as any).mockResolvedValue({
      request: {
        imageBase64: "AAA",
        spatial: payload,
        queryText: DEFAULT_SELECTION_QUERY,
      },
      timings: EMPTY_BUILD_TIMINGS,
    });
    (postMock as any).mockRejectedValue(new Error("boom"));

    const nowSpy = vi.spyOn(window.performance, "now");
    nowSpy.mockImplementation(() => 1000);

    render(
      <GenerateResponseButton
        editor={editor}
        payload={payload}
        selectedShapeIds={selectedShapeIds}
        onRequestError={onRequestError}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /generate response/i }));
    await new Promise((r) => setTimeout(r, 0));

    const logMessage = consoleLogSpy.mock.calls[0][0] as string;
    expect(logMessage).toContain("failed in 0ms");
    expect(onRequestError).toHaveBeenCalledWith("boom");
  });
});
