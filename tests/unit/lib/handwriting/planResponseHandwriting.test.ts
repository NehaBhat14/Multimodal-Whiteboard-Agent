import { describe, it, expect } from "vitest";
import { planResponseHandwriting } from "../../../../src/lib/handwriting/planResponseHandwriting";

describe("planResponseHandwriting", () => {
  it("uses devanagari font + script for Hindi even when English UI + Latin font", () => {
    const p = planResponseHandwriting("दिल्ली क्या है?", "en", "caveat");
    expect(p.mode).toBe("handwriting");
    if (p.mode !== "handwriting") return;
    expect(p.opentypeScript).toBe("devanagari");
    expect(p.fontKey).not.toBe("caveat");
    expect(
      p.fontKey === "kalam" ||
        p.fontKey === "amita" ||
        p.fontKey === "dekko" ||
        p.fontKey === "playpen-sans-deva",
    ).toBe(true);
  });

  it("keeps preferred key when it has Devanagari and text is Indic", () => {
    const p = planResponseHandwriting("नमस्ते", "en", "kalam");
    expect(p).toEqual({
      mode: "handwriting",
      fontKey: "kalam",
      opentypeScript: "devanagari",
    });
  });

  it("uses tldraw text for scripts we do not have handwriting coverage for", () => {
    expect(
      planResponseHandwriting("你好世界", "en", "caveat").mode,
    ).toBe("typewriter");
  });

  it("uses language primary script for Latin", () => {
    const p = planResponseHandwriting("Hello", "en", "patrick-hand");
    expect(p).toEqual({
      mode: "handwriting",
      fontKey: "patrick-hand",
      opentypeScript: "latin",
    });
  });
});
