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
  dateKey: string; // YYYY-MM-DD in local time
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

export interface DayGroup {
  dateKey: string;
  dateLabel: string;
  startTimeMs: number;
  endTimeMs: number;
  totalDistanceM: number;
  totalDurationMs: number;
  modes: TransportMode[];
  tripIds: string[];
  visitCount: number;
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

export interface ParsedTimelineResult {
  trips: Trip[];
  days: DayGroup[];
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
  | { id: number; type: 'PARSE_TEXT'; text: string };

export type WorkerResponse =
  | { id: number; type: 'PROGRESS'; percent: number; stage: string }
  | { id: number; type: 'SUCCESS'; data: ParsedTimelineResult }
  | { id: number; type: 'ERROR'; message: string };

export interface ToastMessage {
  id: string;
  kind: 'error' | 'info' | 'success';
  title: string;
  description?: string;
}
