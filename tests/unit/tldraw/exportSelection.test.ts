import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("tldraw", () => ({
  exportToBlob: vi.fn(),
}));

import { exportToBlob } from "tldraw";
import {
  exportSelectionToBlob,
  exportViewportToBlob,
} from "../../../src/lib/tldraw/exportSelection";

describe("exportSelectionToBlob", () => {
  beforeEach(() => {
    (vi.mocked(exportToBlob) as unknown as { mockReset: () => void }).mockReset();
  });

  it("calls exportToBlob with png and a mixed valid+unknown id array (does not throw)", async () => {
    const editor = {} as unknown as Parameters<typeof exportSelectionToBlob>[0];

    const blob = new Blob(["snapshot"], { type: "image/png" });
    (vi.mocked(exportToBlob) as unknown as { mockResolvedValue: (v: Blob) => void }).mockResolvedValue(blob);

    const selectedShapeIds = ["valid-id-1", "valid-id-2", "unknown-id-3"];

    await expect(
      exportSelectionToBlob(editor, selectedShapeIds),
    ).resolves.toBe(blob);

    // `toHaveBeenCalledWith` and `toHaveBeenCalledTimes` work best on the mocked function itself.
    expect(exportToBlob).toHaveBeenCalledTimes(1);
    expect(exportToBlob).toHaveBeenCalledWith({
      editor,
      ids: selectedShapeIds,
      format: "png",
    });
  });
});

describe("exportViewportToBlob", () => {
  beforeEach(() => {
    (vi.mocked(exportToBlob) as unknown as { mockReset: () => void }).mockReset();
  });

  it("passes viewport bounds from editor.getViewportPageBounds() as the export bounds", async () => {
    const viewport = { x: 10, y: 20, width: 1000, height: 600 };
    const editor = {
      getViewportPageBounds: () => viewport,
    } as unknown as Parameters<typeof exportViewportToBlob>[0];

    const blob = new Blob(["snapshot"], { type: "image/png" });
    (vi.mocked(exportToBlob) as unknown as { mockResolvedValue: (v: Blob) => void }).mockResolvedValue(blob);

    const allShapeIds = ["s1", "s2"];
    await expect(exportViewportToBlob(editor, allShapeIds)).resolves.toBe(blob);

    expect(exportToBlob).toHaveBeenCalledWith({
      editor,
      ids: allShapeIds,
      format: "png",
      opts: {
        bounds: viewport,
        padding: 0,
        background: true,
      },
    });
  });

  it("throws a descriptive error when the viewport bounds are zero-size", async () => {
    const editor = {
      getViewportPageBounds: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    } as unknown as Parameters<typeof exportViewportToBlob>[0];

    await expect(exportViewportToBlob(editor, ["s1"])).rejects.toThrow(
      /invalid viewport bounds/,
    );
    expect(exportToBlob).not.toHaveBeenCalled();
  });
});

