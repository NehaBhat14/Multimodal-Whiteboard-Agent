import { describe, it, expect } from "vitest";
import { computeGeometryFeatures } from "../../../../src/lib/layout/geometryFeatures";
import columnar from "../../../../tests/fixtures/boards/columnar.json";
import researchStack from "../../../../tests/fixtures/boards/research-stack.json";
import { assertSc001Sc004Thresholds } from "./evaluationRunner";

type BoardFixture = {
  id: string;
  shapes: { x: number; y: number; width: number; height: number }[];
  expected_side: string;
};

describe("placementMetrics (fixtures)", () => {
  it("columnar board yields geometry with column signal", () => {
    const f = columnar as BoardFixture;
    const g = computeGeometryFeatures(f.shapes);
    expect(g.columnScore).toBeGreaterThan(0.15);
  });

  it("research-stack board yields vertical stack signal", () => {
    const f = researchStack as BoardFixture;
    const g = computeGeometryFeatures(f.shapes);
    expect(g.verticalStackScore).toBeGreaterThan(0.2);
  });

  it("evaluation runner exports SC-001 / SC-004 placeholder thresholds (T044)", () => {
    const m = assertSc001Sc004Thresholds([]);
    expect(m.alignmentPassRate).toBeGreaterThanOrEqual(0.9);
    expect(m.intentReductionVsAlwaysOn).toBeGreaterThanOrEqual(0.6);
  });
});
