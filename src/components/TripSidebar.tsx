import { useMemo, useRef, useState } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Compass,
  FileJson,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import type {
  DayGroup,
  TimelineParseStats,
  Trip,
} from '../types/timeline';
import {
  formatDistance,
  formatDuration,
  formatSchemaName,
  formatShortTime,
} from '../utils/format';
import { MODE_COLORS, MODE_LABELS } from '../utils/geo';
import { ModeIcon } from './ModeIcon';

interface TripSidebarProps {
  isOpen: boolean;
  onToggleOpen: () => void;
  trips: Trip[];
  days: DayGroup[];
  stats: TimelineParseStats | null;
  selectedTripId: string | null;
  onSelectTrip: (tripId: string) => void;
  onFileSelected: (file: File) => void;
  onLoadSample: () => void;
  isParsing: boolean;
  parseProgress: number;
  parseStage: string;
  onCancelParse: () => void;
}

export function TripSidebar({
  isOpen,
  onToggleOpen,
  trips,
  days,
  stats,
  selectedTripId,
  onSelectTrip,
  onFileSelected,
  onLoadSample,
  isParsing,
  parseProgress,
  parseStage,
  onCancelParse,
}: TripSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  const tripById = useMemo(() => {
    const map = new Map<string, Trip>();
    for (const t of trips) map.set(t.id, t);
    return map;
  }, [trips]);

  const filteredDays = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return days
      .filter((day) => !dateFilter || day.dateKey === dateFilter)
      .map((day) => {
        const matchingTrips = day.tripIds
          .map((id) => tripById.get(id))
          .filter((t): t is Trip => {
            if (!t) return false;
            if (!q) return true;
            if (t.title.toLowerCase().includes(q)) return true;
            if (t.dateKey.includes(q)) return true;
            if (day.dateLabel.toLowerCase().includes(q)) return true;
            if (t.modes.some((m) => MODE_LABELS[m].toLowerCase().includes(q))) {
              return true;
            }
            if (t.visits.some((v) => v.name.toLowerCase().includes(q))) {
              return true;
            }
            return false;
          });

        return {
          day,
          trips: matchingTrips,
        };
      })
      .filter((entry) => entry.trips.length > 0);
  }, [days, tripById, dateFilter, searchQuery]);

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
    return (
      <div className="fixed top-4 left-4 z-30 flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleOpen}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-950/80 border border-white/15 backdrop-blur-md text-slate-100 hover:bg-slate-900/90 hover:border-cyan-400/40 shadow-xl transition-all text-xs font-medium"
          title="Expand Trip Explorer"
        >
          <Compass className="w-4 h-4 text-cyan-400" />
          <span>Trips</span>
          {trips.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 text-[10px] font-mono tabular-nums">
              {trips.length}
            </span>
          )}
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>
    );
  }

  return (
    <aside className="fixed top-3 left-3 bottom-3 z-30 w-[min(88vw,336px)] flex flex-col rounded-2xl bg-slate-950/80 border border-white/10 backdrop-blur-md shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3.5 pb-3 border-b border-white/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500/25 to-emerald-500/20 border border-cyan-400/30 flex items-center justify-center shrink-0">
            <Compass className="w-4 h-4 text-cyan-300" />
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

      {/* Import & Sample Controls */}
      <div className="p-3 space-y-2.5 border-b border-white/10">
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
          className={`relative rounded-xl border border-dashed px-3 py-3 transition-all cursor-pointer select-none ${
            isDragging
              ? 'border-cyan-400 bg-cyan-500/15'
              : 'border-white/15 bg-white/[0.03] hover:bg-white/[0.06] hover:border-cyan-400/40'
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
                <span className="text-cyan-300 font-medium truncate pr-2">
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
                  className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-150"
                  style={{ width: `${Math.max(4, parseProgress)}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-slate-900/90 border border-white/10 flex items-center justify-center shrink-0">
                <UploadCloud className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-200">
                  Drop Google Timeline <span className="text-cyan-300">.json</span>
                </p>
                <p className="text-[10px] text-slate-400 truncate">
                  Timeline.json, Semantic History, or Records.json
                </p>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onLoadSample}
          disabled={isParsing}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-cyan-500/20 via-teal-500/20 to-emerald-500/20 hover:from-cyan-500/30 hover:to-emerald-500/30 border border-cyan-400/35 hover:border-cyan-300/60 text-xs font-semibold text-cyan-100 shadow-lg shadow-cyan-950/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
          <span>Load Sample Journey</span>
        </button>

        {/* Dataset Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-1.5 pt-0.5">
            <div className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
              <div className="text-[9px] uppercase tracking-wider text-slate-400">
                Distance
              </div>
              <div className="text-[11px] font-semibold text-slate-200 tabular-nums truncate">
                {formatDistance(stats.totalDistanceM)}
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

      {/* Filters */}
      {trips.length > 0 && (
        <div className="px-3 py-2.5 border-b border-white/10 space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search trips, places, modes..."
              className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-slate-900/80 border border-white/10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/50"
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

          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                aria-label="Filter by date"
                className="w-full pl-8 pr-2 py-1 rounded-lg bg-slate-900/80 border border-white/10 text-[11px] text-slate-200 focus:outline-none focus:border-cyan-400/50 [color-scheme:dark]"
              />
            </div>
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter('')}
                className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-slate-300"
              >
                All
              </button>
            )}
          </div>

          {stats && (
            <div className="flex items-center justify-between text-[10px] text-slate-400 px-0.5">
              <span className="flex items-center gap-1 truncate">
                <FileJson className="w-3 h-3 text-cyan-400/80 shrink-0" />
                <span className="truncate">{formatSchemaName(stats.schema)}</span>
              </span>
              <span className="tabular-nums shrink-0">{stats.parseDurationMs}ms</span>
            </div>
          )}
        </div>
      )}

      {/* Scrollable Day & Trip List */}
      <div className="flex-1 overflow-y-auto obsidian-scroll p-2.5 space-y-3">
        {trips.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 py-8">
            <div className="w-11 h-11 rounded-2xl bg-slate-900/90 border border-white/10 flex items-center justify-center mb-3">
              <MapPin className="w-5 h-5 text-slate-400" />
            </div>
            <p className="text-xs font-medium text-slate-200">
              No Timeline Loaded Yet
            </p>
            <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
              Import a Google Takeout or on-device Timeline{' '}
              <code className="text-cyan-300">.json</code> file, or click{' '}
              <span className="text-slate-200 font-medium">Load Sample Journey</span>{' '}
              to preview.
            </p>
          </div>
        ) : filteredDays.length === 0 ? (
          <div className="text-center py-8 px-4">
            <p className="text-xs font-medium text-slate-300">
              No trips match your filters
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setDateFilter('');
              }}
              className="mt-2 px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-cyan-300"
            >
              Reset filters
            </button>
          </div>
        ) : (
          filteredDays.map(({ day, trips: dayTrips }) => (
            <div key={day.dateKey} className="space-y-1.5">
              <div className="px-1.5 flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-300 tracking-tight">
                  {day.dateLabel}
                </span>
                <span className="text-[10px] text-slate-400 tabular-nums">
                  {formatDistance(day.totalDistanceM)} · {formatDuration(day.totalDurationMs)}
                </span>
              </div>

              <div className="space-y-1.5">
                {dayTrips.map((trip) => {
                  const isSelected = trip.id === selectedTripId;
                  return (
                    <button
                      key={trip.id}
                      type="button"
                      onClick={() => onSelectTrip(trip.id)}
                      className={`w-full text-left p-2.5 rounded-xl border transition-all ${
                        isSelected
                          ? 'bg-cyan-500/15 border-cyan-400/50 shadow-lg shadow-cyan-950/30'
                          : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.07] hover:border-white/15'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-medium text-slate-100 leading-snug line-clamp-2">
                          {trip.title}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 tabular-nums shrink-0 mt-0.5">
                          {formatShortTime(trip.startTimeMs)}
                        </span>
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 flex-wrap">
                          {trip.modes
                            .filter((m) => m !== 'STILL' || trip.modes.length === 1)
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
                          {trip.visits.length > 0 && (
                            <span className="text-[10px] text-slate-400 ml-0.5 tabular-nums">
                              {trip.visits.length}{' '}
                              {trip.visits.length === 1 ? 'stop' : 'stops'}
                            </span>
                          )}
                        </div>

                        <div className="text-[10px] text-slate-300 tabular-nums shrink-0">
                          {formatDistance(trip.distanceM)} ·{' '}
                          {formatDuration(trip.durationMs)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
