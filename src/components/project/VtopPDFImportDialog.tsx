import { useState, useRef, useEffect } from 'react';
import { X, Upload, Loader2, Sparkles, Trash2, AlertTriangle, Eye, EyeOff, Timer } from 'lucide-react';
import { startExtraction, useExtractionJobByType, clearExtractionJob } from '@/hooks/useExtractionStore';
import type { PrefinalVtopRow } from '@/hooks/usePrefinalStore';

function formatExtractionDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function sanitizeDetectedType(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(unknown|n\/?a|none|null|empty|tbd|untitled)$/i.test(raw)) return '';
  if (/example_placeholder|exact_title_block_text/i.test(raw)) return '';
  return raw.replace(/^['"]+|['"]+$/g, '').replace(/\s+/g, ' ').trim();
}

function extractUnitTypeFromPageText(text: string): string | null {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  const patterns = [
    /(?:parcel\s+[a-z0-9]+(?:\s+[a-z0-9]+)*\s+)?type\s*-?\s*([a-z0-9().\/-]+(?:\s+[a-z0-9().\/-]+){0,4})\s+unit#/i,
    /countertops\s+type\s*-?\s*([a-z0-9().\/-]+(?:\s+[a-z0-9().\/-]+){0,4})\s+(?:parcel|unit#)/i,
    /countertops\s+([a-z][a-z0-9().\/-]*(?:\s+[a-z0-9().\/-]+){0,4})\s+(?:\d+(?:\s+\d+\s+\d+)?\s*"|parcel\s+[a-z0-9]+|type\s+-?)/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (!match) continue;
    const candidate = sanitizeDetectedType(match[1]);
    if (candidate) return candidate.toUpperCase();
  }

  return null;
}

// ─── Extended import row with new detection fields ───
export interface VtopImportRow extends PrefinalVtopRow {
  selected: boolean;
  sourceFile?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  backSideOnPage?: 'top' | 'bottom' | 'left' | 'right';
  closerEndOnPage?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  leftWallConfidence?: number;
  rightWallConfidence?: number;
  sidesplashCount?: number;
  reviewRequired?: boolean;
  reviewReason?: string;
  debugImages?: {
    vanityCrop?: string;
    leftEndCrop?: string;
    rightEndCrop?: string;
  };
}

interface Props {
  onImport: (rows: VtopImportRow[], detectedTypes?: string[]) => void;
  onClose: () => void;
  prefinalPerson?: string;
  aiProvider?: 'gemini' | 'dialagram';
  dialagramModel?: string;
}

type Step = 'upload' | 'processing' | 'review';

const QUOTES = [
  "Scanning vanity top dimensions...",
  "Detecting bowl positions...",
  "Analyzing wall indicators...",
  "Reading sidesplash details...",
  "Calculating finish ends...",
];

const PERSONAL_QUOTES = [
  (name: string) => `${name}, you've got this — one vanity at a time! 💪`,
  (name: string) => `Keep going, ${name}! Precision matters.`,
  (name: string) => `${name}, your attention to detail is top-notch.`,
  (name: string) => `Almost there, ${name}! Stay sharp! ✨`,
];

// ─── Canvas rendering helpers ───

async function renderPageToCanvasData(page: any, maxPx = 3200, maxScale = 4.5): Promise<{ canvas: OffscreenCanvas | HTMLCanvasElement; width: number; height: number }> {
  const baseViewport = page.getViewport({ scale: 1 });
  const longSide = Math.max(baseViewport.width, baseViewport.height);
  const scale = Math.min(maxScale, maxPx / longSide);
  const viewport = page.getViewport({ scale });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { canvas, width, height };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, width, height };
}

async function canvasToBase64(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  quality = 0.82,
  mimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<string> {
  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: mimeType, quality: mimeType === 'image/jpeg' ? quality : undefined });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  return (canvas as HTMLCanvasElement).toDataURL(mimeType, mimeType === 'image/jpeg' ? quality : undefined).split(',')[1];
}

async function canvasCropToBase64(
  sourceCanvas: OffscreenCanvas | HTMLCanvasElement,
  sx: number, sy: number, sw: number, sh: number,
  quality = 0.86,
): Promise<string> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const crop = new OffscreenCanvas(sw, sh);
    const ctx = crop.getContext('2d')!;
    ctx.drawImage(sourceCanvas as any, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvasToBase64(crop, quality);
  }
  const crop = document.createElement('canvas');
  crop.width = sw;
  crop.height = sh;
  const ctx = crop.getContext('2d')!;
  ctx.drawImage(sourceCanvas as HTMLCanvasElement, sx, sy, sw, sh, 0, 0, sw, sh);
  return crop.toDataURL('image/jpeg', quality).split(',')[1];
}

