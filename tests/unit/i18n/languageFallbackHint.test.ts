import { describe, expect, it } from "vitest";
import { resolveAutoLanguageDecision } from "../../../src/lib/i18n/autoLanguageDecision";

describe("auto-language fallback hint behavior", () => {
  it("does not show fallback hint for manual language mode", () => {
    const decision = resolveAutoLanguageDecision({
      selectedMode: "es",
      detectedLanguage: "en",
      confidence: 0.2,
    });
    expect(decision.showFallbackHint).toBe(false);
    expect(decision.source).toBe("manual");
  });

  it("shows fallback hint when auto mode uses workspace fallback", () => {
    const decision = resolveAutoLanguageDecision({
      selectedMode: "auto",
      detectedLanguage: "fr",
      confidence: 0.4,
      workspaceDominantLanguage: "en",
    });
    expect(decision.showFallbackHint).toBe(true);
    expect(decision.fallbackReason).toBe("low_confidence_detection");
  });
});
