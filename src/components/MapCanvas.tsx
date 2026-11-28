import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { AnimationController } from '../engine/animationController';
import type {
  AppSettings,
  CameraMode,
  CorridorStagingState,
  MapStyleId,
  PlaceVisit,
  TelemetryFrame,
  TransportMode,
  Trip,
} from '../types/timeline';
import { formatDuration } from '../utils/format';
import { resolveVisitDisplayName } from '../utils/geocoder';
import { lerp, lerpAngle, MODE_COLORS } from '../utils/geo';
import { triggerSegmentPulse, triggerSuccessPulse } from '../utils/haptics';
import { ACCENT_THEMES } from '../utils/settings';
import {
  computeSolarAtmosphere,
  computeSolarPosition,
  type SolarAtmosphere,
} from '../utils/solar';

const CARTO_DARK_STYLE =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const DAYLIGHT_3D_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const SATELLITE_HYBRID_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'esri-world-imagery': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Esri, Maxar, Earthstar Geographics',
    },
    'carto-voyager-labels': {
      type: 'raster',
      tiles: [
        'https://basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      maxzoom: 18,
      attribution: '© CARTO, © OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'satellite-ocean-bg',
      type: 'background',
      paint: {
        'background-color': '#0B1320',
      },
    },
    {
      id: 'esri-world-imagery-layer',
      type: 'raster',
      source: 'esri-world-imagery',
    },
    {
      id: 'carto-voyager-labels-layer',
      type: 'raster',
      source: 'carto-voyager-labels',
      paint: {
        'raster-opacity': 0.88,
      },
    },
  ],
};

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

const WORLD_ATMOSPHERE_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-180, -85],
            [180, -85],
            [180, 85],
            [-180, 85],
            [-180, -85],
          ],
        ],
      },
    },
  ],
};

const STAGING_TIMEOUT_MS = 1500;

function waitForMapEventOrTimeout(
  map: maplibregl.Map,
  eventName: 'idle' | 'style.load',
  timeoutMs: number
): Promise<void> {
  if (eventName === 'style.load' && map.isStyleLoaded()) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timerId);
      map.off(eventName, done);
      resolve();
    };
    const timerId = window.setTimeout(done, timeoutMs);
    map.once(eventName, done);
  });
}

function getMapStyleSource(
  styleId: MapStyleId
): string | maplibregl.StyleSpecification {
  switch (styleId) {
    case 'SATELLITE':
      return SATELLITE_HYBRID_STYLE;
    case 'DAYLIGHT':
    case 'DYNAMIC':
      return DAYLIGHT_3D_STYLE;
    case 'DARK':
    default:
      return CARTO_DARK_STYLE;
  }
}

/**
 * Toggles visibility on EVERY fill-extrusion layer in the current map style
 * (both custom `chronomap-3d-buildings` and style-native layers like Liberty `building-3d`)
 * so 2D mode is truly flat and 3D mode is unmistakably architectural.
 */
function applyAll3DBuildingsVisibility(map: maplibregl.Map, enable3D: boolean): void {
  const layers = map.getStyle()?.layers;
  if (!layers) return;
  const vis = enable3D ? 'visible' : 'none';
  for (const layer of layers) {
    if (layer.type === 'fill-extrusion') {
      try {
        map.setLayoutProperty(layer.id, 'visibility', vis);
      } catch {
        // Ignore transient style layer errors
      }
    }
  }
}

/**
 * Applies full-scene Day/Night vector grading across base OpenFreeMap Liberty layers
 * when Dynamic map mode is active: background, land, parks, water, glowing golden-amber
 * city road arteries at night, legible labels, and height-graded 3D buildings.
 */
function applyDynamicVectorGrading(map: maplibregl.Map, atmo: SolarAtmosphere): void {
  const layers = map.getStyle()?.layers;
  if (!layers) return;
  const pal = atmo.dynamicVector;
  const buildingColorExpr = [
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
    0,
    pal.buildingBaseColor,
    18,
    pal.buildingMidColor,
    55,
    pal.buildingRoofColor,
  ] as maplibregl.ExpressionSpecification;

  for (const layer of layers) {
    const id = layer.id;
    // Skip ChronoMap custom overlays (handled separately)
    if (
      id.startsWith('ghost-') ||
      id.startsWith('active-') ||
      id.startsWith('alltime-') ||
      id === 'chronomap-solar-atmosphere'
    ) {
      continue;
    }

    const lower = id.toLowerCase();
    try {
      if (layer.type === 'background') {
        map.setPaintProperty(id, 'background-color', pal.backgroundColor);
      } else if (layer.type === 'fill') {
        if (lower.includes('water') || lower.includes('ocean') || lower.includes('river')) {
          map.setPaintProperty(id, 'fill-color', pal.waterColor);
        } else if (
          lower.includes('park') ||
          lower.includes('wood') ||
          lower.includes('forest') ||
          lower.includes('grass') ||
          lower.includes('green') ||
          lower.includes('garden')
        ) {
          map.setPaintProperty(id, 'fill-color', pal.parkColor);
        } else if (lower.includes('building')) {
          map.setPaintProperty(id, 'fill-color', pal.buildingBaseColor);
        } else {
          map.setPaintProperty(id, 'fill-color', pal.landColor);
        }
      } else if (layer.type === 'line') {
        const isMajorArtery =
          (lower.includes('motorway') ||
            lower.includes('trunk') ||
            lower.includes('primary') ||
            lower.includes('secondary') ||
            lower.includes('highway')) &&
          !lower.includes('casing');
        const isRoadOrRail =
          lower.includes('road') ||
          lower.includes('street') ||
          lower.includes('bridge') ||
          lower.includes('tunnel') ||
          lower.includes('highway') ||
          lower.includes('motorway') ||
          lower.includes('primary') ||
          lower.includes('secondary') ||
          lower.includes('tertiary') ||
          lower.includes('rail');

        if (isMajorArtery) {
          map.setPaintProperty(id, 'line-color', pal.majorRoadColor);
        } else if (isRoadOrRail) {
          map.setPaintProperty(id, 'line-color', pal.minorRoadColor);
        } else if (lower.includes('water') || lower.includes('river')) {
          map.setPaintProperty(id, 'line-color', pal.waterColor);
        }
      } else if (layer.type === 'fill-extrusion') {
        map.setPaintProperty(id, 'fill-extrusion-color', buildingColorExpr);
        map.setPaintProperty(id, 'fill-extrusion-opacity', atmo.buildingOpacity);
      } else if (layer.type === 'symbol') {
        map.setPaintProperty(id, 'text-color', pal.labelColor);
        map.setPaintProperty(id, 'text-halo-color', pal.labelHaloColor);
      }
    } catch {
      // Some style layers may not support a specific paint property; skip safely
    }
  }
}

interface MapCanvasProps {
  controller: AnimationController;
  trip: Trip | null;
  autoPlayOnReady: boolean;
  cameraMode: CameraMode;
  recenterNonce: number;
  onCameraModeChange: (mode: CameraMode) => void;
  sidebarOpen: boolean;
  settings: AppSettings;
  showHeatmap: boolean;
  heatmapGeoJson: GeoJSON.FeatureCollection | null;
  nicknames: Record<string, string>;
  geocodeCache: Record<string, string>;
  cinemaMode: boolean;
  mapInstanceRef?: MutableRefObject<maplibregl.Map | null>;
  onMapSingleTap?: () => void;
  onMapDoubleTap?: () => void;
  onStagingChange?: (state: CorridorStagingState) => void;
  onMapError?: (message: string) => void;
}

