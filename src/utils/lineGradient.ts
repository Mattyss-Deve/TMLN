import type { PrebakedColorStop } from '../types/timeline';
import { clamp } from './geo';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const MIN_STEP = 0.00001;
const CUTOFF_FEATHER = 0.0004;

/**
 * Builds a strictly ascending MapLibre `line-gradient` expression
 * (`['interpolate', ['linear'], ['line-progress'], ...]`) that reveals the
 * route color-coded by transport mode up to `cutoffProgress` and hides the
 * remainder cleanly with transparent stops.
 */
export function buildLineGradientExpression(
  colorStops: PrebakedColorStop[],
  cutoffProgress: number,
  overrideColor?: string
): unknown[] {
  const cutoff = clamp(cutoffProgress, 0, 1);

  if (cutoff <= 0.0002 || colorStops.length === 0) {
    return ['interpolate', ['linear'], ['line-progress'], 0, TRANSPARENT, 1, TRANSPARENT];
  }

  // Fast-path uniform glow color (4 stops max)
  if (overrideColor) {
    if (cutoff >= 0.9996) {
      return [
        'interpolate',
        ['linear'],
        ['line-progress'],
        0,
        overrideColor,
        1,
        overrideColor,
      ];
    }
    const fadeEnd = Math.min(1, cutoff + CUTOFF_FEATHER);
    const expr: unknown[] = [
      'interpolate',
      ['linear'],
      ['line-progress'],
      0,
      overrideColor,
      cutoff,
      overrideColor,
      fadeEnd,
      TRANSPARENT,
    ];
    if (fadeEnd < 1) {
      expr.push(1, TRANSPARENT);
    }
    return expr;
  }

  // Multi-modal color stops up to `cutoff`, strictly monotonic
  const stops: [number, string][] = [];
  let activeColor = colorStops[0].color;

  const pushStop = (p: number, color: string) => {
    const clampedP = clamp(p, 0, 1);
    if (stops.length === 0) {
      stops.push([clampedP, color]);
      return;
    }
    const prevP = stops[stops.length - 1][0];
    if (clampedP <= prevP + MIN_STEP) {
      return;
    }
    stops.push([clampedP, color]);
  };

  pushStop(0, activeColor);

  for (let i = 0; i < colorStops.length; i++) {
    const s = colorStops[i];
    if (s.progress <= cutoff - MIN_STEP * 2) {
      activeColor = s.color;
      pushStop(s.progress, s.color);
    } else {
      break;
    }
  }

  if (cutoff >= 0.9996) {
    if (stops[stops.length - 1][0] < 1 - MIN_STEP) {
      pushStop(1, activeColor);
    } else {
      stops[stops.length - 1] = [1, activeColor];
    }
  } else {
    pushStop(cutoff, activeColor);
    const tailP = stops[stops.length - 1][0];
    const fadeEnd = Math.min(1, Math.max(tailP + MIN_STEP * 2, cutoff + CUTOFF_FEATHER));
    pushStop(fadeEnd, TRANSPARENT);
    if (stops[stops.length - 1][0] < 1 - MIN_STEP) {
      pushStop(1, TRANSPARENT);
    }
  }

  // Guarantee at least 2 strictly increasing stops for MapLibre
  if (stops.length < 2) {
    return ['interpolate', ['linear'], ['line-progress'], 0, activeColor, 1, activeColor];
  }

  const expr: unknown[] = ['interpolate', ['linear'], ['line-progress']];
  for (const [p, color] of stops) {
    expr.push(p, color);
  }
  return expr;
}
