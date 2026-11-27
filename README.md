# ChronoMap — Private Google Timeline Replay (`v1.4.0`)

A privacy-first, 100% client-side web application, installable PWA, and Capacitor Android app for importing Google Timeline `.json` exports and replaying journeys with a 60fps MapLibre GL animation engine. Zero location data ever leaves the device.

## Features

- **Multi-Schema Web Worker Parser & Lazy Indexing (`src/workers/timelineParser.ts`, `src/workers/timeline.worker.ts`)**
  - **New On-Device `Timeline.json`** (`semanticSegments`, `timelinePath`, `visit`, `activity`, degree-formatted coordinates, `hierarchyLevel` deduplication, stationary jitter filtering, `~3m` Ramer-Douglas-Peucker polyline simplification, and `distanceMeters` fidelity)
  - **Classic Semantic Location History** (`timelineObjects`, `activitySegment`, `placeVisit`, E7 coordinates)
  - **Raw `Records.json`** (`locations` array with dwell clustering and activity inference)
  - Keeps 40MB+ parsed trips cached inside the Web Worker, transferring only lightweight day/journey summaries to the UI and loading full waypoints lazily on selection.
- **Instant IndexedDB Persistence (`src/utils/storage.ts`)**
  - Automatically persists the imported Google Timeline `.json` file locally in IndexedDB (`chronomap-cache-v1`) so reopening ChronoMap restores multi-year history immediately without re-importing, paired with a quick **Load New JSON** action in the sidebar.
- **60fps Pre-Baked Spline, GPU Shader Route Progress & 3D Map Engine (`src/engine/animationController.ts`, `src/utils/lineGradient.ts`, `src/components/MapCanvas.tsx`)**
  - Pre-bakes the full Catmull-Rom smoothed spline, Web Mercator geometric `lineProgress`, bearings, speeds, and cumulative distances into flat typed arrays once per trip so `requestAnimationFrame` performs zero allocations or spline math per frame.
  - **Zero-CPU GPU Route Progress:** Uploads static `LineString` GeoJSON once with `lineMetrics: true` and reveals traveled segments on the GPU via `line-gradient` shader stops while updating the puck directly with `marker.setLngLat()` (zero per-frame `setData()`).
  - **Corridor Pre-Staging Loader:** Frames each new trip's bounding box (`maxZoom: 15`) with a non-blocking style switcher, `Promise.race` `1500ms` timeout failsafe, and translucent progress bar overlay (`Staging 3D Corridor...`) to warm MapLibre's GPU tile cache (`maxTileCacheSize: 250`, capped `pixelRatio <= 1.75`, `fadeDuration: 0`).
  - **3 Map Styles + Zoom-Faded 3D Buildings:** Obsidian Dark (Carto), Satellite Hybrid (Esri World Imagery + Carto labels), and Daylight 3D (OpenFreeMap Liberty), plus extruded OpenFreeMap 3D buildings (`minzoom: 13.5`, smoothly interpolated from `0` at zoom `13.5` to full height at zoom `14.5`).
  - **Full-Scene All-Style Solar Grading (`src/utils/solar.ts`):** Computes real-time solar elevation, azimuth, and phase (`Night`, `Blue Hour`, `Dawn`, `Daylight`, `Golden Hour`, `Dusk`) from `(lat, lng, timestampMs)` to drive Satellite raster exposure grading, vector atmospheric tinting, sky/fog/stars, 3D building facade shading, night route glow bloom, a daytime sun-tracked puck shadow that crossfades into a luminous night headlamp cone below `2°`, and a compact Solar Horizon Arc in the HUD.
  - **Velocity & Dwell Sparkline Scrubber (`src/components/PlaybackDock.tsx`):** SVG velocity waveform and stationary dwell blocks integrated into the timeline scrubber, swipe-left/right day navigation, and a compact `•••` popover for Loop, Postcard, and 9:16 Reel export.
  - **Director's Cinema Mode (`src/components/CinemaOverlay.tsx`):** Gesture-safe single-tap on empty map space (or top HUD button) fades out standard panels, slides in `2.39:1` anamorphic letterbox bars with a minimal auto-dimming title card, engages autonomous director camera drift (`±18°` bearing sweep, `58°` close walk pitch / `46°` fast transit pitch), and supports double-tap Play/Pause, lower-screen horizontal swipe scrubbing, and single-tap or Android Back exit.
  - **Mechanical Watch-Crown Haptics (`src/utils/haptics.ts`):** Powered by `@capacitor/haptics` with `22ms` / `1.5%` scrubber detents, medium segment/visit arrival pulses, and success notifications (toggleable via **Tactile Haptics**).
  - Four camera modes: **Chase** (`52°` in 3D), **Drone Chase** (`56°` spline pitch), **Overview**, and **Free** with one-click **Re-center**.
