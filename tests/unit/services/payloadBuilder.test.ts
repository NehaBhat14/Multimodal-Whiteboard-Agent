import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/tldraw/exportSelection", () => ({
  exportSelectionToBlob: vi.fn(),
  exportViewportToBlob: vi.fn(),
}));

vi.mock("../../../src/lib/utils/blobToBase64", () => ({
  blobToBase64: vi.fn(),
}));

import {
  exportSelectionToBlob,
  exportViewportToBlob,
} from "../../../src/lib/tldraw/exportSelection";
import { blobToBase64 } from "../../../src/lib/utils/blobToBase64";
import {
  buildVlmInferenceRequest,
  estimateVlmRequestBytes,
  VLM_REQUEST_SIZE_BUDGET_BYTES,
} from "../../../src/services/payloadBuilder";
import type { SpatialPayload } from "../../../src/types/spatial";
import { DEFAULT_SELECTION_QUERY } from "../../../src/types/vlm";

describe("buildVlmInferenceRequest", () => {
  beforeEach(() => {
    vi.mocked(exportSelectionToBlob).mockReset();
    vi.mocked(exportViewportToBlob).mockReset();
    vi.mocked(blobToBase64).mockReset();
  });

  it("returns imageBase64=\"\" with preserved spatial + queryText for empty selection", async () => {
    const editor = {} as unknown as Parameters<typeof buildVlmInferenceRequest>[0]["editor"];

    const spatial: SpatialPayload = { x: 1, y: 2, width: 3, height: 4 };

    const result = await buildVlmInferenceRequest({
      editor,
      selectedShapeIds: [],
      spatial,
    });

    expect(result.imageBase64).toBe("");
    expect(result.queryText.startsWith(DEFAULT_SELECTION_QUERY)).toBe(true);
    expect(result.spatial).toEqual(spatial);
    expect(result.spatial).not.toBe(spatial); // copied, not the same reference

    expect(exportSelectionToBlob).not.toHaveBeenCalled();
    expect(blobToBase64).not.toHaveBeenCalled();
  });

  it("builds a request by chaining exportSelectionToBlob then blobToBase64", async () => {
    const editor = {} as unknown as Parameters<typeof buildVlmInferenceRequest>[0]["editor"];

    const spatial: SpatialPayload = { x: -10, y: 5, width: 100, height: 40 };
    const selectedShapeIds = ["id-1", "id-2"];

    const blob = new Blob(["image-bytes"], { type: "image/png" });
    vi.mocked(exportSelectionToBlob).mockResolvedValue(blob);
    vi.mocked(blobToBase64).mockResolvedValue("data:image/png;base64,AAAA");

    const result = await buildVlmInferenceRequest({
      editor,
      selectedShapeIds,
      spatial,
    });

    expect(result.imageBase64).toBe("data:image/png;base64,AAAA");
    expect(result.queryText.startsWith(DEFAULT_SELECTION_QUERY)).toBe(true);
    expect(result.spatial).toEqual(spatial);
    expect(result.spatial).not.toBe(spatial);

    expect(exportSelectionToBlob).toHaveBeenCalledWith(editor, selectedShapeIds);
    expect(blobToBase64).toHaveBeenCalledWith(blob);
  });

  it("prefers viewport-bounded export for spatial context; falls back to shape-crop when it fails", async () => {
    const editor = {
      getCurrentPageShapeIds: () => ["id-1", "id-2", "id-3"],
      getViewportPageBounds: () => ({ x: 0, y: 0, width: 1024, height: 768 }),
    } as unknown as Parameters<typeof buildVlmInferenceRequest>[0]["editor"];

    const selectedBlob = new Blob(["selected"], { type: "image/png" });
    const viewportBlob = new Blob(["viewport"], { type: "image/png" });
    vi.mocked(exportSelectionToBlob).mockResolvedValue(selectedBlob);
    vi.mocked(exportViewportToBlob).mockResolvedValue(viewportBlob);
    vi.mocked(blobToBase64).mockImplementation(async (blob) => {
      if (blob === selectedBlob) return "data:image/png;base64,SELECTED";
      if (blob === viewportBlob) return "data:image/png;base64,VIEWPORT";
      return "data:image/png;base64,UNKNOWN";
    });

    const result = await buildVlmInferenceRequest({
      editor,
      selectedShapeIds: ["id-2"],
      spatial: { x: 1, y: 1, width: 10, height: 10 },
    });

    expect(result.imageBase64).toBe("data:image/png;base64,SELECTED");
    expect(result.spatialContextImageBase64).toBe(
      "data:image/png;base64,VIEWPORT",
    );
    expect(exportSelectionToBlob).toHaveBeenCalledWith(editor, ["id-2"]);
    expect(exportViewportToBlob).toHaveBeenCalledWith(editor, [
      "id-1",
      "id-2",
      "id-3",
    ]);
  });

  it("falls back to shape-crop for spatial context when viewport export throws", async () => {
    const editor = {
      getCurrentPageShapeIds: () => ["id-1", "id-2"],
      getViewportPageBounds: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    } as unknown as Parameters<typeof buildVlmInferenceRequest>[0]["editor"];

    const selectedBlob = new Blob(["selected"], { type: "image/png" });
    const cropBlob = new Blob(["crop"], { type: "image/png" });
    vi.mocked(exportSelectionToBlob)
      .mockResolvedValueOnce(selectedBlob)
      .mockResolvedValueOnce(cropBlob);
    vi.mocked(exportViewportToBlob).mockRejectedValue(new Error("no viewport"));
    vi.mocked(blobToBase64).mockImplementation(async (blob) => {
      if (blob === selectedBlob) return "data:image/png;base64,SEL";
      if (blob === cropBlob) return "data:image/png;base64,CROP";
      return "data:image/png;base64,UNKNOWN";
    });

    const result = await buildVlmInferenceRequest({
      editor,
      selectedShapeIds: ["id-1"],
      spatial: { x: 0, y: 0, width: 10, height: 10 },
    });

    expect(result.imageBase64).toBe("data:image/png;base64,SEL");
    // Fallback ran and produced a usable crop.
    expect(result.spatialContextImageBase64).toBe("data:image/png;base64,CROP");
    expect(exportViewportToBlob).toHaveBeenCalledTimes(1);
    expect(exportSelectionToBlob).toHaveBeenNthCalledWith(1, editor, ["id-1"]);
    expect(exportSelectionToBlob).toHaveBeenNthCalledWith(2, editor, [
      "id-1",
      "id-2",
    ]);
  });

  it("returns imageBase64=\"\" while perfectly preserving spatial + queryText when exportSelectionToBlob throws", async () => {
    const editor = {} as unknown as Parameters<typeof buildVlmInferenceRequest>[0]["editor"];

    const spatial: SpatialPayload = { x: 0, y: 0, width: 0, height: 25 };
    const selectedShapeIds = ["id-valid", "id-unknown"];

    vi.mocked(exportSelectionToBlob).mockRejectedValue(
      new Error("export/render timeout"),
    );

    const result = await buildVlmInferenceRequest({
      editor,
      selectedShapeIds,
      spatial,
    });

    expect(result.imageBase64).toBe("");
    expect(result.queryText.startsWith(DEFAULT_SELECTION_QUERY)).toBe(true);
    expect(result.spatial).toEqual(spatial);
    expect(result.spatial).not.toBe(spatial);

    expect(exportSelectionToBlob).toHaveBeenCalledWith(editor, selectedShapeIds);
    expect(blobToBase64).not.toHaveBeenCalled();
  });
});

