export type TransportMode =
  | 'WALKING'
  | 'DRIVING'
  | 'CYCLING'
  | 'TRANSIT'
  | 'FLYING'
  | 'STILL';

export type ActivitySubtype =
  | 'SUBWAY'
  | 'TRAM'
  | 'BUS'
  | 'TRAIN'
  | 'WALKING'
  | 'DRIVING'
  | 'CYCLING'
  | 'FLYING'
  | 'STILL';

export type TimelineSchemaFormat =
  | 'ON_DEVICE_TIMELINE'
  | 'SEMANTIC_HISTORY'
  | 'RAW_RECORDS'
  | 'UNKNOWN';

export type TimelineViewMode = 'DAY' | 'JOURNEY';

export type MapStyleId = 'DARK' | 'DAYLIGHT' | 'SATELLITE' | 'DYNAMIC';

export type CameraMode = 'CHASE' | 'DRONE' | 'OVERVIEW' | 'FREE';

export type AccentThemeId = 'CYAN' | 'CRIMSON' | 'EMERALD' | 'AMBER';

export type UnitSystem = 'METRIC' | 'IMPERIAL';

export interface AppSettings {
  accentTheme: AccentThemeId;
  routeWidth: number;
  routeGlow: boolean;
  units: UnitSystem;
  mapStyle: MapStyleId;
  enable3D: boolean;
  solarSync: boolean;
  hapticsEnabled: boolean;
}

export type SolarPhase =
  | 'Night'
  | 'Blue Hour'
  | 'Dawn'
  | 'Daylight'
  | 'Golden Hour'
  | 'Dusk';

export interface SolarPosition {
  elevationDeg: number; // -90..+90
  azimuthDeg: number; // 0..360 (0=N, 90=E, 180=S, 270=W)
  phase: SolarPhase;
  isNight: boolean;
}

export interface ReelExportProgress {
  active: boolean;
  percent: number;
  frame: number;
  totalFrames: number;
  stage: string;
}

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
  subtype?: ActivitySubtype;
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

export interface ModeBreakdownItem {
  subtype: ActivitySubtype;
  label: string;
  mode: TransportMode;
  distanceM: number;
  durationMs: number;
  segmentCount: number;
}

export interface TopLocationItem {
  coordKey: string;
  name: string;
  lat: number;
  lng: number;
  visitCount: number;
  totalDwellMs: number;
}

export interface LifetimeStats {
  totalDistanceM: number;
  totalDurationMs: number;
  totalTrips: number;
  totalDays: number;
  totalVisits: number;
  modeBreakdown: ModeBreakdownItem[];
  topLocations: TopLocationItem[];
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
  lifetimeStats: LifetimeStats;
}

export interface ParsedTimelineResult {
  dayTrips: Trip[];
  trips: Trip[];
  index: TimelineSummaryIndex;
  stats: TimelineParseStats;
  heatmapGeoJson: GeoJSON.FeatureCollection;
}

export type SpeedPreset =
  | { kind: 'MULTIPLIER'; multiplier: 1 | 10 | 60 | 300; label: string }
  | { kind: 'FIT_DURATION'; seconds: 15 | 30 | 60; label: string };

export interface PrebakedColorStop {
  progress: number; // 0..1 normalized geometric progress along baked LineString
  color: string;
}

export interface PrebakedRoute {
  tripId: string;
  geojson: GeoJSON.FeatureCollection;
  colorStops: PrebakedColorStop[];
  pointCount: number;
  hasGeometry: boolean;
}

export interface CorridorStagingState {
  active: boolean;
  percent: number;
  label: string;
}

export interface TelemetryFrame {
  tripId: string;
  isPlaying: boolean;
  loop: boolean;
  currentTimeMs: number;
  startTimeMs: number;
  endTimeMs: number;
  progress: number;
  lineProgress: number; // 0..1 geometric distance ratio matching MapLibre line-progress
  bakedIndex: number; // Exact index in pre-baked spline table <= currentTimeMs
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
  | { id: number; type: 'GET_TRIP'; tripId: string; viewMode: TimelineViewMode }
  | { id: number; type: 'GET_HEATMAP' };

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
  | { id: number; type: 'HEATMAP_DATA'; geojson: GeoJSON.FeatureCollection }
  | { id: number; type: 'ERROR'; message: string };

export interface ToastMessage {
  id: string;
  kind: 'error' | 'info' | 'success';
  title: string;
  description?: string;
}
