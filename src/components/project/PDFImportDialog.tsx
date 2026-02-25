import { useState, useRef, useCallback, useEffect } from 'react';
import { FileUp, X, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp, FileText, Tag, Sparkles } from 'lucide-react';
import type { DetectedUnit, PDFExtractionResult } from '@/lib/pdfExtractor';
import type { UnitType } from '@/types/project';
import { toast } from 'sonner';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-pdf-units`;
const EDGE_FUNCTION_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
const EDGE_REQUEST_HEADERS = {
  'Content-Type': 'application/json',
  apikey: EDGE_FUNCTION_KEY,
  Authorization: `Bearer ${EDGE_FUNCTION_KEY}`,
};
const MAX_REQUEST_BYTES = 3_500_000;

const compactPageTextForAI = (text: string): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 4000) return clean;

  const head = clean.slice(0, 2800);
  const tail = clean.slice(-1000);
  return `${head}\n...\n${tail}`;
};
interface UnitRow {
  unitNumber: string;
  type: string;
  detectedType: string | null;
  detectedFloor: string | null;
  detectedBldg: string | null;
  floor: string;
  bldg: string;
  selected: boolean;
  confidence: DetectedUnit['confidence'];
  kitchenConfidence: DetectedUnit['kitchenConfidence'];
  page: number;
  typeOverridden: boolean;
  floorOverridden: boolean;
  bldgOverridden: boolean;
}

interface Props {
  onImport: (units: Array<{ unitNumber: string; type: UnitType; floor: string; bldg: string }>) => void;
  onClose: () => void;
}

type Step = 'upload' | 'processing' | 'review';

const QUOTES = [
  "Measure twice, cut once.",
  "Great design is born from great planning.",
  "Every detail matters — especially in kitchens.",
  "Precision today saves rework tomorrow.",
  "Good plans shape good results.",
  "The best spaces begin on paper.",
  "Form follows function — always.",
  "Craftsmanship starts with accurate takeoffs.",
  "A well-planned kitchen is a joy forever.",
  "Excellence is in the details.",
  "Build smart. Build right. Build once.",
  "Your project, perfectly counted.",
  "Behind every great build is a great plan.",
  "Think ahead. Cut once. Install right.",
  "The blueprint is where dreams become structure.",
];

export default function PDFImportDialog({ onImport, onClose }: Props) {
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * QUOTES.length));
  const [step, setStep] = useState<Step>('upload');
  const [result, setResult] = useState<PDFExtractionResult | null>(null);
  const [rows, setRows] = useState<UnitRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showRawText, setShowRawText] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('Extracting text from PDF…');
  const [usedAI, setUsedAI] = useState(false);
  const [progress, setProgress] = useState(0);       // 0–100
  const [progressLabel, setProgressLabel] = useState('');
  const [bulkBldg, setBulkBldg] = useState('');
  const [quoteVisible, setQuoteVisible] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // Rotate quote every 4 seconds during processing
  useEffect(() => {
    if (step !== 'processing') return;
    const interval = setInterval(() => {
      setQuoteVisible(false);
      setTimeout(() => {
        setQuoteIndex(i => (i + 1) % QUOTES.length);
        setQuoteVisible(true);
      }, 400);
    }, 4000);
    return () => clearInterval(interval);
  }, [step]);

  const processFile = async (file: File) => {
    if (!file.type.includes('pdf')) {
      setError('Please upload a PDF file.');
      return;
    }
    setError(null);
    setStep('processing');
    setUsedAI(false);
    setProgress(0);
    setProgressLabel('');

    try {
      // Step 1: Extract raw text from PDF using pdfjs locally
      setProcessingStatus('Extracting text from PDF…');
      setProgress(5);
      setProgressLabel('Reading PDF…');
      const { extractUnitsFromPDF } = await import('@/lib/pdfExtractor');
      const res = await extractUnitsFromPDF(file);
      setResult(res);
      setProgress(10);

      // Step 2: Re-extract page texts AND render page images for AI
      setProcessingStatus('Preparing pages for AI analysis…');
      const arrayBuffer = await file.arrayBuffer();
      const pdfjsLib = (await import('pdfjs-dist')) as any;
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const totalPages = pdf.numPages;
      const pageTexts: string[] = [];
      // Store PDF page refs so we can render at different qualities adaptively
      const pdfPages: any[] = [];
      
      // Helper: render a PDF page to base64 JPEG at given scale/quality
      const renderPageImage = async (pdfPage: any, scale: number, quality: number): Promise<string> => {
        const viewport = pdfPage.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        canvas.width = 0;
        canvas.height = 0;
        return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
      };
      
      for (let p = 1; p <= totalPages; p++) {
        const page = await pdf.getPage(p);
        
        // Extract text
        const content = await page.getTextContent();
        const text = content.items
          .filter((item: any) => 'str' in item)
          .map((item: any) => item.str)
          .join(' ');
        pageTexts.push(text);
        pdfPages.push(page);
        
        setProgress(10 + Math.round((p / totalPages) * 30));
        setProgressLabel(`Reading page ${p} of ${totalPages}`);
      }

      // Step 3: Call AI per page (avoid edge function timeout)
      setProcessingStatus('AI is analyzing floor plans…');
      setProgress(45);
      setProgressLabel('AI analyzing…');
      
      const CONCURRENCY = 1; // sequential to avoid multiple oversized in-flight uploads
      const allUnits: Record<string, any> = {};
      let pagesProcessed = 0;
      const encoder = new TextEncoder();

      const IMAGE_TIERS: Array<{ scale: number; quality: number; maxBase64Chars: number }> = [
        { scale: 2.5, quality: 0.65, maxBase64Chars: 2_800_000 },
        { scale: 2.0, quality: 0.55, maxBase64Chars: 2_000_000 },
        { scale: 1.5, quality: 0.5, maxBase64Chars: 1_400_000 },
      ];

      const getPayloadBytes = (payload: unknown) => encoder.encode(JSON.stringify(payload)).length;

      const mergeDetectedUnits = (units: any[], pageIndex: number) => {
        for (const unit of units) {
          const unitNumber = (unit.unitNumber ?? '').trim().toUpperCase();
          if (!unitNumber) continue;

          const floorKey = (unit.detectedFloor ?? '').trim().toUpperCase();
          const bldgKey = (unit.detectedBldg ?? '').trim().toUpperCase();
          const normalizedType = (unit.detectedType ?? '').trim();
          const typeKey = normalizedType && normalizedType !== '?'
            ? normalizedType.toUpperCase()
            : '?';

          const baseKey = `${unitNumber}|${floorKey}|${bldgKey}`;
          const compositeKey = `${baseKey}|${typeKey}`;

          if (typeKey === '?') {
            const hasTyped = Object.keys(allUnits).some(k => k.startsWith(`${baseKey}|`) && !k.endsWith('|?'));
            if (hasTyped) continue;
          } else {
            const unknownKey = `${baseKey}|?`;
            if (allUnits[unknownKey]) delete allUnits[unknownKey];
          }

          const existing = allUnits[compositeKey];
          if (!existing) {
            allUnits[compositeKey] = {
              ...unit,
              unitNumber,
              page: pageIndex + 1,
              confidence: 'high',
              kitchenConfidence: unit.kitchenConfidence ?? 'maybe',
            };
          } else {
            if ((!existing.detectedType || existing.detectedType === '?') && unit.detectedType && unit.detectedType !== '?') {
              existing.detectedType = unit.detectedType;
            }
            if (!existing.detectedFloor && unit.detectedFloor) existing.detectedFloor = unit.detectedFloor;
            if (!existing.detectedBldg && unit.detectedBldg) existing.detectedBldg = unit.detectedBldg;
            if (existing.kitchenConfidence === 'maybe' && unit.kitchenConfidence === 'yes') existing.kitchenConfidence = 'yes';
          }
        }
      };

      const processPage = async (pageIndex: number): Promise<void> => {
        const rawPageText = pageTexts[pageIndex] ?? '';
        const pageText = compactPageTextForAI(rawPageText);
        const pdfPage = pdfPages[pageIndex];

        if (!pageText && !pdfPage) {
          pagesProcessed++;
          return;
        }

        const MAX_RETRIES = 3;
        let pageSucceeded = false;

        for (let tierIdx = 0; tierIdx < IMAGE_TIERS.length; tierIdx++) {
          const tier = IMAGE_TIERS[tierIdx];
          let pageImage: string | undefined;

          try {
            if (pdfPage) {
              pageImage = await renderPageImage(pdfPage, tier.scale, tier.quality);
            }
          } catch {
            console.warn(`Page ${pageIndex + 1}: failed to render at scale ${tier.scale}`);
          }

          const hasImage = !!pageImage && pageImage.length > 100;
          if (hasImage && pageImage.length > tier.maxBase64Chars) {
            console.warn(`Page ${pageIndex + 1}: image too large at scale ${tier.scale} (${Math.round(pageImage.length / 1024)} KB), trying smaller…`);
            continue;
          }

          let shouldTrySmallerTier = false;

          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
              const payload = {
                pageText,
                pageImage: hasImage ? pageImage : undefined,
                pageIndex,
              };

              const payloadBytes = getPayloadBytes(payload);
              if (payloadBytes > MAX_REQUEST_BYTES) {
                shouldTrySmallerTier = true;
                console.warn(`Page ${pageIndex + 1}: payload ${Math.round(payloadBytes / 1024)} KB too large at scale ${tier.scale}, trying smaller…`);
                break;
              }

              const resp = await fetch(EDGE_FUNCTION_URL, {
                method: 'POST',
                headers: EDGE_REQUEST_HEADERS,
                body: JSON.stringify(payload),
              });

              if (resp.status === 429) {
                toast.error('AI rate limit — waiting 30s before retry…');
                await new Promise(r => setTimeout(r, 30000));
                continue;
              }
              if (resp.status === 402) {
                toast.error('AI credits exhausted. Please add credits.');
                pagesProcessed++;
                return;
              }
              if (resp.status === 413) {
                shouldTrySmallerTier = true;
                console.warn(`Page ${pageIndex + 1}: server rejected payload size at scale ${tier.scale}, trying smaller…`);
                break;
              }
              if (resp.status === 503 || resp.status === 500) {
                if (attempt < MAX_RETRIES - 1) {
                  await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
                  continue;
                }
                console.error(`Page ${pageIndex + 1}: AI failed after retries`);
                pagesProcessed++;
                return;
              }
              if (!resp.ok) {
                console.error(`Page ${pageIndex + 1}: AI error ${resp.status}`);
                pagesProcessed++;
                return;
              }

              const data = await resp.json();
              if (data.units && Array.isArray(data.units)) {
                mergeDetectedUnits(data.units, pageIndex);
              }

              pageSucceeded = true;
              break;
            } catch (err) {
              if (attempt < MAX_RETRIES - 1) {
                await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
                continue;
              }
              shouldTrySmallerTier = true;
              console.warn(`Page ${pageIndex + 1}: fetch failed at scale ${tier.scale}, trying smaller…`);
            }
          }

          if (pageSucceeded) break;
          if (!shouldTrySmallerTier) break;
        }

        if (!pageSucceeded) {
          console.warn(`Page ${pageIndex + 1}: all image tiers failed, trying text-only…`);
          const textOnlyPayload = { pageText, pageIndex };
          const payloadBytes = getPayloadBytes(textOnlyPayload);

          if (payloadBytes <= MAX_REQUEST_BYTES) {
            try {
              const resp = await fetch(EDGE_FUNCTION_URL, {
                method: 'POST',
                headers: EDGE_REQUEST_HEADERS,
                body: JSON.stringify(textOnlyPayload),
              });

              if (resp.ok) {
                const data = await resp.json();
                if (data.units && Array.isArray(data.units)) {
                  mergeDetectedUnits(data.units, pageIndex);
                }
              } else {
                console.error(`Page ${pageIndex + 1}: text-only fallback HTTP ${resp.status}`);
              }
            } catch (finalErr) {
              console.error(`Page ${pageIndex + 1}: text-only fallback also failed`, finalErr);
            }
          } else {
            console.error(`Page ${pageIndex + 1}: text-only payload too large (${Math.round(payloadBytes / 1024)} KB)`);
          }
        }

        pagesProcessed++;
        setProgress(45 + Math.round((pagesProcessed / totalPages) * 45));
        setProgressLabel(`AI analyzed page ${pagesProcessed} of ${totalPages}`);
      };

      // Process pages in batches of CONCURRENCY
      for (let i = 0; i < pageTexts.length; i += CONCURRENCY) {
        const batch = [];
        for (let j = i; j < Math.min(i + CONCURRENCY, pageTexts.length); j++) {
          batch.push(processPage(j));
        }
        await Promise.all(batch);
      }
      
      // Normalize building names: unify variations of the same building name
      const normalizeBldgKey = (b: string) =>
        b.toUpperCase().replace(/\b(BLDG|BUILDING|BLD)\b\.?\s*/g, '').replace(/[^A-Z0-9]/g, '').trim();

      const bldgCounts: Record<string, Record<string, number>> = {};
      for (const u of Object.values(allUnits) as any[]) {
        const raw = (u.detectedBldg ?? '').trim();
        if (!raw) continue;
        const key = normalizeBldgKey(raw);
        if (!key) continue;
        if (!bldgCounts[key]) bldgCounts[key] = {};
        bldgCounts[key][raw] = (bldgCounts[key][raw] || 0) + 1;
      }
      // For each normalized key, pick the most common variant
      const bldgCanonical: Record<string, string> = {};
      for (const [key, variants] of Object.entries(bldgCounts)) {
        const best = Object.entries(variants).sort((a, b) => b[1] - a[1])[0][0];
        bldgCanonical[key] = best;
      }
      // Apply canonical building names
      for (const u of Object.values(allUnits) as any[]) {
        const raw = (u.detectedBldg ?? '').trim();
        if (!raw) continue;
        const key = normalizeBldgKey(raw);
        if (key && bldgCanonical[key]) {
          u.detectedBldg = bldgCanonical[key];
        }
      }

      const detectedUnits = Object.values(allUnits).sort((a: any, b: any) =>
        a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })
      );
      
      if (detectedUnits.length > 0) {
        setUsedAI(true);
      } else {
        toast.warning('AI could not detect units on these pages. Check if this is a floor plan PDF.');
      }

      setProgress(95);
      setProgressLabel('Building unit list…');

      const initialRows: UnitRow[] = detectedUnits.map(u => ({
        unitNumber: u.unitNumber,
        type: u.detectedType ?? '',
        detectedType: u.detectedType,
        detectedFloor: u.detectedFloor,
        detectedBldg: u.detectedBldg,
        floor: u.detectedFloor ?? '',
        bldg: u.detectedBldg ?? '',
        selected: u.confidence !== 'low',
        confidence: u.confidence,
        kitchenConfidence: u.kitchenConfidence,
        page: u.page,
        typeOverridden: false,
        floorOverridden: false,
        bldgOverridden: false,
      }));

      const sortedRows = [...initialRows].sort((a, b) => {
        // Floor ascending (numeric first, then alpha)
        const fa = parseFloat(a.floor) || 0;
        const fb = parseFloat(b.floor) || 0;
        if (fa !== fb) return fa - fb;
        const floorCmp = a.floor.localeCompare(b.floor, undefined, { numeric: true });
        if (floorCmp !== 0) return floorCmp;
        // Unit number ascending within same floor
        return a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true });
      });
      setRows(sortedRows);

      // Auto-populate bulkBldg if all units share the same detected building
      const bldgValues = initialRows.map(r => r.bldg).filter(Boolean);
      const uniqueBldgs = Array.from(new Set(bldgValues));
      if (uniqueBldgs.length === 1) {
        setBulkBldg(uniqueBldgs[0]);
      } else if (uniqueBldgs.length === 0) {
        setBulkBldg('');
      }

      setProgress(100);
      setProgressLabel('Done!');
      setStep('review');
    } catch (err) {
      console.error(err);
      setError('Failed to process PDF. The file may be encrypted, scanned (image-only), or unsupported.');
      setStep('upload');
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const toggleAll = (val: boolean) => setRows(r => r.map(row => ({ ...row, selected: val })));
  const setRowType  = (i: number, type: string)  => setRows(r => r.map((x, j) => j === i ? { ...x, type,  typeOverridden: true  } : x));
  const setRowFloor = (i: number, floor: string)  => setRows(r => r.map((x, j) => j === i ? { ...x, floor, floorOverridden: true } : x));
  const setRowBldg  = (i: number, bldg: string)   => setRows(r => r.map((x, j) => j === i ? { ...x, bldg,  bldgOverridden: true  } : x));

  const handleImport = () => {
    const selected = rows.filter(r => r.selected).map(r => ({
      unitNumber: r.unitNumber,
      type: r.type as UnitType,
      floor: r.floor,
      bldg: r.bldg,
    }));
    if (selected.length === 0) return;
    onImport(selected);
  };

  const confidenceBadge = (c: DetectedUnit['confidence']) => {
    const cls = c === 'high'
      ? 'bg-accent text-accent-foreground border border-border'
      : c === 'medium'
      ? 'bg-secondary text-secondary-foreground border border-border'
      : 'bg-muted text-muted-foreground border border-border';
    return <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${cls}`}>{c}</span>;
  };

  const detectedCount = rows.filter(r => r.detectedType !== null).length;
  const selectedCount = rows.filter(r => r.selected).length;
  const BLDG_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-primary" />
            <h2 className="font-bold text-base">Import Units from PDF Plan</h2>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
              <Sparkles size={9} />AI-powered
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {/* STEP: Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload your architectural floor plan PDF. AI will read the plans and detect <strong>all spaces with cabinet or countertop drawings</strong> — including residential units, laundry rooms, community kitchens, pantries, clubhouses, and more.
              </p>

              {/* Drop zone */}
              <div
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                  dragging ? 'border-primary bg-accent' : 'border-border hover:border-primary hover:bg-accent/50'
                }`}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <FileUp size={36} className="mx-auto mb-3 text-muted-foreground" />
                <p className="font-semibold text-sm text-foreground">Drop your architectural PDF here</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
                <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleFile} />
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg border text-sm border-destructive bg-destructive/10 text-destructive">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <p>{error}</p>
                </div>
              )}

              <div className="text-xs text-muted-foreground bg-secondary rounded-lg p-3 border border-border space-y-1">
                <p className="flex items-center gap-1.5"><Sparkles size={11} className="text-primary flex-shrink-0" /><strong>AI reads all plans</strong> — detects residential units, laundry rooms, community kitchens, pantries, clubhouses & more</p>
                <p><strong>Only spaces with cabinet/countertop drawings are imported.</strong> Uncertain ones are marked <span className="font-bold px-1 rounded border" style={{ background: 'hsl(48 96% 89%)', color: 'hsl(32 95% 44%)', borderColor: 'hsl(48 96% 75%)' }}>?</span></p>
                <p><strong>Building #:</strong> assigned manually by you in the review step</p>
                <p className="opacity-70 pt-1">Scanned image-only PDFs may yield no results — add units manually in that case.</p>
              </div>
            </div>
          )}

          {/* STEP: Processing */}
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-10 gap-6 px-6 animate-fade-in">
              {/* Animated icon cluster */}
              <div className="relative flex items-center justify-center w-20 h-20">
                {/* Pulsing ring */}
                <span className="absolute inset-0 rounded-full opacity-20 animate-[ping_1.8s_cubic-bezier(0,0,0.2,1)_infinite]" style={{ background: 'hsl(var(--primary))' }} />
                <span className="absolute inset-2 rounded-full opacity-10 animate-[ping_1.8s_cubic-bezier(0,0,0.2,1)_0.4s_infinite]" style={{ background: 'hsl(var(--primary))' }} />
                {/* Core circle */}
                <span className="absolute inset-3 rounded-full" style={{ background: 'hsl(var(--primary)/0.12)' }} />
                <Loader2 size={32} className="animate-spin relative z-10" style={{ color: 'hsl(var(--primary))' }} />
                <Sparkles size={13} className="absolute top-2 right-2 z-20 animate-pulse" style={{ color: 'hsl(var(--primary))' }} />
              </div>

              {/* Status + Quote */}
              <div className="text-center space-y-2 max-w-xs">
                {progressLabel && (
                  <p className="text-xs text-muted-foreground">{progressLabel}</p>
                )}
                <p
                  className="text-xs italic text-muted-foreground/80 transition-opacity duration-400 mt-2 px-2"
                  style={{ opacity: quoteVisible ? 1 : 0, transition: 'opacity 0.4s ease' }}
                >
                  "{QUOTES[quoteIndex]}"
                </p>
              </div>

              {/* Progress bar */}
              <div className="w-full max-w-sm space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground font-medium">Progress</span>
                  <span className="font-bold tabular-nums" style={{ color: 'hsl(var(--primary))' }}>{progress}%</span>
                </div>
                {/* Track */}
                <div className="relative w-full h-3 rounded-full overflow-hidden" style={{ background: 'hsl(var(--secondary))' }}>
                  {/* Shimmer layer */}
                  <div
                    className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_ease-in-out_infinite]"
                    style={{
                      background: 'linear-gradient(90deg, transparent 0%, hsl(var(--primary)/0.25) 50%, transparent 100%)',
                      width: '60%',
                    }}
                  />
                  {/* Fill */}
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden"
                    style={{
                      width: `${progress}%`,
                      background: 'linear-gradient(90deg, hsl(var(--primary)/0.8) 0%, hsl(var(--primary)) 60%, hsl(var(--primary)/0.9) 100%)',
                    }}
                  >
                    {/* Inner shine */}
                    <span className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 60%)' }} />
                  </div>
                </div>

                {/* Step dots */}
                <div className="flex justify-between items-center pt-1">
                  {['Read PDF', 'Extract pages', 'AI analysis', 'Build list'].map((label, idx) => {
                    const stepThreshold = [5, 30, 65, 95][idx];
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
            </div>
          )}

          {/* STEP: Review */}
          {step === 'review' && result && (
            <div className="space-y-4">
              {/* Summary bar */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary border border-border">
                <CheckCircle size={18} className="text-primary flex-shrink-0" />
                <div className="flex-1 text-sm">
                  <strong className="text-foreground">{rows.length} units detected</strong>
                  <span className="text-muted-foreground ml-2">
                    across {result.totalPages} page{result.totalPages !== 1 ? 's' : ''}
                  </span>
                  {usedAI && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
                      <Sparkles size={10} />AI-analyzed
                    </span>
                  )}
                  {detectedCount > 0 && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-primary bg-accent px-2 py-0.5 rounded-full border border-border">
                      <Tag size={10} />
                      {detectedCount} type{detectedCount !== 1 ? 's' : ''} detected
                    </span>
                  )}
                </div>
              </div>

              {/* Floor-wise unit count summary */}
              {rows.length > 0 && (() => {
                const floorCounts: Record<string, number> = {};
                for (const r of rows) {
                  const fl = r.floor ? (/^\d+$/.test(r.floor) ? `Floor ${r.floor}` : r.floor) : 'Unassigned';
                  floorCounts[fl] = (floorCounts[fl] || 0) + 1;
                }
                const sortedFloors = Object.entries(floorCounts).sort((a, b) => {
                  const na = parseFloat(a[0].replace(/^Floor\s*/i, '')) || 0;
                  const nb = parseFloat(b[0].replace(/^Floor\s*/i, '')) || 0;
                  if (na !== nb) return na - nb;
                  return a[0].localeCompare(b[0], undefined, { numeric: true });
                });
                return (
                  <div className="flex flex-wrap gap-2">
                    {sortedFloors.map(([fl, count]) => (
                      <span key={fl} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-accent border border-border text-foreground">
                        {fl}: <strong>{count}</strong> unit{count !== 1 ? 's' : ''}
                      </span>
                    ))}
                  </div>
                );
              })()}

              {rows.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <AlertCircle size={32} className="mx-auto mb-2 opacity-40" />
                  <p>No units with cabinet/countertop drawings found.</p>
                  <p className="text-xs mt-1">The PDF may be image-only or have no kitchen content. Please add units manually.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={() => toggleAll(true)} className="text-xs text-primary hover:underline">Select all</button>
                    <button onClick={() => toggleAll(false)} className="text-xs text-muted-foreground hover:underline">Deselect all</button>
                    <span className="text-xs text-muted-foreground ml-auto">{selectedCount} of {rows.length} selected</span>
                  </div>

                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="est-table">
                      <thead>
                        <tr>
                          <th className="w-8"></th>
                          <th>Unit #</th>
                          <th>
                            <span className="flex items-center gap-1">
                              Unit Type
                              <span className="text-[10px] font-normal text-muted-foreground">(from PDF / editable)</span>
                            </span>
                          </th>
                          <th>Floor</th>
                          <th>Building #</th>
                          <th>Page</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={i} className={!row.selected ? 'opacity-40' : ''}>
                            <td>
                              <input
                                type="checkbox"
                                checked={row.selected}
                                onChange={e => setRows(r => r.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))}
                                className="cursor-pointer"
                              />
                            </td>
                            <td>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-bold">{row.unitNumber}</span>
                                {row.kitchenConfidence === 'maybe' && (
                                  <span
                                    className="px-1 py-0.5 rounded text-[10px] font-bold border flex-shrink-0"
                                    style={{ background: 'hsl(48 96% 89%)', color: 'hsl(32 95% 44%)', borderColor: 'hsl(48 96% 75%)' }}
                                    title="Uncertain — may or may not have kitchen/cabinet drawings"
                                  >?</span>
                                )}
                              </div>
                            </td>
                            <td>
                              <input
                                className="est-input w-full text-xs"
                                value={row.type}
                                placeholder="Enter type…"
                                onChange={e => setRowType(i, e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                className="est-input text-xs w-20"
                                value={row.floor ? (/^\d+$/.test(row.floor) ? `Floor ${row.floor}` : row.floor) : ''}
                                placeholder="e.g. Floor 1"
                                onChange={e => {
                                  const val = e.target.value.replace(/^Floor\s*/i, '').trim();
                                  setRowFloor(i, val);
                                }}
                              />
                            </td>
                            <td>
                              <input
                                className="est-input text-xs w-24"
                                value={row.bldg}
                                placeholder="e.g. Building A"
                                onChange={e => setRowBldg(i, e.target.value)}
                              />
                            </td>
                            <td className="text-muted-foreground text-xs">{row.page}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <button
                    onClick={() => setShowRawText(!showRawText)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showRawText ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {showRawText ? 'Hide' : 'Show'} extracted text (for troubleshooting)
                  </button>

                  {showRawText && (
                    <pre className="text-xs bg-secondary rounded-lg p-3 border border-border overflow-auto max-h-40 whitespace-pre-wrap text-muted-foreground">
                      {result.rawText.slice(0, 3000)}{result.rawText.length > 3000 ? '\n…(truncated)' : ''}
                    </pre>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center justify-between">
          <button
            onClick={() => { setStep('upload'); setResult(null); setRows([]); setUsedAI(false); }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {step === 'review' ? '← Upload another' : 'Cancel'}
          </button>
          {step === 'review' && (
            <button
              onClick={handleImport}
              disabled={selectedCount === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-md text-sm font-semibold text-white disabled:opacity-50 transition-colors"
              style={{ background: 'hsl(var(--primary))' }}
            >
              <CheckCircle size={14} />
              Add {selectedCount} Unit{selectedCount !== 1 ? 's' : ''} to Project
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
