import type {
  DayGroup,
  ParsedTimelineResult,
  PlaceVisit,
  TimelineSchemaFormat,
  TransportMode,
  Trip,
  TripSegment,
  Waypoint,
} from '../types/timeline';
import { formatDate, formatDateKey } from '../utils/format';
import {
  computeBearing,
  computeBounds,
  haversineMeters,
  isValidCoordinate,
  lerp,
} from '../utils/geo';

export class TimelineParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimelineParseError';
  }
}

export type ProgressCallback = (percent: number, stage: string) => void;

const MAX_GROUND_SPEED_KMH = 1200;
const TRIP_GAP_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
const DAY_CROSS_GAP_MS = 15 * 60 * 1000; // 15 minutes
const RAW_DWELL_MIN_MS = 3 * 60 * 1000; // 3 minutes
const RAW_DWELL_RADIUS_M = 60;
const RAW_GAP_SPLIT_MS = 20 * 60 * 1000; // 20 minutes

interface RawPoint {
  lat: number;
  lng: number;
  timestampMs: number;
  mode?: TransportMode;
  speedKmh?: number;
}

interface RawSegmentDraft {
  kind: 'ACTIVITY' | 'VISIT';
  mode: TransportMode;
  startTimeMs: number;
  endTimeMs: number;
  points: RawPoint[];
  visit?: {
    name: string;
    address?: string;
    semanticType?: string;
    lat: number;
    lng: number;
  };
  explicitDistanceM?: number;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    }
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Parse Google geo coordinates from strings like:
 * - "geo:37.7955,-122.3937"
 * - "37.7955°, -122.3937°"
 * - "37.7955, -122.3937"
 */
export function parseGeoString(value: unknown): { lat: number; lng: number } | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .trim()
    .replace(/^geo:/i, '')
    .replace(/°/g, '');
  const parts = cleaned.split(',');
  if (parts.length < 2) return null;
  const lat = Number.parseFloat(parts[0].trim());
  const lng = Number.parseFloat(parts[1].trim());
  if (!isValidCoordinate(lat, lng)) return null;
  return { lat, lng };
}

function parseLatLngObject(obj: unknown): { lat: number; lng: number } | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;

  if (typeof rec.latLng === 'string') {
    return parseGeoString(rec.latLng);
  }
  if (typeof rec.point === 'string') {
    return parseGeoString(rec.point);
  }

  const latE7 = rec.latitudeE7 ?? rec.latE7;
  const lngE7 = rec.longitudeE7 ?? rec.lngE7;
  if (typeof latE7 === 'number' && typeof lngE7 === 'number') {
    const lat = latE7 / 1e7;
    const lng = lngE7 / 1e7;
    return isValidCoordinate(lat, lng) ? { lat, lng } : null;
  }

  const lat = rec.latitude ?? rec.lat;
  const lng = rec.longitude ?? rec.lng;
  if (typeof lat === 'number' && typeof lng === 'number') {
    return isValidCoordinate(lat, lng) ? { lat, lng } : null;
  }

  return null;
}

export function normalizeTransportMode(rawType: unknown): TransportMode | null {
  if (typeof rawType !== 'string') return null;
  const upper = rawType.trim().toUpperCase();
  if (!upper) return null;

  if (
    upper.includes('WALK') ||
    upper.includes('FOOT') ||
    upper.includes('RUN') ||
    upper.includes('HIK')
  ) {
    return 'WALKING';
  }
  if (
    upper.includes('CYCL') ||
    upper.includes('BICYCL') ||
    upper.includes('BIKE')
  ) {
    return 'CYCLING';
  }
  if (
    upper.includes('FLY') ||
    upper.includes('FLIGHT') ||
    upper.includes('AIRPLANE') ||
    upper.includes('PLANE')
  ) {
    return 'FLYING';
  }
  if (
    upper.includes('TRANSIT') ||
    upper.includes('SUBWAY') ||
    upper.includes('TRAIN') ||
    upper.includes('RAIL') ||
    upper.includes('BUS') ||
    upper.includes('TRAM') ||
    upper.includes('FERRY') ||
    upper.includes('CABLE_CAR') ||
    upper.includes('GONDOLA') ||
    upper.includes('METRO')
  ) {
    return 'TRANSIT';
  }
  if (
    upper.includes('DRIV') ||
    upper.includes('VEHICLE') ||
    upper.includes('CAR') ||
    upper.includes('MOTORCYCL') ||
    upper.includes('TAXI') ||
    upper.includes('RIDESHAR') ||
    upper.includes('AUTO')
  ) {
    return 'DRIVING';
  }
  if (upper.includes('STILL') || upper.includes('STATIONARY')) {
    return 'STILL';
  }

  return null;
}

function inferModeFromSpeed(speedKmh: number): TransportMode {
  if (!Number.isFinite(speedKmh) || speedKmh < 1.2) return 'STILL';
  if (speedKmh < 7.5) return 'WALKING';
  if (speedKmh < 26) return 'CYCLING';
  if (speedKmh < 240) return 'DRIVING';
  return 'FLYING';
}

