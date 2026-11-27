import { useCallback, useRef, useState } from 'react';
import {
  Camera,
  Film,
  Loader2,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { SPEED_PRESETS } from '../engine/animationController';
import type {
  AccentThemeId,
  SpeedPreset,
  TelemetryFrame,
  Trip,
  UnitSystem,
} from '../types/timeline';
import {
  formatClock,
  formatDistance,
  formatDuration,
  formatShortTime,
} from '../utils/format';
import { clamp, lerp, MODE_COLORS, MODE_LABELS } from '../utils/geo';
import { resetCrownDetent, triggerCrownTick } from '../utils/haptics';
import { ACCENT_THEMES } from '../utils/settings';

interface PlaybackDockProps {
  trip: Trip | null;
  frame: TelemetryFrame | null;
  sidebarOpen: boolean;
  units: UnitSystem;
  accentTheme: AccentThemeId;
  onTogglePlay: () => void;
  onSeekProgress: (progress: number) => void;
  onStepSegment: (delta: -1 | 1) => void;
  onSelectSpeed: (preset: SpeedPreset) => void;
  onToggleLoop: () => void;
  onExportPostcard: () => void;
  isExportingPostcard: boolean;
  onExportReel: () => void;
  isExportingReel: boolean;
}

export function PlaybackDock({
  trip,
  frame,
  sidebarOpen,
  units,
  accentTheme,
  onTogglePlay,
  onSeekProgress,
  onStepSegment,
  onSelectSpeed,
  onToggleLoop,
  onExportPostcard,
  isExportingPostcard,
  onExportReel,
  isExportingReel,
}: PlaybackDockProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverProgress, setHoverProgress] = useState<number | null>(null);
  const [dragProgress, setDragProgress] = useState<number | null>(null);
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
    setDragProgress(p);
    triggerCrownTick(p);
    onSeekProgress(p);

    const onMove = (ev: PointerEvent) => {
      if (!isScrubbingRef.current) return;
      const mp = computeProgressFromClientX(ev.clientX);
      setHoverProgress(mp);
      setDragProgress(mp);
      triggerCrownTick(mp);
      onSeekProgress(mp);
    };

    const onUp = () => {
      isScrubbingRef.current = false;
      setDragProgress(null);
      resetCrownDetent();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (!trip || !frame) return null;

  const displayProgress = dragProgress ?? frame.progress;
  const accent = ACCENT_THEMES[accentTheme];
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
      <div className="pointer-events-auto w-full max-w-[740px] instrument-surface rounded-xl px-3.5 py-2.5 space-y-2">
        {/* Top Row: Route Title & Elapsed Window */}
        <div className="flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-slate-100 truncate">
              {trip.title}
            </span>
            <span className="hidden sm:inline text-slate-600">·</span>
            <span className="hidden sm:inline text-[11px] text-slate-400 tabular-nums shrink-0">
              {formatDistance(trip.distanceM, units)} · {formatDuration(trip.durationMs)}
            </span>
          </div>

          <div className="font-mono text-[11px] text-slate-300 tabular-nums shrink-0">
            <span>{formatClock(frame.currentTimeMs)}</span>
            <span className="text-slate-600 mx-1">/</span>
            <span className="text-slate-400">{formatShortTime(trip.endTimeMs)}</span>
          </div>
        </div>

        {/* Interactive Scrubber Track */}
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
          aria-valuenow={Math.round(displayProgress * 100)}
          tabIndex={0}
          className="relative h-6 flex items-center cursor-pointer group select-none touch-none"
        >
          {hoverProgress !== null && hoverTimeMs !== null && (
            <div
              className="absolute -top-8 -translate-x-1/2 px-2 py-0.5 rounded-lg instrument-surface-strong text-[11px] text-slate-100 whitespace-nowrap pointer-events-none z-10 flex items-center gap-1.5"
              style={{ left: `${clamp(hoverProgress * 100, 7, 93)}%` }}
            >
              <span className="font-mono font-medium tabular-nums">
                {formatClock(hoverTimeMs)}
              </span>
              {hoverSegment && (
                <>
                  <span className="text-slate-600">·</span>
                  <span style={{ color: MODE_COLORS[hoverSegment.mode] }}>
                    {hoverSegment.kind === 'VISIT'
                      ? hoverSegment.label
                      : MODE_LABELS[hoverSegment.mode]}
                  </span>
                </>
              )}
            </div>
          )}

          <div className="relative w-full h-2 rounded-full bg-white/[0.08] overflow-hidden flex">
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
                    opacity: seg.kind === 'VISIT' ? 0.3 : 0.82,
                  }}
                  className="h-full border-r border-[#0B0E14]/60"
                />
              );
            })}

            <div
              className="absolute top-0 right-0 bottom-0 bg-[#0B0E14]/68 pointer-events-none"
              style={{ left: `${displayProgress * 100}%` }}
            />
          </div>

          {trip.visits.map((v) => {
            const posPct = ((v.startTimeMs - trip.startTimeMs) / totalSpan) * 100;
            return (
              <div
                key={v.id}
                style={{ left: `${posPct}%` }}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-3 rounded-full bg-white/70 ring-1 ring-[#0B0E14] pointer-events-none"
              />
            );
          })}

          <div
            style={{
              left: `${displayProgress * 100}%`,
              borderColor: accent.primary,
            }}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 group-hover:scale-110 transition-transform pointer-events-none"
          />
        </div>

        {/* Bottom Instrument Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onStepSegment(-1)}
              className="p-2 rounded-lg instrument-inset hover:bg-white/[0.08] text-slate-300 hover:text-white active:scale-[0.98] transition-all"
              title="Previous segment (Left Arrow)"
              aria-label="Previous segment"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onTogglePlay}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-medium text-xs active:scale-[0.98] transition-all hover:brightness-110"
              style={{
                backgroundColor: accent.buttonBg,
                color: accent.buttonText,
              }}
              title={frame.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              aria-label={frame.isPlaying ? 'Pause playback' : 'Play playback'}
            >
              {frame.isPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Play</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => onStepSegment(1)}
              className="p-2 rounded-lg instrument-inset hover:bg-white/[0.08] text-slate-300 hover:text-white active:scale-[0.98] transition-all"
              title="Next segment (Right Arrow)"
              aria-label="Next segment"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onToggleLoop}
              className="p-2 rounded-lg border active:scale-[0.98] transition-all"
              style={{
                backgroundColor: frame.loop ? accent.softBg : 'rgba(255,255,255,0.03)',
                borderColor: frame.loop ? accent.border : 'rgba(255,255,255,0.07)',
                color: frame.loop ? accent.text : '#94a3b8',
              }}
              title="Toggle loop"
              aria-label="Toggle loop"
            >
              <Repeat className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onExportPostcard}
              disabled={isExportingPostcard || isExportingReel}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg instrument-inset hover:bg-white/[0.08] text-slate-200 hover:text-white text-xs font-medium active:scale-[0.98] transition-all disabled:opacity-50"
              title="Export 1080×1350 Route Postcard"
              aria-label="Share route postcard"
            >
              {isExportingPostcard ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: accent.primary }} />
              ) : (
                <Camera className="w-3.5 h-3.5" style={{ color: accent.primary }} />
              )}
              <span className="hidden sm:inline">Card</span>
            </button>

            <button
              type="button"
              onClick={onExportReel}
              disabled={isExportingReel || isExportingPostcard}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg instrument-inset hover:bg-white/[0.08] text-slate-200 hover:text-white text-xs font-medium active:scale-[0.98] transition-all disabled:opacity-50"
              title="Export 12s 9:16 Video Reel (720×1280)"
              aria-label="Export 9:16 video reel"
            >
              {isExportingReel ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: accent.primary }} />
              ) : (
                <Film className="w-3.5 h-3.5" style={{ color: accent.primary }} />
              )}
              <span className="hidden sm:inline">Reel 9:16</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center p-0.5 rounded-lg instrument-inset">
              {multiplierPresets.map((preset) => {
                const active = isSamePreset(frame.speedPreset, preset);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => onSelectSpeed(preset)}
                    className="px-2 py-1 rounded-md text-[11px] font-mono font-medium tabular-nums active:scale-[0.98] transition-all border"
                    style={{
                      backgroundColor: active ? accent.softBg : 'transparent',
                      borderColor: active ? accent.border : 'transparent',
                      color: active ? accent.text : '#94a3b8',
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center p-0.5 rounded-lg instrument-inset">
              {fitPresets.map((preset) => {
                const active = isSamePreset(frame.speedPreset, preset);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => onSelectSpeed(preset)}
                    className={`px-2 py-1 rounded-md text-[11px] font-medium tabular-nums active:scale-[0.98] transition-all border ${
                      active
                        ? 'bg-emerald-500/15 text-emerald-200 border-emerald-400/35'
                        : 'text-slate-400 hover:text-slate-100 border-transparent'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {frame.speedPreset.kind === 'FIT_DURATION' && (
              <span className="hidden md:inline-block text-[10px] font-mono text-slate-400 tabular-nums px-0.5">
                ~{Math.round(frame.effectiveMultiplier)}x
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
