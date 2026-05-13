import type { Editor } from "tldraw";
import { createShapeId } from "@tldraw/tlschema";
import type { TextLayoutPlan } from "../layout/types";

const DEFAULT_TICK_MS = 28;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface AnimateTypingTextShapeOptions {
  /** Ms between each revealed UTF-16 code unit. Default 28 (~36 chars/sec). */
  tickMs?: number;
  signal?: AbortSignal;
}

/**
 * Create a text shape and reveal its characters one at a time. All updates
 * use `history: "ignore"`; a final `squashToMark` makes Undo remove the
 * whole insertion in one step.
 */
export async function animateTypingTextShape(
  editor: Editor,
  plan: TextLayoutPlan,
  options?: AnimateTypingTextShapeOptions,
): Promise<void> {
  const tickMs = options?.tickMs ?? DEFAULT_TICK_MS;
  const signal = options?.signal;
  const fullText = plan.textShapeProps.text;

  const shapeId = createShapeId();
  const markId = `ai-typing:${shapeId}`;

  editor.mark(markId);

  try {
    editor.createShape({
      id: shapeId,
      type: "text",
      x: plan.placement.x,
      y: plan.placement.y,
      props: {
        text: "",
        w: plan.textShapeProps.w,
        autoSize: false,
        font: plan.textShapeProps.font,
        size: plan.textShapeProps.size,
        textAlign: plan.textShapeProps.textAlign,
        color: plan.textShapeProps.color,
        scale: plan.textShapeProps.scale,
      },
    });

    if (signal?.aborted) return;

    for (let n = 1; n <= fullText.length; n++) {
      if (signal?.aborted) return;

      const prefix = fullText.slice(0, n);
      editor.run(
        () => {
          editor.updateShape({
            id: shapeId,
            type: "text",
            props: { text: prefix },
          });
        },
        { history: "ignore" },
      );

      if (n < fullText.length) {
        try {
          await delay(tickMs, signal);
        } catch {
          return;
        }
      }
    }

    if (signal?.aborted) return;

    editor.squashToMark(markId);
  } catch (e) {
    // Real errors roll back so we don't leave a half-mutated canvas.
    try {
      editor.bailToMark(markId);
    } catch {}
    throw e;
  }
}
