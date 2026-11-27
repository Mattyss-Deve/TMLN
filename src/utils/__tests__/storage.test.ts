import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../settings';
import {
  loadTimelineFromIndexedDB,
  toggleStarredTripId,
} from '../storage';

describe('Versioning & Starred Discovery Storage', () => {
  it('exports semantic APP_VERSION matching v1.2.0', () => {
    expect(APP_VERSION).toBe('v1.2.0');
  });

  it('toggles starred trip IDs idempotently and prepends newly starred items', () => {
    const a = toggleStarredTripId([], 'day-2024-10-17');
    expect(a).toEqual(['day-2024-10-17']);

    const b = toggleStarredTripId(a, 'day-2024-10-18');
    expect(b).toEqual(['day-2024-10-18', 'day-2024-10-17']);

    const c = toggleStarredTripId(b, 'day-2024-10-17');
    expect(c).toEqual(['day-2024-10-18']);
  });

  it('gracefully returns null from IndexedDB loader when IndexedDB is unavailable', async () => {
    const restored = await loadTimelineFromIndexedDB();
    expect(restored).toBeNull();
  });
});
