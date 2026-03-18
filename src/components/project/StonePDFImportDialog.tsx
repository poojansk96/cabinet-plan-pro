import { useState, useRef } from 'react';
import { X, Upload, Loader2, Check, Trash2, Sparkles } from 'lucide-react';

export interface StoneExtractedRow {
  label: string;
  length: number;
  depth: number;
  splashHeight: number | null;
  sidesplashCount: number;
  backsplashLength: number;
  category: 'kitchen' | 'bath';
  room: string;
  selected: boolean;
  sourceFile?: string;
  detectedUnitType?: string;
}

interface Props {
  onImport: (rows: StoneExtractedRow[], detectedUnitType?: string) => void;
  onClose: () => void;
  prefinalPerson?: string;
}

const PERSONAL_QUOTES = [
  (name: string) => `${name}, you've got this — one unit at a time! 💪`,
  (name: string) => `Keep going, ${name}! Accuracy is your superpower.`,
  (name: string) => `${name}, precision like yours builds perfection.`,
  (name: string) => `You're crushing it, ${name}! Every count matters.`,
  (name: string) => `${name}, great takeoffs start with great people like you.`,
  (name: string) => `Stay sharp, ${name} — excellence is in the details!`,
  (name: string) => `${name}, believe in the process. You're almost there!`,
  (name: string) => `One page closer, ${name}. You make it look easy! ✨`,
  (name: string) => `${name}, your dedication to accuracy is inspiring.`,
  (name: string) => `Trust the grind, ${name}. The results will speak!`,
  (name: string) => `${name}, legends aren't born — they count cabinets. 😄`,
  (name: string) => `Focus and flow, ${name}. You're in the zone!`,
];

type Step = 'upload' | 'processing' | 'review';

async function renderPageToBase64(page: any, scale = 3): Promise<string> {
  const vp = page.getViewport({ scale });
  let canvas: any;
  let ctx: any;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(vp.width, vp.height);
    ctx = canvas.getContext('2d');
  } else {
    canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    ctx = canvas.getContext('2d');
  }
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  let blob: Blob;
  if (canvas instanceof OffscreenCanvas) {
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  } else {
    blob = await new Promise<Blob>((res) => canvas.toBlob((b: Blob) => res(b), 'image/jpeg', 0.85));
  }
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

  // Payload guard: downscale if > 3.5 MB
  let b64 = btoa(binary);
  if (b64.length > 3_500_000 && scale > 1.5) {
    return renderPageToBase64(page, scale - 0.5);
  }
  return b64;
}

// Render a horizontal strip of a page (yStart/yEnd as fractions 0-1, with overlap)
async function renderStripToBase64(page: any, yStartFrac: number, yEndFrac: number, scale = 3): Promise<string> {
  const fullVp = page.getViewport({ scale });
  const yStart = Math.floor(fullVp.height * yStartFrac);
  const yEnd = Math.ceil(fullVp.height * yEndFrac);
  const stripHeight = yEnd - yStart;

  let canvas: any;
  let ctx: any;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(fullVp.width, stripHeight);
    ctx = canvas.getContext('2d');
  } else {
    canvas = document.createElement('canvas');
    canvas.width = fullVp.width;
    canvas.height = stripHeight;
    ctx = canvas.getContext('2d');
  }

  // Translate canvas so the strip region aligns to (0,0)
  ctx.translate(0, -yStart);
  await page.render({ canvasContext: ctx, viewport: fullVp }).promise;

  let blob: Blob;
  if (canvas instanceof OffscreenCanvas) {
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  } else {
    blob = await new Promise<Blob>((res) => canvas.toBlob((b: Blob) => res(b), 'image/jpeg', 0.85));
  }
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

  let b64 = btoa(binary);
  if (b64.length > 3_500_000 && scale > 1.5) {
    return renderStripToBase64(page, yStartFrac, yEndFrac, scale - 0.5);
  }
  return b64;
}