// No more strip images — single full-page AI call only

// ─── Deterministic wall detection helpers ───

/**
 * Crop a normalized bbox region from a canvas and return PNG base64 + ImageData.
 */
function cropNormalizedRegion(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  canvasW: number, canvasH: number,
  bbox: { x: number; y: number; width: number; height: number },
): { imageData: ImageData; base64: string } {
  const sx = Math.max(0, Math.floor(bbox.x * canvasW));
  const sy = Math.max(0, Math.floor(bbox.y * canvasH));
  const sw = Math.max(1, Math.min(Math.ceil(bbox.width * canvasW), canvasW - sx));
  const sh = Math.max(1, Math.min(Math.ceil(bbox.height * canvasH), canvasH - sy));

  const crop = document.createElement('canvas');
  crop.width = sw;
  crop.height = sh;
  const ctx = crop.getContext('2d')!;
  ctx.drawImage(canvas as HTMLCanvasElement, sx, sy, sw, sh, 0, 0, sw, sh);
  const imageData = ctx.getImageData(0, 0, sw, sh);
  const base64 = crop.toDataURL('image/png').split(',')[1];
  return { imageData, base64 };
}

/**
 * Detect double-line (wall) vs single-line (open end) at a vanity edge.
 *
 * Strategy:
 * 1. Only analyze the center 60% of height (skip top/bottom noise from dimension lines)
 * 2. Only look at the first/last 15% of width (the actual edge zone)
 * 3. Find vertical dark bands (columns where most pixels are dark)
 * 4. Two narrow tall bands with a small gap = wall (double line)
 * 5. One narrow tall band = open end (single line)
 * 6. Anything else = uncertain
 */
type PageSide = 'left' | 'right' | 'top' | 'bottom';

export function pageSideForPersonEnd(backSideOnPage: PageSide | undefined, personEnd: 'left' | 'right'): PageSide {
  if (backSideOnPage === 'top') return personEnd === 'left' ? 'left' : 'right';
  if (backSideOnPage === 'bottom') return personEnd === 'left' ? 'right' : 'left';
  if (backSideOnPage === 'left') return personEnd === 'left' ? 'bottom' : 'top';
  if (backSideOnPage === 'right') return personEnd === 'left' ? 'top' : 'bottom';
  return personEnd;
}

function detectDoubleLineAtEdge(imageData: ImageData, side: PageSide): number {
  const { data, width, height } = imageData;
  if (width < 6 || height < 10) return 0.5;

  const isVerticalEdge = side === 'left' || side === 'right';
  const primarySize = isVerticalEdge ? width : height;
  const secondarySize = isVerticalEdge ? height : width;

  // Only analyze center 60% of the perpendicular axis to skip dimension-line noise
  const secondaryStart = Math.floor(secondarySize * 0.2);
  const secondaryEnd = Math.floor(secondarySize * 0.8);
  const analyzeSpan = secondaryEnd - secondaryStart;
  if (analyzeSpan < 5) return 0.5;

  // Inspect 45% of the end crop width to catch both lines
  const edgeZoneWidth = Math.max(6, Math.floor(primarySize * 0.45));
  const primaryStart = side === 'left' || side === 'top' ? 0 : primarySize - edgeZoneWidth;

  // Build darkness profile in the edge zone.
  // Vertical ends are scanned by columns; horizontal ends are scanned by rows.
  const darkThreshold = 180; // relaxed for anti-aliased PDF linework
  const columnDarkRatio = new Float64Array(edgeZoneWidth);

  for (let localPrimary = 0; localPrimary < edgeZoneWidth; localPrimary++) {
    const absPrimary = primaryStart + localPrimary;
    let darkCount = 0;
    for (let secondary = secondaryStart; secondary < secondaryEnd; secondary++) {
      const x = isVerticalEdge ? absPrimary : secondary;
      const y = isVerticalEdge ? secondary : absPrimary;
      const idx = (y * width + x) * 4;
      const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      if (lum < darkThreshold) darkCount++;
    }
    columnDarkRatio[localPrimary] = darkCount / analyzeSpan;
  }

  // Find vertical bands: relaxed threshold for thin/gray PDF lines
  const bandThreshold = 0.22;
  const bands: Array<{ start: number; end: number; avgDarkness: number }> = [];
  let inBand = false;
  let bandStart = 0;
  let bandDarkSum = 0;

  for (let x = 0; x < edgeZoneWidth; x++) {
    if (columnDarkRatio[x] >= bandThreshold) {
      if (!inBand) {
        inBand = true;
        bandStart = x;
        bandDarkSum = 0;
      }
      bandDarkSum += columnDarkRatio[x];
    } else if (inBand) {
      const bandWidth = x - bandStart;
      bands.push({
        start: bandStart,
        end: x - 1,
        avgDarkness: bandDarkSum / bandWidth,
      });
      inBand = false;
    }
  }
  if (inBand) {
    const bandWidth = edgeZoneWidth - bandStart;
    bands.push({
      start: bandStart,
      end: edgeZoneWidth - 1,
      avgDarkness: bandDarkSum / bandWidth,
    });
  }

  // Filter: bands must be narrow and have some darkness (relaxed for anti-aliased lines)
  const validBands = bands.filter(b => {
    const w = b.end - b.start + 1;
    return w >= 1 && w <= Math.max(8, edgeZoneWidth * 0.45) && b.avgDarkness >= 0.25;
  });

  if (validBands.length >= 2) {
    validBands.sort((a, b) => a.start - b.start);
    const gap = validBands[1].start - validBands[0].end - 1;
    const maxGap = Math.max(10, edgeZoneWidth * 0.5);

    if (gap >= 1 && gap <= maxGap) {
      return 0.85; // two bands with gap = wall
    }
    if (gap === 0) {
      return 0.5; // adjacent/merged — unknown
    }
    return 0.5; // large gap — unknown
  }

  // One clean line at the actual end is an OPEN end: finish end, no sidesplash.
  if (validBands.length === 1) return 0.15;

  // No reliable edge line means the crop/AI bbox is likely imperfect; leave uncertain.
  return 0.5;
}