function formatSemanticType(raw?: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'Visited Place';
  const cleaned = raw
    .replace(/^INFERRED_/, '')
    .replace(/_/g, ' ')
    .toLowerCase();
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Filter impossible teleportation GPS spikes (> 1200 km/h unless FLYING).
 */
function filterGpsSpikes(
  points: RawPoint[],
  defaultMode?: TransportMode
): { cleaned: RawPoint[]; filteredSpikes: number } {
  if (points.length <= 1) {
    return { cleaned: [...points], filteredSpikes: 0 };
  }

  const cleaned: RawPoint[] = [points[0]];
  let filteredSpikes = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    const curr = points[i];
    const dtMs = curr.timestampMs - prev.timestampMs;

    if (dtMs < 0) {
      continue;
    }

    const distM = haversineMeters(prev.lat, prev.lng, curr.lat, curr.lng);
    if (dtMs === 0 && distM < 5) {
      continue;
    }

    const effectiveMode = curr.mode ?? prev.mode ?? defaultMode ?? 'DRIVING';
    const dtHours = Math.max(dtMs, 500) / 3_600_000;
    const speedKmh = (distM / 1000) / dtHours;

    if (effectiveMode !== 'FLYING' && speedKmh > MAX_GROUND_SPEED_KMH) {
      // Check if previous accepted point was actually the single outlier when at index 1
      if (cleaned.length === 1 && i + 1 < points.length) {
        const next = points[i + 1];
        const nextDtHours = Math.max(next.timestampMs - curr.timestampMs, 500) / 3_600_000;
        const nextSpeed = (haversineMeters(curr.lat, curr.lng, next.lat, next.lng) / 1000) / nextDtHours;
        const prevToNextDtHours = Math.max(next.timestampMs - prev.timestampMs, 500) / 3_600_000;
        const prevToNextSpeed = (haversineMeters(prev.lat, prev.lng, next.lat, next.lng) / 1000) / prevToNextDtHours;
        if (nextSpeed <= MAX_GROUND_SPEED_KMH && prevToNextSpeed > MAX_GROUND_SPEED_KMH) {
          cleaned[0] = curr;
          filteredSpikes++;
          continue;
        }
      }
      filteredSpikes++;
      continue;
    }

    // Even for FLYING, discard instantaneous micro-glitches (> 2000 km/h over < 2s)
    if (effectiveMode === 'FLYING' && dtMs < 2000 && distM > 1200) {
      filteredSpikes++;
      continue;
    }

    cleaned.push(curr);
  }

  return { cleaned, filteredSpikes };
}

function synthesizePointsBetween(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  startTimeMs: number,
  endTimeMs: number,
  mode: TransportMode
): RawPoint[] {
  const durationMs = Math.max(1000, endTimeMs - startTimeMs);
  const distM = haversineMeters(start.lat, start.lng, end.lat, end.lng);
  const steps = Math.min(24, Math.max(2, Math.ceil(Math.max(durationMs / 45_000, distM / 800))));
  const pts: RawPoint[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({
      lat: lerp(start.lat, end.lat, t),
      lng: lerp(start.lng, end.lng, t),
      timestampMs: Math.round(lerp(startTimeMs, endTimeMs, t)),
      mode,
    });
  }
  return pts;
}

function binarySearchLower(points: RawPoint[], targetTimeMs: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].timestampMs < targetTimeMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Schema 1: New On-Device Timeline.json (`semanticSegments`)
 */
