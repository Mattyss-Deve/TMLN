import { useEffect, useState } from 'react';
import { Check, Edit3, Gauge, MapPin, Navigation, Route, X } from 'lucide-react';
import type {
  AccentThemeId,
  TelemetryFrame,
  UnitSystem,
} from '../types/timeline';
import {
  formatClock,
  formatDate,
  formatDistance,
  formatDuration,
  formatSpeed,
  getSpeedUnitLabel,
} from '../utils/format';
import { getCoordKey, resolveVisitDisplayName } from '../utils/geocoder';
import { MODE_COLORS, MODE_LABELS } from '../utils/geo';
import { ACCENT_THEMES } from '../utils/settings';
import { ModeIcon } from './ModeIcon';

interface TelemetryHUDProps {
  frame: TelemetryFrame | null;
  units: UnitSystem;
  accentTheme: AccentThemeId;
  nicknames: Record<string, string>;
  geocodeCache: Record<string, string>;
  onSaveNickname: (lat: number, lng: number, nickname: string) => void;
}

export function TelemetryHUD({
  frame,
  units,
  accentTheme,
  nicknames,
  geocodeCache,
  onSaveNickname,
}: TelemetryHUDProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const activeVisit = frame?.activeVisit ?? null;
  const activeVisitKey = activeVisit
    ? getCoordKey(activeVisit.lat, activeVisit.lng)
    : null;

  useEffect(() => {
    if (editingKey && editingKey !== activeVisitKey) {
      setEditingKey(null);
    }
  }, [activeVisitKey, editingKey]);

  if (!frame) return null;

  const accent = ACCENT_THEMES[accentTheme];
  const modeColor = MODE_COLORS[frame.mode];
  const distanceRatio =
    frame.totalDistanceM > 0
      ? Math.min(100, Math.round((frame.cumulativeDistanceM / frame.totalDistanceM) * 100))
      : Math.round(frame.progress * 100);
  const speedBarRatio = Math.min(100, Math.round((frame.speedKmh / 140) * 100));

  const resolvedVisitName = activeVisit
    ? resolveVisitDisplayName(activeVisit, nicknames, geocodeCache)
    : '';
  const isEditingVisit = Boolean(activeVisitKey && editingKey === activeVisitKey);

  return (
    <div className="w-full max-w-[216px] sm:max-w-[280px] space-y-2 pointer-events-none select-none">
      {/* Main Telemetry Card */}
      <div className="pointer-events-auto rounded-2xl bg-slate-950/80 border border-white/10 backdrop-blur-md shadow-2xl p-2.5 sm:p-3.5 space-y-2 sm:space-y-3">
        {/* Live Clock & Date */}
        <div className="flex items-start justify-between gap-1.5 sm:gap-2">
          <div className="min-w-0">
            <div className="text-[9px] sm:text-[10px] uppercase tracking-wider sm:tracking-widest text-slate-400 font-medium truncate">
              {formatDate(frame.currentTimeMs)}
            </div>
            <div className="text-lg sm:text-2xl font-mono font-semibold tracking-tight text-white tabular-nums leading-tight mt-0.5">
              {formatClock(frame.currentTimeMs)}
            </div>
          </div>

          <div
            className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full border text-[10px] sm:text-[11px] font-semibold shrink-0"
            style={{
              color: modeColor,
              borderColor: `${modeColor}45`,
              backgroundColor: `${modeColor}18`,
            }}
          >
            <ModeIcon mode={frame.mode} className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span className="hidden xs:inline sm:inline">{MODE_LABELS[frame.mode]}</span>
          </div>
        </div>

        {/* Speed & Distance Grid */}
        <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
          <div className="rounded-xl bg-white/[0.03] border border-white/5 p-2 sm:p-2.5">
            <div className="flex items-center gap-1 text-[9px] sm:text-[10px] text-slate-400 uppercase tracking-wider">
              <Gauge className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-slate-400" />
              <span>Speed</span>
            </div>
            <div className="mt-0.5 sm:mt-1 flex items-baseline gap-1">
              <span className="text-base sm:text-lg font-mono font-semibold text-white tabular-nums">
                {formatSpeed(frame.speedKmh, units)}
              </span>
              <span className="text-[9px] sm:text-[10px] text-slate-400">
                {getSpeedUnitLabel(units)}
              </span>
            </div>
            <div className="mt-1 sm:mt-1.5 h-1 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-100"
                style={{
                  width: `${Math.max(frame.speedKmh > 0.5 ? 6 : 0, speedBarRatio)}%`,
                  backgroundColor: modeColor,
                }}
              />
            </div>
          </div>

          <div className="rounded-xl bg-white/[0.03] border border-white/5 p-2 sm:p-2.5">
            <div className="flex items-center gap-1 text-[9px] sm:text-[10px] text-slate-400 uppercase tracking-wider">
              <Route className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-slate-400" />
              <span>Traveled</span>
            </div>
            <div className="mt-0.5 sm:mt-1 flex items-baseline gap-1 truncate">
              <span className="text-base sm:text-lg font-mono font-semibold text-white tabular-nums truncate">
                {formatDistance(frame.cumulativeDistanceM, units)}
              </span>
            </div>
            <div className="mt-1 sm:mt-1.5 h-1 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-100"
                style={{
                  width: `${distanceRatio}%`,
                  backgroundColor: accent.primary,
                }}
              />
            </div>
          </div>
        </div>

        {/* Coordinates & Heading Footer */}
        <div className="flex items-center justify-between text-[9px] sm:text-[10px] text-slate-400 pt-0.5 border-t border-white/5 font-mono tabular-nums">
          <span className="truncate">
            {frame.lat.toFixed(4)}, {frame.lng.toFixed(4)}
          </span>
          <span className="flex items-center gap-1 shrink-0 ml-1">
            <Navigation className="w-2.5 h-2.5" style={{ color: accent.primary }} />
            {Math.round(frame.bearing)}°
          </span>
        </div>
      </div>

      {/* Currently At Place Visit Card (Tap to assign custom nickname) */}
      {activeVisit && (
        <div className="pointer-events-auto rounded-2xl bg-slate-950/85 border border-emerald-400/35 backdrop-blur-md shadow-2xl p-2.5 sm:p-3 space-y-1.5 sm:space-y-2 transition-all">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Currently At</span>
            </div>
            <span className="text-[9px] sm:text-[10px] font-mono text-emerald-200/80 tabular-nums shrink-0">
              {formatDuration(activeVisit.dwellDurationMs)} stay
            </span>
          </div>

          {isEditingVisit ? (
            <form
              className="space-y-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                onSaveNickname(activeVisit.lat, activeVisit.lng, draftName);
                setEditingKey(null);
              }}
            >
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="e.g. Home, Gym, Office..."
                autoFocus
                className="w-full px-2 py-1 rounded-lg bg-slate-900 border border-emerald-400/40 text-xs text-white placeholder:text-slate-500 focus:outline-none"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditingKey(null)}
                  className="px-2 py-1 rounded-md text-[10px] text-slate-400 hover:text-white hover:bg-white/10"
                >
                  <X className="w-3 h-3" />
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/25 border border-emerald-400/40 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/35"
                >
                  <Check className="w-3 h-3" />
                  <span>Save</span>
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingKey(activeVisitKey);
                setDraftName(resolvedVisitName);
              }}
              className="w-full text-left flex items-start gap-2 group rounded-lg hover:bg-white/[0.04] p-0.5 -m-0.5 transition-colors"
              title="Tap to assign a custom nickname"
            >
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center shrink-0 mt-0.5">
                <MapPin className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-300" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] sm:text-xs font-semibold text-white leading-snug truncate">
                    {resolvedVisitName}
                  </span>
                  <Edit3 className="w-2.5 h-2.5 text-slate-400 group-hover:text-emerald-300 shrink-0" />
                </div>
                {activeVisit.address ? (
                  <div className="text-[9px] sm:text-[10px] text-slate-400 truncate mt-0.5">
                    {activeVisit.address}
                  </div>
                ) : activeVisit.semanticType ? (
                  <div className="text-[9px] sm:text-[10px] text-slate-400 truncate mt-0.5">
                    {activeVisit.semanticType.replace(/_/g, ' ')} · Tap to rename
                  </div>
                ) : (
                  <div className="text-[9px] sm:text-[10px] text-slate-400 truncate mt-0.5">
                    Tap to rename place
                  </div>
                )}
              </div>
            </button>
          )}

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
