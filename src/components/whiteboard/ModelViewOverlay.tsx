import { useValue, type Editor } from "tldraw";
import type { SpatialPayload } from "../../types/spatial";
import type { CanvasViewBounds } from "../../types/vlm";
import { pageBoxToScreenAabb } from "../../lib/tldraw/pageRectToScreenAabb";

export interface ModelViewOverlayProps {
  editor: Editor | null;
  /** When set, draws the "answer model · crop" rect (page space). */
  answerCrop: SpatialPayload | CanvasViewBounds | null;
  showAnswerCrop: boolean;
  show: boolean;
}

/**
 * Dashed read-only boxes showing what the backend "sees": selection crop and
 * user viewport. `pointer-events: none` so tools keep working.
 */
export function ModelViewOverlay({
  editor,
  answerCrop,
  showAnswerCrop,
  show,
}: ModelViewOverlayProps) {
  useValue(
    "modelViewOverlay",
    () => {
      if (!editor) return "none";
      const c = editor.getCamera();
      const vp = editor.getViewportPageBounds();
      return [
        c.x,
        c.y,
        c.z,
        vp.x,
        vp.y,
        vp.w,
        vp.h,
        answerCrop?.x,
        answerCrop?.y,
        showAnswerCrop,
        show,
      ].join(":");
    },
    [editor, answerCrop, showAnswerCrop, show],
  );

  if (!show || !editor) return null;
  if (typeof editor.getViewportPageBounds !== "function") return null;
  if (typeof editor.pageToScreen !== "function") return null;

  const layoutVp = editor.getViewportPageBounds();
  const layoutStyle = pageBoxToScreenAabb(editor, {
    x: layoutVp.x,
    y: layoutVp.y,
    width: layoutVp.w,
    height: layoutVp.h,
  });

  const answerStyle =
    showAnswerCrop && answerCrop
      ? pageBoxToScreenAabb(editor, {
          x: answerCrop.x,
          y: answerCrop.y,
          width: answerCrop.width,
          height: answerCrop.height,
        })
      : null;

  return (
    <div
      className="model-view-overlay-layer absolute inset-0 z-[10040] pointer-events-none select-none"
      aria-hidden
    >
      <div
        className="model-view-overlay-viewport absolute border-2 border-dashed border-blue-500/80 rounded-sm bg-blue-500/5"
        style={{
          left: layoutStyle.left,
          top: layoutStyle.top,
          width: layoutStyle.width,
          height: layoutStyle.height,
        }}
      />
      {answerStyle ? (
        <div
          className="model-view-overlay-crop absolute border-2 border-dashed border-amber-500/90 rounded-sm bg-amber-500/5"
          style={{
            left: answerStyle.left,
            top: answerStyle.top,
            width: answerStyle.width,
            height: answerStyle.height,
          }}
        />
      ) : null}
      <div className="model-view-overlay-legend absolute top-2 left-2 flex flex-col gap-1 text-[9px] font-mono text-slate-600 dark:text-slate-300 drop-shadow-sm max-w-[14rem]">
        <span className="inline-flex items-center gap-1 rounded bg-white/80 dark:bg-slate-900/80 px-1.5 py-0.5 border border-blue-400/50">
          Layout model · viewport
        </span>
        {answerStyle ? (
          <span className="inline-flex items-center gap-1 rounded bg-white/80 dark:bg-slate-900/80 px-1.5 py-0.5 border border-amber-500/50">
            Answer model · crop
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded bg-slate-100/80 dark:bg-slate-800/80 px-1.5 py-0.5 text-slate-500 border border-slate-300/50 text-[8px]">
            No selection — no answer crop
          </span>
        )}
      </div>
    </div>
  );
}