function parseOnDeviceTimeline(
  semanticSegments: unknown[],
  onProgress?: ProgressCallback
): { drafts: RawSegmentDraft[]; filteredSpikes: number; inputCount: number } {
  const pathPoints: RawPoint[] = [];
  const drafts: RawSegmentDraft[] = [];
  let filteredSpikes = 0;

  onProgress?.(12, 'Extracting semantic segments & paths...');

  interface PendingActivity {
    startTimeMs: number;
    endTimeMs: number;
    mode: TransportMode;
    startCoord: { lat: number; lng: number } | null;
    endCoord: { lat: number; lng: number } | null;
    distanceMeters?: number;
    localPoints: RawPoint[];
  }

  const pendingActivities: PendingActivity[] = [];

  for (let i = 0; i < semanticSegments.length; i++) {
    if (i % 5000 === 0 && semanticSegments.length > 5000) {
      onProgress?.(12 + Math.round((i / semanticSegments.length) * 38), 'Reading timeline segments...');
    }

    const seg = semanticSegments[i];
    if (!seg || typeof seg !== 'object') continue;
    const rec = seg as Record<string, unknown>;

    const segStart = parseTimestampMs(rec.startTime);
    const segEnd = parseTimestampMs(rec.endTime);

    const localPath: RawPoint[] = [];
    if (Array.isArray(rec.timelinePath)) {
      for (const item of rec.timelinePath) {
        if (!item || typeof item !== 'object') continue;
        const pRec = item as Record<string, unknown>;
        const coord = parseGeoString(pRec.point) ?? parseLatLngObject(pRec);
        const ts = parseTimestampMs(pRec.time ?? pRec.timestamp);
        if (coord && ts !== null) {
          const pt: RawPoint = { lat: coord.lat, lng: coord.lng, timestampMs: ts };
          localPath.push(pt);
          pathPoints.push(pt);
        }
      }
    }

    if (rec.visit && typeof rec.visit === 'object') {
      const visitObj = rec.visit as Record<string, unknown>;
      const top =
        visitObj.topCandidate && typeof visitObj.topCandidate === 'object'
          ? (visitObj.topCandidate as Record<string, unknown>)
          : visitObj;
      const coord =
        parseLatLngObject(top.placeLocation) ??
        parseGeoString(top.placeLocation) ??
        parseLatLngObject(visitObj.placeLocation);

      if (coord && segStart !== null) {
        const endMs = segEnd !== null && segEnd >= segStart ? segEnd : segStart + 60_000;
        const name =
          (typeof top.placeName === 'string' && top.placeName.trim()) ||
          (typeof top.name === 'string' && top.name.trim()) ||
          (typeof visitObj.placeName === 'string' && visitObj.placeName.trim()) ||
          formatSemanticType(top.semanticType);
        const address = typeof top.address === 'string' ? top.address : undefined;
        const semanticType =
          typeof top.semanticType === 'string' ? top.semanticType : undefined;

        drafts.push({
          kind: 'VISIT',
          mode: 'STILL',
          startTimeMs: segStart,
          endTimeMs: endMs,
          points: [
            { lat: coord.lat, lng: coord.lng, timestampMs: segStart, mode: 'STILL' },
            { lat: coord.lat, lng: coord.lng, timestampMs: endMs, mode: 'STILL' },
          ],
          visit: {
            name,
            address,
            semanticType,
            lat: coord.lat,
            lng: coord.lng,
          },
        });
      }
    }

    if (rec.activity && typeof rec.activity === 'object') {
      const act = rec.activity as Record<string, unknown>;
      const top =
        act.topCandidate && typeof act.topCandidate === 'object'
          ? (act.topCandidate as Record<string, unknown>)
          : act;
      const startCoord = parseLatLngObject(act.start) ?? parseGeoString(act.start);
      const endCoord = parseLatLngObject(act.end) ?? parseGeoString(act.end);
      const startMs = segStart;
      const endMs = segEnd ?? (startMs !== null ? startMs + 60_000 : null);

      if (startMs !== null && endMs !== null && endMs >= startMs) {
        const distanceMeters =
          typeof act.distanceMeters === 'number' && Number.isFinite(act.distanceMeters)
            ? act.distanceMeters
            : startCoord && endCoord
              ? haversineMeters(startCoord.lat, startCoord.lng, endCoord.lat, endCoord.lng)
              : 0;
        const durationHours = Math.max(endMs - startMs, 1000) / 3_600_000;
        const avgSpeed = (distanceMeters / 1000) / durationHours;
        const mode = normalizeTransportMode(top.type ?? act.type) ?? inferModeFromSpeed(avgSpeed);

        pendingActivities.push({
          startTimeMs: startMs,
          endTimeMs: endMs,
          mode,
          startCoord,
          endCoord,
          distanceMeters:
            typeof act.distanceMeters === 'number' ? act.distanceMeters : undefined,
          localPoints: localPath,
        });
      }
    }
  }

  onProgress?.(55, 'Correlating GPS paths with activities...');

  pathPoints.sort((a, b) => a.timestampMs - b.timestampMs);
  const usedPathMask = new Uint8Array(pathPoints.length);

  for (const act of pendingActivities) {
    let pts: RawPoint[] = [];

    if (act.localPoints.length > 0) {
      pts = act.localPoints.map((p) => ({ ...p, mode: act.mode }));
    } else if (pathPoints.length > 0) {
      const startIdx = binarySearchLower(pathPoints, act.startTimeMs - 1000);
      for (let idx = startIdx; idx < pathPoints.length; idx++) {
        const p = pathPoints[idx];
        if (p.timestampMs > act.endTimeMs + 1000) break;
        usedPathMask[idx] = 1;
        pts.push({ ...p, mode: act.mode });
      }
    }

    if (act.startCoord) {
      if (
        pts.length === 0 ||
        pts[0].timestampMs - act.startTimeMs > 15_000 ||
        haversineMeters(pts[0].lat, pts[0].lng, act.startCoord.lat, act.startCoord.lng) > 80
      ) {
        pts.unshift({
          lat: act.startCoord.lat,
          lng: act.startCoord.lng,
          timestampMs: act.startTimeMs,
          mode: act.mode,
        });
      }
    }

    if (act.endCoord) {
      const last = pts[pts.length - 1];
      if (
        !last ||
        act.endTimeMs - last.timestampMs > 15_000 ||
        haversineMeters(last.lat, last.lng, act.endCoord.lat, act.endCoord.lng) > 80
      ) {
        pts.push({
          lat: act.endCoord.lat,
          lng: act.endCoord.lng,
          timestampMs: act.endTimeMs,
          mode: act.mode,
        });
      }
    }

    if (pts.length === 2 && act.startCoord && act.endCoord) {
      pts = synthesizePointsBetween(
        act.startCoord,
        act.endCoord,
        act.startTimeMs,
        act.endTimeMs,
        act.mode
      );
    }

    if (pts.length > 0) {
      const spikeRes = filterGpsSpikes(pts, act.mode);
      filteredSpikes += spikeRes.filteredSpikes;
      if (spikeRes.cleaned.length > 0) {
        drafts.push({
          kind: 'ACTIVITY',
          mode: act.mode,
          startTimeMs: act.startTimeMs,
          endTimeMs: act.endTimeMs,
          points: spikeRes.cleaned,
          explicitDistanceM: act.distanceMeters,
        });
      }
    }
  }

  // Handle standalone timelinePath points not claimed by any activity or visit
  if (pathPoints.length > 0 && pendingActivities.length === 0 && drafts.length === 0) {
    const rawRes = segmentRawLocationPoints(pathPoints, onProgress);
    drafts.push(...rawRes.drafts);
    filteredSpikes += rawRes.filteredSpikes;
  } else if (pathPoints.length > 0) {
    // Check if there are substantial unclaimed moving segments
    const unclaimed: RawPoint[] = [];
    for (let i = 0; i < pathPoints.length; i++) {
      if (usedPathMask[i]) continue;
      const p = pathPoints[i];
      const insideDraft = drafts.some(
        (d) => p.timestampMs >= d.startTimeMs - 1000 && p.timestampMs <= d.endTimeMs + 1000
      );
      if (!insideDraft) {
        unclaimed.push(p);
      }
    }
    if (unclaimed.length >= 2) {
      const extraRes = segmentRawLocationPoints(unclaimed);
      drafts.push(...extraRes.drafts);
      filteredSpikes += extraRes.filteredSpikes;
    }
  }

  return {
    drafts,
    filteredSpikes,
    inputCount: semanticSegments.length,
  };
}

/**
 * Schema 2: Classic Semantic Location History (`timelineObjects`)
 */
