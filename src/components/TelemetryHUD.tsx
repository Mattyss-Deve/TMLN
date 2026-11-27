import { useEffect, useState } from 'react';
import { Check, Edit3, MapPin, X } from 'lucide-react';
import type {
  AccentThemeId,
  SolarPosition,
  TelemetryFrame,
  UnitSystem,
} from '../types/timeline';
import {
  formatClock,
  formatDistance,
  formatDuration,
  formatSpeed,
  getSpeedUnitLabel,
} from '../utils/format';
import { getCoordKey, resolveVisitDisplayName } from '../utils/geocoder';
import { clamp, MODE_COLORS, MODE_LABELS } from '../utils/geo';
import { computeSolarPosition, getSolarPhaseAccent } from '../utils/solar';
import { ModeIcon } from './ModeIcon';

interface TelemetryHUDProps {
  frame: TelemetryFrame | null;
  units: UnitSystem;
  accentTheme: AccentThemeId;
  solarSync: boolean;
  nicknames: Record<string, string>;
  geocodeCache: Record<string, string>;
  onSaveNickname: (lat: number, lng: number, nickname: string) => void;
}

/**
 * Compact precision sun/moon horizon arc visual indicator.
 * Shows current solar elevation relative to the horizon line and morning/evening side.
 */
function SolarHorizonArc({ solar }: { solar: SolarPosition }) {
  const color = getSolarPhaseAccent(solar.phase);
  // Map azimuth progress across arc: morning (East < 180°) sits left -> apex, afternoon right
  const isMorning = solar.azimuthDeg < 180;
  const elevNorm = clamp(solar.elevationDeg / 65, -1, 1); // -1 (deep night) .. +1 (high noon)

  // Horizon line at y=13 in a 30x18 viewBox; arc spans x=3..27
  const cx = 15;
  const horizonY = 13;
  const rx = 11;
  const ry = 9.5;

  // Compute orb position along upper sun arc (day) or subtle lower moon dip (night)
  let orbX: number;
  let orbY: number;
  if (elevNorm >= 0) {
    // Angle from left horizon (PI) through zenith (PI/2) to right horizon (0)
    const apexBias = clamp(elevNorm, 0, 1);
    const angle = isMorning
      ? Math.PI - apexBias * (Math.PI / 2)
      : apexBias * (Math.PI / 2);
    orbX = cx + rx * Math.cos(angle);
    orbY = horizonY - ry * Math.sin(angle);
  } else {
    const nightDepth = clamp(-elevNorm, 0, 1);
    orbX = isMorning ? cx - rx * (1 - nightDepth * 0.6) : cx + rx * (1 - nightDepth * 0.6);
    orbY = horizonY + 1 + nightDepth * 2.8;
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 shrink-0"
      title={`${solar.phase} · Solar elevation ${solar.elevationDeg.toFixed(1)}° · Azimuth ${Math.round(
        solar.azimuthDeg
      )}°`}
    >
      <svg
        width="30"
        height="18"
        viewBox="0 0 30 18"
        className="shrink-0 overflow-visible"
        aria-label={`Solar phase: ${solar.phase}`}
      >
        {/* Dashed upper sky path */}
        <path
          d="M 4 13 A 11 9.5 0 0 1 26 13"
          fill="none"
          stroke="rgba(148, 163, 184, 0.25)"
          strokeWidth="1.1"
          strokeDasharray="2 1.8"
        />
        {/* Horizon reference line */}
        <line
          x1="2"
          y1="13"
          x2="28"
          y2="13"
          stroke="rgba(255, 255, 255, 0.16)"
          strokeWidth="1"
        />
        {/* Sun / Moon orb */}
        <circle cx={orbX} cy={orbY} r="3.6" fill={color} opacity="0.22" />
        <circle cx={orbX} cy={orbY} r="2.1" fill={color} />
      </svg>
      <span
        className="hidden md:inline text-[10px] font-medium whitespace-nowrap"
        style={{ color }}
      >
        {solar.phase}
      </span>
    </div>
  );
}

