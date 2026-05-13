import { describe, it, expect } from "vitest";
import {
  spatialPayloadToTelemetry,
  type SpatialPayload,
} from "../../../src/types/spatial";

describe("telemetry mapping", () => {
  it("maps width/height to w/h", () => {
    const payload: SpatialPayload = {
      x: -3,
      y: 2,
      width: 10,
      height: 4,
    };

    expect(spatialPayloadToTelemetry(payload)).toEqual({
      x: -3,
      y: 2,
      w: 10,
      h: 4,
    });
  });
});

