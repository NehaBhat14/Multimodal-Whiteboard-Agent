import type { Box, Editor, TLShape, TLShapeId } from "tldraw";
import type {
  CanvasContext,
  CanvasViewBounds,
  PeripheralCluster,
  SimplifiedShapeRef,
} from "../../types/vlm";
import type { SpatialPayload } from "../../types/spatial";

const CANVAS_CONTEXT_VERSION = 1 as const;

const MAX_TEXT_SNIPPET = 200;
const MAX_VIEWPORT_SHAPES = 40;
const MAX_PERIPHERAL_CLUSTERS = 20;
const GRID = 400;

/** Sub-cap for JSON size of `canvasContext` (UTF-8 bytes) before we trim lists. */
export const CANVAS_CONTEXT_BUDGET_BYTES = 300_000;

function boxToViewBounds(b: Box): CanvasViewBounds {
  return { x: b.x, y: b.y, width: b.w, height: b.h };
}

function shapeToSimplified(
  editor: Editor,
  id: TLShapeId,
  opts: { maxText?: number } = {},
): SimplifiedShapeRef | null {
  const shape = editor.getShape(id);
  if (!shape) return null;
  const b = editor.getShapePageBounds(id);
  if (!b) return null;
  const base: SimplifiedShapeRef = {
    id: String(id),
    type: shape.type,
    x: b.x,
    y: b.y,
    width: b.w,
    height: b.h,
  };
  if (shape.type === "text") {
    const t = (shape as TLShape & { props: { text?: string } }).props.text ?? "";
    const max = opts.maxText ?? MAX_TEXT_SNIPPET;
    if (t.length > 0) {
      base.text = t.length > max ? `${t.slice(0, max)}…` : t;
    }
  }
  return base;
}

function isInViewport(pageBounds: Box, vp: Box): boolean {
  return !(
    pageBounds.maxX < vp.x ||
    pageBounds.x > vp.maxX ||
    pageBounds.maxY < vp.y ||
    pageBounds.y > vp.maxY
  );
}

function clusterKey(cx: number, cy: number, grid: number): string {
  const gx = Math.floor(cx / grid);
  const gy = Math.floor(cy / grid);
  return `${gx},${gy}`;
}

/**
 * Coarse clusters for shapes whose page bounds are outside the viewport
 * (centers used for bucketing).
 */