- **Route Postcard & Automated 9:16 Video Reel Export (`src/utils/postcard.ts`, `src/utils/reelExporter.ts`)**
  - **Postcard (1080×1350):** Captures the live WebGL canvas (`preserveDrawingBuffer: true`) into a framed editorial route postcard with date, title, distance, duration, mode pills, and `ChronoMap v1.3.0` footer via `navigator.share` or PNG download.
  - **Video Reel (9:16, 720×1280 @ 30fps):** Automates a 12-second (360-frame) 3D Drone Chase sweep composited with live telemetry, solar phase, and progress bar into a `video/webm` reel via `MediaRecorder` + cancelable progress modal.
- **Smart Discovery, Reverse Geocoding & All-Time Heatmap (`src/components/TripSidebar.tsx`, `src/utils/geocoder.ts`, `src/components/StatsModal.tsx`)**
  - Star/bookmark toggles on trip and day rows (persisted in `localStorage`) plus quick filter tabs: **All**, **Starred**, **On This Day**, and **Longest**.
  - Rate-limited Nominatim reverse-geocoding (1 req/sec) and tap-to-rename visit nicknames persisted in `localStorage`.
  - All-Time Stats & Heatmap modal with lifetime mode breakdowns, Top 10 visited places, and toggleable map heatmap overlay.
- **Tactile Instrument HUD & Custom Adaptive App Icon (`scripts/generate_app_icons.py`)**
  - Matte obsidian instrument surfaces (`rgba(11, 14, 20, 0.86)` with `backdrop-blur-xl`), crisp `1px` hairlines, unified top control strip, compact horizontal telemetry readout, and strict `tabular-nums` typography.
  - Bespoke Pillow-generated Android adaptive/legacy launcher icons (`android/app/src/main/res/mipmap-*`) and PWA icons (`public/icons/icon-{192,512}.png`).

## Local Development

```bash
npm install
npm test
npm run build
npm run dev
```

Regenerate Android adaptive launcher icons & PWA icons (requires Pillow):

```bash
python scripts/generate_app_icons.py
```

## Versioning Convention

ChronoMap follows **Semantic Versioning (`MAJOR.MINOR.PATCH`)**. When cutting a new release, bump all three version locations together before syncing Android:

1. **`package.json`**: update `"version": "X.Y.Z"`.
2. **`android/app/build.gradle`**: increment `versionCode` by `1` (monotonic integer required by Android for in-place APK upgrades) and update `versionName "X.Y.Z"`.
3. **`src/utils/settings.ts`**: update `export const APP_VERSION = 'vX.Y.Z';` (displayed subtly in the `SettingsModal` and `TripSidebar` footers and on exported Route Postcards).

## GitHub Actions & Android APK Builds

- **GitHub Pages Web/PWA Deploy (`.github/workflows/deploy.yml`):** Automatically builds `dist/` and deploys to GitHub Pages on pushes to `main`/`master` (enable **Settings → Pages → Source: GitHub Actions**).
- **Automated Android APK Build (`.github/workflows/build-apk.yml`):** Triggers on pushes to `main` or manual `workflow_dispatch`, runs `npm ci && npm run build && npx cap sync android`, signs debug APKs consistently using `android/app/chronomap-debug.keystore` for seamless in-place updates, compiles `android/app/build/outputs/apk/debug/app-debug.apk` with Java 21 (Temurin) + Gradle, and uploads it as the **`ChronoMap-APK`** workflow artifact.
