import { useEffect, useState } from "react";
import { useValue, type Editor } from "tldraw";
import { deriveEditorSelection } from "../lib/tldraw/editorSelectionAdapter";
import { computeEnclosingBoundingBox } from "../lib/spatial/computeEnclosingBoundingBox";
import { applyCollisionAwarePadding } from "../lib/spatial/applyCollisionAwarePadding";
import type { SpatialPayload } from "../types/spatial";

const DEFAULT_MAX_PADDING = 16;

function payloadEquals(a: SpatialPayload | null, b: SpatialPayload | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function useTldrawSelectionSpatialPayload(
  editor: Editor | null | undefined,
  maxPadding: number = DEFAULT_MAX_PADDING,
): { payload: SpatialPayload | null; selectedShapeIds: string[] } {
  const [payload, setPayload] = useState<SpatialPayload | null>(null);
  const safeMaxPadding = Math.max(0, maxPadding);

  const selectedIds = useValue("selection", () => editor?.getSelectedShapeIds() || [], [editor]);
  const isInteracting = useValue(
    "interacting",
    () => {
      const instanceState = editor?.getInstanceState() as { isInteracting?: boolean } | undefined;
      return instanceState?.isInteracting || false;
    },
    [editor],
  );

  useEffect(() => {
    if (!editor) {
      setPayload(null);
      return;
    }

    if (selectedIds.length === 0) {
      setPayload(null);
      return;
    }

    if (isInteracting) return;

    const { selectedBounds, unselectedBounds } = deriveEditorSelection(editor);
    const strictBBox = computeEnclosingBoundingBox(selectedBounds);
    const paddedBBox = applyCollisionAwarePadding(
      strictBBox,
      unselectedBounds,
      safeMaxPadding,
    );

    setPayload((prev) => (payloadEquals(prev, paddedBBox) ? prev : paddedBBox));
  }, [editor, selectedIds, isInteracting]);

  return { payload, selectedShapeIds: [...selectedIds] };
}