export function TelemetryHUD({
  frame,
  units,
  solarSync,
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

  const modeColor = MODE_COLORS[frame.mode];
  const resolvedVisitName = activeVisit
    ? resolveVisitDisplayName(activeVisit, nicknames, geocodeCache)
    : '';
  const isEditingVisit = Boolean(activeVisitKey && editingKey === activeVisitKey);
  const solar = solarSync
    ? computeSolarPosition(frame.lat, frame.lng, frame.currentTimeMs)
    : null;

  return (
    <div className="flex flex-col items-end gap-1.5 pointer-events-none select-none max-w-full">
      {/* Low-profile Horizontal Telemetry Instrument Bar */}
      <div className="pointer-events-auto instrument-surface rounded-xl px-2.5 sm:px-3 py-1.5 flex items-center gap-2 sm:gap-2.5">
        {/* Solar Horizon Arc + Live Clock */}
        <div className="flex items-center gap-2 shrink-0">
          {solar && <SolarHorizonArc solar={solar} />}
          <span className="text-xs sm:text-sm font-mono font-semibold text-white tabular-nums tracking-tight">
            {formatClock(frame.currentTimeMs)}
          </span>
        </div>

        <div className="w-px h-3.5 bg-white/[0.08] shrink-0" />

        {/* Speed */}
        <div className="flex items-baseline gap-1 shrink-0">
          <span className="text-xs sm:text-sm font-mono font-semibold text-slate-100 tabular-nums">
            {formatSpeed(frame.speedKmh, units)}
          </span>
          <span className="text-[10px] text-slate-400">
            {getSpeedUnitLabel(units)}
          </span>
        </div>

        <div className="w-px h-3.5 bg-white/[0.08] shrink-0" />

        {/* Distance */}
        <div className="hidden xs:flex sm:flex items-baseline shrink-0">
          <span className="text-xs sm:text-sm font-mono font-medium text-slate-200 tabular-nums">
            {formatDistance(frame.cumulativeDistanceM, units)}
          </span>
        </div>

        <div className="hidden xs:block sm:block w-px h-3.5 bg-white/[0.08] shrink-0" />

        {/* Mode Badge */}
        <div
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-medium shrink-0"
          style={{
            color: modeColor,
            borderColor: `${modeColor}38`,
            backgroundColor: `${modeColor}14`,
          }}
        >
          <ModeIcon mode={frame.mode} className="w-3 h-3" />
          <span className="hidden sm:inline">{MODE_LABELS[frame.mode]}</span>
        </div>
      </div>

      {/* Compact Visit Chip (Only while dwelling at a place visit) */}
      {activeVisit && (
        <div className="pointer-events-auto instrument-surface rounded-xl px-2.5 py-1.5 max-w-[260px] sm:max-w-[320px]">
          {isEditingVisit ? (
            <form
              className="flex items-center gap-1.5"
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
                placeholder="Place nickname..."
                autoFocus
                className="w-36 sm:w-44 px-2 py-1 rounded-lg bg-slate-900/90 border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-white/30"
              />
              <button
                type="submit"
                className="p-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400/35 text-emerald-200 hover:bg-emerald-500/30 active:scale-[0.98] transition-all"
                title="Save nickname"
                aria-label="Save nickname"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setEditingKey(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 active:scale-[0.98] transition-all"
                title="Cancel"
                aria-label="Cancel edit"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingKey(activeVisitKey);
                setDraftName(resolvedVisitName);
              }}
              className="flex items-center gap-2 text-left group active:scale-[0.98] transition-transform max-w-full"
              title="Tap to rename place"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
              <span className="text-xs font-medium text-slate-100 truncate">
                {resolvedVisitName}
              </span>
              <span className="text-[11px] font-mono text-slate-400 tabular-nums shrink-0">
                {formatDuration(activeVisit.dwellDurationMs)}
              </span>
              <Edit3 className="w-3 h-3 text-slate-500 group-hover:text-slate-200 shrink-0 transition-colors" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