function parseSemanticHistory(
  timelineObjects: unknown[],
  onProgress?: ProgressCallback
): { drafts: RawSegmentDraft[]; filteredSpikes: number; inputCount: number } {
  const drafts: RawSegmentDraft[] = [];
  let filteredSpikes = 0;

  onProgress?.(15, 'Parsing Semantic Location History objects...');

  for (let i = 0; i < timelineObjects.length; i++) {
    if (i % 2500 === 0 && timelineObjects.length > 2500) {
      onProgress?.(
        15 + Math.round((i / timelineObjects.length) * 55),
        'Normalizing classic timeline objects...'
      );
    }

    const item = timelineObjects[i];
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    if (rec.placeVisit && typeof rec.placeVisit === 'object') {
      const pv = rec.placeVisit as Record<string, unknown>;
      const loc = (pv.location && typeof pv.location === 'object'
        ? pv.location
        : {}) as Record<string, unknown>;
      const dur = (pv.duration && typeof pv.duration === 'object'
        ? pv.duration
        : {}) as Record<string, unknown>;

      const coord = parseLatLngObject(loc);
      const startMs = parseTimestampMs(dur.startTimestamp ?? dur.startTimestampMs);
      const endMs =
        parseTimestampMs(dur.endTimestamp ?? dur.endTimestampMs) ??
        (startMs !== null ? startMs + 60_000 : null);

      if (coord && startMs !== null && endMs !== null && endMs >= startMs) {
        const name =
          (typeof loc.name === 'string' && loc.name.trim()) ||
          formatSemanticType(loc.semanticType ?? pv.placeConfidence);
        const address = typeof loc.address === 'string' ? loc.address : undefined;
        const semanticType =
          typeof loc.semanticType === 'string' ? loc.semanticType : undefined;

        drafts.push({
          kind: 'VISIT',
          mode: 'STILL',
          startTimeMs: startMs,
          endTimeMs: endMs,
          points: [
            { lat: coord.lat, lng: coord.lng, timestampMs: startMs, mode: 'STILL' },
            { lat: coord.lat, lng: coord.lng, timestampMs: endMs, mode: 'STILL' },
          ],
          visit: {
            name,
            address,
            semanticType,
            lat: coord.lat,
            lng: coord.lng,
          },
        });
      }
    }

    if (rec.activitySegment && typeof rec.activitySegment === 'object') {
      const seg = rec.activitySegment as Record<string, unknown>;
      const dur = (seg.duration && typeof seg.duration === 'object'
        ? seg.duration
        : {}) as Record<string, unknown>;
      const startMs = parseTimestampMs(dur.startTimestamp ?? dur.startTimestampMs);
      const endMs =
        parseTimestampMs(dur.endTimestamp ?? dur.endTimestampMs) ??
        (startMs !== null ? startMs + 60_000 : null);

      if (startMs === null || endMs === null || endMs < startMs) continue;

      const startCoord = parseLatLngObject(seg.startLocation);
      const endCoord = parseLatLngObject(seg.endLocation);

      const explicitDist =
        typeof seg.distance === 'number' && Number.isFinite(seg.distance)
          ? seg.distance
          : startCoord && endCoord
            ? haversineMeters(startCoord.lat, startCoord.lng, endCoord.lat, endCoord.lng)
            : 0;
      const durationHours = Math.max(endMs - startMs, 1000) / 3_600_000;
      const avgSpeed = (explicitDist / 1000) / durationHours;
      const mode = normalizeTransportMode(seg.activityType) ?? inferModeFromSpeed(avgSpeed);

      let pts: RawPoint[] = [];

      // 1. Prefer simplifiedRawPath.points (includes timestamps)
      const simplified = seg.simplifiedRawPath as Record<string, unknown> | undefined;
      if (simplified && Array.isArray(simplified.points)) {
        for (const p of simplified.points) {
          const coord = parseLatLngObject(p);
          const pRec = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
          const ts = parseTimestampMs(pRec.timestamp ?? pRec.timestampMs);
          if (coord && ts !== null) {
            pts.push({ lat: coord.lat, lng: coord.lng, timestampMs: ts, mode });
          }
        }
      }

      // 2. Fallback to waypointPath.waypoints or transitPath.transitStops (distribute timestamps by distance)
      if (pts.length === 0) {
        const coords: { lat: number; lng: number }[] = [];
        if (startCoord) coords.push(startCoord);

        const wpPath = seg.waypointPath as Record<string, unknown> | undefined;
        if (wpPath && Array.isArray(wpPath.waypoints)) {
          for (const wp of wpPath.waypoints) {
            const c = parseLatLngObject(wp);
            if (c) coords.push(c);
          }
        } else {
          const transitPath = seg.transitPath as Record<string, unknown> | undefined;
          if (transitPath && Array.isArray(transitPath.transitStops)) {
            for (const stop of transitPath.transitStops) {
              const c = parseLatLngObject(stop);
              if (c) coords.push(c);
            }
          }
        }

        if (endCoord) coords.push(endCoord);

        if (coords.length >= 2) {
          const cumDist: number[] = [0];
          for (let j = 1; j < coords.length; j++) {
            cumDist.push(
              cumDist[j - 1] +
                haversineMeters(
                  coords[j - 1].lat,
                  coords[j - 1].lng,
                  coords[j].lat,
                  coords[j].lng
                )
            );
          }
          const totalDist = cumDist[cumDist.length - 1];
          pts = coords.map((c, j) => {
            const ratio = totalDist > 0 ? cumDist[j] / totalDist : j / (coords.length - 1);
            return {
              lat: c.lat,
              lng: c.lng,
              timestampMs: Math.round(lerp(startMs, endMs, ratio)),
              mode,
            };
          });
        }
      }

      // Ensure start and end anchors
      if (startCoord && pts.length > 0) {
        if (
          pts[0].timestampMs - startMs > 10_000 ||
          haversineMeters(pts[0].lat, pts[0].lng, startCoord.lat, startCoord.lng) > 80
        ) {
          pts.unshift({
            lat: startCoord.lat,
            lng: startCoord.lng,
            timestampMs: startMs,
            mode,
          });
        }
      }
      if (endCoord && pts.length > 0) {
        const last = pts[pts.length - 1];
        if (
          endMs - last.timestampMs > 10_000 ||
          haversineMeters(last.lat, last.lng, endCoord.lat, endCoord.lng) > 80
        ) {
          pts.push({
            lat: endCoord.lat,
            lng: endCoord.lng,
            timestampMs: endMs,
            mode,
          });
        }
      }

      if (pts.length === 2 && startCoord && endCoord) {
        pts = synthesizePointsBetween(startCoord, endCoord, startMs, endMs, mode);
      }

      if (pts.length > 0) {
        const spikeRes = filterGpsSpikes(pts, mode);
        filteredSpikes += spikeRes.filteredSpikes;
        if (spikeRes.cleaned.length > 0) {
          drafts.push({
            kind: 'ACTIVITY',
            mode,
            startTimeMs: startMs,
            endTimeMs: endMs,
            points: spikeRes.cleaned,
            explicitDistanceM: typeof seg.distance === 'number' ? seg.distance : undefined,
          });
        }
      }
    }
  }

  return {
    drafts,
    filteredSpikes,
    inputCount: timelineObjects.length,
  };
}

