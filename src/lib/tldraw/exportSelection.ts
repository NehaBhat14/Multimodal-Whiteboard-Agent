import { exportToBlob } from "tldraw";
import type { Editor, TLShapeId } from "tldraw";

/**
 * Isolation boundary for the tldraw export operation.
 *
 * Contract:
 * - Uses first-party `exportToBlob`
 * - Hardcodes `format: "png"`
 * - Passes `selectedShapeIds` through without deduplicating/filtering
 */
export async function exportSelectionToBlob(
  editor: Editor,
  selectedShapeIds: readonly string[],
): Promise<Blob> {
  return exportToBlob({
    editor,
    ids: selectedShapeIds as unknown as TLShapeId[],
    format: "png",
  });
}

/**
 * Full-canvas export for the spatial-reasoning pass. Unlike the tight
 * shape-bounds crop, this renders the current viewport so the VLM sees empty
 * canvas space too — crucial for decisions like "is there room for the
 * answer on the other side of the divider?".
 *
 * Contract:
 * - `allShapeIds` MUST be all page shape IDs (caller passes them in; we don't
 *   re-derive from the editor to avoid unbound-method pitfalls).
 * - `bounds` override comes from {@link Editor.getViewportPageBounds}, which
 *   is in page coordinates — matching the coordinate space the rest of the
 *   layout engine operates in.
 */
export async function exportViewportToBlob(
  editor: Editor,
  allShapeIds: readonly string[],
): Promise<Blob> {
  const viewport = editor.getViewportPageBounds();
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
    throw new Error(
      `exportViewportToBlob: invalid viewport bounds ${JSON.stringify(viewport)}`,
    );
  }
  return exportToBlob({
    editor,
    ids: allShapeIds as unknown as TLShapeId[],
    format: "png",
    opts: {
      bounds: viewport,
      padding: 0,
      background: true,
    },
  });
}