function buildPeripheralClusters(
  editor: Editor,
  pageIds: readonly TLShapeId[],
  vp: Box,
  maxClusters: number,
): PeripheralCluster[] {
  const map = new Map<
    string,
    { minX: number; minY: number; maxX: number; maxY: number; count: number }
  >();

  for (const id of pageIds) {
    const b = editor.getShapePageBounds(id);
    if (!b) continue;
    if (isInViewport(b, vp)) continue;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const k = clusterKey(cx, cy, GRID);
    const cur = map.get(k);
    if (cur) {
      cur.minX = Math.min(cur.minX, b.x);
      cur.minY = Math.min(cur.minY, b.y);
      cur.maxX = Math.max(cur.maxX, b.maxX);
      cur.maxY = Math.max(cur.maxY, b.maxY);
      cur.count += 1;
    } else {
      map.set(k, {
        minX: b.x,
        minY: b.y,
        maxX: b.maxX,
        maxY: b.maxY,
        count: 1,
      });
    }
  }

  const out: PeripheralCluster[] = [];
  for (const v of map.values()) {
    out.push({
      x: v.minX,
      y: v.minY,
      width: v.maxX - v.minX,
      height: v.maxY - v.minY,
      count: v.count,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out.slice(0, maxClusters);
}

export interface BuildCanvasContextOptions {
  maxViewportShapes?: number;
  maxPeripheralClusters?: number;
  maxTextSnippet?: number;
}

/**
 * Build structured canvas context for the reasoning API: views, selection,
 * in-viewport shapes, and peripheral clusters.
 */
export function buildCanvasContext(
  editor: Editor,
  selectedShapeIds: readonly string[],
  answerCropFromSpatial: SpatialPayload | null,
  options: BuildCanvasContextOptions = {},
): CanvasContext {
  const maxVp = options.maxViewportShapes ?? MAX_VIEWPORT_SHAPES;
  const maxPer = options.maxPeripheralClusters ?? MAX_PERIPHERAL_CLUSTERS;
  const maxText = options.maxTextSnippet ?? MAX_TEXT_SNIPPET;

  const vp = editor.getViewportPageBounds();
  const layoutViewport: CanvasViewBounds = boxToViewBounds(vp);

  const pageIds: readonly TLShapeId[] = Array.from(
    editor.getCurrentPageShapeIds(),
  );
  const selectedSet = new Set(selectedShapeIds as string[]);

  const answerCrop: CanvasViewBounds | null =
    selectedShapeIds.length > 0 && answerCropFromSpatial
      ? {
          x: answerCropFromSpatial.x,
          y: answerCropFromSpatial.y,
          width: answerCropFromSpatial.width,
          height: answerCropFromSpatial.height,
        }
      : null;

  const selectionShapes: SimplifiedShapeRef[] = [];
  for (const id of selectedShapeIds) {
    const s = shapeToSimplified(editor, id as TLShapeId, { maxText });
    if (s) selectionShapes.push(s);
  }

  const viewportCandidateIds: TLShapeId[] = [];
  for (const id of pageIds) {
    if (selectedSet.has(String(id))) continue;
    const b = editor.getShapePageBounds(id);
    if (b && isInViewport(b, vp)) viewportCandidateIds.push(id);
  }

  const viewportShapeTotal = viewportCandidateIds.length;
  const viewportShapes: SimplifiedShapeRef[] = [];
  for (let i = 0; i < viewportCandidateIds.length && i < maxVp; i++) {
    const s = shapeToSimplified(editor, viewportCandidateIds[i]!, { maxText });
    if (s) viewportShapes.push(s);
  }

  const peripheral = buildPeripheralClusters(
    editor,
    pageIds,
    vp,
    maxPer,
  );

  return {
    version: CANVAS_CONTEXT_VERSION,
    pageShapeCount: pageIds.length,
    views: { answerCrop, layoutViewport },
    selectionShapes,
    viewportShapes,
    viewportShapeTotal:
      viewportShapeTotal > viewportShapes.length
        ? viewportShapeTotal
        : undefined,
    peripheral,
  };
}

/**
 * Reduce `canvasContext` size until `JSON.stringify` is under `budgetBytes` (UTF-8).
 */
export function trimCanvasContextForBudget(
  ctx: CanvasContext,
  budgetBytes: number = CANVAS_CONTEXT_BUDGET_BYTES,
): CanvasContext {
  const measure = (c: CanvasContext): number =>
    new TextEncoder().encode(JSON.stringify(c)).length;

  let current = { ...ctx };
  if (measure(current) <= budgetBytes) return current;

  // 1) Drop viewport shapes
  current = {
    ...current,
    viewportShapes: [],
    viewportShapeTotal: ctx.viewportShapeTotal ?? ctx.viewportShapes.length,
  };
  if (measure(current) <= budgetBytes) return current;

  // 2) Drop peripheral
  current = { ...current, peripheral: [] };
  if (measure(current) <= budgetBytes) return current;

  // 3) Trim selection shape text
  const trimmed = ctx.selectionShapes.map((s) =>
    s.text
      ? { ...s, text: s.text.slice(0, 64) + (s.text.length > 64 ? "…" : "") }
      : s,
  );
  current = { ...current, selectionShapes: trimmed };
  if (measure(current) <= budgetBytes) return current;

  // 4) Last resort: clear selection text entirely
  const noText: SimplifiedShapeRef[] = current.selectionShapes.map((s) => {
    const { text: _omit, ...rest } = s;
    return rest;
  });
  current = { ...current, selectionShapes: noText };
  return current;
}