// 3 overlapping horizontal strips (15% overlap)
const STRIP_REGIONS = [
  { yStart: 0, yEnd: 0.40 },      // top 40%
  { yStart: 0.30, yEnd: 0.70 },   // middle 40% (overlaps top & bottom)
  { yStart: 0.60, yEnd: 1.0 },    // bottom 40%
];

interface RawCountertop {
  label: string;
  length: number;
  depth: number;
  splashHeight: number | null;
  sidesplashCount: number;
  backsplashLength: number;
  category: 'kitchen' | 'bath';
  room: string;
}

// Normalize label for matching across passes
function normalizeLabel(label: string): string {
  return String(label || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Merge multiple pass results: passes[0] is source of truth for count;
// strips only refine splash data (MIN backsplashLength, MAX sidesplashCount)
function mergePassResults(passes: RawCountertop[][]): RawCountertop[] {
  const base = passes[0] || [];
  if (passes.length <= 1) return base;

  const splashDataMap = new Map<string, { back: number, side: number }>();

  for (const pass of passes) {
    for (const ct of pass) {
      const key = `${normalizeLabel(ct.label)}|${ct.length}|${ct.depth}`;
      if (!splashDataMap.has(key)) {
        splashDataMap.set(key, { back: ct.backsplashLength, side: ct.sidesplashCount });
      } else {
        const existing = splashDataMap.get(key)!;
        if (ct.backsplashLength > 0 && ct.backsplashLength < existing.back) {
          existing.back = ct.backsplashLength;
        }
        existing.side = Math.max(existing.side, ct.sidesplashCount);
      }
    }
  }

  return base.map(ct => {
    const key = `${normalizeLabel(ct.label)}|${ct.length}|${ct.depth}`;
    const bestSplash = splashDataMap.get(key);
    if (bestSplash) {
      return { 
        ...ct, 
        backsplashLength: bestSplash.back,
        sidesplashCount: Math.max(ct.sidesplashCount, bestSplash.side)
      };
    }
    return ct;
  });
}

// extractPageText removed — AI now returns unitType directly

function normalizeTypeIdentity(raw: string): string {
  return String(raw || '')
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/_/g, ' ')
    .replace(/^UNIT\s+TYPE\s*[:\-]?\s*/, '')
    .replace(/^TYPE\s+/, '')
    .replace(/^PLAN\s+/, '')
    .replace(/\s*-\s*/g, '-')
    .replace(/[\s()]/g, '')
    .replace(/[^A-Z0-9.\-/]/g, '')
    .trim();
}

function cleanDetectedType(raw: string): string {
  return String(raw || '')
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/_/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+/g, ' ')
    .replace(/[^A-Z0-9().\-/ ]/g, '')
    .replace(/\b(FLOOR PLAN|FLOOR|ELEVATIONS?|SHEETS?|DRAWINGS?|DETAILS?|COUNTERTOPS?|TOPS?|STONE|CABINETS?|SHOP)\b.*$/i, '')
    .trim();
}

function isLikelyTypeName(value: string, allowShort = false): boolean {
  const cleaned = cleanDetectedType(value);
  const identity = normalizeTypeIdentity(cleaned);
  if (!identity) return false;
  if (/^(KITCHEN|BATH|VANITY|COUNTERTOP|STONE|SHOP|DRAWING|PLAN)$/i.test(identity)) return false;
  if (/[A-Z]/.test(identity) && /\d/.test(identity)) return true;
  if (/\b(?:STUDIO|PENTHOUSE|TOWNHOUSE|CONDO|LOFT|DUPLEX|TRIPLEX)\b/i.test(cleaned)) return true;
  return allowShort && /^[A-Z][A-Z0-9().\-/ ]{0,30}$/.test(cleaned);
}

