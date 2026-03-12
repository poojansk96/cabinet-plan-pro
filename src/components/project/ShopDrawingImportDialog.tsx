import { useState, useRef, useCallback, useEffect } from 'react';
import { FileUp, X, Loader2, CheckCircle, AlertCircle, Sparkles, Trash2, FilePlus, FileText } from 'lucide-react';
import type { CabinetType, Room } from '@/types/project';
import { toast } from 'sonner';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-pdf-labels`;

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

export interface LabelRow {
  sku: string;
  type: string;          // Base | Wall | Tall | Vanity | Accessory
  room: string;
  quantity: number;
  selected: boolean;
  sourceFile?: string;
  detectedUnitType?: string;  // AI-detected unit type from the PDF
}

interface Props {
  unitType?: string;
  onImport: (rows: Omit<LabelRow, 'selected' | 'sourceFile'>[], detectedUnitType?: string, typeOrder?: string[]) => void;
  onClose: () => void;
  prefinalPerson?: string;
  speedMode?: 'fast' | 'thorough';
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

const CABINET_TYPES: CabinetType[] = ['Base', 'Wall', 'Tall', 'Vanity'];
const ROOMS: Room[] = ['Kitchen', 'Pantry', 'Laundry', 'Bath', 'Other'];
const ALL_TYPES = [...CABINET_TYPES, 'Accessory'];

async function renderPageToBase64(page: any): Promise<string> {
  const MAX_PX = 4096;
  const baseViewport = page.getViewport({ scale: 1 });
  const longSide = Math.max(baseViewport.width, baseViewport.height);
  const scale = Math.min(4, MAX_PX / longSide);
  const viewport = page.getViewport({ scale });

  // Use OffscreenCanvas when available — it works even when the tab is
  // in the background or minimised, unlike a regular DOM canvas.
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  // Fallback for older browsers
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
}

export default function ShopDrawingImportDialog({ unitType, onImport, onClose, prefinalPerson, speedMode = 'fast' }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<LabelRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [filterSource, setFilterSource] = useState<string>('all');
  const [detectedUnitType, setDetectedUnitType] = useState<string | null>(null);
  const [typeOrder, setTypeOrder] = useState<string[]>([]);
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * QUOTES.length));
  const [personalQuoteIndex, setPersonalQuoteIndex] = useState(() => Math.floor(Math.random() * PERSONAL_QUOTES.length));
  const [quoteVisible, setQuoteVisible] = useState(true);
  const [progress, setProgress] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [processedPages, setProcessedPages] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const addMoreRef = useRef<HTMLInputElement>(null);

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

  const processSingleFile = async (
    file: File,
    pdfjsLib: any,
    onStatus: (msg: string) => void,
    onPageDone?: () => void,
  ): Promise<{ rows: LabelRow[]; detectedType: string | null; typeOrder: string[] }> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const allRows: LabelRow[] = [];
    let detectedType: string | null = null;
    const pageTypeOrder: string[] = [];

    const pageTasks: { p: number; file: File }[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      pageTasks.push({ p, file });
    }

    const processOnePage = async (p: number) => {
      onStatus(`Rendering "${file.name}" page ${p}/${pdf.numPages}…`);
      const page = await pdf.getPage(p);
      const pageImage = await renderPageToBase64(page);

      // Extract text layer from the PDF page for cross-referencing
      let pageText = '';
      try {
        const textContent = await page.getTextContent();
        pageText = textContent.items
          .map((item: any) => item.str)
          .filter((s: string) => s.trim().length > 0)
          .join(' ');
      } catch (e) {
        console.warn(`Text extraction failed for page ${p}:`, e);
      }

      onStatus(`AI reading labels on "${file.name}" page ${p}/${pdf.numPages}…`);

      // Retry helper: try up to 2 times with a 5-minute timeout each attempt
      const fetchWithRetry = async (body: string, attempts = 3): Promise<Response> => {
        for (let attempt = 1; attempt <= attempts; attempt++) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min
          try {
            if (attempt > 1) {
              onStatus(`AI reading labels on "${file.name}" page ${p}/${pdf.numPages} (retry ${attempt - 1})…`);
            }
            const res = await fetch(EDGE_FUNCTION_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            // Retry on 503 (model unavailable) and 500
            if ((res.status === 503 || res.status === 500) && attempt < attempts) {
              console.warn(`Page ${p} attempt ${attempt}: AI unavailable (${res.status}), retrying in ${3 * attempt}s…`);
              await new Promise(r => setTimeout(r, 3000 * attempt));
              continue;
            }
            return res;
          } catch (err: any) {
            clearTimeout(timeoutId);
            if (attempt === attempts) throw err;
            console.warn(`Page ${p} attempt ${attempt} failed (${err.message}), retrying…`);
            await new Promise(r => setTimeout(r, 2000)); // wait 2s before retry
          }
        }
        throw new Error('All attempts failed');
      };

      const aiResponse = await fetchWithRetry(JSON.stringify({ pageImage, unitType, pageText, speedMode }));

      if (!aiResponse.ok) {
        const status = aiResponse.status;
        if (status === 429) throw new Error('rate_limit');
        if (status === 402) throw new Error('credits');
        throw new Error(`failed (${status})`);
      }

      const data = await aiResponse.json();
      if (data.error === 'rate_limit') throw new Error('rate_limit');
      if (data.error === 'credits') throw new Error('credits');

      return data;
    };

    const CONCURRENCY = 1; // Sequential to avoid Gemini API rate limits (multi-pass = multiple calls per page)
    for (let i = 0; i < pageTasks.length; i += CONCURRENCY) {
      const batch = pageTasks.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(t => processOnePage(t.p)));

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const { p } = batch[j];

        if (result.status === 'fulfilled') {
          const data = result.value;
          // Capture detected unit type from ALL pages — even those with 0 items
          // Common areas (Laundry, Restroom, etc.) may have no cabinets but still need their type tracked
          if (data.unitTypeName) {
            if (!detectedType) detectedType = data.unitTypeName;
            const normType = String(data.unitTypeName).trim();
            if (normType && !pageTypeOrder.includes(normType)) {
              pageTypeOrder.push(normType);
            }
          }

          const pageRows = (data.items ?? []).map((c: any) => ({
            sku: c.sku,
            type: c.type,
            room: c.room,
            quantity: c.quantity,
            selected: true,
            sourceFile: file.name,
            detectedUnitType: data.unitTypeName ? data.unitTypeName : undefined,
          }));
          allRows.push(...pageRows);
        } else {
          console.warn(`Page ${p} of "${file.name}" failed:`, result.reason?.message);
          if (result.reason?.message === 'rate_limit') throw new Error('rate_limit');
          if (result.reason?.message === 'credits') throw new Error('credits');
        }
        onPageDone?.();
      }
    }
    return { rows: allRows, detectedType, typeOrder: pageTypeOrder };
  };

  const mergeRows = (incoming: LabelRow[], existing: LabelRow[] = []): LabelRow[] => {
    // For items within the SAME unit type: use MAX qty across pages (same cabinet seen on multiple pages).
    // For items across DIFFERENT unit types: keep separate (different unit types = different physical units).
    // Corner cabinets (LS/LSB) always use MAX.
    const merged: Record<string, LabelRow> = {};
    const isCornerLazySusan = (sku: string) => /^(LS|LSB)\d+/i.test(sku);

    for (const r of [...existing, ...incoming]) {
      const normSku = r.sku.toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '')
        .replace(/B?-\d+D$/i, ''); // Strip door-config suffix (e.g. -1D, B-1D)
      // Include detectedUnitType in key so quantities stay separated per type
      const unitTypeKey = (r as any).detectedUnitType || '__none__';
      const key = `${normSku}__${r.room}__${unitTypeKey}`;
      if (merged[key]) {
        // Use MAX instead of SUM — multiple pages of the same unit type show the SAME cabinets
        merged[key].quantity = Math.max(merged[key].quantity, r.quantity);
      } else {
        merged[key] = { ...r, sku: normSku };
      }
    }
    // Extract wall cabinet height from SKU like W3024 → height 24, W1542 → height 42
    const wallHeight = (sku: string): number => {
      const m = sku.match(/^W\D*(\d{3,5})/i);
      if (!m) return 999;
      const digits = m[1]; // e.g. "3024" or "1542"
      if (digits.length >= 4) return parseInt(digits.slice(-2), 10); // last 2 digits = height
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
      // Within wall cabinets, sort by height (smaller first)
      if (a.type?.toLowerCase() === 'wall' && b.type?.toLowerCase() === 'wall') {
        const ha = wallHeight(a.sku);
        const hb = wallHeight(b.sku);
        if (ha !== hb) return ha - hb;
      }
      return a.sku.localeCompare(b.sku, undefined, { numeric: true });
    });
  };

  const doProcessFiles = async (files: File[]) => {
    const nonPdfs = files.filter(f => !f.type.includes('pdf'));
    if (nonPdfs.length) { setError(`Only PDF files supported. Remove: ${nonPdfs.map(f => f.name).join(', ')}`); return; }
    setError(null);
    setStep('processing');
    setProgress(5);
    setProcessedPages(0);

    try {
      setProcessingStatus('Loading PDF library…');
      const pdfjsLib = (await import('pdfjs-dist')) as any;
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

      // Count total pages across all files for progress
      let totalPagesCount = 0;
      for (const file of files) {
        const ab = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
        totalPagesCount += pdf.numPages;
      }
      setTotalPages(totalPagesCount);
      setProgress(10);

      let pagesProcessed = 0;
      let allRows: LabelRow[] = [];
      let firstDetectedType: string | null = null;
      const collectedTypeOrder: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setProcessingStatus(`Processing file ${i + 1} of ${files.length}: "${files[i].name}"…`);
        try {
          const result = await processSingleFile(files[i], pdfjsLib, setProcessingStatus, () => {
            pagesProcessed++;
            setProcessedPages(pagesProcessed);
            setProgress(10 + Math.round((pagesProcessed / totalPagesCount) * 85));
          });
          allRows = mergeRows(result.rows, allRows);
          if (!firstDetectedType && result.detectedType) firstDetectedType = result.detectedType;
          // Collect type order from each file, preserving page order across files
          for (const t of result.typeOrder) {
            if (!collectedTypeOrder.includes(t)) collectedTypeOrder.push(t);
          }
        } catch (err: any) {
          if (err.message === 'rate_limit') { toast.error('AI rate limit reached. Try again shortly.'); setStep('upload'); return; }
          if (err.message === 'credits') { toast.error('AI credits exhausted.'); setStep('upload'); return; }
          toast.error(`Skipped "${files[i].name}": ${err.message}`);
        }
      }

      if (allRows.length === 0 && collectedTypeOrder.length === 0) {
        setError('No cabinet labels or unit type names found in any uploaded file.');
        setStep('upload');
        return;
      }
      setProgress(100);
      setRows(allRows);
      if (firstDetectedType) setDetectedUnitType(firstDetectedType);
      setTypeOrder(collectedTypeOrder);
      setFilterSource('all');
      setStep('review');
    } catch (err) {
      console.error(err);
      setError('Failed to process files. Please try again.');
      setStep('upload');
    }
  };

  // Wrap in a Web Lock so the browser won't freeze/discard this tab while processing
  const processFiles = async (files: File[]) => {
    if (navigator.locks) {
      await navigator.locks.request('shop-drawing-processing', () => doProcessFiles(files));
    } else {
      await doProcessFiles(files);
    }
  };

  const doAddMoreFiles = async (files: File[]) => {
    setStep('processing');
    try {
      const pdfjsLib = (await import('pdfjs-dist')) as any;
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      let newRows: LabelRow[] = [];
      for (const file of files) {
        setProcessingStatus(`Processing "${file.name}"…`);
        try {
          const result = await processSingleFile(file, pdfjsLib, setProcessingStatus);
          newRows = mergeRows(result.rows, newRows);
          if (result.detectedType && !detectedUnitType) setDetectedUnitType(result.detectedType);
        } catch (err: any) { toast.error(`Skipped "${file.name}": ${err.message}`); }
      }
      setRows(prev => mergeRows(newRows, prev));
      setStep('review');
    } catch (err) {
      toast.error('Failed to process additional files.');
      setStep('review');
    }
  };

  const addMoreFiles = async (files: File[]) => {
    if (navigator.locks) {
      await navigator.locks.request('shop-drawing-processing', () => doAddMoreFiles(files));
    } else {
      await doAddMoreFiles(files);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.includes('pdf'));
    if (files.length) { setQueuedFiles(files); processFiles(files); }
  }, [unitType]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) { setQueuedFiles(files); processFiles(files); }
    e.target.value = '';
  };

  const handleAddMore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f => f.type.includes('pdf'));
    if (files.length) addMoreFiles(files);
    e.target.value = '';
  };

  const toggleAll = (val: boolean) => setRows(r => r.map(x => ({ ...x, selected: val })));
  const updateRow = (i: number, patch: Partial<LabelRow>) => setRows(r => r.map((x, j) => j === i ? { ...x, ...patch } : x));
  const deleteRow = (i: number) => setRows(r => r.filter((_, j) => j !== i));

  const handleImport = () => {
    const selected = rows.filter(r => r.selected).map(({ selected: _, sourceFile: __, ...rest }) => rest);
    if (selected.length === 0) return;
    onImport(selected, detectedUnitType ?? undefined, typeOrder.length > 0 ? typeOrder : undefined);
  };

  const sourceFiles = Array.from(new Set(rows.map(r => r.sourceFile ?? 'Unknown')));
  const visibleRows = filterSource === 'all' ? rows : rows.filter(r => r.sourceFile === filterSource);
  const selectedCount = rows.filter(r => r.selected).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-border">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileUp size={18} className="text-primary" />
            <h2 className="font-bold text-base">Import 2020 Shop Drawings</h2>
            {unitType && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-accent text-accent-foreground border border-border">
                {unitType}
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
              <Sparkles size={9} /> AI Label Reader
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-auto p-5">

          {/* Upload step */}
          {step === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload your <strong>2020 Design shop drawing PDFs</strong>. The AI reads each page and extracts cabinet and accessory labels exactly as printed — no measurement or scale required.
              </p>

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
                <p className="font-semibold text-sm text-foreground">Drop 2020 shop drawing PDFs here</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse — multiple files supported</p>
                <input ref={fileRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleFileSelect} />
              </div>

              {queuedFiles.length > 0 && (
                <div className="space-y-1">
                  {queuedFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <FileText size={12} className="text-primary flex-shrink-0" />
                      <span className="truncate">{f.name}</span>
                      <span className="ml-auto opacity-60">{(f.size / 1024).toFixed(0)} KB</span>
                    </div>
                  ))}
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg border text-sm border-destructive bg-destructive/10 text-destructive">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <p>{error}</p>
                </div>
              )}

              <div className="text-xs text-muted-foreground bg-secondary rounded-lg p-3 border border-border space-y-1">
                <p className="flex items-center gap-1.5">
                  <Sparkles size={11} className="text-primary flex-shrink-0" />
                  <strong>AI Label Reader:</strong> Each page is rendered as an image and scanned for cabinet (Base, Wall, Tall, Vanity) and accessory labels (fillers, toe kick, crown, panels, hardware). Labels are read exactly as printed — no guessing or measuring.
                </p>
              </div>
            </div>
          )}

          {/* Processing step */}
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
                <p
                  className="text-xs italic text-muted-foreground/80 transition-opacity duration-400 mt-2 px-2"
                  style={{ opacity: quoteVisible ? 1 : 0, transition: 'opacity 0.4s ease' }}
                >
                  "{QUOTES[quoteIndex]}"
                </p>
                {prefinalPerson && (
                  <p
                    className="text-xs font-medium text-primary transition-opacity duration-400 px-2"
                    style={{ opacity: quoteVisible ? 1 : 0, transition: 'opacity 0.4s ease' }}
                  >
                    {PERSONAL_QUOTES[personalQuoteIndex](prefinalPerson)}
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
            </div>
          )}

          {/* Review step */}
          {step === 'review' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary border border-border">
                <CheckCircle size={18} className="text-primary flex-shrink-0" />
                <div className="flex-1 text-sm">
                  <strong className="text-foreground">{rows.length} label{rows.length !== 1 ? 's' : ''} extracted</strong>
                  {sourceFiles.length > 1 && <span className="text-muted-foreground ml-2">from {sourceFiles.length} files</span>}
                  <span className="text-muted-foreground ml-2">— review and edit before importing</span>
                </div>
                <button
                  onClick={() => addMoreRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <FilePlus size={13} /> Add more PDFs
                </button>
                <input ref={addMoreRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleAddMore} />
              </div>

              {sourceFiles.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setFilterSource('all')} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterSource === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground border border-border hover:text-foreground'}`}>
                    All ({rows.length})
                  </button>
                  {sourceFiles.map(src => (
                    <button key={src} onClick={() => setFilterSource(src)} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${filterSource === src ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground border border-border hover:text-foreground'}`}>
                      <FileText size={10} />
                      {src.replace(/\.pdf$/i, '')} ({rows.filter(r => r.sourceFile === src).length})
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button onClick={() => toggleAll(true)} className="text-xs text-primary hover:underline">Select all</button>
                <button onClick={() => toggleAll(false)} className="text-xs text-muted-foreground hover:underline">Deselect all</button>
                <span className="text-xs text-muted-foreground ml-auto">{selectedCount} of {rows.length} selected</span>
              </div>

              <div className="border border-border rounded-lg overflow-hidden overflow-x-auto">
                <table className="est-table" style={{ whiteSpace: 'nowrap', minWidth: '560px' }}>
                  <thead>
                    <tr>
                      <th className="w-8"></th>
                      <th>SKU / Label</th>
                      <th>Type</th>
                      <th>Room</th>
                      <th className="text-right">Qty</th>
                      {sourceFiles.length > 1 && <th>File</th>}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, _) => {
                      const globalIdx = rows.indexOf(row);
                      return (
                        <tr key={globalIdx} className={!row.selected ? 'opacity-40' : ''}>
                          <td>
                            <input type="checkbox" checked={row.selected} onChange={e => updateRow(globalIdx, { selected: e.target.checked })} className="cursor-pointer" />
                          </td>
                          <td>
                            <input className="est-input font-mono w-28 text-xs" value={row.sku} onChange={e => updateRow(globalIdx, { sku: e.target.value.toUpperCase() })} />
                          </td>
                          <td>
                            <select className="est-input text-xs w-24" value={row.type} onChange={e => updateRow(globalIdx, { type: e.target.value })}>
                              {ALL_TYPES.map(t => <option key={t}>{t}</option>)}
                            </select>
                          </td>
                          <td>
                            <select className="est-input text-xs w-24" value={row.room} onChange={e => updateRow(globalIdx, { room: e.target.value })}>
                              {ROOMS.map(r => <option key={r}>{r}</option>)}
                            </select>
                          </td>
                          <td>
                            <input type="number" className="est-input text-xs w-14 text-right" value={row.quantity} min={1} onChange={e => updateRow(globalIdx, { quantity: Math.max(1, +e.target.value) })} />
                          </td>
                          {sourceFiles.length > 1 && (
                            <td><span className="text-[10px] text-muted-foreground truncate max-w-[100px] block">{(row.sourceFile ?? '').replace(/\.pdf$/i, '')}</span></td>
                          )}
                          <td>
                            <button onClick={() => deleteRow(globalIdx)} className="p-1 hover:text-destructive text-muted-foreground" title="Remove">
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3">
          <button onClick={() => { setStep('upload'); setRows([]); setQueuedFiles([]); setError(null); }} className="text-xs text-muted-foreground hover:text-foreground">
            ← Start over
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded text-xs font-medium border border-border text-muted-foreground hover:bg-secondary">
              Cancel
            </button>
            {step === 'review' && (
              <button
                onClick={handleImport}
                disabled={selectedCount === 0}
                className="px-4 py-2 rounded text-xs font-medium text-white disabled:opacity-50"
                style={{ background: 'hsl(var(--primary))' }}
              >
                Import {selectedCount} item{selectedCount !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
