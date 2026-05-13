import { describe, expect, it } from "vitest";
import { resolveAutoLanguageDecision } from "../../../src/lib/i18n/autoLanguageDecision";

describe("resolveAutoLanguageDecision fallback order", () => {
  it("uses detected language for high-confidence auto selection", () => {
    const decision = resolveAutoLanguageDecision({
      selectedMode: "auto",
      detectedLanguage: "hi",
      confidence: 0.92,
      workspaceDominantLanguage: "en",
    });
    expect(decision.selectedLanguage).toBe("hi");
    expect(decision.source).toBe("detected");
    expect(decision.fallbackApplied).toBe(false);
  });

  it("accepts Kannada as detected language key", () => {
    const decision = resolveAutoLanguageDecision({
      selectedMode: "auto",
      detectedLanguage: "kn",
      confidence: 0.95,
    });
    expect(decision.selectedLanguage).toBe("kn");
    expect(decision.source).toBe("detected");
  });

  it("falls back to workspace dominant language on low confidence", () => {
    const decision = resolveAutoLanguageDecision({
      selectedMode: "auto",
      detectedLanguage: "fr",
      confidence: 0.4,
      workspaceDominantLanguage: "en",
    });
    expect(decision.selectedLanguage).toBe("en");
    expect(decision.source).toBe("workspace_dominant");
    expect(decision.fallbackApplied).toBe(true);
  });

  it("falls back to app default when detected/workspace are unavailable", () => {
    const decision = resolveAutoLanguageDecision({
      selectedMode: "auto",
      detectedLanguage: "unknown",
      confidence: 0.1,
      appDefaultLanguage: "de",
    });
    expect(decision.selectedLanguage).toBe("de");
    expect(decision.source).toBe("app_default");
    expect(decision.fallbackApplied).toBe(true);
  });
});