interface VisitMarkerHandle {
  visit: PlaceVisit;
  marker: maplibregl.Marker;
  rootEl: HTMLButtonElement;
  ringEl: HTMLDivElement;
  dotEl: HTMLDivElement;
  labelEl: HTMLDivElement;
}

function getTargetZoomForFrame(frame: TelemetryFrame, isDrone = false): number {
  let base: number;
  if (frame.mode === 'FLYING' || frame.speedKmh > 220) base = 7.6;
  else if (frame.mode === 'TRANSIT' || frame.speedKmh > 95) base = 11.8;
  else if (frame.mode === 'DRIVING' || frame.speedKmh > 28) base = 13.4;
  else if (frame.mode === 'CYCLING' || frame.speedKmh > 7) base = 14.8;
  else base = 15.8;

  return isDrone ? Math.min(18, base + 1.2) : base;
}

function getCameraPitchForMode(mode: CameraMode, enable3D: boolean): number {
  if (!enable3D) return 0;
  if (mode === 'DRONE') return 58;
  if (mode === 'CHASE') return 54;
  if (mode === 'OVERVIEW') return 40;
  return 54;
}

function createPuckElement() {
  const root = document.createElement('div');
  root.className = 'relative w-20 h-20 pointer-events-none select-none';

  // Ambient Night Ground Light Pool around puck (crossfades in at night)
  const groundPool = document.createElement('div');
  groundPool.style.position = 'absolute';
  groundPool.style.left = '50%';
  groundPool.style.top = '50%';
  groundPool.style.width = '78px';
  groundPool.style.height = '78px';
  groundPool.style.transform = 'translate(-50%, -50%)';
  groundPool.style.borderRadius = '9999px';
  groundPool.style.pointerEvents = 'none';
  groundPool.style.background =
    'radial-gradient(circle, rgba(254, 243, 199, 0.44) 0%, rgba(251, 191, 36, 0.18) 42%, rgba(251, 191, 36, 0) 74%)';
  groundPool.style.opacity = '0';
  groundPool.style.transition = 'opacity 260ms ease';

  // Night Headlamp Cone (bright forward-facing conic beam, crossfades in below 2° solar elevation)
  const headlamp = document.createElement('div');
  headlamp.style.position = 'absolute';
  headlamp.style.left = '50%';
  headlamp.style.top = '50%';
  headlamp.style.width = '144px';
  headlamp.style.height = '144px';
  headlamp.style.transform = 'translate(-50%, -50%)';
  headlamp.style.borderRadius = '9999px';
  headlamp.style.pointerEvents = 'none';
  headlamp.style.background =
    'conic-gradient(from -34deg at 50% 50%, rgba(254, 249, 195, 0) 0deg, rgba(254, 240, 138, 0.48) 18deg, rgba(255, 255, 255, 0.82) 34deg, rgba(254, 240, 138, 0.48) 50deg, rgba(254, 249, 195, 0) 68deg, transparent 69deg)';
  headlamp.style.maskImage =
    'radial-gradient(circle at 50% 50%, rgba(0,0,0,0.98) 6%, rgba(0,0,0,0.62) 48%, rgba(0,0,0,0) 78%)';
  headlamp.style.webkitMaskImage =
    'radial-gradient(circle at 50% 50%, rgba(0,0,0,0.98) 6%, rgba(0,0,0,0.62) 48%, rgba(0,0,0,0) 78%)';
  headlamp.style.opacity = '0';
  headlamp.style.transition = 'opacity 260ms ease';

  // Daytime Directional Sun Shadow (offset opposite solar azimuth)
  const shadow = document.createElement('div');
  shadow.style.position = 'absolute';
  shadow.style.left = '50%';
  shadow.style.top = '50%';
  shadow.style.width = '18px';
  shadow.style.height = '18px';
  shadow.style.borderRadius = '9999px';
  shadow.style.background =
    'radial-gradient(circle, rgba(2, 6, 23, 0.78) 0%, rgba(2, 6, 23, 0) 72%)';
  shadow.style.filter = 'blur(2.5px)';
  shadow.style.transform = 'translate(-50%, -50%)';
  shadow.style.opacity = '0';
  shadow.style.pointerEvents = 'none';
  shadow.style.transition = 'opacity 240ms ease';

  const sonar = document.createElement('div');
  sonar.className =
    'puck-sonar-ring absolute left-1/2 top-1/2 w-9 h-9 rounded-full';
  sonar.style.backgroundColor = 'rgba(34, 211, 238, 0.35)';

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 80 80');
  svg.setAttribute('width', '80');
  svg.setAttribute('height', '80');
  svg.style.position = 'absolute';
  svg.style.inset = '0';
  svg.style.pointerEvents = 'none';

  const defs = document.createElementNS(ns, 'defs');
  const grad = document.createElementNS(ns, 'linearGradient');
  grad.setAttribute('id', 'puck-cone-grad');
  grad.setAttribute('x1', '50%');
  grad.setAttribute('y1', '50%');
  grad.setAttribute('x2', '50%');
  grad.setAttribute('y2', '0%');

  const stopStart = document.createElementNS(ns, 'stop');
  stopStart.setAttribute('offset', '0%');
  stopStart.setAttribute('stop-color', '#22d3ee');
  stopStart.setAttribute('stop-opacity', '0.68');

  const stopEnd = document.createElementNS(ns, 'stop');
  stopEnd.setAttribute('offset', '100%');
  stopEnd.setAttribute('stop-color', '#22d3ee');
  stopEnd.setAttribute('stop-opacity', '0');

  grad.appendChild(stopStart);
  grad.appendChild(stopEnd);
  defs.appendChild(grad);
  svg.appendChild(defs);

  const cone = document.createElementNS(ns, 'path');
  cone.setAttribute('d', 'M40 40 L21 6 A34 34 0 0 1 59 6 Z');
  cone.setAttribute('fill', 'url(#puck-cone-grad)');
  svg.appendChild(cone);

  const dot = document.createElement('div');
  dot.className =
    'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white transition-colors duration-150';
  dot.style.backgroundColor = '#22d3ee';
  dot.style.boxShadow = '0 0 14px #22d3ee';

  root.appendChild(groundPool);
  root.appendChild(headlamp);
  root.appendChild(shadow);
  root.appendChild(sonar);
  root.appendChild(svg);
  root.appendChild(dot);

  return { root, groundPool, headlamp, shadow, sonar, dot, stopStart, stopEnd };
}

