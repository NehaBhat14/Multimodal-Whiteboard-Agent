import type { SpatialPayload, TelemetryBoundingBox } from "../../types/spatial";
import { spatialPayloadToTelemetry } from "../../types/spatial";

export function TelemetryJson({
  payload,
  telemetry,
}: {
  payload: SpatialPayload | null;
  telemetry?: TelemetryBoundingBox | null;
}): JSX.Element | null {
  if (!payload) return null;

  const t = telemetry ?? spatialPayloadToTelemetry(payload);

  // Keep rendering intentionally simple: JSON in a code-style block with colored keys.
  return (
    <pre className="p-4 bg-white rounded-lg border border-slate-200 shadow-sm text-slate-700 leading-relaxed overflow-x-hidden font-mono text-xs">
      {"{"}
      {"\n"}
      {"  "}
      <span className="text-blue-500">"x"</span>: {t.x},{"\n"}
      {"  "}
      <span className="text-blue-500">"y"</span>: {t.y},{"\n"}
      {"  "}
      <span className="text-blue-500">"w"</span>: {t.w},{"\n"}
      {"  "}
      <span className="text-blue-500">"h"</span>: {t.h}{"\n"}
      {"}"}
    </pre>
  );
}

