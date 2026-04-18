import { useState, useRef, useCallback, useEffect } from 'react';
import { FileUp, X, Loader2, CheckCircle, AlertCircle, Sparkles, Trash2, FileText, Search, Users, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import type { LabelRow } from './ShopDrawingImportDialog';
import { startExtraction, useExtractionJobByType, clearExtractionJob } from '@/hooks/useExtractionStore';

const UNIT_EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-pdf-unit-types`;
const CABINET_EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-pdf-labels`;

interface UnitRow {
  unitNumber: string;
  unitType: string;
  bldg: string;
  floor: string;
  selected: boolean;
  conflict?: string;
}

interface CabinetRow {
  sku: string;
  type: string;
  room: string;
  quantity: number;
  selected: boolean;
  detectedUnitType?: string;
}

interface Props {
  onImport: (
    unitRows: { unitNumber: string; unitType: string; bldg: string }[],
    cabinetRows: Omit<LabelRow, 'selected' | 'sourceFile'>[],
    typeOrder?: string[]
  ) => void;
  onClose: () => void;
}

type Step = 'upload' | 'processing' | 'review';

const QUOTES = [
  "Measure twice, cut once.",
  "Great design is born from great planning.",
  "Every detail matters — especially in kitchens.",
  "Precision today saves rework tomorrow.",
  "Good plans shape good results.",
  "Craftsmanship starts with accurate takeoffs.",
  "Excellence is in the details.",
  "Build smart. Build right. Build once.",
  "Your project, perfectly counted.",
  "Behind every great build is a great plan.",
];

async function renderPageToBase64(page: any, maxPx = 4096, quality = 0.95): Promise<string> {
  const baseViewport = page.getViewport({ scale: 1 });
  const longSide = Math.max(baseViewport.width, baseViewport.height);
  const scale = Math.min(5, maxPx / longSide);
  const viewport = page.getViewport({ scale });
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', quality).split(',')[1];
}

async function fetchWithRetry(url: string, body: string, attempts = 3): Promise<Response> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5 * 60 * 1000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      clearTimeout(tid);
      if ((res.status === 503 || res.status === 500) && attempt < attempts) {
        await new Promise(r => setTimeout(r, 3000 * attempt));
        continue;
      }
      return res;
    } catch (err: any) {
      clearTimeout(tid);
      if (attempt === attempts) throw err;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('All attempts failed');
}

