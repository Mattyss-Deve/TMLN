import { describe, expect, it } from 'vitest';
import { createSampleTimelineJson } from '../../data/sampleJourney';
import {
  parseGeoString,
  parseTimelineJson,
  parseTimelineText,
  TimelineParseError,
} from '../timelineParser';

describe('parseGeoString', () => {
  it('parses geo:lat,lng and degree-formatted coordinate strings', () => {
    expect(parseGeoString('geo:37.7955,-122.3937')).toEqual({
      lat: 37.7955,
      lng: -122.3937,
    });
    expect(parseGeoString('37.7955°, -122.3937°')).toEqual({
      lat: 37.7955,
      lng: -122.3937,
    });
    expect(parseGeoString('geo:0,0')).toBeNull();
    expect(parseGeoString('not-a-coord')).toBeNull();
  });
});

describe('timelineParser multi-schema support', () => {
  it('parses New On-Device Timeline.json (semanticSegments)', () => {
    const payload = {
      semanticSegments: [
        {
          startTime: '2025-06-01T09:00:00.000Z',
          endTime: '2025-06-01T09:20:00.000Z',
          visit: {
            topCandidate: {
              placeName: 'Blue Bottle Ferry Building',
              semanticType: 'CAFE',
              placeLocation: { latLng: 'geo:37.7955,-122.3937' },
            },
          },
        },
        {
          startTime: '2025-06-01T09:20:00.000Z',
          endTime: '2025-06-01T09:35:00.000Z',
          timelinePath: [
            { point: 'geo:37.7955,-122.3937', time: '2025-06-01T09:20:00.000Z' },
            { point: 'geo:37.7935,-122.3960', time: '2025-06-01T09:28:00.000Z' },
            { point: 'geo:37.7915,-122.3990', time: '2025-06-01T09:35:00.000Z' },
          ],
          activity: {
            start: { latLng: 'geo:37.7955,-122.3937' },
            end: { latLng: 'geo:37.7915,-122.3990' },
            distanceMeters: 640,
            topCandidate: { type: 'WALKING' },
          },
        },
      ],
    };

    const result = parseTimelineJson(payload);
    expect(result.stats.schema).toBe('ON_DEVICE_TIMELINE');
    expect(result.trips).toHaveLength(1);
    expect(result.trips[0].visits).toHaveLength(1);
    expect(result.trips[0].visits[0].name).toBe('Blue Bottle Ferry Building');
    expect(result.trips[0].modes).toContain('WALKING');
    expect(result.trips[0].distanceM).toBeGreaterThan(500);
  });

  it('parses Classic Semantic Location History (timelineObjects with E7 coords)', () => {
    const payload = {
      timelineObjects: [
        {
          placeVisit: {
            location: {
              latitudeE7: 377955000,
              longitudeE7: -1223937000,
              name: 'San Francisco Ferry Terminal',
              address: '1 Ferry Building, San Francisco, CA',
            },
            duration: {
              startTimestamp: '2024-09-12T10:00:00.000Z',
              endTimestamp: '2024-09-12T10:15:00.000Z',
            },
          },
        },
        {
          activitySegment: {
            startLocation: { latitudeE7: 377955000, longitudeE7: -1223937000 },
            endLocation: { latitudeE7: 378048000, longitudeE7: -1222584000 },
            duration: {
              startTimestamp: '2024-09-12T10:15:00.000Z',
              endTimestamp: '2024-09-12T10:35:00.000Z',
            },
            distance: 12100,
            activityType: 'IN_SUBWAY',
            waypointPath: {
              waypoints: [
                { latE7: 377980000, lngE7: -1223500000 },
                { latE7: 378020000, lngE7: -1223000000 },
              ],
            },
          },
        },
      ],
    };

    const result = parseTimelineJson(payload);
    expect(result.stats.schema).toBe('SEMANTIC_HISTORY');
    expect(result.trips).toHaveLength(1);
    expect(result.trips[0].modes).toContain('TRANSIT');
    expect(result.trips[0].visits[0].name).toBe('San Francisco Ferry Terminal');
    expect(result.trips[0].waypoints.length).toBeGreaterThanOrEqual(4);
    expect(result.trips[0].distanceM).toBeGreaterThan(10_000);
  });

  it('parses Raw Records.json and filters impossible >1200 km/h GPS teleportation spikes', () => {
    const baseMs = Date.parse('2024-11-05T14:00:00.000Z');
    const payload = {
      locations: [
        // Stationary dwell (5 minutes)
        {
          latitudeE7: 377749000,
          longitudeE7: -1224194000,
          timestampMs: String(baseMs),
        },
        {
          latitudeE7: 377749100,
          longitudeE7: -1224194100,
          timestampMs: String(baseMs + 5 * 60_000),
        },
        // Moving drive points
        {
          latitudeE7: 377800000,
          longitudeE7: -1224194000,
          timestampMs: String(baseMs + 7 * 60_000),
          activity: [{ activity: [{ type: 'IN_VEHICLE', confidence: 92 }] }],
        },
        // GPS SPIKE: instant jump to Tokyo 10 seconds later (> 3,000,000 km/h!)
        {
          latitudeE7: 356762000,
          longitudeE7: 1396503000,
          timestampMs: String(baseMs + 7 * 60_000 + 10_000),
          activity: [{ activity: [{ type: 'IN_VEHICLE', confidence: 60 }] }],
        },
        {
          latitudeE7: 377860000,
          longitudeE7: -1224194000,
          timestampMs: String(baseMs + 9 * 60_000),
          activity: [{ activity: [{ type: 'IN_VEHICLE', confidence: 95 }] }],
        },
      ],
    };

    const result = parseTimelineJson(payload);
    expect(result.stats.schema).toBe('RAW_RECORDS');
    expect(result.stats.filteredSpikes).toBe(1);
    expect(result.trips[0].visits).toHaveLength(1);
    expect(result.trips[0].modes).toContain('DRIVING');
    // Ensure Tokyo coordinate was removed
    expect(result.trips[0].waypoints.every((w) => w.lng < 0)).toBe(true);
  });

  it('parses the built-in multi-modal Sample Journey cleanly', () => {
    const sampleJson = createSampleTimelineJson();
    const result = parseTimelineText(sampleJson);

    expect(result.stats.schema).toBe('ON_DEVICE_TIMELINE');
    expect(result.trips.length).toBe(2);
    expect(result.days.length).toBe(2);
    expect(result.stats.filteredSpikes).toBe(0);

    const allModes = new Set(result.trips.flatMap((t) => t.modes));
    expect(allModes.has('WALKING')).toBe(true);
    expect(allModes.has('TRANSIT')).toBe(true);
    expect(allModes.has('DRIVING')).toBe(true);
    expect(allModes.has('CYCLING')).toBe(true);
    expect(allModes.has('FLYING')).toBe(true);
    expect(allModes.has('STILL')).toBe(true);
  });

  it('throws descriptive TimelineParseError on malformed or unsupported JSON', () => {
    expect(() => parseTimelineText('')).toThrow(TimelineParseError);
    expect(() => parseTimelineText('{ broken json')).toThrow(TimelineParseError);
    expect(() => parseTimelineJson({ unrelated: [] })).toThrow(TimelineParseError);
    expect(() => parseTimelineJson({ semanticSegments: [] })).toThrow(
      TimelineParseError
    );
  });
});
