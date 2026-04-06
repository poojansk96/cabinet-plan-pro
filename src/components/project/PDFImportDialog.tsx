import { useState, useRef, useCallback, useEffect } from 'react';
import { FileUp, X, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp, FileText, Tag, Sparkles } from 'lucide-react';
import type { DetectedUnit, PDFExtractionResult } from '@/lib/pdfExtractor';
import type { UnitType } from '@/types/project';
import { toast } from 'sonner';
import { startExtraction, useExtractionJobByType, clearExtractionJob } from '@/hooks/useExtractionStore';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-pdf-units`;

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
  takeoffPerson?: string;
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

export default function PDFImportDialog({ onImport, onClose, takeoffPerson }: Props) {
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * QUOTES.length));
  const [personalQuoteIndex, setPersonalQuoteIndex] = useState(() => Math.floor(Math.random() * PERSONAL_QUOTES.length));
  const [step, setStep] = useState<Step>('upload');
  const [result, setResult] = useState<PDFExtractionResult | null>(null);
  const [rows, setRows] = useState<UnitRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showRawText, setShowRawText] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('Extracting text from PDF…');
  const [usedAI, setUsedAI] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [bulkBldg, setBulkBldg] = useState('');
  const [quoteVisible, setQuoteVisible] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const bgPickedUpRef = useRef(false);

  // ── Pick up background job results ──
  const bgJob = useExtractionJobByType('takeoff-unit');

  useEffect(() => {
    if (!bgJob || bgPickedUpRef.current) return;
    if (bgJob.status === 'processing') {
      setStep('processing');
      setProgress(bgJob.progress);
      setProgressLabel(bgJob.statusText);
    } else if (bgJob.status === 'done') {
      bgPickedUpRef.current = true;
      const r = bgJob.results as { rows: UnitRow[]; result: PDFExtractionResult | null; usedAI: boolean; bulkBldg: string } | null;
      if (r) {
        setRows(r.rows);
        setResult(r.result);
        setUsedAI(r.usedAI);
        if (r.bulkBldg) setBulkBldg(r.bulkBldg);
      }
      setProgress(100);
      setStep('review');
      clearExtractionJob('takeoff-unit');
    } else if (bgJob.status === 'error') {
      bgPickedUpRef.current = true;
      setError(bgJob.error || 'Failed');
      setStep('upload');
      clearExtractionJob('takeoff-unit');
    }
  }, [bgJob]);

  useEffect(() => {
    if (!bgJob || bgJob.status !== 'processing' || bgPickedUpRef.current) return;
    setProgress(bgJob.progress);
    setProgressLabel(bgJob.statusText);
  }, [bgJob?.progress, bgJob?.statusText]);

  // Rotate quote every 4 seconds during processing
  useEffect(() => {
    if (step !== 'processing') return;
    const interval = setInterval(() => {
      setQuoteVisible(false);
      setTimeout(() => {
        setQuoteIndex(i => (i + 1) % QUOTES.length);
        setPersonalQuoteIndex(i => (i + 1) % PERSONAL_QUOTES.length);
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
      const pageImages: string[] = [];
      
      for (let p = 1; p <= totalPages; p++) {
        const page = await pdf.getPage(p);
        
        // Extract text
        const content = await page.getTextContent();
        const text = content.items
          .filter((item: any) => 'str' in item)
          .map((item: any) => item.str)
          .join(' ');
        pageTexts.push(text);
        
        // Render page to image
        const scale = 2;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        let imageDataUrl = canvas.toDataURL('image/jpeg', 0.65);
        
        // Adaptive downscale if image is too large (>3MB base64)
        const base64Length = imageDataUrl.length - imageDataUrl.indexOf(',') - 1;
        if (base64Length > 3 * 1024 * 1024) {
          const lowerScale = 1.5;
          const lowerViewport = page.getViewport({ scale: lowerScale });
          canvas.width = lowerViewport.width;
          canvas.height = lowerViewport.height;
          await page.render({ canvasContext: ctx, viewport: lowerViewport }).promise;
          imageDataUrl = canvas.toDataURL('image/jpeg', 0.5);
        }
        pageImages.push(imageDataUrl);
        canvas.width = 0;
        canvas.height = 0;
        
        setProgress(10 + Math.round((p / totalPages) * 30));
        setProgressLabel(`Reading page ${p} of ${totalPages}`);
      }

      // Step 3: Call AI per page (avoid edge function timeout)
      setProcessingStatus('AI is analyzing floor plans…');
      setProgress(45);
      setProgressLabel('AI analyzing…');
      
      const CONCURRENCY = 2; // Reduced from 3 since images are larger
      const allUnits = new Map<string, any>();
      let pagesProcessed = 0;
      
      const processPage = async (pageIndex: number): Promise<void> => {
        const pageText = pageTexts[pageIndex];
        const pageImage = pageImages[pageIndex];
        // Skip only if no text AND no image
        if ((!pageText || pageText.trim().length < 20) && !pageImage) {
          pagesProcessed++;
          return;
        }
        
        const MAX_RETRIES = 3;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            const resp = await fetch(EDGE_FUNCTION_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              },
              body: JSON.stringify({ pageText: pageText || '', pageImage, pageIndex }),
            });
            
            if (resp.status === 429) {
              toast.error('AI rate limit — waiting 30s before retry…');
              await new Promise(r => setTimeout(r, 30000));
              continue;
            }
            if (resp.status === 402) {
              toast.error('AI credits exhausted. Please add credits.');
              return;
            }
            if (resp.status === 503 || resp.status === 500) {
              if (attempt < MAX_RETRIES - 1) {
                await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
                continue;
              }
              console.error(`Page ${pageIndex + 1}: AI failed after retries`);
              return;
            }
            if (!resp.ok) {
              console.error(`Page ${pageIndex + 1}: AI error ${resp.status}`);
              return;
            }
            
            const data = await resp.json();
            if (data.units && Array.isArray(data.units)) {
              const normalizeUnitKey = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
              const floorRank = (value: string) => {
                const n = parseFloat(String(value || '').replace(/^Floor\s*/i, ''));
                return Number.isNaN(n) ? Infinity : n;
              };

              for (const unit of data.units) {
                const unitNumber = String(unit.unitNumber ?? '').trim().toUpperCase();
                if (!unitNumber) continue;

                // Takeoff Unit Count rule: unit number is unique within a building.
                // Ignore type differences and keep only ONE row on the lowest floor.
                const bldgKey = normalizeUnitKey(String(unit.detectedBldg ?? ''));
                const key = `${bldgKey}__${normalizeUnitKey(unitNumber)}`;
                const candidate = {
                  ...unit,
                  unitNumber,
                  page: pageIndex + 1,
                  confidence: 'high',
                  kitchenConfidence: unit.kitchenConfidence ?? 'maybe',
                };

                const existing = allUnits.get(key);
                if (!existing) {
                  allUnits.set(key, candidate);
                  continue;
                }

                const existingFloor = floorRank(existing.detectedFloor ?? '');
                const candidateFloor = floorRank(candidate.detectedFloor ?? '');
                const existingHasType = !!String(existing.detectedType ?? '').trim() && String(existing.detectedType).trim() !== '?';
                const candidateHasType = !!String(candidate.detectedType ?? '').trim() && String(candidate.detectedType).trim() !== '?';

                if (
                  candidateFloor < existingFloor ||
                  (candidateFloor === existingFloor && candidateHasType && !existingHasType)
                ) {
                  allUnits.set(key, candidate);
                }
              }
            }
            break; // success
          } catch (err) {
            if (attempt < MAX_RETRIES - 1) {
              await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
              continue;
            }
            console.error(`Page ${pageIndex + 1} error:`, err);
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
      for (const u of Array.from(allUnits.values()) as any[]) {
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
      for (const u of Array.from(allUnits.values()) as any[]) {
        const raw = (u.detectedBldg ?? '').trim();
        if (!raw) continue;
        const key = normalizeBldgKey(raw);
        if (key && bldgCanonical[key]) {
          u.detectedBldg = bldgCanonical[key];
        }
      }

      const detectedUnits = Array.from(allUnits.values()).sort((a: any, b: any) =>
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
              <div className="text-center space-y-1 max-w-xs">
                {progressLabel && (
                  <p className="text-xs text-muted-foreground">{progressLabel}</p>
                )}
                <p
                  className="text-xs italic text-muted-foreground/80 transition-opacity duration-400 mt-2 px-2"
                  style={{ opacity: quoteVisible ? 1 : 0, transition: 'opacity 0.4s ease' }}
                >
                  "{QUOTES[quoteIndex]}"
                </p>
                {takeoffPerson && (
                  <p
                    className="text-xs font-medium text-primary transition-opacity duration-400 px-2"
                    style={{ opacity: quoteVisible ? 1 : 0, transition: 'opacity 0.4s ease' }}
                  >
                    {PERSONAL_QUOTES[personalQuoteIndex](takeoffPerson)}
                  </p>
                )}
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
