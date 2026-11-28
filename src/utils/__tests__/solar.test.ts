import { describe, expect, it } from 'vitest';
import { simplifyPolylineRdp } from '../../workers/timelineParser';
import { computeSolarAtmosphere, computeSolarPosition } from '../solar';

describe('Solar-Synced Ephemeris & Dynamic Mode Grading', () => {
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

  it('transforms Dynamic mode sky/stars, lit amber city roads, 3D facades, and headlamp + ground pool', () => {
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

    const dynNoon = computeSolarAtmosphere(noonSolar, 'DYNAMIC');
    const dynNight = computeSolarAtmosphere(nightSolar, 'DYNAMIC');
    const dynGolden = computeSolarAtmosphere(goldenSolar, 'DYNAMIC');

    // Sky & Starfield transitions
    expect(dynNight.sky['sky-color'].toLowerCase()).toBe('#040711');
    expect(dynNight.fog['star-intensity']).toBeCloseTo(0.9, 2);
    expect(dynNoon.sky['sky-color'].toLowerCase()).toBe('#87bfff');
    expect(dynNoon.fog['star-intensity']).toBe(0);

    // Lit amber city arteries at night & daylight ground
    expect(dynNight.dynamicVector.majorRoadColor.toLowerCase()).toBe('#ffb74d');
    expect(dynGolden.tint.opacity).toBeGreaterThan(0.04);
    expect(dynNoon.tint.opacity).toBe(0);

    // Daytime sun shadow vs Night headlamp + ambient ground pool crossfade
    expect(dynNoon.puck.shadowOpacity).toBeGreaterThan(0.4);
    expect(dynNoon.puck.headlampOpacity).toBe(0);
    expect(dynNoon.puck.groundPoolOpacity).toBe(0);
    expect(dynNight.puck.shadowOpacity).toBe(0);
    expect(dynNight.puck.headlampOpacity).toBe(1);
    expect(dynNight.puck.groundPoolOpacity).toBeGreaterThan(0.75);
  });
});

describe('Worker RDP Polyline Simplification', () => {
  it('prunes sub-3m redundant GPS jitter while preserving corners and endpoints', () => {
    const straightWithJitter = [
      { lat: 50.08, lng: 14.42 },
      { lat: 50.0805, lng: 14.420005 },
      { lat: 50.081, lng: 14.419996 },
      { lat: 50.0815, lng: 14.420002 },
      { lat: 50.082, lng: 14.42 },
      { lat: 50.082, lng: 14.422 },
    ];

    const simplified = simplifyPolylineRdp(straightWithJitter, 3);
    expect(simplified.length).toBe(3);
    expect(simplified[0]).toEqual(straightWithJitter[0]);
    expect(simplified[1]).toEqual(straightWithJitter[4]);
    expect(simplified[2]).toEqual(straightWithJitter[5]);
  });
});
