import type { MapStyleId, SolarPhase, SolarPosition } from '../types/timeline';
import { clamp } from './geo';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export interface SolarAtmosphere {
  light: {
    anchor: 'map';
    position: [number, number, number]; // [radial, azimuthalDeg, polarDeg]
    color: string;
    intensity: number;
  };
  sky: {
    'sky-color': string;
    'sky-horizon-blend': number;
    'horizon-color': string;
    'horizon-fog-blend': number;
    'fog-color': string;
    'fog-ground-blend': number;
    'atmosphere-blend': number;
  };
  buildingColor: string;
  buildingOpacity: number;
  routeGlowOpacityBoost: number; // multiplier 1.0..1.45
}

function normalizeDeg(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

/**
 * Computes exact solar elevation (-90°..+90°), compass azimuth (0°..360°),
 * and human-readable lighting phase from latitude, longitude, and UTC epoch ms.
 * Uses NOAA / USNO low-precision solar ephemeris (~0.02° accuracy).
 */
export function computeSolarPosition(
  latDeg: number,
  lngDeg: number,
  timestampMs: number
): SolarPosition {
  const safeLat = clamp(Number.isFinite(latDeg) ? latDeg : 0, -89.99, 89.99);
  const safeLng = Number.isFinite(lngDeg) ? lngDeg : 0;
  const safeTs = Number.isFinite(timestampMs) ? timestampMs : Date.now();

  // Days since J2000.0 (2000-01-01T12:00:00Z = 946728000000 ms)
  const d = (safeTs - 946_728_000_000) / 86_400_000;

  // Mean longitude & mean anomaly of the Sun (degrees)
  const L = normalizeDeg(280.460 + 0.9856474 * d);
  const g = normalizeDeg(357.528 + 0.9856003 * d);
  const gRad = g * DEG2RAD;

  // Ecliptic longitude & obliquity of the ecliptic
  const lambda = normalizeDeg(
    L + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2 * gRad)
  );
  const lambdaRad = lambda * DEG2RAD;
  const epsilonRad = (23.439 - 0.0000004 * d) * DEG2RAD;

  // Sun's right ascension (rad) & declination (rad)
  const sinLambda = Math.sin(lambdaRad);
  const cosLambda = Math.cos(lambdaRad);
  const raRad = Math.atan2(Math.cos(epsilonRad) * sinLambda, cosLambda);
  const declRad = Math.asin(clamp(Math.sin(epsilonRad) * sinLambda, -1, 1));

  // Greenwich Mean Sidereal Time (degrees) & Local Hour Angle (rad)
  const gmstDeg = normalizeDeg(280.46061837 + 360.98564736629 * d);
  const lstDeg = normalizeDeg(gmstDeg + safeLng);
  const haRad = (lstDeg * DEG2RAD) - raRad;

  const latRad = safeLat * DEG2RAD;
  const sinAlt = clamp(
    Math.sin(latRad) * Math.sin(declRad) +
      Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad),
    -1,
    1
  );
  const altRad = Math.asin(sinAlt);
  const elevationDeg = altRad * RAD2DEG;

  // Compass azimuth measured clockwise from True North (0°=N, 90°=E, 180°=S, 270°=W)
  const yAz = -Math.sin(haRad) * Math.cos(declRad);
  const xAz =
    Math.sin(declRad) * Math.cos(latRad) -
    Math.cos(declRad) * Math.sin(latRad) * Math.cos(haRad);
  const azimuthDeg = normalizeDeg(Math.atan2(yAz, xAz) * RAD2DEG);

  const isMorning = azimuthDeg < 180;
  let phase: SolarPhase;
  if (elevationDeg < -12) {
    phase = 'Night';
  } else if (elevationDeg < -4) {
    phase = 'Blue Hour';
  } else if (elevationDeg < 6) {
    phase = isMorning ? 'Dawn' : 'Dusk';
  } else if (elevationDeg < 18) {
    phase = 'Golden Hour';
  } else {
    phase = 'Daylight';
  }

  return {
    elevationDeg,
    azimuthDeg,
    phase,
    isNight: elevationDeg < -4,
  };
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

function lerpColor(hexA: string, hexB: string, t: number): string {
  const k = clamp(t, 0, 1);
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * k);
  const g = Math.round(a.g + (b.g - a.g) * k);
  const bl = Math.round(a.b + (b.b - a.b) * k);
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}

function lerpNum(a: number, b: number, t: number): number {
  const k = clamp(t, 0, 1);
  return a + (b - a) * k;
}

interface PaletteStop {
  elev: number;
  lightColor: string;
  lightIntensity: number;
  skyColor: string;
  horizonColor: string;
  fogColor: string;
  buildingDark: string;
  buildingLight: string;
  buildingSat: string;
  glowBoost: number;
}

