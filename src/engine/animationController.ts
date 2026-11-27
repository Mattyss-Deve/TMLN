import type {
  PlaceVisit,
  PrebakedColorStop,
  PrebakedRoute,
  SpeedPreset,
  TelemetryFrame,
  TransportMode,
  Trip,
  TripSegment,
} from '../types/timeline';
import { clamp, computeBearing, lerp, lerpAngle, MODE_COLORS } from '../utils/geo';

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

// Throttle React HUD & scrubber updates to ~12fps (80ms) to keep WebGL 60fps smooth
const HUD_THROTTLE_MS = 80;

const MODE_LIST: TransportMode[] = [
  'WALKING',
  'DRIVING',
  'CYCLING',
  'TRANSIT',
  'FLYING',
  'STILL',
];

const MODE_TO_INDEX: Record<TransportMode, number> = {
  WALKING: 0,
  DRIVING: 1,
  CYCLING: 2,
  TRANSIT: 3,
  FLYING: 4,
  STILL: 5,
};

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

/**
 * Web Mercator projection helpers matching MapLibre's internal `line-progress`
 * geometric distance metric so shader gradient cutoff aligns to the exact pixel
 * under the moving location puck across all latitudes.
 */
function mercatorX(lng: number): number {
  return (lng + 180) / 360;
}

