export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SpatialPayload = BoundingBox;

export type SpatialPayloadOrNull = SpatialPayload | null;

// Telemetry uses `w/h` (wire format), mapping from `SpatialPayload.width/height`.
export type TelemetryBoundingBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export function spatialPayloadToTelemetry(
  payload: SpatialPayload,
): TelemetryBoundingBox {
  return {
    x: payload.x,
    y: payload.y,
    w: payload.width,
    h: payload.height,
  };
}

function aabbLeft(b: BoundingBox) {
  return b.x;
}
function aabbRight(b: BoundingBox) {
  return b.x + b.width;
}
function aabbTop(b: BoundingBox) {
  return b.y;
}
function aabbBottom(b: BoundingBox) {
  return b.y + b.height;
}

/**
 * Strict AABB overlap contract:
 * - overlap area must be > 0 on both axes
 * - edge-touching (zero overlap) is NOT an intersection
 */
export function aabbStrictlyOverlaps(a: BoundingBox, b: BoundingBox): boolean {
  const xOverlap =
    Math.min(aabbRight(a), aabbRight(b)) - Math.max(aabbLeft(a), aabbLeft(b));
  if (xOverlap <= 0) return false;

  const yOverlap =
    Math.min(aabbBottom(a), aabbBottom(b)) - Math.max(aabbTop(a), aabbTop(b));
  if (yOverlap <= 0) return false;

  return true;
}