/**
 * Analyze a vanity end crop and return wall confidence.
 * Crops tightly at the edge of the vanity bbox.
 */
function analyzeEndCrop(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  canvasW: number, canvasH: number,
  bbox: { x: number; y: number; width: number; height: number },
  side: PageSide,
): { confidence: number; cropBase64: string } {
  // Crop a narrow strip at the specified end of the vanity bbox
  // Use 10% of vanity width, staying inside the bbox (not outside)
  const isVerticalEdge = side === 'left' || side === 'right';
  const endWidthFrac = Math.max(0.05, bbox.width * 0.22);
  const endHeightFrac = Math.max(0.05, bbox.height * 0.22);
  const endBbox = {
    x: isVerticalEdge ? (side === 'left' ? bbox.x : bbox.x + bbox.width - endWidthFrac) : bbox.x,
    y: isVerticalEdge ? bbox.y : (side === 'top' ? bbox.y : bbox.y + bbox.height - endHeightFrac),
    width: isVerticalEdge ? endWidthFrac : bbox.width,
    height: isVerticalEdge ? bbox.height : endHeightFrac,
  };

  const { imageData, base64 } = cropNormalizedRegion(canvas, canvasW, canvasH, endBbox);
  const confidence = detectDoubleLineAtEdge(imageData, side);
  return { confidence, cropBase64: base64 };
}

/**
 * Dead-zone scoring: deterministic first, then AI, then uncertain.
 * Biased toward wall=true because false negatives (missing sidesplash)
 * are more costly than false positives in practice.
 */
function scoreWallEvidence(
  det: number,
  ai: number,
  aiHint: boolean,
): { wall: boolean; confidence: number; reviewRequired: boolean } {
  // Strong deterministic (double-line detector at the edge crop) → trust it
  if (det >= 0.75) return { wall: true, confidence: det, reviewRequired: false };
  if (det <= 0.25) return { wall: false, confidence: 1 - det, reviewRequired: false };

  // Otherwise judge each end independently from AI probability — NO default bias.
  // A "wall" requires positive evidence (double parallel lines). A single line at
  // the edge means a finish end and must NOT be turned into a sidesplash.
  if (ai >= 0.7) return { wall: true, confidence: ai, reviewRequired: true };
  if (ai <= 0.3) return { wall: false, confidence: 1 - ai, reviewRequired: true };

  // Dead zone: combine deterministic + AI signal (no thumb on the scale).
  // Use the stronger of the two evidence directions.
  const combined = (det + ai) / 2;
  return {
    wall: combined >= 0.5,
    confidence: 0.5,
    reviewRequired: true,
  };
}

/**
 * Initial wall decision from deterministic detector + full-page AI fallback.
 * Full-page AI confidence is a rough fallback, NOT the main signal.
 */
