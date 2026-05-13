import { TLDRAW_LIKE_FONT_CSS } from "./layoutConstants";

let canvas: HTMLCanvasElement | null = null;

function get2d(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  try {
    if (!canvas) canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    if (typeof ctx.measureText !== "function") return null;
    return ctx;
  } catch {
    return null;
  }
}

function heuristicWidth(text: string, fontCss: string): number {
  const m = /^(\d+)/.exec(fontCss);
  const px = m ? parseInt(m[1]!, 10) : 16;
  return text.length * px * 0.55;
}

/**
 * Width of `text` in px using Canvas 2D `measureText` and a tldraw-like font string.
 */
export function measureTldrawLikeTextWidth(
  text: string,
  fontCss: string = TLDRAW_LIKE_FONT_CSS,
): number {
  const ctx = get2d();
  if (!ctx) return heuristicWidth(text, fontCss);
  try {
    ctx.font = fontCss;
    return ctx.measureText(text).width;
  } catch {
    return heuristicWidth(text, fontCss);
  }
}
