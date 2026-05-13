import type { Editor } from "tldraw";
import { createShapeId } from "@tldraw/tlschema";
import type { HandwritingPlan } from "./types";

const DEFAULT_STROKE_TICK_MS = 4;
/** Larger = faster. 60-80 approaches instant reveal; 20 feels slower. */
const DEFAULT_POINTS_PER_TICK = 40;

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

export interface AnimateHandwritingOptions {
  tickMs?: number;
  pointsPerTick?: number;
  /** tldraw draw-shape `scale`. Lower = thinner. Default 0.5. */
  strokeScale?: number;
  signal?: AbortSignal;
}

/**
 * Render a {@link HandwritingPlan} as per-subpath `draw` shapes on the tldraw
 * canvas, grown point-by-point. All shapes are wrapped in one `mark` so Undo
 * removes the entire insertion as a single step.
 */
export async function animateHandwriting(
  editor: Editor,
  plan: HandwritingPlan,
  options?: AnimateHandwritingOptions,
): Promise<void> {
  const tickMs = options?.tickMs ?? DEFAULT_STROKE_TICK_MS;
  const pointsPerTick = Math.max(1, options?.pointsPerTick ?? DEFAULT_POINTS_PER_TICK);
  const strokeScale = options?.strokeScale ?? 0.5;
  const signal = options?.signal;

  const markId = `ai-handwriting:${createShapeId()}`;
  editor.mark(markId);

  try {
    for (const glyph of plan.glyphs) {
      for (const subpath of glyph.subpaths) {
        if (subpath.points.length < 2) continue;

        const shapeId = createShapeId();
        // Shape-local coordinates: normalize around the subpath's first point.
        const origin = subpath.points[0];
        const localPoints = subpath.points.map((p) => ({
          x: p.x - origin.x,
          y: p.y - origin.y,
          z: 0.5,
        }));

        // isClosed=false: font outlines are closed paths, but tldraw's
        // isClosed=true fills the enclosed region — that would paint solid
        // letter silhouettes over existing canvas content.
        editor.createShape({
          id: shapeId,
          type: "draw",
          x: origin.x,
          y: origin.y,
          props: {
            segments: [{ type: "free", points: [localPoints[0]] }],
            color: "black",
            size: "s",
            dash: "draw",
            fill: "none",
            isComplete: false,
            isClosed: false,
            isPen: true,
            scale: strokeScale,
          },
        });

        // On abort we abandon the mark silently; touching history here
        // (squash/bail) triggered a visible canvas reflow in practice.
        if (signal?.aborted) return;

        for (let n = 2; n <= localPoints.length; n += pointsPerTick) {
          if (signal?.aborted) return;
          const revealed = localPoints.slice(0, Math.min(n, localPoints.length));
          editor.run(
            () => {
              editor.updateShape({
                id: shapeId,
                type: "draw",
                props: {
                  segments: [{ type: "free", points: revealed }],
                },
              });
            },
            { history: "ignore" },
          );

          if (n < localPoints.length) {
            try {
              await delay(tickMs, signal);
            } catch {
              return;
            }
          }
        }

        // Final update flags the stroke complete (tldraw uses it for rendering tweaks).
        editor.run(
          () => {
            editor.updateShape({
              id: shapeId,
              type: "draw",
              props: {
                segments: [{ type: "free", points: localPoints }],
                isComplete: true,
              },
            });
          },
          { history: "ignore" },
        );
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