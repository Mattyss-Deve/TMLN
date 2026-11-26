# ChronoMap — Private Google Timeline Replay

A privacy-first, 100% client-side web application, installable PWA, and Capacitor Android app for importing Google Timeline `.json` exports and replaying journeys with a 60fps MapLibre GL animation engine. Zero location data ever leaves the device.

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
- **Installable PWA & Capacitor Android App**
  - PWA manifest (`public/manifest.webmanifest`), PNG/SVG icons (`public/icons/`), and Service Worker (`public/sw.js`).
  - Native Android Capacitor wrapper (`android/`, app ID `com.chronomap.app`, `INTERNET` permission enabled in `android/app/src/main/AndroidManifest.xml`).

## Local Development

```bash
npm install
npm test
npm run build
npm run dev
```

Open `http://127.0.0.1:5173` in a WebGL-capable browser.

## GitHub Actions & Android APK Builds

- **GitHub Pages Web/PWA Deploy (`.github/workflows/deploy.yml`):** Automatically builds `dist/` and deploys to GitHub Pages on pushes to `main`/`master` (enable **Settings → Pages → Source: GitHub Actions**).
- **Automated Android APK Build (`.github/workflows/build-apk.yml`):** Triggers on pushes to `main` or manual `workflow_dispatch`, runs `npm ci && npm run build && npx cap sync android`, compiles `android/app/build/outputs/apk/debug/app-debug.apk` with Java 21 (Temurin) + Gradle, and uploads it as the **`ChronoMap-APK`** workflow artifact.
