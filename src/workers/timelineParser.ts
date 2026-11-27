import type {
  ActivitySubtype,
  LifetimeStats,
  ModeBreakdownItem,
  ParsedTimelineResult,
  PlaceVisit,
  TimelineSchemaFormat,
  TimelineSummaryIndex,
  TimelineViewMode,
  TopLocationItem,
  TransportMode,
  Trip,
  TripSegment,
  TripSummary,
  Waypoint,
} from '../types/timeline';
import { formatDateKey, formatDateKeyLabel } from '../utils/format';
import {
  computeBearing,
  computeBounds,
  haversineMeters,
  isValidCoordinate,
  lerp,
  MODE_COLORS,
} from '../utils/geo';

export class TimelineParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimelineParseError';
  }
}

export type ProgressCallback = (percent: number, stage: string) => void;

const MAX_GROUND_SPEED_KMH = 1200;
const JOURNEY_GAP_THRESHOLD_MS = 45 * 60 * 1000; // 45 minutes
const JOURNEY_VISIT_SPLIT_MS = 45 * 60 * 1000; // 45 minutes
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

interface ExtractedVisit {
  startTimeMs: number;
  endTimeMs: number;
  localDateKey: string;
  name: string;
  address?: string;
  semanticType?: string;
  lat: number;
  lng: number;
}

interface ExtractedActivity {
  startTimeMs: number;
  endTimeMs: number;
  localDateKey: string;
  mode: TransportMode;
  subtype: ActivitySubtype;
  startCoord: { lat: number; lng: number } | null;
  endCoord: { lat: number; lng: number } | null;
  distanceMeters?: number;
}

