import type { PlaceVisit } from '../types/timeline';

const NICKNAME_STORAGE_KEY = 'chronomap.nicknames.v1';
const GEOCODE_STORAGE_KEY = 'chronomap.geocodeCache.v1';
const REQUEST_INTERVAL_MS = 1100;

export function getCoordKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

export function isGenericVisitName(name?: string): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  return (
    trimmed === 'Stop' ||
    trimmed === 'Pinned Place' ||
    trimmed === 'Visited Place' ||
    trimmed === 'Stationary Dwell' ||
    trimmed.startsWith('Stop #')
  );
}

export function loadNicknames(): Record<string, string> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(NICKNAME_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveNickname(
  lat: number,
  lng: number,
  nickname: string
): Record<string, string> {
  const current = loadNicknames();
  const key = getCoordKey(lat, lng);
  const trimmed = nickname.trim();
  const next = { ...current };
  if (trimmed) {
    next[key] = trimmed;
  } else {
    delete next[key];
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(NICKNAME_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota errors
    }
  }
  return next;
}

export function loadGeocodeCache(): Record<string, string> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(GEOCODE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function persistGeocodeEntry(coordKey: string, label: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const cache = loadGeocodeCache();
    cache[coordKey] = label;
    // Cap stored cache cleanly around 2,000 entries
    const keys = Object.keys(cache);
    if (keys.length > 2000) {
      for (const oldKey of keys.slice(0, keys.length - 2000)) {
        delete cache[oldKey];
      }
    }
    window.localStorage.setItem(GEOCODE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore quota errors
  }
}

export function resolveVisitDisplayName(
  visit: Pick<PlaceVisit, 'name' | 'lat' | 'lng'>,
  nicknames: Record<string, string>,
  geocodeCache: Record<string, string>
): string {
  const key = getCoordKey(visit.lat, visit.lng);
  if (nicknames[key]) {
    return nicknames[key];
  }
  if (!isGenericVisitName(visit.name)) {
    return visit.name;
  }
  if (geocodeCache[key]) {
    return geocodeCache[key];
  }
  return visit.name || 'Stop';
}

interface NominatimResponse {
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
}

export function formatNominatimLabel(data: NominatimResponse): string | null {
  if (!data || typeof data !== 'object') return null;
  const addr = data.address ?? {};
  const namedFeature =
    data.name?.trim() ||
    addr.amenity ||
    addr.shop ||
    addr.tourism ||
    addr.leisure ||
    addr.building;
  const street = addr.road
    ? addr.house_number
      ? `${addr.road} ${addr.house_number}`
      : addr.road
    : '';
  const locality =
    addr.neighbourhood || addr.suburb || addr.city || addr.town || addr.village || '';

  if (namedFeature && locality) {
    return namedFeature === locality ? namedFeature : `${namedFeature} · ${locality}`;
  }
  if (namedFeature) return namedFeature;
  if (street && locality) return `${street}, ${locality}`;
  if (street) return street;
  if (locality) return locality;

  if (typeof data.display_name === 'string' && data.display_name.trim()) {
    return data.display_name
      .split(',')
      .slice(0, 2)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(', ');
  }

  return null;
}

interface QueueItem {
  coordKey: string;
  lat: number;
  lng: number;
}

export class ReverseGeocoderQueue {
  private queue: QueueItem[] = [];
  private queuedKeys = new Set<string>();
  private timerId: number | null = null;
  private lastRequestAtMs = 0;
  private isProcessing = false;
  private destroyed = false;
  private onResolved: (coordKey: string, name: string) => void;

  constructor(onResolved: (coordKey: string, name: string) => void) {
    this.onResolved = onResolved;
  }

  public enqueue(
    visits: PlaceVisit[],
    nicknames: Record<string, string>,
    geocodeCache: Record<string, string>
  ): void {
    if (this.destroyed) return;

    for (const visit of visits) {
      const key = getCoordKey(visit.lat, visit.lng);
      if (nicknames[key] || geocodeCache[key] || !isGenericVisitName(visit.name)) {
        continue;
      }
      if (this.queuedKeys.has(key)) continue;
      this.queuedKeys.add(key);
      this.queue.push({ coordKey: key, lat: visit.lat, lng: visit.lng });
    }

    this.scheduleNext();
  }

  public clear(): void {
    this.queue = [];
    this.queuedKeys.clear();
    if (this.timerId !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  public destroy(): void {
    this.destroyed = true;
    this.clear();
  }

  private scheduleNext(): void {
    if (
      this.destroyed ||
      this.isProcessing ||
      this.timerId !== null ||
      this.queue.length === 0 ||
      typeof window === 'undefined'
    ) {
      return;
    }

    const elapsed = Date.now() - this.lastRequestAtMs;
    const waitMs = Math.max(0, REQUEST_INTERVAL_MS - elapsed);

    this.timerId = window.setTimeout(() => {
      this.timerId = null;
      void this.processNext();
    }, waitMs);
  }

  private async processNext(): Promise<void> {
    if (this.destroyed || this.isProcessing || this.queue.length === 0) return;

    const item = this.queue.shift();
    if (!item) return;
    this.queuedKeys.delete(item.coordKey);

    this.isProcessing = true;
    this.lastRequestAtMs = Date.now();

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        item.lat.toFixed(6)
      )}&lon=${encodeURIComponent(item.lng.toFixed(6))}&zoom=18&addressdetails=1`;

      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (res.ok) {
        const json = (await res.json()) as NominatimResponse;
        const label = formatNominatimLabel(json);
        if (label && !this.destroyed) {
          persistGeocodeEntry(item.coordKey, label);
          this.onResolved(item.coordKey, label);
        }
      }
    } catch {
      // Network or rate-limit failure; keep fallback gracefully
    } finally {
      this.isProcessing = false;
      this.scheduleNext();
    }
  }
}
