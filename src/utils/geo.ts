import type { TransportMode, Waypoint } from '../types/timeline';

const EARTH_RADIUS_M = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export const MODE_COLORS: Record<TransportMode, string> = {
  DRIVING: '#22d3ee', // cyan-400
  WALKING: '#34d399', // emerald-400
  CYCLING: '#a3e635', // lime-400
  TRANSIT: '#fbbf24', // amber-400
  FLYING: '#a78bfa', // violet-400
  STILL: '#94a3b8', // slate-400
};

export const MODE_LABELS: Record<TransportMode, string> = {
  DRIVING: 'Driving',
  WALKING: 'Walking',
  CYCLING: 'Cycling',
  TRANSIT: 'Transit',
  FLYING: 'Flying',
  STILL: 'Stationary',
};

export const MODE_ORDER: TransportMode[] = [
  'WALKING',
  'CYCLING',
  'DRIVING',
  'TRANSIT',
  'FLYING',
  'STILL',
];

export function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6)
  );
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const a =
    sinLat * sinLat + Math.cos(phi1) * Math.cos(phi2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));

  return EARTH_RADIUS_M * c;
}

export function computeBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (Math.abs(lat2 - lat1) < 1e-9 && Math.abs(lng2 - lng1) < 1e-9) {
    return 0;
  }
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const dLambda = (lng2 - lng1) * DEG_TO_RAD;

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);

  const theta = Math.atan2(y, x);
  return ((theta * RAD_TO_DEG) % 360 + 360) % 360;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Interpolate between two compass bearings (0..360) along the shortest circular arc.
 */
export function lerpAngle(a: number, b: number, t: number): number {
  const diff = (((b - a) % 360) + 540) % 360 - 180;
  return (((a + diff * t) % 360) + 360) % 360;
}

export function angleDelta(a: number, b: number): number {
  return (((b - a) % 360) + 540) % 360 - 180;
}

export function computeBounds(
  waypoints: Pick<Waypoint, 'lat' | 'lng'>[]
): [[number, number], [number, number]] {
  if (waypoints.length === 0) {
    return [
      [-122.45, 37.75],
      [-122.38, 37.81],
    ];
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const wp of waypoints) {
    if (wp.lng < minLng) minLng = wp.lng;
    if (wp.lng > maxLng) maxLng = wp.lng;
    if (wp.lat < minLat) minLat = wp.lat;
    if (wp.lat > maxLat) maxLat = wp.lat;
  }

  // Pad degenerate single-point or very short routes so fitBounds zooms comfortably
  const minSpan = 0.008;
  if (maxLng - minLng < minSpan) {
    const pad = (minSpan - (maxLng - minLng)) / 2;
    minLng -= pad;
    maxLng += pad;
  }
  if (maxLat - minLat < minSpan) {
    const pad = (minSpan - (maxLat - minLat)) / 2;
    minLat -= pad;
    maxLat += pad;
  }

  return [
    [clamp(minLng, -180, 180), clamp(minLat, -85, 85)],
    [clamp(maxLng, -180, 180), clamp(maxLat, -85, 85)],
  ];
}
