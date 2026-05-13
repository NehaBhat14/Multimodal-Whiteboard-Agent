import { describe, expect, it } from "vitest";
import { resolveAutoLanguageDecision } from "../../../src/lib/i18n/autoLanguageDecision";

describe("auto language selector flow", () => {
  it("shows fallback hint when auto falls back from low confidence", () => {
    const decision = resolveAutoLanguageDecision({
      selectedMode: "auto",
      detectedLanguage: "fr",
      confidence: 0.2,
      workspaceDominantLanguage: "en",
    });
    expect(decision.fallbackApplied).toBe(true);
    expect(decision.showFallbackHint).toBe(true);
  });
});