function mercatorY(lat: number): number {
  const clamped = clamp(lat, -85.051129, 85.051129);
  const sin = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

interface BakedTimeline {
  count: number;
  times: Float64Array;
  lats: Float64Array;
  lngs: Float64Array;
  bearings: Float64Array;
  speeds: Float64Array;
  cumDistM: Float64Array;
  lineProgress: Float64Array;
  modeIndices: Uint8Array;
  sourceWpIndices: Int32Array;
  route: PrebakedRoute;
}

/**
 * Pre-bakes a Trip into a flat, spline-smoothed Float64Array lookup table and
 * a single static GeoJSON LineString + strictly ascending color stops once on
 * trip load so requestAnimationFrame performs zero allocations or spline math.
 */
export function prebakeTripTimeline(trip: Trip): BakedTimeline {
  const waypoints = trip.waypoints;
  const n = waypoints.length;

  const timesList: number[] = [];
  const latsList: number[] = [];
  const lngsList: number[] = [];
  const bearingsList: number[] = [];
  const speedsList: number[] = [];
  const cumDistList: number[] = [];
  const modeList: number[] = [];
  const srcWpList: number[] = [];

  // Keep total baked vertices bounded (~2,500 max) for crisp mobile GPU rendering
  const maxSubstepsPerSpan = n > 1200 ? 1 : n > 400 ? 2 : 4;

  for (let i = 0; i < n; i++) {
    const w0 = waypoints[i];

    if (i === n - 1) {
      timesList.push(w0.timestampMs);
      latsList.push(w0.lat);
      lngsList.push(w0.lng);
      bearingsList.push(w0.bearing);
      speedsList.push(w0.speedKmh);
      cumDistList.push(w0.cumulativeDistanceM);
      modeList.push(MODE_TO_INDEX[w0.mode]);
      srcWpList.push(i);
      break;
    }

    const w1 = waypoints[i + 1];
    const spanMs = w1.timestampMs - w0.timestampMs;
    const dLat = Math.abs(w1.lat - w0.lat);
    const dLng = Math.abs(w1.lng - w0.lng);

    const canSpline =
      maxSubstepsPerSpan > 1 &&
      w0.mode !== 'STILL' &&
      w0.mode === w1.mode &&
      spanMs > 0 &&
      spanMs <= 5 * 60_000 &&
      dLat < 0.15 &&
      dLng < 0.15 &&
      (dLat > 1e-6 || dLng > 1e-6);

    const substeps = canSpline ? maxSubstepsPerSpan : 1;
    const wPrev =
      canSpline && i > 0 && waypoints[i - 1].mode === w0.mode ? waypoints[i - 1] : w0;
    const wNext =
      canSpline && i + 2 < n && waypoints[i + 2].mode === w1.mode ? waypoints[i + 2] : w1;

    const padLat = Math.max(0.0001, dLat * 0.25);
    const padLng = Math.max(0.0001, dLng * 0.25);
    const minLat = Math.min(w0.lat, w1.lat) - padLat;
    const maxLat = Math.max(w0.lat, w1.lat) + padLat;
    const minLng = Math.min(w0.lng, w1.lng) - padLng;
    const maxLng = Math.max(w0.lng, w1.lng) + padLng;

    for (let s = 0; s < substeps; s++) {
      const t = s / substeps;
      let lat: number;
      let lng: number;
      let bearing: number;

      if (canSpline && s > 0) {
        lat = clamp(catmullRom(wPrev.lat, w0.lat, w1.lat, wNext.lat, t), minLat, maxLat);
        lng = clamp(catmullRom(wPrev.lng, w0.lng, w1.lng, wNext.lng, t), minLng, maxLng);
        const tA = Math.max(0, t - 0.04);
        const tB = Math.min(1, t + 0.04);
        const latA = catmullRom(wPrev.lat, w0.lat, w1.lat, wNext.lat, tA);
        const lngA = catmullRom(wPrev.lng, w0.lng, w1.lng, wNext.lng, tA);
        const latB = catmullRom(wPrev.lat, w0.lat, w1.lat, wNext.lat, tB);
        const lngB = catmullRom(wPrev.lng, w0.lng, w1.lng, wNext.lng, tB);
        bearing =
          Math.abs(latB - latA) > 1e-7 || Math.abs(lngB - lngA) > 1e-7
            ? computeBearing(latA, lngA, latB, lngB)
            : lerpAngle(w0.bearing, w1.bearing, t);
      } else {
        lat = lerp(w0.lat, w1.lat, t);
        lng = lerp(w0.lng, w1.lng, t);
        bearing = w0.mode === 'STILL' ? w0.bearing : lerpAngle(w0.bearing, w1.bearing, t);
      }

      timesList.push(lerp(w0.timestampMs, w1.timestampMs, t));
      latsList.push(lat);
      lngsList.push(lng);
      bearingsList.push(bearing);
      speedsList.push(w0.mode === 'STILL' ? 0 : lerp(w0.speedKmh, w1.speedKmh, t));
      cumDistList.push(lerp(w0.cumulativeDistanceM, w1.cumulativeDistanceM, t));
      modeList.push(MODE_TO_INDEX[w0.mode]);
      srcWpList.push(i);
    }
  }

  const count = timesList.length;
  const times = new Float64Array(timesList);
  const lats = new Float64Array(latsList);
  const lngs = new Float64Array(lngsList);
  const bearings = new Float64Array(bearingsList);
  const speeds = new Float64Array(speedsList);
  const cumDistM = new Float64Array(cumDistList);
  const modeIndices = new Uint8Array(modeList);
  const sourceWpIndices = new Int32Array(srcWpList);

  // Build deduplicated static GeoJSON coordinates + Mercator line-progress table
  const lineProgress = new Float64Array(count);
  const mercCum = new Float64Array(count);
  const coords: [number, number][] = [];
  const coordModes: TransportMode[] = [];
  const coordMercDist: number[] = [];

  let totalMercLen = 0;
  let prevMx = count > 0 ? mercatorX(lngs[0]) : 0;
  let prevMy = count > 0 ? mercatorY(lats[0]) : 0;

  if (count > 0) {
    coords.push([lngs[0], lats[0]]);
    coordModes.push(MODE_LIST[modeIndices[0]]);
    coordMercDist.push(0);
  }

  for (let i = 1; i < count; i++) {
    const mx = mercatorX(lngs[i]);
    const my = mercatorY(lats[i]);
    const segLen = Math.hypot(mx - prevMx, my - prevMy);
    totalMercLen += segLen;
    mercCum[i] = totalMercLen;

    if (segLen > 1e-10) {
      coords.push([lngs[i], lats[i]]);
      coordModes.push(MODE_LIST[modeIndices[i]]);
      coordMercDist.push(totalMercLen);
      prevMx = mx;
      prevMy = my;
    }
  }

  if (totalMercLen > 0) {
    for (let i = 0; i < count; i++) {
      lineProgress[i] = mercCum[i] / totalMercLen;
    }
  }

  // Build strictly ascending color stops matching transport mode transitions
  const colorStops: PrebakedColorStop[] = [];
  if (coords.length >= 2 && totalMercLen > 0) {
    const firstColor = MODE_COLORS[coordModes[0]];
    colorStops.push({ progress: 0, color: firstColor });
    let prevColor = firstColor;
    let lastStopP = 0;

    for (let i = 1; i < coords.length; i++) {
      const modeColor = MODE_COLORS[coordModes[i]];
      if (modeColor !== prevColor) {
        const p = coordMercDist[i - 1] / totalMercLen;
        const holdP = Math.max(lastStopP + 0.00002, p);
        const stepP = Math.min(1, holdP + 0.00005);
        if (holdP < 0.9999) {
          colorStops.push({ progress: holdP, color: prevColor });
          colorStops.push({ progress: stepP, color: modeColor });
          lastStopP = stepP;
          prevColor = modeColor;
        }
      }
    }

    if (lastStopP < 1) {
      colorStops.push({ progress: 1, color: prevColor });
    }
  }

  const hasGeometry = coords.length >= 2 && totalMercLen > 0;
  const geojson: GeoJSON.FeatureCollection = hasGeometry
    ? {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: coords,
            },
          },
        ],
      }
    : { type: 'FeatureCollection', features: [] };

  return {
    count,
    times,
    lats,
    lngs,
    bearings,
    speeds,
    cumDistM,
    lineProgress,
    modeIndices,
    sourceWpIndices,
    route: {
      tripId: trip.id,
      geojson,
      colorStops,
      pointCount: coords.length,
      hasGeometry,
    },
  };
}

