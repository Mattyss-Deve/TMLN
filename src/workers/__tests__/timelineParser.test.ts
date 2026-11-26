import { describe, expect, it } from 'vitest';
import { createSampleTimelineJson } from '../../data/sampleJourney';
import {
  extractLocalDateKey,
  mapVisitSemanticType,
  parseGeoString,
  parseTimelineJson,
  parseTimelineText,
  TimelineParseError,
} from '../timelineParser';

describe('parseGeoString & semantic helpers', () => {
  it('parses geo:lat,lng and degree-formatted coordinate strings', () => {
    expect(parseGeoString('geo:37.7955,-122.3937')).toEqual({
      lat: 37.7955,
      lng: -122.3937,
    });
    expect(parseGeoString('50.1254943°, 14.4973446°')).toEqual({
      lat: 50.1254943,
      lng: 14.4973446,
    });
    expect(parseGeoString('geo:0,0')).toBeNull();
    expect(parseGeoString('not-a-coord')).toBeNull();
  });

  it('maps Google semanticType labels and preserves timestamp offset local dates', () => {
    expect(mapVisitSemanticType('INFERRED_HOME')).toBe('Home');
    expect(mapVisitSemanticType('WORK')).toBe('Work');
    expect(mapVisitSemanticType('SEARCHED_ADDRESS')).toBe('Pinned Place');
    expect(mapVisitSemanticType('UNKNOWN')).toBe('Stop');
    expect(mapVisitSemanticType(undefined)).toBe('Stop');

    expect(
      extractLocalDateKey('2024-06-15T23:45:00.000+02:00', Date.now())
    ).toBe('2024-06-15');
  });
});

