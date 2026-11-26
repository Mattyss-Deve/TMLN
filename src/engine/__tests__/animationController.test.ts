import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSampleTimelineJson } from '../../data/sampleJourney';
import { lerpAngle } from '../../utils/geo';
import { parseTimelineText } from '../../workers/timelineParser';
import {
  AnimationController,
  SPEED_PRESETS,
} from '../animationController';

describe('lerpAngle circular bearing interpolation', () => {
  it('interpolates along the shortest arc across 0/360 degrees', () => {
    expect(lerpAngle(355, 5, 0.5)).toBeCloseTo(0, 5);
    expect(lerpAngle(5, 355, 0.5)).toBeCloseTo(0, 5);
    expect(lerpAngle(350, 10, 0.25)).toBeCloseTo(355, 5);
    expect(lerpAngle(90, 180, 0.5)).toBeCloseTo(135, 5);
  });
});

describe('AnimationController 60fps playback and telemetry', () => {
  let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let nextRafId = 1;

  beforeEach(() => {
    rafQueue = [];
    nextRafId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.push({ id, cb });
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafQueue = rafQueue.filter((entry) => entry.id !== id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stepRaf(timestampMs: number) {
    const current = [...rafQueue];
    rafQueue = [];
    for (const item of current) {
      item.cb(timestampMs);
    }
  }

  it('interpolates sample journey telemetry, speed, mode, visits, and looping', () => {
    const parsed = parseTimelineText(createSampleTimelineJson());
    const trip = parsed.trips[0];
    const controller = new AnimationController();

    const hudFrames: number[] = [];
    controller.subscribeHud((f) => hudFrames.push(f.currentTimeMs));
    controller.loadTrip(trip, false);

    // Initial state at Ferry Building Marketplace visit
    const startSnap = controller.getSnapshot();
    expect(startSnap).not.toBeNull();
    expect(startSnap!.mode).toBe('STILL');
    expect(startSnap!.speedKmh).toBe(0);
    expect(startSnap!.activeVisit?.name).toBe('Ferry Building Marketplace');
    expect(startSnap!.progress).toBe(0);

    // Verify speed presets (Fit 15s, Fit 30s, 60x)
    const fit15 = SPEED_PRESETS.find((p) => p.label === 'Fit 15s')!;
    const mult60 = SPEED_PRESETS.find((p) => p.label === '60x')!;
    controller.setSpeedPreset(fit15);
    expect(controller.getEffectiveMultiplier()).toBeCloseTo(
      trip.durationMs / 15_000,
      3
    );

    controller.setSpeedPreset(mult60);
    expect(controller.getEffectiveMultiplier()).toBe(60);

    // Restore Fit 30s and simulate 60fps RAF playback across the trip
    const fit30 = SPEED_PRESETS.find((p) => p.label === 'Fit 30s')!;
    controller.setSpeedPreset(fit30);
    controller.play();

    // Advance 10 seconds in 100ms chunks (100 frames)
    let now = 1000;
    const seenModes = new Set<string>();
    for (let i = 0; i < 160; i++) {
      stepRaf(now);
      now += 100;
      const snap = controller.getSnapshot();
      if (snap) {
        seenModes.add(snap.mode);
      }
    }

    const midSnap = controller.getSnapshot()!;
    expect(midSnap.isPlaying).toBe(true);
    expect(midSnap.progress).toBeGreaterThan(0.3);
    expect(midSnap.progress).toBeLessThan(0.9);
    expect(midSnap.cumulativeDistanceM).toBeGreaterThan(500);
    expect(seenModes.has('WALKING')).toBe(true);
    expect(seenModes.has('TRANSIT')).toBe(true);
    expect(seenModes.has('DRIVING')).toBe(true);

    // Segment stepping forward & backward
    controller.pause();
    controller.seekToProgress(0);
    controller.stepSegment(1);
    const seg2Snap = controller.getSnapshot()!;
    expect(seg2Snap.activeSegmentIndex).toBe(1);
    expect(seg2Snap.mode).toBe('WALKING');
    expect(seg2Snap.speedKmh).toBeGreaterThan(0);
    expect(seg2Snap.bearing).toBeGreaterThanOrEqual(0);
    expect(seg2Snap.bearing).toBeLessThan(360);

    controller.stepSegment(-1);
    expect(controller.getSnapshot()!.activeSegmentIndex).toBe(0);

    // Non-looping reaches endTimeMs and pauses automatically
    controller.seekToProgress(0.99);
    controller.play();
    for (let i = 0; i < 10; i++) {
      stepRaf(now);
      now += 100;
    }
    const endSnap = controller.getSnapshot()!;
    expect(endSnap.isPlaying).toBe(false);
    expect(endSnap.progress).toBe(1);
    expect(endSnap.cumulativeDistanceM).toBeCloseTo(trip.distanceM, 1);

    // Looping wraps past endTimeMs back toward startTimeMs
    controller.setLoop(true);
    controller.seekToProgress(0.995);
    controller.play();
    stepRaf(now);
    now += 100;
    stepRaf(now);
    now += 100;
    stepRaf(now);
    const loopSnap = controller.getSnapshot()!;
    expect(loopSnap.isPlaying).toBe(true);
    expect(loopSnap.progress).toBeLessThan(0.5);

    expect(hudFrames.length).toBeGreaterThan(3);
    controller.destroy();
  });
});
