import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  ChevronRight,
  Compass,
  Crosshair,
  Eye,
  Flame,
  Hand,
  Moon,
  Navigation2,
  Satellite,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  UploadCloud,
  Video,
  X,
} from 'lucide-react';
import { MapCanvas } from './components/MapCanvas';
import { PlaybackDock } from './components/PlaybackDock';
import { SettingsModal } from './components/SettingsModal';
import { StatsModal } from './components/StatsModal';
import { TelemetryHUD } from './components/TelemetryHUD';
import { ToastNotification } from './components/ToastNotification';
import { TripSidebar } from './components/TripSidebar';
import { createSampleTimelineJson } from './data/sampleJourney';
import { AnimationController } from './engine/animationController';
import type {
  AppSettings,
  CameraMode,
  MapStyleId,
  SpeedPreset,
  TelemetryFrame,
  TimelineSummaryIndex,
  TimelineViewMode,
  ToastMessage,
  Trip,
} from './types/timeline';
import { formatDistance, formatSchemaName } from './utils/format';
import {
  loadGeocodeCache,
  loadNicknames,
  ReverseGeocoderQueue,
  saveNickname,
} from './utils/geocoder';
import { ACCENT_THEMES, loadSettings, saveSettings } from './utils/settings';
import { useTimelineWorker, type WorkerParseResult } from './workers/TimelineWorker';

