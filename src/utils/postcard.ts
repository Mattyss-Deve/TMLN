import type { AccentThemeId, Trip, UnitSystem } from '../types/timeline';
import { formatDate, formatDistance, formatDuration } from './format';
import { MODE_COLORS, MODE_LABELS } from './geo';
import { ACCENT_THEMES, APP_VERSION } from './settings';

export type PostcardShareResult = 'shared' | 'downloaded' | 'cancelled';

export interface PostcardOptions {
  mapCanvas: HTMLCanvasElement;
  trip: Trip;
  units: UnitSystem;
  accentTheme: AccentThemeId;
}

const CARD_W = 1080;
const CARD_H = 1350;
const OUTER_PAD = 36;
const MAP_FRAME_X = OUTER_PAD;
const MAP_FRAME_Y = OUTER_PAD;
const MAP_FRAME_W = CARD_W - OUTER_PAD * 2;
const MAP_FRAME_H = 880;
const MAP_RADIUS = 24;

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ['Untitled Journey'];

  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
      if (lines.length === maxLines - 1) {
        // Pack remainder onto final line with truncation if needed
        const remainder = [current, ...words.slice(i + 1)].join(' ');
        current = truncateLine(ctx, remainder, maxWidth);
        break;
      }
    }
  }
  lines.push(truncateLine(ctx, current, maxWidth));
  return lines.slice(0, maxLines);
}

function truncateLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 3 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed.trimEnd()}…`;
}

/**
 * Renders a crisp 1080x1350 editorial route postcard combining the live MapLibre
 * WebGL canvas snapshot with a matte obsidian telemetry/metadata strip.
 */
export function renderRoutePostcardCanvas({
  mapCanvas,
  trip,
  units,
  accentTheme,
}: PostcardOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to acquire 2D canvas context for postcard.');
  }

  const accent = ACCENT_THEMES[accentTheme];

  // 1. Deep matte obsidian postcard background
  ctx.fillStyle = '#0A0D14';
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Subtle top editorial sheen
  const bgGrad = ctx.createLinearGradient(0, 0, 0, CARD_H);
  bgGrad.addColorStop(0, '#0E131E');
  bgGrad.addColorStop(0.55, '#0A0D14');
  bgGrad.addColorStop(1, '#07090F');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // 2. Framed Map Snapshot (aspect-fill cover crop so image is never stretched)
  ctx.save();
  drawRoundedRectPath(ctx, MAP_FRAME_X, MAP_FRAME_Y, MAP_FRAME_W, MAP_FRAME_H, MAP_RADIUS);
  ctx.clip();

  ctx.fillStyle = '#070A0F';
  ctx.fillRect(MAP_FRAME_X, MAP_FRAME_Y, MAP_FRAME_W, MAP_FRAME_H);

  const srcW = Math.max(1, mapCanvas.width);
  const srcH = Math.max(1, mapCanvas.height);
  const srcAspect = srcW / srcH;
  const dstAspect = MAP_FRAME_W / MAP_FRAME_H;

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

  ctx.drawImage(
    mapCanvas,
    sx,
    sy,
    sw,
    sh,
    MAP_FRAME_X,
    MAP_FRAME_Y,
    MAP_FRAME_W,
    MAP_FRAME_H
  );

  // Subtle bottom vignette inside map frame
  const vignette = ctx.createLinearGradient(
    0,
    MAP_FRAME_Y + MAP_FRAME_H - 180,
    0,
    MAP_FRAME_Y + MAP_FRAME_H
  );
  vignette.addColorStop(0, 'rgba(10, 13, 20, 0)');
  vignette.addColorStop(1, 'rgba(10, 13, 20, 0.58)');
  ctx.fillStyle = vignette;
  ctx.fillRect(MAP_FRAME_X, MAP_FRAME_Y + MAP_FRAME_H - 180, MAP_FRAME_W, 180);

  // Subtle top-left coordinates badge inside map frame
  const [[minLng, minLat], [maxLng, maxLat]] = trip.bounds;
  const centerLat = ((minLat + maxLat) / 2).toFixed(3);
  const centerLng = ((minLng + maxLng) / 2).toFixed(3);
  const coordText = `${centerLat}°, ${centerLng}°`;
  ctx.font = '500 20px ui-monospace, SFMono-Regular, Menlo, monospace';
  const coordW = ctx.measureText(coordText).width + 32;
  drawRoundedRectPath(ctx, MAP_FRAME_X + 24, MAP_FRAME_Y + 24, coordW, 42, 10);
  ctx.fillStyle = 'rgba(11, 14, 20, 0.78)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#CBD5E1';
  ctx.textBaseline = 'middle';
  ctx.fillText(coordText, MAP_FRAME_X + 40, MAP_FRAME_Y + 46);

  ctx.restore();

  // Crisp 1px hairline border around map frame
  drawRoundedRectPath(ctx, MAP_FRAME_X, MAP_FRAME_Y, MAP_FRAME_W, MAP_FRAME_H, MAP_RADIUS);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 3. Bottom Editorial Metadata Strip
  const metaX = OUTER_PAD + 8;
  const metaRight = CARD_W - OUTER_PAD - 8;
  const metaW = metaRight - metaX;
  let cursorY = MAP_FRAME_Y + MAP_FRAME_H + 44;

  // Date & accent bar
  ctx.fillStyle = accent.primary;
  drawRoundedRectPath(ctx, metaX, cursorY - 2, 28, 4, 2);
  ctx.fill();

  ctx.font = '500 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#94A3B8';
  ctx.textBaseline = 'middle';
  ctx.fillText(formatDate(trip.startTimeMs), metaX + 42, cursorY);

  // Route Title (1-2 lines)
  cursorY += 46;
  ctx.font = '600 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#F8FAFC';
  ctx.textBaseline = 'top';
  const titleLines = wrapTextLines(ctx, trip.title, metaW, 2);
  for (const line of titleLines) {
    ctx.fillText(line, metaX, cursorY);
    cursorY += 54;
  }

  // Metrics & Mode Pills Row
  const metricsY = MAP_FRAME_Y + MAP_FRAME_H + 228;

  // Distance
  ctx.font = '500 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.textBaseline = 'top';
  ctx.fillText('Distance', metaX, metricsY);
  ctx.font = '600 32px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#F8FAFC';
  ctx.fillText(formatDistance(trip.distanceM, units), metaX, metricsY + 26);

  // Duration
  const durX = metaX + 250;
  ctx.font = '500 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('Duration', durX, metricsY);
  ctx.font = '600 32px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#F8FAFC';
  ctx.fillText(formatDuration(trip.durationMs), durX, metricsY + 26);

  // Mode Pills (aligned to the right half)
  const uniqueModes = trip.modes.filter(
    (m) => m !== 'STILL' || trip.modes.length === 1
  );
  let pillX = metaX + 485;
  const pillY = metricsY + 20;
  ctx.font = '500 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  for (const mode of uniqueModes.slice(0, 4)) {
    const label = MODE_LABELS[mode];
    const color = MODE_COLORS[mode];
    const pillW = Math.ceil(ctx.measureText(label).width) + 46;
    if (pillX + pillW > metaRight) break;

    drawRoundedRectPath(ctx, pillX, pillY, pillW, 40, 10);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Colored mode dot
    ctx.beginPath();
    ctx.arc(pillX + 18, pillY + 20, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.fillStyle = '#E2E8F0';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, pillX + 32, pillY + 21);
    pillX += pillW + 12;
  }

  // Footer hairline & branding
  const footerY = CARD_H - 72;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(metaX, footerY);
  ctx.lineTo(metaRight, footerY);
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.font = '500 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('100% Private · Rendered On-Device', metaX, footerY + 34);

  const brandLabel = `ChronoMap ${APP_VERSION}`;
  ctx.font = '600 21px ui-monospace, SFMono-Regular, Menlo, monospace';
  const brandW = ctx.measureText(brandLabel).width;
  ctx.fillStyle = '#CBD5E1';
  ctx.fillText(brandLabel, metaRight - brandW, footerY + 34);

  // Small accent diamond left of brand label
  ctx.fillStyle = accent.primary;
  ctx.beginPath();
  ctx.arc(metaRight - brandW - 18, footerY + 34, 4.5, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to encode route postcard PNG.'));
      }
    }, 'image/png');
  });
}

/**
 * Generates a 1080x1350 route postcard PNG and opens the native Share Sheet
 * (`navigator.share`) when available, falling back to an automatic PNG download.
 */
export async function exportRoutePostcard(
  options: PostcardOptions
): Promise<PostcardShareResult> {
  const postcardCanvas = renderRoutePostcardCanvas(options);
  const blob = await canvasToPngBlob(postcardCanvas);
  const safeDate = options.trip.dateKey || 'journey';
  const fileName = `chronomap-${safeDate}.png`;

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const file = new File([blob], fileName, { type: 'image/png' });
    const shareData: ShareData = {
      title: `ChronoMap · ${options.trip.title}`,
      text: `${options.trip.title} (${formatDistance(
        options.trip.distanceM,
        options.units
      )})`,
      files: [file],
    };

    const canShareFiles =
      typeof navigator.canShare === 'function'
        ? navigator.canShare({ files: [file] })
        : false;

    if (canShareFiles) {
      try {
        await navigator.share(shareData);
        return 'shared';
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return 'cancelled';
        }
        // Fall through to PNG download if native share fails
      }
    }
  }

  // Fallback PNG download
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  return 'downloaded';
}