function extractRawLocationMode(rec: Record<string, unknown>): TransportMode | undefined {
  if (!Array.isArray(rec.activity) || rec.activity.length === 0) return undefined;
  const firstGroup = rec.activity[0];
  if (!firstGroup || typeof firstGroup !== 'object') return undefined;
  const inner = (firstGroup as Record<string, unknown>).activity;
  if (!Array.isArray(inner) || inner.length === 0) return undefined;

  let bestType: string | undefined;
  let bestConf = -1;
  for (const cand of inner) {
    if (!cand || typeof cand !== 'object') continue;
    const cRec = cand as Record<string, unknown>;
    const conf = typeof cRec.confidence === 'number' ? cRec.confidence : 0;
    const type = typeof cRec.type === 'string' ? cRec.type : undefined;
    if (type && conf >= bestConf) {
      const normalized = normalizeTransportMode(type);
      if (normalized) {
        bestConf = conf;
        bestType = type;
      }
    }
  }
  return bestType ? normalizeTransportMode(bestType) ?? undefined : undefined;
}

/**
 * Segment chronological raw GPS points into stationary visits and moving legs.
 */
function segmentRawLocationPoints(
  rawPoints: RawPoint[],
  onProgress?: ProgressCallback
): { drafts: RawSegmentDraft[]; filteredSpikes: number } {
  if (rawPoints.length === 0) {
    return { drafts: [], filteredSpikes: 0 };
  }

  const sorted = [...rawPoints].sort((a, b) => a.timestampMs - b.timestampMs);
  const { cleaned, filteredSpikes } = filterGpsSpikes(sorted);

  if (cleaned.length === 0) {
    return { drafts: [], filteredSpikes };
  }

  onProgress?.(60, 'Detecting stays and movement segments...');

  // First compute instantaneous mode for each point
  const enriched: (RawPoint & { resolvedMode: TransportMode })[] = cleaned.map((pt, idx) => {
    let speedKmh = pt.speedKmh;
    if (speedKmh === undefined) {
      if (idx > 0) {
        const prev = cleaned[idx - 1];
        const dtH = Math.max(pt.timestampMs - prev.timestampMs, 1000) / 3_600_000;
        const distM = haversineMeters(prev.lat, prev.lng, pt.lat, pt.lng);
        speedKmh = (distM / 1000) / dtH;
      } else {
        speedKmh = 0;
      }
    }
    const mode = pt.mode ?? inferModeFromSpeed(speedKmh);
    return { ...pt, speedKmh, resolvedMode: mode };
  });

  // Identify stationary clusters vs moving runs
  const drafts: RawSegmentDraft[] = [];
  let i = 0;
  let stopCounter = 1;

  while (i < enriched.length) {
    // Try to form a stationary dwell starting at i
    let j = i + 1;
    let sumLat = enriched[i].lat;
    let sumLng = enriched[i].lng;
    let count = 1;

    while (j < enriched.length) {
      const gap = enriched[j].timestampMs - enriched[j - 1].timestampMs;
      if (gap > RAW_GAP_SPLIT_MS) break;
      const centerLat = sumLat / count;
      const centerLng = sumLng / count;
      const distFromAnchor = haversineMeters(
        centerLat,
        centerLng,
        enriched[j].lat,
        enriched[j].lng
      );
      if (distFromAnchor > RAW_DWELL_RADIUS_M) break;
      sumLat += enriched[j].lat;
      sumLng += enriched[j].lng;
      count++;
      j++;
    }

    const dwellDuration = enriched[j - 1].timestampMs - enriched[i].timestampMs;
    if (count >= 2 && dwellDuration >= RAW_DWELL_MIN_MS) {
      const centerLat = sumLat / count;
      const centerLng = sumLng / count;
      const startMs = enriched[i].timestampMs;
      const endMs = enriched[j - 1].timestampMs;
      drafts.push({
        kind: 'VISIT',
        mode: 'STILL',
        startTimeMs: startMs,
        endTimeMs: endMs,
        points: [
          { lat: centerLat, lng: centerLng, timestampMs: startMs, mode: 'STILL' },
          { lat: centerLat, lng: centerLng, timestampMs: endMs, mode: 'STILL' },
        ],
        visit: {
          name: `Stop #${stopCounter++}`,
          semanticType: 'Stationary Dwell',
          lat: centerLat,
          lng: centerLng,
        },
      });
      i = j;
      continue;
    }

    // Collect a contiguous moving leg of same mode (or until gap / stationary cluster)
    const legStart = i;
    let legEnd = i + 1;
    const legMode =
      enriched[legStart].resolvedMode === 'STILL'
        ? 'WALKING'
        : enriched[legStart].resolvedMode;

    while (legEnd < enriched.length) {
      const gap = enriched[legEnd].timestampMs - enriched[legEnd - 1].timestampMs;
      if (gap > RAW_GAP_SPLIT_MS) break;

      // Look ahead to see if a stationary dwell begins here
      let dwellEnd = legEnd + 1;
      while (
        dwellEnd < enriched.length &&
        enriched[dwellEnd].timestampMs - enriched[dwellEnd - 1].timestampMs <= RAW_GAP_SPLIT_MS &&
        haversineMeters(
          enriched[legEnd].lat,
          enriched[legEnd].lng,
          enriched[dwellEnd].lat,
          enriched[dwellEnd].lng
        ) <= RAW_DWELL_RADIUS_M
      ) {
        dwellEnd++;
      }
      if (
        dwellEnd - legEnd >= 2 &&
        enriched[dwellEnd - 1].timestampMs - enriched[legEnd].timestampMs >= RAW_DWELL_MIN_MS
      ) {
        break;
      }

      const nextMode = enriched[legEnd].resolvedMode;
      if (nextMode !== 'STILL' && nextMode !== legMode) {
        // Require at least 2 consecutive points of new mode to switch (prevents 1-point flicker)
        if (
          legEnd + 1 < enriched.length &&
          enriched[legEnd + 1].resolvedMode === nextMode
        ) {
          break;
        }
      }

      legEnd++;
    }

    const slice = enriched.slice(legStart, Math.max(legStart + 1, legEnd));
    if (slice.length >= 2) {
      drafts.push({
        kind: 'ACTIVITY',
        mode: legMode,
        startTimeMs: slice[0].timestampMs,
        endTimeMs: slice[slice.length - 1].timestampMs,
        points: slice.map((p) => ({
          lat: p.lat,
          lng: p.lng,
          timestampMs: p.timestampMs,
          mode: legMode,
          speedKmh: p.speedKmh,
        })),
      });
    } else if (slice.length === 1 && drafts.length === 0 && enriched.length === 1) {
      drafts.push({
        kind: 'VISIT',
        mode: 'STILL',
        startTimeMs: slice[0].timestampMs,
        endTimeMs: slice[0].timestampMs + 60_000,
        points: [
          { lat: slice[0].lat, lng: slice[0].lng, timestampMs: slice[0].timestampMs, mode: 'STILL' },
          {
            lat: slice[0].lat,
            lng: slice[0].lng,
            timestampMs: slice[0].timestampMs + 60_000,
            mode: 'STILL',
          },
        ],
        visit: {
          name: `Stop #${stopCounter++}`,
          lat: slice[0].lat,
          lng: slice[0].lng,
        },
      });
    }

    i = Math.max(legStart + 1, legEnd);
  }

  return { drafts, filteredSpikes };
}

