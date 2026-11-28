import type { MapStyleId, SolarPhase, SolarPosition } from '../types/timeline';
import { clamp } from './geo';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export interface SolarRasterGrading {
  brightnessMax: number;
  brightnessMin: number;
  contrast: number;
  saturation: number;
}

export interface SolarTintGrading {
  color: string;
  opacity: number;
}

export interface SolarFogSpec {
  color: string;
  'high-color': string;
  'space-color': string;
  'star-intensity': number; // 0..0.9
}

export interface SolarPuckLighting {
  shadowDxPx: number;
  shadowDyPx: number;
  shadowOpacity: number; // 0..0.6 during daytime
  headlampOpacity: number; // 0..1 when elevation < 2°
  groundPoolOpacity: number; // 0..0.88 ambient ground pool at night
}

export interface DynamicVectorPalette {
  backgroundColor: string;
  landColor: string;
  parkColor: string;
  waterColor: string;
  majorRoadColor: string;
  minorRoadColor: string;
  labelColor: string;
  labelHaloColor: string;
  buildingBaseColor: string;
  buildingMidColor: string;
  buildingRoofColor: string;
}

export interface SolarAtmosphere {
  darkness: number; // 0 (noon) .. 1 (deep night)
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
  fog: SolarFogSpec;
  raster: SolarRasterGrading;
  tint: SolarTintGrading;
  dynamicVector: DynamicVectorPalette;
  buildingColor: string;
  buildingOpacity: number;
  routeGlowOpacityBoost: number; // multiplier 1.0..1.6
  puck: SolarPuckLighting;
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

  const L = normalizeDeg(280.460 + 0.9856474 * d);
  const g = normalizeDeg(357.528 + 0.9856003 * d);
  const gRad = g * DEG2RAD;

  const lambda = normalizeDeg(
    L + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2 * gRad)
  );
  const lambdaRad = lambda * DEG2RAD;
  const epsilonRad = (23.439 - 0.0000004 * d) * DEG2RAD;

  const sinLambda = Math.sin(lambdaRad);
  const cosLambda = Math.cos(lambdaRad);
  const raRad = Math.atan2(Math.cos(epsilonRad) * sinLambda, cosLambda);
  const declRad = Math.asin(clamp(Math.sin(epsilonRad) * sinLambda, -1, 1));

  const gmstDeg = normalizeDeg(280.46061837 + 360.98564736629 * d);
  const lstDeg = normalizeDeg(gmstDeg + safeLng);
  const haRad = lstDeg * DEG2RAD - raRad;

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
  darkness: number;
  lightColor: string;
  lightIntensity: number;
  skyColor: string;
  horizonColor: string;
  fogColor: string;
  spaceColor: string;
  starIntensity: number;
  rasterMax: number;
  rasterMin: number;
  rasterContrast: number;
  rasterSat: number;
  tintColor: string;
  tintDynamicOpacity: number;
  bgColor: string;
  landColor: string;
  parkColor: string;
  waterColor: string;
  majorRoadColor: string;
  minorRoadColor: string;
  labelColor: string;
  labelHaloColor: string;
  buildingBase: string;
  buildingMid: string;
  buildingRoof: string;
  glowBoost: number;
}

