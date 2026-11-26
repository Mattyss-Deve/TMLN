import { useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Calendar,
  CalendarDays,
  ChevronLeft,
  Compass,
  FileJson,
  Flame,
  Loader2,
  MapPin,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import type {
  AccentThemeId,
  TimelineSummaryIndex,
  TimelineViewMode,
  TripSummary,
  UnitSystem,
} from '../types/timeline';
import {
  formatDistance,
  formatDuration,
  formatSchemaName,
  formatShortTime,
  formatYearMonthLabel,
} from '../utils/format';
import { MODE_COLORS, MODE_LABELS } from '../utils/geo';
import { ACCENT_THEMES } from '../utils/settings';
import { ModeIcon } from './ModeIcon';

const PAGE_SIZE = 80;

interface TripSidebarProps {
  isOpen: boolean;
  onToggleOpen: () => void;
  index: TimelineSummaryIndex | null;
  viewMode: TimelineViewMode;
  onViewModeChange: (mode: TimelineViewMode) => void;
  selectedTripId: string | null;
  onSelectTrip: (tripId: string, viewMode: TimelineViewMode) => void;
  isLoadingTrip: boolean;
  onFileSelected: (file: File) => void;
  onLoadSample: () => void;
  isParsing: boolean;
  parseProgress: number;
  parseStage: string;
  onCancelParse: () => void;
  units: UnitSystem;
  accentTheme: AccentThemeId;
  showHeatmap: boolean;
  onOpenStatsModal: () => void;
}

export function TripSidebar({
  isOpen,
  onToggleOpen,
  index,
  viewMode,
  onViewModeChange,
  selectedTripId,
  onSelectTrip,
  isLoadingTrip,
  onFileSelected,
  onLoadSample,
  isParsing,
  parseProgress,
  parseStage,
  onCancelParse,
  units,
  accentTheme,
  showHeatmap,
  onOpenStatsModal,
}: TripSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

  const accent = ACCENT_THEMES[accentTheme];

  const activeList: TripSummary[] = useMemo(() => {
    if (!index) return [];
    return viewMode === 'DAY' ? index.days : index.journeys;
  }, [index, viewMode]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return activeList.filter((item) => {
      if (monthFilter && item.yearMonth !== monthFilter) return false;
      if (dateFilter && item.dateKey !== dateFilter) return false;
      if (!q) return true;
      if (item.title.toLowerCase().includes(q)) return true;
      if (item.dateKey.includes(q)) return true;
      if (item.dateLabel.toLowerCase().includes(q)) return true;
      if (item.modes.some((m) => MODE_LABELS[m].toLowerCase().includes(q))) {
        return true;
      }
      if (item.visitNames.some((n) => n.toLowerCase().includes(q))) {
        return true;
      }
      return false;
    });
  }, [activeList, monthFilter, dateFilter, searchQuery]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleLimit),
    [filteredItems, visibleLimit]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  if (!isOpen) {
    return null;
  }

  const stats = index?.stats ?? null;

  return (
    <aside className="fixed safe-top-drawer left-3 bottom-3 z-30 w-[min(90vw,336px)] flex flex-col rounded-2xl bg-slate-950/88 border border-white/10 backdrop-blur-md shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3.5 pb-3 border-b border-white/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-8 h-8 rounded-xl border flex items-center justify-center shrink-0"
            style={{
              backgroundColor: accent.softBg,
              borderColor: accent.border,
            }}
          >
            <Compass className="w-4 h-4" style={{ color: accent.primary }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight text-white truncate">
              ChronoMap
            </h1>
            <div className="flex items-center gap-1 text-[10px] text-emerald-300/90">
              <ShieldCheck className="w-3 h-3 shrink-0" />
              <span className="truncate">100% Local · In-Browser</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleOpen}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Collapse trip explorer"
          title="Collapse sidebar"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Import, Sample & Stats Controls */}
      <div className="p-3 space-y-2 border-b border-white/10">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => !isParsing && fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !isParsing) {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={`relative rounded-xl border border-dashed px-3 py-2.5 transition-all cursor-pointer select-none ${
            isDragging
              ? 'border-cyan-400 bg-cyan-500/15'
              : 'border-white/15 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/30'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
          />

          {isParsing ? (
            <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between text-[11px]">
                <span
                  className="font-medium truncate pr-2"
                  style={{ color: accent.text }}
                >
                  {parseStage || 'Parsing file...'}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-slate-300 tabular-nums">
                    {Math.round(parseProgress)}%
                  </span>
                  <button
                    type="button"
                    onClick={onCancelParse}
                    className="text-slate-400 hover:text-rose-300 transition-colors"
                    title="Cancel parsing"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full transition-all duration-150"
                  style={{
                    width: `${Math.max(4, parseProgress)}%`,
                    backgroundColor: accent.primary,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-slate-900/90 border border-white/10 flex items-center justify-center shrink-0">
                <UploadCloud className="w-4 h-4" style={{ color: accent.primary }} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-200">
                  Drop Google Timeline{' '}
                  <span style={{ color: accent.primary }}>.json</span>
                </p>
                <p className="text-[10px] text-slate-400 truncate">
                  Timeline.json, Semantic History, or Records.json
                </p>
              </div>
            </div>
          )}
        </div>

        <div className={`grid gap-1.5 ${index ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <button
            type="button"
            onClick={onLoadSample}
            disabled={isParsing}
            className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: accent.softBg,
              borderColor: accent.border,
              color: accent.text,
            }}
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {index ? 'Sample Data' : 'Load Sample Journey'}
            </span>
          </button>

          {index && (
            <button
              type="button"
              onClick={onOpenStatsModal}
              className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs font-semibold transition-all bg-white/[0.04] hover:bg-white/10 border-white/15 text-slate-100"
            >
              {showHeatmap ? (
                <Flame className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              ) : (
                <BarChart3 className="w-3.5 h-3.5 shrink-0" style={{ color: accent.primary }} />
              )}
              <span className="truncate">Stats &amp; Heatmap</span>
            </button>
          )}
        </div>

        {stats && (
          <div className="grid grid-cols-3 gap-1.5 pt-0.5">
            <div className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
              <div className="text-[9px] uppercase tracking-wider text-slate-400">
                Distance
              </div>
              <div className="text-[11px] font-semibold text-slate-200 tabular-nums truncate">
                {formatDistance(stats.totalDistanceM, units)}
              </div>
            </div>
            <div className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
              <div className="text-[9px] uppercase tracking-wider text-slate-400">
                Waypoints
              </div>
              <div className="text-[11px] font-semibold text-slate-200 tabular-nums truncate">
                {stats.totalWaypoints.toLocaleString()}
              </div>
            </div>
            <div className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
              <div className="text-[9px] uppercase tracking-wider text-slate-400">
                Spikes Cut
              </div>
              <div className="text-[11px] font-semibold text-slate-200 tabular-nums truncate">
                {stats.filteredSpikes}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* View Mode Toggle + Year/Month + Date + Search Filters */}
      {index && (
        <div className="px-3 py-2.5 border-b border-white/10 space-y-2">
          <div className="grid grid-cols-2 p-0.5 rounded-xl bg-slate-900/90 border border-white/10">
            <button
              type="button"
              onClick={() => {
                setVisibleLimit(PAGE_SIZE);
                onViewModeChange('DAY');
              }}
              className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[11px] font-medium transition-all border"
              style={{
                backgroundColor: viewMode === 'DAY' ? accent.softBg : 'transparent',
                borderColor: viewMode === 'DAY' ? accent.border : 'transparent',
                color: viewMode === 'DAY' ? accent.text : '#94a3b8',
              }}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <span>By Day</span>
              <span className="text-[10px] font-mono opacity-80 tabular-nums">
                {index.days.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setVisibleLimit(PAGE_SIZE);
                onViewModeChange('JOURNEY');
              }}
              className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[11px] font-medium transition-all border"
              style={{
                backgroundColor:
                  viewMode === 'JOURNEY' ? accent.softBg : 'transparent',
                borderColor: viewMode === 'JOURNEY' ? accent.border : 'transparent',
                color: viewMode === 'JOURNEY' ? accent.text : '#94a3b8',
              }}
            >
              <Route className="w-3.5 h-3.5" />
              <span>Journeys</span>
              <span className="text-[10px] font-mono opacity-80 tabular-nums">
                {index.journeys.length}
              </span>
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setVisibleLimit(PAGE_SIZE);
              }}
              placeholder="Search trips, places, modes..."
              className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-slate-900/80 border border-white/10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-white/30"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                aria-label="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <select
              value={monthFilter}
              onChange={(e) => {
                setMonthFilter(e.target.value);
                setDateFilter('');
                setVisibleLimit(PAGE_SIZE);
              }}
              aria-label="Filter by month"
              className="w-full px-2 py-1 rounded-lg bg-slate-900/80 border border-white/10 text-[11px] text-slate-200 focus:outline-none focus:border-white/30 [color-scheme:dark]"
            >
              <option value="">All Months ({index.yearMonths.length})</option>
              {index.yearMonths.map((ym) => (
                <option key={ym} value={ym}>
                  {formatYearMonthLabel(ym)} ({ym})
                </option>
              ))}
            </select>

            <div className="relative">
              <Calendar className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setDateFilter(val);
                  if (val) setMonthFilter('');
                  setVisibleLimit(PAGE_SIZE);
                }}
                aria-label="Filter by date"
                className="w-full pl-6 pr-1 py-1 rounded-lg bg-slate-900/80 border border-white/10 text-[11px] text-slate-200 focus:outline-none focus:border-white/30 [color-scheme:dark]"
              />
            </div>
          </div>

          {stats && (
            <div className="flex items-center justify-between text-[10px] text-slate-400 px-0.5">
              <span className="flex items-center gap-1 truncate">
                <FileJson
                  className="w-3 h-3 shrink-0"
                  style={{ color: accent.primary }}
                />
                <span className="truncate">{formatSchemaName(stats.schema)}</span>
              </span>
              <span className="tabular-nums shrink-0 flex items-center gap-1">
                {isLoadingTrip && (
                  <Loader2
                    className="w-3 h-3 animate-spin"
                    style={{ color: accent.primary }}
                  />
                )}
                <span>{stats.parseDurationMs}ms</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Scrollable Summary List */}
      <div className="flex-1 overflow-y-auto obsidian-scroll p-2.5 space-y-2">
        {!index ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 py-8">
            <div className="w-11 h-11 rounded-2xl bg-slate-900/90 border border-white/10 flex items-center justify-center mb-3">
              <MapPin className="w-5 h-5 text-slate-400" />
            </div>
            <p className="text-xs font-medium text-slate-200">
              No Timeline Loaded Yet
            </p>
            <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
              Import a Google Takeout or on-device Timeline{' '}
              <code style={{ color: accent.primary }}>.json</code> file, or click{' '}
              <span className="text-slate-200 font-medium">Load Sample Journey</span>{' '}
              to preview.
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-8 px-4">
            <p className="text-xs font-medium text-slate-300">
              No {viewMode === 'DAY' ? 'days' : 'journeys'} match your filters
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setMonthFilter('');
                setDateFilter('');
              }}
              className="mt-2 px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px]"
              style={{ color: accent.text }}
            >
              Reset filters
            </button>
          </div>
        ) : (
          <>
            {visibleItems.map((item) => {
              const isSelected = item.id === selectedTripId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTrip(item.id, item.viewMode)}
                  className="w-full text-left p-2.5 rounded-xl border transition-all"
                  style={{
                    backgroundColor: isSelected
                      ? accent.softBg
                      : 'rgba(255,255,255,0.03)',
                    borderColor: isSelected
                      ? accent.border
                      : 'rgba(255,255,255,0.06)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div
                        className="text-[10px] font-medium truncate"
                        style={{ color: accent.text }}
                      >
                        {item.dateLabel}
                      </div>
                      <div className="text-xs font-medium text-slate-100 leading-snug line-clamp-2 mt-0.5">
                        {item.title}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 tabular-nums shrink-0 mt-0.5">
                      {formatShortTime(item.startTimeMs)}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      {item.modes
                        .filter((m) => m !== 'STILL' || item.modes.length === 1)
                        .map((mode) => (
                          <span
                            key={mode}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-900/90 border border-white/10 text-[10px]"
                            style={{ color: MODE_COLORS[mode] }}
                            title={MODE_LABELS[mode]}
                          >
                            <ModeIcon mode={mode} className="w-2.5 h-2.5" />
                          </span>
                        ))}
                      <span className="text-[10px] text-slate-400 ml-0.5 tabular-nums">
                        {item.segmentCount} seg
                        {item.visitCount > 0
                          ? ` · ${item.visitCount} stop${item.visitCount === 1 ? '' : 's'}`
                          : ''}
                      </span>
                    </div>

                    <div className="text-[10px] text-slate-300 tabular-nums shrink-0">
                      {formatDistance(item.distanceM, units)} ·{' '}
                      {formatDuration(item.durationMs)}
                    </div>
                  </div>
                </button>
              );
            })}

            {filteredItems.length > visibleLimit && (
              <button
                type="button"
                onClick={() => setVisibleLimit((v) => v + PAGE_SIZE)}
                className="w-full py-2 rounded-xl bg-white/[0.04] hover:bg-white/10 border border-white/10 text-[11px] font-medium transition-colors"
                style={{ color: accent.text }}
              >
                Show more ({filteredItems.length - visibleLimit} remaining)
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
