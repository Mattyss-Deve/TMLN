import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  Compass,
  Crosshair,
  Eye,
  Hand,
  Navigation2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import { MapCanvas } from './components/MapCanvas';
import { PlaybackDock } from './components/PlaybackDock';
import { TelemetryHUD } from './components/TelemetryHUD';
import { ToastNotification } from './components/ToastNotification';
import { TripSidebar } from './components/TripSidebar';
import { createSampleTimelineJson } from './data/sampleJourney';
import { AnimationController } from './engine/animationController';
import type {
  CameraMode,
  SpeedPreset,
  TelemetryFrame,
  TimelineSummaryIndex,
  TimelineViewMode,
  ToastMessage,
  Trip,
} from './types/timeline';
import { formatDistance, formatSchemaName } from './utils/format';
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
    cancel: cancelParse,
  } = useTimelineWorker();

  const [summaryIndex, setSummaryIndex] = useState<TimelineSummaryIndex | null>(null);
  const [viewMode, setViewMode] = useState<TimelineViewMode>('DAY');
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [isLoadingTrip, setIsLoadingTrip] = useState(false);

  const [frame, setFrame] = useState<TelemetryFrame | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>('CHASE');
  const [recenterNonce, setRecenterNonce] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const fileDropInputRef = useRef<HTMLInputElement>(null);
  const tripFetchSeqRef = useRef(0);

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
          stats.totalDistanceM
        )} · parsed in ${stats.parseDurationMs}ms`
      );
    },
    [controller, pushToast]
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
          prev === 'CHASE' ? 'OVERVIEW' : prev === 'OVERVIEW' ? 'FREE' : 'CHASE'
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

  const renderCameraControls = (compact = false) => {
    if (!activeTrip) return null;
    return (
      <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
        <div className="flex items-center p-1 rounded-xl bg-slate-950/80 border border-white/10 backdrop-blur-md shadow-xl">
          <button
            type="button"
            onClick={() => handleSelectCameraMode('CHASE')}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${
              cameraMode === 'CHASE'
                ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/40'
                : 'text-slate-400 hover:text-slate-100 border border-transparent'
            }`}
            title="Cinematic 3D Chase camera"
          >
            <Navigation2 className="w-3.5 h-3.5" />
            {!compact && <span>Chase</span>}
          </button>

          <button
            type="button"
            onClick={() => handleSelectCameraMode('OVERVIEW')}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${
              cameraMode === 'OVERVIEW'
                ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/40'
                : 'text-slate-400 hover:text-slate-100 border border-transparent'
            }`}
            title="Frame entire trip"
          >
            <Eye className="w-3.5 h-3.5" />
            {!compact && <span>Overview</span>}
          </button>

          <button
            type="button"
            onClick={() => handleSelectCameraMode('FREE')}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${
              cameraMode === 'FREE'
                ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/40'
                : 'text-slate-400 hover:text-slate-100 border border-transparent'
            }`}
            title="Free manual pan/zoom/tilt"
          >
            <Hand className="w-3.5 h-3.5" />
            {!compact && <span>Free</span>}
          </button>
        </div>

        {cameraMode === 'FREE' && (
          <button
            type="button"
            onClick={() => handleSelectCameraMode('CHASE')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-[11px] shadow-lg shadow-cyan-500/30 transition-all"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Re-center</span>
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
        onMapError={handleMapError}
      />

      {/* Unified Top Safe-Area HUD Bar */}
      <header className="fixed top-0 left-0 right-0 z-20 px-3 pointer-events-none safe-top-hud">
        <div className="pt-2 flex items-start justify-between gap-2">
          {/* Left: Trips Button (when collapsed) + Mobile Camera Controls */}
          <div className="flex flex-col items-start gap-2 shrink-0">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 px-3 py-2 rounded-xl bg-slate-950/80 border border-white/15 backdrop-blur-md text-slate-100 hover:bg-slate-900/90 hover:border-cyan-400/40 shadow-xl transition-all text-xs font-medium"
                title="Expand Trip Explorer"
              >
                <Compass className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Trips</span>
                {totalBadgeCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 text-[10px] font-mono tabular-nums">
                    {totalBadgeCount}
                  </span>
                )}
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>
            )}

            <div className="lg:hidden">{renderCameraControls(true)}</div>
          </div>

          {/* Center: Desktop Camera Controls */}
          <div
            className={`hidden lg:flex items-center justify-center flex-1 min-w-0 ${
              sidebarOpen ? 'pl-[348px]' : ''
            }`}
          >
            {renderCameraControls(false)}
          </div>

          {/* Right: Telemetry HUD */}
          <div className="flex flex-col items-end shrink min-w-0">
            <TelemetryHUD frame={frame} />
          </div>
        </div>
      </header>

      {/* Empty State Welcome Card when no dataset is loaded */}
      {!activeTrip && (
        <div className="fixed inset-0 z-10 flex items-center justify-center pointer-events-none px-4 sm:pl-[360px]">
          <div className="pointer-events-auto max-w-md w-full rounded-2xl bg-slate-950/80 border border-white/15 backdrop-blur-md shadow-2xl p-6 text-center space-y-4">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-[11px] font-medium text-emerald-300">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Privacy-First · Zero Data Leaves Your Device</span>
            </div>

            <div className="space-y-1.5">
              <h2 className="text-xl font-semibold tracking-tight text-white">
                Replay Your Google Timeline at 60fps
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                Drop your <code className="text-cyan-300">Timeline.json</code>,{' '}
                <code className="text-cyan-300">Semantic Location History</code>, or{' '}
                <code className="text-cyan-300">Records.json</code> file—parsed
                locally inside a Web Worker.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={handleLoadSample}
                disabled={isParsing}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 font-semibold text-xs shadow-lg shadow-cyan-500/25 transition-all disabled:opacity-50"
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
                <UploadCloud className="w-4 h-4 text-cyan-300" />
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
      />

      {/* Bottom Media Playback Dock */}
      <PlaybackDock
        trip={activeTrip}
        frame={frame}
        sidebarOpen={sidebarOpen}
        onTogglePlay={handleTogglePlay}
        onSeekProgress={handleSeekProgress}
        onStepSegment={handleStepSegment}
        onSelectSpeed={handleSelectSpeed}
        onToggleLoop={handleToggleLoop}
      />

      {/* Toast Notifications */}
      <ToastNotification toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
