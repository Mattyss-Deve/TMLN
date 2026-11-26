/// <reference lib="webworker" />
import type {
  TimelineViewMode,
  Trip,
  WorkerRequest,
  WorkerResponse,
} from '../types/timeline';
import { parseTimelineText } from './timelineParser';

declare const self: DedicatedWorkerGlobalScope;

let dayTripCache = new Map<string, Trip>();
let journeyTripCache = new Map<string, Trip>();

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (!req) return;

  if (req.type === 'GET_TRIP') {
    const store = req.viewMode === 'DAY' ? dayTripCache : journeyTripCache;
    const trip = store.get(req.tripId) ?? null;
    const response: WorkerResponse = {
      id: req.id,
      type: 'TRIP_DATA',
      trip,
    };
    self.postMessage(response);
    return;
  }

  let lastProgressAt = 0;

  const reportProgress = (percent: number, stage: string) => {
    const now = performance.now();
    if (now - lastProgressAt >= 45 || percent >= 100 || percent <= 5) {
      lastProgressAt = now;
      const msg: WorkerResponse = {
        id: req.id,
        type: 'PROGRESS',
        percent,
        stage,
      };
      self.postMessage(msg);
    }
  };

  try {
    let text: string;
    if (req.type === 'PARSE_FILE') {
      reportProgress(2, `Reading ${req.file.name}...`);
      text = await req.file.text();
    } else {
      text = req.text;
    }

    const result = parseTimelineText(text, reportProgress);

    // Cache full Trip objects (with all waypoints) inside worker memory
    dayTripCache = new Map(result.dayTrips.map((t) => [t.id, t]));
    journeyTripCache = new Map(result.trips.map((t) => [t.id, t]));

    const initialViewMode: TimelineViewMode =
      result.dayTrips.length > 0 ? 'DAY' : 'JOURNEY';
    const initialTrip =
      initialViewMode === 'DAY'
        ? result.dayTrips[0] ?? null
        : result.trips[0] ?? null;

    const ready: WorkerResponse = {
      id: req.id,
      type: 'INDEX_READY',
      index: result.index,
      initialTrip,
      initialViewMode,
    };
    self.postMessage(ready);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Unexpected error while parsing Google Timeline JSON.';
    const failure: WorkerResponse = {
      id: req.id,
      type: 'ERROR',
      message,
    };
    self.postMessage(failure);
  }
};
