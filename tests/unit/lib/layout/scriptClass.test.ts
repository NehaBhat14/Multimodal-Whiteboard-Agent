import { describe, it, expect } from "vitest";
import { classifyScript } from "../../../../src/lib/layout/scriptClass";
import { multilingualLabelFixtures } from "../../../../tests/fixtures/multilingualLabelStrings";

describe("classifyScript", () => {
  it("classifies Hindi fixture as indic_devanagari", () => {
    expect(classifyScript(multilingualLabelFixtures.hi)).toBe("indic_devanagari");
  });

  it("classifies plain English as latin_default", () => {
    expect(classifyScript(multilingualLabelFixtures.en)).toBe("latin_default");
  });

  it("classifies Spanish with ñ / accents as latin_accented", () => {
    expect(classifyScript(multilingualLabelFixtures.es)).toBe("latin_accented");
  });

  it("classifies French with diacritics as latin_accented", () => {
    expect(classifyScript(multilingualLabelFixtures.fr)).toBe("latin_accented");
  });
});