const SOLAR_STOPS: PaletteStop[] = [
  {
    // Deep Starry Midnight
    elev: -18,
    darkness: 1.0,
    lightColor: '#486299',
    lightIntensity: 0.26,
    skyColor: '#040711',
    horizonColor: '#0c1428',
    fogColor: '#050914',
    spaceColor: '#02040a',
    starIntensity: 0.9,
    rasterMax: 0.28,
    rasterMin: 0.02,
    rasterContrast: 0.22,
    rasterSat: -0.35,
    tintColor: '#040711',
    tintDynamicOpacity: 0.22,
    bgColor: '#060a13',
    landColor: '#0b1120',
    parkColor: '#09191b',
    waterColor: '#040915',
    majorRoadColor: '#FFB74D', // Warm golden-amber city streetglow
    minorRoadColor: '#243147',
    labelColor: '#cbd5e1',
    labelHaloColor: '#040711',
    buildingBase: '#0d1526',
    buildingMid: '#2a3752', // Subtle slate + lit window elevation
    buildingRoof: '#8c6b32', // Warm subtle amber rooftop glow
    glowBoost: 1.6,
  },
  {
    // Purple-Blue Twilight (Blue Hour)
    elev: -6,
    darkness: 0.72,
    lightColor: '#7a8ec9',
    lightIntensity: 0.44,
    skyColor: '#1B224B',
    horizonColor: '#363E7A',
    fogColor: '#171E42',
    spaceColor: '#080C22',
    starIntensity: 0.55,
    rasterMax: 0.5,
    rasterMin: 0.015,
    rasterContrast: 0.22,
    rasterSat: -0.18,
    tintColor: '#1B224B',
    tintDynamicOpacity: 0.16,
    bgColor: '#121831',
    landColor: '#1a2342',
    parkColor: '#152c36',
    waterColor: '#0c1836',
    majorRoadColor: '#FDBA74',
    minorRoadColor: '#3b4a6b',
    labelColor: '#e2e8f0',
    labelHaloColor: '#0d1329',
    buildingBase: '#1b2645',
    buildingMid: '#3a4a70',
    buildingRoof: '#a67b4b',
    glowBoost: 1.4,
  },
  {
    // Sunrise / Sunset / Warm Golden Horizon
    elev: 2,
    darkness: 0.3,
    lightColor: '#FF8A3D',
    lightIntensity: 0.74,
    skyColor: '#3d528a',
    horizonColor: '#FF8A3D',
    fogColor: '#FFD180',
    spaceColor: '#162042',
    starIntensity: 0.1,
    rasterMax: 0.8,
    rasterMin: 0.005,
    rasterContrast: 0.2,
    rasterSat: 0.18,
    tintColor: '#FF8A3D',
    tintDynamicOpacity: 0.12,
    bgColor: '#dcd2c6',
    landColor: '#e4d8ca',
    parkColor: '#b7c7a0',
    waterColor: '#6d94b8',
    majorRoadColor: '#FFD180',
    minorRoadColor: '#f5ebe0',
    labelColor: '#2d2633',
    labelHaloColor: '#fff4e6',
    buildingBase: '#d4bfa8',
    buildingMid: '#e6c89e',
    buildingRoof: '#f5d29c',
    glowBoost: 1.18,
  },
  {
    // Upper Golden Hour
    elev: 12,
    darkness: 0.1,
    lightColor: '#FFD180',
    lightIntensity: 0.84,
    skyColor: '#568fd6',
    horizonColor: '#FFD180',
    fogColor: '#e6dfd5',
    spaceColor: '#1e427d',
    starIntensity: 0.0,
    rasterMax: 0.94,
    rasterMin: 0.0,
    rasterContrast: 0.1,
    rasterSat: 0.12,
    tintColor: '#FFD180',
    tintDynamicOpacity: 0.05,
    bgColor: '#ece7df',
    landColor: '#f0ebe2',
    parkColor: '#c8deb6',
    waterColor: '#88bbe6',
    majorRoadColor: '#fde68a',
    minorRoadColor: '#ffffff',
    labelColor: '#1e293b',
    labelHaloColor: '#ffffff',
    buildingBase: '#dfd6c8',
    buildingMid: '#e8dfd1',
    buildingRoof: '#f2eadc',
    glowBoost: 1.06,
  },
  {
    // Crisp Azure Daylight (Noon)
    elev: 35,
    darkness: 0.0,
    lightColor: '#f8fafc',
    lightIntensity: 0.92,
    skyColor: '#87BFFF',
    horizonColor: '#d2e8ff',
    fogColor: '#e2edf8',
    spaceColor: '#2a62b5',
    starIntensity: 0.0,
    rasterMax: 1.0,
    rasterMin: 0.0,
    rasterContrast: 0.0,
    rasterSat: 0.0,
    tintColor: '#87BFFF',
    tintDynamicOpacity: 0.0,
    bgColor: '#f2f0eb',
    landColor: '#f4f2ed',
    parkColor: '#cde4bc',
    waterColor: '#93c5fd',
    majorRoadColor: '#fde68a',
    minorRoadColor: '#ffffff',
    labelColor: '#1e293b',
    labelHaloColor: '#ffffff',
    buildingBase: '#d8dee6',
    buildingMid: '#e2e7ee',
    buildingRoof: '#eef2f6',
    glowBoost: 1.0,
  },
];