describe('timelineParser multi-schema support & Android reconciliation', () => {
  it('reconciles overlapping Android 2-hour timelinePath blocks, degree coords, hierarchyLevel, and distanceMeters without spiderwebs', () => {
    const payload = {
      semanticSegments: [
        // 2-hour raw timelinePath block covering Home stay + commute + Work stay
        {
          startTime: '2024-06-15T07:00:00.000+02:00',
          endTime: '2024-06-15T09:00:00.000+02:00',
          timelinePath: [
            // Stationary GPS jitter inside Home visit (07:15 -> should be discarded!)
            { point: '50.1450000°, 14.5200000°', time: '2024-06-15T07:15:00.000+02:00' },
            { point: '50.1254943°, 14.4973446°', time: '2024-06-15T07:30:00.000+02:00' },
            // Real walking point inside walking activity (08:04)
            { point: '50.1268000°, 14.4988000°', time: '2024-06-15T08:04:00.000+02:00' },
            // Real transit point inside tram activity (08:20)
            { point: '50.1050000°, 14.4500000°', time: '2024-06-15T08:20:00.000+02:00' },
            // Stationary jitter during Work stay (08:50 -> should be discarded!)
            { point: '50.0990000°, 14.4200000°', time: '2024-06-15T08:50:00.000+02:00' },
          ],
        },
        // Home visit (hierarchyLevel 0)
        {
          startTime: '2024-06-15T07:00:00.000+02:00',
          endTime: '2024-06-15T08:00:00.000+02:00',
          visit: {
            hierarchyLevel: 0,
            topCandidate: {
              semanticType: 'INFERRED_HOME',
              placeLocation: { latLng: '50.1254943°, 14.4973446°' },
            },
          },
        },
        // Nested sub-visit inside same Home block (hierarchyLevel 1 -> must be ignored!)
        {
          startTime: '2024-06-15T07:05:00.000+02:00',
          endTime: '2024-06-15T07:55:00.000+02:00',
          visit: {
            hierarchyLevel: 1,
            topCandidate: {
              semanticType: 'UNKNOWN',
              placeLocation: { latLng: '50.1256000°, 14.4974000°' },
            },
          },
        },
        // Walking leg to tram stop
        {
          startTime: '2024-06-15T08:00:00.000+02:00',
          endTime: '2024-06-15T08:10:00.000+02:00',
          activity: {
            start: { latLng: '50.1254943°, 14.4973446°' },
            end: { latLng: '50.1280000°, 14.4995000°' },
            distanceMeters: 480,
            topCandidate: { type: 'WALKING' },
          },
        },
        // Tram leg to Work
        {
          startTime: '2024-06-15T08:10:00.000+02:00',
          endTime: '2024-06-15T08:32:00.000+02:00',
          activity: {
            start: { latLng: '50.1280000°, 14.4995000°' },
            end: { latLng: '50.0880000°, 14.4200000°' },
            distanceMeters: 7420,
            topCandidate: { type: 'IN_TRAM' },
          },
        },
        // Work visit (splits commute from evening journey)
        {
          startTime: '2024-06-15T08:32:00.000+02:00',
          endTime: '2024-06-15T17:00:00.000+02:00',
          visit: {
            hierarchyLevel: 0,
            topCandidate: {
              semanticType: 'WORK',
              placeLocation: { latLng: '50.0880000°, 14.4200000°' },
            },
          },
        },
        // Evening drive to Pinned Place
        {
          startTime: '2024-06-15T17:00:00.000+02:00',
          endTime: '2024-06-15T17:25:00.000+02:00',
          activity: {
            start: { latLng: '50.0880000°, 14.4200000°' },
            end: { latLng: '50.1010000°, 14.4600000°' },
            distanceMeters: 3900,
            topCandidate: { type: 'IN_PASSENGER_VEHICLE' },
          },
        },
        {
          startTime: '2024-06-15T17:25:00.000+02:00',
          endTime: '2024-06-15T17:45:00.000+02:00',
          visit: {
            hierarchyLevel: 0,
            topCandidate: {
              semanticType: 'SEARCHED_ADDRESS',
              placeLocation: { latLng: '50.1010000°, 14.4600000°' },
            },
          },
        },
      ],
    };

    const result = parseTimelineJson(payload);
    expect(result.stats.schema).toBe('ON_DEVICE_TIMELINE');

    // Local calendar day view groups the whole day cleanly under 2024-06-15
    expect(result.dayTrips).toHaveLength(1);
    const day = result.dayTrips[0];
    expect(day.dateKey).toBe('2024-06-15');
    // hierarchyLevel=1 visit was ignored -> only Home, Work, Pinned Place
    expect(day.visits.map((v) => v.name)).toEqual(['Home', 'Work', 'Pinned Place']);
    // Exact distanceMeters sum: 480 + 7420 + 3900 = 11800
    expect(day.distanceM).toBeCloseTo(11800, 1);
    // Jitter point at (50.145, 14.52) inside Home visit was discarded!
    expect(day.waypoints.some((w) => Math.abs(w.lat - 50.145) < 0.001)).toBe(false);
    // No duplicate raw timelinePath legs created
    expect(day.segments).toHaveLength(6);

    // Individual Journeys split around Home and Work visits
    expect(result.trips).toHaveLength(2);
    expect(result.trips[0].title).toBe('Home → Work');
    expect(result.trips[0].distanceM).toBeCloseTo(480 + 7420, 1);
    expect(result.trips[0].modes).toContain('WALKING');
    expect(result.trips[0].modes).toContain('TRANSIT');

    expect(result.trips[1].title).toBe('Work → Pinned Place');
    expect(result.trips[1].distanceM).toBeCloseTo(3900, 1);
    expect(result.trips[1].modes).toContain('DRIVING');

    // Lightweight summary index contains metadata only (no waypoints)
    expect(result.index.days).toHaveLength(1);
    expect(result.index.journeys).toHaveLength(2);
    expect(result.index.yearMonths).toEqual(['2024-06']);
    expect('waypoints' in result.index.days[0]).toBe(false);
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
    expect(result.trips[0].distanceM).toBeCloseTo(12100, 1);
  });

  it('parses Raw Records.json and filters impossible >1200 km/h GPS teleportation spikes', () => {
    const baseMs = Date.parse('2024-11-05T14:00:00.000Z');
    const payload = {
      locations: [
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
        {
          latitudeE7: 377800000,
          longitudeE7: -1224194000,
          timestampMs: String(baseMs + 7 * 60_000),
          activity: [{ activity: [{ type: 'IN_VEHICLE', confidence: 92 }] }],
        },
        // GPS SPIKE: instant jump to Tokyo 10 seconds later
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
    expect(result.trips[0].waypoints.every((w) => w.lng < 0)).toBe(true);
  });

  it('parses the built-in multi-modal Sample Journey cleanly into 2 local days and 2 journeys', () => {
    const sampleJson = createSampleTimelineJson();
    const result = parseTimelineText(sampleJson);

    expect(result.stats.schema).toBe('ON_DEVICE_TIMELINE');
    expect(result.dayTrips).toHaveLength(2);
    expect(result.trips).toHaveLength(2);
    expect(result.index.days).toHaveLength(2);
    expect(result.index.journeys).toHaveLength(2);
    expect(result.index.days.map((d) => d.dateKey)).toEqual([
      '2025-10-18',
      '2025-10-19',
    ]);
    expect(result.stats.filteredSpikes).toBe(0);

    const allModes = new Set(result.dayTrips.flatMap((t) => t.modes));
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