/**
 * Schema 3: Raw Records.json (`locations`)
 */
function parseRawRecords(
  locations: unknown[],
  onProgress?: ProgressCallback
): { drafts: RawSegmentDraft[]; filteredSpikes: number; inputCount: number } {
  const rawPoints: RawPoint[] = [];

  onProgress?.(10, `Scanning ${locations.length.toLocaleString()} raw location records...`);

  for (let i = 0; i < locations.length; i++) {
    if (i % 15000 === 0 && locations.length > 15000) {
      onProgress?.(
        10 + Math.round((i / locations.length) * 45),
        `Normalizing coordinates (${i.toLocaleString()} / ${locations.length.toLocaleString()})...`
      );
    }

    const item = locations[i];
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    const coord = parseLatLngObject(rec);
    const ts = parseTimestampMs(rec.timestamp ?? rec.timestampMs);
    if (!coord || ts === null) continue;

    const mode = extractRawLocationMode(rec);
    const speedKmh =
      typeof rec.velocity === 'number' && Number.isFinite(rec.velocity) && rec.velocity >= 0
        ? rec.velocity * 3.6
        : undefined;

    rawPoints.push({
      lat: coord.lat,
      lng: coord.lng,
      timestampMs: ts,
      mode,
      speedKmh,
    });
  }

  const { drafts, filteredSpikes } = segmentRawLocationPoints(rawPoints, onProgress);

  return {
    drafts,
    filteredSpikes,
    inputCount: locations.length,
  };
}

function deriveTripTitle(
  visits: PlaceVisit[],
  segments: TripSegment[],
  startTimeMs: number
): string {
  const namedVisits = visits.filter((v) => v.name && !v.name.startsWith('Stop #'));
  if (namedVisits.length >= 2) {
    const first = namedVisits[0].name;
    const last = namedVisits[namedVisits.length - 1].name;
    if (first !== last) {
      return `${first} → ${last}`;
    }
    return first;
  }
  if (namedVisits.length === 1) {
    const hasMotion = segments.some((s) => s.kind === 'ACTIVITY' && s.distanceM > 100);
    return hasMotion ? `Trip via ${namedVisits[0].name}` : namedVisits[0].name;
  }

  const hour = new Date(startTimeMs).getHours();
  const partOfDay =
    hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : hour < 21 ? 'Evening' : 'Night';

  const dominantActivity = segments
    .filter((s) => s.kind === 'ACTIVITY')
    .sort((a, b) => b.distanceM - a.distanceM)[0];

  if (dominantActivity) {
    const nounMap: Record<TransportMode, string> = {
      WALKING: 'Walk',
      CYCLING: 'Ride',
      DRIVING: 'Drive',
      TRANSIT: 'Transit',
      FLYING: 'Flight',
      STILL: 'Stay',
    };
    return `${partOfDay} ${nounMap[dominantActivity.mode]}`;
  }

  return `${partOfDay} Journey`;
}

