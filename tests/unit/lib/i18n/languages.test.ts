import { describe, it, expect } from "vitest";
import {
  AUTO_LANGUAGE_LABEL,
  DEFAULT_LANGUAGE_KEY,
  DEFAULT_RESPONSE_LANGUAGE,
  LANGUAGE_CATALOG,
  fontSupportsLanguage,
  primaryScriptFor,
  type LanguageKey,
} from "../../../../src/lib/i18n/languages";

describe("LANGUAGE_CATALOG", () => {
  it("includes all milestone languages with native labels", () => {
    expect(Object.keys(LANGUAGE_CATALOG).sort()).toEqual(
      ["de", "en", "es", "fr", "hi", "it", "kn", "pt"].sort(),
    );
    expect(LANGUAGE_CATALOG.hi.label).toBe("हिन्दी");
    expect(LANGUAGE_CATALOG.kn.label).toBe("ಕನ್ನಡ");
    expect(LANGUAGE_CATALOG.en.promptName).toBe("English");
    expect(LANGUAGE_CATALOG.es.promptName).toBe("Spanish");
  });

  it("uses 'latin' as default language scripts", () => {
    expect(LANGUAGE_CATALOG[DEFAULT_LANGUAGE_KEY].scripts).toContain("latin");
  });

  it("defaults response language option to Auto", () => {
    expect(DEFAULT_RESPONSE_LANGUAGE).toBe("auto");
    expect(AUTO_LANGUAGE_LABEL).toBe("Auto");
  });
});

describe("primaryScriptFor", () => {
  it("returns the most-specific script for the language", () => {
    expect(primaryScriptFor("en")).toBe("latin");
    expect(primaryScriptFor("es")).toBe("latin-ext");
    expect(primaryScriptFor("fr")).toBe("latin-ext");
    expect(primaryScriptFor("hi")).toBe("devanagari");
    expect(primaryScriptFor("kn")).toBe("kannada");
  });
});

describe("fontSupportsLanguage", () => {
  const latinOnly = ["latin"] as const;
  const latinExt = ["latin", "latin-ext"] as const;
  const fullDevanagari = ["latin", "latin-ext", "devanagari"] as const;
  const devanagariOnly = ["devanagari"] as const;
  const kannadaOnly = ["kannada"] as const;

  it("English (latin) is satisfied by any font that includes latin", () => {
    expect(fontSupportsLanguage(latinOnly, "en")).toBe(true);
    expect(fontSupportsLanguage(latinExt, "en")).toBe(true);
    expect(fontSupportsLanguage(fullDevanagari, "en")).toBe(true);
  });

  it("latin-only fonts cannot satisfy latin-ext languages", () => {
    expect(fontSupportsLanguage(latinOnly, "es")).toBe(false);
    expect(fontSupportsLanguage(latinOnly, "fr")).toBe(false);
    expect(fontSupportsLanguage(latinOnly, "de")).toBe(false);
    expect(fontSupportsLanguage(latinOnly, "it")).toBe(false);
    expect(fontSupportsLanguage(latinOnly, "pt")).toBe(false);
  });

  it("latin-ext fonts satisfy all Latin/Latin-ext languages", () => {
    for (const lang of ["en", "es", "fr", "de", "it", "pt"] as LanguageKey[]) {
      expect(fontSupportsLanguage(latinExt, lang)).toBe(true);
    }
  });

  it("only fonts with devanagari satisfy Hindi", () => {
    expect(fontSupportsLanguage(latinOnly, "hi")).toBe(false);
    expect(fontSupportsLanguage(latinExt, "hi")).toBe(false);
    expect(fontSupportsLanguage(devanagariOnly, "hi")).toBe(true);
    expect(fontSupportsLanguage(fullDevanagari, "hi")).toBe(true);
  });

  it("only fonts with kannada satisfy Kannada", () => {
    expect(fontSupportsLanguage(latinOnly, "kn")).toBe(false);
    expect(fontSupportsLanguage(devanagariOnly, "kn")).toBe(false);
    expect(fontSupportsLanguage(kannadaOnly, "kn")).toBe(true);
  });
});
