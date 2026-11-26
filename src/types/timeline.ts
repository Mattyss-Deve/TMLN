export type TransportMode =
  | 'WALKING'
  | 'DRIVING'
  | 'CYCLING'
  | 'TRANSIT'
  | 'FLYING'
  | 'STILL';

export type TimelineSchemaFormat =
  | 'ON_DEVICE_TIMELINE'
  | 'SEMANTIC_HISTORY'
  | 'RAW_RECORDS'
  | 'UNKNOWN';

export type TimelineViewMode = 'DAY' | 'JOURNEY';

export interface Waypoint {
  lat: number;
  lng: number;
  timestampMs: number;
  mode: TransportMode;
  speedKmh: number;
  bearing: number;
  cumulativeDistanceM: number;
}

export interface PlaceVisit {
  id: string;
  name: string;
  address?: string;
  semanticType?: string;
  lat: number;
  lng: number;
  startTimeMs: number;
  endTimeMs: number;
  dwellDurationMs: number;
}

export interface TripSegment {
  id: string;
  kind: 'ACTIVITY' | 'VISIT';
  mode: TransportMode;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  distanceM: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  startWaypointIndex: number;
  endWaypointIndex: number;
  visitId?: string;
  label: string;
}

export interface Trip {
  id: string;
  dateKey: string; // Local YYYY-MM-DD
  title: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  distanceM: number;
  modes: TransportMode[];
  waypoints: Waypoint[];
  segments: TripSegment[];
  visits: PlaceVisit[];
  bounds: [[number, number], [number, number]]; // [[west, south], [east, north]]
}

export interface TripSummary {
  id: string;
  viewMode: TimelineViewMode;
  dateKey: string; // Local YYYY-MM-DD
  dateLabel: string;
  yearMonth: string; // YYYY-MM
  title: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  distanceM: number;
  totalDistanceKm: number;
  modes: TransportMode[];
  segmentCount: number;
  visitCount: number;
  visitNames: string[];
}

export interface TimelineParseStats {
  schema: TimelineSchemaFormat;
  totalInputRecords: number;
  totalWaypoints: number;
  filteredSpikes: number;
  totalTrips: number;
  totalDays: number;
  totalVisits: number;
  totalDistanceM: number;
  parseDurationMs: number;
}

export interface TimelineSummaryIndex {
  days: TripSummary[];
  journeys: TripSummary[];
  yearMonths: string[];
  stats: TimelineParseStats;
}

export interface ParsedTimelineResult {
  dayTrips: Trip[];
  trips: Trip[];
  index: TimelineSummaryIndex;
  stats: TimelineParseStats;
}

export type CameraMode = 'CHASE' | 'OVERVIEW' | 'FREE';

export type SpeedPreset =
  | { kind: 'MULTIPLIER'; multiplier: 1 | 10 | 60 | 300; label: string }
  | { kind: 'FIT_DURATION'; seconds: 15 | 30 | 60; label: string };

export interface TelemetryFrame {
  tripId: string;
  isPlaying: boolean;
  loop: boolean;
  currentTimeMs: number;
  startTimeMs: number;
  endTimeMs: number;
  progress: number;
  lat: number;
  lng: number;
  bearing: number;
  speedKmh: number;
  mode: TransportMode;
  cumulativeDistanceM: number;
  totalDistanceM: number;
  activeSegmentIndex: number;
  activeSegment: TripSegment | null;
  activeVisit: PlaceVisit | null;
  activeVisitProgress: number;
  traveledWaypointIndex: number;
  speedPreset: SpeedPreset;
  effectiveMultiplier: number;
}

export type WorkerRequest =
  | { id: number; type: 'PARSE_FILE'; file: File }
  | { id: number; type: 'PARSE_TEXT'; text: string }
  | { id: number; type: 'GET_TRIP'; tripId: string; viewMode: TimelineViewMode };

export type WorkerResponse =
  | { id: number; type: 'PROGRESS'; percent: number; stage: string }
  | {
      id: number;
      type: 'INDEX_READY';
      index: TimelineSummaryIndex;
      initialTrip: Trip | null;
      initialViewMode: TimelineViewMode;
    }
  | { id: number; type: 'TRIP_DATA'; trip: Trip | null }
  | { id: number; type: 'ERROR'; message: string };

export interface ToastMessage {
  id: string;
  kind: 'error' | 'info' | 'success';
  title: string;
  description?: string;
}