const SOLAR_STOPS: PaletteStop[] = [
  {
    elev: -18,
    lightColor: '#3b4f78',
    lightIntensity: 0.28,
    skyColor: '#050811',
    horizonColor: '#0c1528',
    fogColor: '#070b14',
    buildingDark: '#0f172a',
    buildingLight: '#1e293b',
    buildingSat: '#111827',
    glowBoost: 1.45,
  },
  {
    elev: -6,
    lightColor: '#6b7db3',
    lightIntensity: 0.42,
    skyColor: '#0b1429',
    horizonColor: '#253966',
    fogColor: '#131d36',
    buildingDark: '#16213a',
    buildingLight: '#334155',
    buildingSat: '#182236',
    glowBoost: 1.32,
  },
  {
    elev: 2,
    lightColor: '#fb923c',
    lightIntensity: 0.68,
    skyColor: '#1f294d',
    horizonColor: '#f59e0b',
    fogColor: '#3f2e3e',
    buildingDark: '#2c2536',
    buildingLight: '#c8a68a',
    buildingSat: '#2a2433',
    glowBoost: 1.18,
  },
  {
    elev: 12,
    lightColor: '#fde68a',
    lightIntensity: 0.78,
    skyColor: '#385e96',
    horizonColor: '#fbbf77',
    fogColor: '#7c8ca3',
    buildingDark: '#263449',
    buildingLight: '#d9cbb8',
    buildingSat: '#283344',
    glowBoost: 1.06,
  },
  {
    elev: 35,
    lightColor: '#f8fafc',
    lightIntensity: 0.85,
    skyColor: '#2d68b8',
    horizonColor: '#9bc4e8',
    fogColor: '#cbd5e1',
    buildingDark: '#1e2d44',
    buildingLight: '#d6dee8',
    buildingSat: '#1f2b3d',
    glowBoost: 1.0,
  },
];

/**
 * Computes smoothly interpolated directional 3D light, sky/fog atmosphere,
 * building extrusion tint, and route glow boost for MapLibre GL.
 */
export function computeSolarAtmosphere(
  solar: SolarPosition,
  mapStyle: MapStyleId
): SolarAtmosphere {
  const elev = solar.elevationDeg;
  let s0 = SOLAR_STOPS[0];
  let s1 = SOLAR_STOPS[SOLAR_STOPS.length - 1];
  let localT = 0;

  if (elev <= SOLAR_STOPS[0].elev) {
    s0 = SOLAR_STOPS[0];
    s1 = SOLAR_STOPS[0];
    localT = 0;
  } else if (elev >= SOLAR_STOPS[SOLAR_STOPS.length - 1].elev) {
    s0 = SOLAR_STOPS[SOLAR_STOPS.length - 1];
    s1 = s0;
    localT = 0;
  } else {
    for (let i = 0; i < SOLAR_STOPS.length - 1; i++) {
      if (elev >= SOLAR_STOPS[i].elev && elev <= SOLAR_STOPS[i + 1].elev) {
        s0 = SOLAR_STOPS[i];
        s1 = SOLAR_STOPS[i + 1];
        localT = (elev - s0.elev) / Math.max(0.001, s1.elev - s0.elev);
        break;
      }
    }
  }

  // Polar angle for MapLibre light (0° = straight overhead, 90° = horizon)
  const polarDeg = clamp(90 - Math.max(4, elev), 14, 84);
  const azimuthDeg = normalizeDeg(solar.azimuthDeg);

  // Dark style keeps deeper obsidian sky/fog so map never washes out
  const skyColor =
    mapStyle === 'DARK'
      ? lerpColor('#050811', lerpColor(s0.skyColor, s1.skyColor, localT), 0.48)
      : lerpColor(s0.skyColor, s1.skyColor, localT);
  const horizonColor =
    mapStyle === 'DARK'
      ? lerpColor('#0a1120', lerpColor(s0.horizonColor, s1.horizonColor, localT), 0.52)
      : lerpColor(s0.horizonColor, s1.horizonColor, localT);
  const fogColor =
    mapStyle === 'DARK'
      ? lerpColor('#070a12', lerpColor(s0.fogColor, s1.fogColor, localT), 0.42)
      : lerpColor(s0.fogColor, s1.fogColor, localT);

  const buildingColor =
    mapStyle === 'DAYLIGHT'
      ? lerpColor(s0.buildingLight, s1.buildingLight, localT)
      : mapStyle === 'SATELLITE'
        ? lerpColor(s0.buildingSat, s1.buildingSat, localT)
        : lerpColor(s0.buildingDark, s1.buildingDark, localT);

  const buildingOpacity =
    mapStyle === 'SATELLITE'
      ? lerpNum(0.62, 0.54, clamp((elev + 12) / 30, 0, 1))
      : lerpNum(0.82, 0.72, clamp((elev + 12) / 30, 0, 1));

  return {
    light: {
      anchor: 'map',
      position: [1.5, azimuthDeg, polarDeg],
      color: lerpColor(s0.lightColor, s1.lightColor, localT),
      intensity: Number(lerpNum(s0.lightIntensity, s1.lightIntensity, localT).toFixed(2)),
    },
    sky: {
      'sky-color': skyColor,
      'sky-horizon-blend': 0.55,
      'horizon-color': horizonColor,
      'horizon-fog-blend': 0.5,
      'fog-color': fogColor,
      'fog-ground-blend': mapStyle === 'DARK' ? 0.32 : 0.45,
      'atmosphere-blend': 0.65,
    },
    buildingColor,
    buildingOpacity: Number(buildingOpacity.toFixed(2)),
    routeGlowOpacityBoost: Number(
      lerpNum(s0.glowBoost, s1.glowBoost, localT).toFixed(2)
    ),
  };
}

export function getSolarPhaseAccent(phase: SolarPhase): string {
  switch (phase) {
    case 'Night':
      return '#818cf8';
    case 'Blue Hour':
      return '#60a5fa';
    case 'Dawn':
      return '#fb923c';
    case 'Golden Hour':
      return '#fbbf24';
    case 'Dusk':
      return '#f472b6';
    case 'Daylight':
    default:
      return '#fde047';
  }
}