export class AnimationController {
  private trip: Trip | null = null;
  private baked: BakedTimeline | null = null;
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

  public loadTrip(trip: Trip | null, autoPlay = false): PrebakedRoute | null {
    this.stopRaf();
    this.trip = trip;
    this.baked = trip ? prebakeTripTimeline(trip) : null;
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

    return this.baked?.route ?? null;
  }

  public getPrebakedRoute(): PrebakedRoute | null {
    return this.baked?.route ?? null;
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
    this.baked = null;
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
          reachedEnd || nowMs - this.lastHudEmitTimeMs >= HUD_THROTTLE_MS;
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
    if (!this.trip || !this.baked || this.baked.count === 0) return null;

    const b = this.baked;
    const totalDuration = Math.max(1, this.trip.endTimeMs - this.trip.startTimeMs);
    const tMs = clamp(this.currentTimeMs, this.trip.startTimeMs, this.trip.endTimeMs);
    const progress = clamp((tMs - this.trip.startTimeMs) / totalDuration, 0, 1);

    // O(log N) binary search over pre-baked Float64Array timestamps (zero allocations)
    let lo = 0;
    let hi = b.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (b.times[mid] <= tMs) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    const i0 = lo;
    const i1 = i0 + 1 < b.count ? i0 + 1 : i0;
    const spanMs = b.times[i1] - b.times[i0];
    const localT = spanMs > 0 ? clamp((tMs - b.times[i0]) / spanMs, 0, 1) : 0;

    const lat = lerp(b.lats[i0], b.lats[i1], localT);
    const lng = lerp(b.lngs[i0], b.lngs[i1], localT);
    const cumulativeDistanceM = lerp(b.cumDistM[i0], b.cumDistM[i1], localT);
    const lineProgress = clamp(
      lerp(b.lineProgress[i0], b.lineProgress[i1], localT),
      0,
      1
    );

    const activeSegmentIndex = this.findSegmentIndex(tMs);
    const activeSegment: TripSegment | null =
      activeSegmentIndex >= 0 ? this.trip.segments[activeSegmentIndex] : null;
    const { visit: activeVisit, progress: activeVisitProgress } =
      this.findActiveVisit(tMs);

    const mode: TransportMode = activeVisit
      ? 'STILL'
      : activeSegment?.mode ?? MODE_LIST[b.modeIndices[i0]];

    const rawBearing =
      mode === 'STILL'
        ? b.bearings[i0]
        : lerpAngle(b.bearings[i0], b.bearings[i1], localT);
    const rawSpeedKmh =
      mode === 'STILL' ? 0 : lerp(b.speeds[i0], b.speeds[i1], localT);

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
      lineProgress,
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
      traveledWaypointIndex: b.sourceWpIndices[i0],
      speedPreset: this.speedPreset,
      effectiveMultiplier: this.getEffectiveMultiplier(),
    };
  }
}
