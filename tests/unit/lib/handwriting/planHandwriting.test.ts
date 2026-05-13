import { describe, it, expect } from "vitest";
import type { Font, Glyph, PathCommand } from "opentype.js";
import { planHandwriting } from "../../../../src/lib/handwriting/textToGlyphStrokes";

/**
 * Minimal Font stub: each glyph is a single horizontal line segment at
 * advanceWidth `w` per char. Whitespace glyphs return an empty path.
 */
function makeStubFont(unitsPerEm = 1000, advancePerChar = 500): Font {
  const getGlyph = (char: string): Glyph => {
    const isSpace = /\s/.test(char);
    return {
      advanceWidth: isSpace ? advancePerChar * 0.5 : advancePerChar,
      getPath(x: number, y: number, fontSize: number) {
        const scale = fontSize / unitsPerEm;
        const cmds: PathCommand[] = isSpace
          ? []
          : [
              { type: "M", x, y },
              { type: "L", x: x + advancePerChar * scale, y },
            ];
        return { commands: cmds };
      },
    } as unknown as Glyph;
  };

  return {
    unitsPerEm,
    charToGlyph: (char: string) => getGlyph(char),
    getAdvanceWidth: (text: string, fontSize: number) => {
      const scale = fontSize / unitsPerEm;
      let w = 0;
      for (const c of text) {
        const isSpace = /\s/.test(c);
        w += (isSpace ? advancePerChar * 0.5 : advancePerChar) * scale;
      }
      return w;
    },
  } as unknown as Font;
}

describe("planHandwriting", () => {
  it("emits a glyph in input order for each non-empty char", () => {
    const plan = planHandwriting({
      text: "AB",
      font: makeStubFont(),
      placement: { x: 0, y: 0, width: 1000, height: 200 },
      fontSize: 100,
    });
    expect(plan.glyphs.map((g) => g.char)).toEqual(["A", "B"]);
    expect(plan.lineCount).toBe(1);
    expect(plan.truncated).toBe(false);
  });

  it("advances the pen origin by glyph advance width", () => {
    const plan = planHandwriting({
      text: "AB",
      font: makeStubFont(1000, 500),
      placement: { x: 0, y: 0, width: 1000, height: 200 },
      fontSize: 100, // scale = 0.1 → advancePerChar on canvas = 50
      letterSpacing: 0,
    });
    expect(plan.glyphs[0].origin.x).toBe(0);
    expect(plan.glyphs[1].origin.x).toBeCloseTo(50, 5);
    // Both on same baseline since only one line.
    expect(plan.glyphs[0].origin.y).toBe(plan.glyphs[1].origin.y);
  });

  it("adds letterSpacing between every glyph advance", () => {
    const plan = planHandwriting({
      text: "AB",
      font: makeStubFont(1000, 500),
      placement: { x: 0, y: 0, width: 1000, height: 200 },
      fontSize: 100,
      letterSpacing: 20,
    });
    expect(plan.glyphs[0].origin.x).toBe(0);
    // 50 advance + 20 letterSpacing after A = 70
    expect(plan.glyphs[1].origin.x).toBeCloseTo(70, 5);
  });

  it("wraps to a second line when text exceeds placement width", () => {
    // Each char is 50 canvas-units wide at fontSize=100. 40 chars → 2000 units.
    // placement width 500 → wraps to multiple lines.
    const plan = planHandwriting({
      text: "a b c d e f g h i j",
      font: makeStubFont(1000, 500),
      placement: { x: 0, y: 0, width: 500, height: 1000 },
      fontSize: 100,
    });
    expect(plan.lineCount).toBeGreaterThan(1);
    const ys = Array.from(new Set(plan.glyphs.map((g) => g.origin.y)));
    expect(ys.length).toBe(plan.lineCount);
    // Monotonically increasing baselines.
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
  });

  it("truncates when total lines exceed placement height", () => {
    // fontSize 100, lineHeight 1.4 * 100 = 140. Placement height 200 → 1 line max.
    const plan = planHandwriting({
      text: "a b c d e f g h i j k l m",
      font: makeStubFont(1000, 500),
      placement: { x: 0, y: 0, width: 300, height: 200 },
      fontSize: 100,
    });
    expect(plan.truncated).toBe(true);
    expect(plan.lineCount).toBe(1);
  });

  it("skips whitespace glyphs but keeps pen advancing", () => {
    const plan = planHandwriting({
      text: "A B",
      font: makeStubFont(1000, 500),
      placement: { x: 0, y: 0, width: 1000, height: 200 },
      fontSize: 100,
      letterSpacing: 0,
    });
    // Whitespace produces no glyph entry — A and B only.
    expect(plan.glyphs.map((g) => g.char)).toEqual(["A", "B"]);
    // B's x accounts for the space in between (50 + 25 = 75).
    expect(plan.glyphs[1].origin.x).toBeCloseTo(75, 5);
  });

  it("reports textLength across the rendered (post-truncation) lines", () => {
    const plan = planHandwriting({
      text: "abcde fghij",
      font: makeStubFont(1000, 500),
      placement: { x: 0, y: 0, width: 1000, height: 500 },
      fontSize: 100,
    });
    expect(plan.textLength).toBeGreaterThan(0);
    // All 11 chars fit in one line here (11 * 50 = 550 ≤ 1000? Actually space is 25,
    // so 10 non-space + 1 space = 10*50 + 25 = 525 ≤ 1000). textLength counts
    // all chars including spaces.
    expect(plan.textLength).toBe(11);
  });

  it("with preWrappedLines does not truncate when placement height fits fewer rows", () => {
    const font = makeStubFont(1000, 500);
    const preWrappedLines = ["aaaa", "bbbb", "cccc"];
    const plan = planHandwriting({
      text: "unused for layout",
      font,
      placement: { x: 0, y: 0, width: 1000, height: 200 },
      fontSize: 100,
      lineHeight: 160,
      preWrappedLines,
    });
    expect(plan.truncated).toBe(false);
    expect(plan.lineCount).toBe(3);
    expect(plan.textLength).toBe(
      preWrappedLines.reduce((n, l) => n + l.length, 0),
    );
  });
});