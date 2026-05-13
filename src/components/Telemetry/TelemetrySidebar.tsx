import React, { useMemo } from "react";
import type { SpatialPayload } from "../../types/spatial";
import { spatialPayloadToTelemetry } from "../../types/spatial";
import { TelemetryJson } from "./TelemetryJson";

export const TelemetrySidebar = React.memo(function TelemetrySidebar({
  payload,
}: {
  payload: SpatialPayload | null;
}) {
  const telemetry = useMemo(
    () => (payload ? spatialPayloadToTelemetry(payload) : null),
    [payload],
  );

  const timestamp = useMemo(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }, [payload]);

  return (
    <aside className="w-1/4 h-full flex flex-col bg-slate-50 border-l border-slate-200 z-30">
      <div className="p-6 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 bg-slate-900 text-white rounded text-[8px] font-mono font-bold">
              TD
            </span>
            <h2 className="font-label text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold">
              tldraw Agent
            </h2>
          </div>
          <div className="flex items-center gap-2 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-label text-[10px] text-emerald-600 font-bold uppercase tracking-tighter">
              Live Sync
            </span>
          </div>
        </div>

        <h1 className="text-2xl font-headline text-slate-900">Telemetry</h1>
      </div>

      <div className="flex-grow p-4 overflow-y-auto font-mono text-xs bg-slate-100">
        {!payload ? (
          <div className="space-y-4">
            <div className="flex gap-3">
              <span className="text-slate-400 shrink-0 select-none">
                {timestamp}
              </span>
              <div className="text-blue-600 font-bold">INFO</div>
              <span className="text-slate-600 italic">
                no active selection
              </span>
            </div>
            <div className="flex items-center gap-2 text-blue-500/50">
              <span className="animate-pulse">_</span>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-3">
              <span className="text-slate-400 shrink-0 select-none">
                {timestamp}
              </span>
              <div className="text-emerald-600 font-bold">SYSTEM</div>
            </div>
            <div className="relative group">
              {/* Derived JSON (x/y + w/h) */}
              <div className="text-slate-700">
                {telemetry ? (
                  <TelemetryJson payload={payload} telemetry={telemetry} />
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
});