export function MapCanvas({
  controller,
  trip,
  autoPlayOnReady,
  cameraMode,
  recenterNonce,
  onCameraModeChange,
  sidebarOpen,
  settings,
  showHeatmap,
  heatmapGeoJson,
  nicknames,
  geocodeCache,
  cinemaMode,
  mapInstanceRef,
  onMapSingleTap,
  onMapDoubleTap,
  onStagingChange,
  onMapError,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const externalMapRef = useRef<MutableRefObject<maplibregl.Map | null> | undefined>(
    mapInstanceRef
  );
  externalMapRef.current = mapInstanceRef;
  const cinemaModeRef = useRef<boolean>(cinemaMode);
  cinemaModeRef.current = cinemaMode;
  const onMapSingleTapRef = useRef(onMapSingleTap);
  onMapSingleTapRef.current = onMapSingleTap;
  const onMapDoubleTapRef = useRef(onMapDoubleTap);
  onMapDoubleTapRef.current = onMapDoubleTap;
  const styleLoadedRef = useRef(false);
  const appliedStyleIdRef = useRef<MapStyleId>(settings.mapStyle);
  const [styleRevision, setStyleRevision] = useState(0);

  const tripRef = useRef<Trip | null>(trip);
  tripRef.current = trip;

  const autoPlayRef = useRef<boolean>(autoPlayOnReady);
  autoPlayRef.current = autoPlayOnReady;

  const cameraModeRef = useRef<CameraMode>(cameraMode);
  cameraModeRef.current = cameraMode;

  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;

  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;

  const showHeatmapRef = useRef<boolean>(showHeatmap);
  showHeatmapRef.current = showHeatmap;

  const heatmapGeoJsonRef = useRef<GeoJSON.FeatureCollection | null>(heatmapGeoJson);
  heatmapGeoJsonRef.current = heatmapGeoJson;

  const nicknamesRef = useRef<Record<string, string>>(nicknames);
  nicknamesRef.current = nicknames;

  const geocodeCacheRef = useRef<Record<string, string>>(geocodeCache);
  geocodeCacheRef.current = geocodeCache;

  const onCameraModeChangeRef = useRef(onCameraModeChange);
  onCameraModeChangeRef.current = onCameraModeChange;

  const onStagingChangeRef = useRef(onStagingChange);
  onStagingChangeRef.current = onStagingChange;

  const onMapErrorRef = useRef(onMapError);
  onMapErrorRef.current = onMapError;

  const isStagingRef = useRef(false);
  const stagingCleanupRef = useRef<(() => void) | null>(null);
  const stagingSeqRef = useRef(0);
  const lastStagedTripIdRef = useRef<string | null>(null);
  const styleSwitchSeqRef = useRef(0);

  const lastTrailUpdateMsRef = useRef<number>(0);
  const lastTrailKeyRef = useRef<string>('');

  const lastSolarUpdateRef = useRef<{
    tsMs: number;
    elev: number;
    az: number;
    enabled: boolean;
    style: MapStyleId;
  } | null>(null);

  const lastHapticRef = useRef<{
    tripId: string;
    mode: TransportMode;
    visitId: string | null;
  } | null>(null);

  const puckRef = useRef<{
    marker: maplibregl.Marker;
    groundPool: HTMLDivElement;
    headlamp: HTMLDivElement;
    shadow: HTMLDivElement;
    sonar: HTMLDivElement;
    dot: HTMLDivElement;
    stopStart: SVGStopElement;
    stopEnd: SVGStopElement;
    lastMode?: TransportMode;
  } | null>(null);

  const visitHandlesRef = useRef<VisitMarkerHandle[]>([]);
  const activeVisitIdRef = useRef<string | null>(null);

  const chaseCameraRef = useRef<{
    zoom: number;
    bearing: number;
    pitch: number;
    initialized: boolean;
    transitionUntilMs: number;
  }>({
    zoom: 14,
    bearing: 0,
    pitch: 50,
    initialized: false,
    transitionUntilMs: 0,
  });

  const frameVisitHighlight = useCallback((activeVisitId: string | null) => {
    if (activeVisitIdRef.current === activeVisitId) return;
    activeVisitIdRef.current = activeVisitId;

    for (const handle of visitHandlesRef.current) {
      const isActive = handle.visit.id === activeVisitId;
      handle.ringEl.style.opacity = isActive ? '1' : '0';
      handle.dotEl.style.transform = isActive ? 'scale(1.35)' : 'scale(1)';
      handle.dotEl.style.borderColor = isActive ? '#34d399' : 'rgba(255,255,255,0.85)';
      handle.dotEl.style.backgroundColor = isActive ? '#34d399' : '#0f172a';
      handle.labelEl.style.opacity = isActive ? '1' : '';
      handle.labelEl.style.transform = isActive
        ? 'translate(-50%, 0) scale(1.04)'
        : 'translate(-50%, 0) scale(1)';
      handle.labelEl.style.borderColor = isActive
        ? 'rgba(52, 211, 153, 0.7)'
        : 'rgba(255, 255, 255, 0.14)';
    }
  }, []);

  /**
   * Updates the active traveled trail from a pre-allocated coordinate slice
   * (0..bakedIndex + exact interpolated [lng, lat] tip) at a steady 30fps
   * (or immediately on scrub/seek). Guarantees the multi-colored trail never
   * disappears and stays 100% locked to the moving puck.
   */
  const updateActiveRouteTrail = useCallback(
    (map: maplibregl.Map, frame: TelemetryFrame, force = false) => {
      const activeSource = map.getSource('active-route') as
        | maplibregl.GeoJSONSource
        | undefined;
      if (!activeSource) return;

      const now = performance.now();
      const key = `${frame.tripId}:${frame.bakedIndex}:${frame.lng.toFixed(6)}:${frame.lat.toFixed(6)}`;
      if (!force) {
        if (key === lastTrailKeyRef.current) return;
        if (now - lastTrailUpdateMsRef.current < 33) return; // Steady 30fps cap
      }

      lastTrailUpdateMsRef.current = now;
      lastTrailKeyRef.current = key;
      activeSource.setData(controller.buildTraveledGeoJson(frame));
    },
    [controller]
  );

  /**
   * 60fps animation frame handler: updates puck at 60fps, active route trail at 30fps,
   * solar-synced Dynamic Day/Night lighting, and smooth camera tracking.
   */
  const applyFrameToMap = useCallback(
    (frame: TelemetryFrame) => {
      const map = mapRef.current;
      if (!map || !styleLoadedRef.current) return;

      const currentTrip = tripRef.current;
      if (!currentTrip || currentTrip.id !== frame.tripId) return;

      // 1. Exact pre-allocated route tail update (30fps during playback, immediate when scrubbing)
      updateActiveRouteTrail(map, frame, !frame.isPlaying);

      // 2. Direct 60fps DOM marker positioning & directional cone rotation
      const puck = puckRef.current;
      if (puck) {
        puck.marker.setLngLat([frame.lng, frame.lat]);
        puck.marker.setRotation(frame.bearing);

        if (puck.lastMode !== frame.mode) {
          puck.lastMode = frame.mode;
          const color = MODE_COLORS[frame.mode];
          puck.dot.style.backgroundColor = color;
          puck.dot.style.boxShadow = `0 0 16px ${color}`;
          puck.sonar.style.backgroundColor = `${color}55`;
          puck.stopStart.setAttribute('stop-color', color);
          puck.stopEnd.setAttribute('stop-color', color);
        }
      }

      // 3. Highlight active place visit marker
      frameVisitHighlight(frame.activeVisit ? frame.activeVisit.id : null);

      // 3b. Mechanical segment / visit arrival haptic pulse during active playback
      const curVisitId = frame.activeVisit ? frame.activeVisit.id : null;
      const prevHaptic = lastHapticRef.current;
      if (prevHaptic && prevHaptic.tripId === frame.tripId && frame.isPlaying) {
        const modeChanged = prevHaptic.mode !== frame.mode;
        const arrivedAtVisit = curVisitId !== null && curVisitId !== prevHaptic.visitId;
        if (modeChanged || arrivedAtVisit) {
          triggerSegmentPulse();
        }
      }
      lastHapticRef.current = {
        tripId: frame.tripId,
        mode: frame.mode,
        visitId: curVisitId,
      };

      // 3c. Dedicated Dynamic Day/Night Full-Scene Lighting & Puck Headlamp/Shadow
      const curSettings = settingsRef.current;
      const nowPerf = performance.now();
      const prevSolar = lastSolarUpdateRef.current;
      const isDynamicMode = curSettings.mapStyle === 'DYNAMIC';

      if (isDynamicMode) {
        const solar = computeSolarPosition(frame.lat, frame.lng, frame.currentTimeMs);
        const atmo = computeSolarAtmosphere(solar, curSettings.mapStyle);

        // Update puck sun-tracked shadow & night headlamp + ambient ground pool every frame
        if (puckRef.current) {
          const rad = (-frame.bearing * Math.PI) / 180;
          const localDx =
            atmo.puck.shadowDxPx * Math.cos(rad) - atmo.puck.shadowDyPx * Math.sin(rad);
          const localDy =
            atmo.puck.shadowDxPx * Math.sin(rad) + atmo.puck.shadowDyPx * Math.cos(rad);
          puckRef.current.shadow.style.transform = `translate(calc(-50% + ${localDx.toFixed(
            1
          )}px), calc(-50% + ${localDy.toFixed(1)}px))`;
          puckRef.current.shadow.style.opacity = String(atmo.puck.shadowOpacity);
          puckRef.current.headlamp.style.opacity = String(atmo.puck.headlampOpacity);
          puckRef.current.groundPool.style.opacity = String(atmo.puck.groundPoolOpacity);
        }

        const needsSolarUpdate =
          !prevSolar ||
          !prevSolar.enabled ||
          prevSolar.style !== curSettings.mapStyle ||
          (nowPerf - prevSolar.tsMs >= 220 &&
            (Math.abs(solar.elevationDeg - prevSolar.elev) >= 0.45 ||
              Math.abs(solar.azimuthDeg - prevSolar.az) >= 1.2));

        if (needsSolarUpdate) {
          lastSolarUpdateRef.current = {
            tsMs: nowPerf,
            elev: solar.elevationDeg,
            az: solar.azimuthDeg,
            enabled: true,
            style: curSettings.mapStyle,
          };
          try {
            map.setLight(atmo.light);
            if (typeof map.setSky === 'function') {
              map.setSky(atmo.sky);
            }
            const mapWithFog = map as unknown as {
              setFog?: (fog: unknown) => void;
            };
            if (typeof mapWithFog.setFog === 'function') {
              mapWithFog.setFog(atmo.fog);
            }

            // Whole-map land, water, lit city arteries, labels, and 3D buildings grading
            applyDynamicVectorGrading(map, atmo);

            if (map.getLayer('chronomap-solar-atmosphere')) {
              map.setPaintProperty(
                'chronomap-solar-atmosphere',
                'fill-color',
                atmo.tint.color
              );
              map.setPaintProperty(
                'chronomap-solar-atmosphere',
                'fill-opacity',
                atmo.tint.opacity
              );
            }

            if (map.getLayer('active-route-glow') && curSettings.routeGlow) {
              map.setPaintProperty(
                'active-route-glow',
                'line-opacity',
                Math.min(0.88, Number((0.5 * atmo.routeGlowOpacityBoost).toFixed(2)))
              );
            }
          } catch {
            // Ignore transient style-not-ready errors
          }
        }
      } else {
        // Static modes (Night, Day, Satellite): clean, faithful styling
        if (puckRef.current) {
          puckRef.current.shadow.style.opacity = '0';
          puckRef.current.headlamp.style.opacity =
            curSettings.mapStyle === 'DARK' ? '0.65' : '0';
          puckRef.current.groundPool.style.opacity =
            curSettings.mapStyle === 'DARK' ? '0.5' : '0';
        }
        if (prevSolar?.enabled) {
          lastSolarUpdateRef.current = {
            tsMs: nowPerf,
            elev: 0,
            az: 0,
            enabled: false,
            style: curSettings.mapStyle,
          };
          try {
            map.setLight({
              anchor: 'viewport',
              color: '#ffffff',
              intensity: 0.5,
              position: [1.15, 210, 30],
            });
            if (map.getLayer('chronomap-solar-atmosphere')) {
              map.setPaintProperty('chronomap-solar-atmosphere', 'fill-opacity', 0);
            }
            if (map.getLayer('active-route-glow')) {
              map.setPaintProperty(
                'active-route-glow',
                'line-opacity',
                curSettings.routeGlow ? 0.52 : 0
              );
            }
          } catch {
            // Ignore transient style errors
          }
        }
      }

      // 4. Camera Chase / Drone Chase / Director's Cinema tracking (paused during corridor pre-staging)
      if (isStagingRef.current) return;

      const mode = cameraModeRef.current;
      const inCinemaDirector = cinemaModeRef.current && mode !== 'FREE';
      if (mode === 'CHASE' || mode === 'DRONE' || inCinemaDirector) {
        const now = performance.now();
        if (now < chaseCameraRef.current.transitionUntilMs) {
          return;
        }

        const isDrone = mode === 'DRONE' || inCinemaDirector;
        const isSlowOrVisit =
          frame.mode === 'STILL' || frame.mode === 'WALKING' || frame.speedKmh < 8;
        const isFastTransit =
          frame.mode === 'TRANSIT' ||
          frame.mode === 'DRIVING' ||
          frame.mode === 'FLYING' ||
          frame.speedKmh >= 25;

        let targetZoom = getTargetZoomForFrame(frame, isDrone);
        let targetPitch = getCameraPitchForMode(mode, curSettings.enable3D);
        let targetBearing =
          frame.mode === 'STILL' ? chaseCameraRef.current.bearing : frame.bearing;

        if (inCinemaDirector) {
          const driftDeg = Math.sin((now / 25000) * Math.PI * 2) * 18;
          const baseHeading =
            frame.mode === 'STILL' ? chaseCameraRef.current.bearing : frame.bearing;
          targetBearing = (baseHeading + driftDeg + 360) % 360;

          if (!curSettings.enable3D) {
            targetPitch = 0;
          } else if (isSlowOrVisit) {
            targetPitch = 58;
            targetZoom = Math.min(18.2, targetZoom + 0.45);
          } else if (isFastTransit) {
            targetPitch = 46;
            targetZoom = Math.max(7.2, targetZoom - 0.35);
          } else {
            targetPitch = 52;
          }
        }

        if (!chaseCameraRef.current.initialized) {
          chaseCameraRef.current.zoom = targetZoom;
          chaseCameraRef.current.bearing = targetBearing;
          chaseCameraRef.current.pitch = targetPitch;
          chaseCameraRef.current.initialized = true;
        } else {
          chaseCameraRef.current.zoom = lerp(
            chaseCameraRef.current.zoom,
            targetZoom,
            isDrone ? 0.08 : 0.055
          );
          chaseCameraRef.current.pitch = lerp(
            chaseCameraRef.current.pitch,
            targetPitch,
            0.07
          );
          if (frame.mode !== 'STILL' || inCinemaDirector) {
            chaseCameraRef.current.bearing = lerpAngle(
              chaseCameraRef.current.bearing,
              targetBearing,
              inCinemaDirector ? 0.06 : isDrone ? 0.12 : 0.07
            );
          }
        }

        let centerLng = frame.lng;
        let centerLat = frame.lat;

        if (isDrone && frame.mode !== 'STILL') {
          const rad = (chaseCameraRef.current.bearing * Math.PI) / 180;
          const aheadDeg = frame.mode === 'FLYING' ? 0.014 : 0.00032;
          centerLat += Math.cos(rad) * aheadDeg;
          centerLng +=
            (Math.sin(rad) * aheadDeg) /
            Math.max(0.25, Math.cos((frame.lat * Math.PI) / 180));
        }

        map.jumpTo({
          center: [centerLng, centerLat],
          zoom: chaseCameraRef.current.zoom,
          pitch: chaseCameraRef.current.pitch,
          bearing: chaseCameraRef.current.bearing,
        });
      }
    },
    [frameVisitHighlight, updateActiveRouteTrail]
  );

  /**
   * Re-attaches all custom ChronoMap sources & layers (3D buildings without DEM
   * terrain draping, heatmap, static pre-baked ghost & active lineMetrics routes)
   * idempotently on every style.load.
   */
  const syncCustomSourcesAndLayers = useCallback(
    (map: maplibregl.Map) => {
      const curSettings = settingsRef.current;
      const accent = ACCENT_THEMES[curSettings.accentTheme];
      const prebaked = controller.getPrebakedRoute();
      const snap = controller.getSnapshot();

      // 0. Full-coverage Solar Atmospheric Tint Layer (beneath 3D buildings & routes)
      if (!map.getSource('solar-atmosphere-source')) {
        map.addSource('solar-atmosphere-source', {
          type: 'geojson',
          data: WORLD_ATMOSPHERE_FC,
        });
      }

      if (!map.getLayer('chronomap-solar-atmosphere')) {
        map.addLayer({
          id: 'chronomap-solar-atmosphere',
          type: 'fill',
          source: 'solar-atmosphere-source',
          paint: {
            'fill-color': '#040814',
            'fill-opacity': 0,
          },
        });
      }

      // 1. OpenFreeMap Planet vector source for zoom-faded 3D extruded buildings
      if (!map.getSource('openfreemap-3d')) {
        map.addSource('openfreemap-3d', {
          type: 'vector',
          url: 'https://tiles.openfreemap.org/planet',
        });
      }

      if (!map.getLayer('chronomap-3d-buildings')) {
        const buildingColor =
          curSettings.mapStyle === 'DAYLIGHT'
            ? '#cbd5e1'
            : curSettings.mapStyle === 'SATELLITE'
              ? '#1e293b'
              : '#162235';
        map.addLayer({
          id: 'chronomap-3d-buildings',
          type: 'fill-extrusion',
          source: 'openfreemap-3d',
          'source-layer': 'building',
          minzoom: 13.5,
          layout: {
            visibility: curSettings.enable3D ? 'visible' : 'none',
          },
          paint: {
            'fill-extrusion-color': buildingColor,
            'fill-extrusion-height': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13.5,
              0,
              14.5,
              ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
            ],
            'fill-extrusion-base': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13.5,
              0,
              14.5,
              ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
            ],
            'fill-extrusion-opacity':
              curSettings.mapStyle === 'SATELLITE' ? 0.56 : 0.72,
          },
        });
      }

      // 2. All-Time Heatmap source & layers
      if (!map.getSource('alltime-heatmap')) {
        map.addSource('alltime-heatmap', {
          type: 'geojson',
          data: heatmapGeoJsonRef.current ?? EMPTY_FC,
        });
      }

      if (!map.getLayer('alltime-heatmap-routes')) {
        map.addLayer({
          id: 'alltime-heatmap-routes',
          type: 'line',
          source: 'alltime-heatmap',
          filter: ['==', ['get', 'kind'], 'route'],
          layout: {
            visibility: showHeatmapRef.current ? 'visible' : 'none',
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': accent.primary,
            'line-width': 2.2,
            'line-opacity': 0.28,
          },
        });
      }

      if (!map.getLayer('alltime-heatmap-density')) {
        map.addLayer({
          id: 'alltime-heatmap-density',
          type: 'heatmap',
          source: 'alltime-heatmap',
          filter: ['==', ['get', 'kind'], 'heat'],
          layout: {
            visibility: showHeatmapRef.current ? 'visible' : 'none',
          },
          paint: {
            'heatmap-weight': ['coalesce', ['get', 'weight'], 0.8],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 14, 2.2],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 10, 14, 26],
            'heatmap-opacity': 0.72,
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0,
              'rgba(0,0,0,0)',
              0.2,
              'rgba(34,211,238,0.45)',
              0.45,
              'rgba(52,211,153,0.68)',
              0.7,
              'rgba(251,191,36,0.82)',
              1,
              'rgba(244,63,94,0.95)',
            ],
          },
        });
      }

      // 3. Static Ghost Route source & layer (uploaded once per trip)
      if (!map.getSource('ghost-route')) {
        map.addSource('ghost-route', {
          type: 'geojson',
          data: prebaked?.geojson ?? EMPTY_FC,
        });
      }

      if (!map.getLayer('ghost-route-line')) {
        map.addLayer({
          id: 'ghost-route-line',
          type: 'line',
          source: 'ghost-route',
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': curSettings.mapStyle === 'DAYLIGHT' ? '#475569' : '#94a3b8',
            'line-width': Math.max(2, curSettings.routeWidth * 0.75),
            'line-opacity': curSettings.mapStyle === 'SATELLITE' ? 0.38 : 0.25,
          },
        });
      }

      // 4. Active Traveled Route source (exact pre-allocated multi-colored slice, zero gradient drift)
      const initialTraveled = snap ? controller.buildTraveledGeoJson(snap) : EMPTY_FC;
      if (!map.getSource('active-route')) {
        map.addSource('active-route', {
          type: 'geojson',
          data: initialTraveled,
        });
      }

      const routeColorExpr = [
        'coalesce',
        ['get', 'color'],
        '#22d3ee',
      ] as maplibregl.ExpressionSpecification;
      const glowColorValue =
        curSettings.accentTheme === 'CYAN' ? routeColorExpr : accent.primary;

      if (!map.getLayer('active-route-glow')) {
        map.addLayer({
          id: 'active-route-glow',
          type: 'line',
          source: 'active-route',
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': glowColorValue,
            'line-width': curSettings.routeWidth * 3.1,
            'line-blur': curSettings.routeGlow ? 7 : 0,
            'line-opacity': curSettings.routeGlow ? 0.52 : 0,
          },
        });
      }

      if (!map.getLayer('active-route-core')) {
        map.addLayer({
          id: 'active-route-core',
          type: 'line',
          source: 'active-route',
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': routeColorExpr,
            'line-width': curSettings.routeWidth,
            'line-opacity': 0.98,
          },
        });
      }

      // Enforce true 2D vs 3D visibility across ALL fill-extrusion layers (custom + style-native)
      applyAll3DBuildingsVisibility(map, curSettings.enable3D);

      if (!puckRef.current) {
        const puckEl = createPuckElement();
        const puckMarker = new maplibregl.Marker({
          element: puckEl.root,
          anchor: 'center',
          pitchAlignment: 'map',
          rotationAlignment: 'map',
        })
          .setLngLat([-122.42, 37.79])
          .addTo(map);

        if (!tripRef.current) {
          puckEl.root.style.display = 'none';
        }

        puckRef.current = {
          marker: puckMarker,
          groundPool: puckEl.groundPool,
          headlamp: puckEl.headlamp,
          shadow: puckEl.shadow,
          sonar: puckEl.sonar,
          dot: puckEl.dot,
          stopStart: puckEl.stopStart,
          stopEnd: puckEl.stopEnd,
        };
      }

      lastTrailUpdateMsRef.current = 0;
      lastTrailKeyRef.current = '';
      lastSolarUpdateRef.current = null;
      styleLoadedRef.current = true;
      setStyleRevision((r) => r + 1);
    },
    [controller]
  );

  /**
   * Snap camera cleanly to current/starting trip viewpoint (zero-stutter transition).
   */
  const snapToActiveViewpoint = useCallback(
    (map: maplibregl.Map, targetTrip: Trip, animate = false) => {
      const mode = cameraModeRef.current;
      const snap = controller.getSnapshot();

      if (mode === 'OVERVIEW') {
        map.fitBounds(targetTrip.bounds, {
          padding: {
            top: 100,
            bottom: 145,
            left: sidebarOpenRef.current ? 360 : 56,
            right: 260,
          },
          pitch: getCameraPitchForMode('OVERVIEW', settingsRef.current.enable3D),
          bearing: 0,
          duration: animate ? 650 : 0,
          maxZoom: 15.5,
        });
        return;
      }

      if (snap) {
        const isDrone = mode === 'DRONE';
        const targetZoom = getTargetZoomForFrame(snap, isDrone);
        const targetPitch = getCameraPitchForMode(mode, settingsRef.current.enable3D);
        chaseCameraRef.current.zoom = targetZoom;
        chaseCameraRef.current.bearing = snap.bearing;
        chaseCameraRef.current.pitch = targetPitch;
        chaseCameraRef.current.initialized = true;

        if (animate) {
          chaseCameraRef.current.transitionUntilMs = performance.now() + 560;
          map.easeTo({
            center: [snap.lng, snap.lat],
            zoom: targetZoom,
            pitch: targetPitch,
            bearing: snap.bearing,
            duration: 540,
          });
        } else {
          chaseCameraRef.current.transitionUntilMs = 0;
          map.jumpTo({
            center: [snap.lng, snap.lat],
            zoom: targetZoom,
            pitch: targetPitch,
            bearing: snap.bearing,
          });
        }
      }
    },
    [controller]
  );

  /**
   * Corridor Pre-Staging Pipeline (only runs when loading a new trip/day):
   * Uses Promise.race + hard 1500ms cap + try/finally cleanup so it can NEVER hang.
   */
  const runCorridorPreStaging = useCallback(
    (
      map: maplibregl.Map,
      targetTrip: Trip,
      shouldAutoPlay: boolean,
      stageLabel = 'Staging 3D Corridor...'
    ) => {
      stagingCleanupRef.current?.();
      stagingCleanupRef.current = null;

      const seq = ++stagingSeqRef.current;
      isStagingRef.current = true;
      lastStagedTripIdRef.current = targetTrip.id;

      const wasPlaying = controller.getSnapshot()?.isPlaying ?? false;
      if (wasPlaying) {
        controller.pause();
      }
      const resumePlayback = shouldAutoPlay || wasPlaying;

      let cancelled = false;
      let progressTimerId: number | null = null;
      let dismissTimerId: number | null = null;

      stagingCleanupRef.current = () => {
        cancelled = true;
        isStagingRef.current = false;
        if (progressTimerId !== null) {
          window.clearInterval(progressTimerId);
          progressTimerId = null;
        }
        if (dismissTimerId !== null) {
          window.clearTimeout(dismissTimerId);
          dismissTimerId = null;
        }
      };

      const execute = async () => {
        try {
          onStagingChangeRef.current?.({
            active: true,
            percent: 15,
            label: stageLabel,
          });

          // Stage 1: Upload pre-baked spline GeoJSON once (0% -> 40%)
          const prebaked = controller.getPrebakedRoute();
          const routeGeoJson = prebaked?.geojson ?? EMPTY_FC;

          const ghostSource = map.getSource('ghost-route') as
            | maplibregl.GeoJSONSource
            | undefined;
          ghostSource?.setData(routeGeoJson);

          const snap = controller.getSnapshot();
          if (snap) {
            updateActiveRouteTrail(map, snap, true);
          } else {
            const activeSource = map.getSource('active-route') as
              | maplibregl.GeoJSONSource
              | undefined;
            activeSource?.setData(EMPTY_FC);
          }

          onStagingChangeRef.current?.({
            active: true,
            percent: 40,
            label: 'Pre-loading corridor tiles...',
          });

          // Stage 2: Frame corridor instantaneously to warm GPU tile cache (1500ms hard cap)
          map.fitBounds(targetTrip.bounds, {
            duration: 0,
            maxZoom: 15,
            padding: {
              top: 84,
              bottom: 132,
              left: sidebarOpenRef.current ? 350 : 48,
              right: 240,
            },
            pitch: settingsRef.current.enable3D ? 42 : 0,
            bearing: 0,
          });

          let currentPercent = 44;
          progressTimerId = window.setInterval(() => {
            if (cancelled || seq !== stagingSeqRef.current) return;
            currentPercent = Math.min(93, currentPercent + 8);
            onStagingChangeRef.current?.({
              active: true,
              percent: currentPercent,
              label: 'Pre-loading corridor tiles...',
            });
          }, 130);

          await waitForMapEventOrTimeout(map, 'idle', STAGING_TIMEOUT_MS);

          if (cancelled || seq !== stagingSeqRef.current) return;

          onStagingChangeRef.current?.({
            active: true,
            percent: 100,
            label: 'Corridor ready',
          });

          isStagingRef.current = false;
          snapToActiveViewpoint(map, targetTrip, false);

          const latestSnap = controller.getSnapshot();
          if (latestSnap) {
            applyFrameToMap(latestSnap);
          }
        } finally {
          if (progressTimerId !== null) {
            window.clearInterval(progressTimerId);
            progressTimerId = null;
          }
          isStagingRef.current = false;

          if (!cancelled && seq === stagingSeqRef.current) {
            dismissTimerId = window.setTimeout(() => {
              if (cancelled || seq !== stagingSeqRef.current) return;
              onStagingChangeRef.current?.({
                active: false,
                percent: 100,
                label: '',
              });
              triggerSuccessPulse();
              if (resumePlayback) {
                controller.play();
              }
            }, 110);
          } else if (seq === stagingSeqRef.current) {
            onStagingChangeRef.current?.({
              active: false,
              percent: 0,
              label: '',
            });
          }
        }
      };

      void execute();
    },
    [controller, applyFrameToMap, snapToActiveViewpoint, updateActiveRouteTrail]
  );

  // Initialize MapLibre GL once with mobile GPU optimizations
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let errorReported = false;
    appliedStyleIdRef.current = settingsRef.current.mapStyle;

    const map = new maplibregl.Map({
      container,
      style: getMapStyleSource(settingsRef.current.mapStyle),
      center: [-122.42, 37.79],
      zoom: 2.3,
      pitch: settingsRef.current.enable3D ? 52 : 0,
      bearing: 0,
      maxPitch: 68,
      fadeDuration: 0,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.75),
      maxTileCacheSize: 250,
      preserveDrawingBuffer: true,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right'
    );
    mapRef.current = map;
    if (externalMapRef.current) {
      externalMapRef.current.current = map;
    }

    const unlockToFreeMode = (ev: { originalEvent?: unknown }) => {
      if (!ev.originalEvent || isStagingRef.current) return;
      if (cameraModeRef.current === 'CHASE' || cameraModeRef.current === 'DRONE') {
        onCameraModeChangeRef.current('FREE');
      }
    };

    map.on('dragstart', unlockToFreeMode);
    map.on('wheel', unlockToFreeMode);
    map.on('rotatestart', unlockToFreeMode);
    map.on('pitchstart', unlockToFreeMode);

    map.on('error', (ev) => {
      const errObj = ev?.error as { message?: string; status?: number } | undefined;
      const msg = errObj?.message || '';
      const status = errObj?.status;
      const hasTileSource = Boolean((ev as { sourceId?: string } | undefined)?.sourceId);
      const isTransientTileError =
        hasTileSource ||
        status === 404 ||
        status === 0 ||
        /404|failed to fetch|networkerror|load failed|aborterror|ajaxerror/i.test(msg);

      if (isTransientTileError) {
        return;
      }
      if (!errorReported && msg) {
        errorReported = true;
        onMapErrorRef.current?.(`Map style notice: ${msg}`);
      }
    });

    map.on('style.load', () => {
      syncCustomSourcesAndLayers(map);
    });

    return () => {
      stagingCleanupRef.current?.();
      stagingCleanupRef.current = null;
      styleLoadedRef.current = false;
      for (const h of visitHandlesRef.current) {
        h.marker.remove();
      }
      visitHandlesRef.current = [];
      puckRef.current?.marker.remove();
      puckRef.current = null;
      map.remove();
      mapRef.current = null;
      if (externalMapRef.current) {
        externalMapRef.current.current = null;
      }
    };
  }, [syncCustomSourcesAndLayers]);

  // Switch Map Style non-blockingly with bulletproof Promise.race + isStyleLoaded failsafe
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedStyleIdRef.current === settings.mapStyle) return;
    appliedStyleIdRef.current = settings.mapStyle;
    styleLoadedRef.current = false;
    const switchSeq = ++styleSwitchSeqRef.current;

    // Never block screen with Corridor Pre-Staging modal on style swaps
    stagingCleanupRef.current?.();
    stagingCleanupRef.current = null;
    onStagingChangeRef.current?.({ active: false, percent: 0, label: '' });

    let cancelled = false;
    const applyStyleSwap = async () => {
      try {
        map.setStyle(getMapStyleSource(settings.mapStyle), { diff: false });
        if (map.isStyleLoaded()) {
          if (!cancelled && switchSeq === styleSwitchSeqRef.current) {
            syncCustomSourcesAndLayers(map);
          }
          return;
        }
        await Promise.race([
          waitForMapEventOrTimeout(map, 'style.load', STAGING_TIMEOUT_MS),
          waitForMapEventOrTimeout(map, 'idle', STAGING_TIMEOUT_MS),
        ]);
      } finally {
        if (!cancelled && switchSeq === styleSwitchSeqRef.current && !styleLoadedRef.current) {
          try {
            syncCustomSourcesAndLayers(map);
          } catch {
            // MapLibre may still be finalizing style JSON; style.load listener will catch it
          }
        }
      }
    };

    void applyStyleSwap();
    return () => {
      cancelled = true;
    };
  }, [settings.mapStyle, syncCustomSourcesAndLayers]);

  // Toggle True Flat 2D (0°) vs Extruded 3D (54° / 58° Drone) across ALL fill-extrusion layers
  const prevEnable3DRef = useRef<boolean>(settings.enable3D);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    applyAll3DBuildingsVisibility(map, settings.enable3D);

    if (prevEnable3DRef.current !== settings.enable3D) {
      prevEnable3DRef.current = settings.enable3D;
      const targetPitch = getCameraPitchForMode(cameraModeRef.current, settings.enable3D);
      chaseCameraRef.current.pitch = targetPitch;
      chaseCameraRef.current.transitionUntilMs = performance.now() + 560;
      map.easeTo({
        pitch: targetPitch,
        duration: 500,
      });
    }
  }, [settings.enable3D, styleRevision]);

  // Update Route Thickness, Glow Intensity, and Accent Theme live on GPU
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    const accent = ACCENT_THEMES[settings.accentTheme];
    const routeColorExpr = [
      'coalesce',
      ['get', 'color'],
      '#22d3ee',
    ] as maplibregl.ExpressionSpecification;

    if (map.getLayer('active-route-core')) {
      map.setPaintProperty('active-route-core', 'line-width', settings.routeWidth);
    }
    if (map.getLayer('active-route-glow')) {
      map.setPaintProperty(
        'active-route-glow',
        'line-color',
        settings.accentTheme === 'CYAN' ? routeColorExpr : accent.primary
      );
      map.setPaintProperty(
        'active-route-glow',
        'line-width',
        settings.routeWidth * 3.1
      );
      map.setPaintProperty(
        'active-route-glow',
        'line-blur',
        settings.routeGlow ? 7 : 0
      );
      map.setPaintProperty(
        'active-route-glow',
        'line-opacity',
        settings.routeGlow ? 0.52 : 0
      );
    }
    if (map.getLayer('ghost-route-line')) {
      map.setPaintProperty(
        'ghost-route-line',
        'line-width',
        Math.max(2, settings.routeWidth * 0.75)
      );
    }
    if (map.getLayer('alltime-heatmap-routes')) {
      map.setPaintProperty('alltime-heatmap-routes', 'line-color', accent.primary);
    }

    lastSolarUpdateRef.current = null;
    const snap = controller.getSnapshot();
    if (snap) {
      updateActiveRouteTrail(map, snap, true);
      applyFrameToMap(snap);
    }
  }, [
    settings.routeWidth,
    settings.routeGlow,
    settings.accentTheme,
    settings.solarSync,
    styleRevision,
    controller,
    applyFrameToMap,
    updateActiveRouteTrail,
  ]);

  // Update All-Time Heatmap source & visibility dynamically
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    const heatSource = map.getSource('alltime-heatmap') as
      | maplibregl.GeoJSONSource
      | undefined;
    if (heatSource && heatmapGeoJson) {
      heatSource.setData(heatmapGeoJson);
    }

    const vis = showHeatmap ? 'visible' : 'none';
    if (map.getLayer('alltime-heatmap-routes')) {
      map.setLayoutProperty('alltime-heatmap-routes', 'visibility', vis);
    }
    if (map.getLayer('alltime-heatmap-density')) {
      map.setLayoutProperty('alltime-heatmap-density', 'visibility', vis);
    }
  }, [showHeatmap, heatmapGeoJson, styleRevision]);

  // Subscribe directly to 60fps RAF frames (zero React state re-renders)
  useEffect(() => {
    return controller.subscribeFrame((frame) => {
      applyFrameToMap(frame);
    });
  }, [controller, applyFrameToMap]);

  // Sync visit markers & trigger Corridor Pre-Staging when Trip or Style loads
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current || styleRevision === 0) return;

    for (const h of visitHandlesRef.current) {
      h.marker.remove();
    }
    visitHandlesRef.current = [];
    activeVisitIdRef.current = null;

    if (!trip) {
      lastStagedTripIdRef.current = null;
      stagingCleanupRef.current?.();
      stagingCleanupRef.current = null;
      onStagingChangeRef.current?.({ active: false, percent: 0, label: '' });

      const ghostSource = map.getSource('ghost-route') as
        | maplibregl.GeoJSONSource
        | undefined;
      ghostSource?.setData(EMPTY_FC);

      const activeSource = map.getSource('active-route') as
        | maplibregl.GeoJSONSource
        | undefined;
      activeSource?.setData(EMPTY_FC);

      if (puckRef.current) {
        puckRef.current.marker.getElement().style.display = 'none';
      }
      return;
    }

    if (puckRef.current) {
      puckRef.current.marker.getElement().style.display = 'block';
    }

    const newHandles: VisitMarkerHandle[] = trip.visits.map((visit) => {
      const displayName = resolveVisitDisplayName(
        visit,
        nicknamesRef.current,
        geocodeCacheRef.current
      );

      const rootEl = document.createElement('button');
      rootEl.type = 'button';
      rootEl.className =
        'group relative flex items-center justify-center cursor-pointer focus:outline-none';
      rootEl.title = `${displayName} (${formatDuration(visit.dwellDurationMs)})`;

      const ringEl = document.createElement('div');
      ringEl.className =
        'visit-pulse-ring absolute w-7 h-7 rounded-full bg-emerald-400/30 pointer-events-none transition-opacity duration-200';
      ringEl.style.opacity = '0';

      const dotEl = document.createElement('div');
      dotEl.className =
        'w-3 h-3 rounded-full bg-slate-900 border-2 border-white/85 shadow-md transition-all duration-200 group-hover:scale-125';

      const labelEl = document.createElement('div');
      labelEl.className =
        'absolute bottom-5 left-1/2 px-2 py-1 rounded-lg bg-slate-950/90 border border-white/15 backdrop-blur-md text-[10px] font-medium text-slate-100 whitespace-nowrap shadow-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-all duration-150';
      labelEl.style.transform = 'translate(-50%, 0)';
      labelEl.innerHTML = `<span class="font-semibold">${escapeHtml(
        displayName
      )}</span> <span class="text-emerald-300 ml-1">${escapeHtml(
        formatDuration(visit.dwellDurationMs)
      )}</span>`;

      rootEl.appendChild(ringEl);
      rootEl.appendChild(dotEl);
      rootEl.appendChild(labelEl);

      rootEl.addEventListener('click', (e) => {
        e.stopPropagation();
        controller.seekToTime(visit.startTimeMs);
      });

      const marker = new maplibregl.Marker({
        element: rootEl,
        anchor: 'center',
      })
        .setLngLat([visit.lng, visit.lat])
        .addTo(map);

      return { visit, marker, rootEl, ringEl, dotEl, labelEl };
    });

    visitHandlesRef.current = newHandles;

    // Only run blocking Corridor Pre-Staging when loading a genuinely NEW trip/day;
    // style switches on the active trip re-attach sources & solar lighting instantaneously.
    if (lastStagedTripIdRef.current !== trip.id) {
      runCorridorPreStaging(
        map,
        trip,
        autoPlayRef.current,
        settingsRef.current.enable3D
          ? 'Staging 3D Corridor...'
          : 'Staging Route Corridor...'
      );
    } else {
      const prebaked = controller.getPrebakedRoute();
      const routeGeoJson = prebaked?.geojson ?? EMPTY_FC;
      const ghostSource = map.getSource('ghost-route') as
        | maplibregl.GeoJSONSource
        | undefined;
      ghostSource?.setData(routeGeoJson);

      lastSolarUpdateRef.current = null;
      const latestSnap = controller.getSnapshot();
      if (latestSnap) {
        updateActiveRouteTrail(map, latestSnap, true);
        applyFrameToMap(latestSnap);
      }
    }
  }, [trip, styleRevision, controller, runCorridorPreStaging, updateActiveRouteTrail, applyFrameToMap]);

  // Live-update visit marker labels whenever geocoder resolves or user edits a nickname
  useEffect(() => {
    for (const handle of visitHandlesRef.current) {
      const displayName = resolveVisitDisplayName(
        handle.visit,
        nicknames,
        geocodeCache
      );
      handle.rootEl.title = `${displayName} (${formatDuration(
        handle.visit.dwellDurationMs
      )})`;
      handle.labelEl.innerHTML = `<span class="font-semibold">${escapeHtml(
        displayName
      )}</span> <span class="text-emerald-300 ml-1">${escapeHtml(
        formatDuration(handle.visit.dwellDurationMs)
      )}</span>`;
    }
  }, [nicknames, geocodeCache]);

  const prevCameraModeRef = useRef<CameraMode>(cameraMode);
  const prevRecenterNonceRef = useRef<number>(recenterNonce);
  useEffect(() => {
    const map = mapRef.current;
    const currentTrip = tripRef.current;
    const modeChanged = prevCameraModeRef.current !== cameraMode;
    const recenterTriggered = prevRecenterNonceRef.current !== recenterNonce;
    if ((modeChanged || recenterTriggered) && map && styleLoadedRef.current && currentTrip) {
      prevCameraModeRef.current = cameraMode;
      prevRecenterNonceRef.current = recenterNonce;
      if (!isStagingRef.current) {
        snapToActiveViewpoint(map, currentTrip, true);
      }
    }
  }, [cameraMode, recenterNonce, snapToActiveViewpoint]);

  // Gesture-safe single-tap & double-tap detection on empty map space
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const activePointers = new Set<number>();
    let maxPointers = 0;
    let downX = 0;
    let downY = 0;
    let downTime = 0;
    let ignoredTarget = false;
    let lastTapTime = 0;
    let pendingSingleTapTimer: number | null = null;

    const onPointerDown = (e: PointerEvent) => {
      activePointers.add(e.pointerId);
      maxPointers = Math.max(maxPointers, activePointers.size);
      if (activePointers.size === 1) {
        const targetEl = e.target as HTMLElement | null;
        ignoredTarget = Boolean(
          targetEl?.closest('button, a, input, .maplibregl-ctrl-attrib')
        );
        downX = e.clientX;
        downY = e.clientY;
        downTime = performance.now();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      if (activePointers.size > 0) return;

      const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
      const dur = performance.now() - downTime;
      const wasSingleCleanTap =
        !ignoredTarget && maxPointers === 1 && dist < 6 && dur < 260;

      maxPointers = 0;
      if (!wasSingleCleanTap || !tripRef.current) return;

      if (!cinemaModeRef.current) {
        onMapSingleTapRef.current?.();
        return;
      }

      // Inside Cinema Mode: distinguish double-tap (Play/Pause) vs single-tap (Exit)
      const now = performance.now();
      if (now - lastTapTime < 260) {
        if (pendingSingleTapTimer !== null) {
          window.clearTimeout(pendingSingleTapTimer);
          pendingSingleTapTimer = null;
        }
        lastTapTime = 0;
        onMapDoubleTapRef.current?.();
      } else {
        lastTapTime = now;
        pendingSingleTapTimer = window.setTimeout(() => {
          pendingSingleTapTimer = null;
          onMapSingleTapRef.current?.();
        }, 250);
      }
    };

    const onPointerCancel = (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      if (activePointers.size === 0) {
        maxPointers = 0;
      }
    };

    container.addEventListener('pointerdown', onPointerDown, { passive: true });
    container.addEventListener('pointerup', onPointerUp, { passive: true });
    container.addEventListener('pointercancel', onPointerCancel, { passive: true });

    return () => {
      if (pendingSingleTapTimer !== null) {
        window.clearTimeout(pendingSingleTapTimer);
      }
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerCancel);
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
