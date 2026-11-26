import { haversineMeters, lerp } from '../utils/geo';

interface AnchorPoint {
  lat: number;
  lng: number;
}

interface PathPointJson {
  point: string;
  time: string;
}

/**
 * Generates densely sampled points along a polyline with smooth ease-in/out velocity
 * so the 60fps animation engine renders realistic acceleration and cornering.
 */
function buildTimedPolyline(
  anchors: AnchorPoint[],
  startIso: string,
  endIso: string,
  samplesPerSegment = 6
): { timelinePath: PathPointJson[]; distanceMeters: number } {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);

  const dense: AnchorPoint[] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const prev = anchors[Math.max(0, i - 1)];
    const next = anchors[Math.min(anchors.length - 1, i + 2)];

    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      // Catmull-Rom spline for gentle, organic path curvature
      const t2 = t * t;
      const t3 = t2 * t;
      const lat =
        0.5 *
        (2 * a.lat +
          (-prev.lat + b.lat) * t +
          (2 * prev.lat - 5 * a.lat + 4 * b.lat - next.lat) * t2 +
          (-prev.lat + 3 * a.lat - 3 * b.lat + next.lat) * t3);
      const lng =
        0.5 *
        (2 * a.lng +
          (-prev.lng + b.lng) * t +
          (2 * prev.lng - 5 * a.lng + 4 * b.lng - next.lng) * t2 +
          (-prev.lng + 3 * a.lng - 3 * b.lng + next.lng) * t3);
      dense.push({ lat, lng });
    }
  }
  dense.push(anchors[anchors.length - 1]);

  const cumDist: number[] = [0];
  for (let i = 1; i < dense.length; i++) {
    cumDist.push(
      cumDist[i - 1] +
        haversineMeters(dense[i - 1].lat, dense[i - 1].lng, dense[i].lat, dense[i].lng)
    );
  }
  const totalDist = cumDist[cumDist.length - 1] || 1;

  // Apply gentle ease-in/out mapping on normalized distance -> timestamp
  const timelinePath: PathPointJson[] = dense.map((pt, idx) => {
    const dRatio = cumDist[idx] / totalDist;
    // Blend linear + cosine ease so departure and arrival decelerate naturally
    const eased = 0.72 * dRatio + 0.28 * (0.5 - 0.5 * Math.cos(Math.PI * dRatio));
    const ts = Math.round(lerp(startMs, endMs, eased));
    return {
      point: `geo:${pt.lat.toFixed(6)},${pt.lng.toFixed(6)}`,
      time: new Date(ts).toISOString(),
    };
  });

  return {
    timelinePath,
    distanceMeters: Math.round(totalDist),
  };
}

function buildVisitSegment(
  name: string,
  semanticType: string,
  coord: AnchorPoint,
  startTime: string,
  endTime: string
) {
  return {
    startTime,
    endTime,
    visit: {
      hierarchyLevel: 0,
      probability: 0.96,
      topCandidate: {
        placeName: name,
        semanticType,
        probability: 0.94,
        placeLocation: {
          latLng: `geo:${coord.lat.toFixed(6)},${coord.lng.toFixed(6)}`,
        },
      },
    },
  };
}

function buildActivitySegment(
  type: 'WALKING' | 'IN_TRAIN' | 'IN_PASSENGER_VEHICLE' | 'CYCLING' | 'FLYING',
  anchors: AnchorPoint[],
  startTime: string,
  endTime: string,
  samplesPerSegment = 6
) {
  const { timelinePath, distanceMeters } = buildTimedPolyline(
    anchors,
    startTime,
    endTime,
    samplesPerSegment
  );
  const first = anchors[0];
  const last = anchors[anchors.length - 1];

  return {
    startTime,
    endTime,
    timelinePath,
    activity: {
      start: { latLng: `geo:${first.lat.toFixed(6)},${first.lng.toFixed(6)}` },
      end: { latLng: `geo:${last.lat.toFixed(6)},${last.lng.toFixed(6)}` },
      distanceMeters,
      topCandidate: {
        type,
        probability: 0.95,
      },
    },
  };
}

/**
 * Generates a realistic multi-day, multi-modal Google On-Device Timeline.json dataset
 * spanning San Francisco, Oakland, Marin Headlands, Tiburon, and Los Angeles.
 */
