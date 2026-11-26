import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ParsedTimelineResult,
  WorkerRequest,
  WorkerResponse,
} from '../types/timeline';

export interface TimelineWorkerState {
  isParsing: boolean;
  progress: number;
  stage: string;
}

export class TimelineWorkerClient {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private activeId: number | null = null;
  private pendingReject: ((err: Error) => void) | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('./timeline.worker.ts', import.meta.url),
        { type: 'module' }
      );
    }
    return this.worker;
  }

  public parseFile(
    file: File,
    onProgress?: (percent: number, stage: string) => void
  ): Promise<ParsedTimelineResult> {
    const id = this.nextRequestId++;
    return this.dispatch({ id, type: 'PARSE_FILE', file }, onProgress);
  }

  public parseText(
    text: string,
    onProgress?: (percent: number, stage: string) => void
  ): Promise<ParsedTimelineResult> {
    const id = this.nextRequestId++;
    return this.dispatch({ id, type: 'PARSE_TEXT', text }, onProgress);
  }

  private dispatch(
    request: WorkerRequest,
    onProgress?: (percent: number, stage: string) => void
  ): Promise<ParsedTimelineResult> {
    this.cancel();
    const worker = this.ensureWorker();
    this.activeId = request.id;

    return new Promise<ParsedTimelineResult>((resolve, reject) => {
      this.pendingReject = reject;

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (!msg || msg.id !== this.activeId) return;

        if (msg.type === 'PROGRESS') {
          onProgress?.(msg.percent, msg.stage);
        } else if (msg.type === 'SUCCESS') {
          this.clearPending();
          resolve(msg.data);
        } else if (msg.type === 'ERROR') {
          this.clearPending();
          reject(new Error(msg.message));
        }
      };

      worker.onerror = (event) => {
        this.clearPending();
        reject(new Error(event.message || 'Timeline parser worker crashed.'));
      };

      worker.postMessage(request);
    });
  }

  private clearPending(): void {
    this.activeId = null;
    this.pendingReject = null;
  }

  public cancel(): void {
    if (this.pendingReject) {
      this.pendingReject(new Error('Parsing cancelled.'));
    }
    this.clearPending();
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

  const parseFile = useCallback(async (file: File): Promise<ParsedTimelineResult> => {
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

  const parseText = useCallback(async (text: string): Promise<ParsedTimelineResult> => {
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

  const cancel = useCallback(() => {
    clientRef.current?.cancel();
    setState({ isParsing: false, progress: 0, stage: '' });
  }, []);

  return {
    ...state,
    parseFile,
    parseText,
    cancel,
  };
}
