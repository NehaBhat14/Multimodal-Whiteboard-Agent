/**
 * Representative strings for layout / placement tests (EN, HI, ES, FR).
 * @see specs/007-contextual-harmony-labels/spec.md — grapheme and script coverage.
 */

export const multilingualLabelFixtures = {
  /** English baseline */
  en: "The quick brown fox jumps over the lazy dog.",

  /**
   * Hindi: conjunct (क्ष) and matra stress (ी on preceding consonant).
   * Must not split mid-grapheme when wrapping.
   */
  hi: "प्रेक्षण में क्षत्रिय की मात्रा दिखती है।",

  /** Spanish: acute and ñ */
  es: "Niño camión: acción rápida mañana.",

  /** French: accents and ligature-adjacent patterns */
  fr: "Où est l’été à Noël ? Ça dépend — façade naïve.",
} as const;

export type MultilingualFixtureKey = keyof typeof multilingualLabelFixtures;
