import type { Editor } from "tldraw";
import type { BoundingBox } from "../../types/spatial";

function toBoundingBox(bounds: {
  x: number;
  y: number;
  maxX: number;
  maxY: number;
}): BoundingBox {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.maxX - bounds.x,
    height: bounds.maxY - bounds.y,
  };
}

/**
 * Read-only adapter that derives selection + bounding-box inputs required for
 * collision-aware padding. It must not mutate the provided `editor`.
 */
export function deriveEditorSelection(
  editor: Editor,
): {
  selectedShapeIds: readonly string[];
  selectedBounds: readonly BoundingBox[];
  unselectedBounds: readonly BoundingBox[];
} {
  // Internally we treat shape IDs as plain strings. `tldraw` uses branded
  // TLShapeId types, but the runtime values are still string IDs.
  const selectedShapeIds = editor.getSelectedShapeIds() as unknown as
    readonly string[];
  const selectedSet = new Set(selectedShapeIds);

  const allShapeIds = Array.from(
    editor.getCurrentPageShapeIds() as unknown as Iterable<string>,
  );
  const unselectedShapeIds = allShapeIds.filter((id) => !selectedSet.has(id));

  const selectedBounds = selectedShapeIds.map((id) => {
    const b = editor.getShapePageBounds(id as any);
    if (!b) throw new Error(`deriveEditorSelection: missing bounds for ${id}`);
    return toBoundingBox(b);
  });

  const unselectedBounds = unselectedShapeIds.map((id) => {
    const b = editor.getShapePageBounds(id as any);
    if (!b) throw new Error(`deriveEditorSelection: missing bounds for ${id}`);
    return toBoundingBox(b);
  });

  return {
    selectedShapeIds,
    selectedBounds,
    unselectedBounds,
  };
}

