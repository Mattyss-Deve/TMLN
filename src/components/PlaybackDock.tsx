import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Film,
  Loader2,
  MoreHorizontal,
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
import {
  resetCrownDetent,
  triggerCrownTick,
  triggerSegmentPulse,
} from '../utils/haptics';
import { ACCENT_THEMES } from '../utils/settings';

const SPARKLINE_BUCKETS = 72;
const SPARKLINE_W = 360;
const SPARKLINE_H = 26;

interface PlaybackDockProps {
  trip: Trip | null;
  frame: TelemetryFrame | null;
  sidebarOpen: boolean;
  units: UnitSystem;
  accentTheme: AccentThemeId;
  onTogglePlay: () => void;
  onSeekProgress: (progress: number) => void;
  onStepSegment: (delta: -1 | 1) => void;
  onStepTrip?: (delta: -1 | 1) => void;
  onSelectSpeed: (preset: SpeedPreset) => void;
  onToggleLoop: () => void;
  onExportPostcard: () => void;
  isExportingPostcard: boolean;
  onExportReel: () => void;
  isExportingReel: boolean;
}

/**
 * Builds an SVG velocity waveform path and stationary dwell rectangles
 * across the trip's time window using log-compressed speeds so walking,
 * driving, and flights are all clearly legible together.
 */
