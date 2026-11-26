import { Gauge, MapPin, Navigation, Route } from 'lucide-react';
import type { TelemetryFrame } from '../types/timeline';
import {
  formatClock,
  formatDate,
  formatDistance,
  formatDuration,
  formatSpeed,
} from '../utils/format';
import { MODE_COLORS, MODE_LABELS } from '../utils/geo';
import { ModeIcon } from './ModeIcon';

interface TelemetryHUDProps {
  frame: TelemetryFrame | null;
}

export function TelemetryHUD({ frame }: TelemetryHUDProps) {
  if (!frame) return null;

  const modeColor = MODE_COLORS[frame.mode];
  const distanceRatio =
    frame.totalDistanceM > 0
      ? Math.min(100, Math.round((frame.cumulativeDistanceM / frame.totalDistanceM) * 100))
      : Math.round(frame.progress * 100);
  const speedBarRatio = Math.min(100, Math.round((frame.speedKmh / 140) * 100));

  return (
    <div className="fixed top-3 right-3 z-20 w-[min(86vw,284px)] space-y-2.5 pointer-events-none select-none">
      {/* Main Telemetry Card */}
      <div className="pointer-events-auto rounded-2xl bg-slate-950/80 border border-white/10 backdrop-blur-md shadow-2xl p-3.5 space-y-3">
        {/* Live Clock & Date */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-medium">
              {formatDate(frame.currentTimeMs)}
            </div>
            <div className="text-2xl font-mono font-semibold tracking-tight text-white tabular-nums leading-tight mt-0.5">
              {formatClock(frame.currentTimeMs)}
            </div>
          </div>

          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold shrink-0"
            style={{
              color: modeColor,
              borderColor: `${modeColor}45`,
              backgroundColor: `${modeColor}18`,
            }}
          >
            <ModeIcon mode={frame.mode} className="w-3.5 h-3.5" />
            <span>{MODE_LABELS[frame.mode]}</span>
          </div>
        </div>

        {/* Speed & Distance Grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-white/[0.03] border border-white/5 p-2.5">
            <div className="flex items-center gap-1 text-[10px] text-slate-400 uppercase tracking-wider">
              <Gauge className="w-3 h-3 text-slate-400" />
              <span>Speed</span>
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-lg font-mono font-semibold text-white tabular-nums">
                {formatSpeed(frame.speedKmh)}
              </span>
              <span className="text-[10px] text-slate-400">km/h</span>
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-100"
                style={{
                  width: `${Math.max(frame.speedKmh > 0.5 ? 6 : 0, speedBarRatio)}%`,
                  backgroundColor: modeColor,
                }}
              />
            </div>
          </div>

          <div className="rounded-xl bg-white/[0.03] border border-white/5 p-2.5">
            <div className="flex items-center gap-1 text-[10px] text-slate-400 uppercase tracking-wider">
              <Route className="w-3 h-3 text-slate-400" />
              <span>Traveled</span>
            </div>
            <div className="mt-1 flex items-baseline gap-1 truncate">
              <span className="text-lg font-mono font-semibold text-white tabular-nums truncate">
                {formatDistance(frame.cumulativeDistanceM)}
              </span>
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-cyan-400 transition-all duration-100"
                style={{ width: `${distanceRatio}%` }}
              />
            </div>
          </div>
        </div>

        {/* Coordinates & Heading Footer */}
        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5 border-t border-white/5 font-mono tabular-nums">
          <span>
            {frame.lat.toFixed(4)}, {frame.lng.toFixed(4)}
          </span>
          <span className="flex items-center gap-1">
            <Navigation className="w-2.5 h-2.5 text-cyan-400" />
            {Math.round(frame.bearing)}°
          </span>
        </div>
      </div>

      {/* Currently At Place Visit Card */}
      {frame.activeVisit && (
        <div className="pointer-events-auto rounded-2xl bg-slate-950/85 border border-emerald-400/35 backdrop-blur-md shadow-2xl p-3 space-y-2 transition-all">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Currently At</span>
            </div>
            <span className="text-[10px] font-mono text-emerald-200/80 tabular-nums">
              {formatDuration(frame.activeVisit.dwellDurationMs)} stay
            </span>
          </div>

          <div className="flex items-start gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center shrink-0 mt-0.5">
              <MapPin className="w-3.5 h-3.5 text-emerald-300" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white leading-snug truncate">
                {frame.activeVisit.name}
              </div>
              {frame.activeVisit.address ? (
                <div className="text-[10px] text-slate-400 truncate mt-0.5">
                  {frame.activeVisit.address}
                </div>
              ) : frame.activeVisit.semanticType ? (
                <div className="text-[10px] text-slate-400 truncate mt-0.5">
                  {frame.activeVisit.semanticType.replace(/_/g, ' ')}
                </div>
              ) : null}
            </div>
          </div>

          <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-emerald-400 transition-all duration-100"
              style={{ width: `${Math.round(frame.activeVisitProgress * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
