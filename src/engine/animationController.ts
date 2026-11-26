import type {
  PlaceVisit,
  SpeedPreset,
  TelemetryFrame,
  TransportMode,
  Trip,
  TripSegment,
} from '../types/timeline';
import { clamp, computeBearing, lerp, lerpAngle } from '../utils/geo';

export const SPEED_PRESETS: SpeedPreset[] = [
  { kind: 'MULTIPLIER', multiplier: 1, label: '1x' },
  { kind: 'MULTIPLIER', multiplier: 10, label: '10x' },
  { kind: 'MULTIPLIER', multiplier: 60, label: '60x' },
  { kind: 'MULTIPLIER', multiplier: 300, label: '300x' },
  { kind: 'FIT_DURATION', seconds: 15, label: 'Fit 15s' },
  { kind: 'FIT_DURATION', seconds: 30, label: 'Fit 30s' },
  { kind: 'FIT_DURATION', seconds: 60, label: 'Fit 60s' },
];

export const DEFAULT_SPEED_PRESET: SpeedPreset = SPEED_PRESETS[5]; // Fit 30s

export type FrameListener = (frame: TelemetryFrame) => void;

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

export class AnimationController {
  private trip: Trip | null = null;
  private isPlaying = false;
  private loop = false;
  private currentTimeMs = 0;
  private speedPreset: SpeedPreset = DEFAULT_SPEED_PRESET;

  private rafId: number | null = null;
  private lastRafTimeMs: number | null = null;
  private lastHudEmitTimeMs = 0;

  private smoothedBearing = 0;
  private smoothedSpeedKmh = 0;
  private hasSmoothed = false;

  private frameListeners = new Set<FrameListener>();
  private hudListeners = new Set<FrameListener>();

  public subscribeFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    const snap = this.getSnapshot();
    if (snap) listener(snap);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  public subscribeHud(listener: FrameListener): () => void {
    this.hudListeners.add(listener);
    const snap = this.getSnapshot();
    if (snap) listener(snap);
    return () => {
      this.hudListeners.delete(listener);
    };
  }

  public loadTrip(trip: Trip | null, autoPlay = false): void {
    this.stopRaf();
    this.trip = trip;
    this.isPlaying = false;
    this.hasSmoothed = false;

    if (trip) {
      this.currentTimeMs = trip.startTimeMs;
      const frame = this.computeFrame(true, 0);
      if (frame) {
        this.emitAll(frame, true);
      }
      if (autoPlay) {
        this.play();
      }
    }
  }

  public play(): void {
    if (!this.trip || this.isPlaying) return;
    if (this.currentTimeMs >= this.trip.endTimeMs) {
      this.currentTimeMs = this.trip.startTimeMs;
      this.hasSmoothed = false;
    }
    this.isPlaying = true;
    this.lastRafTimeMs = null;
    this.emitCurrent(true, true);
    this.startRaf();
  }

  public pause(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.stopRaf();
    this.emitCurrent(false, true);
  }

