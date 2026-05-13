/** Tuning constants — see specs/007-contextual-harmony-labels/research.md §4 */

export const LINE_HEIGHT_MULT_INDIC = 1.62;
export const LINE_HEIGHT_MULT_LATIN = 1.22;
export const WIDTH_FUDGE_LATIN_ACCENTED = 1.18;

/** Nominal font size (px) for `size: m` + `font: draw` approximation. */
export const TLDRAW_LIKE_FONT_PX = 28;

/** CSS stack approximating tldraw body draw text for Canvas 2D measurement. */
export const TLDRAW_LIKE_FONT_CSS = `${TLDRAW_LIKE_FONT_PX}px "tldraw_draw", "Segoe UI", system-ui, sans-serif`;

/**
 * Canvas measurement + browser fallback for Devanagari (`@fontsource` loaded in `main.tsx`).
 * Keeps wrap width estimates closer to real tldraw `sans` + system fallback for Hindi.
 */
export const TLDRAW_LIKE_FONT_CSS_DEVANAGARI = `${TLDRAW_LIKE_FONT_PX}px "Noto Sans Devanagari", "tldraw_sans", "Segoe UI", system-ui, sans-serif`;

export const FORBIDDEN_PADDING_SYMMETRIC_PX = 8;
