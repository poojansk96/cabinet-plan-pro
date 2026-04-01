import { useState, useRef } from 'react';
import { X, Upload, Loader2, Sparkles, Trash2, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import type { PrefinalVtopRow } from '@/hooks/usePrefinalStore';

// ─── Extended import row with new detection fields ───
export interface VtopImportRow extends PrefinalVtopRow {
  selected: boolean;
  sourceFile?: string;
  bbox?: { x: number; y: number; width: number; height: number };
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

async function canvasToBase64(canvas: OffscreenCanvas | HTMLCanvasElement, quality = 0.82): Promise<string> {
  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  return (canvas as HTMLCanvasElement).toDataURL('image/jpeg', quality).split(',')[1];
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

async function renderPagePassImages(page: any): Promise<{ pageImage: string; stripImages: string[] }> {
  const { canvas, width, height } = await renderPageToCanvasData(page);
  const pageImage = await canvasToBase64(canvas, 0.82);

  const xRanges: Array<[number, number]> = [
    [0, 0.5], [0.25, 0.75], [0.5, 1],
  ];
  const yStart = 0.03;
  const yEnd = 0.98;

  const stripImages = await Promise.all(
    xRanges.map(async ([xStart, xEnd]) => {
      const sx = Math.floor(xStart * width);
      const sy = Math.floor(yStart * height);
      const sw = Math.max(1, Math.ceil((xEnd - xStart) * width));
      const sh = Math.max(1, Math.ceil((yEnd - yStart) * height));
      return canvasCropToBase64(canvas, sx, sy, sw, sh, 0.88);
    }),
  );

  return { pageImage, stripImages };
}

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
function detectDoubleLineAtEdge(imageData: ImageData, side: 'left' | 'right'): number {
  const { data, width, height } = imageData;
  if (width < 6 || height < 10) return 0.5;

  // Only analyze center 60% of height
  const yStart = Math.floor(height * 0.2);
  const yEnd = Math.floor(height * 0.8);
  const analyzeHeight = yEnd - yStart;
  if (analyzeHeight < 5) return 0.5;

  // Only look at edge zone: first/last 15% of width
  const edgeZoneWidth = Math.max(4, Math.floor(width * 0.15));
  const xStart = side === 'left' ? 0 : width - edgeZoneWidth;
  const xEnd = xStart + edgeZoneWidth;

  // Build column darkness profile in the edge zone
  // For each column, count how many rows in the center zone are "dark"
  const darkThreshold = 128; // pixel luminance below this = dark
  const columnDarkRatio = new Float64Array(edgeZoneWidth);

  for (let localX = 0; localX < edgeZoneWidth; localX++) {
    const absX = xStart + localX;
    let darkCount = 0;
    for (let y = yStart; y < yEnd; y++) {
      const idx = (y * width + absX) * 4;
      const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      if (lum < darkThreshold) darkCount++;
    }
    columnDarkRatio[localX] = darkCount / analyzeHeight;
  }

  // Find vertical bands: contiguous columns where > 40% of center pixels are dark
  const bandThreshold = 0.4;
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

  // Filter: bands must be narrow (1-6 px) and tall enough (avg darkness > 0.5)
  const validBands = bands.filter(b => {
    const w = b.end - b.start + 1;
    return w >= 1 && w <= Math.max(6, edgeZoneWidth * 0.4) && b.avgDarkness >= 0.5;
  });

  if (validBands.length >= 2) {
    // Sort by position to find gap between first two
    validBands.sort((a, b) => a.start - b.start);
    const gap = validBands[1].start - validBands[0].end - 1;
    const maxGap = Math.max(8, edgeZoneWidth * 0.5);

    if (gap >= 1 && gap <= maxGap) {
      // Two bands with reasonable gap = strong double line (wall)
      return 0.92;
    }
    if (gap === 0) {
      // Adjacent bands, might be one thick line
      return 0.4;
    }
    // Very large gap — suspicious
    return 0.55;
  }

  if (validBands.length === 1) {
    // Single narrow band = likely open end (single line)
    return 0.15;
  }

  // No clear bands found
  return 0.3;
}

/**
 * Analyze a vanity end crop and return wall confidence.
 * Crops tightly at the edge of the vanity bbox.
 */
function analyzeEndCrop(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  canvasW: number, canvasH: number,
  bbox: { x: number; y: number; width: number; height: number },
  side: 'left' | 'right',
): { confidence: number; cropBase64: string } {
  // Crop a narrow strip at the specified end of the vanity bbox
  // Use 10% of vanity width, staying inside the bbox (not outside)
  const endWidthFrac = Math.max(0.05, bbox.width * 0.22);
  const endBbox = {
    x: side === 'left' ? bbox.x : bbox.x + bbox.width - endWidthFrac,
    y: bbox.y,
    width: endWidthFrac,
    height: bbox.height,
  };

  const { imageData, base64 } = cropNormalizedRegion(canvas, canvasW, canvasH, endBbox);
  const confidence = detectDoubleLineAtEdge(imageData, side);
  return { confidence, cropBase64: base64 };
}

/**
 * Final wall decision: deterministic is primary, AI is fallback only.
 *
 * Rules:
 * - deterministic strong yes (>= 0.75) → wall=true
 * - deterministic strong no (<= 0.25) → wall=false
 * - deterministic weak (0.25..0.75) → consult AI probability, mark review
 */
function scoreWallEvidence(
  deterministicConf: number,
  aiWallYesProb: number, // direct probability wall=true from backend (0..1)
): { wall: boolean; confidence: number; reviewRequired: boolean } {
  if (deterministicConf >= 0.75) {
    // Strong deterministic yes
    return { wall: true, confidence: deterministicConf, reviewRequired: false };
  }
  if (deterministicConf <= 0.25) {
    // Strong deterministic no
    return { wall: false, confidence: 1 - deterministicConf, reviewRequired: false };
  }

  // Weak deterministic — blend with AI (deterministic 0.8, AI 0.2)
  const combined = deterministicConf * 0.8 + aiWallYesProb * 0.2;
  const wall = combined >= 0.5;
  return {
    wall,
    confidence: Math.round(combined * 100) / 100,
    reviewRequired: true,
  };
}

/**
 * Final wall decision for a row, combining all evidence.
 */
function finalizeWallDecision(
  row: VtopImportRow,
  leftDet: { confidence: number; cropBase64: string },
  rightDet: { confidence: number; cropBase64: string },
  vanityCropBase64: string,
): VtopImportRow {
  // Use direct AI wall probability (not derived from boolean)
  const aiLeftProb = row.leftWallConfidence ?? 0.5;
  const aiRightProb = row.rightWallConfidence ?? 0.5;

  const left = scoreWallEvidence(leftDet.confidence, aiLeftProb);
  const right = scoreWallEvidence(rightDet.confidence, aiRightProb);

  const reviewRequired = left.reviewRequired || right.reviewRequired;
  const reasons: string[] = [];
  if (left.reviewRequired) reasons.push(`Left wall uncertain (det:${(leftDet.confidence * 100).toFixed(0)}%)`);
  if (right.reviewRequired) reasons.push(`Right wall uncertain (det:${(rightDet.confidence * 100).toFixed(0)}%)`);

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

export default function VtopPDFImportDialog({ onImport, onClose, prefinalPerson }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<VtopImportRow[]>([]);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [personalQuoteIdx, setPersonalQuoteIdx] = useState(0);
  const [quoteVisible, setQuoteVisible] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  async function processFiles(files: File[]) {
    if (processingRef.current) return;
    processingRef.current = true;
    setStep('processing');
    setError('');
    setProgress(0);

    const quoteInterval = setInterval(() => {
      setQuoteVisible(false);
      setTimeout(() => {
        setQuoteIdx(i => (i + 1) % QUOTES.length);
        setPersonalQuoteIdx(i => (i + 1) % PERSONAL_QUOTES.length);
        setQuoteVisible(true);
      }, 400);
    }, 4000);

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

      for (const file of files) {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);

          // High-res canvas for deterministic bbox crops (kept at 3200px)
          const { canvas, width: canvasW, height: canvasH } = await renderPageToCanvasData(page, 3200, 4.5);
          
          // Smaller image for AI pass to avoid edge function timeouts
          const aiCanvas = await renderPageToCanvasData(page, 2000, 3);
          const pageImage = await canvasToBase64(aiCanvas.canvas, 0.7);

          const MAX_CLIENT_RETRIES = 5;
          let pageSuccess = false;
          for (let attempt = 0; attempt < MAX_CLIENT_RETRIES && !pageSuccess; attempt++) {
            try {
              if (attempt > 0) {
                const delay = Math.min(3000 * attempt, 15000);
                await new Promise(r => setTimeout(r, delay));
              }
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 90000);
              const resp = await fetch(`${SUPABASE_URL}/functions/v1/extract-pdf-vtops`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${SUPABASE_KEY}`,
                },
                body: JSON.stringify({ pageImage }),
                signal: controller.signal,
              });
              clearTimeout(timeout);

              if (resp.status === 429) { setError('Rate limit reached. Please wait and try again.'); break; }
              if (resp.status === 402) { setError('AI credits exhausted.'); break; }

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
                    leftWallConfidence: vt.leftWallYesConfidence ?? vt.leftWallConfidence ?? 0.5,
                    rightWallConfidence: vt.rightWallYesConfidence ?? vt.rightWallConfidence ?? 0.5,
                    sidesplashCount: vt.sidesplashCount,
                    reviewRequired: vt.reviewRequired,
                    reviewReason: vt.reviewReason,
                  };

                  // ── Deterministic wall detection using bbox crops ──
                  if (vt.bbox && vt.bbox.width > 0.01 && vt.bbox.height > 0.01) {
                    try {
                      // Crop vanity area
                      const { base64: vanityCropB64 } = cropNormalizedRegion(
                        canvas, canvasW, canvasH, vt.bbox,
                      );
                      // Analyze left and right ends
                      const leftDet = analyzeEndCrop(canvas, canvasW, canvasH, vt.bbox, 'left');
                      const rightDet = analyzeEndCrop(canvas, canvasW, canvasH, vt.bbox, 'right');

                      // Finalize wall decision (deterministic is primary)
                      importRow = finalizeWallDecision(importRow, leftDet, rightDet, vanityCropB64);
                    } catch (detErr) {
                      console.warn('Deterministic wall detection failed for row:', detErr);
                      // Fall back to AI-only results
                      importRow.reviewRequired = true;
                      importRow.reviewReason = (importRow.reviewReason || '') + ' Deterministic detection failed.';
                    }
                  } else {
                    // No bbox — can't do deterministic detection
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
          setProgress(Math.round((pagesDone / pagesTotal) * 100));
        }
      }

      setRows(allRows);
      setStep('review');
    } catch (err) {
      console.error('PDF processing error:', err);
      setError(err instanceof Error ? err.message : 'Failed to process PDF');
      setStep('upload');
    } finally {
      clearInterval(quoteInterval);
      processingRef.current = false;
    }
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
