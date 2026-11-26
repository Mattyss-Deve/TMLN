import { useCallback, useRef, useState } from 'react';
import {
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { SPEED_PRESETS } from '../engine/animationController';
import type { SpeedPreset, TelemetryFrame, Trip } from '../types/timeline';
import {
  formatClock,
  formatDistance,
  formatDuration,
  formatShortTime,
} from '../utils/format';
import { clamp, lerp, MODE_COLORS, MODE_LABELS } from '../utils/geo';

interface PlaybackDockProps {
  trip: Trip | null;
  frame: TelemetryFrame | null;
  sidebarOpen: boolean;
  onTogglePlay: () => void;
  onSeekProgress: (progress: number) => void;
  onStepSegment: (delta: -1 | 1) => void;
  onSelectSpeed: (preset: SpeedPreset) => void;
  onToggleLoop: () => void;
}

export function PlaybackDock({
  trip,
  frame,
  sidebarOpen,
  onTogglePlay,
  onSeekProgress,
  onStepSegment,
  onSelectSpeed,
  onToggleLoop,
}: PlaybackDockProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverProgress, setHoverProgress] = useState<number | null>(null);
  const isScrubbingRef = useRef(false);

  const computeProgressFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trip) return;
    e.preventDefault();
    isScrubbingRef.current = true;
    const p = computeProgressFromClientX(e.clientX);
    onSeekProgress(p);

    const onMove = (ev: PointerEvent) => {
      if (!isScrubbingRef.current) return;
      const mp = computeProgressFromClientX(ev.clientX);
      setHoverProgress(mp);
      onSeekProgress(mp);
    };

    const onUp = () => {
      isScrubbingRef.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (!trip || !frame) return null;

  const totalSpan = Math.max(1, trip.endTimeMs - trip.startTimeMs);
  const hoverTimeMs =
    hoverProgress !== null ? lerp(trip.startTimeMs, trip.endTimeMs, hoverProgress) : null;
  const hoverSegment =
    hoverTimeMs !== null
      ? trip.segments.find(
          (s) => hoverTimeMs >= s.startTimeMs && hoverTimeMs <= s.endTimeMs
        ) ?? trip.segments[0]
      : null;

  const multiplierPresets = SPEED_PRESETS.filter((p) => p.kind === 'MULTIPLIER');
  const fitPresets = SPEED_PRESETS.filter((p) => p.kind === 'FIT_DURATION');

  const isSamePreset = (a: SpeedPreset, b: SpeedPreset): boolean => {
    if (a.kind !== b.kind) return false;
    return a.kind === 'MULTIPLIER' && b.kind === 'MULTIPLIER'
      ? a.multiplier === b.multiplier
      : a.kind === 'FIT_DURATION' && b.kind === 'FIT_DURATION'
        ? a.seconds === b.seconds
        : false;
  };

  return (
    <div
      style={{ bottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}
      className={`fixed right-3 z-20 flex justify-center pointer-events-none transition-all ${
        sidebarOpen ? 'left-3 md:left-[356px]' : 'left-3'
      }`}
    >
      <div className="pointer-events-auto w-full max-w-[760px] rounded-2xl bg-slate-950/85 border border-white/10 backdrop-blur-md shadow-2xl px-4 py-3 space-y-2.5">
        {/* Top Row: Trip Summary & Time Window */}
        <div className="flex items-center justify-between gap-3 text-[11px]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-slate-100 truncate">
              {trip.title}
            </span>
            <span className="hidden sm:inline text-slate-500">·</span>
            <span className="hidden sm:inline text-slate-400 tabular-nums shrink-0">
              {formatDistance(trip.distanceM)} · {formatDuration(trip.durationMs)}
            </span>
          </div>

          <div className="font-mono text-[11px] text-slate-300 tabular-nums shrink-0">
            <span>{formatClock(frame.currentTimeMs)}</span>
            <span className="text-slate-500 mx-1">/</span>
            <span className="text-slate-400">{formatShortTime(trip.endTimeMs)}</span>
          </div>
        </div>

        {/* Interactive Scrubber with Color-Coded Segments */}
        <div
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={(e) => setHoverProgress(computeProgressFromClientX(e.clientX))}
          onPointerLeave={() => {
            if (!isScrubbingRef.current) setHoverProgress(null);
          }}
          role="slider"
          aria-label="Timeline playback position"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(frame.progress * 100)}
          tabIndex={0}
          className="relative h-7 flex items-center cursor-pointer group select-none touch-none"
        >
          {/* Hover Timestamp Preview */}
          {hoverProgress !== null && hoverTimeMs !== null && (
            <div
              className="absolute -top-9 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-slate-900/95 border border-white/15 text-[10px] text-slate-100 whitespace-nowrap shadow-xl pointer-events-none z-10 flex items-center gap-1.5"
              style={{ left: `${clamp(hoverProgress * 100, 6, 94)}%` }}
            >
              <span className="font-mono font-semibold tabular-nums">
                {formatClock(hoverTimeMs)}
              </span>
              {hoverSegment && (
                <>
                  <span className="text-slate-500">·</span>
                  <span style={{ color: MODE_COLORS[hoverSegment.mode] }}>
                    {hoverSegment.kind === 'VISIT'
                      ? hoverSegment.label
                      : MODE_LABELS[hoverSegment.mode]}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Segmented Track Bar */}
          <div className="relative w-full h-2.5 rounded-full bg-slate-800/90 overflow-hidden flex">
            {trip.segments.map((seg) => {
              const leftPct = ((seg.startTimeMs - trip.startTimeMs) / totalSpan) * 100;
              const widthPct = Math.max(
                0.6,
                ((seg.endTimeMs - seg.startTimeMs) / totalSpan) * 100
              );
              const color = MODE_COLORS[seg.mode];
              return (
                <div
                  key={seg.id}
                  style={{
                    position: 'absolute',
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    backgroundColor: color,
                    opacity: seg.kind === 'VISIT' ? 0.35 : 0.78,
                  }}
                  className="h-full border-r border-slate-950/60"
                />
              );
            })}

            {/* Unplayed dark overlay past current playhead */}
            <div
              className="absolute top-0 right-0 bottom-0 bg-slate-950/65 pointer-events-none"
              style={{ left: `${frame.progress * 100}%` }}
            />
          </div>

          {/* Visit Anchor Markers along Track */}
          {trip.visits.map((v) => {
            const posPct = ((v.startTimeMs - trip.startTimeMs) / totalSpan) * 100;
            return (
              <div
                key={v.id}
                style={{ left: `${posPct}%` }}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-3.5 rounded-full bg-white/75 ring-1 ring-slate-950 pointer-events-none"
              />
            );
          })}

          {/* Playhead Knob */}
          <div
            style={{ left: `${frame.progress * 100}%` }}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-lg shadow-cyan-500/40 ring-2 ring-cyan-400 group-hover:scale-110 transition-transform pointer-events-none"
          />
        </div>

        {/* Bottom Controls Row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Transport Buttons */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onStepSegment(-1)}
              className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/10 border border-white/5 text-slate-300 hover:text-white transition-colors"
              title="Previous segment (Left Arrow)"
              aria-label="Previous segment"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onTogglePlay}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-xs shadow-lg shadow-cyan-500/25 transition-all"
              title={frame.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              aria-label={frame.isPlaying ? 'Pause playback' : 'Play playback'}
            >
              {frame.isPlaying ? (
                <>
                  <Pause className="w-4 h-4 fill-current" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Play</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => onStepSegment(1)}
              className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/10 border border-white/5 text-slate-300 hover:text-white transition-colors"
              title="Next segment (Right Arrow)"
              aria-label="Next segment"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onToggleLoop}
              className={`p-2 rounded-xl border transition-colors ${
                frame.loop
                  ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300'
                  : 'bg-white/[0.04] border-white/5 text-slate-400 hover:text-white hover:bg-white/10'
              }`}
              title="Toggle loop"
              aria-label="Toggle loop"
            >
              <Repeat className="w-4 h-4" />
            </button>
          </div>

          {/* Speed Multipliers & Fit Modes */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center p-0.5 rounded-xl bg-slate-900/90 border border-white/10">
              {multiplierPresets.map((preset) => {
                const active = isSamePreset(frame.speedPreset, preset);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => onSelectSpeed(preset)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-mono font-medium transition-all ${
                      active
                        ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/40'
                        : 'text-slate-400 hover:text-slate-100 border border-transparent'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center p-0.5 rounded-xl bg-slate-900/90 border border-white/10">
              {fitPresets.map((preset) => {
                const active = isSamePreset(frame.speedPreset, preset);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => onSelectSpeed(preset)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${
                      active
                        ? 'bg-emerald-400/20 text-emerald-200 border border-emerald-400/40'
                        : 'text-slate-400 hover:text-slate-100 border border-transparent'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {frame.speedPreset.kind === 'FIT_DURATION' && (
              <span className="hidden md:inline-block text-[10px] font-mono text-slate-400 tabular-nums px-1">
                ~{Math.round(frame.effectiveMultiplier)}x
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