function detectTypeFromText(text: string): string | null {
  const normalized = String(text || '')
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;

  const hits: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: string) => {
    const clean = cleanDetectedType(candidate);
    const key = normalizeTypeIdentity(clean);
    if (!key || seen.has(key) || !isLikelyTypeName(clean, true)) return;
    seen.add(key);
    hits.push(clean);
  };

  const patterns = [
    /\bUNIT\s+TYPE\s*[:\-]?\s*(TYPE\s+[A-Z0-9][A-Z0-9.\-/]*(?:\s*\([A-Z0-9.\-/ ]+\))?(?:\s*-\s*[A-Z0-9.\-/]+)?(?:\s+(?:AS|MIRROR|ADA|REV|ALT|OPTION))?)/g,
    /\bUNIT\s+TYPE\s*[:\-]?\s*([A-Z0-9][A-Z0-9.\-/]*(?:\s*\([A-Z0-9.\-/ ]+\))?(?:\s*-\s*[A-Z0-9.\-/]+)?(?:\s+(?:AS|MIRROR|ADA|REV|ALT|OPTION))?)/g,
    /\b(TYPE\s+[A-Z0-9][A-Z0-9.\-/]*(?:\s*\([A-Z0-9.\-/ ]+\))?(?:\s*-\s*[A-Z0-9.\-/]+)?(?:\s+(?:AS|MIRROR|ADA|REV|ALT|OPTION))?)/g,
    /\b(PLAN\s+[A-Z0-9][A-Z0-9.\-/]*(?:\s*\([A-Z0-9.\-/ ]+\))?(?:\s*-\s*[A-Z0-9.\-/]+)?(?:\s+(?:AS|MIRROR|ADA|REV|ALT|OPTION))?)/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      push(match[1] || match[0]);
    }
  }

  return hits[0] ?? null;
}

function detectTypeFromFilename(fileName: string): string | null {
  const normalized = String(fileName || '')
    .replace(/\.[^.]+$/, ' ')
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const hinted = detectTypeFromText(normalized);
  if (hinted) return hinted;

  const codeMatch = normalized.match(/\b(TYPE\s+)?([A-Z]*\d+(?:\.\d+[A-Z]*)?(?:\s*\([A-Z0-9.\-/ ]+\))?(?:\s*-\s*(?:AS|MIRROR|ADA|REV|ALT|OPTION|[A-Z0-9]+))*)\b/);
  if (!codeMatch) return null;

  const candidate = cleanDetectedType(`${codeMatch[1] || ''}${codeMatch[2] || ''}`);
  return isLikelyTypeName(candidate) ? candidate : null;
}

function calcSqft(row: StoneExtractedRow): number {
  const deckSqIn = row.length * row.depth;
  let splashSqIn = 0;
  if (row.splashHeight && row.splashHeight > 0) {
    const sideSplashLength = (row.sidesplashCount || 0) * row.depth;
    const backLength = row.backsplashLength || 0; 
    splashSqIn = (backLength + sideSplashLength) * row.splashHeight;
  }
  return Math.ceil((deckSqIn + splashSqIn) / 144);
}

const QUOTES = [
  "Measuring twice, cutting once...",
  "Scanning for countertop dimensions...",
  "Analyzing stone drawings...",
  "Reading dimension labels...",
  "Calculating surface areas...",
];

