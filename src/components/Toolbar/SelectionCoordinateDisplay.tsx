import React, { useMemo } from "react";
import type { SpatialPayload } from "../../types/spatial";

export const SelectionCoordinateDisplay = React.memo(function SelectionCoordinateDisplay({
  payload,
}: {
  payload: SpatialPayload | null;
}) {
  const centroid = useMemo(() => {
    if (!payload) return null;
    return {
      x: payload.x + payload.width / 2,
      y: payload.y + payload.height / 2,
    };
  }, [payload]);

  return (
    <div className="flex items-center gap-4 px-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-slate-400">
          X: {centroid ? centroid.x.toFixed(1) : "--"}
        </span>
        <span className="font-mono text-[10px] text-slate-400">
          Y: {centroid ? centroid.y.toFixed(1) : "--"}
        </span>
      </div>
    </div>
  );
});

