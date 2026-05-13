import { classifyScript } from "../layout/scriptClass";
import { primaryScriptFor, type LanguageKey } from "../i18n/languages";
import { FONT_CATALOG, type HandwritingFontKey } from "./fontLoader";

function catalogCoversScript(
  key: HandwritingFontKey,
  script: string,
): boolean {
  return (FONT_CATALOG[key].scripts as readonly string[]).some(
    (s) => s === script,
  );
}

function firstHandwritingKeyIncludingScript(
  script: "devanagari",
): HandwritingFontKey | null {
  for (const key of Object.keys(FONT_CATALOG) as HandwritingFontKey[]) {
    if (catalogCoversScript(key, script)) return key;
  }
  return null;
}

/**
 * Choose handwriting font + OpenType subset from **response text**, not only UI language.
 * English UI + Hindi answer used to load Latin WOFFs → .notdef “X” glyphpaths.
 */
export function planResponseHandwriting(
  responseText: string,
  languageKey: LanguageKey,
  preferredKey: HandwritingFontKey,
):
  | { mode: "handwriting"; fontKey: HandwritingFontKey; opentypeScript: string }
  | { mode: "typewriter" } {
  const scriptClass = classifyScript(responseText);

  if (scriptClass === "indic_devanagari") {
    const canUsePreferred = catalogCoversScript(preferredKey, "devanagari");
    const fontKey = canUsePreferred
      ? preferredKey
      : firstHandwritingKeyIncludingScript("devanagari");
    if (!fontKey) return { mode: "typewriter" };
    return { mode: "handwriting", fontKey, opentypeScript: "devanagari" };
  }

  if (scriptClass === "other") {
    // No CJK etc. in catalog — tldraw text + system / Noto fallbacks.
    return { mode: "typewriter" };
  }

  return {
    mode: "handwriting",
    fontKey: preferredKey,
    opentypeScript: primaryScriptFor(languageKey),
  };
}
