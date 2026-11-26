# ChronoMap — Private Google Timeline Replay

A privacy-first, 100% client-side web application and installable PWA for importing Google Timeline `.json` exports and replaying journeys with a 60fps MapLibre GL animation engine. Zero location data ever leaves the browser.

## Features

- **Multi-Schema Web Worker Parser (`src/workers/timelineParser.ts`)**
  - **New On-Device `Timeline.json`** (`semanticSegments`, `timelinePath`, `visit`, `activity`)
  - **Classic Semantic Location History** (`timelineObjects`, `activitySegment`, `placeVisit`, E7 coordinates)
  - **Raw `Records.json`** (`locations` array with dwell clustering and activity inference)
  - Offloaded to a dedicated Web Worker (`src/workers/timeline.worker.ts`) with progress reporting and >1,200 km/h GPS spike filtering.
- **60fps WebGL Map Engine (`src/engine/animationController.ts` & `src/components/MapCanvas.tsx`)**
  - Smooth timestamp interpolation for coordinates, bearing, speed, and cumulative distance.
  - Low-opacity ghost route, vibrant color-coded glowing active route per transport mode, pulsing directional puck, and interactive Place Visit markers.
  - Three camera modes: **Chase** (`50°` pitch, speed-adaptive zoom, heading alignment), **Overview**, and **Free** with one-click **Re-center**.
- **Built-in Multi-Modal Sample Journey (`src/data/sampleJourney.ts`)**
  - Realistic Bay Area & Pacific Coast multi-day dataset covering walking, rail transit, driving, cycling, flight, and timed landmark visits.
- **Obsidian Glassmorphic HUD**
  - Collapsible Trip Explorer (`TripSidebar`), live Telemetry HUD (`TelemetryHUD`), and Media Playback Dock (`PlaybackDock`) with real-time multipliers (`1x`–`300x`) and normalized fit presets (`Fit 15s`, `Fit 30s`, `Fit 60s`).
- **Installable PWA & Offline App Shell**
  - Configured with `public/manifest.webmanifest`, PNG/SVG icons (`public/icons/`), and `public/sw.js` (registered in production builds via `src/main.tsx`).

## Local Development

```bash
npm install
npm test
npm run build
npm run dev
```

Open `http://127.0.0.1:5173` in a WebGL-capable browser.

## GitHub Pages Deployment & Android Packaging

- **Auto-Deploy Workflow (`.github/workflows/deploy.yml`):** Pushing to `main` or `master` runs `npm ci`, `npm test`, and `npm run build`, uploads `dist/` as a workflow artifact (`chronomap-dist`), and deploys `dist/` to GitHub Pages (enable **Settings → Pages → Source: GitHub Actions** in your repository).
- **Install on Android as a PWA:** Open the deployed HTTPS URL in Chrome on Android and tap **Install app** / **Add to Home screen** to run ChronoMap full-screen with its own launcher icon.
- **Package as a Play/Sideload APK:** Because ChronoMap is a complete PWA (`manifest.webmanifest` + Service Worker + 192/512 PNG icons + relative `./` assets), the deployed URL can be wrapped directly into an Android APK using **PWABuilder / Bubblewrap (TWA)** or packaged locally via **Capacitor** (`npx cap init` + `npx cap add android` pointing at `dist/`).