export default function CombinedImportDialog({ onImport, onClose }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [unitRows, setUnitRows] = useState<UnitRow[]>([]);
  const [cabinetRows, setCabinetRows] = useState<CabinetRow[]>([]);
  const [typeOrder, setTypeOrder] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');
  const [reviewTab, setReviewTab] = useState<'units' | 'cabinets'>('units');
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * QUOTES.length));
  const [quoteVisible, setQuoteVisible] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const bgPickedUpRef = useRef(false);

  // ── Pick up background job results (so closing dialog mid-run keeps it going) ──
  const bgJob = useExtractionJobByType('prefinal-combined');

  useEffect(() => {
    if (!bgJob || bgPickedUpRef.current) return;
    if (bgJob.status === 'processing') {
      setStep('processing');
      setProgress(bgJob.progress);
      setProcessingStatus(bgJob.statusText);
    } else if (bgJob.status === 'done') {
      bgPickedUpRef.current = true;
      const r = bgJob.results as { unitRows: UnitRow[]; cabinetRows: CabinetRow[]; typeOrder: string[] } | null;
      if (r) {
        setUnitRows(r.unitRows);
        setCabinetRows(r.cabinetRows);
        setTypeOrder(r.typeOrder ?? []);
        setReviewTab(r.unitRows.length > 0 ? 'units' : 'cabinets');
      }
      setProgress(100);
      setStep('review');
      clearExtractionJob('prefinal-combined');
    } else if (bgJob.status === 'error') {
      bgPickedUpRef.current = true;
      setError(bgJob.error || 'Failed to process files. Please try again.');
      setStep('upload');
      clearExtractionJob('prefinal-combined');
    }
  }, [bgJob]);

  useEffect(() => {
    if (!bgJob || bgJob.status !== 'processing' || bgPickedUpRef.current) return;
    setProgress(bgJob.progress);
    setProcessingStatus(bgJob.statusText);
  }, [bgJob?.progress, bgJob?.statusText]);

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

  const processFiles = async (files: File[]) => {
    const nonPdfs = files.filter(f => !f.type.includes('pdf'));
    if (nonPdfs.length) { setError('Only PDF files supported.'); return; }
    setError(null);
    setStep('processing');
    setProgress(5);
    setProcessingStatus('Loading PDF library…');
    bgPickedUpRef.current = false;

    startExtraction('prefinal-combined', files.map(f => f.name), async (update) => {
      let aborted: { reason: string } | null = null;
      try {
        update({ statusText: 'Loading PDF library…', progress: 5 });
        const pdfjsLib = (await import('pdfjs-dist')) as any;
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

        // Load all PDFs and count pages
        const pdfs: { file: File; pdf: any }[] = [];
        let totalPages = 0;
        for (const file of files) {
          const ab = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
          pdfs.push({ file, pdf });
          totalPages += pdf.numPages;
        }
        update({ progress: 10, totalPages });

        const totalWork = totalPages * 2; // unit pass + cabinet pass
        let workDone = 0;

        // ── PASS 1: Unit extraction ──
        update({ statusText: 'Extracting unit types…' });
        const unitSightings = new Map<string, { unitNumber: string; unitType: string; bldg: string; floor: string; pages: { page: number; file: string; unitType: string; bldg: string; floor: string }[] }>();
        const pageOrderTypes: string[] = []; // unit types in PDF page order (first-seen wins)
        const seenTypes = new Set<string>();
        const normTypeKey = (v: string) => v.toUpperCase().replace(/\s+/g, '').trim();

        for (const { file, pdf } of pdfs) {
          for (let p = 1; p <= pdf.numPages; p++) {
            update({ statusText: `Scanning units: "${file.name}" page ${p}/${pdf.numPages}…` });
            const page = await pdf.getPage(p);
            const pageImage = await renderPageToBase64(page);

            try {
              const res = await fetchWithRetry(UNIT_EDGE_URL, JSON.stringify({ pageImage }));
              if (res.ok) {
                const data = await res.json();
                if (data.error === 'rate_limit') { aborted = { reason: 'AI rate limit reached.' }; break; }
                if (data.error === 'credits') { aborted = { reason: 'AI credits exhausted.' }; break; }
                const pageUnits = data.units ?? [];
                const keyPart = (v: string) => v.toUpperCase().replace(/\s+/g, '').trim();
                for (const u of pageUnits) {
                  const num = String(u.unitNumber ?? '').trim();
                  const type = String(u.unitType ?? '').trim();
                  const bldg = String(u.bldg ?? '').trim();
                  const floor = String(u.floor ?? '').trim();
                  if (!num || !type) continue;
                  // Track type by PDF page order
                  const tKey = normTypeKey(type);
                  if (tKey && !seenTypes.has(tKey)) {
                    seenTypes.add(tKey);
                    pageOrderTypes.push(type);
                  }
                  const key = `${keyPart(num)}|${keyPart(bldg)}|${keyPart(floor)}`;
                  const existing = unitSightings.get(key);
                  const sighting = { page: p, file: file.name, unitType: type, bldg, floor };
                  if (existing) {
                    existing.pages.push(sighting);
                  } else {
                    unitSightings.set(key, { unitNumber: num, unitType: type, bldg, floor, pages: [sighting] });
                  }
                }
              } else if (res.status === 429) { aborted = { reason: 'AI rate limit reached.' }; break; }
                else if (res.status === 402) { aborted = { reason: 'AI credits exhausted.' }; break; }
            } catch { /* skip page */ }

            workDone++;
            update({ progress: 10 + Math.round((workDone / totalWork) * 85), processedPages: workDone });
          }
          if (aborted) break;
        }

        if (aborted) {
          toast.error(aborted.reason);
          update({ status: 'error', error: aborted.reason });
          return;
        }

        const finalUnitRows: UnitRow[] = [];
        for (const entry of unitSightings.values()) {
          const primary = entry.pages[entry.pages.length - 1];
          let conflict: string | undefined;
          const uniqueTypes = [...new Set(entry.pages.map(p => p.unitType).filter(Boolean))];
          if (uniqueTypes.length > 1) {
            conflict = `Type: ${uniqueTypes.map(t => `"${t}"`).join(' vs ')}`;
          }
          finalUnitRows.push({
            unitNumber: entry.unitNumber,
            unitType: primary.unitType,
            bldg: primary.bldg,
            floor: primary.floor,
            selected: true,
            conflict,
          });
        }
        finalUnitRows.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));

        // ── PASS 2: Cabinet extraction ──
        update({ statusText: 'Extracting cabinet labels…' });
        const isCornerLazySusan = (sku: string) => /^(LS|LSB)\d+/i.test(sku);
        const cabinetMerged: Record<string, CabinetRow> = {};

        for (const { file, pdf } of pdfs) {
          for (let p = 1; p <= pdf.numPages; p++) {
            update({ statusText: `Scanning cabinets: "${file.name}" page ${p}/${pdf.numPages}…` });
            const page = await pdf.getPage(p);
            const pageImage = await renderPageToBase64(page);

            try {
              const res = await fetchWithRetry(CABINET_EDGE_URL, JSON.stringify({ pageImage }));
              if (res.ok) {
                const data = await res.json();
                if (data.error === 'rate_limit') { aborted = { reason: 'AI rate limit reached.' }; break; }
                if (data.error === 'credits') { aborted = { reason: 'AI credits exhausted.' }; break; }
                const items = data.items ?? [];
                const detectedType = data.unitTypeName || undefined;
                if (detectedType) {
                  const tKey = normTypeKey(detectedType);
                  if (tKey && !seenTypes.has(tKey)) {
                    seenTypes.add(tKey);
                    pageOrderTypes.push(detectedType);
                  }
                }
                for (const item of items) {
                  const normSku = (item.sku || '').toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
                  const unitTypeKey = detectedType || '__none__';
                  const key = `${normSku}__${item.room}__${unitTypeKey}`;
                  if (cabinetMerged[key]) {
                    cabinetMerged[key].quantity = isCornerLazySusan(normSku)
                      ? Math.max(cabinetMerged[key].quantity, item.quantity)
                      : cabinetMerged[key].quantity + item.quantity;
                  } else {
                    cabinetMerged[key] = {
                      sku: normSku,
                      type: item.type || 'Base',
                      room: item.room || 'Kitchen',
                      quantity: item.quantity || 1,
                      selected: true,
                      detectedUnitType: detectedType,
                    };
                  }
                }
              } else if (res.status === 429) { aborted = { reason: 'AI rate limit reached.' }; break; }
                else if (res.status === 402) { aborted = { reason: 'AI credits exhausted.' }; break; }
            } catch { /* skip page */ }

            workDone++;
            update({ progress: 10 + Math.round((workDone / totalWork) * 85), processedPages: workDone });
          }
          if (aborted) break;
        }

        if (aborted) {
          toast.error(aborted.reason);
          update({ status: 'error', error: aborted.reason });
          return;
        }

        const finalCabinetRows = Object.values(cabinetMerged).sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));

        if (finalUnitRows.length === 0 && finalCabinetRows.length === 0) {
          update({ status: 'error', error: 'No units or cabinet labels detected in the uploaded PDFs.' });
          return;
        }

        update({
          status: 'done',
          progress: 100,
          statusText: 'Extraction complete',
          results: { unitRows: finalUnitRows, cabinetRows: finalCabinetRows, typeOrder: pageOrderTypes },
        });
      } catch (err) {
        console.error(err);
        update({ status: 'error', error: 'Failed to process files. Please try again.' });
      }
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.includes('pdf'));
    if (files.length) processFiles(files);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) processFiles(files);
    e.target.value = '';
  };

  const handleImport = () => {
    const selectedUnits = unitRows.filter(r => r.selected).map(({ selected: _, conflict: __, ...rest }) => rest);
    const selectedCabinets = cabinetRows.filter(r => r.selected).map(({ selected: _, ...rest }) => rest);
    onImport(selectedUnits, selectedCabinets, typeOrder.length > 0 ? typeOrder : undefined);
  };

  const unitSelectedCount = unitRows.filter(r => r.selected).length;
  const cabSelectedCount = cabinetRows.filter(r => r.selected).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-border">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileUp size={18} className="text-primary" />
            <h2 className="font-bold text-base">Import from 2020 Shop Drawing</h2>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
              <Sparkles size={9} /> AI Detection
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-auto p-5">

          {/* Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload your <strong>2020 Design shop drawing PDFs</strong>. The AI will extract <strong>both unit counts and cabinet labels</strong> from the same files in one pass.
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
                <p className="font-semibold text-sm text-foreground">Drop shop drawing PDFs here</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse — multiple files supported</p>
                <input ref={fileRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleFileSelect} />
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg border text-sm border-destructive bg-destructive/10 text-destructive">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <p>{error}</p>
                </div>
              )}

              <div className="text-xs text-muted-foreground bg-secondary rounded-lg p-3 border border-border space-y-1">
                <p className="flex items-center gap-1.5">
                  <Sparkles size={11} className="text-primary flex-shrink-0" />
                  <strong>What the AI extracts:</strong>
                </p>
                <p className="ml-5">• <strong>Unit count:</strong> unit numbers, types, buildings, floors from schedules & floor plans</p>
                <p className="ml-5">• <strong>Cabinet count:</strong> SKU labels, quantities, room types from plan-view drawings</p>
              </div>
            </div>
          )}

          {/* Processing */}
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-12 gap-6">
              <div className="relative flex items-center justify-center">
                <div className="absolute w-20 h-20 rounded-full animate-ping opacity-10" style={{ background: 'hsl(var(--primary))' }} />
                <div className="relative flex items-center justify-center w-16 h-16 rounded-full" style={{ background: 'hsl(var(--primary) / 0.1)' }}>
                  <Search size={20} className="text-primary animate-pulse" />
                  <Sparkles size={11} className="absolute top-1 right-1 text-primary animate-bounce" />
                </div>
              </div>

              <p className="text-sm text-muted-foreground text-center max-w-sm">{processingStatus}</p>

              <div className="w-full max-w-xs">
                <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'hsl(var(--muted))' }}>
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: `${progress}%`,
                      background: 'linear-gradient(90deg, hsl(var(--primary)), hsl(var(--primary) / 0.7))',
                      boxShadow: '0 0 8px hsl(var(--primary) / 0.4)',
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center mt-2">{progress}% complete</p>
              </div>

              <div className="h-10 flex items-center justify-center">
                <p className={`text-sm italic text-muted-foreground text-center max-w-sm transition-opacity duration-400 ${quoteVisible ? 'opacity-100' : 'opacity-0'}`}>
                  "{QUOTES[quoteIndex]}"
                </p>
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className={progress >= 5 ? 'text-primary font-medium' : ''}>● Loading</span>
                <span className="text-border">—</span>
                <span className={progress >= 10 ? 'text-primary font-medium' : ''}>● Scanning Units</span>
                <span className="text-border">—</span>
                <span className={progress >= 50 ? 'text-primary font-medium' : ''}>● Scanning Cabinets</span>
                <span className="text-border">—</span>
                <span className={progress >= 95 ? 'text-primary font-medium' : ''}>● Finalizing</span>
              </div>

              <p className="text-[11px] text-muted-foreground/80 flex items-center gap-1.5">
                <Sparkles size={11} className="text-primary" />
                You can close this dialog — it will keep running in the background.
              </p>
            </div>
          )}

          {/* Review */}
          {step === 'review' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary border border-border">
                <CheckCircle size={18} className="text-primary flex-shrink-0" />
                <div className="flex-1 text-sm">
                  <strong className="text-foreground">{unitRows.length} unit{unitRows.length !== 1 ? 's' : ''}</strong>
                  <span className="text-muted-foreground mx-2">•</span>
                  <strong className="text-foreground">{cabinetRows.length} cabinet label{cabinetRows.length !== 1 ? 's' : ''}</strong>
                  <span className="text-muted-foreground ml-2">detected</span>
                </div>
              </div>

              {/* Review tabs */}
              <div className="flex items-center gap-1 border-b border-border pb-0">
                <button
                  onClick={() => setReviewTab('units')}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md transition-colors ${
                    reviewTab === 'units' ? 'bg-card border border-b-0 border-border text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Users size={12} /> Units ({unitRows.length})
                </button>
                <button
                  onClick={() => setReviewTab('cabinets')}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md transition-colors ${
                    reviewTab === 'cabinets' ? 'bg-card border border-b-0 border-border text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <LayoutGrid size={12} /> Cabinets ({cabinetRows.length})
                </button>
              </div>

              {/* Units review */}
              {reviewTab === 'units' && (
                <div className="space-y-3">
                  {unitRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No unit data detected — the PDFs may not contain floor plan schedules.</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setUnitRows(r => r.map(x => ({ ...x, selected: true })))} className="text-xs text-primary hover:underline">Select all</button>
                        <button onClick={() => setUnitRows(r => r.map(x => ({ ...x, selected: false })))} className="text-xs text-muted-foreground hover:underline">Deselect all</button>
                        <span className="text-xs text-muted-foreground ml-auto">{unitSelectedCount} of {unitRows.length} selected</span>
                      </div>
                      <div className="border border-border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                        <table className="est-table w-full">
                          <thead>
                            <tr>
                              <th className="w-8"></th>
                              <th className="text-left">Unit #</th>
                              <th className="text-left">Unit Type</th>
                              <th className="text-left">Bldg</th>
                              <th className="w-8"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {unitRows.map((row, i) => (
                              <tr key={i} className={`${!row.selected ? 'opacity-40' : ''} ${row.conflict ? 'bg-yellow-500/10' : ''}`}>
                                <td>
                                  <input type="checkbox" checked={row.selected}
                                    onChange={e => setUnitRows(r => r.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))} className="cursor-pointer" />
                                </td>
                                <td>
                                  <input className="est-input text-xs w-24" value={row.unitNumber}
                                    onChange={e => setUnitRows(r => r.map((x, j) => j === i ? { ...x, unitNumber: e.target.value } : x))} />
                                </td>
                                <td>
                                  <input className="est-input text-xs w-full" value={row.unitType}
                                    onChange={e => setUnitRows(r => r.map((x, j) => j === i ? { ...x, unitType: e.target.value } : x))} />
                                </td>
                                <td>
                                  <input className="est-input text-xs w-24" value={row.bldg} placeholder="—"
                                    onChange={e => setUnitRows(r => r.map((x, j) => j === i ? { ...x, bldg: e.target.value } : x))} />
                                </td>
                                <td>
                                  <button onClick={() => setUnitRows(r => r.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive transition-colors">
                                    <Trash2 size={13} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Cabinets review */}
              {reviewTab === 'cabinets' && (
                <div className="space-y-3">
                  {cabinetRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No cabinet labels detected — the PDFs may not contain plan-view drawings.</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setCabinetRows(r => r.map(x => ({ ...x, selected: true })))} className="text-xs text-primary hover:underline">Select all</button>
                        <button onClick={() => setCabinetRows(r => r.map(x => ({ ...x, selected: false })))} className="text-xs text-muted-foreground hover:underline">Deselect all</button>
                        <span className="text-xs text-muted-foreground ml-auto">{cabSelectedCount} of {cabinetRows.length} selected</span>
                      </div>
                      <div className="border border-border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                        <table className="est-table w-full">
                          <thead>
                            <tr>
                              <th className="w-8"></th>
                              <th className="text-left">SKU</th>
                              <th className="text-left">Type</th>
                              <th className="text-left">Room</th>
                              <th className="text-center">Qty</th>
                              <th className="text-left">Unit Type</th>
                              <th className="w-8"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {cabinetRows.map((row, i) => (
                              <tr key={i} className={!row.selected ? 'opacity-40' : ''}>
                                <td>
                                  <input type="checkbox" checked={row.selected}
                                    onChange={e => setCabinetRows(r => r.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))} className="cursor-pointer" />
                                </td>
                                <td className="font-mono font-medium text-xs">{row.sku}</td>
                                <td>
                                  <select className="est-input text-xs w-20" value={row.type}
                                    onChange={e => setCabinetRows(r => r.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}>
                                    {['Base', 'Wall', 'Tall', 'Vanity', 'Accessory'].map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                </td>
                                <td>
                                  <select className="est-input text-xs w-20" value={row.room}
                                    onChange={e => setCabinetRows(r => r.map((x, j) => j === i ? { ...x, room: e.target.value } : x))}>
                                    {['Kitchen', 'Pantry', 'Laundry', 'Bath', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                </td>
                                <td className="text-center">
                                  <input type="number" min={1} className="est-input text-xs w-12 text-center" value={row.quantity}
                                    onChange={e => setCabinetRows(r => r.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) || 1 } : x))} />
                                </td>
                                <td className="text-xs text-muted-foreground truncate max-w-[100px]" title={row.detectedUnitType}>{row.detectedUnitType || '—'}</td>
                                <td>
                                  <button onClick={() => setCabinetRows(r => r.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive transition-colors">
                                    <Trash2 size={13} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-secondary/40">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          {step === 'review' && (
            <button
              onClick={handleImport}
              disabled={unitSelectedCount === 0 && cabSelectedCount === 0}
              className="px-4 py-2 rounded text-sm font-semibold text-white transition-colors disabled:opacity-50"
              style={{ background: 'hsl(var(--primary))' }}
            >
              Import {unitSelectedCount > 0 ? `${unitSelectedCount} Unit${unitSelectedCount !== 1 ? 's' : ''}` : ''}{unitSelectedCount > 0 && cabSelectedCount > 0 ? ' + ' : ''}{cabSelectedCount > 0 ? `${cabSelectedCount} Label${cabSelectedCount !== 1 ? 's' : ''}` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
