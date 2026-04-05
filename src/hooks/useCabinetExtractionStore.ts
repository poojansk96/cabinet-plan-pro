/**
 * Global singleton store for background Pre-Final cabinet PDF extraction.
 * Processing continues even if the ShopDrawingImportDialog is closed or the user navigates away.
 */

import { type LabelRow } from '@/components/project/ShopDrawingImportDialog';

export interface ExtractionJob {
  id: string;
  status: 'processing' | 'done' | 'error';
  progress: number;           // 0–100
  processedPages: number;
  totalPages: number;
  statusText: string;
  rows: LabelRow[];
  detectedUnitType: string | null;
  typeOrder: string[];
  error: string | null;
  fileNames: string[];
  startedAt: number;
}

type Listener = () => void;

// ── Singleton state ────────────────────────────────────────────────
let currentJob: ExtractionJob | null = null;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach(fn => fn());
}

export function getExtractionJob(): ExtractionJob | null {
  return currentJob;
}

export function clearExtractionJob() {
  currentJob = null;
  notify();
}

export function subscribeExtractionJob(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// ── Merge helper (copied from ShopDrawingImportDialog) ─────────────
function mergeRows(incoming: LabelRow[], existing: LabelRow[] = []): LabelRow[] {
  const merged: Record<string, LabelRow> = {};

  for (const r of [...existing, ...incoming]) {
    const normSku = r.sku
      .toUpperCase()
      .trim()
      .replace(/\s*-\s*/g, '-')
      .replace(/\s+/g, '')
      .replace(/B?-\d+D$/i, '');
    const unitTypeKey = (r as any).detectedUnitType || '__none__';
    const key = `${normSku}__${r.room}__${unitTypeKey}`;
    if (merged[key]) {
      merged[key].quantity = Math.max(merged[key].quantity, r.quantity);
    } else {
      merged[key] = { ...r, sku: normSku };
    }
  }

  const wallHeight = (sku: string): number => {
    const m = sku.match(/^W\D*(\d{3,5})/i);
    if (!m) return 999;
    const digits = m[1];
    if (digits.length >= 4) return parseInt(digits.slice(-2), 10);
    return 999;
  };

  return Object.values(merged).sort((a, b) => {
    const sortPriority = (r: LabelRow): number => {
      const room = r.room?.toLowerCase() ?? '';
      const type = r.type?.toLowerCase() ?? '';
      const isKitchen = room === 'kitchen';
      const isBath = room === 'bath';
      const isAccessory = type === 'accessory';
      if (isKitchen && type === 'wall') return 0;
      if (isKitchen && type === 'base') return 1;
      if (isKitchen && type === 'tall') return 2;
      if (isKitchen && isAccessory) return 3;
      if (isKitchen) return 4;
      if (isBath && !isAccessory) return 5;
      if (isBath && isAccessory) return 6;
      return 7;
    };
    const pa = sortPriority(a);
    const pb = sortPriority(b);
    if (pa !== pb) return pa - pb;
    if (a.type?.toLowerCase() === 'wall' && b.type?.toLowerCase() === 'wall') {
      const ha = wallHeight(a.sku);
      const hb = wallHeight(b.sku);
      if (ha !== hb) return ha - hb;
    }
    return a.sku.localeCompare(b.sku, undefined, { numeric: true });
  });
}

// ── Start background extraction ────────────────────────────────────
export async function startBackgroundExtraction(
  files: File[],
  unitType: string | undefined,
  speedMode: 'fast' | 'thorough',
  skipClassify: boolean,
  aiModel: 'fast' | 'accu',
  /** Re-use the processSingleFile function from ShopDrawingImportDialog */
  processSingleFile: (
    file: File,
    pdfjsLib: any,
    onStatus: (msg: string) => void,
    onPageDone?: () => void,
    onStepDone?: () => void,
  ) => Promise<{ rows: LabelRow[]; detectedType: string | null; typeOrder: string[] }>,
) {
  const jobId = Date.now().toString(36);
  currentJob = {
    id: jobId,
    status: 'processing',
    progress: 5,
    processedPages: 0,
    totalPages: 0,
    statusText: 'Loading PDF library…',
    rows: [],
    detectedUnitType: null,
    typeOrder: [],
    error: null,
    fileNames: files.map(f => f.name),
    startedAt: Date.now(),
  };
  notify();

  const update = (patch: Partial<ExtractionJob>) => {
    if (!currentJob || currentJob.id !== jobId) return; // job was cleared
    Object.assign(currentJob, patch);
    notify();
  };

  const doProcess = async () => {
    try {
      update({ statusText: 'Loading PDF library…' });
      const pdfjsLib = (await import('pdfjs-dist')) as any;
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

      let totalPagesCount = 0;
      for (const file of files) {
        const ab = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
        totalPagesCount += pdf.numPages;
      }
      const totalStepsCount = totalPagesCount * 7;
      let stepsCompleted = 0;
      let pagesProcessed = 0;

      update({ totalPages: totalPagesCount, progress: 10 });

      let allRows: LabelRow[] = [];
      let firstDetectedType: string | null = null;
      const collectedTypeOrder: string[] = [];

      for (let i = 0; i < files.length; i++) {
        update({ statusText: `Processing file ${i + 1} of ${files.length}: "${files[i].name}"…` });
        try {
          const result = await processSingleFile(
            files[i],
            pdfjsLib,
            (msg) => update({ statusText: msg }),
            () => {
              pagesProcessed++;
              update({ processedPages: pagesProcessed });
            },
            () => {
              stepsCompleted++;
              update({ progress: 10 + Math.round((stepsCompleted / totalStepsCount) * 85) });
            },
          );
          allRows = mergeRows(result.rows, allRows);
          if (!firstDetectedType && result.detectedType) firstDetectedType = result.detectedType;
          for (const t of result.typeOrder) {
            if (!collectedTypeOrder.includes(t)) collectedTypeOrder.push(t);
          }
        } catch (err: any) {
          if (err.message === 'rate_limit') {
            update({ status: 'error', error: 'AI rate limit reached. Try again shortly.' });
            return;
          }
          if (err.message === 'credits') {
            update({ status: 'error', error: 'AI credits exhausted.' });
            return;
          }
          console.warn(`Skipped "${files[i].name}": ${err.message}`);
        }
      }

      if (allRows.length === 0 && collectedTypeOrder.length === 0) {
        update({ status: 'error', error: 'No cabinet labels or unit type names found in any uploaded file.' });
        return;
      }

      update({
        status: 'done',
        progress: 100,
        rows: allRows,
        detectedUnitType: firstDetectedType,
        typeOrder: collectedTypeOrder,
      });
    } catch (err: any) {
      console.error('Background extraction error:', err);
      update({ status: 'error', error: 'Failed to process files. Please try again.' });
    }
  };

  if (navigator.locks) {
    navigator.locks.request('shop-drawing-processing', doProcess);
  } else {
    doProcess();
  }
}

// ── React hook ─────────────────────────────────────────────────────
import { useSyncExternalStore } from 'react';

export function useExtractionJob(): ExtractionJob | null {
  return useSyncExternalStore(subscribeExtractionJob, getExtractionJob);
}
