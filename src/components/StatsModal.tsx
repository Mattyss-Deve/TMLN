import { useState } from 'react';
import {
  BarChart3,
  Check,
  Edit3,
  Flame,
  Loader2,
  MapPin,
  X,
} from 'lucide-react';
import type {
  AccentThemeId,
  LifetimeStats,
  UnitSystem,
} from '../types/timeline';
import { formatDistance, formatDuration, formatHours } from '../utils/format';
import { resolveVisitDisplayName } from '../utils/geocoder';
import { MODE_COLORS } from '../utils/geo';
import { ACCENT_THEMES } from '../utils/settings';
import { ModeIcon } from './ModeIcon';

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: LifetimeStats | null;
  units: UnitSystem;
  accentTheme: AccentThemeId;
  showHeatmap: boolean;
  isLoadingHeatmap: boolean;
  onToggleHeatmap: () => void;
  nicknames: Record<string, string>;
  geocodeCache: Record<string, string>;
  onSaveNickname: (lat: number, lng: number, nickname: string) => void;
}

export function StatsModal({
  isOpen,
  onClose,
  stats,
  units,
  accentTheme,
  showHeatmap,
  isLoadingHeatmap,
  onToggleHeatmap,
  nicknames,
  geocodeCache,
  onSaveNickname,
}: StatsModalProps) {
  const [editingCoordKey, setEditingCoordKey] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  if (!isOpen || !stats) return null;

  const accent = ACCENT_THEMES[accentTheme];
  const maxModeDist = Math.max(
    1,
    ...stats.modeBreakdown.map((m) => m.distanceM)
  );
  const totalMovingMs = stats.modeBreakdown.reduce(
    (sum, item) => sum + item.durationMs,
    0
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/65 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Lifetime Stats and Heatmap"
    >
      <div
        className="w-full max-w-2xl max-h-[86vh] flex flex-col rounded-xl instrument-surface-strong overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" style={{ color: accent.primary }} />
            <h2 className="text-sm font-semibold text-white">
              Lifetime stats &amp; heatmap
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.07] active:scale-[0.98] transition-all"
            aria-label="Close stats modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto obsidian-scroll p-4 space-y-5">
          {/* All-Time Heatmap Toggle Strip */}
          <div
            className="p-3 rounded-lg border flex flex-wrap items-center justify-between gap-3"
            style={{
              backgroundColor: showHeatmap
                ? accent.softBg
                : 'rgba(255,255,255,0.025)',
              borderColor: showHeatmap
                ? accent.border
                : 'rgba(255,255,255,0.07)',
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: showHeatmap
                    ? `${accent.primary}25`
                    : 'rgba(244,63,94,0.14)',
                }}
              >
                <Flame
                  className="w-4 h-4"
                  style={{ color: showHeatmap ? accent.primary : '#fb7185' }}
                />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-white">
                  All-time heatmap layer
                </div>
                <div className="text-[11px] text-slate-400">
                  Density overlay of historical corridors across the map
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {showHeatmap && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-2.5 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-xs font-medium text-white active:scale-[0.98] transition-all"
                >
                  View map
                </button>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={showHeatmap}
                disabled={isLoadingHeatmap}
                onClick={onToggleHeatmap}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium active:scale-[0.98] transition-all disabled:opacity-60"
                style={{
                  backgroundColor: showHeatmap
                    ? accent.buttonBg
                    : 'rgba(255,255,255,0.08)',
                  color: showHeatmap ? accent.buttonText : '#e2e8f0',
                }}
              >
                {isLoadingHeatmap ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Building...</span>
                  </>
                ) : (
                  <span>{showHeatmap ? 'Heatmap on' : 'Enable heatmap'}</span>
                )}
              </button>
            </div>
          </div>

          {/* Lifetime KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-3 rounded-lg instrument-inset">
              <div className="text-[11px] text-slate-400">Total distance</div>
              <div className="mt-1 text-base font-mono font-semibold text-white tabular-nums">
                {formatDistance(stats.totalDistanceM, units)}
              </div>
            </div>
            <div className="p-3 rounded-lg instrument-inset">
              <div className="text-[11px] text-slate-400">Journeys</div>
              <div className="mt-1 text-base font-mono font-semibold text-white tabular-nums">
                {stats.totalTrips.toLocaleString()}
              </div>
            </div>
            <div className="p-3 rounded-lg instrument-inset">
              <div className="text-[11px] text-slate-400">Active days</div>
              <div className="mt-1 text-base font-mono font-semibold text-white tabular-nums">
                {stats.totalDays.toLocaleString()}
              </div>
            </div>
            <div className="p-3 rounded-lg instrument-inset">
              <div className="text-[11px] text-slate-400">Moving time</div>
              <div className="mt-1 text-base font-mono font-semibold text-white tabular-nums">
                {formatHours(totalMovingMs)}
              </div>
            </div>
          </div>

          {/* Mode Breakdown */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-slate-300">
              Transport mode breakdown
            </h3>
            {stats.modeBreakdown.length === 0 ? (
              <p className="text-xs text-slate-400">No moving segments recorded.</p>
            ) : (
              <div className="space-y-1.5">
                {stats.modeBreakdown.map((item) => {
                  const pct = Math.max(
                    3,
                    Math.round((item.distanceM / maxModeDist) * 100)
                  );
                  const color = MODE_COLORS[item.mode];
                  return (
                    <div
                      key={item.subtype}
                      className="p-2.5 rounded-lg instrument-inset space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                            style={{
                              color,
                              backgroundColor: `${color}1c`,
                            }}
                          >
                            <ModeIcon mode={item.mode} className="w-3.5 h-3.5" />
                          </span>
                          <span className="font-medium text-slate-100">
                            {item.label}
                          </span>
                          <span className="text-[11px] text-slate-400 tabular-nums">
                            {item.segmentCount} legs
                          </span>
                        </div>

                        <div className="font-mono text-[11px] text-slate-200 tabular-nums shrink-0">
                          <span>{formatDistance(item.distanceM, units)}</span>
                          <span className="text-slate-600 mx-1.5">·</span>
                          <span className="text-slate-400">
                            {formatHours(item.durationMs)}
                          </span>
                        </div>
                      </div>

                      <div className="h-1 w-full rounded-full bg-white/[0.07] overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top 10 Visited Locations */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-slate-300">
              Most visited places
            </h3>
            {stats.topLocations.length === 0 ? (
              <p className="text-xs text-slate-400">No place visits detected.</p>
            ) : (
              <div className="space-y-1.5">
                {stats.topLocations.map((loc, idx) => {
                  const displayName = resolveVisitDisplayName(
                    loc,
                    nicknames,
                    geocodeCache
                  );
                  const isEditing = editingCoordKey === loc.coordKey;

                  return (
                    <div
                      key={`${loc.coordKey}-${idx}`}
                      className="px-3 py-2 rounded-lg instrument-inset flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="w-5 text-center font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                          {idx + 1}
                        </span>
                        <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />

                        {isEditing ? (
                          <form
                            className="flex items-center gap-1.5 flex-1 min-w-0"
                            onSubmit={(e) => {
                              e.preventDefault();
                              onSaveNickname(loc.lat, loc.lng, draftName);
                              setEditingCoordKey(null);
                            }}
                          >
                            <input
                              type="text"
                              value={draftName}
                              onChange={(e) => setDraftName(e.target.value)}
                              placeholder="Custom nickname..."
                              autoFocus
                              className="flex-1 min-w-0 px-2 py-1 rounded-md bg-slate-900 border border-white/20 text-xs text-white focus:outline-none"
                            />
                            <button
                              type="submit"
                              className="p-1 rounded-md bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 active:scale-[0.98]"
                              title="Save nickname"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingCoordKey(null)}
                              className="p-1 rounded-md text-slate-400 hover:text-white active:scale-[0.98]"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </form>
                        ) : (
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-slate-100 truncate">
                              {displayName}
                            </div>
                            <div className="text-[10px] font-mono text-slate-500 tabular-nums">
                              {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                            </div>
                          </div>
                        )}
                      </div>

                      {!isEditing && (
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <div className="text-[11px] font-mono font-medium text-slate-200 tabular-nums">
                              {loc.visitCount}{' '}
                              {loc.visitCount === 1 ? 'visit' : 'visits'}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 tabular-nums">
                              {formatDuration(loc.totalDwellMs)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCoordKey(loc.coordKey);
                              setDraftName(displayName);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.07] active:scale-[0.98] transition-all"
                            title="Assign custom nickname"
                            aria-label={`Rename ${displayName}`}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