export default function StonePDFImportDialog({ onImport, onClose, prefinalPerson }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<StoneExtractedRow[]>([]);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [personalQuoteIdx, setPersonalQuoteIdx] = useState(0);
  const [quoteVisible, setQuoteVisible] = useState(true);
  const [detectedType, setDetectedType] = useState<string | null>(null);
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

      let allRows: StoneExtractedRow[] = [...rows];
      let pagesDone = 0;
      let pagesTotal = 0;

      // 4 passes per page: 1 full + 3 strips
      const PASSES_PER_PAGE = 4;

      for (const file of files) {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        pagesTotal += pdf.numPages * PASSES_PER_PAGE;
      }
      setTotalPages(pagesTotal);
      setDetectedType(null);

      let lastFileType: string | null = null;

      for (const file of files) {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        const fileFallbackType = detectTypeFromFilename(file.name);
        let fileType: string | null = null;
        const fileRowStartIndex = allRows.length;

        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);

          let pageText = '';
          try {
            const textContent = await page.getTextContent();
            pageText = textContent.items
              .map((item: any) => item.str)
              .filter((s: string) => s.trim().length > 0)
              .join(' ');
          } catch (err) {
            console.warn(`Failed to read text layer on page ${p}:`, err);
          }

          const textType = detectTypeFromText(pageText);

          // Helper to call edge function and parse result
          const callExtract = async (imageB64: string): Promise<{ countertops: RawCountertop[]; unitType: string | null }> => {
            const resp = await fetch(`${SUPABASE_URL}/functions/v1/extract-pdf-countertops`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_KEY}`,
              },
              body: JSON.stringify({ pageImage: imageB64 }),
            });

            if (resp.status === 429) { setError('Rate limit reached. Please wait and try again.'); return { countertops: [], unitType: null }; }
            if (resp.status === 402) { setError('AI credits exhausted.'); return { countertops: [], unitType: null }; }

            if (resp.ok) {
              const data = await resp.json();
              const aiType = data.unitType ? cleanDetectedType(String(data.unitType).trim()) : null;
              const cts: RawCountertop[] = (data.countertops ?? []).map((ct: any) => ({
                label: String(ct.label || 'Section').trim(),
                length: ct.length,
                depth: ct.depth,
                splashHeight: ct.splashHeight ?? null,
                sidesplashCount: Number(ct.sidesplashCount) || 0,
                backsplashLength: Number.isFinite(Number(ct.backsplashLength)) ? Number(ct.backsplashLength) : 0,
                category: ct.category || (ct.depth <= 22 ? 'bath' : 'kitchen'),
                room: String(ct.room || 'Kitchen').trim(),
              }));
              return { countertops: cts, unitType: aiType };
            }
            return { countertops: [], unitType: null };
          };

          // Pass 1: Full page
          setStatusMsg(`Processing ${file.name} — page ${p}/${pdf.numPages} (full scan)`);
          const pageImage = await renderPageToBase64(page);
          let fullResult: { countertops: RawCountertop[]; unitType: string | null } = { countertops: [], unitType: null };
          try {
            fullResult = await callExtract(pageImage);
          } catch (err) {
            console.error(`Error on full pass page ${p}:`, err);
          }
          pagesDone++;
          setProgress(Math.round((pagesDone / pagesTotal) * 100));

          // Passes 2-4: 3 horizontal strips
          const allPasses: RawCountertop[][] = [fullResult.countertops];
          for (let s = 0; s < STRIP_REGIONS.length; s++) {
            setStatusMsg(`Processing ${file.name} — page ${p}/${pdf.numPages} (strip ${s + 1}/3)`);
            try {
              const stripImage = await renderStripToBase64(page, STRIP_REGIONS[s].yStart, STRIP_REGIONS[s].yEnd);
              const stripResult = await callExtract(stripImage);
              allPasses.push(stripResult.countertops);
            } catch (err) {
              console.error(`Error on strip ${s + 1} page ${p}:`, err);
              allPasses.push([]);
            }
            pagesDone++;
            setProgress(Math.round((pagesDone / pagesTotal) * 100));
          }

          // Merge passes: take MIN backsplashLength per section
          const merged = mergePassResults(allPasses);

          // Resolve type
          const resolvedPageType = fullResult.unitType || textType || fileType || fileFallbackType || null;

          if (resolvedPageType && !fileType) {
            fileType = resolvedPageType;
          }

          if (fileType) {
            for (let i = fileRowStartIndex; i < allRows.length; i++) {
              if (allRows[i].sourceFile === file.name && !allRows[i].detectedUnitType) {
                allRows[i] = { ...allRows[i], detectedUnitType: fileType };
              }
            }
          }

          if (resolvedPageType && !lastFileType) {
            lastFileType = resolvedPageType;
            setDetectedType(resolvedPageType);
          }

          for (const ct of merged) {
            allRows.push({
              ...ct,
              selected: true,
              sourceFile: file.name,
              detectedUnitType: resolvedPageType || fileType || undefined,
            });
          }
        }

        if (fileType) {
          for (let i = fileRowStartIndex; i < allRows.length; i++) {
            if (allRows[i].sourceFile === file.name && !allRows[i].detectedUnitType) {
              allRows[i] = { ...allRows[i], detectedUnitType: fileType };
            }
          }
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
  const updateRow = (idx: number, data: Partial<StoneExtractedRow>) => setRows(r => r.map((row, i) => i === idx ? { ...row, ...data } : row));
  const deleteRow = (idx: number) => setRows(r => r.filter((_, i) => i !== idx));

  const handleImport = () => {
    const selected = rows.filter(r => r.selected);
    onImport(selected, detectedType ?? undefined);
  };

  const selectedCount = rows.filter(r => r.selected).length;
  const totalSqft = rows.filter(r => r.selected).reduce((s, r) => s + calcSqft(r), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">📐 Stone SQFT — Extract from 2020 Shop Drawings</h3>
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
              <p className="text-xs text-muted-foreground">AI will extract dimensions and calculate SQFT</p>
              <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleFileSelect} />
              {error && <p className="text-destructive text-xs mt-3">{error}</p>}
            </div>
          )}

          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-10 gap-6 px-6 animate-fade-in">
              {/* Animated icon cluster */}
              <div className="relative flex items-center justify-center w-20 h-20">
                <span className="absolute inset-0 rounded-full opacity-20 animate-[ping_1.8s_cubic-bezier(0,0,0.2,1)_infinite]" style={{ background: 'hsl(var(--primary))' }} />
                <span className="absolute inset-2 rounded-full opacity-10 animate-[ping_1.8s_cubic-bezier(0,0,0.2,1)_0.4s_infinite]" style={{ background: 'hsl(var(--primary))' }} />
                <span className="absolute inset-3 rounded-full" style={{ background: 'hsl(var(--primary)/0.12)' }} />
                <Loader2 size={32} className="animate-spin relative z-10" style={{ color: 'hsl(var(--primary))' }} />
                <Sparkles size={13} className="absolute top-2 right-2 z-20 animate-pulse" style={{ color: 'hsl(var(--primary))' }} />
              </div>

              {/* Status + Quote */}
              <div className="text-center space-y-2 max-w-xs">
                <p
                  className="text-xs italic text-muted-foreground/80 transition-opacity duration-400 px-2"
                  style={{ opacity: quoteVisible ? 1 : 0, transition: 'opacity 0.4s ease' }}
                >
                  "{QUOTES[quoteIdx]}"
                </p>
                {prefinalPerson && (
                  <p
                    className="text-xs font-medium text-primary transition-opacity duration-400 px-2"
                    style={{ opacity: quoteVisible ? 1 : 0, transition: 'opacity 0.4s ease' }}
                  >
                    {PERSONAL_QUOTES[personalQuoteIdx](prefinalPerson)}
                  </p>
                )}
              </div>

              {/* Progress bar */}
              <div className="w-full max-w-sm space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground font-medium">Progress</span>
                  <span className="font-bold tabular-nums" style={{ color: 'hsl(var(--primary))' }}>{progress}%</span>
                </div>
                <div className="relative w-full h-3 rounded-full overflow-hidden" style={{ background: 'hsl(var(--secondary))' }}>
                  <div
                    className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_ease-in-out_infinite]"
                    style={{
                      background: 'linear-gradient(90deg, transparent 0%, hsl(var(--primary)/0.25) 50%, transparent 100%)',
                      width: '60%',
                    }}
                  />
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden"
                    style={{
                      width: `${progress}%`,
                      background: 'linear-gradient(90deg, hsl(var(--primary)/0.8) 0%, hsl(var(--primary)) 60%, hsl(var(--primary)/0.9) 100%)',
                    }}
                  >
                    <span className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 60%)' }} />
                  </div>
                </div>
                <div className="flex justify-between items-center pt-1">
                  {['Read PDF', 'Extract pages', 'AI analysis', 'Build list'].map((label, idx) => {
                    const stepThreshold = [5, 10, 30, 95][idx];
                    const done = progress >= stepThreshold + 10;
                    const active = progress >= stepThreshold && !done;
                    return (
                      <div key={label} className="flex flex-col items-center gap-1">
                        <div className={`w-2 h-2 rounded-full transition-all duration-500 ${done ? 'scale-110' : active ? 'scale-125 animate-pulse' : 'opacity-30'}`}
                          style={{ background: done || active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}
                        />
                        <span className={`text-[9px] font-medium transition-colors duration-300 ${done || active ? 'text-primary' : 'text-muted-foreground opacity-50'}`}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {error && <p className="text-destructive text-xs mt-3">{error}</p>}
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  Found {rows.length} section{rows.length !== 1 ? 's' : ''} — 
                  <span className="ml-1 font-bold" style={{ color: 'hsl(var(--primary))' }}>{totalSqft} SQFT</span>
                </p>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={selectedCount === rows.length && rows.length > 0} onChange={e => toggleAll(e.target.checked)} />
                  Select all
                </label>
              </div>

              {rows.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No countertop sections detected.
                  <button onClick={() => setStep('upload')} className="block mx-auto mt-2 text-primary text-xs underline">Try another PDF</button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="est-table text-xs">
                    <thead>
                      <tr>
                        <th className="w-8"></th>
                        <th>Type</th>
                        <th>Label</th>
                        <th>Room</th>
                        <th className="text-right">Length"</th>
                        <th className="text-right">Depth"</th>
                        <th className="text-right">Backsplash"</th>
                        <th className="text-center">Category</th>
                        <th className="text-right">SQFT</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => (
                        <tr key={idx} className={!row.selected ? 'opacity-50' : ''}>
                          <td><input type="checkbox" checked={row.selected} onChange={e => updateRow(idx, { selected: e.target.checked })} /></td>
                          <td><input className="est-input w-20 text-xs font-semibold" value={row.detectedUnitType || ''} onChange={e => updateRow(idx, { detectedUnitType: e.target.value || undefined })} placeholder="—" /></td>
                          <td><input className="est-input w-full text-xs" value={row.label} onChange={e => updateRow(idx, { label: e.target.value })} /></td>
                          <td><input className="est-input w-20 text-xs" value={row.room} onChange={e => updateRow(idx, { room: e.target.value })} /></td>
                          <td className="text-right"><input type="number" className="est-input w-16 text-right text-xs" value={row.length} min={1} onChange={e => updateRow(idx, { length: +e.target.value })} /></td>
                          <td className="text-right"><input type="number" className="est-input w-16 text-right text-xs" value={row.depth} min={1} step={0.5} onChange={e => updateRow(idx, { depth: +e.target.value })} /></td>
                          <td className="text-right"><input type="number" className="est-input w-14 text-right text-xs" value={row.splashHeight ?? ''} min={0} step={0.5} onChange={e => updateRow(idx, { splashHeight: e.target.value ? +e.target.value : null })} placeholder="—" /></td>
                          <td className="text-center">
                            <select className="est-input text-xs w-20" value={row.category} onChange={e => updateRow(idx, { category: e.target.value as 'kitchen' | 'bath' })}>
                              <option value="kitchen">Kitchen</option>
                              <option value="bath">Bath</option>
                            </select>
                          </td>
                          <td className="text-right font-bold" style={{ color: 'hsl(var(--primary))' }}>{calcSqft(row)}</td>
                          <td><button onClick={() => deleteRow(idx)} className="p-1 hover:text-destructive text-muted-foreground"><Trash2 size={12} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-bold border-t border-border">
                        <td colSpan={8} className="text-right">Total SQFT:</td>
                        <td className="text-right" style={{ color: 'hsl(var(--primary))' }}>{totalSqft}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {step === 'review' && rows.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <button onClick={() => setStep('upload')} className="text-xs text-muted-foreground hover:underline">+ Add more PDFs</button>
            <button
              onClick={handleImport}
              disabled={selectedCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-medium text-white disabled:opacity-50"
              style={{ background: 'hsl(var(--primary))' }}
            >
              <Check size={14} />
              Import {selectedCount} Section{selectedCount !== 1 ? 's' : ''} ({totalSqft} SQFT)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
