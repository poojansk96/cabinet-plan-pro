/**
 * Generic global singleton store for background PDF extraction jobs.
 * Supports multiple concurrent extraction types (cabinet, unit, stone, laminate, vtop).
 */

import { useSyncExternalStore } from 'react';

export type ExtractionType = 'cabinet' | 'unit' | 'stone' | 'laminate' | 'vtop';

const LABELS: Record<ExtractionType, string> = {
  cabinet: 'Cabinets',
  unit: 'Unit Count',
  stone: 'Stone SQFT',
  laminate: 'Laminate LFT',
  vtop: 'Cmarble/Swan Vtop',
};

export interface ExtractionJob {
  id: string;
  type: ExtractionType;
  label: string;
  status: 'processing' | 'done' | 'error';
  progress: number;
  processedPages: number;
  totalPages: number;
  statusText: string;
  results: any;
  error: string | null;
  fileNames: string[];
  startedAt: number;
}

type Listener = () => void;

// ── Singleton state ────────────────────────────────────────────────
const jobs = new Map<ExtractionType, ExtractionJob>();
const listeners = new Set<Listener>();

// Cached snapshot array — only replaced when jobs actually change
let snapshotCache: ExtractionJob[] = [];

function notify() {
  snapshotCache = Array.from(jobs.values());
  listeners.forEach(fn => fn());
}

export function getExtractionJob(type: ExtractionType): ExtractionJob | null {
  return jobs.get(type) ?? null;
}

export function getAllExtractionJobs(): ExtractionJob[] {
  return Array.from(jobs.values());
}

export function clearExtractionJob(type: ExtractionType) {
  jobs.delete(type);
  notify();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): ExtractionJob[] {
  return snapshotCache;
}

/**
 * Start a background extraction job.
 * `processFn` receives an `update` callback to report progress and must resolve when done.
 * It should call update({ status: 'done', results: ... }) or update({ status: 'error', error: '...' }).
 */
export function startExtraction(
  type: ExtractionType,
  fileNames: string[],
  processFn: (update: (patch: Partial<ExtractionJob>) => void) => Promise<void>,
) {
  const jobId = Date.now().toString(36) + '-' + type;
  const job: ExtractionJob = {
    id: jobId,
    type,
    label: LABELS[type],
    status: 'processing',
    progress: 5,
    processedPages: 0,
    totalPages: 0,
    statusText: 'Loading PDF library…',
    results: null,
    error: null,
    fileNames,
    startedAt: Date.now(),
  };
  jobs.set(type, job);
  notify();

  const update = (patch: Partial<ExtractionJob>) => {
    const current = jobs.get(type);
    if (!current || current.id !== jobId) return; // job was cleared
    jobs.set(type, { ...current, ...patch });
    notify();
  };

  const doProcess = async () => {
    try {
      await processFn(update);
    } catch (err: any) {
      console.error(`Background ${type} extraction error:`, err);
      update({ status: 'error', error: 'Failed to process files. Please try again.' });
    }
  };

  if (navigator.locks) {
    navigator.locks.request(`extraction-${type}`, doProcess);
  } else {
    doProcess();
  }
}

// ── React hooks ───────────────────────────────────────────────────

export function useExtractionJobByType(type: ExtractionType): ExtractionJob | null {
  return useSyncExternalStore(
    subscribe,
    () => jobs.get(type) ?? null,
  );
}

export function useAllExtractionJobs(): ExtractionJob[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}
