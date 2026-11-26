import type { TimelineSchemaFormat, UnitSystem } from '../types/timeline';

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;
const KMH_TO_MPH = 0.621371;

export function formatDistance(
  meters: number,
  units: UnitSystem = 'METRIC'
): string {
  if (!Number.isFinite(meters) || meters <= 0) {
    return units === 'IMPERIAL' ? '0 ft' : '0 m';
  }

  if (units === 'IMPERIAL') {
    const miles = meters / METERS_PER_MILE;
    if (miles < 0.2) {
      return `${Math.round(meters / METERS_PER_FOOT).toLocaleString()} ft`;
    }
    if (miles < 10) {
      return `${miles.toFixed(2)} mi`;
    }
    if (miles < 100) {
      return `${miles.toFixed(1)} mi`;
    }
    return `${Math.round(miles).toLocaleString()} mi`;
  }

  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = meters / 1000;
  if (km < 10) {
    return `${km.toFixed(2)} km`;
  }
  if (km < 100) {
    return `${km.toFixed(1)} km`;
  }
  return `${Math.round(km).toLocaleString()} km`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSec = Math.round(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  if (mins > 0) {
    return secs > 0 && mins < 5 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  return `${secs}s`;
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function formatShortTime(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateKeyLabel(dateKey: string): string {
  const parts = dateKey.split('-');
  if (parts.length !== 3) return dateKey;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return dateKey;
  }
  const local = new Date(y, m - 1, d);
  return local.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatYearMonthLabel(yearMonth: string): string {
  const parts = yearMonth.split('-');
  if (parts.length !== 2) return yearMonth;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yearMonth;
  const local = new Date(y, m - 1, 1);
  return local.toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  });
}

export function formatSpeed(
  kmh: number,
  units: UnitSystem = 'METRIC'
): string {
  if (!Number.isFinite(kmh) || kmh < 0.5) return '0';
  const value = units === 'IMPERIAL' ? kmh * KMH_TO_MPH : kmh;
  if (value < 0.5) return '0';
  if (value < 10) return value.toFixed(1);
  return String(Math.round(value));
}

export function getSpeedUnitLabel(units: UnitSystem = 'METRIC'): string {
  return units === 'IMPERIAL' ? 'mph' : 'km/h';
}

export function formatHours(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0.0h';
  const hours = ms / 3_600_000;
  if (hours < 10) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours).toLocaleString()}h`;
}

export function formatSchemaName(schema: TimelineSchemaFormat): string {
  switch (schema) {
    case 'ON_DEVICE_TIMELINE':
      return 'On-Device Timeline.json';
    case 'SEMANTIC_HISTORY':
      return 'Semantic Location History';
    case 'RAW_RECORDS':
      return 'Raw Records.json';
    default:
      return 'Unknown Format';
  }
}
