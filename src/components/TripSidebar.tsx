import { useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Calendar,
  CalendarDays,
  ChevronLeft,
  Compass,
  Database,
  FileUp,
  Flame,
  Loader2,
  MapPin,
  Route,
  Search,
  Sparkles,
  Star,
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
import { ACCENT_THEMES, APP_VERSION } from '../utils/settings';
import { ModeIcon } from './ModeIcon';

const PAGE_SIZE = 80;

type DiscoveryFilter = 'ALL' | 'STARRED' | 'ON_THIS_DAY' | 'LONGEST';

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
  starredIds: string[];
  onToggleStar: (id: string) => void;
  cachedFileName: string | null;
  isRestoringCache: boolean;
}

function getTodayMonthDay(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
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
  starredIds,
  onToggleStar,
  cachedFileName,
  isRestoringCache,
}: TripSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [discoveryFilter, setDiscoveryFilter] = useState<DiscoveryFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

  const accent = ACCENT_THEMES[accentTheme];
  const todayMonthDay = useMemo(() => getTodayMonthDay(), []);
  const starredSet = useMemo(() => new Set(starredIds), [starredIds]);

  const activeList: TripSummary[] = useMemo(() => {
    if (!index) return [];
    return viewMode === 'DAY' ? index.days : index.journeys;
  }, [index, viewMode]);

  const discoveryCounts = useMemo(() => {
    let starred = 0;
    let onThisDay = 0;
    for (const item of activeList) {
      if (starredSet.has(item.id)) starred++;
      if (item.dateKey.slice(5) === todayMonthDay) onThisDay++;
    }
    return { starred, onThisDay };
  }, [activeList, starredSet, todayMonthDay]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const matched = activeList.filter((item) => {
      if (discoveryFilter === 'STARRED' && !starredSet.has(item.id)) return false;
      if (
        discoveryFilter === 'ON_THIS_DAY' &&
        item.dateKey.slice(5) !== todayMonthDay
      ) {
        return false;
      }
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

    if (discoveryFilter === 'LONGEST') {
      return [...matched].sort((a, b) => b.distanceM - a.distanceM);
    }
    return matched;
  }, [
    activeList,
    discoveryFilter,
    starredSet,
    todayMonthDay,
    monthFilter,
    dateFilter,
    searchQuery,
  ]);

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

  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
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
  const filterTabs: { id: DiscoveryFilter; label: string; count?: number }[] = [
    { id: 'ALL', label: 'All' },
    {
      id: 'STARRED',
      label: 'Starred',
      count: discoveryCounts.starred > 0 ? discoveryCounts.starred : undefined,
    },
    {
      id: 'ON_THIS_DAY',
      label: 'On This Day',
      count: discoveryCounts.onThisDay > 0 ? discoveryCounts.onThisDay : undefined,
    },
    { id: 'LONGEST', label: 'Longest' },
  ];

  return (
    <aside
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDragging(false);
      }}
      onDrop={handleDrop}
      className={`fixed safe-top-drawer left-3 bottom-3 z-30 w-[min(90vw,336px)] flex flex-col rounded-xl instrument-surface-strong overflow-hidden transition-colors ${
        isDragging ? 'ring-1 ring-cyan-400/60' : ''
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Header */}
      <div className="px-3.5 py-3 border-b border-white/[0.08] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-7 h-7 rounded-lg border flex items-center justify-center shrink-0"
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
            <p className="text-[11px] text-slate-400 truncate">
              {cachedFileName ? cachedFileName : 'Private on-device replay'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleOpen}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.07] active:scale-[0.98] transition-all"
          aria-label="Collapse trip explorer"
          title="Collapse sidebar"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Import / Action Strip */}
      <div className="p-3 space-y-2 border-b border-white/[0.08]">
        {isParsing || isRestoringCache ? (
          <div className="rounded-lg instrument-inset px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span
                className="font-medium truncate pr-2 flex items-center gap-1.5"
                style={{ color: accent.text }}
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="truncate">
                  {isRestoringCache
                    ? 'Restoring cached timeline...'
                    : parseStage || 'Parsing file...'}
                </span>
              </span>
              {!isRestoringCache && (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-[11px] text-slate-300 tabular-nums">
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
              )}
            </div>
            <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full transition-all duration-150"
                style={{
                  width: `${Math.max(8, isRestoringCache ? 45 : parseProgress)}%`,
                  backgroundColor: accent.primary,
                }}
              />
            </div>
          </div>
        ) : !index ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/25 px-3 py-2.5 transition-all cursor-pointer select-none active:scale-[0.98]"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg instrument-inset flex items-center justify-center shrink-0">
                <UploadCloud className="w-4 h-4" style={{ color: accent.primary }} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-100">
                  Import Google Timeline{' '}
                  <span style={{ color: accent.primary }}>.json</span>
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  Timeline.json, Semantic History, or Records
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg instrument-inset hover:bg-white/[0.07] text-xs font-medium text-slate-100 active:scale-[0.98] transition-all"
            >
              <FileUp className="w-3.5 h-3.5 shrink-0" style={{ color: accent.primary }} />
              <span className="truncate">Load New JSON</span>
            </button>

            <button
              type="button"
              onClick={onOpenStatsModal}
              className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg instrument-inset hover:bg-white/[0.07] text-xs font-medium text-slate-100 active:scale-[0.98] transition-all"
            >
              {showHeatmap ? (
                <Flame className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              ) : (
                <BarChart3
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: accent.primary }}
                />
              )}
              <span className="truncate">Stats &amp; Map</span>
            </button>
          </div>
        )}

        {!index && (
          <button
            type="button"
            onClick={onLoadSample}
            disabled={isParsing || isRestoringCache}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium active:scale-[0.98] transition-all disabled:opacity-50"
            style={{
              backgroundColor: accent.softBg,
              borderColor: accent.border,
              color: accent.text,
            }}
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>Load Sample Journey</span>
          </button>
        )}

        {stats && (
          <div className="grid grid-cols-3 gap-1.5">
            <div className="px-2 py-1.5 rounded-lg instrument-inset">
              <div className="text-[10px] text-slate-400">Distance</div>
              <div className="text-xs font-mono font-medium text-slate-100 tabular-nums truncate">
                {formatDistance(stats.totalDistanceM, units)}
              </div>
            </div>
            <div className="px-2 py-1.5 rounded-lg instrument-inset">
              <div className="text-[10px] text-slate-400">Points</div>
              <div className="text-xs font-mono font-medium text-slate-100 tabular-nums truncate">
                {stats.totalWaypoints.toLocaleString()}
              </div>
            </div>
            <div className="px-2 py-1.5 rounded-lg instrument-inset">
              <div className="text-[10px] text-slate-400">Format</div>
              <div className="text-xs font-medium text-slate-200 truncate">
                {formatSchemaName(stats.schema).split(' ')[0]}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* View Mode + Smart Discovery Tabs + Search/Date Filters */}
      {index && (
        <div className="px-3 py-2.5 border-b border-white/[0.08] space-y-2">
          {/* By Day / Journeys Switcher */}
          <div className="grid grid-cols-2 p-0.5 rounded-lg instrument-inset">
            <button
              type="button"
              onClick={() => {
                setVisibleLimit(PAGE_SIZE);
                onViewModeChange('DAY');
              }}
              className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-medium active:scale-[0.98] transition-all border"
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
              className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-medium active:scale-[0.98] transition-all border"
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

          {/* Quick Smart Discovery Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
            {filterTabs.map((tab) => {
              const active = discoveryFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setDiscoveryFilter(tab.id);
                    setVisibleLimit(PAGE_SIZE);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap border active:scale-[0.98] transition-all shrink-0"
                  style={{
                    backgroundColor: active
                      ? accent.softBg
                      : 'rgba(255,255,255,0.03)',
                    borderColor: active
                      ? accent.border
                      : 'rgba(255,255,255,0.07)',
                    color: active ? accent.text : '#94a3b8',
                  }}
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined && (
                    <span className="font-mono text-[10px] tabular-nums opacity-80">
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search */}
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
              className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-white/25"
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

          {/* Month & Date Filters */}
          <div className="grid grid-cols-2 gap-1.5">
            <select
              value={monthFilter}
              onChange={(e) => {
                setMonthFilter(e.target.value);
                setDateFilter('');
                setVisibleLimit(PAGE_SIZE);
              }}
              aria-label="Filter by month"
              className="w-full px-2 py-1 rounded-lg bg-white/[0.03] border border-white/[0.08] text-[11px] text-slate-200 focus:outline-none focus:border-white/25 [color-scheme:dark]"
            >
              <option value="">All months ({index.yearMonths.length})</option>
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
                className="w-full pl-6 pr-1 py-1 rounded-lg bg-white/[0.03] border border-white/[0.08] text-[11px] text-slate-200 focus:outline-none focus:border-white/25 [color-scheme:dark]"
              />
            </div>
          </div>
        </div>
      )}

      {/* Scrollable Trip List */}
      <div className="flex-1 overflow-y-auto obsidian-scroll p-2.5 space-y-1.5">
        {!index ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 py-8">
            <div className="w-10 h-10 rounded-xl instrument-inset flex items-center justify-center mb-3">
              <MapPin className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-xs font-medium text-slate-200">
              No timeline loaded
            </p>
            <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
              Import a Google Timeline{' '}
              <code style={{ color: accent.primary }}>.json</code> file—cached locally in
              IndexedDB for instant reopen.
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-8 px-4">
            <p className="text-xs font-medium text-slate-300">
              {discoveryFilter === 'STARRED'
                ? 'No starred entries yet'
                : discoveryFilter === 'ON_THIS_DAY'
                  ? `No history recorded on ${todayMonthDay}`
                  : `No ${viewMode === 'DAY' ? 'days' : 'journeys'} match`}
            </p>
            <button
              type="button"
              onClick={() => {
                setDiscoveryFilter('ALL');
                setSearchQuery('');
                setMonthFilter('');
                setDateFilter('');
              }}
              className="mt-2 px-3 py-1 rounded-lg instrument-inset hover:bg-white/[0.07] text-[11px] active:scale-[0.98] transition-all"
              style={{ color: accent.text }}
            >
              Reset filters
            </button>
          </div>
        ) : (
          <>
            {visibleItems.map((item) => {
              const isSelected = item.id === selectedTripId;
              const isStarred = starredSet.has(item.id);
              return (
                <div
                  key={item.id}
                  onClick={() => onSelectTrip(item.id, item.viewMode)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectTrip(item.id, item.viewMode);
                    }
                  }}
                  className="w-full text-left p-2.5 rounded-lg border cursor-pointer active:scale-[0.98] transition-all"
                  style={{
                    backgroundColor: isSelected
                      ? accent.softBg
                      : 'rgba(255,255,255,0.025)',
                    borderColor: isSelected
                      ? accent.border
                      : 'rgba(255,255,255,0.07)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-[11px] font-medium truncate"
                          style={{ color: accent.text }}
                        >
                          {item.dateLabel}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 tabular-nums shrink-0">
                          {formatShortTime(item.startTimeMs)}
                        </span>
                      </div>
                      <div className="text-xs font-medium text-slate-100 leading-snug line-clamp-2 mt-0.5">
                        {item.title}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStar(item.id);
                      }}
                      className={`p-1 rounded-md shrink-0 transition-colors ${
                        isStarred
                          ? 'text-amber-400 hover:bg-amber-400/10'
                          : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.06]'
                      }`}
                      title={isStarred ? 'Remove star' : 'Star entry'}
                      aria-label={isStarred ? 'Remove star' : 'Star entry'}
                    >
                      <Star
                        className={`w-3.5 h-3.5 ${isStarred ? 'fill-current' : ''}`}
                      />
                    </button>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      {item.modes
                        .filter((m) => m !== 'STILL' || item.modes.length === 1)
                        .map((mode) => (
                          <span
                            key={mode}
                            className="inline-flex items-center px-1.5 py-0.5 rounded-md instrument-inset text-[10px]"
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

                    <div className="text-[11px] font-mono text-slate-300 tabular-nums shrink-0">
                      {formatDistance(item.distanceM, units)} ·{' '}
                      {formatDuration(item.durationMs)}
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredItems.length > visibleLimit && (
              <button
                type="button"
                onClick={() => setVisibleLimit((v) => v + PAGE_SIZE)}
                className="w-full py-2 rounded-lg instrument-inset hover:bg-white/[0.07] text-[11px] font-medium active:scale-[0.98] transition-all"
                style={{ color: accent.text }}
              >
                Show more ({filteredItems.length - visibleLimit} remaining)
              </button>
            )}
          </>
        )}
      </div>

      {/* Subtle Instrument Footer with Version & Cache State */}
      <div className="px-3.5 py-2 border-t border-white/[0.08] flex items-center justify-between gap-2 text-[10px] text-slate-500">
        <span className="flex items-center gap-1.5 truncate">
          {isLoadingTrip ? (
            <Loader2
              className="w-3 h-3 animate-spin shrink-0"
              style={{ color: accent.primary }}
            />
          ) : (
            <Database className="w-3 h-3 shrink-0 text-slate-500" />
          )}
          <span className="truncate">
            {cachedFileName ? 'Cached locally' : 'On-device storage'}
          </span>
        </span>
        <span className="font-mono tabular-nums text-slate-400 shrink-0">
          ChronoMap {APP_VERSION}
        </span>
      </div>
    </aside>
  );
}
