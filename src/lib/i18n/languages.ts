/**
 * Response languages. `scripts` are @fontsource subset names a font must
 * cover to render this language; used to filter the font dropdown.
 */
export const LANGUAGE_CATALOG = {
  en: {
    label: "English",
    promptName: "English",
    scripts: ["latin"] as const,
  },
  es: {
    label: "Español",
    promptName: "Spanish",
    scripts: ["latin", "latin-ext"] as const,
  },
  fr: {
    label: "Français",
    promptName: "French",
    scripts: ["latin", "latin-ext"] as const,
  },
  de: {
    label: "Deutsch",
    promptName: "German",
    scripts: ["latin", "latin-ext"] as const,
  },
  it: {
    label: "Italiano",
    promptName: "Italian",
    scripts: ["latin", "latin-ext"] as const,
  },
  pt: {
    label: "Português",
    promptName: "Portuguese",
    scripts: ["latin", "latin-ext"] as const,
  },
  hi: {
    label: "हिन्दी",
    promptName: "Hindi",
    scripts: ["devanagari"] as const,
  },
  kn: {
    label: "ಕನ್ನಡ",
    promptName: "Kannada",
    scripts: ["kannada"] as const,
  },
} as const;

export type LanguageKey = keyof typeof LANGUAGE_CATALOG;
export type ResponseLanguageOption = LanguageKey | "auto";

export const DEFAULT_LANGUAGE_KEY: LanguageKey = "en";
export const DEFAULT_RESPONSE_LANGUAGE: ResponseLanguageOption = "auto";
export const AUTO_LANGUAGE_LABEL = "Auto";

/** Most-specific script for the language (latin-ext beats latin). */
export function primaryScriptFor(language: LanguageKey): string {
  const scripts = LANGUAGE_CATALOG[language].scripts;
  return scripts[scripts.length - 1];
}

/** True when `fontScripts` covers every script `language` requires. */
export function fontSupportsLanguage(
  fontScripts: readonly string[],
  language: LanguageKey,
): boolean {
  const required = LANGUAGE_CATALOG[language].scripts;
  for (const script of required) {
    if (!fontScripts.includes(script)) return false;
  }
  return true;
}
