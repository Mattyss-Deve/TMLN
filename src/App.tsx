import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, Sparkles, UploadCloud } from 'lucide-react';
import { MapCanvas } from './components/MapCanvas';
import { PlaybackDock } from './components/PlaybackDock';
import { TelemetryHUD } from './components/TelemetryHUD';
import { ToastNotification } from './components/ToastNotification';
import { TripSidebar } from './components/TripSidebar';
import { createSampleTimelineJson } from './data/sampleJourney';
import { AnimationController } from './engine/animationController';
import type {
  CameraMode,
  ParsedTimelineResult,
  SpeedPreset,
  TelemetryFrame,
  ToastMessage,
  Trip,
} from './types/timeline';
import { formatDistance, formatSchemaName } from './utils/format';
import { useTimelineWorker } from './workers/TimelineWorker';

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
    cancel: cancelParse,
  } = useTimelineWorker();

  const [dataset, setDataset] = useState<ParsedTimelineResult | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [frame, setFrame] = useState<TelemetryFrame | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>('CHASE');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const fileDropInputRef = useRef<HTMLInputElement>(null);

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

  const selectedTrip: Trip | null = useMemo(() => {
    if (!dataset || !selectedTripId) return null;
    return dataset.trips.find((t) => t.id === selectedTripId) ?? null;
  }, [dataset, selectedTripId]);

  const applyParsedDataset = useCallback(
    (result: ParsedTimelineResult, autoPlay: boolean) => {
      setDataset(result);
      const firstTrip = result.trips[0] ?? null;
      setSelectedTripId(firstTrip?.id ?? null);
      setCameraMode('CHASE');
      controller.loadTrip(firstTrip, autoPlay);

      pushToast(
        'success',
        `Loaded ${result.stats.totalTrips} ${
          result.stats.totalTrips === 1 ? 'trip' : 'trips'
        } (${formatSchemaName(result.stats.schema)})`,
        `${result.stats.totalWaypoints.toLocaleString()} waypoints · ${formatDistance(
          result.stats.totalDistanceM
        )} · parsed in ${result.stats.parseDurationMs}ms`
      );
    },
    [controller, pushToast]
  );

  const handleFileSelected = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
        pushToast(
          'error',
          'Unsupported file type',
          'Please select a Google Timeline .json file (Timeline.json, Semantic History, or Records.json).'
        );
        return;
      }

      try {
        const result = await parseFile(file);
        applyParsedDataset(result, false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to parse file.';
        if (msg !== 'Parsing cancelled.') {
          pushToast('error', 'Failed to parse Google Timeline JSON', msg);
        }
      }
    },
    [parseFile, applyParsedDataset, pushToast]
  );

  const handleLoadSample = useCallback(async () => {
    try {
      const sampleJson = createSampleTimelineJson();
      const result = await parseText(sampleJson);
      applyParsedDataset(result, true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load sample journey.';
      pushToast('error', 'Sample dataset error', msg);
    }
  }, [parseText, applyParsedDataset, pushToast]);

  const handleSelectTrip = useCallback(
    (tripId: string) => {
      if (!dataset) return;
      const trip = dataset.trips.find((t) => t.id === tripId);
      if (!trip) return;
      setSelectedTripId(trip.id);
      controller.loadTrip(trip, true);
    },
    [dataset, controller]
  );

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
          target.isContentEditable)
      ) {
        return;
      }

      if (!selectedTrip) return;

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
  }, [controller, selectedTrip]);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#070A0F] text-slate-100">
      {/* Full-Viewport WebGL Map */}
      <MapCanvas
        controller={controller}
        trip={selectedTrip}
        cameraMode={cameraMode}
        onCameraModeChange={setCameraMode}
        sidebarOpen={sidebarOpen}
        onMapError={handleMapError}
      />

      {/* Empty State Welcome Card when no dataset is loaded */}
      {!selectedTrip && (
        <div className="fixed inset-0 z-10 flex items-center justify-center pointer-events-none px-4 sm:pl-[360px]">
          <div className="pointer-events-auto max-w-md w-full rounded-2xl bg-slate-950/80 border border-white/15 backdrop-blur-md shadow-2xl p-6 text-center space-y-4">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-[11px] font-medium text-emerald-300">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Privacy-First · Zero Data Leaves Your Browser</span>
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
        trips={dataset?.trips ?? []}
        days={dataset?.days ?? []}
        stats={dataset?.stats ?? null}
        selectedTripId={selectedTripId}
        onSelectTrip={handleSelectTrip}
        onFileSelected={handleFileSelected}
        onLoadSample={handleLoadSample}
        isParsing={isParsing}
        parseProgress={parseProgress}
        parseStage={parseStage}
        onCancelParse={cancelParse}
      />

      {/* Top-Right Telemetry HUD */}
      <TelemetryHUD frame={frame} />

      {/* Bottom Media Playback Dock */}
      <PlaybackDock
        trip={selectedTrip}
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
