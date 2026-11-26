/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from '../types/timeline';
import { parseTimelineText } from './timelineParser';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (!req) return;

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

    const data = parseTimelineText(text, reportProgress);
    const success: WorkerResponse = {
      id: req.id,
      type: 'SUCCESS',
      data,
    };
    self.postMessage(success);
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
