import type { MapStyleId, SolarPhase, SolarPosition } from '../types/timeline';
import { clamp } from './geo';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export interface SolarRasterGrading {
  brightnessMax: number; // 0.26 (night) -> 1.0 (noon)
  brightnessMin: number; // 0.02 (night) -> 0.0 (day)
  contrast: number; // 0.22 (night/golden) -> 0.02 (noon)
  saturation: number; // -0.35 (night), +0.18 (golden), 0.0 (noon)
}

export interface SolarTintGrading {
  color: string;
  opacity: number;
}

export interface SolarFogSpec {
  color: string;
  'high-color': string;
  'space-color': string;
  'star-intensity': number; // 0..0.85
}

export interface SolarPuckLighting {
  shadowDxPx: number;
  shadowDyPx: number;
  shadowOpacity: number; // 0..0.62 during daytime
  headlampOpacity: number; // 0..1 when elevation < 2°
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
  buildingColor: string;
  buildingOpacity: number;
  routeGlowOpacityBoost: number; // multiplier 1.0..1.55
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
  tintDaylightOpacity: number;
  tintDarkOpacity: number;
  tintSatOpacity: number;
  buildingDark: string;
  buildingLight: string;
  buildingSat: string;
  glowBoost: number;
}

const SOLAR_STOPS: PaletteStop[] = [
  {
    // Deep Night
    elev: -18,
    darkness: 1.0,
    lightColor: '#3b4f78',
    lightIntensity: 0.24,
    skyColor: '#040814',
    horizonColor: '#0c1528',
    fogColor: '#060a14',
    spaceColor: '#02040a',
    starIntensity: 0.85,
    rasterMax: 0.26,
    rasterMin: 0.02,
    rasterContrast: 0.22,
    rasterSat: -0.35,
    tintColor: '#040814',
    tintDaylightOpacity: 0.62,
    tintDarkOpacity: 0.34,
    tintSatOpacity: 0.16,
    buildingDark: '#0b1220',
    buildingLight: '#172236',
    buildingSat: '#0e1525',
    glowBoost: 1.55,
  },
  {
    // Blue Hour
    elev: -6,
    darkness: 0.72,
    lightColor: '#6b82ba',
    lightIntensity: 0.42,
    skyColor: '#0b1530',
    horizonColor: '#283f73',
    fogColor: '#111c36',
    spaceColor: '#050a18',
    starIntensity: 0.55,
    rasterMax: 0.48,
    rasterMin: 0.015,
    rasterContrast: 0.22,
    rasterSat: -0.18,
    tintColor: '#091530',
    tintDaylightOpacity: 0.42,
    tintDarkOpacity: 0.22,
    tintSatOpacity: 0.12,
    buildingDark: '#16233d',
    buildingLight: '#364662',
    buildingSat: '#19253b',
    glowBoost: 1.38,
  },
  {
    // Dawn / Dusk / Low Golden Hour
    elev: 2,
    darkness: 0.32,
    lightColor: '#ff9c54',
    lightIntensity: 0.72,
    skyColor: '#233059',
    horizonColor: '#ff8c42',
    fogColor: '#4a3540',
    spaceColor: '#0b1024',
    starIntensity: 0.12,
    rasterMax: 0.78,
    rasterMin: 0.005,
    rasterContrast: 0.22,
    rasterSat: 0.18,
    tintColor: '#FF8C42',
    tintDaylightOpacity: 0.14,
    tintDarkOpacity: 0.14,
    tintSatOpacity: 0.10,
    buildingDark: '#2f2738',
    buildingLight: '#cfa98b',
    buildingSat: '#2d2636',
    glowBoost: 1.2,
  },
  {
    // Upper Golden Hour
    elev: 12,
    darkness: 0.12,
    lightColor: '#fde68a',
    lightIntensity: 0.82,
    skyColor: '#36609c',
    horizonColor: '#fbbf77',
    fogColor: '#8899ad',
    spaceColor: '#13264a',
    starIntensity: 0.0,
    rasterMax: 0.92,
    rasterMin: 0.0,
    rasterContrast: 0.14,
    rasterSat: 0.14,
    tintColor: '#FF8C42',
    tintDaylightOpacity: 0.08,
    tintDarkOpacity: 0.07,
    tintSatOpacity: 0.05,
    buildingDark: '#26344a',
    buildingLight: '#ded1be',
    buildingSat: '#293547',
    glowBoost: 1.08,
  },
  {
    // Noon / High Daylight
    elev: 35,
    darkness: 0.0,
    lightColor: '#f8fafc',
    lightIntensity: 0.9,
    skyColor: '#2c68b8',
    horizonColor: '#9fc8eb',
    fogColor: '#d0dae6',
    spaceColor: '#17386b',
    starIntensity: 0.0,
    rasterMax: 1.0,
    rasterMin: 0.0,
    rasterContrast: 0.02,
    rasterSat: 0.0,
    tintColor: '#FF8C42',
    tintDaylightOpacity: 0.0,
    tintDarkOpacity: 0.0,
    tintSatOpacity: 0.0,
    buildingDark: '#1f304a',
    buildingLight: '#dbe2eb',
    buildingSat: '#212e42',
    glowBoost: 1.0,
  },
];