interface RawSegmentDraft {
  kind: 'ACTIVITY' | 'VISIT';
  mode: TransportMode;
  subtype?: ActivitySubtype;
  startTimeMs: number;
  endTimeMs: number;
  localDateKey: string;
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
 * Extract the calendar date YYYY-MM-DD in the timestamp's original local offset
 * (e.g. "2024-06-15T23:45:00.000+02:00" -> "2024-06-15"), falling back to device local date.
 */
export function extractLocalDateKey(rawTimestamp: unknown, fallbackMs: number): string {
  if (typeof rawTimestamp === 'string') {
    const match = rawTimestamp
      .trim()
      .match(/^(\d{4}-\d{2}-\d{2})T.*[+-]\d{2}:?\d{2}$/);
    if (match) {
      return match[1];
    }
  }
  return formatDateKey(fallbackMs);
}

/**
 * Parse Google geo coordinates from strings like:
 * - "50.1254943°, 14.4973446°"
 * - "geo:37.7955,-122.3937"
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

export function classifyActivitySubtype(
  rawType: unknown,
  fallbackMode: TransportMode
): ActivitySubtype {
  if (typeof rawType === 'string') {
    const upper = rawType.trim().toUpperCase();
    if (upper.includes('SUBWAY') || upper.includes('METRO')) return 'SUBWAY';
    if (upper.includes('TRAM') || upper.includes('LIGHT_RAIL')) return 'TRAM';
    if (upper.includes('BUS')) return 'BUS';
    if (
      upper.includes('TRAIN') ||
      upper.includes('RAIL') ||
      upper.includes('FERRY') ||
      upper.includes('TRANSIT') ||
      upper.includes('CABLE_CAR') ||
      upper.includes('GONDOLA')
    ) {
      return 'TRAIN';
    }
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
  }

  switch (fallbackMode) {
    case 'TRANSIT':
      return 'TRAIN';
    case 'WALKING':
      return 'WALKING';
    case 'CYCLING':
      return 'CYCLING';
    case 'FLYING':
      return 'FLYING';
    case 'DRIVING':
      return 'DRIVING';
    default:
      return 'STILL';
  }
}

function inferModeFromSpeed(speedKmh: number): TransportMode {
  if (!Number.isFinite(speedKmh) || speedKmh < 1.2) return 'STILL';
  if (speedKmh < 7.5) return 'WALKING';
  if (speedKmh < 26) return 'CYCLING';
  if (speedKmh < 240) return 'DRIVING';
  return 'FLYING';
}

export function mapVisitSemanticType(raw?: unknown): string {
  if (typeof raw !== 'string') return 'Stop';
  const upper = raw.trim().toUpperCase();
  if (!upper || upper === 'UNKNOWN' || upper === 'TYPE_UNKNOWN') {
    return 'Stop';
  }
  if (upper === 'INFERRED_HOME' || upper === 'HOME') {
    return 'Home';
  }
  if (upper === 'INFERRED_WORK' || upper === 'WORK') {
    return 'Work';
  }
  if (upper === 'SEARCHED_ADDRESS') {
    return 'Pinned Place';
  }

  const cleaned = upper
    .replace(/^INFERRED_/, '')
    .replace(/_/g, ' ')
    .toLowerCase();
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

function isHomeOrWorkVisit(visit?: { name?: string; semanticType?: string }): boolean {
  if (!visit) return false;
  const st = (visit.semanticType ?? '').trim().toUpperCase();
  if (st === 'INFERRED_HOME' || st === 'HOME' || st === 'INFERRED_WORK' || st === 'WORK') {
    return true;
  }
  const n = (visit.name ?? '').trim();
  return n === 'Home' || n === 'Work';
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
      if (cleaned.length === 1 && i + 1 < points.length) {
        const next = points[i + 1];
        const nextDtHours = Math.max(next.timestampMs - curr.timestampMs, 500) / 3_600_000;
        const nextSpeed =
          (haversineMeters(curr.lat, curr.lng, next.lat, next.lng) / 1000) / nextDtHours;
        const prevToNextDtHours =
          Math.max(next.timestampMs - prev.timestampMs, 500) / 3_600_000;
        const prevToNextSpeed =
          (haversineMeters(prev.lat, prev.lng, next.lat, next.lng) / 1000) /
          prevToNextDtHours;
        if (nextSpeed <= MAX_GROUND_SPEED_KMH && prevToNextSpeed > MAX_GROUND_SPEED_KMH) {
          cleaned[0] = curr;
          filteredSpikes++;
          continue;
        }
      }
      filteredSpikes++;
      continue;
    }

    if (effectiveMode === 'FLYING' && dtMs < 2000 && distM > 1200) {
      filteredSpikes++;
      continue;
    }

    cleaned.push(curr);
  }

  return { cleaned, filteredSpikes };
}

/**
 * Computes perpendicular distance in meters from point `p` to segment `[a, b]`
 * using fast local equirectangular projection (accurate within centimeters over
 * street/city spans and ~10x faster than spherical cross-track math).
 */
function perpendicularDistanceMeters(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const meanLatRad = (((a.lat + b.lat) * 0.5) * Math.PI) / 180;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.max(0.05, Math.cos(meanLatRad));

  const ax = 0;
  const ay = 0;
  const bx = (b.lng - a.lng) * mPerDegLng;
  const by = (b.lat - a.lat) * mPerDegLat;
  const px = (p.lng - a.lng) * mPerDegLng;
  const py = (p.lat - a.lat) * mPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    return Math.hypot(px, py);
  }
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Iterative (stack-safe) Ramer-Douglas-Peucker polyline simplification.
 * Prunes redundant GPS jitter points within `epsilonMeters` (~3m) while
 * always preserving start/end anchors and significant geometric curves.
 */
export function simplifyPolylineRdp<T extends { lat: number; lng: number }>(
  points: T[],
  epsilonMeters = 3
): T[] {
  const n = points.length;
  if (n <= 2 || epsilonMeters <= 0) {
    return points;
  }

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: Array<[number, number]> = [[0, n - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDist = -1;
    let splitIdx = -1;

    const a = points[first];
    const b = points[last];

    for (let i = first + 1; i < last; i++) {
      const dist = perpendicularDistanceMeters(points[i], a, b);
      if (dist > maxDist) {
        maxDist = dist;
        splitIdx = i;
      }
    }

    if (maxDist > epsilonMeters && splitIdx !== -1) {
      keep[splitIdx] = 1;
      if (splitIdx - first > 1) stack.push([first, splitIdx]);
      if (last - splitIdx > 1) stack.push([splitIdx, last]);
    }
  }

  const simplified: T[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) {
      simplified.push(points[i]);
    }
  }
  return simplified;
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
 * Deduplicate overlapping hierarchyLevel=0 visits sorted chronologically.
 */
function deduplicateVisits(sortedVisits: ExtractedVisit[]): ExtractedVisit[] {
  if (sortedVisits.length <= 1) return sortedVisits;

  const result: ExtractedVisit[] = [];
  for (const v of sortedVisits) {
    const prev = result[result.length - 1];
    if (!prev) {
      result.push(v);
      continue;
    }

    const overlapStart = Math.max(prev.startTimeMs, v.startTimeMs);
    const overlapEnd = Math.min(prev.endTimeMs, v.endTimeMs);
    const overlapMs = Math.max(0, overlapEnd - overlapStart);
    const minDur = Math.max(
      1,
      Math.min(prev.endTimeMs - prev.startTimeMs, v.endTimeMs - v.startTimeMs)
    );
    const dist = haversineMeters(prev.lat, prev.lng, v.lat, v.lng);

    if (overlapMs / minDur > 0.65 && dist < 120) {
      // Keep the longer / better-named visit
      const prevGeneric = prev.name === 'Stop' || prev.name === 'Pinned Place';
      const currGeneric = v.name === 'Stop' || v.name === 'Pinned Place';
      if (
        (prevGeneric && !currGeneric) ||
        (prevGeneric === currGeneric &&
          v.endTimeMs - v.startTimeMs > prev.endTimeMs - prev.startTimeMs)
      ) {
        result[result.length - 1] = {
          ...v,
          startTimeMs: Math.min(prev.startTimeMs, v.startTimeMs),
          endTimeMs: Math.max(prev.endTimeMs, v.endTimeMs),
        };
      } else {
        prev.startTimeMs = Math.min(prev.startTimeMs, v.startTimeMs);
        prev.endTimeMs = Math.max(prev.endTimeMs, v.endTimeMs);
      }
      continue;
    }

    result.push(v);
  }
  return result;
}

/**
 * O(log V) check whether a timelinePath timestamp falls inside a stationary visit window.
 */
function isStrictlyInsideAnyVisit(
  tsMs: number,
  visits: ExtractedVisit[]
): boolean {
  if (visits.length === 0) return false;
  let lo = 0;
  let hi = visits.length - 1;
  let candidate = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (visits[mid].startTimeMs < tsMs) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  for (let i = candidate; i >= 0 && i >= candidate - 2; i--) {
    const v = visits[i];
    if (tsMs > v.startTimeMs + 1000 && tsMs < v.endTimeMs - 1000) {
      return true;
    }
  }
  return false;
}

/**
 * Schema 1: New On-Device Timeline.json (`semanticSegments`)
 * Extracts visits, activities, and timelinePath into three separate arrays,
 * drops nested hierarchyLevel > 0 visits, discards stationary jitter inside visits,
 * and reconciles timelinePath strictly inside each activity's [startTime, endTime].
 */
function parseOnDeviceTimeline(
  semanticSegments: unknown[],
  onProgress?: ProgressCallback
): { drafts: RawSegmentDraft[]; filteredSpikes: number; inputCount: number } {
  const extractedVisits: ExtractedVisit[] = [];
  const extractedActivities: ExtractedActivity[] = [];
  const extractedPathPoints: RawPoint[] = [];
  let filteredSpikes = 0;

  onProgress?.(12, 'Extracting visits, activities, and GPS paths...');

  for (let i = 0; i < semanticSegments.length; i++) {
    if (i % 5000 === 0 && semanticSegments.length > 5000) {
      onProgress?.(
        12 + Math.round((i / semanticSegments.length) * 38),
        `Reading semantic segments (${i.toLocaleString()} / ${semanticSegments.length.toLocaleString()})...`
      );
    }

    const seg = semanticSegments[i];
    if (!seg || typeof seg !== 'object') continue;
    const rec = seg as Record<string, unknown>;

    const segStart = parseTimestampMs(rec.startTime);
    const segEnd = parseTimestampMs(rec.endTime);

    // 1. Collect timelinePath points separately (never merge directly as legs)
    if (Array.isArray(rec.timelinePath)) {
      for (const item of rec.timelinePath) {
        if (!item || typeof item !== 'object') continue;
        const pRec = item as Record<string, unknown>;
        const coord = parseGeoString(pRec.point) ?? parseLatLngObject(pRec);
        let ts = parseTimestampMs(pRec.time ?? pRec.timestamp);
        if (
          ts === null &&
          segStart !== null &&
          pRec.durationMinutesOffsetFromStartTime !== undefined
        ) {
          const offsetMin = Number(pRec.durationMinutesOffsetFromStartTime);
          if (Number.isFinite(offsetMin)) {
            ts = segStart + offsetMin * 60_000;
          }
        }
        if (coord && ts !== null) {
          extractedPathPoints.push({
            lat: coord.lat,
            lng: coord.lng,
            timestampMs: ts,
          });
        }
      }
    }

    // 2. Collect top-level visits (hierarchyLevel === 0) separately
    if (rec.visit && typeof rec.visit === 'object') {
      const visitObj = rec.visit as Record<string, unknown>;
      const hierarchyLevel =
        typeof visitObj.hierarchyLevel === 'number' ? visitObj.hierarchyLevel : 0;

      if (hierarchyLevel <= 0 && segStart !== null) {
        const top =
          visitObj.topCandidate && typeof visitObj.topCandidate === 'object'
            ? (visitObj.topCandidate as Record<string, unknown>)
            : visitObj;
        const coord =
          parseLatLngObject(top.placeLocation) ??
          parseGeoString(top.placeLocation) ??
          parseLatLngObject(visitObj.placeLocation);

        if (coord) {
          const endMs = segEnd !== null && segEnd >= segStart ? segEnd : segStart + 60_000;
          const semanticType =
            typeof top.semanticType === 'string' ? top.semanticType : undefined;
          const explicitName =
            (typeof top.placeName === 'string' && top.placeName.trim()) ||
            (typeof top.name === 'string' && top.name.trim()) ||
            (typeof visitObj.placeName === 'string' && visitObj.placeName.trim()) ||
            '';
          const name = explicitName || mapVisitSemanticType(semanticType);
          const address = typeof top.address === 'string' ? top.address : undefined;

          extractedVisits.push({
            startTimeMs: segStart,
            endTimeMs: endMs,
            localDateKey: extractLocalDateKey(rec.startTime, segStart),
            name,
            address,
            semanticType,
            lat: coord.lat,
            lng: coord.lng,
          });
        }
      }
    }

    // 3. Collect activities separately
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
        const rawType = top.type ?? act.type;
        const mode = normalizeTransportMode(rawType) ?? inferModeFromSpeed(avgSpeed);
        const subtype = classifyActivitySubtype(rawType, mode);

        extractedActivities.push({
          startTimeMs: startMs,
          endTimeMs: endMs,
          localDateKey: extractLocalDateKey(rec.startTime, startMs),
          mode,
          subtype,
          startCoord,
          endCoord,
          distanceMeters:
            typeof act.distanceMeters === 'number' && Number.isFinite(act.distanceMeters)
              ? act.distanceMeters
              : undefined,
        });
      }
    }
  }