/**
 * Computes full-scene solar grading for Dynamic Day/Night mode (sky/fog/stars,
 * ground/park/water/lit city roads, 3D building facades, directional sun shadow,
 * and bright night headlamp + ground pool).
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

  const darkness = Number(lerpNum(s0.darkness, s1.darkness, localT).toFixed(3));
  const polarDeg = clamp(90 - Math.max(4, elev), 14, 84);
  const azimuthDeg = normalizeDeg(solar.azimuthDeg);

  const skyColor = lerpColor(s0.skyColor, s1.skyColor, localT);
  const horizonColor = lerpColor(s0.horizonColor, s1.horizonColor, localT);
  const fogColor = lerpColor(s0.fogColor, s1.fogColor, localT);
  const spaceColor = lerpColor(s0.spaceColor, s1.spaceColor, localT);
  const starIntensity = Number(
    lerpNum(s0.starIntensity, s1.starIntensity, localT).toFixed(2)
  );

  const tintColor = lerpColor(s0.tintColor, s1.tintColor, localT);
  const tintOpacity =
    mapStyle === 'DYNAMIC'
      ? lerpNum(s0.tintDynamicOpacity, s1.tintDynamicOpacity, localT)
      : 0;

  const buildingBaseColor = lerpColor(s0.buildingBase, s1.buildingBase, localT);
  const buildingMidColor = lerpColor(s0.buildingMid, s1.buildingMid, localT);
  const buildingRoofColor = lerpColor(s0.buildingRoof, s1.buildingRoof, localT);

  const buildingOpacity =
    mapStyle === 'SATELLITE'
      ? 0.56
      : Number(lerpNum(0.86, 0.74, clamp((elev + 12) / 30, 0, 1)).toFixed(2));

  // Directional daytime sun shadow opposite solar azimuth + night headlamp + ground light pool
  const oppositeAzRad = normalizeDeg(azimuthDeg + 180) * DEG2RAD;
  const shadowReachPx = lerpNum(12, 3.5, clamp((elev - 2) / 55, 0, 1));
  const shadowDxPx = Number((Math.sin(oppositeAzRad) * shadowReachPx).toFixed(1));
  const shadowDyPx = Number((-Math.cos(oppositeAzRad) * shadowReachPx).toFixed(1));
  const shadowOpacity = Number((clamp((elev - 2) / 14, 0, 1) * 0.58).toFixed(2));
  const headlampOpacity = Number(clamp((2 - elev) / 8, 0, 1).toFixed(2));
  const groundPoolOpacity = Number((headlampOpacity * 0.85).toFixed(2));

  return {
    darkness,
    light: {
      anchor: 'map',
      position: [1.5, azimuthDeg, polarDeg],
      color: lerpColor(s0.lightColor, s1.lightColor, localT),
      intensity: Number(lerpNum(s0.lightIntensity, s1.lightIntensity, localT).toFixed(2)),
    },
    sky: {
      'sky-color': skyColor,
      'sky-horizon-blend': 0.58,
      'horizon-color': horizonColor,
      'horizon-fog-blend': 0.52,
      'fog-color': fogColor,
      'fog-ground-blend': 0.42,
      'atmosphere-blend': 0.72,
    },
    fog: {
      color: fogColor,
      'high-color': skyColor,
      'space-color': spaceColor,
      'star-intensity': starIntensity,
    },
    raster: {
      brightnessMax: Number(lerpNum(s0.rasterMax, s1.rasterMax, localT).toFixed(2)),
      brightnessMin: Number(lerpNum(s0.rasterMin, s1.rasterMin, localT).toFixed(3)),
      contrast: Number(lerpNum(s0.rasterContrast, s1.rasterContrast, localT).toFixed(2)),
      saturation: Number(lerpNum(s0.rasterSat, s1.rasterSat, localT).toFixed(2)),
    },
    tint: {
      color: tintColor,
      opacity: Number(tintOpacity.toFixed(3)),
    },
    dynamicVector: {
      backgroundColor: lerpColor(s0.bgColor, s1.bgColor, localT),
      landColor: lerpColor(s0.landColor, s1.landColor, localT),
      parkColor: lerpColor(s0.parkColor, s1.parkColor, localT),
      waterColor: lerpColor(s0.waterColor, s1.waterColor, localT),
      majorRoadColor: lerpColor(s0.majorRoadColor, s1.majorRoadColor, localT),
      minorRoadColor: lerpColor(s0.minorRoadColor, s1.minorRoadColor, localT),
      labelColor: lerpColor(s0.labelColor, s1.labelColor, localT),
      labelHaloColor: lerpColor(s0.labelHaloColor, s1.labelHaloColor, localT),
      buildingBaseColor,
      buildingMidColor,
      buildingRoofColor,
    },
    buildingColor: buildingMidColor,
    buildingOpacity,
    routeGlowOpacityBoost: Number(
      lerpNum(s0.glowBoost, s1.glowBoost, localT).toFixed(2)
    ),
    puck: {
      shadowDxPx,
      shadowDyPx,
      shadowOpacity,
      headlampOpacity,
      groundPoolOpacity,
    },
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