  public togglePlay(): void {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  public seekToTime(timestampMs: number): void {
    if (!this.trip) return;
    this.currentTimeMs = clamp(
      timestampMs,
      this.trip.startTimeMs,
      this.trip.endTimeMs
    );
    this.hasSmoothed = false;
    this.emitCurrent(true, true);
  }

  public seekToProgress(progress: number): void {
    if (!this.trip) return;
    const p = clamp(progress, 0, 1);
    const target = lerp(this.trip.startTimeMs, this.trip.endTimeMs, p);
    this.seekToTime(target);
  }

  public stepSegment(delta: -1 | 1): void {
    if (!this.trip || this.trip.segments.length === 0) return;
    const segments = this.trip.segments;
    const currentIdx = this.findSegmentIndex(this.currentTimeMs);

    if (delta === -1) {
      const seg = segments[currentIdx];
      const segDur = Math.max(1, seg.endTimeMs - seg.startTimeMs);
      const elapsedRatio = (this.currentTimeMs - seg.startTimeMs) / segDur;
      if (elapsedRatio > 0.15 || currentIdx === 0) {
        this.seekToTime(seg.startTimeMs);
      } else {
        this.seekToTime(segments[currentIdx - 1].startTimeMs);
      }
      return;
    }

    if (currentIdx + 1 < segments.length) {
      this.seekToTime(segments[currentIdx + 1].startTimeMs);
    } else {
      this.seekToTime(this.trip.endTimeMs);
    }
  }

  public setSpeedPreset(preset: SpeedPreset): void {
    this.speedPreset = preset;
    this.emitCurrent(false, true);
  }

  public setLoop(enabled: boolean): void {
    this.loop = enabled;
    this.emitCurrent(false, true);
  }

  public getEffectiveMultiplier(): number {
    if (this.speedPreset.kind === 'MULTIPLIER') {
      return this.speedPreset.multiplier;
    }
    if (!this.trip) return 60;
    return Math.max(1, this.trip.durationMs / (this.speedPreset.seconds * 1000));
  }

  public getSnapshot(): TelemetryFrame | null {
    return this.computeFrame(true, 0);
  }

  public destroy(): void {
    this.stopRaf();
    this.frameListeners.clear();
    this.hudListeners.clear();
    this.trip = null;
  }

  private startRaf(): void {
    if (this.rafId !== null) return;
    const tick = (nowMs: number) => {
      if (!this.isPlaying || !this.trip) {
        this.rafId = null;
        return;
      }

      const dtRealMs =
        this.lastRafTimeMs === null ? 16.67 : clamp(nowMs - this.lastRafTimeMs, 0, 100);
      this.lastRafTimeMs = nowMs;

      const multiplier = this.getEffectiveMultiplier();
      this.currentTimeMs += dtRealMs * multiplier;

      let reachedEnd = false;
      if (this.currentTimeMs >= this.trip.endTimeMs) {
        if (this.loop) {
          const overflow = this.currentTimeMs - this.trip.endTimeMs;
          this.currentTimeMs =
            this.trip.startTimeMs + (overflow % Math.max(1, this.trip.durationMs));
          this.hasSmoothed = false;
        } else {
          this.currentTimeMs = this.trip.endTimeMs;
          this.isPlaying = false;
          reachedEnd = true;
        }
      }

      const frame = this.computeFrame(reachedEnd, dtRealMs / 1000);
      if (frame) {
        const shouldEmitHud =
          reachedEnd || nowMs - this.lastHudEmitTimeMs >= 48;
        if (shouldEmitHud) {
          this.lastHudEmitTimeMs = nowMs;
        }
        this.emitAll(frame, shouldEmitHud);
      }

      if (this.isPlaying) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.rafId = null;
      }
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private stopRaf(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastRafTimeMs = null;
  }

  private emitCurrent(snapSmoothing: boolean, emitHud: boolean): void {
    const frame = this.computeFrame(snapSmoothing, 0);
    if (frame) {
      this.emitAll(frame, emitHud);
    }
  }

  private emitAll(frame: TelemetryFrame, emitHud: boolean): void {
    for (const listener of this.frameListeners) {
      listener(frame);
    }
    if (emitHud) {
      for (const listener of this.hudListeners) {
        listener(frame);
      }
    }
  }

  private findSegmentIndex(timeMs: number): number {
    if (!this.trip || this.trip.segments.length === 0) return -1;
    const segments = this.trip.segments;
    for (let i = 0; i < segments.length; i++) {
      if (timeMs >= segments[i].startTimeMs && timeMs <= segments[i].endTimeMs) {
        return i;
      }
    }
    for (let i = segments.length - 1; i >= 0; i--) {
      if (timeMs >= segments[i].startTimeMs) {
        return i;
      }
    }
    return 0;
  }

  private findActiveVisit(timeMs: number): {
    visit: PlaceVisit | null;
    progress: number;
  } {
    if (!this.trip || this.trip.visits.length === 0) {
      return { visit: null, progress: 0 };
    }
    for (const visit of this.trip.visits) {
      if (timeMs >= visit.startTimeMs && timeMs <= visit.endTimeMs) {
        const dur = Math.max(1, visit.endTimeMs - visit.startTimeMs);
        return {
          visit,
          progress: clamp((timeMs - visit.startTimeMs) / dur, 0, 1),
        };
      }
    }
    return { visit: null, progress: 0 };
  }

  private computeFrame(
    snapSmoothing: boolean,
    dtRealSec: number
  ): TelemetryFrame | null {
    if (!this.trip || this.trip.waypoints.length === 0) return null;

    const waypoints = this.trip.waypoints;
    const totalDuration = Math.max(1, this.trip.endTimeMs - this.trip.startTimeMs);
    const tMs = clamp(this.currentTimeMs, this.trip.startTimeMs, this.trip.endTimeMs);
    const progress = clamp((tMs - this.trip.startTimeMs) / totalDuration, 0, 1);

    let lo = 0;
    let hi = waypoints.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (waypoints[mid].timestampMs <= tMs) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    const idx0 = lo;
    const idx1 = Math.min(waypoints.length - 1, idx0 + 1);
    const w0 = waypoints[idx0];
    const w1 = waypoints[idx1];

    const spanMs = w1.timestampMs - w0.timestampMs;
    const localT = spanMs > 0 ? clamp((tMs - w0.timestampMs) / spanMs, 0, 1) : 0;

    const activeSegmentIndex = this.findSegmentIndex(tMs);
    const activeSegment: TripSegment | null =
      activeSegmentIndex >= 0 ? this.trip.segments[activeSegmentIndex] : null;
    const { visit: activeVisit, progress: activeVisitProgress } =
      this.findActiveVisit(tMs);

    const mode: TransportMode = activeVisit
      ? 'STILL'
      : activeSegment?.mode ?? w0.mode;

    let lat = lerp(w0.lat, w1.lat, localT);
    let lng = lerp(w0.lng, w1.lng, localT);
    let rawBearing =
      mode === 'STILL' ? w0.bearing : lerpAngle(w0.bearing, w1.bearing, localT);

    // Smooth Catmull-Rom spline interpolation for continuous movement spans
    const dLat = Math.abs(w1.lat - w0.lat);
    const dLng = Math.abs(w1.lng - w0.lng);
    if (
      mode !== 'STILL' &&
      w0.mode === w1.mode &&
      spanMs > 0 &&
      spanMs <= 5 * 60_000 &&
      dLat < 0.15 &&
      dLng < 0.15 &&
      (dLat > 1e-6 || dLng > 1e-6)
    ) {
      const wPrev =
        idx0 > 0 && waypoints[idx0 - 1].mode === w0.mode ? waypoints[idx0 - 1] : w0;
      const wNext =
        idx1 + 1 < waypoints.length && waypoints[idx1 + 1].mode === w1.mode
          ? waypoints[idx1 + 1]
          : w1;

      const sLat = catmullRom(wPrev.lat, w0.lat, w1.lat, wNext.lat, localT);
      const sLng = catmullRom(wPrev.lng, w0.lng, w1.lng, wNext.lng, localT);

      const padLat = Math.max(0.0001, dLat * 0.25);
      const padLng = Math.max(0.0001, dLng * 0.25);
      lat = clamp(
        sLat,
        Math.min(w0.lat, w1.lat) - padLat,
        Math.max(w0.lat, w1.lat) + padLat
      );
      lng = clamp(
        sLng,
        Math.min(w0.lng, w1.lng) - padLng,
        Math.max(w0.lng, w1.lng) + padLng
      );

      // Smooth tangent bearing along spline curve
      const eps = 0.03;
      const tA = Math.max(0, localT - eps);
      const tB = Math.min(1, localT + eps);
      if (tB > tA) {
        const latA = catmullRom(wPrev.lat, w0.lat, w1.lat, wNext.lat, tA);
        const lngA = catmullRom(wPrev.lng, w0.lng, w1.lng, wNext.lng, tA);
        const latB = catmullRom(wPrev.lat, w0.lat, w1.lat, wNext.lat, tB);
        const lngB = catmullRom(wPrev.lng, w0.lng, w1.lng, wNext.lng, tB);
        if (Math.abs(latB - latA) > 1e-7 || Math.abs(lngB - lngA) > 1e-7) {
          rawBearing = computeBearing(latA, lngA, latB, lngB);
        }
      }
    }

    const cumulativeDistanceM = lerp(
      w0.cumulativeDistanceM,
      w1.cumulativeDistanceM,
      localT
    );
    const rawSpeedKmh =
      mode === 'STILL' ? 0 : lerp(w0.speedKmh, w1.speedKmh, localT);

    if (snapSmoothing || !this.hasSmoothed || dtRealSec <= 0) {
      this.smoothedBearing = rawBearing;
      this.smoothedSpeedKmh = rawSpeedKmh;
      this.hasSmoothed = true;
    } else {
      const alphaBearing = 1 - Math.exp(-dtRealSec * 9);
      const alphaSpeed = 1 - Math.exp(-dtRealSec * 7);
      if (mode !== 'STILL') {
        this.smoothedBearing = lerpAngle(
          this.smoothedBearing,
          rawBearing,
          alphaBearing
        );
      }
      this.smoothedSpeedKmh = lerp(
        this.smoothedSpeedKmh,
        rawSpeedKmh,
        alphaSpeed
      );
    }

    return {
      tripId: this.trip.id,
      isPlaying: this.isPlaying,
      loop: this.loop,
      currentTimeMs: tMs,
      startTimeMs: this.trip.startTimeMs,
      endTimeMs: this.trip.endTimeMs,
      progress,
      lat,
      lng,
      bearing: this.smoothedBearing,
      speedKmh: mode === 'STILL' ? 0 : this.smoothedSpeedKmh,
      mode,
      cumulativeDistanceM,
      totalDistanceM: this.trip.distanceM,
      activeSegmentIndex,
      activeSegment,
      activeVisit,
      activeVisitProgress,
      traveledWaypointIndex: idx0,
      speedPreset: this.speedPreset,
      effectiveMultiplier: this.getEffectiveMultiplier(),
    };
  }
}
