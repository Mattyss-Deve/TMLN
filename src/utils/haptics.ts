import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const CROWN_MIN_INTERVAL_MS = 22;
const CROWN_MIN_DELTA = 0.015; // 1.5% scrubber detent spacing

let hapticsEnabled = true;
let lastCrownTickMs = 0;
let lastCrownProgress: number | null = null;

export function setHapticsEnabled(enabled: boolean): void {
  hapticsEnabled = enabled;
}

export function isHapticsEnabled(): boolean {
  return hapticsEnabled;
}

export function resetCrownDetent(): void {
  lastCrownProgress = null;
}

/**
 * Crisp mechanical watch-crown detent tick throttled by both time (22ms)
 * and scrubber movement (1.5%). Safely no-ops on desktop web.
 */
export function triggerCrownTick(progress?: number): void {
  if (!hapticsEnabled) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastCrownTickMs < CROWN_MIN_INTERVAL_MS) {
    return;
  }

  if (typeof progress === 'number') {
    if (
      lastCrownProgress !== null &&
      Math.abs(progress - lastCrownProgress) < CROWN_MIN_DELTA
    ) {
      return;
    }
    lastCrownProgress = progress;
  }

  lastCrownTickMs = now;
  void Haptics.selectionChanged().catch(() => {
    // Web / unsupported device: ignore gracefully
  });
}

/**
 * Medium tactile pulse when playback transitions between transport modes
 * or arrives at a Place Visit.
 */
export function triggerSegmentPulse(): void {
  if (!hapticsEnabled) return;
  void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {
    // Web / unsupported device: ignore gracefully
  });
}

/**
 * Crisp success haptic notification when Corridor Pre-Staging or
 * Postcard / 9:16 Video Reel export completes.
 */
export function triggerSuccessPulse(): void {
  if (!hapticsEnabled) return;
  void Haptics.notification({ type: NotificationType.Success }).catch(() => {
    // Web / unsupported device: ignore gracefully
  });
}