/**
 * Computes full-scene solar grading for ALL map styles (Dark, Satellite, Daylight),
 * including raster exposure, atmospheric tint, sky/fog/stars, 3D building facades,
 * route glow bloom, daytime sun shadow vector, and night headlamp intensity.
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

  const skyColor =
    mapStyle === 'DARK'
      ? lerpColor('#040814', lerpColor(s0.skyColor, s1.skyColor, localT), 0.52)
      : lerpColor(s0.skyColor, s1.skyColor, localT);
  const horizonColor =
    mapStyle === 'DARK'
      ? lerpColor('#0a1120', lerpColor(s0.horizonColor, s1.horizonColor, localT), 0.56)
      : lerpColor(s0.horizonColor, s1.horizonColor, localT);
  const fogColor =
    mapStyle === 'DARK'
      ? lerpColor('#060a14', lerpColor(s0.fogColor, s1.fogColor, localT), 0.45)
      : lerpColor(s0.fogColor, s1.fogColor, localT);
  const spaceColor = lerpColor(s0.spaceColor, s1.spaceColor, localT);
  const starIntensity = Number(
    lerpNum(s0.starIntensity, s1.starIntensity, localT).toFixed(2)
  );

  const tintColor = lerpColor(s0.tintColor, s1.tintColor, localT);
  const tintOpacity =
    mapStyle === 'DAYLIGHT'
      ? lerpNum(s0.tintDaylightOpacity, s1.tintDaylightOpacity, localT)
      : mapStyle === 'SATELLITE'
        ? lerpNum(s0.tintSatOpacity, s1.tintSatOpacity, localT)
        : lerpNum(s0.tintDarkOpacity, s1.tintDarkOpacity, localT);

  const buildingColor =
    mapStyle === 'DAYLIGHT'
      ? lerpColor(s0.buildingLight, s1.buildingLight, localT)
      : mapStyle === 'SATELLITE'
        ? lerpColor(s0.buildingSat, s1.buildingSat, localT)
        : lerpColor(s0.buildingDark, s1.buildingDark, localT);

  const buildingOpacity =
    mapStyle === 'SATELLITE'
      ? lerpNum(0.68, 0.54, clamp((elev + 12) / 30, 0, 1))
      : lerpNum(0.84, 0.72, clamp((elev + 12) / 30, 0, 1));

  // Sun-tracked puck shadow (opposite solar azimuth) & Night Headlamp (< 2° elevation)
  const oppositeAzRad = normalizeDeg(azimuthDeg + 180) * DEG2RAD;
  const shadowReachPx = lerpNum(12, 3.5, clamp((elev - 2) / 55, 0, 1));
  const shadowDxPx = Number((Math.sin(oppositeAzRad) * shadowReachPx).toFixed(1));
  const shadowDyPx = Number((-Math.cos(oppositeAzRad) * shadowReachPx).toFixed(1));
  const shadowOpacity = Number(
    (clamp((elev - 2) / 14, 0, 1) * 0.58).toFixed(2)
  );
  const headlampOpacity = Number(
    clamp((2 - elev) / 8, 0, 1).toFixed(2)
  );

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
      'sky-horizon-blend': 0.55,
      'horizon-color': horizonColor,
      'horizon-fog-blend': 0.5,
      'fog-color': fogColor,
      'fog-ground-blend': mapStyle === 'DARK' ? 0.34 : 0.48,
      'atmosphere-blend': 0.68,
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
    buildingColor,
    buildingOpacity: Number(buildingOpacity.toFixed(2)),
    routeGlowOpacityBoost: Number(
      lerpNum(s0.glowBoost, s1.glowBoost, localT).toFixed(2)
    ),
    puck: {
      shadowDxPx,
      shadowDyPx,
      shadowOpacity,
      headlampOpacity,
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
