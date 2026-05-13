import type { ScriptClass } from "./placementContextTypes";
import { splitGraphemeSegments } from "./graphemeSegments";

const DEVA_START = 0x0900;
const DEVA_END = 0x097f;
const LATIN_EXTENDED_END = 0x024f;

function isLatinRange(cp: number): boolean {
  return cp <= LATIN_EXTENDED_END;
}

function hasAccentedLatinMarks(s: string): boolean {
  return /[\u00C0-\u024F\u0300-\u036F]/.test(s) || /[àáâãäåèéêëìíîïñòóôõöùúûüýÿçÀÁÂÃÄÅÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸÇ]/.test(s);
}

/**
 * Dominant-script classification for sizing / telemetry (research §3).
 */
export function classifyScript(text: string): ScriptClass {
  const { segments } = splitGraphemeSegments(text);
  if (segments.length === 0) return "latin_default";

  let devanagari = 0;
  let latin = 0;
  let other = 0;

  for (const g of segments) {
    const cp = g.codePointAt(0)!;
    if (cp >= DEVA_START && cp <= DEVA_END) devanagari++;
    else if (isLatinRange(cp)) latin++;
    else other++;
  }

  if (devanagari > latin && devanagari >= other) return "indic_devanagari";
  if (other > latin && other > devanagari) return "other";
  if (hasAccentedLatinMarks(text)) return "latin_accented";
  return "latin_default";
}