function finalizeTripsAndDays(
  drafts: RawSegmentDraft[],
  schema: TimelineSchemaFormat,
  inputCount: number,
  filteredSpikes: number,
  startPerfMs: number,
  onProgress?: ProgressCallback
): ParsedTimelineResult {
  if (drafts.length === 0) {
    throw new TimelineParseError(
      'No valid timeline segments, visits, or coordinates were found in this file.'
    );
  }

  onProgress?.(78, 'Building trips, velocities, and daily summaries...');

  const sortedDrafts = [...drafts].sort((a, b) => a.startTimeMs - b.startTimeMs);

  // Group drafts into logical Trips
  const tripDraftGroups: RawSegmentDraft[][] = [];
  let currentGroup: RawSegmentDraft[] = [];

  for (const draft of sortedDrafts) {
    if (currentGroup.length === 0) {
      currentGroup.push(draft);
      continue;
    }

    const prev = currentGroup[currentGroup.length - 1];
    const gap = draft.startTimeMs - prev.endTimeMs;
    const prevDay = formatDateKey(prev.startTimeMs);
    const currDay = formatDateKey(draft.startTimeMs);

    if (gap > TRIP_GAP_THRESHOLD_MS || (currDay !== prevDay && gap > DAY_CROSS_GAP_MS)) {
      tripDraftGroups.push(currentGroup);
      currentGroup = [draft];
    } else {
      currentGroup.push(draft);
    }
  }
  if (currentGroup.length > 0) {
    tripDraftGroups.push(currentGroup);
  }

  const trips: Trip[] = [];
  let totalWaypoints = 0;
  let totalVisits = 0;
  let totalDistanceM = 0;

  for (let tIdx = 0; tIdx < tripDraftGroups.length; tIdx++) {
    const group = tripDraftGroups[tIdx];
    const waypoints: Waypoint[] = [];
    const segments: TripSegment[] = [];
    const visits: PlaceVisit[] = [];
    const modeSet = new Set<TransportMode>();

    let cumDist = 0;
    let lastTimestamp = -Infinity;

    for (let sIdx = 0; sIdx < group.length; sIdx++) {
      const draft = group[sIdx];
      const segStartWpIdx = waypoints.length;
      let segDistanceM = 0;
      let maxSpeed = 0;

      // Normalize point timestamps monotonically across segments
      const pts = draft.points;
      for (let pIdx = 0; pIdx < pts.length; pIdx++) {
        const pt = pts[pIdx];
        let ts = pt.timestampMs;
        if (ts < lastTimestamp) {
          ts = lastTimestamp;
        }
        if (ts === lastTimestamp && waypoints.length > 0) {
          const prevWp = waypoints[waypoints.length - 1];
          const d = haversineMeters(prevWp.lat, prevWp.lng, pt.lat, pt.lng);
          if (d < 2 && pt.mode === prevWp.mode) {
            continue;
          }
          ts = lastTimestamp + 1;
        }

        let stepDist = 0;
        let speedKmh = 0;
        let bearing = waypoints.length > 0 ? waypoints[waypoints.length - 1].bearing : 0;

        if (waypoints.length > 0) {
          const prevWp = waypoints[waypoints.length - 1];
          stepDist = haversineMeters(prevWp.lat, prevWp.lng, pt.lat, pt.lng);
          if (draft.kind === 'ACTIVITY') {
            segDistanceM += stepDist;
          }
          cumDist += stepDist;

          const dtMs = ts - prevWp.timestampMs;
          if (draft.kind === 'VISIT' || draft.mode === 'STILL') {
            speedKmh = 0;
          } else if (pt.speedKmh !== undefined) {
            speedKmh = pt.speedKmh;
          } else if (dtMs > 0) {
            speedKmh = (stepDist / 1000) / (dtMs / 3_600_000);
          }

          if (stepDist > 1.5) {
            bearing = computeBearing(prevWp.lat, prevWp.lng, pt.lat, pt.lng);
            if (prevWp.bearing === 0 && waypoints.length === 1) {
              prevWp.bearing = bearing;
            }
          }
        }

        if (speedKmh > maxSpeed) {
          maxSpeed = speedKmh;
        }

        waypoints.push({
          lat: pt.lat,
          lng: pt.lng,
          timestampMs: ts,
          mode: draft.mode,
          speedKmh,
          bearing,
          cumulativeDistanceM: cumDist,
        });
        lastTimestamp = ts;
      }

      if (waypoints.length === segStartWpIdx) {
        // Ensure every segment owns at least one waypoint
        const fallback = pts[0];
        const ts = Math.max(draft.startTimeMs, lastTimestamp + 1);
        waypoints.push({
          lat: fallback.lat,
          lng: fallback.lng,
          timestampMs: ts,
          mode: draft.mode,
          speedKmh: 0,
          bearing: waypoints.length > 0 ? waypoints[waypoints.length - 1].bearing : 0,
          cumulativeDistanceM: cumDist,
        });
        lastTimestamp = ts;
      }

      const segEndWpIdx = waypoints.length - 1;
      const segStartTime = waypoints[segStartWpIdx].timestampMs;
      const segEndTime = Math.max(segStartTime, waypoints[segEndWpIdx].timestampMs);
      const segDuration = Math.max(0, draft.endTimeMs - draft.startTimeMs);

      // Align departure bearing & smooth speeds inside moving segments
      if (draft.kind === 'ACTIVITY' && segEndWpIdx > segStartWpIdx) {
        if (waypoints[segStartWpIdx].speedKmh === 0) {
          waypoints[segStartWpIdx].bearing = waypoints[segStartWpIdx + 1].bearing;
          waypoints[segStartWpIdx].speedKmh = waypoints[segStartWpIdx + 1].speedKmh * 0.5;
        }
        if (segEndWpIdx - segStartWpIdx >= 2) {
          for (let k = segStartWpIdx + 1; k < segEndWpIdx; k++) {
            waypoints[k].speedKmh =
              (waypoints[k - 1].speedKmh + waypoints[k].speedKmh * 2 + waypoints[k + 1].speedKmh) / 4;
          }
        }
      }

      const effectiveDist =
        draft.kind === 'VISIT'
          ? 0
          : segDistanceM > 0
            ? segDistanceM
            : draft.explicitDistanceM ?? 0;

      const avgSpeedKmh =
        draft.kind === 'VISIT' || segDuration <= 0
          ? 0
          : (effectiveDist / 1000) / (segDuration / 3_600_000);

      let visitId: string | undefined;
      if (draft.kind === 'VISIT' && draft.visit) {
        visitId = `visit-${tIdx}-${sIdx}`;
        visits.push({
          id: visitId,
          name: draft.visit.name,
          address: draft.visit.address,
          semanticType: draft.visit.semanticType,
          lat: draft.visit.lat,
          lng: draft.visit.lng,
          startTimeMs: draft.startTimeMs,
          endTimeMs: draft.endTimeMs,
          dwellDurationMs: Math.max(0, draft.endTimeMs - draft.startTimeMs),
        });
      }

      modeSet.add(draft.mode);

      segments.push({
        id: `seg-${tIdx}-${sIdx}`,
        kind: draft.kind,
        mode: draft.mode,
        startTimeMs: segStartTime,
        endTimeMs: segEndTime,
        durationMs: Math.max(segDuration, segEndTime - segStartTime),
        distanceM: effectiveDist,
        avgSpeedKmh,
        maxSpeedKmh: Math.max(maxSpeed, avgSpeedKmh),
        startWaypointIndex: segStartWpIdx,
        endWaypointIndex: segEndWpIdx,
        visitId,
        label: draft.visit ? draft.visit.name : draft.mode,
      });
    }

    // Ensure at least 2 waypoints per Trip so interpolation and GeoJSON lines never fail
    if (waypoints.length === 1) {
      const only = waypoints[0];
      waypoints.push({
        ...only,
        timestampMs: only.timestampMs + 60_000,
      });
    }

    if (waypoints.length < 2) continue;

    const startTimeMs = waypoints[0].timestampMs;
    const endTimeMs = waypoints[waypoints.length - 1].timestampMs;
    const durationMs = Math.max(1000, endTimeMs - startTimeMs);
    const distanceM = waypoints[waypoints.length - 1].cumulativeDistanceM;

    const tripModes = Array.from(modeSet);
    const trip: Trip = {
      id: `trip-${tIdx}-${startTimeMs}`,
      dateKey: formatDateKey(startTimeMs),
      title: deriveTripTitle(visits, segments, startTimeMs),
      startTimeMs,
      endTimeMs,
      durationMs,
      distanceM,
      modes: tripModes,
      waypoints,
      segments,
      visits,
      bounds: computeBounds(waypoints),
    };

    trips.push(trip);
    totalWaypoints += waypoints.length;
    totalVisits += visits.length;
    totalDistanceM += distanceM;
  }

  if (trips.length === 0) {
    throw new TimelineParseError('No valid trips could be constructed from this file.');
  }

  // Group Trips into Days
  const dayMap = new Map<string, Trip[]>();
  for (const trip of trips) {
    const list = dayMap.get(trip.dateKey);
    if (list) {
      list.push(trip);
    } else {
      dayMap.set(trip.dateKey, [trip]);
    }
  }

  const days: DayGroup[] = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, dayTrips]) => {
      const modeSet = new Set<TransportMode>();
      let dist = 0;
      let dur = 0;
      let visitCount = 0;
      for (const t of dayTrips) {
        dist += t.distanceM;
        dur += t.durationMs;
        visitCount += t.visits.length;
        for (const m of t.modes) modeSet.add(m);
      }
      return {
        dateKey,
        dateLabel: formatDate(dayTrips[0].startTimeMs),
        startTimeMs: dayTrips[0].startTimeMs,
        endTimeMs: dayTrips[dayTrips.length - 1].endTimeMs,
        totalDistanceM: dist,
        totalDurationMs: dur,
        modes: Array.from(modeSet),
        tripIds: dayTrips.map((t) => t.id),
        visitCount,
      };
    });

  onProgress?.(100, 'Timeline ready');

  return {
    trips,
    days,
    stats: {
      schema,
      totalInputRecords: inputCount,
      totalWaypoints,
      filteredSpikes,
      totalTrips: trips.length,
      totalDays: days.length,
      totalVisits,
      totalDistanceM,
      parseDurationMs: Math.round(performance.now() - startPerfMs),
    },
  };
}

