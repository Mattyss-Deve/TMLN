import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { AccentThemeId, TelemetryFrame, Trip } from '../types/timeline';
import { formatClock, formatDate } from '../utils/format';
import { clamp, MODE_COLORS } from '../utils/geo';
import { resetCrownDetent, triggerCrownTick } from '../utils/haptics';
import { ACCENT_THEMES } from '../utils/settings';
import { computeSolarPosition, getSolarPhaseAccent } from '../utils/solar';

interface CinemaOverlayProps {
  active: boolean;
  trip: Trip | null;
  frame: TelemetryFrame | null;
  accentTheme: AccentThemeId;
  solarSync: boolean;
  pulseIcon: 'play' | 'pause' | null;
  onExit: () => void;
  onTogglePlay: () => void;
  onScrubProgress: (progress: number) => void;
}

export function CinemaOverlay({
  active,
  trip,
  frame,
  accentTheme,
  solarSync,
  pulseIcon,
  onExit,
  onTogglePlay,
  onScrubProgress,
}: CinemaOverlayProps) {
  const [titleDimmed, setTitleDimmed] = useState(false);
  const [scrubPreviewProgress, setScrubPreviewProgress] = useState<number | null>(null);

  const dimTimerRef = useRef<number | null>(null);
  const lastTapMsRef = useRef<number>(0);
  const exitTimerRef = useRef<number | null>(null);
  const scrubGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    startProgress: number;
    isScrubbing: boolean;
  } | null>(null);

  const accent = ACCENT_THEMES[accentTheme];

  const wakeTitleCard = () => {
    setTitleDimmed(false);
    if (dimTimerRef.current !== null) {
      window.clearTimeout(dimTimerRef.current);
    }
    dimTimerRef.current = window.setTimeout(() => {
      setTitleDimmed(true);
    }, 3000);
  };

  // Fade title card to 35% opacity 3s after entering Cinema Mode
  useEffect(() => {
    if (!active) {
      setTitleDimmed(false);
      setScrubPreviewProgress(null);
      if (dimTimerRef.current !== null) {
        window.clearTimeout(dimTimerRef.current);
        dimTimerRef.current = null;
      }
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      return;
    }

    wakeTitleCard();
    return () => {
      if (dimTimerRef.current !== null) {
        window.clearTimeout(dimTimerRef.current);
        dimTimerRef.current = null;
      }
    };
  }, [active]);

  // Wake title card briefly when pulseIcon triggers
  useEffect(() => {
    if (active && pulseIcon) {
      wakeTitleCard();
    }
  }, [active, pulseIcon]);

  // Lower-screen horizontal scrub zone (also handles single-tap exit / double-tap play-pause)
  const handleScrubPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!active || !frame || !e.isPrimary) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubGestureRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
      startProgress: frame.progress,
      isScrubbing: false,
    };
  };

  const handleScrubPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = scrubGestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;

    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;

    if (!g.isScrubbing && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      g.isScrubbing = true;
      wakeTitleCard();
    }

    if (g.isScrubbing) {
      e.preventDefault();
      e.stopPropagation();
      const spanPx = Math.max(240, window.innerWidth * 0.72);
      const nextProgress = clamp(g.startProgress + dx / spanPx, 0, 1);
      setScrubPreviewProgress(nextProgress);
      triggerCrownTick(nextProgress);
      onScrubProgress(nextProgress);
    }
  };

  const handleScrubPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = scrubGestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    scrubGestureRef.current = null;

    if (g.isScrubbing) {
      setScrubPreviewProgress(null);
      resetCrownDetent();
      return;
    }

    // Gesture-safe single/double tap inside lower strip
    const dist = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
    const dur = performance.now() - g.startTime;
    if (dist < 6 && dur < 260) {
      const now = performance.now();
      if (now - lastTapMsRef.current < 260) {
        if (exitTimerRef.current !== null) {
          window.clearTimeout(exitTimerRef.current);
          exitTimerRef.current = null;
        }
        lastTapMsRef.current = 0;
        onTogglePlay();
      } else {
        lastTapMsRef.current = now;
        exitTimerRef.current = window.setTimeout(() => {
          exitTimerRef.current = null;
          onExit();
        }, 250);
      }
    }
  };

  const displayProgress = scrubPreviewProgress ?? frame?.progress ?? 0;
  const solar =
    solarSync && frame
      ? computeSolarPosition(frame.lat, frame.lng, frame.currentTimeMs)
      : null;

  return (
    <div
      className={`fixed inset-0 z-30 pointer-events-none select-none transition-opacity duration-300 ${
        active ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden={!active}
    >
      {/* Top 2.39:1 Anamorphic Letterbox Bar */}
      <div
        className={`fixed top-0 left-0 right-0 bg-black transition-transform duration-500 ease-out ${
          active ? 'translate-y-0' : '-translate-y-full'
        }`}
        style={{ height: 'clamp(44px, 11vh, 104px)' }}
      />

      {/* Bottom 2.39:1 Anamorphic Letterbox Bar */}
      <div
        className={`fixed bottom-0 left-0 right-0 bg-black transition-transform duration-500 ease-out ${
          active ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ height: 'clamp(44px, 11vh, 104px)' }}
      />

      {/* Center Double-Tap Play/Pause Pulse Indicator */}
      {active && pulseIcon && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full instrument-surface-strong flex items-center justify-center animate-ping-once">
            {pulseIcon === 'play' ? (
              <Play className="w-7 h-7 text-white fill-white translate-x-0.5" />
            ) : (
              <Pause className="w-7 h-7 text-white fill-white" />
            )}
          </div>
        </div>
      )}

      {/* Lower-Screen Horizontal Swipe Scrub Zone */}
      {active && (
        <div
          onPointerDown={handleScrubPointerDown}
          onPointerMove={handleScrubPointerMove}
          onPointerUp={handleScrubPointerUp}
          onPointerCancel={() => {
            scrubGestureRef.current = null;
            setScrubPreviewProgress(null);
            resetCrownDetent();
          }}
          className="fixed left-0 right-0 pointer-events-auto touch-none"
          style={{
            bottom: 'clamp(44px, 11vh, 104px)',
            height: '24vh',
          }}
          aria-label="Swipe horizontally to scrub playback"
        />
      )}

      {/* Minimal Bottom-Left Floating Title Card (fades to 35% after 3s) */}
      {active && trip && frame && (
        <div
          className={`fixed left-4 sm:left-6 max-w-[min(86vw,520px)] transition-opacity duration-700 ${
            titleDimmed && scrubPreviewProgress === null ? 'opacity-35' : 'opacity-100'
          }`}
          style={{ bottom: 'calc(clamp(44px, 11vh, 104px) + 14px)' }}
        >
          <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 rounded-xl bg-black/55 backdrop-blur-md border border-white/[0.08] text-xs text-slate-100">
            <span className="text-slate-300">{formatDate(frame.currentTimeMs)}</span>
            <span className="text-slate-600">•</span>
            <span className="font-medium text-white truncate max-w-[200px] sm:max-w-[260px]">
              {trip.title}
            </span>
            <span className="text-slate-600">•</span>
            <span
              className="font-mono font-semibold tabular-nums"
              style={{ color: MODE_COLORS[frame.mode] }}
            >
              {formatClock(frame.currentTimeMs)}
            </span>
            {solar && (
              <>
                <span className="text-slate-600">•</span>
                <span
                  className="text-[11px] font-medium"
                  style={{ color: getSolarPhaseAccent(solar.phase) }}
                >
                  {solar.phase}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Subtle Scrub Indicator Pill while swiping */}
      {active && scrubPreviewProgress !== null && frame && (
        <div
          className="fixed left-1/2 -translate-x-1/2 px-3 py-1 rounded-lg instrument-surface-strong text-xs font-mono font-semibold text-white tabular-nums"
          style={{ bottom: 'calc(clamp(44px, 11vh, 104px) + 56px)' }}
        >
          {formatClock(frame.currentTimeMs)} · {Math.round(displayProgress * 100)}%
        </div>
      )}

      {/* Hairline Playback Progress Bar Along Bottom Edge */}
      {active && (
        <div className="fixed bottom-0 left-0 right-0 h-[2px] bg-white/15 z-40">
          <div
            className="h-full transition-[width] duration-75"
            style={{
              width: `${clamp(displayProgress * 100, 0, 100)}%`,
              backgroundColor: accent.primary,
            }}
          />
        </div>
      )}
    </div>
  );
}
