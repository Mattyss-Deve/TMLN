import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  TimelineSummaryIndex,
  TimelineViewMode,
  Trip,
  WorkerRequest,
  WorkerResponse,
} from '../types/timeline';

export interface TimelineWorkerState {
  isParsing: boolean;
  progress: number;
  stage: string;
}

export interface WorkerParseResult {
  index: TimelineSummaryIndex;
  initialTrip: Trip | null;
  initialViewMode: TimelineViewMode;
}

interface PendingEntry {
  kind: 'PARSE' | 'GET_TRIP' | 'GET_HEATMAP';
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (percent: number, stage: string) => void;
}

export class TimelineWorkerClient {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private activeParseId: number | null = null;
  private pending = new Map<number, PendingEntry>();

  private ensureWorker(): Worker {
    if (!this.worker) {
      const worker = new Worker(
        new URL('./timeline.worker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (!msg) return;

        const entry = this.pending.get(msg.id);
        if (!entry) return;

        if (msg.type === 'PROGRESS') {
          entry.onProgress?.(msg.percent, msg.stage);
          return;
        }

        this.pending.delete(msg.id);
        if (this.activeParseId === msg.id) {
          this.activeParseId = null;
        }

        if (msg.type === 'INDEX_READY') {
          entry.resolve({
            index: msg.index,
            initialTrip: msg.initialTrip,
            initialViewMode: msg.initialViewMode,
          } satisfies WorkerParseResult);
        } else if (msg.type === 'TRIP_DATA') {
          entry.resolve(msg.trip);
        } else if (msg.type === 'HEATMAP_DATA') {
          entry.resolve(msg.geojson);
        } else if (msg.type === 'ERROR') {
          entry.reject(new Error(msg.message));
        }
      };

      worker.onerror = (event) => {
        const err = new Error(event.message || 'Timeline parser worker crashed.');
        for (const [, entry] of this.pending) {
          entry.reject(err);
        }
        this.pending.clear();
        this.activeParseId = null;
      };

      this.worker = worker;
    }

    return this.worker;
  }

  public parseFile(
    file: File,
    onProgress?: (percent: number, stage: string) => void
  ): Promise<WorkerParseResult> {
    if (this.activeParseId !== null) {
      this.cancel();
    }
    const id = this.nextRequestId++;
    this.activeParseId = id;
    return this.dispatch<WorkerParseResult>(
      { id, type: 'PARSE_FILE', file },
      'PARSE',
      onProgress
    );
  }

  public parseText(
    text: string,
    onProgress?: (percent: number, stage: string) => void
  ): Promise<WorkerParseResult> {
    if (this.activeParseId !== null) {
      this.cancel();
    }
    const id = this.nextRequestId++;
    this.activeParseId = id;
    return this.dispatch<WorkerParseResult>(
      { id, type: 'PARSE_TEXT', text },
      'PARSE',
      onProgress
    );
  }

  public getTrip(tripId: string, viewMode: TimelineViewMode): Promise<Trip | null> {
    const id = this.nextRequestId++;
    return this.dispatch<Trip | null>(
      { id, type: 'GET_TRIP', tripId, viewMode },
      'GET_TRIP'
    );
  }

  public getHeatmap(): Promise<GeoJSON.FeatureCollection> {
    const id = this.nextRequestId++;
    return this.dispatch<GeoJSON.FeatureCollection>(
      { id, type: 'GET_HEATMAP' },
      'GET_HEATMAP'
    );
  }

  private dispatch<T>(
    request: WorkerRequest,
    kind: PendingEntry['kind'],
    onProgress?: (percent: number, stage: string) => void
  ): Promise<T> {
    const worker = this.ensureWorker();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(request.id, {
        kind,
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress,
      });
      worker.postMessage(request);
    });
  }

  public cancel(): void {
    const cancelErr = new Error('Parsing cancelled.');
    for (const [, entry] of this.pending) {
      entry.reject(cancelErr);
    }
    this.pending.clear();
    this.activeParseId = null;

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  public destroy(): void {
    this.cancel();
  }
}

export function useTimelineWorker() {
  const clientRef = useRef<TimelineWorkerClient | null>(null);
  const [state, setState] = useState<TimelineWorkerState>({
    isParsing: false,
    progress: 0,
    stage: '',
  });

  useEffect(() => {
    const client = new TimelineWorkerClient();
    clientRef.current = client;
    return () => {
      client.destroy();
      clientRef.current = null;
    };
  }, []);

  const parseFile = useCallback(async (file: File): Promise<WorkerParseResult> => {
    if (!clientRef.current) {
      clientRef.current = new TimelineWorkerClient();
    }
    setState({ isParsing: true, progress: 2, stage: `Opening ${file.name}...` });
    try {
      const result = await clientRef.current.parseFile(file, (percent, stage) => {
        setState({ isParsing: true, progress: percent, stage });
      });
      setState({ isParsing: false, progress: 100, stage: 'Complete' });
      return result;
    } catch (err) {
      setState({ isParsing: false, progress: 0, stage: '' });
      throw err;
    }
  }, []);

  const parseText = useCallback(async (text: string): Promise<WorkerParseResult> => {
    if (!clientRef.current) {
      clientRef.current = new TimelineWorkerClient();
    }
    setState({ isParsing: true, progress: 5, stage: 'Parsing timeline data...' });
    try {
      const result = await clientRef.current.parseText(text, (percent, stage) => {
        setState({ isParsing: true, progress: percent, stage });
      });
      setState({ isParsing: false, progress: 100, stage: 'Complete' });
      return result;
    } catch (err) {
      setState({ isParsing: false, progress: 0, stage: '' });
      throw err;
    }
  }, []);

  const getTrip = useCallback(
    async (tripId: string, viewMode: TimelineViewMode): Promise<Trip | null> => {
      if (!clientRef.current) return null;
      return clientRef.current.getTrip(tripId, viewMode);
    },
    []
  );

  const getHeatmap = useCallback(async (): Promise<GeoJSON.FeatureCollection> => {
    if (!clientRef.current) {
      return { type: 'FeatureCollection', features: [] };
    }
    return clientRef.current.getHeatmap();
  }, []);

  const cancel = useCallback(() => {
    clientRef.current?.cancel();
    setState({ isParsing: false, progress: 0, stage: '' });
  }, []);

  return {
    ...state,
    parseFile,
    parseText,
    getTrip,
    getHeatmap,
    cancel,
  };
}