function finalizeWallDecision(
  row: VtopImportRow,
  leftDet: { confidence: number; cropBase64: string },
  rightDet: { confidence: number; cropBase64: string },
  vanityCropBase64: string,
): VtopImportRow {
  const aiLeftProb = row.leftWallConfidence ?? 0.5;
  const aiRightProb = row.rightWallConfidence ?? 0.5;

  const left = scoreWallEvidence(leftDet.confidence, aiLeftProb, Boolean(row.leftWall));
  const right = scoreWallEvidence(rightDet.confidence, aiRightProb, Boolean(row.rightWall));

  const reviewRequired = left.reviewRequired || right.reviewRequired;
  const reasons: string[] = [];
  if (left.reviewRequired) reasons.push(`Left wall uncertain (det:${(leftDet.confidence * 100).toFixed(0)}%, ai:${(aiLeftProb * 100).toFixed(0)}%)`);
  if (right.reviewRequired) reasons.push(`Right wall uncertain (det:${(rightDet.confidence * 100).toFixed(0)}%, ai:${(aiRightProb * 100).toFixed(0)}%)`);

  return {
    ...row,
    leftWall: left.wall,
    rightWall: right.wall,
    leftWallConfidence: left.confidence,
    rightWallConfidence: right.confidence,
    sidesplashCount: (left.wall ? 1 : 0) + (right.wall ? 1 : 0),
    reviewRequired,
    reviewReason: reasons.length ? reasons.join('. ') : undefined,
    debugImages: {
      vanityCrop: vanityCropBase64,
      leftEndCrop: leftDet.cropBase64,
      rightEndCrop: rightDet.cropBase64,
    },
  };
}

/**
 * Focused AI call for ambiguous rows only.
 * Sends end crops (not full page) and asks ONLY about wall confidence.
 */
async function focusedWallAICall(
  supabaseUrl: string,
  supabaseKey: string,
  leftCropB64: string,
  rightCropB64: string,
): Promise<{ leftWallYesConfidence: number; rightWallYesConfidence: number } | null> {
  try {
    // Combine left and right crops into a single image side by side
    const resp = await fetch(`${supabaseUrl}/functions/v1/extract-pdf-vtops`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        pageImage: leftCropB64,
        focusedWallDetection: true,
        rightEndCrop: rightCropB64,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      leftWallYesConfidence: data.leftWallYesConfidence ?? 0.5,
      rightWallYesConfidence: data.rightWallYesConfidence ?? 0.5,
    };
  } catch {
    console.warn('Focused wall AI call failed');
    return null;
  }
}

// ─── SKU formatting ───

function formatVtopSku(row: VtopImportRow): string {
  const size = `${row.length}x${row.depth}"`;
  const bowl = row.bowlPosition === 'center'
    ? '(Center bowl)'
    : `(OFFSET ${row.bowlPosition === 'offset-left' ? 'LEFT' : 'RIGHT'} ${row.bowlOffset ?? ''}") `;

  let endFinish: string;
  if (row.leftWall && row.rightWall) {
    endFinish = 'No end finish';
  } else if (row.leftWall && !row.rightWall) {
    endFinish = 'Right end finish';
  } else if (!row.leftWall && row.rightWall) {
    endFinish = 'Left end finish';
  } else {
    endFinish = 'Both end finish';
  }

  return `${size} ${bowl}${endFinish}`.replace(/\s+/g, ' ').trim();
}

function getVtopSidesplashItems(row: VtopImportRow): string[] {
  const items: string[] = [];
  if (row.leftWall) items.push(`${row.depth}" Left end sidesplash`);
  if (row.rightWall) items.push(`${row.depth}" Right end sidesplash`);
  return items;
}

export { formatVtopSku, getVtopSidesplashItems };

// ─── Main component ───

