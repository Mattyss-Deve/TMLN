import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { AnimationController } from '../engine/animationController';
import type {
  CameraMode,
  PlaceVisit,
  TelemetryFrame,
  TransportMode,
  Trip,
} from '../types/timeline';
import { formatDuration } from '../utils/format';
import { clamp, lerp, lerpAngle, MODE_COLORS } from '../utils/geo';

const CARTO_DARK_STYLE =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

interface MapCanvasProps {
  controller: AnimationController;
  trip: Trip | null;
  cameraMode: CameraMode;
  recenterNonce: number;
  onCameraModeChange: (mode: CameraMode) => void;
  sidebarOpen: boolean;
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

function getTargetZoomForFrame(frame: TelemetryFrame): number {
  if (frame.mode === 'FLYING' || frame.speedKmh > 220) return 7.6;
  if (frame.mode === 'TRANSIT' || frame.speedKmh > 95) return 11.8;
  if (frame.mode === 'DRIVING' || frame.speedKmh > 28) return 13.4;
  if (frame.mode === 'CYCLING' || frame.speedKmh > 7) return 14.8;
  return 15.8;
}

function buildGhostRouteGeoJson(trip: Trip | null): GeoJSON.FeatureCollection {
  if (!trip || trip.waypoints.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: trip.waypoints.map((w) => [w.lng, w.lat]),
        },
      },
    ],
  };
}