export function detectTimelineSchema(raw: unknown): TimelineSchemaFormat {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return 'UNKNOWN';
  }
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.semanticSegments)) return 'ON_DEVICE_TIMELINE';
  if (Array.isArray(obj.timelineObjects)) return 'SEMANTIC_HISTORY';
  if (Array.isArray(obj.locations)) return 'RAW_RECORDS';
  return 'UNKNOWN';
}

export function parseTimelineJson(
  raw: unknown,
  onProgress?: ProgressCallback
): ParsedTimelineResult {
  const startPerfMs = performance.now();
  const schema = detectTimelineSchema(raw);

  if (schema === 'UNKNOWN') {
    throw new TimelineParseError(
      'Unrecognized JSON schema. Supported formats: On-Device Timeline.json (semanticSegments), Semantic Location History (timelineObjects), and Raw Records.json (locations).'
    );
  }

  const obj = raw as Record<string, unknown[]>;

  if (schema === 'ON_DEVICE_TIMELINE') {
    const res = parseOnDeviceTimeline(obj.semanticSegments, onProgress);
    return finalizeTripsAndDays(
      res.drafts,
      schema,
      res.inputCount,
      res.filteredSpikes,
      startPerfMs,
      onProgress
    );
  }

  if (schema === 'SEMANTIC_HISTORY') {
    const res = parseSemanticHistory(obj.timelineObjects, onProgress);
    return finalizeTripsAndDays(
      res.drafts,
      schema,
      res.inputCount,
      res.filteredSpikes,
      startPerfMs,
      onProgress
    );
  }

  const res = parseRawRecords(obj.locations, onProgress);
  return finalizeTripsAndDays(
    res.drafts,
    schema,
    res.inputCount,
    res.filteredSpikes,
    startPerfMs,
    onProgress
  );
}

export function parseTimelineText(
  text: string,
  onProgress?: ProgressCallback
): ParsedTimelineResult {
  if (!text || !text.trim()) {
    throw new TimelineParseError('The selected file is empty.');
  }

  onProgress?.(5, 'Decoding JSON payload...');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Syntax error';
    throw new TimelineParseError(`Malformed JSON file: ${msg}`);
  }

  return parseTimelineJson(parsed, onProgress);
}
