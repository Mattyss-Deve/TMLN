import { describe, expect, it } from 'vitest';
import { simplifyPolylineRdp } from '../../workers/timelineParser';
import { computeSolarAtmosphere, computeSolarPosition } from '../solar';

describe('Solar-Synced Ephemeris & All-Style 3D Grading', () => {
  // Prague (50.0755° N, 14.4378° E)
  const PRAGUE_LAT = 50.0755;
  const PRAGUE_LNG = 14.4378;

  it('computes high Daylight elevation near solar noon and deep Night near midnight', () => {
    const noonUtc = Date.UTC(2024, 5, 21, 11, 2, 0);
    const noonSolar = computeSolarPosition(PRAGUE_LAT, PRAGUE_LNG, noonUtc);
    expect(noonSolar.elevationDeg).toBeGreaterThan(60);
    expect(noonSolar.elevationDeg).toBeLessThan(66);
    expect(noonSolar.phase).toBe('Daylight');
    expect(noonSolar.isNight).toBe(false);

    const winterMidnightUtc = Date.UTC(2024, 11, 21, 23, 0, 0);
    const nightSolar = computeSolarPosition(PRAGUE_LAT, PRAGUE_LNG, winterMidnightUtc);
    expect(nightSolar.elevationDeg).toBeLessThan(-50);
    expect(nightSolar.phase).toBe('Night');
    expect(nightSolar.isNight).toBe(true);
  });

  it('grades Satellite raster exposure, Daylight atmospheric tint, fog stars, and puck shadow/headlamp', () => {
    const noonSolar = computeSolarPosition(
      PRAGUE_LAT,
      PRAGUE_LNG,
      Date.UTC(2024, 5, 21, 11, 2, 0)
    );
    const nightSolar = computeSolarPosition(
      PRAGUE_LAT,
      PRAGUE_LNG,
      Date.UTC(2024, 11, 21, 23, 0, 0)
    );
    const goldenSolar = computeSolarPosition(
      PRAGUE_LAT,
      PRAGUE_LNG,
      Date.UTC(2024, 2, 20, 5, 20, 0)
    );

    const satNoon = computeSolarAtmosphere(noonSolar, 'SATELLITE');
    const satNight = computeSolarAtmosphere(nightSolar, 'SATELLITE');
    expect(satNoon.raster.brightnessMax).toBeCloseTo(1.0, 2);
    expect(satNight.raster.brightnessMax).toBeCloseTo(0.26, 2);
    expect(satNight.raster.brightnessMin).toBeCloseTo(0.02, 2);
    expect(satNight.raster.saturation).toBeCloseTo(-0.35, 2);

    const dayNightTint = computeSolarAtmosphere(nightSolar, 'DAYLIGHT');
    const dayNoonTint = computeSolarAtmosphere(noonSolar, 'DAYLIGHT');
    const dayGolden = computeSolarAtmosphere(goldenSolar, 'DAYLIGHT');
    expect(dayNightTint.tint.color.toLowerCase()).toBe('#040814');
    expect(dayNightTint.tint.opacity).toBeCloseTo(0.62, 2);
    expect(dayNoonTint.tint.opacity).toBe(0);
    expect(dayGolden.tint.opacity).toBeGreaterThan(0.04);
    expect(dayNightTint.fog['star-intensity']).toBeCloseTo(0.85, 2);

    // Daytime sun shadow vs Night headlamp crossfade
    expect(satNoon.puck.shadowOpacity).toBeGreaterThan(0.4);
    expect(satNoon.puck.headlampOpacity).toBe(0);
    expect(satNight.puck.shadowOpacity).toBe(0);
    expect(satNight.puck.headlampOpacity).toBe(1);
  });
});

describe('Worker RDP Polyline Simplification', () => {
  it('prunes sub-3m redundant GPS jitter while preserving corners and endpoints', () => {
    const straightWithJitter = [
      { lat: 50.08, lng: 14.42 },
      { lat: 50.0805, lng: 14.420005 }, // ~0.3m lateral jitter
      { lat: 50.081, lng: 14.419996 }, // ~0.3m lateral jitter
      { lat: 50.0815, lng: 14.420002 }, // ~0.2m lateral jitter
      { lat: 50.082, lng: 14.42 }, // sharp corner start
      { lat: 50.082, lng: 14.422 }, // 140m east turn
    ];

    const simplified = simplifyPolylineRdp(straightWithJitter, 3);
    expect(simplified.length).toBe(3);
    expect(simplified[0]).toEqual(straightWithJitter[0]);
    expect(simplified[1]).toEqual(straightWithJitter[4]);
    expect(simplified[2]).toEqual(straightWithJitter[5]);
  });
});
