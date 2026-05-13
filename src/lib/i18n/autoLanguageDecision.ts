import {
  DEFAULT_LANGUAGE_KEY,
  type LanguageKey,
  type ResponseLanguageOption,
} from "./languages";

export type AutoLanguageDecisionInput = {
  selectedMode: ResponseLanguageOption;
  detectedLanguage?: string | null;
  detectedScript?: string | null;
  confidence?: number | null;
  confidenceThreshold?: number;
  workspaceDominantLanguage?: LanguageKey | null;
  appDefaultLanguage?: LanguageKey;
};

export type AutoLanguageDecision = {
  selectedLanguage: LanguageKey;
  source: "manual" | "detected" | "workspace_dominant" | "app_default";
  fallbackApplied: boolean;
  fallbackReason: string | null;
  showFallbackHint: boolean;
  selectedScript: string | null;
};

function isKnownLanguageKey(value: string | null | undefined): value is LanguageKey {
  return (
    value != null &&
    ["en", "es", "fr", "de", "it", "pt", "hi", "kn"].includes(value)
  );
}

export function resolveAutoLanguageDecision(
  input: AutoLanguageDecisionInput,
): AutoLanguageDecision {
  if (input.selectedMode !== "auto") {
    return {
      selectedLanguage: input.selectedMode,
      source: "manual",
      fallbackApplied: false,
      fallbackReason: null,
      showFallbackHint: false,
      selectedScript: input.detectedScript ?? null,
    };
  }

  const threshold = input.confidenceThreshold ?? 0.75;
  const appDefault = input.appDefaultLanguage ?? DEFAULT_LANGUAGE_KEY;
  const confidence = input.confidence ?? 0;

  if (isKnownLanguageKey(input.detectedLanguage) && confidence >= threshold) {
    return {
      selectedLanguage: input.detectedLanguage,
      source: "detected",
      fallbackApplied: false,
      fallbackReason: null,
      showFallbackHint: false,
      selectedScript: input.detectedScript ?? null,
    };
  }

  if (input.workspaceDominantLanguage) {
    return {
      selectedLanguage: input.workspaceDominantLanguage,
      source: "workspace_dominant",
      fallbackApplied: true,
      fallbackReason: "low_confidence_detection",
      showFallbackHint: true,
      selectedScript: input.detectedScript ?? null,
    };
  }

  return {
    selectedLanguage: appDefault,
    source: "app_default",
    fallbackApplied: true,
    fallbackReason: "no_reliable_detected_or_workspace_language",
    showFallbackHint: true,
    selectedScript: input.detectedScript ?? null,
  };
}