function buildActiveRouteGeoJson(
  trip: Trip,
  frame: TelemetryFrame
): GeoJSON.FeatureCollection {
  const waypoints = trip.waypoints;
  if (waypoints.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }

  const endIdx = clamp(frame.traveledWaypointIndex, 0, waypoints.length - 1);
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];

  let runMode: TransportMode = waypoints[0].mode;
  let runCoords: [number, number][] = [[waypoints[0].lng, waypoints[0].lat]];

  for (let i = 1; i <= endIdx; i++) {
    const wp = waypoints[i];
    const coord: [number, number] = [wp.lng, wp.lat];

    if (wp.mode !== runMode) {
      runCoords.push(coord);
      if (runCoords.length >= 2) {
        features.push({
          type: 'Feature',
          properties: {
            mode: runMode,
            color: MODE_COLORS[runMode],
          },
          geometry: {
            type: 'LineString',
            coordinates: runCoords,
          },
        });
      }
      runMode = wp.mode;
      runCoords = [coord];
    } else {
      runCoords.push(coord);
    }
  }

  // Append live interpolated tip position
  const tipCoord: [number, number] = [frame.lng, frame.lat];
  const lastCoord = runCoords[runCoords.length - 1];
  if (
    Math.abs(lastCoord[0] - tipCoord[0]) > 1e-7 ||
    Math.abs(lastCoord[1] - tipCoord[1]) > 1e-7
  ) {
    runCoords.push(tipCoord);
  }

  if (runCoords.length >= 2) {
    features.push({
      type: 'Feature',
      properties: {
        mode: runMode,
        color: MODE_COLORS[runMode],
      },
      geometry: {
        type: 'LineString',
        coordinates: runCoords,
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

function createPuckElement() {
  const root = document.createElement('div');
  root.className = 'relative w-20 h-20 pointer-events-none select-none';

  // Pulsing sonar halo
  const sonar = document.createElement('div');
  sonar.className =
    'puck-sonar-ring absolute left-1/2 top-1/2 w-9 h-9 rounded-full';
  sonar.style.backgroundColor = 'rgba(34, 211, 238, 0.35)';

  // Directional heading cone SVG (points straight up = 0 deg North)
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

  // Center luminous dot
  const dot = document.createElement('div');
  dot.className =
    'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white transition-colors duration-150';
  dot.style.backgroundColor = '#22d3ee';
  dot.style.boxShadow = '0 0 14px #22d3ee';

  root.appendChild(sonar);
  root.appendChild(svg);
  root.appendChild(dot);

  return { root, sonar, dot, stopStart, stopEnd };
}

export function MapCanvas({
  controller,
  trip,
  cameraMode,
  recenterNonce,
  onCameraModeChange,
  sidebarOpen,
  onMapError,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapLoadedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  const tripRef = useRef<Trip | null>(trip);
  tripRef.current = trip;

  const cameraModeRef = useRef<CameraMode>(cameraMode);
  cameraModeRef.current = cameraMode;

  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;

  const onCameraModeChangeRef = useRef(onCameraModeChange);
  onCameraModeChangeRef.current = onCameraModeChange;

  const onMapErrorRef = useRef(onMapError);
  onMapErrorRef.current = onMapError;

  const puckRef = useRef<{
    marker: maplibregl.Marker;
    sonar: HTMLDivElement;
    dot: HTMLDivElement;
    stopStart: SVGStopElement;
    stopEnd: SVGStopElement;
    lastMode?: TransportMode;
  } | null>(null);

  const visitHandlesRef = useRef<VisitMarkerHandle[]>([]);
  const activeVisitIdRef = useRef<string | null>(null);

  // Smooth camera tracking state for CHASE mode
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

  const applyFrameToMap = useCallback(
    (frame: TelemetryFrame) => {
      const map = mapRef.current;
      if (!map || !mapLoadedRef.current) return;

      const currentTrip = tripRef.current;
      if (!currentTrip || currentTrip.id !== frame.tripId) return;

      // 1. Update active glowing GeoJSON route
      const activeSource = map.getSource('active-route') as
        | maplibregl.GeoJSONSource
        | undefined;
      if (activeSource) {
        activeSource.setData(buildActiveRouteGeoJson(currentTrip, frame));
      }

      // 2. Update pulsing puck position, bearing, and mode color
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

      // 4. Camera Chase tracking
      if (cameraModeRef.current === 'CHASE') {
        const now = performance.now();
        if (now < chaseCameraRef.current.transitionUntilMs) {
          return;
        }

        const targetZoom = getTargetZoomForFrame(frame);
        const targetBearing =
          frame.mode === 'STILL' ? chaseCameraRef.current.bearing : frame.bearing;
        const targetPitch = 50;

        if (!chaseCameraRef.current.initialized) {
          chaseCameraRef.current.zoom = targetZoom;
          chaseCameraRef.current.bearing = targetBearing;
          chaseCameraRef.current.pitch = targetPitch;
          chaseCameraRef.current.initialized = true;
        } else {
          chaseCameraRef.current.zoom = lerp(
            chaseCameraRef.current.zoom,
            targetZoom,
            0.055
          );
          chaseCameraRef.current.pitch = lerp(
            chaseCameraRef.current.pitch,
            targetPitch,
            0.08
          );
          if (frame.mode !== 'STILL') {
            chaseCameraRef.current.bearing = lerpAngle(
              chaseCameraRef.current.bearing,
              targetBearing,
              0.07
            );
          }
        }

        map.jumpTo({
          center: [frame.lng, frame.lat],
          zoom: chaseCameraRef.current.zoom,
          pitch: chaseCameraRef.current.pitch,
          bearing: chaseCameraRef.current.bearing,
        });
      }
    },
    [frameVisitHighlight]
  );

  // Initialize MapLibre GL once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let errorReported = false;
    const map = new maplibregl.Map({
      container,
      style: CARTO_DARK_STYLE,
      center: [-122.42, 37.79],
      zoom: 2.3,
      pitch: 0,
      bearing: 0,
      maxPitch: 75,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    mapRef.current = map;

    const unlockToFreeMode = (ev: { originalEvent?: unknown }) => {
      if (!ev.originalEvent) return;
      if (cameraModeRef.current === 'CHASE') {
        onCameraModeChangeRef.current('FREE');
      }
    };

    map.on('dragstart', unlockToFreeMode);
    map.on('wheel', unlockToFreeMode);
    map.on('rotatestart', unlockToFreeMode);
    map.on('pitchstart', unlockToFreeMode);

    map.on('error', (ev) => {
      const msg = ev?.error?.message || '';
      if (!errorReported && msg && !msg.includes('AbortError')) {
        errorReported = true;
        onMapErrorRef.current?.(`Map tile/style notice: ${msg}`);
      }
    });

    map.on('load', () => {
      map.addSource('ghost-route', {
        type: 'geojson',
        data: buildGhostRouteGeoJson(tripRef.current),
      });

      map.addLayer({
        id: 'ghost-route-line',
        type: 'line',
        source: 'ghost-route',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#94a3b8',
          'line-width': 3,
          'line-opacity': 0.24,
        },
      });

      map.addSource('active-route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: 'active-route-glow',
        type: 'line',
        source: 'active-route',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 12,
          'line-blur': 7,
          'line-opacity': 0.48,
        },
      });

      map.addLayer({
        id: 'active-route-core',
        type: 'line',
        source: 'active-route',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3.5,
          'line-opacity': 0.98,
        },
      });

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
        sonar: puckEl.sonar,
        dot: puckEl.dot,
        stopStart: puckEl.stopStart,
        stopEnd: puckEl.stopEnd,
      };

      mapLoadedRef.current = true;
      setMapReady(true);

      const snap = controller.getSnapshot();
      if (snap) {
        applyFrameToMap(snap);
      }
    });

    return () => {
      mapLoadedRef.current = false;
      setMapReady(false);
      for (const h of visitHandlesRef.current) {
        h.marker.remove();
      }
      visitHandlesRef.current = [];
      puckRef.current?.marker.remove();
      puckRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [applyFrameToMap, controller]);

  // Subscribe to 60fps animation frames
  useEffect(() => {
    return controller.subscribeFrame((frame) => {
      applyFrameToMap(frame);
    });
  }, [controller, applyFrameToMap]);

  // Sync ghost route, visit markers, and initial framing when Trip changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || !mapReady) return;

    // Clear previous visit markers
    for (const h of visitHandlesRef.current) {
      h.marker.remove();
    }
    visitHandlesRef.current = [];
    activeVisitIdRef.current = null;

    const ghostSource = map.getSource('ghost-route') as
      | maplibregl.GeoJSONSource
      | undefined;
    if (ghostSource) {
      ghostSource.setData(buildGhostRouteGeoJson(trip));
    }

    const activeSource = map.getSource('active-route') as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!trip) {
      if (activeSource) {
        activeSource.setData({ type: 'FeatureCollection', features: [] });
      }
      if (puckRef.current) {
        puckRef.current.marker.getElement().style.display = 'none';
      }
      return;
    }

    if (puckRef.current) {
      puckRef.current.marker.getElement().style.display = 'block';
    }

    // Create interactive Place Visit markers
    const newHandles: VisitMarkerHandle[] = trip.visits.map((visit) => {
      const rootEl = document.createElement('button');
      rootEl.type = 'button';
      rootEl.className =
        'group relative flex items-center justify-center cursor-pointer focus:outline-none';
      rootEl.title = `${visit.name} (${formatDuration(visit.dwellDurationMs)})`;

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
        visit.name
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

    const snap = controller.getSnapshot();
    if (snap) {
      applyFrameToMap(snap);
    }

    // Frame the newly selected trip
    chaseCameraRef.current.initialized = false;
    if (cameraModeRef.current === 'OVERVIEW') {
      map.fitBounds(trip.bounds, {
        padding: {
          top: 90,
          bottom: 145,
          left: sidebarOpenRef.current ? 360 : 72,
          right: 310,
        },
        pitch: 22,
        bearing: 0,
        duration: 850,
        maxZoom: 15.5,
      });
    } else if (cameraModeRef.current === 'CHASE' && snap) {
      const targetZoom = getTargetZoomForFrame(snap);
      chaseCameraRef.current.zoom = targetZoom;
      chaseCameraRef.current.bearing = snap.bearing;
      chaseCameraRef.current.pitch = 50;
      chaseCameraRef.current.initialized = true;
      chaseCameraRef.current.transitionUntilMs = performance.now() + 720;

      map.easeTo({
        center: [snap.lng, snap.lat],
        zoom: targetZoom,
        pitch: 50,
        bearing: snap.bearing,
        duration: 700,
      });
    }
  }, [trip, mapReady, controller, applyFrameToMap]);

  // Handle explicit camera mode switching (UI buttons or keyboard shortcut)
  const applyCameraModeTransition = useCallback(
    (nextMode: CameraMode) => {
      const map = mapRef.current;
      const currentTrip = tripRef.current;
      if (!map || !mapLoadedRef.current || !currentTrip) return;

      if (nextMode === 'OVERVIEW') {
        map.fitBounds(currentTrip.bounds, {
          padding: {
            top: 90,
            bottom: 145,
            left: sidebarOpenRef.current ? 360 : 72,
            right: 310,
          },
          pitch: 22,
          bearing: 0,
          duration: 800,
          maxZoom: 15.5,
        });
      } else if (nextMode === 'CHASE') {
        const snap = controller.getSnapshot();
        if (snap) {
          const targetZoom = getTargetZoomForFrame(snap);
          chaseCameraRef.current.zoom = targetZoom;
          chaseCameraRef.current.bearing = snap.bearing;
          chaseCameraRef.current.pitch = 50;
          chaseCameraRef.current.initialized = true;
          chaseCameraRef.current.transitionUntilMs = performance.now() + 620;

          map.easeTo({
            center: [snap.lng, snap.lat],
            zoom: targetZoom,
            pitch: 50,
            bearing: snap.bearing,
            duration: 600,
          });
        }
      }
    },
    [controller]
  );

  const prevCameraModeRef = useRef<CameraMode>(cameraMode);
  const prevRecenterNonceRef = useRef<number>(recenterNonce);
  useEffect(() => {
    const modeChanged = prevCameraModeRef.current !== cameraMode;
    const recenterTriggered = prevRecenterNonceRef.current !== recenterNonce;
    if (modeChanged || recenterTriggered) {
      prevCameraModeRef.current = cameraMode;
      prevRecenterNonceRef.current = recenterNonce;
      applyCameraModeTransition(cameraMode);
    }
  }, [cameraMode, recenterNonce, applyCameraModeTransition]);

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
