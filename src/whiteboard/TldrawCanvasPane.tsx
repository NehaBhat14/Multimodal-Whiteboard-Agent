import React from "react";
import { Tldraw } from "tldraw";
import type { Editor } from "tldraw";

export type TldrawCanvasPaneProps = {
  onEditorMount: (editor: Editor) => void;
};

/**
 * Memoized canvas wrapper so selection/payload React updates do not cause
 * the `<Tldraw />` subtree to unmount or re-render unnecessarily.
 */
export const TldrawCanvasPane = React.memo(function TldrawCanvasPane({
  onEditorMount,
}: TldrawCanvasPaneProps) {
  return <Tldraw onMount={onEditorMount} />;
});