export function createSampleTimelineJson(): string {
  const semanticSegments = [
    // --- DAY 1: Bay Area Multi-Modal Journey (2025-10-18) ---
    buildVisitSegment(
      'Ferry Building Marketplace',
      'MARKETPLACE',
      { lat: 37.7955, lng: -122.3937 },
      '2025-10-18T08:30:00.000-07:00',
      '2025-10-18T08:48:00.000-07:00'
    ),
    buildActivitySegment(
      'WALKING',
      [
        { lat: 37.7955, lng: -122.3937 },
        { lat: 37.7946, lng: -122.3949 },
        { lat: 37.7937, lng: -122.396 },
        { lat: 37.7929, lng: -122.397 },
      ],
      '2025-10-18T08:48:00.000-07:00',
      '2025-10-18T08:56:00.000-07:00',
      5
    ),
    buildActivitySegment(
      'IN_TRAIN',
      [
        { lat: 37.7929, lng: -122.397 },
        { lat: 37.7975, lng: -122.371 },
        { lat: 37.8015, lng: -122.338 },
        { lat: 37.8049, lng: -122.2951 },
        { lat: 37.8037, lng: -122.2715 },
        { lat: 37.7975, lng: -122.2651 },
        { lat: 37.8018, lng: -122.2612 },
        { lat: 37.8048, lng: -122.2584 },
      ],
      '2025-10-18T08:56:00.000-07:00',
      '2025-10-18T09:14:00.000-07:00',
      6
    ),
    buildVisitSegment(
      'Lake Merritt Boathouse',
      'PARK',
      { lat: 37.8048, lng: -122.2584 },
      '2025-10-18T09:14:00.000-07:00',
      '2025-10-18T09:38:00.000-07:00'
    ),
    buildActivitySegment(
      'IN_PASSENGER_VEHICLE',
      [
        { lat: 37.8048, lng: -122.2584 },
        { lat: 37.8138, lng: -122.288 },
        { lat: 37.8234, lng: -122.3175 },
        { lat: 37.8195, lng: -122.354 },
        { lat: 37.8108, lng: -122.3695 },
        { lat: 37.7958, lng: -122.3855 },
        { lat: 37.7896, lng: -122.3948 },
        { lat: 37.8022, lng: -122.4058 },
        { lat: 37.8075, lng: -122.4235 },
        { lat: 37.805, lng: -122.4485 },
        { lat: 37.8035, lng: -122.469 },
        { lat: 37.8125, lng: -122.4782 },
        { lat: 37.8265, lng: -122.4795 },
        { lat: 37.8322, lng: -122.4848 },
        { lat: 37.8294, lng: -122.4926 },
        { lat: 37.827, lng: -122.4994 },
      ],
      '2025-10-18T09:38:00.000-07:00',
      '2025-10-18T10:22:00.000-07:00',
      5
    ),
    buildVisitSegment(
      'Marin Headlands Overlook',
      'SCENIC_LOOKOUT',
      { lat: 37.827, lng: -122.4994 },
      '2025-10-18T10:22:00.000-07:00',
      '2025-10-18T10:42:00.000-07:00'
    ),
    buildActivitySegment(
      'CYCLING',
      [
        { lat: 37.827, lng: -122.4994 },
        { lat: 37.8336, lng: -122.4872 },
        { lat: 37.8482, lng: -122.482 },
        { lat: 37.8588, lng: -122.4798 },
        { lat: 37.871, lng: -122.4945 },
        { lat: 37.8842, lng: -122.5135 },
        { lat: 37.8952, lng: -122.5015 },
        { lat: 37.8895, lng: -122.4875 },
        { lat: 37.8812, lng: -122.4718 },
        { lat: 37.8726, lng: -122.4561 },
      ],
      '2025-10-18T10:42:00.000-07:00',
      '2025-10-18T11:10:00.000-07:00',
      6
    ),
    buildVisitSegment(
      'Tiburon Shoreline Pier',
      'WATERFRONT',
      { lat: 37.8726, lng: -122.4561 },
      '2025-10-18T11:10:00.000-07:00',
      '2025-10-18T11:40:00.000-07:00'
    ),

    // --- DAY 2: Coastal Flight & Santa Monica Sunset Walk (2025-10-19) ---
    buildVisitSegment(
      'San Francisco Intl Airport (SFO)',
      'AIRPORT',
      { lat: 37.6213, lng: -122.379 },
      '2025-10-19T15:10:00.000-07:00',
      '2025-10-19T15:40:00.000-07:00'
    ),
    buildActivitySegment(
      'FLYING',
      [
        { lat: 37.6213, lng: -122.379 },
        { lat: 37.41, lng: -122.25 },
        { lat: 36.82, lng: -121.95 },
        { lat: 36.15, lng: -121.68 },
        { lat: 35.38, lng: -121.02 },
        { lat: 34.48, lng: -120.18 },
        { lat: 34.08, lng: -119.22 },
        { lat: 33.99, lng: -118.74 },
        { lat: 33.9416, lng: -118.4085 },
      ],
      '2025-10-19T15:40:00.000-07:00',
      '2025-10-19T16:48:00.000-07:00',
      8
    ),
    buildVisitSegment(
      'LAX Terminal 4',
      'AIRPORT',
      { lat: 33.9416, lng: -118.4085 },
      '2025-10-19T16:48:00.000-07:00',
      '2025-10-19T17:05:00.000-07:00'
    ),
    buildActivitySegment(
      'IN_PASSENGER_VEHICLE',
      [
        { lat: 33.9416, lng: -118.4085 },
        { lat: 33.9565, lng: -118.419 },
        { lat: 33.972, lng: -118.442 },
        { lat: 33.9895, lng: -118.4635 },
        { lat: 34.0038, lng: -118.485 },
        { lat: 34.0092, lng: -118.4976 },
      ],
      '2025-10-19T17:05:00.000-07:00',
      '2025-10-19T17:27:00.000-07:00',
      6
    ),
    buildVisitSegment(
      'Santa Monica Pier',
      'LANDMARK',
      { lat: 34.0092, lng: -118.4976 },
      '2025-10-19T17:27:00.000-07:00',
      '2025-10-19T18:02:00.000-07:00'
    ),
    buildActivitySegment(
      'WALKING',
      [
        { lat: 34.0092, lng: -118.4976 },
        { lat: 34.0035, lng: -118.4902 },
        { lat: 33.9972, lng: -118.4828 },
        { lat: 33.9908, lng: -118.4755 },
        { lat: 33.9838, lng: -118.4683 },
      ],
      '2025-10-19T18:02:00.000-07:00',
      '2025-10-19T18:26:00.000-07:00',
      6
    ),
  ];

  return JSON.stringify({ semanticSegments });
}