export default function VtopPDFImportDialog({ onImport, onClose, prefinalPerson, aiProvider = 'gemini', dialagramModel = 'qwen-3.6-plus' }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<VtopImportRow[]>([]);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [personalQuoteIdx, setPersonalQuoteIdx] = useState(0);
  const [quoteVisible, setQuoteVisible] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  const bgPickedUpRef = useRef(false);

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  // ── Pick up background job results ──────────────────────────────────
  const bgJob = useExtractionJobByType('vtop');

  useEffect(() => {
    if (!bgJob || bgPickedUpRef.current) return;
    if (bgJob.status === 'processing') {
      setStep('processing');
      setProgress(bgJob.progress);
    } else if (bgJob.status === 'done') {
      bgPickedUpRef.current = true;
      const r = bgJob.results as { rows: VtopImportRow[] } | null;
      setRows(r?.rows ?? []);
      setProgress(100);
      setStep('review');
      clearExtractionJob('vtop');
    } else if (bgJob.status === 'error') {
      bgPickedUpRef.current = true;
      setError(bgJob.error || 'Failed');
      setStep('upload');
      clearExtractionJob('vtop');
    }
  }, [bgJob]);

  useEffect(() => {
    if (!bgJob || bgJob.status !== 'processing' || bgPickedUpRef.current) return;
    setProgress(bgJob.progress);
  }, [bgJob?.progress]);

  // ── Live timer tick while processing ──
  useEffect(() => {
    if (step !== 'processing') return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step]);

  async function processFiles(files: File[]) {
    if (processingRef.current) return;
    processingRef.current = true;
    setStep('processing');
    setError('');
    setProgress(0);
    bgPickedUpRef.current = false;

    const quoteInterval = setInterval(() => {
      setQuoteVisible(false);
      setTimeout(() => {
        setQuoteIdx(i => (i + 1) % QUOTES.length);
        setPersonalQuoteIdx(i => (i + 1) % PERSONAL_QUOTES.length);
        setQuoteVisible(true);
      }, 400);
    }, 4000);

    startExtraction('vtop', files.map(f => f.name), async (update) => {
    try {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

      let allRows: VtopImportRow[] = [...rows];
      let pagesDone = 0;
      let pagesTotal = 0;
      const detectedTypesOrder: string[] = [];

      for (const file of files) {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        pagesTotal += pdf.numPages;
      }
      update({ totalPages: pagesTotal, statusText: 'Processing pages…' });

      for (const file of files) {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

        for (let p = 1; p <= pdf.numPages; p++) {
          update({ statusText: `Processing ${file.name} — page ${p}/${pdf.numPages}` });
          const page = await pdf.getPage(p);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => ('str' in item ? item.str : ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          const hintedUnitType = extractUnitTypeFromPageText(pageText);

          // High-res canvas for deterministic bbox crops (kept at 3200px)
          const { canvas, width: canvasW, height: canvasH } = await renderPageToCanvasData(page, 3200, 4.5);
          
          // Smaller image for AI pass to avoid edge function timeouts.
          // IMPORTANT: Qwen-3.6-plus (Dialagram) silently rejects PNG payloads and replies
          // "I don't see any image attached". JPEG works reliably for both Gemini and Qwen
          // (matches the Stone module which has been stable on JPEG for months).
          const aiMimeType: 'image/jpeg' = 'image/jpeg';
          const aiCanvas = await renderPageToCanvasData(page, 2500, 3.5);
          const pageImage = await canvasToBase64(aiCanvas.canvas, 0.85, aiMimeType);

          // Qwen extraction + optional rescue pass can take 60–120s per page on slow pages.
          // The previous 90s timeout was firing mid-rescue, producing the DOMException
          // "operation was aborted" error before the server could respond. Bump to 180s,
          // which is still under the Supabase edge function ceiling and matches observed
          // worst-case server timings (~120s for Qwen + rescue).
          const CLIENT_TIMEOUT_MS = 180000;
          const MAX_CLIENT_RETRIES = 3;
          let pageSuccess = false;
          for (let attempt = 0; attempt < MAX_CLIENT_RETRIES && !pageSuccess; attempt++) {
            try {
              if (attempt > 0) {
                const delay = Math.min(3000 * attempt, 15000);
                await new Promise(r => setTimeout(r, delay));
              }
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
              const resp = await fetch(`${SUPABASE_URL}/functions/v1/extract-pdf-vtops`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${SUPABASE_KEY}`,
                },
                body: JSON.stringify({
                  pageImage,
                  pageImageMimeType: aiMimeType,
                  provider: aiProvider,
                  dialagramModel,
                  pageTextHint: pageText,
                  unitTypeNameHint: hintedUnitType,
                }),
                signal: controller.signal,
              });
              clearTimeout(timeout);

              if (resp.status === 429) { update({ status: 'error', error: 'Rate limit reached.' }); clearInterval(quoteInterval); processingRef.current = false; return; }
              if (resp.status === 402) { update({ status: 'error', error: 'AI credits exhausted.' }); clearInterval(quoteInterval); processingRef.current = false; return; }

              if (resp.ok) {
                const data = await resp.json();
                const pageUnitType = String(data.unitTypeName || '').trim();
                if (pageUnitType && !detectedTypesOrder.includes(pageUnitType)) {
                  detectedTypesOrder.push(pageUnitType);
                }

                for (const vt of (data.vtops ?? [])) {
                  let importRow: VtopImportRow = {
                    length: vt.length,
                    depth: vt.depth,
                    bowlPosition: vt.bowlPosition,
                    bowlOffset: vt.bowlOffset,
                    leftWall: vt.leftWall,
                    rightWall: vt.rightWall,
                    unitType: pageUnitType || 'Unassigned',
                    selected: true,
                    sourceFile: file.name,
                    bbox: vt.bbox,
                    backSideOnPage: vt.backSideOnPage,
                    closerEndOnPage: vt.closerEndOnPage,
                    leftWallConfidence: vt.leftWallYesConfidence ?? vt.leftWallConfidence ?? 0.5,
                    rightWallConfidence: vt.rightWallYesConfidence ?? vt.rightWallConfidence ?? 0.5,
                    sidesplashCount: vt.sidesplashCount,
                    reviewRequired: vt.reviewRequired,
                    reviewReason: vt.reviewReason,
                  };

                  // Keep extractor orientation as-is; mirror types should not be flipped client-side.

                  // ── Deterministic wall detection using bbox crops ──
                  if (vt.bbox && vt.bbox.width > 0.01 && vt.bbox.height > 0.01) {
                    try {
                      const { base64: vanityCropB64 } = cropNormalizedRegion(
                        canvas, canvasW, canvasH, vt.bbox,
                      );
                      const leftPageSide = pageSideForPersonEnd(importRow.backSideOnPage, 'left');
                      const rightPageSide = pageSideForPersonEnd(importRow.backSideOnPage, 'right');
                      const leftDet = analyzeEndCrop(canvas, canvasW, canvasH, vt.bbox, leftPageSide);
                      const rightDet = analyzeEndCrop(canvas, canvasW, canvasH, vt.bbox, rightPageSide);

                      importRow = finalizeWallDecision(importRow, leftDet, rightDet, vanityCropB64);

                      if (importRow.reviewRequired && importRow.debugImages?.leftEndCrop && importRow.debugImages?.rightEndCrop) {
                        const focused = await focusedWallAICall(
                          SUPABASE_URL, SUPABASE_KEY,
                          importRow.debugImages.leftEndCrop,
                          importRow.debugImages.rightEndCrop,
                        );
                        if (focused) {
                          const leftFocused = scoreWallEvidence(leftDet.confidence, focused.leftWallYesConfidence, Boolean(importRow.leftWall));
                          const rightFocused = scoreWallEvidence(rightDet.confidence, focused.rightWallYesConfidence, Boolean(importRow.rightWall));
                          
                          importRow.leftWall = leftFocused.wall;
                          importRow.rightWall = rightFocused.wall;
                          importRow.leftWallConfidence = leftFocused.confidence;
                          importRow.rightWallConfidence = rightFocused.confidence;
                          importRow.sidesplashCount = (leftFocused.wall ? 1 : 0) + (rightFocused.wall ? 1 : 0);
                          importRow.reviewRequired = leftFocused.reviewRequired || rightFocused.reviewRequired;
                          const focusedReasons: string[] = [];
                          if (leftFocused.reviewRequired) focusedReasons.push(`Left wall still uncertain after focused AI (${(focused.leftWallYesConfidence * 100).toFixed(0)}%)`);
                          if (rightFocused.reviewRequired) focusedReasons.push(`Right wall still uncertain after focused AI (${(focused.rightWallYesConfidence * 100).toFixed(0)}%)`);
                          importRow.reviewReason = focusedReasons.length ? focusedReasons.join('. ') : undefined;
                        }
                      }
                    } catch (detErr) {
                      console.warn('Deterministic wall detection failed for row:', detErr);
                      importRow.reviewRequired = true;
                      importRow.reviewReason = (importRow.reviewReason || '') + ' Deterministic detection failed.';
                    }
                  } else {
                    importRow.reviewRequired = true;
                    importRow.reviewReason = 'No bounding box — wall detection is AI-only.';
                  }

                  allRows.push(importRow);
                }
                pageSuccess = true;
              } else if (resp.status === 503) {
                console.warn(`Server 503 on page ${p}, attempt ${attempt + 1}/${MAX_CLIENT_RETRIES}`);
                continue;
              }
            } catch (err) {
              console.error(`Error processing page ${p} (attempt ${attempt + 1}):`, err);
            }
          }
          if (!pageSuccess) {
            console.warn(`⚠️ Page ${p} of ${file.name} could not be processed after ${MAX_CLIENT_RETRIES} attempts`);
          }
          pagesDone++;
          update({ progress: Math.round((pagesDone / pagesTotal) * 100), processedPages: pagesDone });
        }
      }

      update({
        status: 'done',
        progress: 100,
        results: { rows: allRows },
      });
    } catch (err) {
      console.error('PDF processing error:', err);
      update({ status: 'error', error: err instanceof Error ? err.message : 'Failed to process PDF' });
    } finally {
      clearInterval(quoteInterval);
      processingRef.current = false;
    }
    });
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    if (files.length) processFiles(files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) processFiles(files);
    e.target.value = '';
  };

  const toggleAll = (checked: boolean) => setRows(r => r.map(row => ({ ...row, selected: checked })));
  const deleteRow = (idx: number) => setRows(r => r.filter((_, i) => i !== idx));

  const toggleWall = (idx: number, side: 'leftWall' | 'rightWall') => {
    setRows(r => r.map((row, i) => {
      if (i !== idx) return row;
      const updated = { ...row, [side]: !row[side] };
      updated.sidesplashCount = (updated.leftWall ? 1 : 0) + (updated.rightWall ? 1 : 0);
      return updated;
    }));
  };

  const handleImport = () => {
    const selected = rows.filter(r => r.selected);
    const typeOrder: string[] = [];
    for (const r of selected) {
      const t = r.unitType || '';
      if (t && !typeOrder.includes(t)) typeOrder.push(t);
    }
    onImport(selected, typeOrder.length > 0 ? typeOrder : undefined);
  };

  const selectedCount = rows.filter(r => r.selected).length;
  const reviewCount = rows.filter(r => r.reviewRequired).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">🛁 Cmarble/Swan Vtop — Extract from 2020 Shop Drawings</h3>
          <button onClick={onClose} className="p-1 hover:bg-secondary rounded"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {step === 'upload' && (
            <div
              className="border-2 border-dashed border-border rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={40} className="mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium mb-1">Drop 2020 countertop shop drawings here</p>
              <p className="text-xs text-muted-foreground">AI will extract vanity top dimensions, bowl position, and finish ends</p>
              <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleFileSelect} />
              {error && <p className="text-destructive text-xs mt-3">{error}</p>}
            </div>
          )}

          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-10 gap-6 px-6 animate-fade-in">
              <div className="relative flex items-center justify-center w-20 h-20">
                <span className="absolute inset-0 rounded-full opacity-20 animate-[ping_1.8s_cubic-bezier(0,0,0.2,1)_infinite]" style={{ background: 'hsl(var(--primary))' }} />
                <Loader2 size={32} className="animate-spin relative z-10" style={{ color: 'hsl(var(--primary))' }} />
                <Sparkles size={13} className="absolute top-2 right-2 z-20 animate-pulse" style={{ color: 'hsl(var(--primary))' }} />
              </div>

              {/* Live elapsed timer */}
              <div className="flex items-center gap-1.5 text-xs font-mono tabular-nums text-foreground bg-secondary/70 border border-border px-2.5 py-1 rounded-full">
                <Timer size={12} className="text-primary" />
                <span className="font-semibold">
                  {formatExtractionDuration((bgJob?.startedAt ? nowTick - bgJob.startedAt : 0))}
                </span>
                <span className="text-muted-foreground text-[10px]">elapsed</span>
              </div>
              <div className="text-center space-y-2 max-w-xs">
                <p className="text-xs italic text-muted-foreground/80" style={{ opacity: quoteVisible ? 1 : 0, transition: 'opacity 0.4s ease' }}>
                  "{QUOTES[quoteIdx]}"
                </p>
                {prefinalPerson && (
                  <p className="text-xs font-medium text-primary" style={{ opacity: quoteVisible ? 1 : 0, transition: 'opacity 0.4s ease' }}>
                    {PERSONAL_QUOTES[personalQuoteIdx](prefinalPerson)}
                  </p>
                )}
              </div>
              <div className="w-full max-w-sm space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground font-medium">Progress</span>
                  <span className="font-bold tabular-nums" style={{ color: 'hsl(var(--primary))' }}>{progress}%</span>
                </div>
                <div className="relative w-full h-3 rounded-full overflow-hidden" style={{ background: 'hsl(var(--secondary))' }}>
                  <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${progress}%`, background: 'hsl(var(--primary))' }} />
                </div>
              </div>
              {error && <p className="text-destructive text-xs mt-3">{error}</p>}
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <p className="text-sm font-medium">
                    Found {rows.length} vanity top{rows.length !== 1 ? 's' : ''}
                  </p>
                  {reviewCount > 0 && (
                    <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                      <AlertTriangle size={10} /> {reviewCount} need review
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowDebug(d => !d)}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    {showDebug ? <EyeOff size={10} /> : <Eye size={10} />}
                    {showDebug ? 'Hide' : 'Show'} debug
                  </button>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={selectedCount === rows.length && rows.length > 0} onChange={e => toggleAll(e.target.checked)} />
                    Select all
                  </label>
                </div>
              </div>

              {rows.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No vanity tops detected.
                  <button onClick={() => setStep('upload')} className="block mx-auto mt-2 text-primary text-xs underline">Try another PDF</button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="est-table text-xs">
                    <thead>
                      <tr>
                        <th className="w-8"></th>
                        <th>Type</th>
                        <th>SKU Description</th>
                        <th>Sidesplash</th>
                        <th className="text-center">SS#</th>
                        <th className="text-center">L Wall</th>
                        <th className="text-center">R Wall</th>
                        {showDebug && <th>Debug</th>}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => {
                        const isReview = row.reviewRequired;
                        return (
                          <tr
                            key={idx}
                            className={`${!row.selected ? 'opacity-50' : ''} ${isReview ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}`}
                          >
                            <td>
                              <input type="checkbox" checked={row.selected} onChange={() => setRows(r => r.map((rr, i) => i === idx ? { ...rr, selected: !rr.selected } : rr))} />
                            </td>
                            <td className="font-medium text-[10px]">
                              {row.unitType}
                              {isReview && (
                                <span className="block text-[9px] text-amber-600 dark:text-amber-400" title={row.reviewReason}>
                                  ⚠ {row.reviewReason}
                                </span>
                              )}
                            </td>
                            <td className="font-mono text-[10px] font-bold">{formatVtopSku(row)}</td>
                            <td className="text-[10px]">
                              {getVtopSidesplashItems(row).length > 0
                                ? getVtopSidesplashItems(row).map((s, i) => <div key={i}>{s} — 1 qty</div>)
                                : <span className="text-muted-foreground">None</span>}
                            </td>
                            <td className="text-center font-bold text-[10px]">
                              {row.sidesplashCount ?? ((row.leftWall ? 1 : 0) + (row.rightWall ? 1 : 0))}
                            </td>
                            <td className="text-center">
                              <input
                                type="checkbox"
                                checked={row.leftWall}
                                onChange={() => toggleWall(idx, 'leftWall')}
                                title={`Confidence: ${((row.leftWallConfidence ?? 0.5) * 100).toFixed(0)}%`}
                              />
                              {row.leftWallConfidence != null && (
                                <span className="block text-[8px] text-muted-foreground">{(row.leftWallConfidence * 100).toFixed(0)}%</span>
                              )}
                            </td>
                            <td className="text-center">
                              <input
                                type="checkbox"
                                checked={row.rightWall}
                                onChange={() => toggleWall(idx, 'rightWall')}
                                title={`Confidence: ${((row.rightWallConfidence ?? 0.5) * 100).toFixed(0)}%`}
                              />
                              {row.rightWallConfidence != null && (
                                <span className="block text-[8px] text-muted-foreground">{(row.rightWallConfidence * 100).toFixed(0)}%</span>
                              )}
                            </td>
                            {showDebug && (
                              <td>
                                <div className="flex gap-1">
                                  {row.debugImages?.leftEndCrop && (
                                    <img
                                      src={`data:image/png;base64,${row.debugImages.leftEndCrop}`}
                                      alt="Left end"
                                      className="h-8 border border-border rounded"
                                      title="Left end crop"
                                    />
                                  )}
                                  {row.debugImages?.vanityCrop && (
                                    <img
                                      src={`data:image/png;base64,${row.debugImages.vanityCrop}`}
                                      alt="Vanity"
                                      className="h-8 border border-border rounded"
                                      title="Full vanity crop"
                                    />
                                  )}
                                  {row.debugImages?.rightEndCrop && (
                                    <img
                                      src={`data:image/png;base64,${row.debugImages.rightEndCrop}`}
                                      alt="Right end"
                                      className="h-8 border border-border rounded"
                                      title="Right end crop"
                                    />
                                  )}
                                </div>
                              </td>
                            )}
                            <td>
                              <button onClick={() => deleteRow(idx)} className="p-1 hover:text-destructive"><Trash2 size={12} /></button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {step === 'review' && rows.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <button onClick={() => setStep('upload')} className="text-xs text-muted-foreground hover:text-foreground">
              + Upload more
            </button>
            <button
              onClick={handleImport}
              disabled={selectedCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold text-white transition-colors disabled:opacity-40"
              style={{ background: 'hsl(var(--primary))' }}
            >
              Import {selectedCount} vanity top{selectedCount !== 1 ? 's' : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
