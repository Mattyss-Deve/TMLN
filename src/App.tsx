import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import {
  Box,
  ChevronRight,
  Clapperboard,
  Compass,
  Crosshair,
  Eye,
  Film,
  Flame,
  Hand,
  Loader2,
  Moon,
  Navigation2,
  Satellite,
  Settings,
  Sparkles,
  Sun,
  SunMoon,
  UploadCloud,
  Video,
  X,
} from 'lucide-react';
import { CinemaOverlay } from './components/CinemaOverlay';
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
  CorridorStagingState,
  MapStyleId,
  ReelExportProgress,
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
import { setHapticsEnabled, triggerSuccessPulse } from './utils/haptics';
import { exportRoutePostcard } from './utils/postcard';
import { exportVideoReel } from './utils/reelExporter';
import {
  ACCENT_THEMES,
  APP_VERSION,
  loadSettings,
  saveSettings,
} from './utils/settings';
import {
  loadStarredTripIds,
  loadTimelineFromIndexedDB,
  saveStarredTripIds,
  saveTimelineToIndexedDB,
  toggleStarredTripId,
} from './utils/storage';
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

  const [cachedFileName, setCachedFileName] = useState<string | null>(null);
  const [isRestoringCache, setIsRestoringCache] = useState(false);
  const [starredIds, setStarredIds] = useState<string[]>(() => loadStarredTripIds());
  const [isExportingPostcard, setIsExportingPostcard] = useState(false);

  const [reelProgress, setReelProgress] = useState<ReelExportProgress>({
    active: false,
    percent: 0,
    frame: 0,
    totalFrames: 360,
    stage: '',
  });
  const reelAbortRef = useRef<AbortController | null>(null);

  const [cinemaMode, setCinemaMode] = useState(false);
  const [cinemaPulseIcon, setCinemaPulseIcon] = useState<'play' | 'pause' | null>(null);
  const cinemaPulseTimerRef = useRef<number | null>(null);
  const cinemaHistoryPushedRef = useRef(false);

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
  const [autoPlayOnReady, setAutoPlayOnReady] = useState(false);
  const [staging, setStaging] = useState<CorridorStagingState>({
    active: false,
    percent: 0,
    label: '',
  });
  const [cameraMode, setCameraMode] = useState<CameraMode>('CHASE');
  const [recenterNonce, setRecenterNonce] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const fileDropInputRef = useRef<HTMLInputElement>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const tripFetchSeqRef = useRef(0);
  const geocoderRef = useRef<ReverseGeocoderQueue | null>(null);
  const hasAttemptedRestoreRef = useRef(false);

  const accent = ACCENT_THEMES[settings.accentTheme];

  // Sync runtime haptics switch with settings
  useEffect(() => {
    setHapticsEnabled(settings.hapticsEnabled);
  }, [settings.hapticsEnabled]);

  const handleUpdateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const handleToggleStar = useCallback((id: string) => {
    setStarredIds((prev) => {
      const next = toggleStarredTripId(prev, id);
      saveStarredTripIds(next);
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
      }, 4800);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Cinema Mode enter/exit with Android Back (`popstate`) support
  const enterCinemaMode = useCallback(() => {
    if (!activeTrip || reelProgress.active) return;
    setIsSettingsOpen(false);
    setIsStatsOpen(false);
    setCinemaMode(true);
    if (!cinemaHistoryPushedRef.current && typeof window !== 'undefined') {
      try {
        window.history.pushState({ chronomapCinema: true }, '');
        cinemaHistoryPushedRef.current = true;
      } catch {
        // Ignore history restrictions
      }
    }
  }, [activeTrip, reelProgress.active]);

  const exitCinemaMode = useCallback((fromPopState = false) => {
    setCinemaMode(false);
    if (!fromPopState && cinemaHistoryPushedRef.current && typeof window !== 'undefined') {
      cinemaHistoryPushedRef.current = false;
      try {
        if (window.history.state?.chronomapCinema) {
          window.history.back();
        }
      } catch {
        // Ignore history errors
      }
    } else if (fromPopState) {
      cinemaHistoryPushedRef.current = false;
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      if (cinemaMode) {
        exitCinemaMode(true);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [cinemaMode, exitCinemaMode]);

  const handleCinemaPlayPause = useCallback(() => {
    const snap = controller.getSnapshot();
    const willPlay = !(snap?.isPlaying ?? false);
    controller.togglePlay();
    setCinemaPulseIcon(willPlay ? 'play' : 'pause');
    if (cinemaPulseTimerRef.current !== null) {
      window.clearTimeout(cinemaPulseTimerRef.current);
    }
    cinemaPulseTimerRef.current = window.setTimeout(() => {
      setCinemaPulseIcon(null);
      cinemaPulseTimerRef.current = null;
    }, 520);
  }, [controller]);

  const handleMapSingleTap = useCallback(() => {
    if (reelProgress.active || isSettingsOpen || isStatsOpen) return;
    if (cinemaMode) {
      exitCinemaMode(false);
    } else if (activeTrip) {
      enterCinemaMode();
    }
  }, [
    reelProgress.active,
    isSettingsOpen,
    isStatsOpen,
    cinemaMode,
    activeTrip,
    enterCinemaMode,
    exitCinemaMode,
  ]);

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
    (
      result: WorkerParseResult,
      autoPlay: boolean,
      options?: { restoredName?: string }
    ) => {
      setSummaryIndex(result.index);
      setViewMode(result.initialViewMode);
      setActiveTrip(result.initialTrip);
      setSelectedTripId(result.initialTrip?.id ?? null);
      setShowHeatmap(false);
      setHeatmapGeoJson(null);
      setCameraMode('CHASE');
      setAutoPlayOnReady(autoPlay);
      controller.loadTrip(result.initialTrip, false);

      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        setSidebarOpen(false);
      }

      const { stats } = result.index;
      pushToast(
        'success',
        options?.restoredName
          ? `Restored ${options.restoredName}`
          : `Loaded ${stats.totalDays} ${stats.totalDays === 1 ? 'day' : 'days'} · ${
              stats.totalTrips
            } journeys`,
        `${formatSchemaName(stats.schema)} · ${formatDistance(
          stats.totalDistanceM,
          settings.units
        )} · ${stats.parseDurationMs}ms`
      );
    },
    [controller, pushToast, settings.units]
  );

  // Restore last imported timeline automatically from IndexedDB on launch
  useEffect(() => {
    if (hasAttemptedRestoreRef.current) return;
    hasAttemptedRestoreRef.current = true;

    let cancelled = false;
    const restore = async () => {
      setIsRestoringCache(true);
      try {
        const record = await loadTimelineFromIndexedDB();
        if (cancelled || !record) return;
        const result = await parseFile(record.file);
        if (cancelled) return;
        setCachedFileName(record.fileName);
        applyWorkerParseResult(result, false, { restoredName: record.fileName });
      } catch {
        // Ignore stale or unreadable cache gracefully
      } finally {
        if (!cancelled) {
          setIsRestoringCache(false);
        }
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, [parseFile, applyWorkerParseResult]);

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
        setCachedFileName(file.name);
        applyWorkerParseResult(result, false);
        void saveTimelineToIndexedDB(file, file.name);
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
      setCachedFileName(null);
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
        setAutoPlayOnReady(autoPlay);
        controller.loadTrip(trip, false);
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

  const handleExportPostcard = useCallback(async () => {
    if (!activeTrip || isExportingPostcard || reelProgress.active) return;
    const map = mapInstanceRef.current;
    if (!map) {
      pushToast('error', 'Map not ready', 'Wait for the map canvas to finish loading.');
      return;
    }

    setIsExportingPostcard(true);
    try {
      map.triggerRepaint();
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

      const outcome = await exportRoutePostcard({
        mapCanvas: map.getCanvas(),
        trip: activeTrip,
        units: settings.units,
        accentTheme: settings.accentTheme,
      });

      if (outcome === 'shared') {
        triggerSuccessPulse();
        pushToast('success', 'Route postcard shared', `${activeTrip.title} · 1080×1350`);
      } else if (outcome === 'downloaded') {
        triggerSuccessPulse();
        pushToast(
          'success',
          'Route postcard saved',
          `Saved chronomap-${activeTrip.dateKey}.png (1080×1350)`
        );
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to capture map snapshot.';
      pushToast('error', 'Postcard export failed', msg);
    } finally {
      setIsExportingPostcard(false);
    }
  }, [
    activeTrip,
    isExportingPostcard,
    reelProgress.active,
    settings.units,
    settings.accentTheme,
    pushToast,
  ]);

  const handleCancelReel = useCallback(() => {
    reelAbortRef.current?.abort();
  }, []);

  const handleExportReel = useCallback(async () => {
    if (!activeTrip || reelProgress.active || isExportingPostcard) return;
    const map = mapInstanceRef.current;
    if (!map) {
      pushToast('error', 'Map not ready', 'Wait for the map canvas to finish loading.');
      return;
    }

    const abortController = new AbortController();
    reelAbortRef.current = abortController;

    const prevEnable3D = settings.enable3D;
    const prevCameraMode = cameraMode;
    const prevSidebar = sidebarOpen;
    const prevProgress = controller.getSnapshot()?.progress ?? 0;

    setReelProgress({
      active: true,
      percent: 2,
      frame: 0,
      totalFrames: 360,
      stage: 'Preparing 3D Drone Chase view...',
    });

    // Engage 3D buildings + Drone Chase cleanly for the automated 9:16 sweep
    if (!prevEnable3D) {
      handleUpdateSettings({ enable3D: true });
    }
    setCameraMode('DRONE');
    if (prevSidebar) {
      setSidebarOpen(false);
    }

    try {
      // Allow map style / 3D buildings & camera to settle into Drone Chase
      await new Promise<void>((resolve) => window.setTimeout(resolve, 420));

      const outcome = await exportVideoReel({
        map,
        controller,
        trip: activeTrip,
        units: settings.units,
        accentTheme: settings.accentTheme,
        solarSync: settings.solarSync,
        signal: abortController.signal,
        onProgress: setReelProgress,
      });

      if (outcome === 'shared') {
        triggerSuccessPulse();
        pushToast('success', '9:16 Video Reel shared', `${activeTrip.title} · 720×1280`);
      } else if (outcome === 'downloaded') {
        triggerSuccessPulse();
        pushToast(
          'success',
          '9:16 Video Reel saved',
          `Saved chronomap-reel-${activeTrip.dateKey}.webm`
        );
      } else {
        pushToast('info', 'Reel export cancelled');
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to record 9:16 video reel.';
      pushToast('error', 'Reel export failed', msg);
    } finally {
      reelAbortRef.current = null;
      setReelProgress({
        active: false,
        percent: 0,
        frame: 0,
        totalFrames: 360,
        stage: '',
      });
      if (!prevEnable3D) {
        handleUpdateSettings({ enable3D: false });
      }
      setCameraMode(prevCameraMode);
      if (prevSidebar) {
        setSidebarOpen(true);
      }
      controller.seekToProgress(prevProgress);
    }
  }, [
    activeTrip,
    reelProgress.active,
    isExportingPostcard,
    settings.enable3D,
    settings.units,
    settings.accentTheme,
    settings.solarSync,
    cameraMode,
    sidebarOpen,
    controller,
    handleUpdateSettings,
    pushToast,
  ]);

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

  // Swipe left/right on PlaybackDock jumps to next (+1 newer) or previous (-1 older) day/journey
  const handleStepTrip = useCallback(
    (delta: -1 | 1) => {
      if (!summaryIndex || !selectedTripId) return;
      const list = viewMode === 'DAY' ? summaryIndex.days : summaryIndex.journeys;
      if (list.length <= 1) return;
      const curIdx = list.findIndex((item) => item.id === selectedTripId);
      if (curIdx === -1) return;
      // List is newest-first: delta +1 (next chronological) moves toward index 0
      const nextIdx = curIdx - delta;
      if (nextIdx < 0 || nextIdx >= list.length) {
        pushToast(
          'info',
          delta > 0 ? 'Already at latest entry' : 'Already at earliest entry'
        );
        return;
      }
      const nextItem = list[nextIdx];
      void loadTripFromWorker(nextItem.id, viewMode, false);
    },
    [summaryIndex, selectedTripId, viewMode, loadTripFromWorker, pushToast]
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

  // Keyboard shortcuts: Space (play/pause), Left/Right (step), C (camera), Esc (exit cinema)
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

      if (e.code === 'Escape' && cinemaMode) {
        e.preventDefault();
        exitCinemaMode(false);
        return;
      }

      if (!activeTrip) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (cinemaMode) {
          handleCinemaPlayPause();
        } else {
          controller.togglePlay();
        }
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
  }, [controller, activeTrip, cinemaMode, exitCinemaMode, handleCinemaPlayPause]);

  const totalBadgeCount = summaryIndex
    ? viewMode === 'DAY'
      ? summaryIndex.days.length
      : summaryIndex.journeys.length
    : 0;

  const mapStyles: {
    id: MapStyleId;
    label: string;
    title: string;
    icon: JSX.Element;
  }[] = [
    {
      id: 'DARK',
      label: 'Night',
      title: 'Night (Carto Dark Matter)',
      icon: <Moon className="w-3.5 h-3.5" />,
    },
    {
      id: 'DAYLIGHT',
      label: 'Day',
      title: 'Day (OpenFreeMap Daylight)',
      icon: <Sun className="w-3.5 h-3.5" />,
    },
    {
      id: 'SATELLITE',
      label: 'Sat',
      title: 'Satellite Hybrid (Esri Imagery)',
      icon: <Satellite className="w-3.5 h-3.5" />,
    },
    {
      id: 'DYNAMIC',
      label: 'Dynamic',
      title: 'Dynamic (Full-Scene Solar Day/Night Cycle)',
      icon: <SunMoon className="w-3.5 h-3.5" />,
    },
  ];

  const cameraItems: {
    id: CameraMode;
    label: string;
    title: string;
    icon: JSX.Element;
  }[] = [
    {
      id: 'CHASE',
      label: 'Chase',
      title: 'Cinematic Chase camera',
      icon: <Navigation2 className="w-3.5 h-3.5" />,
    },
    {
      id: 'DRONE',
      label: 'Drone',
      title: 'Drone Chase (56° spline camera)',
      icon: <Video className="w-3.5 h-3.5" />,
    },
    {
      id: 'OVERVIEW',
      label: 'Overview',
      title: 'Frame entire route',
      icon: <Eye className="w-3.5 h-3.5" />,
    },
    {
      id: 'FREE',
      label: 'Free',
      title: 'Manual pan, zoom, and tilt',
      icon: <Hand className="w-3.5 h-3.5" />,
    },
  ];

  const hudHidden = cinemaMode || reelProgress.active;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0A0D14] text-slate-100">
      {/* Full-Viewport WebGL Map */}
      <MapCanvas
        controller={controller}
        trip={activeTrip}
        autoPlayOnReady={autoPlayOnReady}
        cameraMode={cameraMode}
        recenterNonce={recenterNonce}
        onCameraModeChange={setCameraMode}
        sidebarOpen={sidebarOpen && !hudHidden}
        settings={settings}
        showHeatmap={showHeatmap}
        heatmapGeoJson={heatmapGeoJson}
        nicknames={nicknames}
        geocodeCache={geocodeCache}
        cinemaMode={cinemaMode}
        mapInstanceRef={mapInstanceRef}
        onMapSingleTap={handleMapSingleTap}
        onMapDoubleTap={handleCinemaPlayPause}
        onStagingChange={setStaging}
        onMapError={handleMapError}
      />

      {/* Director's Cinema Mode Overlay (2.39:1 Letterbox + Scrub + Floating Title Card) */}
      <CinemaOverlay
        active={cinemaMode}
        trip={activeTrip}
        frame={frame}
        accentTheme={settings.accentTheme}
        solarSync={settings.solarSync}
        pulseIcon={cinemaPulseIcon}
        onExit={() => exitCinemaMode(false)}
        onTogglePlay={handleCinemaPlayPause}
        onScrubProgress={handleSeekProgress}
      />

      {/* Corridor Pre-Staging Progress Overlay */}
      {staging.active && !reelProgress.active && (
        <div
          className={`fixed inset-x-0 top-20 z-30 flex justify-center px-4 pointer-events-none transition-all duration-200 ${
            sidebarOpen && !hudHidden ? 'md:pl-[352px]' : ''
          }`}
        >
          <div className="w-full max-w-xs rounded-xl instrument-surface-strong px-3.5 py-2.5 space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-2 font-medium text-slate-100 truncate">
                <Loader2
                  className="w-3.5 h-3.5 animate-spin shrink-0"
                  style={{ color: accent.primary }}
                />
                <span className="truncate">
                  {staging.label || 'Staging 3D Corridor...'}
                </span>
              </span>
              <span
                className="font-mono tabular-nums text-[11px] font-medium shrink-0"
                style={{ color: accent.text }}
              >
                {Math.round(staging.percent)}%
              </span>
            </div>
            <div className="h-1 w-full rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-200 ease-out"
                style={{
                  width: `${Math.max(4, Math.min(100, staging.percent))}%`,
                  backgroundColor: accent.primary,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 9:16 Video Reel Encoding Modal */}
      {reelProgress.active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded-xl instrument-surface-strong p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Film
                  className="w-4 h-4 shrink-0"
                  style={{ color: accent.primary }}
                />
                <span className="text-sm font-semibold text-white truncate">
                  Exporting 9:16 Reel
                </span>
              </div>
              <span
                className="font-mono text-xs font-medium tabular-nums shrink-0"
                style={{ color: accent.text }}
              >
                {reelProgress.percent}%
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-150"
                  style={{
                    width: `${Math.max(3, Math.min(100, reelProgress.percent))}%`,
                    backgroundColor: accent.primary,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="truncate">{reelProgress.stage}</span>
                <span className="font-mono tabular-nums shrink-0 ml-2">
                  720×1280 · 30fps
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleCancelReel}
                className="px-3 py-1.5 rounded-lg instrument-inset hover:bg-white/[0.08] text-xs font-medium text-slate-200 active:scale-[0.98] transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unified Top Safe-Area Instrument Strip (fits cleanly inside 360px viewports) */}
      <header
        className={`fixed top-0 left-0 right-0 z-20 px-2 sm:px-3 pointer-events-none safe-top-hud transition-opacity duration-300 ${
          hudHidden ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <div
          className={`pt-2 flex flex-wrap items-start justify-between gap-1.5 sm:gap-2 transition-all ${
            sidebarOpen ? 'md:pl-[344px]' : ''
          }`}
        >
          {/* Left: Compact Unified Instrument Control Bar (zero right-edge clipping at 360px) */}
          <div
            className={`${
              hudHidden ? 'pointer-events-none' : 'pointer-events-auto'
            } flex flex-wrap items-center gap-1 max-w-full min-w-0`}
          >
            <div className="instrument-surface rounded-xl p-0.5 sm:p-1 flex items-center gap-[1px] sm:gap-0.5 max-w-full">
              {/* Trips Drawer Trigger (when collapsed) */}
              {!sidebarOpen && (
                <>
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(true)}
                    className="flex items-center gap-1 px-1 sm:px-2.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium text-slate-100 hover:bg-white/[0.07] active:scale-[0.98] transition-all shrink-0"
                    title="Open Trip Explorer"
                    aria-label="Open Trip Explorer"
                  >
                    <Compass
                      className="w-3.5 h-3.5 shrink-0"
                      style={{ color: accent.primary }}
                    />
                    <span className="hidden sm:inline">Trips</span>
                    {totalBadgeCount > 0 && (
                      <span
                        className="hidden sm:inline px-1.5 py-0.5 rounded-md text-[10px] font-mono tabular-nums"
                        style={{
                          backgroundColor: accent.softBg,
                          color: accent.text,
                        }}
                      >
                        {totalBadgeCount}
                      </span>
                    )}
                    <ChevronRight className="hidden sm:inline w-3 h-3 text-slate-500 shrink-0" />
                  </button>
                  <div className="w-px h-3.5 bg-white/[0.08] shrink-0" />
                </>
              )}

              {/* 4 Map Modes: Night / Day / Sat / Dynamic */}
              {mapStyles.map((s) => {
                const active = settings.mapStyle === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleUpdateSettings({ mapStyle: s.id })}
                    className="flex items-center gap-1 px-1 sm:px-2 py-1.5 rounded-lg text-[11px] font-medium active:scale-[0.98] transition-all border shrink-0"
                    style={{
                      backgroundColor: active ? accent.softBg : 'transparent',
                      borderColor: active ? accent.border : 'transparent',
                      color: active ? accent.text : '#94a3b8',
                    }}
                    title={s.title}
                    aria-label={s.title}
                  >
                    {s.icon}
                    <span className="hidden xl:inline">{s.label}</span>
                  </button>
                );
              })}

              <div className="w-px h-3.5 bg-white/[0.08] shrink-0" />

              {/* True Flat 2D vs Extruded 3D Toggle */}
              <button
                type="button"
                onClick={() =>
                  handleUpdateSettings({ enable3D: !settings.enable3D })
                }
                className="flex items-center gap-0.5 sm:gap-1 px-1 sm:px-2 py-1.5 rounded-lg text-[10px] sm:text-[11px] font-semibold active:scale-[0.98] transition-all border shrink-0"
                style={{
                  backgroundColor: settings.enable3D ? accent.softBg : 'transparent',
                  borderColor: settings.enable3D ? accent.border : 'transparent',
                  color: settings.enable3D ? accent.text : '#94a3b8',
                }}
                title="Toggle Flat 2D vs Extruded 3D Buildings"
              >
                <Box className="hidden sm:inline w-3.5 h-3.5" />
                <span>3D</span>
              </button>

              {/* Camera Mode Selector & Director's Cinema Button (when trip loaded) */}
              {activeTrip && (
                <>
                  <div className="w-px h-3.5 bg-white/[0.08] shrink-0" />
                  {cameraItems.map((item) => {
                    const active = cameraMode === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectCameraMode(item.id)}
                        className="flex items-center gap-1 px-1 sm:px-2 py-1.5 rounded-lg text-[11px] font-medium active:scale-[0.98] transition-all border shrink-0"
                        style={{
                          backgroundColor: active ? accent.softBg : 'transparent',
                          borderColor: active ? accent.border : 'transparent',
                          color: active ? accent.text : '#94a3b8',
                        }}
                        title={item.title}
                        aria-label={item.title}
                      >
                        {item.icon}
                        <span className="hidden lg:inline">{item.label}</span>
                      </button>
                    );
                  })}

                  <div className="w-px h-3.5 bg-white/[0.08] shrink-0" />

                  <button
                    type="button"
                    onClick={enterCinemaMode}
                    className="flex items-center gap-1 px-1 sm:px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-300 hover:text-white hover:bg-white/[0.07] active:scale-[0.98] transition-all shrink-0"
                    title="Enter Director's Cinema Mode (or tap empty map)"
                    aria-label="Enter Cinema Mode"
                  >
                    <Clapperboard className="w-3.5 h-3.5" />
                    <span className="hidden xl:inline">Cinema</span>
                  </button>
                </>
              )}

              <div className="w-px h-3.5 bg-white/[0.08] shrink-0" />

              {/* Settings Trigger (always visible inside 360px viewport) */}
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="px-1 sm:px-1.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.07] active:scale-[0.98] transition-all shrink-0"
                title="Settings"
                aria-label="Open Settings"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Contextual Re-center & Heatmap Chips */}
            {activeTrip && cameraMode === 'FREE' && (
              <button
                type="button"
                onClick={() => handleSelectCameraMode('CHASE')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-medium text-xs active:scale-[0.98] transition-all"
                style={{
                  backgroundColor: accent.buttonBg,
                  color: accent.buttonText,
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
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl instrument-surface border-rose-400/35 text-rose-200 hover:bg-rose-500/20 text-xs font-medium active:scale-[0.98] transition-all"
                title="Disable all-time heatmap"
              >
                <Flame className="w-3.5 h-3.5 text-rose-400" />
                <span>Heatmap</span>
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Right: Compact Low-Profile Telemetry Bar */}
          <div className="ml-auto shrink min-w-0">
            <TelemetryHUD
              frame={frame}
              units={settings.units}
              accentTheme={settings.accentTheme}
              solarSync={settings.solarSync}
              nicknames={nicknames}
              geocodeCache={geocodeCache}
              onSaveNickname={handleSaveNickname}
            />
          </div>
        </div>
      </header>

      {/* Empty State Welcome Card */}
      {!activeTrip && !isRestoringCache && (
        <div className="fixed inset-0 z-10 flex items-center justify-center pointer-events-none px-4 md:pl-[360px]">
          <div className="pointer-events-auto max-w-md w-full rounded-xl instrument-surface-strong p-6 text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg instrument-inset text-[11px] font-medium text-slate-300">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: accent.primary }}
              />
              <span>ChronoMap {APP_VERSION} · Local-only engine</span>
            </div>

            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold tracking-tight text-white">
                Replay your Google Timeline in 60fps
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Import{' '}
                <code className="text-slate-200">Timeline.json</code>,{' '}
                <code className="text-slate-200">Semantic Location History</code>, or{' '}
                <code className="text-slate-200">Records.json</code>. Parsed inside a
                local Web Worker and cached in IndexedDB for instant reopen.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleLoadSample}
                disabled={isParsing}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-xs active:scale-[0.98] transition-all hover:brightness-110 disabled:opacity-50"
                style={{
                  backgroundColor: accent.buttonBg,
                  color: accent.buttonText,
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Load Sample Journey</span>
              </button>

              <button
                type="button"
                onClick={() => fileDropInputRef.current?.click()}
                disabled={isParsing}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg instrument-inset hover:bg-white/[0.07] text-slate-100 font-medium text-xs active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <UploadCloud
                  className="w-3.5 h-3.5"
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
      {!hudHidden && (
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
          starredIds={starredIds}
          onToggleStar={handleToggleStar}
          cachedFileName={cachedFileName}
          isRestoringCache={isRestoringCache}
        />
      )}

      {/* Bottom Media Playback Dock */}
      {!hudHidden && (
        <PlaybackDock
          trip={activeTrip}
          frame={frame}
          sidebarOpen={sidebarOpen}
          units={settings.units}
          accentTheme={settings.accentTheme}
          onTogglePlay={handleTogglePlay}
          onSeekProgress={handleSeekProgress}
          onStepSegment={handleStepSegment}
          onStepTrip={handleStepTrip}
          onSelectSpeed={handleSelectSpeed}
          onToggleLoop={handleToggleLoop}
          onExportPostcard={() => void handleExportPostcard()}
          isExportingPostcard={isExportingPostcard}
          onExportReel={() => void handleExportReel()}
          isExportingReel={reelProgress.active}
        />
      )}

      {/* Settings Modal */}
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
