import type maplibregl from 'maplibre-gl';
import type { AnimationController } from '../engine/animationController';
import type {
  AccentThemeId,
  ReelExportProgress,
  TelemetryFrame,
  Trip,
  UnitSystem,
} from '../types/timeline';
import {
  formatClock,
  formatDate,
  formatDistance,
  formatSpeed,
  getSpeedUnitLabel,
} from './format';
import { clamp, MODE_COLORS, MODE_LABELS } from './geo';
import { ACCENT_THEMES, APP_VERSION } from './settings';
import { computeSolarPosition, getSolarPhaseAccent } from './solar';

export type ReelExportOutcome = 'shared' | 'downloaded' | 'cancelled';

export interface ReelExportOptions {
  map: maplibregl.Map;
  controller: AnimationController;
  trip: Trip;
  units: UnitSystem;
  accentTheme: AccentThemeId;
  solarSync: boolean;
  signal: AbortSignal;
  onProgress: (progress: ReelExportProgress) => void;
}

const REEL_W = 720;
const REEL_H = 1280;
const FPS = 30;
const DURATION_SECONDS = 12;
const TOTAL_FRAMES = FPS * DURATION_SECONDS; // 360 frames
const TARGET_FRAME_MS = 1000 / FPS;

function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const mime of candidates) {
    if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function wrapTitle(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ['ChronoMap Journey'];
  const lines: string[] = [];
  let line = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${line} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = words[i];
      if (lines.length === 1) {
        const rest = [line, ...words.slice(i + 1)].join(' ');
        let clipped = rest;
        while (clipped.length > 3 && ctx.measureText(`${clipped}…`).width > maxWidth) {
          clipped = clipped.slice(0, -1);
        }
        lines.push(clipped === rest ? rest : `${clipped.trimEnd()}…`);
        return lines;
      }
    }
  }
  lines.push(line);
  return lines.slice(0, 2);
}

