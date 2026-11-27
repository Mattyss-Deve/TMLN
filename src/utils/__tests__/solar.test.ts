import { describe, expect, it } from 'vitest';
import { computeSolarAtmosphere, computeSolarPosition } from '../solar';

describe('Solar-Synced Ephemeris & 3D Atmosphere', () => {
  // Prague (50.0755° N, 14.4378° E) on Summer Solstice (June 21, 2024)
  const PRAGUE_LAT = 50.0755;
  const PRAGUE_LNG = 14.4378;

  it('computes high Daylight elevation near solar noon and deep Night near midnight', () => {
    // Solar noon in Prague (UTC+2, ~11:02 UTC -> 13:02 CEST)
    const noonUtc = Date.UTC(2024, 5, 21, 11, 2, 0);
    const noonSolar = computeSolarPosition(PRAGUE_LAT, PRAGUE_LNG, noonUtc);
    expect(noonSolar.elevationDeg).toBeGreaterThan(60);
    expect(noonSolar.elevationDeg).toBeLessThan(66);
    expect(noonSolar.azimuthDeg).toBeGreaterThan(165);
    expect(noonSolar.azimuthDeg).toBeLessThan(195);
    expect(noonSolar.phase).toBe('Daylight');
    expect(noonSolar.isNight).toBe(false);

    // Midnight in winter (Dec 21, 2024 23:00 UTC)
    const winterMidnightUtc = Date.UTC(2024, 11, 21, 23, 0, 0);
    const nightSolar = computeSolarPosition(PRAGUE_LAT, PRAGUE_LNG, winterMidnightUtc);
    expect(nightSolar.elevationDeg).toBeLessThan(-50);
    expect(nightSolar.phase).toBe('Night');
    expect(nightSolar.isNight).toBe(true);
  });

  it('distinguishes eastern Dawn from western Dusk and produces smooth atmosphere palettes', () => {
    // Equinox sunrise (~05:05 UTC in Prague) and sunset (~17:15 UTC)
    const morningUtc = Date.UTC(2024, 2, 20, 5, 10, 0);
    const eveningUtc = Date.UTC(2024, 2, 20, 17, 10, 0);

    const morning = computeSolarPosition(PRAGUE_LAT, PRAGUE_LNG, morningUtc);
    const evening = computeSolarPosition(PRAGUE_LAT, PRAGUE_LNG, eveningUtc);

    expect(morning.azimuthDeg).toBeLessThan(180);
    expect(evening.azimuthDeg).toBeGreaterThan(180);
    expect(['Blue Hour', 'Dawn', 'Golden Hour']).toContain(morning.phase);
    expect(['Golden Hour', 'Dusk', 'Blue Hour']).toContain(evening.phase);

    const dayAtmo = computeSolarAtmosphere(
      computeSolarPosition(PRAGUE_LAT, PRAGUE_LNG, Date.UTC(2024, 5, 21, 11, 2, 0)),
      'DARK'
    );
    const nightAtmo = computeSolarAtmosphere(
      computeSolarPosition(PRAGUE_LAT, PRAGUE_LNG, Date.UTC(2024, 11, 21, 23, 0, 0)),
      'DARK'
    );

    expect(dayAtmo.light.anchor).toBe('map');
    expect(dayAtmo.light.intensity).toBeGreaterThan(nightAtmo.light.intensity);
    expect(nightAtmo.routeGlowOpacityBoost).toBeGreaterThan(
      dayAtmo.routeGlowOpacityBoost
    );
  });
});