describe("language directive", () => {
  beforeEach(() => {
    vi.mocked(exportSelectionToBlob).mockReset();
    vi.mocked(exportViewportToBlob).mockReset();
    vi.mocked(blobToBase64).mockReset();
  });

  it("appends 'Respond in English.' by default (no language arg)", async () => {
    const editor = {} as unknown as Parameters<typeof buildVlmInferenceRequest>[0]["editor"];
    const result = await buildVlmInferenceRequest({
      editor,
      selectedShapeIds: [],
      spatial: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(result.queryText.startsWith(DEFAULT_SELECTION_QUERY)).toBe(true);
    expect(result.queryText).toContain("Respond in English.");
  });

  it("appends the requested language directive when provided", async () => {
    const editor = {} as unknown as Parameters<typeof buildVlmInferenceRequest>[0]["editor"];
    const result = await buildVlmInferenceRequest({
      editor,
      selectedShapeIds: [],
      spatial: { x: 0, y: 0, width: 1, height: 1 },
      language: "hi",
    });
    expect(result.queryText.startsWith(DEFAULT_SELECTION_QUERY)).toBe(true);
    expect(result.queryText).toContain("Respond in Hindi.");
  });

  it("preserves the language directive on the export-failure fallback path", async () => {
    const editor = {} as unknown as Parameters<typeof buildVlmInferenceRequest>[0]["editor"];
    vi.mocked(exportSelectionToBlob).mockRejectedValue(new Error("boom"));
    const result = await buildVlmInferenceRequest({
      editor,
      selectedShapeIds: ["id-1"],
      spatial: { x: 0, y: 0, width: 1, height: 1 },
      language: "fr",
    });
    expect(result.imageBase64).toBe("");
    expect(result.queryText).toContain("Respond in French.");
  });

  it("emits 'same language as user' directive (with explicit-request escape) when language is 'auto'", async () => {
    const editor = {} as unknown as Parameters<typeof buildVlmInferenceRequest>[0]["editor"];
    const result = await buildVlmInferenceRequest({
      editor,
      selectedShapeIds: [],
      spatial: { x: 0, y: 0, width: 1, height: 1 },
      language: "auto",
    });
    expect(result.queryText.startsWith(DEFAULT_SELECTION_QUERY)).toBe(true);
    // Match the writing language by default…
    expect(result.queryText).toContain("Respond in the same language the user wrote in");
    // …but allow the VLM to honor an explicit in-question language request.
    expect(result.queryText).toContain("explicitly requests a different language");
    expect(result.queryText).toContain("honor that request");
    // Must NOT contain a hard-coded "Respond in {Language}." directive.
    expect(result.queryText).not.toMatch(/Respond in (English|Spanish|French|German|Italian|Portuguese|Hindi)\./);
  });
});

describe("estimateVlmRequestBytes", () => {
  it("returns stable UTF-8 byte length for JSON.stringify(request)", () => {
    const request = {
      imageBase64: "ab",
      spatial: { x: 1, y: 2, width: 3, height: 4 },
      queryText: DEFAULT_SELECTION_QUERY,
    };
    const a = estimateVlmRequestBytes(request);
    const b = estimateVlmRequestBytes(request);
    expect(a).toBe(b);
    expect(a).toBe(new TextEncoder().encode(JSON.stringify(request)).length);
    expect(a).toBeGreaterThan(100);
    expect(VLM_REQUEST_SIZE_BUDGET_BYTES).toBe(2_500_000);
  });
});

describe("hybrid placement context", () => {
  it("embeds divider and width profile hints when layoutAnalysis is provided", async () => {
    const editor = {} as unknown as Parameters<typeof buildVlmInferenceRequest>[0]["editor"];
    const result = await buildVlmInferenceRequest({
      editor,
      selectedShapeIds: [],
      spatial: { x: 0, y: 0, width: 100, height: 80 },
      layoutAnalysis: {
        layout_style: "COLUMNAR",
        intent_hint: "comparison",
        script_direction: "LTR",
        detected_language: "en",
        detected_script: "Latin",
        language_confidence: 0.93,
        divider_intent: true,
        split_column_context: true,
        width_profile: {
          w_avg: 260,
          min_width: 220,
          max_width: 300,
          sample_count: 4,
        },
      },
    });

    expect(result.placementContext?.divider_intent).toBe(true);
    expect(result.placementContext?.split_column_context).toBe(true);
    expect(result.placementContext?.width_profile?.w_avg).toBe(260);
  });
});

describe("canvasContext", () => {
  it("attaches canvasContext with views when editor APIs are available", async () => {
    const sid = "shape:text-1";
    const vp = { x: 0, y: 0, w: 100, h: 80, minX: 0, maxX: 100, minY: 0, maxY: 80 };
    const tb = { x: 5, y: 5, w: 20, h: 10, minX: 5, maxX: 25, minY: 5, maxY: 15 };
    const editor = {
      getCurrentPageShapeIds: () => [sid],
      getViewportPageBounds: () => vp,
      getShapePageBounds: (id: string) => (id === sid ? tb : null),
      getShape: (id: string) =>
        id === sid ? { id, type: "text", x: 5, y: 5, props: { text: "x" } } : null,
    } as unknown as Parameters<typeof buildVlmInferenceRequest>[0]["editor"];

    const spatial = { x: 5, y: 5, width: 20, height: 10 };
    const result = await buildVlmInferenceRequest({
      editor,
      selectedShapeIds: [sid],
      spatial,
    });

    expect(result.canvasContext?.version).toBe(1);
    expect(result.canvasContext?.views.answerCrop).toEqual(spatial);
    expect(result.canvasContext?.views.layoutViewport).toMatchObject({
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    });
  });
});