function drawReelFrame(
  ctx: CanvasRenderingContext2D,
  mapCanvas: HTMLCanvasElement,
  trip: Trip,
  frame: TelemetryFrame,
  units: UnitSystem,
  accentTheme: AccentThemeId,
  solarSync: boolean
): void {
  const accent = ACCENT_THEMES[accentTheme];

  // 1. Background & Aspect-Fill Cover Crop of WebGL Map Canvas
  ctx.fillStyle = '#0A0D14';
  ctx.fillRect(0, 0, REEL_W, REEL_H);

  const srcW = Math.max(1, mapCanvas.width);
  const srcH = Math.max(1, mapCanvas.height);
  const srcAspect = srcW / srcH;
  const dstAspect = REEL_W / REEL_H;

  let sx = 0;
  let sy = 0;
  let sw = srcW;
  let sh = srcH;
  if (srcAspect > dstAspect) {
    sw = srcH * dstAspect;
    sx = (srcW - sw) / 2;
  } else {
    sh = srcW / dstAspect;
    sy = (srcH - sh) / 2;
  }

  ctx.drawImage(mapCanvas, sx, sy, sw, sh, 0, 0, REEL_W, REEL_H);

  // 2. Top & Bottom Editorial Gradient Vignettes
  const topVig = ctx.createLinearGradient(0, 0, 0, 240);
  topVig.addColorStop(0, 'rgba(7, 10, 16, 0.86)');
  topVig.addColorStop(0.55, 'rgba(7, 10, 16, 0.42)');
  topVig.addColorStop(1, 'rgba(7, 10, 16, 0)');
  ctx.fillStyle = topVig;
  ctx.fillRect(0, 0, REEL_W, 240);

  const botVig = ctx.createLinearGradient(0, REEL_H - 300, 0, REEL_H);
  botVig.addColorStop(0, 'rgba(7, 10, 16, 0)');
  botVig.addColorStop(0.45, 'rgba(7, 10, 16, 0.62)');
  botVig.addColorStop(1, 'rgba(7, 10, 16, 0.92)');
  ctx.fillStyle = botVig;
  ctx.fillRect(0, REEL_H - 300, REEL_W, 300);

  // 3. Top Editorial Title Block
  const padX = 36;
  const topY = 52;

  ctx.fillStyle = accent.primary;
  drawRoundedRect(ctx, padX, topY + 6, 22, 4, 2);
  ctx.fill();

  ctx.font = '500 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#CBD5E1';
  ctx.textBaseline = 'middle';
  ctx.fillText(formatDate(frame.currentTimeMs), padX + 32, topY + 8);

  if (solarSync) {
    const solar = computeSolarPosition(frame.lat, frame.lng, frame.currentTimeMs);
    const phaseColor = getSolarPhaseAccent(solar.phase);
    ctx.font = '500 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const labelW = ctx.measureText(solar.phase).width + 30;
    const pillX = REEL_W - padX - labelW;
    drawRoundedRect(ctx, pillX, topY - 6, labelW, 28, 8);
    ctx.fillStyle = 'rgba(11, 14, 20, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(pillX + 13, topY + 8, 4, 0, Math.PI * 2);
    ctx.fillStyle = phaseColor;
    ctx.fill();

    ctx.fillStyle = '#E2E8F0';
    ctx.fillText(solar.phase, pillX + 23, topY + 9);
  }

  ctx.font = '600 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#F8FAFC';
  ctx.textBaseline = 'top';
  const lines = wrapTitle(ctx, trip.title, REEL_W - padX * 2);
  let titleY = topY + 28;
  for (const line of lines) {
    ctx.fillText(line, padX, titleY);
    titleY += 38;
  }

  // 4. Bottom Live Telemetry Bar
  const barX = padX;
  const barW = REEL_W - padX * 2;
  const barH = 126;
  const barY = REEL_H - barH - 64;

  drawRoundedRect(ctx, barX, barY, barW, barH, 16);
  ctx.fillStyle = 'rgba(11, 14, 20, 0.86)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Row 1: Synced Clock + Mode Pill
  const innerX = barX + 22;
  const innerRight = barX + barW - 22;

  ctx.font = '600 30px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.fillText(formatClock(frame.currentTimeMs), innerX, barY + 34);

  const modeColor = MODE_COLORS[frame.mode];
  const modeText = MODE_LABELS[frame.mode];
  ctx.font = '600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const modeW = ctx.measureText(modeText).width + 34;
  drawRoundedRect(ctx, innerRight - modeW, barY + 18, modeW, 32, 8);
  ctx.fillStyle = `${modeColor}22`;
  ctx.fill();
  ctx.strokeStyle = `${modeColor}66`;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(innerRight - modeW + 14, barY + 34, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = modeColor;
  ctx.fill();

  ctx.fillStyle = modeColor;
  ctx.fillText(modeText, innerRight - modeW + 25, barY + 35);

  // Row 2: Speed & Distance
  const metricY = barY + 76;
  ctx.font = '600 22px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#E2E8F0';
  const speedStr = `${formatSpeed(frame.speedKmh, units)} ${getSpeedUnitLabel(units)}`;
  ctx.fillText(speedStr, innerX, metricY);

  const distStr = formatDistance(frame.cumulativeDistanceM, units);
  const distW = ctx.measureText(distStr).width;
  ctx.fillStyle = '#CBD5E1';
  ctx.fillText(distStr, innerRight - distW, metricY);

  // Progress bar inside bottom of telemetry card
  const trackX = innerX;
  const trackY = barY + barH - 20;
  const trackW = barW - 44;
  drawRoundedRect(ctx, trackX, trackY, trackW, 5, 2.5);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fill();

  const fillW = Math.max(6, trackW * clamp(frame.progress, 0, 1));
  drawRoundedRect(ctx, trackX, trackY, fillW, 5, 2.5);
  ctx.fillStyle = accent.primary;
  ctx.fill();

  // 5. Subtle ChronoMap v1.3.0 Footer Mark
  const footerY = REEL_H - 30;
  ctx.font = '500 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.78)';
  ctx.textBaseline = 'middle';
  ctx.fillText('100% On-Device Replay', padX, footerY);

  const brand = `ChronoMap ${APP_VERSION}`;
  ctx.font = '600 16px ui-monospace, SFMono-Regular, Menlo, monospace';
  const brandW = ctx.measureText(brand).width;
  ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
  ctx.fillText(brand, REEL_W - padX - brandW, footerY);

  ctx.beginPath();
  ctx.arc(REEL_W - padX - brandW - 12, footerY, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = accent.primary;
  ctx.fill();
}

function waitNextAnimationFrame(): Promise<number> {
  return new Promise((resolve) => {
    window.requestAnimationFrame((ts) => resolve(ts));
  });
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Automates a 12-second (360 frames @ 30fps) 720x1280 vertical 9:16 video reel
 * capture of the active trip, compositing live telemetry & solar phase onto an
 * offscreen canvas recorded via MediaRecorder (`video/webm`).
 */
export async function exportVideoReel({
  map,
  controller,
  trip,
  units,
  accentTheme,
  solarSync,
  signal,
  onProgress,
}: ReelExportOptions): Promise<ReelExportOutcome> {
  const mimeType = pickSupportedMimeType();
  if (mimeType === null) {
    throw new Error('MediaRecorder video recording is not supported on this browser.');
  }

  const outCanvas = document.createElement('canvas');
  outCanvas.width = REEL_W;
  outCanvas.height = REEL_H;
  const ctx = outCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to initialize 2D canvas for video reel.');
  }

  if (typeof outCanvas.captureStream !== 'function') {
    throw new Error('Canvas captureStream is not supported on this device.');
  }

  const stream = outCanvas.captureStream(FPS);
  const recorderOptions: MediaRecorderOptions = mimeType
    ? { mimeType, videoBitsPerSecond: 4_500_000 }
    : { videoBitsPerSecond: 4_500_000 };

  const recorder = new MediaRecorder(stream, recorderOptions);
  const chunks: BlobPart[] = [];

  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  };

  const stoppedPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
    };
    recorder.onerror = () => {
      reject(new Error('Video encoder encountered an error while recording.'));
    };
  });

  // Prime first frame at progress = 0 before starting MediaRecorder
  controller.pause();
  controller.seekToProgress(0);
  map.triggerRepaint();
  await waitNextAnimationFrame();
  await waitNextAnimationFrame();

  const initialSnap = controller.getSnapshot();
  if (initialSnap) {
    drawReelFrame(ctx, map.getCanvas(), trip, initialSnap, units, accentTheme, solarSync);
  }

  recorder.start(250);

  let aborted = false;
  try {
    for (let i = 0; i < TOTAL_FRAMES; i++) {
      if (signal.aborted) {
        aborted = true;
        break;
      }

      const frameStart = performance.now();
      const p = i / (TOTAL_FRAMES - 1);
      controller.seekToProgress(p);
      map.triggerRepaint();

      await waitNextAnimationFrame();
      if (signal.aborted) {
        aborted = true;
        break;
      }

      const snap = controller.getSnapshot();
      if (snap) {
        drawReelFrame(ctx, map.getCanvas(), trip, snap, units, accentTheme, solarSync);
      }

      if (i % 3 === 0 || i === TOTAL_FRAMES - 1) {
        onProgress({
          active: true,
          frame: i + 1,
          totalFrames: TOTAL_FRAMES,
          percent: Math.round(((i + 1) / TOTAL_FRAMES) * 96),
          stage: `Rendering 9:16 Reel (${i + 1}/${TOTAL_FRAMES})`,
        });
      }

      // Pace recording to ~30fps wall-clock so encoded timestamps span ~12s
      const elapsed = performance.now() - frameStart;
      if (elapsed < TARGET_FRAME_MS - 2) {
        await sleepMs(TARGET_FRAME_MS - elapsed);
      }
    }
  } finally {
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }

  if (aborted) {
    return 'cancelled';
  }

  onProgress({
    active: true,
    frame: TOTAL_FRAMES,
    totalFrames: TOTAL_FRAMES,
    percent: 99,
    stage: 'Finalizing WebM video...',
  });

  const blob = await stoppedPromise;
  const safeDate = trip.dateKey || 'journey';
  const fileName = `chronomap-reel-${safeDate}.webm`;

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const file = new File([blob], fileName, { type: 'video/webm' });
    const canShare =
      typeof navigator.canShare === 'function'
        ? navigator.canShare({ files: [file] })
        : false;
    if (canShare) {
      try {
        await navigator.share({
          title: `ChronoMap Reel · ${trip.title}`,
          text: `${trip.title} (${formatDistance(trip.distanceM, units)})`,
          files: [file],
        });
        return 'shared';
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return 'cancelled';
        }
      }
    }
  }

  // Fallback direct WebM download
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  return 'downloaded';
}
