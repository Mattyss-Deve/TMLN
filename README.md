# ChronoMap — Private Google Timeline Replay

A privacy-first, 100% client-side web application, installable PWA, and Capacitor Android app for importing Google Timeline `.json` exports and replaying journeys with a 60fps MapLibre GL animation engine. Zero location data ever leaves the device.

## Features

- **Multi-Schema Web Worker Parser & Lazy Indexing (`src/workers/timelineParser.ts`, `src/workers/timeline.worker.ts`)**
  - **New On-Device `Timeline.json`** (`semanticSegments`, `timelinePath`, `visit`, `activity`, degree-formatted coordinates, `hierarchyLevel` deduplication, stationary jitter filtering, and `distanceMeters` fidelity)
  - **Classic Semantic Location History** (`timelineObjects`, `activitySegment`, `placeVisit`, E7 coordinates)
  - **Raw `Records.json`** (`locations` array with dwell clustering and activity inference)
  - Keeps 40MB+ parsed trips cached inside the Web Worker, transferring only lightweight day/journey summaries to the UI and loading full waypoints lazily on selection.
- **60fps Pre-Baked Spline, GPU Shader Route Progress & 3D Map Engine (`src/engine/animationController.ts`, `src/utils/lineGradient.ts`, `src/components/MapCanvas.tsx`)**
  - Pre-bakes the full Catmull-Rom smoothed spline, Web Mercator geometric `lineProgress`, bearings, speeds, and cumulative distances into flat typed arrays once per trip so `requestAnimationFrame` performs zero allocations or spline math per frame.
  - **Zero-CPU GPU Route Progress:** Uploads static `LineString` GeoJSON once with `lineMetrics: true` and reveals traveled segments on the GPU via `line-gradient` shader stops while updating the puck directly with `marker.setLngLat()` (zero per-frame `setData()`).
  - **Corridor Pre-Staging Loader:** Frames each trip's bounding box (`maxZoom: 15`) with a translucent progress bar overlay (`Staging 3D Corridor...`) to warm MapLibre's GPU tile cache (`maxTileCacheSize: 250`, capped `pixelRatio <= 1.75`, `fadeDuration: 0`) with a 2.2-second timeout fallback before snapping smoothly to the starting viewpoint.
  - **3 Map Styles + 3D Buildings Mode:** Obsidian Dark (Carto), Satellite Hybrid (Esri World Imagery + Carto labels), and Daylight 3D (OpenFreeMap Liberty), plus extruded OpenFreeMap 3D buildings (`fill-extrusion`) without heavy DEM terrain draping.
  - Four camera modes: **Chase** (`52°` in 3D), **Drone Chase** (`56°` spline pitch), **Overview**, and **Free** with one-click **Re-center**.
- **Reverse Geocoding, Custom Nicknames & All-Time Heatmap (`src/utils/geocoder.ts`, `src/components/StatsModal.tsx`, `src/components/SettingsModal.tsx`)**
  - Rate-limited Nominatim reverse-geocoding (1 req/sec) and tap-to-rename visit nicknames persisted in `localStorage`.
  - All-Time Stats & Heatmap modal with lifetime mode breakdowns (Subway, Tram, Bus, Train, Walk, Driving, Cycling, Flight), Top 10 visited places, and toggleable map heatmap overlay.
  - Appearance & Settings drawer for Accent Theme, route thickness/glow, and Metric/Imperial units.
- **Built-in Multi-Modal Sample Journey (`src/data/sampleJourney.ts`)**
  - Realistic Bay Area & Pacific Coast multi-day dataset covering walking, rail transit, driving, cycling, flight, and timed landmark visits.
- **Obsidian Glassmorphic HUD & Android Safe-Area Support**
  - Collapsible Trip Explorer (`TripSidebar`) with **By Day** / **Individual Journeys** toggle, Year/Month dropdown, date picker, and search.
  - Safe-area-aware top HUD (`TelemetryHUD`), camera switcher, and Media Playback Dock (`PlaybackDock`) with real-time multipliers (`1x`–`300x`) and normalized fit presets (`Fit 15s`, `Fit 30s`, `Fit 60s`).
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
- **Automated Android APK Build (`.github/workflows/build-apk.yml`):** Triggers on pushes to `main` or manual `workflow_dispatch`, runs `npm ci && npm run build && npx cap sync android`, signs debug APKs consistently using `android/app/chronomap-debug.keystore` for seamless in-place updates, compiles `android/app/build/outputs/apk/debug/app-debug.apk` with Java 21 (Temurin) + Gradle, and uploads it as the **`ChronoMap-APK`** workflow artifact.