  onProgress?.(54, 'Reconciling activities with GPS paths...');

  extractedVisits.sort((a, b) => a.startTimeMs - b.startTimeMs);
  const visits = deduplicateVisits(extractedVisits);
  extractedPathPoints.sort((a, b) => a.timestampMs - b.timestampMs);

  const drafts: RawSegmentDraft[] = [];

  for (const v of visits) {
    drafts.push({
      kind: 'VISIT',
      mode: 'STILL',
      startTimeMs: v.startTimeMs,
      endTimeMs: v.endTimeMs,
      localDateKey: v.localDateKey,
      points: [
        { lat: v.lat, lng: v.lng, timestampMs: v.startTimeMs, mode: 'STILL' },
        { lat: v.lat, lng: v.lng, timestampMs: v.endTimeMs, mode: 'STILL' },
      ],
      visit: {
        name: v.name,
        address: v.address,
        semanticType: v.semanticType,
        lat: v.lat,
        lng: v.lng,
      },
    });
  }

  for (let aIdx = 0; aIdx < extractedActivities.length; aIdx++) {
    if (aIdx % 2500 === 0 && extractedActivities.length > 2500) {
      onProgress?.(
        54 + Math.round((aIdx / extractedActivities.length) * 20),
        'Attaching GPS trails to activities...'
      );
    }

    const act = extractedActivities[aIdx];
    let pts: RawPoint[] = [];

    if (extractedPathPoints.length > 0) {
      const startIdx = binarySearchLower(extractedPathPoints, act.startTimeMs);
      for (let idx = startIdx; idx < extractedPathPoints.length; idx++) {
        const p = extractedPathPoints[idx];
        if (p.timestampMs > act.endTimeMs) break;
        // Discard stationary GPS jitter points falling strictly inside any visit window
        if (isStrictlyInsideAnyVisit(p.timestampMs, visits)) {
          continue;
        }
        pts.push({ ...p, mode: act.mode });
      }
    }

    if (act.startCoord) {
      if (
        pts.length === 0 ||
        pts[0].timestampMs - act.startTimeMs > 10_000 ||
        haversineMeters(pts[0].lat, pts[0].lng, act.startCoord.lat, act.startCoord.lng) >
          50
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
        act.endTimeMs - last.timestampMs > 10_000 ||
        haversineMeters(last.lat, last.lng, act.endCoord.lat, act.endCoord.lng) > 50
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
      const simplified =
        spikeRes.cleaned.length > 3
          ? simplifyPolylineRdp(spikeRes.cleaned, 3)
          : spikeRes.cleaned;
      if (simplified.length > 0) {
        drafts.push({
          kind: 'ACTIVITY',
          mode: act.mode,
          subtype: act.subtype,
          startTimeMs: act.startTimeMs,
          endTimeMs: act.endTimeMs,
          localDateKey: act.localDateKey,
          points: simplified,
          explicitDistanceM: act.distanceMeters,
        });
      }
    }
  }

  // Only fall back to raw path segmentation when there are zero visits AND zero activities
  if (
    extractedVisits.length === 0 &&
    extractedActivities.length === 0 &&
    extractedPathPoints.length > 0
  ) {
    const rawRes = segmentRawLocationPoints(extractedPathPoints, onProgress);
    drafts.push(...rawRes.drafts);
    filteredSpikes += rawRes.filteredSpikes;
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
      const rawStart = dur.startTimestamp ?? dur.startTimestampMs;
      const startMs = parseTimestampMs(rawStart);
      const endMs =
        parseTimestampMs(dur.endTimestamp ?? dur.endTimestampMs) ??
        (startMs !== null ? startMs + 60_000 : null);

      if (coord && startMs !== null && endMs !== null && endMs >= startMs) {
        const semanticType =
          typeof loc.semanticType === 'string' ? loc.semanticType : undefined;
        const name =
          (typeof loc.name === 'string' && loc.name.trim()) ||
          mapVisitSemanticType(semanticType ?? pv.placeConfidence);
        const address = typeof loc.address === 'string' ? loc.address : undefined;

        drafts.push({
          kind: 'VISIT',
          mode: 'STILL',
          startTimeMs: startMs,
          endTimeMs: endMs,
          localDateKey: extractLocalDateKey(rawStart, startMs),
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
      const rawStart = dur.startTimestamp ?? dur.startTimestampMs;
      const startMs = parseTimestampMs(rawStart);
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
      const subtype = classifyActivitySubtype(seg.activityType, mode);

      let pts: RawPoint[] = [];

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
            subtype,
            startTimeMs: startMs,
            endTimeMs: endMs,
            localDateKey: extractLocalDateKey(rawStart, startMs),
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

  const enriched: (RawPoint & { resolvedMode: TransportMode })[] = cleaned.map(
    (pt, idx) => {
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
    }
  );

  const drafts: RawSegmentDraft[] = [];
  let i = 0;
  let stopCounter = 1;

  while (i < enriched.length) {
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
        localDateKey: formatDateKey(startMs),
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

    const legStart = i;
    let legEnd = i + 1;
    const legMode =
      enriched[legStart].resolvedMode === 'STILL'
        ? 'WALKING'
        : enriched[legStart].resolvedMode;

    while (legEnd < enriched.length) {
      const gap = enriched[legEnd].timestampMs - enriched[legEnd - 1].timestampMs;
      if (gap > RAW_GAP_SPLIT_MS) break;

      let dwellEnd = legEnd + 1;
      while (
        dwellEnd < enriched.length &&
        enriched[dwellEnd].timestampMs - enriched[dwellEnd - 1].timestampMs <=
          RAW_GAP_SPLIT_MS &&
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
        enriched[dwellEnd - 1].timestampMs - enriched[legEnd].timestampMs >=
          RAW_DWELL_MIN_MS
      ) {
        break;
      }

      const nextMode = enriched[legEnd].resolvedMode;
      if (nextMode !== 'STILL' && nextMode !== legMode) {
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
        localDateKey: formatDateKey(slice[0].timestampMs),
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
        localDateKey: formatDateKey(slice[0].timestampMs),
        points: [
          {
            lat: slice[0].lat,
            lng: slice[0].lng,
            timestampMs: slice[0].timestampMs,
            mode: 'STILL',
          },
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
  startTimeMs: number,
  originBoundaryName?: string,
  destBoundaryName?: string
): string {
  const nonGenericNames: string[] = [];
  if (originBoundaryName && originBoundaryName !== 'Stop') {
    nonGenericNames.push(originBoundaryName);
  }
  for (const v of visits) {
    if (v.name && !v.name.startsWith('Stop #') && v.name !== 'Stop') {
      if (nonGenericNames[nonGenericNames.length - 1] !== v.name) {
        nonGenericNames.push(v.name);
      }
    }
  }
  if (destBoundaryName && destBoundaryName !== 'Stop') {
    if (nonGenericNames[nonGenericNames.length - 1] !== destBoundaryName) {
      nonGenericNames.push(destBoundaryName);
    }
  }

  if (nonGenericNames.length >= 2) {
    const first = nonGenericNames[0];
    const last = nonGenericNames[nonGenericNames.length - 1];
    if (first !== last) {
      return `${first} → ${last}`;
    }
    return first;
  }
  if (nonGenericNames.length === 1) {
    const hasMotion = segments.some((s) => s.kind === 'ACTIVITY' && s.distanceM > 100);
    return hasMotion ? `Trip via ${nonGenericNames[0]}` : nonGenericNames[0];
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

function buildTripFromDrafts(
  group: RawSegmentDraft[],
  tripId: string,
  dateKey: string,
  originBoundaryName?: string,
  destBoundaryName?: string
): Trip | null {
  const waypoints: Waypoint[] = [];
  const segments: TripSegment[] = [];
  const visits: PlaceVisit[] = [];
  const modeSet = new Set<TransportMode>();

  let cumDist = 0;
  let lastTimestamp = -Infinity;

  for (let sIdx = 0; sIdx < group.length; sIdx++) {
    const draft = group[sIdx];
    const segStartWpIdx = waypoints.length;
    const pts = draft.points;

    // Precompute segment-internal raw Haversine lengths so we can align with Google's distanceMeters
    const rawSegPts: {
      lat: number;
      lng: number;
      ts: number;
      stepDist: number;
      speedKmhInput?: number;
    }[] = [];

    for (let pIdx = 0; pIdx < pts.length; pIdx++) {
      const pt = pts[pIdx];
      let ts = pt.timestampMs;
      if (ts < lastTimestamp) {
        ts = lastTimestamp;
      }
      if (ts === lastTimestamp && (rawSegPts.length > 0 || waypoints.length > 0)) {
        const ref =
          rawSegPts.length > 0
            ? rawSegPts[rawSegPts.length - 1]
            : waypoints[waypoints.length - 1];
        const d = haversineMeters(ref.lat, ref.lng, pt.lat, pt.lng);
        const prevMode =
          rawSegPts.length > 0 ? draft.mode : waypoints[waypoints.length - 1].mode;
        if (d < 2 && draft.mode === prevMode) {
          continue;
        }
        ts = lastTimestamp + 1;
      }

      let stepDist = 0;
      if (rawSegPts.length > 0) {
        const prev = rawSegPts[rawSegPts.length - 1];
        stepDist = haversineMeters(prev.lat, prev.lng, pt.lat, pt.lng);
      }

      rawSegPts.push({
        lat: pt.lat,
        lng: pt.lng,
        ts,
        stepDist: draft.kind === 'ACTIVITY' ? stepDist : 0,
        speedKmhInput: pt.speedKmh,
      });
      lastTimestamp = ts;
    }

    if (rawSegPts.length === 0) {
      const fallback = pts[0];
      const ts = Math.max(draft.startTimeMs, lastTimestamp + 1);
      rawSegPts.push({
        lat: fallback.lat,
        lng: fallback.lng,
        ts,
        stepDist: 0,
      });
      lastTimestamp = ts;
    }

    const rawSegDistanceM = rawSegPts.reduce((acc, p) => acc + p.stepDist, 0);
    const hasExplicitDist =
      draft.kind === 'ACTIVITY' &&
      typeof draft.explicitDistanceM === 'number' &&
      Number.isFinite(draft.explicitDistanceM) &&
      draft.explicitDistanceM > 0;

    const targetSegDistanceM = hasExplicitDist
      ? draft.explicitDistanceM!
      : rawSegDistanceM;
    const distScale =
      hasExplicitDist && rawSegDistanceM > 1
        ? draft.explicitDistanceM! / rawSegDistanceM
        : 1;

    let maxSpeed = 0;

    for (let k = 0; k < rawSegPts.length; k++) {
      const item = rawSegPts[k];
      let scaledStep = item.stepDist * distScale;
      if (hasExplicitDist && rawSegDistanceM <= 1 && k === rawSegPts.length - 1) {
        scaledStep = draft.explicitDistanceM!;
      }

      cumDist += scaledStep;

      let speedKmh = 0;
      let bearing = waypoints.length > 0 ? waypoints[waypoints.length - 1].bearing : 0;

      if (k > 0 && waypoints.length > 0) {
        const prevWp = waypoints[waypoints.length - 1];
        const dtMs = item.ts - prevWp.timestampMs;
        if (draft.kind === 'VISIT' || draft.mode === 'STILL') {
          speedKmh = 0;
        } else if (item.speedKmhInput !== undefined) {
          speedKmh = item.speedKmhInput;
        } else if (dtMs > 0) {
          speedKmh = (scaledStep / 1000) / (dtMs / 3_600_000);
        }

        const geoDist = haversineMeters(prevWp.lat, prevWp.lng, item.lat, item.lng);
        if (geoDist > 1.5) {
          bearing = computeBearing(prevWp.lat, prevWp.lng, item.lat, item.lng);
          if (prevWp.bearing === 0 && waypoints.length === 1) {
            prevWp.bearing = bearing;
          }
        }
      }

      if (speedKmh > maxSpeed) {
        maxSpeed = speedKmh;
      }

      waypoints.push({
        lat: item.lat,
        lng: item.lng,
        timestampMs: item.ts,
        mode: draft.mode,
        speedKmh,
        bearing,
        cumulativeDistanceM: cumDist,
      });
    }

    const segEndWpIdx = waypoints.length - 1;
    const segStartTime = waypoints[segStartWpIdx].timestampMs;
    const segEndTime = Math.max(segStartTime, waypoints[segEndWpIdx].timestampMs);
    const segDuration = Math.max(0, draft.endTimeMs - draft.startTimeMs);

    if (draft.kind === 'ACTIVITY' && segEndWpIdx > segStartWpIdx) {
      if (waypoints[segStartWpIdx].speedKmh === 0) {
        waypoints[segStartWpIdx].bearing = waypoints[segStartWpIdx + 1].bearing;
        waypoints[segStartWpIdx].speedKmh = waypoints[segStartWpIdx + 1].speedKmh * 0.5;
      }
      if (segEndWpIdx - segStartWpIdx >= 2) {
        for (let k = segStartWpIdx + 1; k < segEndWpIdx; k++) {
          waypoints[k].speedKmh =
            (waypoints[k - 1].speedKmh +
              waypoints[k].speedKmh * 2 +
              waypoints[k + 1].speedKmh) /
            4;
        }
      }
    }

    const effectiveDist = draft.kind === 'VISIT' ? 0 : targetSegDistanceM;
    const avgSpeedKmh =
      draft.kind === 'VISIT' || segDuration <= 0
        ? 0
        : (effectiveDist / 1000) / (segDuration / 3_600_000);

    let visitId: string | undefined;
    if (draft.kind === 'VISIT' && draft.visit) {
      visitId = `${tripId}-visit-${sIdx}`;
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
      id: `${tripId}-seg-${sIdx}`,
      kind: draft.kind,
      mode: draft.mode,
      subtype: draft.kind === 'VISIT' ? 'STILL' : draft.subtype ?? classifyActivitySubtype(undefined, draft.mode),
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

  if (waypoints.length === 1) {
    const only = waypoints[0];
    waypoints.push({
      ...only,
      timestampMs: only.timestampMs + 60_000,
    });
  }

  if (waypoints.length < 2) return null;

  const startTimeMs = waypoints[0].timestampMs;
  const endTimeMs = waypoints[waypoints.length - 1].timestampMs;
  const durationMs = Math.max(1000, endTimeMs - startTimeMs);
  const distanceM = waypoints[waypoints.length - 1].cumulativeDistanceM;

  return {
    id: tripId,
    dateKey,
    title: deriveTripTitle(
      visits,
      segments,
      startTimeMs,
      originBoundaryName,
      destBoundaryName
    ),
    startTimeMs,
    endTimeMs,
    durationMs,
    distanceM,
    modes: Array.from(modeSet),
    waypoints,
    segments,
    visits,
    bounds: computeBounds(waypoints),
  };
}

function summarizeTrip(trip: Trip, viewMode: TimelineViewMode): TripSummary {
  const visitNames: string[] = [];
  const seen = new Set<string>();
  for (const v of trip.visits) {
    if (v.name && !seen.has(v.name)) {
      seen.add(v.name);
      visitNames.push(v.name);
    }
  }
  return {
    id: trip.id,
    viewMode,
    dateKey: trip.dateKey,
    dateLabel: formatDateKeyLabel(trip.dateKey),
    yearMonth: trip.dateKey.slice(0, 7),
    title: trip.title,
    startTimeMs: trip.startTimeMs,
    endTimeMs: trip.endTimeMs,
    durationMs: trip.durationMs,
    distanceM: trip.distanceM,
    totalDistanceKm: Math.round((trip.distanceM / 1000) * 100) / 100,
    modes: trip.modes,
    segmentCount: trip.segments.length,
    visitCount: trip.visits.length,
    visitNames,
  };
}

function buildIndividualJourneys(sortedDrafts: RawSegmentDraft[]): Trip[] {
  const hasAnyActivity = sortedDrafts.some((d) => d.kind === 'ACTIVITY');

  if (!hasAnyActivity) {
    // Visit-only file: return individual stays cleanly
    const stays: Trip[] = [];
    sortedDrafts.forEach((draft, idx) => {
      const trip = buildTripFromDrafts(
        [draft],
        `journey-${idx}-${draft.startTimeMs}`,
        draft.localDateKey
      );
      if (trip) stays.push(trip);
    });
    return stays;
  }

  interface JourneyDraftBucket {
    drafts: RawSegmentDraft[];
    originBoundaryName?: string;
    destBoundaryName?: string;
  }

  const buckets: JourneyDraftBucket[] = [];
  let current: JourneyDraftBucket | null = null;
  let lastBoundaryName: string | undefined;

  const flushCurrent = (destName?: string) => {
    if (!current || current.drafts.length === 0) {
      current = null;
      return;
    }
    if (destName) {
      current.destBoundaryName = destName;
    }
    buckets.push(current);
    current = null;
  };

  for (const draft of sortedDrafts) {
    const isBoundaryVisit =
      draft.kind === 'VISIT' &&
      (isHomeOrWorkVisit(draft.visit) ||
        draft.endTimeMs - draft.startTimeMs > JOURNEY_VISIT_SPLIT_MS);

    if (isBoundaryVisit) {
      const boundaryName = draft.visit?.name;
      if (current) {
        flushCurrent(boundaryName);
      }
      lastBoundaryName = boundaryName;
      continue;
    }

    if (!current) {
      current = {
        drafts: [draft],
        originBoundaryName: lastBoundaryName,
      };
      lastBoundaryName = undefined;
      continue;
    }

    const prev = current.drafts[current.drafts.length - 1];
    const gap = draft.startTimeMs - prev.endTimeMs;
    const crossDayGap =
      draft.localDateKey !== prev.localDateKey && gap > DAY_CROSS_GAP_MS;

    if (gap > JOURNEY_GAP_THRESHOLD_MS || crossDayGap) {
      flushCurrent();
      current = {
        drafts: [draft],
        originBoundaryName: lastBoundaryName,
      };
      lastBoundaryName = undefined;
    } else {
      current.drafts.push(draft);
    }
  }
  flushCurrent();

  // Fallback if all drafts were boundary visits without intermediate activities
  if (buckets.length === 0) {
    sortedDrafts.forEach((d, idx) => {
      buckets.push({ drafts: [d], originBoundaryName: d.visit?.name ?? `Stop ${idx + 1}` });
    });
  }

  const journeys: Trip[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const first = b.drafts[0];
    const trip = buildTripFromDrafts(
      b.drafts,
      `journey-${i}-${first.startTimeMs}`,
      first.localDateKey,
      b.originBoundaryName,
      b.destBoundaryName
    );
    if (trip) journeys.push(trip);
  }

  return journeys;
}

const SUBTYPE_LABELS: Record<ActivitySubtype, string> = {
  SUBWAY: 'Subway',
  TRAM: 'Tram',
  BUS: 'Bus',
  TRAIN: 'Train',
  WALKING: 'Walk',
  DRIVING: 'Driving',
  CYCLING: 'Cycling',
  FLYING: 'Flight',
  STILL: 'Stationary',
};

function computeLifetimeStats(dayTrips: Trip[], trips: Trip[]): LifetimeStats {
  const modeMap = new Map<ActivitySubtype, ModeBreakdownItem>();
  const locationMap = new Map<
    string,
    {
      coordKey: string;
      name: string;
      latSum: number;
      lngSum: number;
      count: number;
      totalDwellMs: number;
    }
  >();

  let totalDistanceM = 0;
  let totalDurationMs = 0;
  let totalVisits = 0;

  for (const day of dayTrips) {
    totalDistanceM += day.distanceM;
    totalDurationMs += day.durationMs;
    totalVisits += day.visits.length;

    for (const seg of day.segments) {
      if (seg.kind !== 'ACTIVITY') continue;
      const subtype = seg.subtype ?? classifyActivitySubtype(undefined, seg.mode);
      const existing = modeMap.get(subtype);
      if (existing) {
        existing.distanceM += seg.distanceM;
        existing.durationMs += seg.durationMs;
        existing.segmentCount += 1;
      } else {
        modeMap.set(subtype, {
          subtype,
          label: SUBTYPE_LABELS[subtype],
          mode: seg.mode,
          distanceM: seg.distanceM,
          durationMs: seg.durationMs,
          segmentCount: 1,
        });
      }
    }

    for (const v of day.visits) {
      const cellKey = `${v.lat.toFixed(3)},${v.lng.toFixed(3)}`;
      const existing = locationMap.get(cellKey);
      const isGeneric =
        !v.name ||
        v.name === 'Stop' ||
        v.name === 'Pinned Place' ||
        v.name.startsWith('Stop #');

      if (existing) {
        existing.latSum += v.lat;
        existing.lngSum += v.lng;
        existing.count += 1;
        existing.totalDwellMs += v.dwellDurationMs;
        if (
          !isGeneric &&
          (existing.name === 'Stop' ||
            existing.name === 'Pinned Place' ||
            existing.name.startsWith('Stop #'))
        ) {
          existing.name = v.name;
        }
      } else {
        locationMap.set(cellKey, {
          coordKey: `${v.lat.toFixed(4)},${v.lng.toFixed(4)}`,
          name: v.name || 'Stop',
          latSum: v.lat,
          lngSum: v.lng,
          count: 1,
          totalDwellMs: v.dwellDurationMs,
        });
      }
    }
  }

  const modeBreakdown = Array.from(modeMap.values()).sort(
    (a, b) => b.distanceM - a.distanceM
  );

  const topLocations: TopLocationItem[] = Array.from(locationMap.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.totalDwellMs - a.totalDwellMs;
    })
    .slice(0, 10)
    .map((loc) => ({
      coordKey: loc.coordKey,
      name: loc.name,
      lat: loc.latSum / loc.count,
      lng: loc.lngSum / loc.count,
      visitCount: loc.count,
      totalDwellMs: loc.totalDwellMs,
    }));

  return {
    totalDistanceM,
    totalDurationMs,
    totalTrips: trips.length,
    totalDays: dayTrips.length,
    totalVisits,
    modeBreakdown,
    topLocations,
  };
}

export function buildAllTimeHeatmapGeoJson(
  dayTrips: Trip[]
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  let totalMovingWaypoints = 0;

  for (const day of dayTrips) {
    for (const seg of day.segments) {
      if (seg.kind === 'ACTIVITY') {
        totalMovingWaypoints += Math.max(
          0,
          seg.endWaypointIndex - seg.startWaypointIndex + 1
        );
      }
    }
  }

  const heatPointStride = Math.max(1, Math.ceil(totalMovingWaypoints / 5000));
  let globalWpCounter = 0;

  for (const day of dayTrips) {
    for (const seg of day.segments) {
      if (seg.kind !== 'ACTIVITY') continue;
      const start = seg.startWaypointIndex;
      const end = Math.min(day.waypoints.length - 1, seg.endWaypointIndex);
      if (end - start < 1) continue;

      const count = end - start + 1;
      const lineStride = Math.max(1, Math.floor(count / 22));
      const coords: [number, number][] = [];

      for (let i = start; i <= end; i += lineStride) {
        const wp = day.waypoints[i];
        coords.push([wp.lng, wp.lat]);
      }
      const lastWp = day.waypoints[end];
      const tail = coords[coords.length - 1];
      if (!tail || tail[0] !== lastWp.lng || tail[1] !== lastWp.lat) {
        coords.push([lastWp.lng, lastWp.lat]);
      }

      if (coords.length >= 2) {
        features.push({
          type: 'Feature',
          properties: {
            kind: 'route',
            mode: seg.mode,
            color: MODE_COLORS[seg.mode],
          },
          geometry: {
            type: 'LineString',
            coordinates: coords,
          },
        });
      }

      for (let i = start; i <= end; i++) {
        if (globalWpCounter % heatPointStride === 0) {
          const wp = day.waypoints[i];
          features.push({
            type: 'Feature',
            properties: {
              kind: 'heat',
              weight: seg.mode === 'FLYING' ? 0.35 : 0.85,
            },
            geometry: {
              type: 'Point',
              coordinates: [wp.lng, wp.lat],
            },
          });
        }
        globalWpCounter++;
      }
    }

    for (const v of day.visits) {
      features.push({
        type: 'Feature',
        properties: {
          kind: 'heat',
          weight: 1.0,
        },
        geometry: {
          type: 'Point',
          coordinates: [v.lng, v.lat],
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
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

  onProgress?.(78, 'Building daily timelines & individual journeys...');

  const sortedDrafts = [...drafts].sort((a, b) => a.startTimeMs - b.startTimeMs);

  // 1. Group by Local Calendar Day (YYYY-MM-DD)
  const dayBuckets = new Map<string, RawSegmentDraft[]>();
  for (const draft of sortedDrafts) {
    const list = dayBuckets.get(draft.localDateKey);
    if (list) {
      list.push(draft);
    } else {
      dayBuckets.set(draft.localDateKey, [draft]);
    }
  }

  const dayTrips: Trip[] = [];
  const sortedDayKeys = Array.from(dayBuckets.keys()).sort((a, b) => a.localeCompare(b));
  for (const dateKey of sortedDayKeys) {
    const dayDrafts = dayBuckets.get(dateKey)!;
    const dayTrip = buildTripFromDrafts(dayDrafts, `day-${dateKey}`, dateKey);
    if (dayTrip) {
      dayTrips.push(dayTrip);
    }
  }

  // 2. Group into Individual Journeys (split on Home/Work or >45m dwell)
  const trips = buildIndividualJourneys(sortedDrafts);

  if (dayTrips.length === 0 && trips.length === 0) {
    throw new TimelineParseError('No valid trips could be constructed from this file.');
  }

  onProgress?.(90, 'Computing lifetime statistics & heatmap...');

  const yearMonthSet = new Set<string>();
  let totalWaypoints = 0;
  let totalVisits = 0;
  let totalDistanceM = 0;

  for (const dt of dayTrips) {
    yearMonthSet.add(dt.dateKey.slice(0, 7));
    totalWaypoints += dt.waypoints.length;
    totalVisits += dt.visits.length;
    totalDistanceM += dt.distanceM;
  }
  for (const t of trips) {
    yearMonthSet.add(t.dateKey.slice(0, 7));
  }

  const yearMonths = Array.from(yearMonthSet).sort((a, b) => b.localeCompare(a));

  const stats = {
    schema,
    totalInputRecords: inputCount,
    totalWaypoints,
    filteredSpikes,
    totalTrips: trips.length,
    totalDays: dayTrips.length,
    totalVisits,
    totalDistanceM,
    parseDurationMs: Math.round(performance.now() - startPerfMs),
  };

  const lifetimeStats = computeLifetimeStats(dayTrips, trips);
  const heatmapGeoJson = buildAllTimeHeatmapGeoJson(dayTrips);

  const index: TimelineSummaryIndex = {
    days: dayTrips.map((t) => summarizeTrip(t, 'DAY')),
    journeys: trips.map((t) => summarizeTrip(t, 'JOURNEY')),
    yearMonths,
    stats,
    lifetimeStats,
  };

  onProgress?.(100, 'Timeline ready');

  return {
    dayTrips,
    trips,
    index,
    stats,
    heatmapGeoJson,
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