function buildVelocitySparkline(trip: Trip): {
  areaPath: string;
  linePath: string;
  dwellBlocks: Array<{ x: number; width: number }>;
} {
  const totalSpan = Math.max(1, trip.endTimeMs - trip.startTimeMs);
  const bucketMaxSpeed = new Float32Array(SPARKLINE_BUCKETS);

  for (let i = 0; i < trip.waypoints.length; i++) {
    const wp = trip.waypoints[i];
    const ratio = clamp((wp.timestampMs - trip.startTimeMs) / totalSpan, 0, 0.9999);
    const idx = Math.floor(ratio * SPARKLINE_BUCKETS);
    const spd = wp.mode === 'STILL' ? 0 : Math.max(0, wp.speedKmh);
    if (spd > bucketMaxSpeed[idx]) {
      bucketMaxSpeed[idx] = spd;
    }
  }

  // Fallback fill from segment average speeds for sparse synthetic segments
  for (const seg of trip.segments) {
    if (seg.kind === 'VISIT' || seg.mode === 'STILL') continue;
    const startB = clamp(
      Math.floor(((seg.startTimeMs - trip.startTimeMs) / totalSpan) * SPARKLINE_BUCKETS),
      0,
      SPARKLINE_BUCKETS - 1
    );
    const endB = clamp(
      Math.floor(((seg.endTimeMs - trip.startTimeMs) / totalSpan) * SPARKLINE_BUCKETS),
      0,
      SPARKLINE_BUCKETS - 1
    );
    for (let b = startB; b <= endB; b++) {
      if (bucketMaxSpeed[b] < seg.avgSpeedKmh * 0.6) {
        bucketMaxSpeed[b] = seg.avgSpeedKmh;
      }
    }
  }

  // Log-compress speeds so walking (~5km/h) & driving (~90km/h) both show clear structure
  let peakCompressed = 0.001;
  const compressed = new Float32Array(SPARKLINE_BUCKETS);
  for (let i = 0; i < SPARKLINE_BUCKETS; i++) {
    const v = Math.log1p(bucketMaxSpeed[i]);
    compressed[i] = v;
    if (v > peakCompressed) peakCompressed = v;
  }

  // Light 3-tap smoothing for clean organic waveform
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < SPARKLINE_BUCKETS; i++) {
    const prev = compressed[Math.max(0, i - 1)];
    const cur = compressed[i];
    const next = compressed[Math.min(SPARKLINE_BUCKETS - 1, i + 1)];
    const smoothed = (prev + cur * 2 + next) * 0.25;
    const norm = clamp(smoothed / peakCompressed, 0, 1);
    const x = (i / (SPARKLINE_BUCKETS - 1)) * SPARKLINE_W;
    const y = SPARKLINE_H - 3 - norm * (SPARKLINE_H - 6);
    pts.push([Number(x.toFixed(1)), Number(y.toFixed(1))]);
  }

  let linePath = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    linePath += ` L ${pts[i][0]} ${pts[i][1]}`;
  }
  const areaPath = `${linePath} L ${SPARKLINE_W} ${SPARKLINE_H} L 0 ${SPARKLINE_H} Z`;

  const dwellBlocks = trip.segments
    .filter((s) => s.kind === 'VISIT')
    .map((s) => {
      const leftRatio = clamp((s.startTimeMs - trip.startTimeMs) / totalSpan, 0, 1);
      const widthRatio = clamp((s.endTimeMs - s.startTimeMs) / totalSpan, 0.008, 1);
      return {
        x: Number((leftRatio * SPARKLINE_W).toFixed(1)),
        width: Number((widthRatio * SPARKLINE_W).toFixed(1)),
      };
    });

  return { areaPath, linePath, dwellBlocks };
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
  onStepTrip,
  onSelectSpeed,
  onToggleLoop,
  onExportPostcard,
  isExportingPostcard,
  onExportReel,
  isExportingReel,
}: PlaybackDockProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dockSwipeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);

  const [hoverProgress, setHoverProgress] = useState<number | null>(null);
  const [dragProgress, setDragProgress] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const isScrubbingRef = useRef(false);

  // Close overflow popover on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [menuOpen]);

  const sparkline = useMemo(
    () => (trip ? buildVelocitySparkline(trip) : null),
    [trip]
  );

  const computeProgressFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  }, []);

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trip) return;
    e.preventDefault();
    e.stopPropagation();
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

  // Swipe-left / swipe-right on dock body (outside scrubber) to jump to previous/next day
  const handleDockPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onStepTrip || !e.isPrimary) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('[role="slider"], button, input')) return;
    dockSwipeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
    };
  };

  const handleDockPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const swipe = dockSwipeRef.current;
    if (!swipe || swipe.pointerId !== e.pointerId || !onStepTrip) return;
    dockSwipeRef.current = null;
    const dx = e.clientX - swipe.startX;
    const dy = e.clientY - swipe.startY;
    if (Math.abs(dx) >= 54 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      triggerSegmentPulse();
      // Swipe left -> next chronological day (+1); swipe right -> previous day (-1)
      onStepTrip(dx < 0 ? 1 : -1);
    }
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

  const hasOverflowIndicator = frame.loop || isExportingPostcard || isExportingReel;

  return (
    <div
      style={{ bottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}
      className={`fixed right-3 z-20 flex justify-center pointer-events-none transition-all ${
        sidebarOpen ? 'left-3 md:left-[356px]' : 'left-3'
      }`}
    >
      <div
        onPointerDown={handleDockPointerDown}
        onPointerUp={handleDockPointerUp}
        onPointerCancel={() => {
          dockSwipeRef.current = null;
        }}
        className="pointer-events-auto w-full max-w-[700px] instrument-surface rounded-xl px-3.5 py-2.5 space-y-2"
      >
        {/* Top Row: Route Title (swipe left/right here to switch days) & Time Window */}
        <div
          className="flex items-center justify-between gap-3 text-xs select-none"
          title="Swipe left or right on the dock to jump to the previous or next day"
        >
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

        {/* Velocity & Dwell Sparkline Scrubber */}
        <div
          ref={trackRef}
          onPointerDown={handleTrackPointerDown}
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
          className="relative h-8 flex items-center cursor-pointer group select-none touch-none"
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

          {/* Sparkline + Mode Ribbon Container */}
          <div className="relative w-full h-7 rounded-lg bg-white/[0.04] border border-white/[0.07] overflow-hidden">
            {/* SVG Velocity Waveform & Dwell Blocks */}
            {sparkline && (
              <svg
                viewBox={`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`}
                preserveAspectRatio="none"
                className="absolute inset-0 w-full h-full pointer-events-none"
                aria-hidden="true"
              >
                {/* Stationary dwell blocks */}
                {sparkline.dwellBlocks.map((b, idx) => (
                  <rect
                    key={idx}
                    x={b.x}
                    y={SPARKLINE_H - 8}
                    width={b.width}
                    height={8}
                    fill="rgba(52, 211, 153, 0.22)"
                  />
                ))}
                {/* Velocity waveform fill & crisp stroke */}
                <path
                  d={sparkline.areaPath}
                  fill={accent.primary}
                  fillOpacity="0.22"
                />
                <path
                  d={sparkline.linePath}
                  fill="none"
                  stroke={accent.primary}
                  strokeWidth="1.25"
                  strokeOpacity="0.82"
                />
              </svg>
            )}

            {/* Bottom Mode Color Strip */}
            <div className="absolute left-0 right-0 bottom-0 h-1.5 flex">
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
                      opacity: seg.kind === 'VISIT' ? 0.35 : 0.88,
                    }}
                    className="h-full border-r border-[#0B0E14]/60"
                  />
                );
              })}
            </div>

            {/* Unplayed Right Curtain */}
            <div
              className="absolute top-0 right-0 bottom-0 bg-[#0B0E14]/68 pointer-events-none"
              style={{ left: `${displayProgress * 100}%` }}
            />
          </div>

          {/* Crisp Vertical Playhead Needle */}
          <div
            style={{ left: `${displayProgress * 100}%` }}
            className="absolute top-0.5 bottom-0.5 -translate-x-1/2 w-[2px] bg-white rounded-full pointer-events-none"
          >
            <div
              style={{ borderColor: accent.primary }}
              className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 group-hover:scale-110 transition-transform"
            />
          </div>
        </div>

        {/* Bottom Sleek Instrument Controls */}
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

            {/* Compact ••• Overflow Popover (Loop, Share Card, Reel 9:16) */}
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="relative p-2 rounded-lg border active:scale-[0.98] transition-all"
                style={{
                  backgroundColor: menuOpen
                    ? accent.softBg
                    : 'rgba(255,255,255,0.03)',
                  borderColor: menuOpen
                    ? accent.border
                    : 'rgba(255,255,255,0.07)',
                  color: menuOpen ? accent.text : '#cbd5e1',
                }}
                title="More actions (Loop, Postcard, 9:16 Reel)"
                aria-label="More playback and export actions"
                aria-expanded={menuOpen}
              >
                {isExportingPostcard || isExportingReel ? (
                  <Loader2
                    className="w-3.5 h-3.5 animate-spin"
                    style={{ color: accent.primary }}
                  />
                ) : (
                  <MoreHorizontal className="w-3.5 h-3.5" />
                )}
                {hasOverflowIndicator && !menuOpen && (
                  <span
                    className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: accent.primary }}
                  />
                )}
              </button>

              {menuOpen && (
                <div className="absolute left-0 bottom-full mb-2 w-48 rounded-xl instrument-surface-strong p-1.5 space-y-1 z-30">
                  <button
                    type="button"
                    onClick={() => {
                      onToggleLoop();
                      setMenuOpen(false);
                    }}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs font-medium hover:bg-white/[0.07] active:scale-[0.98] transition-all"
                    style={{ color: frame.loop ? accent.text : '#e2e8f0' }}
                  >
                    <span className="flex items-center gap-2">
                      <Repeat className="w-3.5 h-3.5" />
                      <span>Loop replay</span>
                    </span>
                    <span className="text-[10px] font-mono opacity-80">
                      {frame.loop ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  <div className="h-px bg-white/[0.07] my-0.5" />

                  <button
                    type="button"
                    disabled={isExportingPostcard || isExportingReel}
                    onClick={() => {
                      setMenuOpen(false);
                      onExportPostcard();
                    }}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-100 hover:bg-white/[0.07] active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2">
                      <Camera
                        className="w-3.5 h-3.5"
                        style={{ color: accent.primary }}
                      />
                      <span>Share Card</span>
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      4:5 PNG
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={isExportingReel || isExportingPostcard}
                    onClick={() => {
                      setMenuOpen(false);
                      onExportReel();
                    }}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-100 hover:bg-white/[0.07] active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2">
                      <Film
                        className="w-3.5 h-3.5"
                        style={{ color: accent.primary }}
                      />
                      <span>Export Reel</span>
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      9:16 12s
                    </span>
                  </button>
                </div>
              )}
            </div>
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