export default function App() {
  const controllerRef = useRef<AnimationController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new AnimationController();
  }
  const controller = controllerRef.current;

  const {
    isParsing,
    progress: parseProgress,
    stage: parseStage,
    parseFile,
    parseText,
    getTrip,
    getHeatmap,
    cancel: cancelParse,
  } = useTimelineWorker();

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [summaryIndex, setSummaryIndex] = useState<TimelineSummaryIndex | null>(null);
  const [viewMode, setViewMode] = useState<TimelineViewMode>('DAY');
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [isLoadingTrip, setIsLoadingTrip] = useState(false);

  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapGeoJson, setHeatmapGeoJson] =
    useState<GeoJSON.FeatureCollection | null>(null);
  const [isLoadingHeatmap, setIsLoadingHeatmap] = useState(false);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);

  const [nicknames, setNicknames] = useState<Record<string, string>>(() =>
    loadNicknames()
  );
  const [geocodeCache, setGeocodeCache] = useState<Record<string, string>>(() =>
    loadGeocodeCache()
  );

  const [frame, setFrame] = useState<TelemetryFrame | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>('CHASE');
  const [recenterNonce, setRecenterNonce] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const fileDropInputRef = useRef<HTMLInputElement>(null);
  const tripFetchSeqRef = useRef(0);
  const geocoderRef = useRef<ReverseGeocoderQueue | null>(null);

  const accent = ACCENT_THEMES[settings.accentTheme];

  const handleUpdateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const handleSaveNickname = useCallback(
    (lat: number, lng: number, nickname: string) => {
      const updated = saveNickname(lat, lng, nickname);
      setNicknames(updated);
    },
    []
  );

  const pushToast = useCallback(
    (kind: ToastMessage['kind'], title: string, description?: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-2), { id, kind, title, description }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5500);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Initialize rate-limited Nominatim reverse-geocoding queue
  useEffect(() => {
    const queue = new ReverseGeocoderQueue((coordKey, resolvedName) => {
      setGeocodeCache((prev) => ({ ...prev, [coordKey]: resolvedName }));
    });
    geocoderRef.current = queue;
    return () => {
      queue.destroy();
      geocoderRef.current = null;
    };
  }, []);

  // Lazily reverse-geocode unnamed visits when activeTrip changes
  useEffect(() => {
    if (!geocoderRef.current) return;
    geocoderRef.current.clear();
    if (activeTrip && activeTrip.visits.length > 0) {
      geocoderRef.current.enqueue(activeTrip.visits, nicknames, geocodeCache);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrip]);

  // Subscribe to throttled HUD frames & destroy controller on unmount
  useEffect(() => {
    const unsub = controller.subscribeHud((nextFrame) => {
      setFrame(nextFrame);
    });
    return () => {
      unsub();
      controller.destroy();
    };
  }, [controller]);

  const applyWorkerParseResult = useCallback(
    (result: WorkerParseResult, autoPlay: boolean) => {
      setSummaryIndex(result.index);
      setViewMode(result.initialViewMode);
      setActiveTrip(result.initialTrip);
      setSelectedTripId(result.initialTrip?.id ?? null);
      setShowHeatmap(false);
      setHeatmapGeoJson(null);
      setCameraMode('CHASE');
      controller.loadTrip(result.initialTrip, autoPlay);

      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        setSidebarOpen(false);
      }

      const { stats } = result.index;
      pushToast(
        'success',
        `Loaded ${stats.totalDays} ${stats.totalDays === 1 ? 'day' : 'days'} · ${
          stats.totalTrips
        } journeys (${formatSchemaName(stats.schema)})`,
        `${stats.totalWaypoints.toLocaleString()} waypoints · ${formatDistance(
          stats.totalDistanceM,
          settings.units
        )} · parsed in ${stats.parseDurationMs}ms`
      );
    },
    [controller, pushToast, settings.units]
  );

  const handleFileSelected = useCallback(
    async (file: File) => {
      if (
        !file.name.toLowerCase().endsWith('.json') &&
        file.type !== 'application/json'
      ) {
        pushToast(
          'error',
          'Unsupported file type',
          'Please select a Google Timeline .json file (Timeline.json, Semantic History, or Records.json).'
        );
        return;
      }

      try {
        const result = await parseFile(file);
        applyWorkerParseResult(result, false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to parse file.';
        if (msg !== 'Parsing cancelled.') {
          pushToast('error', 'Failed to parse Google Timeline JSON', msg);
        }
      }
    },
    [parseFile, applyWorkerParseResult, pushToast]
  );

  const handleLoadSample = useCallback(async () => {
    try {
      const sampleJson = createSampleTimelineJson();
      const result = await parseText(sampleJson);
      applyWorkerParseResult(result, true);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to load sample journey.';
      pushToast('error', 'Sample dataset error', msg);
    }
  }, [parseText, applyWorkerParseResult, pushToast]);

  const loadTripFromWorker = useCallback(
    async (tripId: string, targetMode: TimelineViewMode, autoPlay: boolean) => {
      const reqSeq = ++tripFetchSeqRef.current;
      setIsLoadingTrip(true);
      try {
        const trip = await getTrip(tripId, targetMode);
        if (reqSeq !== tripFetchSeqRef.current || !trip) return;
        setActiveTrip(trip);
        setSelectedTripId(trip.id);
        controller.loadTrip(trip, autoPlay);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to load trip.';
        pushToast('error', 'Trip load failed', msg);
      } finally {
        if (reqSeq === tripFetchSeqRef.current) {
          setIsLoadingTrip(false);
        }
      }
    },
    [getTrip, controller, pushToast]
  );

  const handleSelectTrip = useCallback(
    (tripId: string, targetMode: TimelineViewMode) => {
      setViewMode(targetMode);
      void loadTripFromWorker(tripId, targetMode, true);
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        setSidebarOpen(false);
      }
    },
    [loadTripFromWorker]
  );

  const handleViewModeChange = useCallback(
    (nextMode: TimelineViewMode) => {
      setViewMode(nextMode);
      if (!summaryIndex) return;
      const list = nextMode === 'DAY' ? summaryIndex.days : summaryIndex.journeys;
      if (list.length === 0) return;
      const matchSameDate = activeTrip
        ? list.find((item) => item.dateKey === activeTrip.dateKey)
        : undefined;
      const target = matchSameDate ?? list[0];
      void loadTripFromWorker(target.id, nextMode, false);
    },
    [summaryIndex, activeTrip, loadTripFromWorker]
  );

  const handleToggleHeatmap = useCallback(async () => {
    if (showHeatmap) {
      setShowHeatmap(false);
      return;
    }
    if (!heatmapGeoJson) {
      setIsLoadingHeatmap(true);
      try {
        const geo = await getHeatmap();
        setHeatmapGeoJson(geo);
        setShowHeatmap(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to build heatmap.';
        pushToast('error', 'Heatmap error', msg);
      } finally {
        setIsLoadingHeatmap(false);
      }
    } else {
      setShowHeatmap(true);
    }
  }, [showHeatmap, heatmapGeoJson, getHeatmap, pushToast]);

  const handleSelectCameraMode = useCallback((nextMode: CameraMode) => {
    setCameraMode((prev) => {
      if (prev === nextMode) {
        setRecenterNonce((n) => n + 1);
      }
      return nextMode;
    });
  }, []);

  const handleTogglePlay = useCallback(() => {
    controller.togglePlay();
  }, [controller]);

  const handleSeekProgress = useCallback(
    (progress: number) => {
      controller.seekToProgress(progress);
    },
    [controller]
  );

  const handleStepSegment = useCallback(
    (delta: -1 | 1) => {
      controller.stepSegment(delta);
    },
    [controller]
  );

  const handleSelectSpeed = useCallback(
    (preset: SpeedPreset) => {
      controller.setSpeedPreset(preset);
    },
    [controller]
  );

  const handleToggleLoop = useCallback(() => {
    const snap = controller.getSnapshot();
    controller.setLoop(!(snap?.loop ?? false));
  }, [controller]);

  const handleMapError = useCallback(
    (message: string) => {
      pushToast('info', 'Map rendering notice', message);
    },
    [pushToast]
  );

  // Keyboard shortcuts: Space (play/pause), Left/Right (step segment), C (cycle camera)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (!activeTrip) return;

      if (e.code === 'Space') {
        e.preventDefault();
        controller.togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        controller.stepSegment(-1);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        controller.stepSegment(1);
      } else if (e.key.toLowerCase() === 'c') {
        setCameraMode((prev) =>
          prev === 'CHASE'
            ? 'DRONE'
            : prev === 'DRONE'
              ? 'OVERVIEW'
              : prev === 'OVERVIEW'
                ? 'FREE'
                : 'CHASE'
        );
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller, activeTrip]);

  const totalBadgeCount = summaryIndex
    ? viewMode === 'DAY'
      ? summaryIndex.days.length
      : summaryIndex.journeys.length
    : 0;

  const renderMapStylePill = (compact = false) => {
    const styles: { id: MapStyleId; label: string; icon: JSX.Element }[] = [
      { id: 'DARK', label: 'Dark', icon: <Moon className="w-3 h-3" /> },
      { id: 'SATELLITE', label: 'Sat', icon: <Satellite className="w-3 h-3" /> },
      { id: 'DAYLIGHT', label: 'Day', icon: <Sun className="w-3 h-3" /> },
    ];

    return (
      <div className="pointer-events-auto flex items-center gap-1 p-1 rounded-xl bg-slate-950/80 border border-white/10 backdrop-blur-md shadow-xl">
        {styles.map((s) => {
          const active = settings.mapStyle === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => handleUpdateSettings({ mapStyle: s.id })}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all border"
              style={{
                backgroundColor: active ? accent.softBg : 'transparent',
                borderColor: active ? accent.border : 'transparent',
                color: active ? accent.text : '#94a3b8',
              }}
              title={`${s.label} map style`}
            >
              {s.icon}
              {!compact && <span>{s.label}</span>}
            </button>
          );
        })}

        <div className="w-px h-4 bg-white/10 mx-0.5" />

        <button
          type="button"
          onClick={() => handleUpdateSettings({ enable3D: !settings.enable3D })}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all border"
          style={{
            backgroundColor: settings.enable3D ? accent.softBg : 'transparent',
            borderColor: settings.enable3D ? accent.border : 'transparent',
            color: settings.enable3D ? accent.text : '#94a3b8',
          }}
          title="Toggle 3D Terrain & Extruded Buildings"
        >
          <Box className="w-3 h-3" />
          <span>3D</span>
        </button>

        <button
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
          title="Appearance & Settings"
          aria-label="Open Settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  const renderCameraControls = (compact = false) => {
    if (!activeTrip) return null;
    const items: { id: CameraMode; label: string; title: string; icon: JSX.Element }[] = [
      {
        id: 'CHASE',
        label: 'Chase',
        title: 'Cinematic Chase camera',
        icon: <Navigation2 className="w-3.5 h-3.5" />,
      },
      {
        id: 'DRONE',
        label: 'Drone',
        title: 'Drone Chase (65° spline camera)',
        icon: <Video className="w-3.5 h-3.5" />,
      },
      {
        id: 'OVERVIEW',
        label: 'Overview',
        title: 'Frame entire trip',
        icon: <Eye className="w-3.5 h-3.5" />,
      },
      {
        id: 'FREE',
        label: 'Free',
        title: 'Free manual pan/zoom/tilt',
        icon: <Hand className="w-3.5 h-3.5" />,
      },
    ];

    return (
      <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
        <div className="flex items-center p-1 rounded-xl bg-slate-950/80 border border-white/10 backdrop-blur-md shadow-xl">
          {items.map((item) => {
            const active = cameraMode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectCameraMode(item.id)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all border"
                style={{
                  backgroundColor: active ? accent.softBg : 'transparent',
                  borderColor: active ? accent.border : 'transparent',
                  color: active ? accent.text : '#94a3b8',
                }}
                title={item.title}
              >
                {item.icon}
                {!compact && <span>{item.label}</span>}
              </button>
            );
          })}
        </div>

        {cameraMode === 'FREE' && (
          <button
            type="button"
            onClick={() => handleSelectCameraMode('CHASE')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-semibold text-[11px] shadow-lg transition-all"
            style={{
              backgroundColor: accent.buttonBg,
              color: accent.buttonText,
              boxShadow: `0 6px 18px ${accent.glow}`,
            }}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Re-center</span>
          </button>
        )}

        {showHeatmap && (
          <button
            type="button"
            onClick={() => setShowHeatmap(false)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-500/20 border border-rose-400/45 text-rose-200 hover:bg-rose-500/30 text-[11px] font-semibold backdrop-blur-md shadow-lg transition-all"
            title="Turn off All-Time Heatmap"
          >
            <Flame className="w-3.5 h-3.5 text-rose-400" />
            <span>Heatmap</span>
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  };

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#070A0F] text-slate-100">
      {/* Full-Viewport WebGL Map */}
      <MapCanvas
        controller={controller}
        trip={activeTrip}
        cameraMode={cameraMode}
        recenterNonce={recenterNonce}
        onCameraModeChange={setCameraMode}
        sidebarOpen={sidebarOpen}
        settings={settings}
        showHeatmap={showHeatmap}
        heatmapGeoJson={heatmapGeoJson}
        nicknames={nicknames}
        geocodeCache={geocodeCache}
        onMapError={handleMapError}
      />

      {/* Unified Top Safe-Area HUD Bar */}
      <header className="fixed top-0 left-0 right-0 z-20 px-3 pointer-events-none safe-top-hud">
        <div className="pt-2 flex items-start justify-between gap-2">
          {/* Left: Trips Button (when collapsed) + Mobile Style/3D/Camera Controls */}
          <div className="flex flex-col items-start gap-1.5 shrink-0">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 px-3 py-2 rounded-xl bg-slate-950/80 border border-white/15 backdrop-blur-md text-slate-100 hover:bg-slate-900/90 shadow-xl transition-all text-xs font-medium"
                title="Expand Trip Explorer"
              >
                <Compass
                  className="w-4 h-4 shrink-0"
                  style={{ color: accent.primary }}
                />
                <span>Trips</span>
                {totalBadgeCount > 0 && (
                  <span
                    className="px-1.5 py-0.5 rounded-md text-[10px] font-mono tabular-nums"
                    style={{
                      backgroundColor: accent.softBg,
                      color: accent.text,
                    }}
                  >
                    {totalBadgeCount}
                  </span>
                )}
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>
            )}

            <div className="lg:hidden flex flex-col items-start gap-1.5">
              {renderMapStylePill(true)}
              {renderCameraControls(true)}
            </div>
          </div>

          {/* Center: Desktop Map Style + 3D + Camera Controls */}
          <div
            className={`hidden lg:flex flex-wrap items-center justify-center gap-2 flex-1 min-w-0 ${
              sidebarOpen ? 'pl-[348px]' : ''
            }`}
          >
            {renderMapStylePill(false)}
            {renderCameraControls(false)}
          </div>

          {/* Right: Telemetry HUD */}
          <div className="flex flex-col items-end shrink min-w-0">
            <TelemetryHUD
              frame={frame}
              units={settings.units}
              accentTheme={settings.accentTheme}
              nicknames={nicknames}
              geocodeCache={geocodeCache}
              onSaveNickname={handleSaveNickname}
            />
          </div>
        </div>
      </header>

      {/* Empty State Welcome Card */}
      {!activeTrip && (
        <div className="fixed inset-0 z-10 flex items-center justify-center pointer-events-none px-4 sm:pl-[360px]">
          <div className="pointer-events-auto max-w-md w-full rounded-2xl bg-slate-950/80 border border-white/15 backdrop-blur-md shadow-2xl p-6 text-center space-y-4">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-[11px] font-medium text-emerald-300">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Privacy-First · Zero Data Leaves Your Device</span>
            </div>

            <div className="space-y-1.5">
              <h2 className="text-xl font-semibold tracking-tight text-white">
                Replay Your Google Timeline in 3D at 60fps
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                Drop your{' '}
                <code style={{ color: accent.primary }}>Timeline.json</code>,{' '}
                <code style={{ color: accent.primary }}>
                  Semantic Location History
                </code>
                , or <code style={{ color: accent.primary }}>Records.json</code>{' '}
                file—parsed locally inside a Web Worker.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={handleLoadSample}
                disabled={isParsing}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs shadow-lg transition-all disabled:opacity-50"
                style={{
                  backgroundColor: accent.buttonBg,
                  color: accent.buttonText,
                  boxShadow: `0 6px 22px ${accent.glow}`,
                }}
              >
                <Sparkles className="w-4 h-4" />
                <span>Load Sample Journey</span>
              </button>

              <button
                type="button"
                onClick={() => fileDropInputRef.current?.click()}
                disabled={isParsing}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/15 text-slate-100 font-medium text-xs transition-all disabled:opacity-50"
              >
                <UploadCloud
                  className="w-4 h-4"
                  style={{ color: accent.primary }}
                />
                <span>Import .json File</span>
              </button>

              <input
                ref={fileDropInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleFileSelected(file);
                    e.target.value = '';
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Left Collapsible Trip Explorer */}
      <TripSidebar
        isOpen={sidebarOpen}
        onToggleOpen={() => setSidebarOpen((v) => !v)}
        index={summaryIndex}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        selectedTripId={selectedTripId}
        onSelectTrip={handleSelectTrip}
        isLoadingTrip={isLoadingTrip}
        onFileSelected={handleFileSelected}
        onLoadSample={handleLoadSample}
        isParsing={isParsing}
        parseProgress={parseProgress}
        parseStage={parseStage}
        onCancelParse={cancelParse}
        units={settings.units}
        accentTheme={settings.accentTheme}
        showHeatmap={showHeatmap}
        onOpenStatsModal={() => setIsStatsOpen(true)}
      />

      {/* Bottom Media Playback Dock */}
      <PlaybackDock
        trip={activeTrip}
        frame={frame}
        sidebarOpen={sidebarOpen}
        units={settings.units}
        accentTheme={settings.accentTheme}
        onTogglePlay={handleTogglePlay}
        onSeekProgress={handleSeekProgress}
        onStepSegment={handleStepSegment}
        onSelectSpeed={handleSelectSpeed}
        onToggleLoop={handleToggleLoop}
      />

      {/* Appearance & Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
      />

      {/* Lifetime Stats & All-Time Heatmap Modal */}
      <StatsModal
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
        stats={summaryIndex?.lifetimeStats ?? null}
        units={settings.units}
        accentTheme={settings.accentTheme}
        showHeatmap={showHeatmap}
        isLoadingHeatmap={isLoadingHeatmap}
        onToggleHeatmap={() => void handleToggleHeatmap()}
        nicknames={nicknames}
        geocodeCache={geocodeCache}
        onSaveNickname={handleSaveNickname}
      />

      {/* Toast Notifications */}
      <ToastNotification toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
