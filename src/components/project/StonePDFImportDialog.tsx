import { useState, useRef } from 'react';
import { X, Upload, Loader2, Check, Trash2 } from 'lucide-react';

export interface StoneExtractedRow {
  label: string;
  length: number;
  depth: number;
  splashHeight: number | null;
  isIsland: boolean;
  room: string;
  selected: boolean;
  sourceFile?: string;
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

function calcSqft(row: StoneExtractedRow): number {
  const effectiveDepth = row.depth + (row.splashHeight ?? 0);
  return Math.ceil((row.length * effectiveDepth) / 144);
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

    const quoteInterval = setInterval(() => setQuoteIdx(i => (i + 1) % QUOTES.length), 4000);

    try {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

      let allRows: StoneExtractedRow[] = [...rows];
      let pagesDone = 0;
      let pagesTotal = 0;

      for (const file of files) {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        pagesTotal += pdf.numPages;
      }
      setTotalPages(pagesTotal);

      // Try to detect unit type from filename (e.g. "Type A countertops.pdf")
      const typeMatch = files[0]?.name.match(/type\s*[-_]?\s*([A-Za-z0-9]+)/i);
      if (typeMatch) {
        setDetectedType('TYPE ' + typeMatch[1].toUpperCase());
      }

      for (const file of files) {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

        for (let p = 1; p <= pdf.numPages; p++) {
          setStatusMsg(`Processing ${file.name} — page ${p}/${pdf.numPages}`);
          const page = await pdf.getPage(p);
          const pageImage = await renderPageToBase64(page);

          try {
            const resp = await fetch(`${SUPABASE_URL}/functions/v1/extract-pdf-countertops`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_KEY}`,
              },
              body: JSON.stringify({ pageImage }),
            });

            if (resp.status === 429) { setError('Rate limit reached. Please wait and try again.'); break; }
            if (resp.status === 402) { setError('AI credits exhausted.'); break; }

            if (resp.ok) {
              const data = await resp.json();
              for (const ct of (data.countertops ?? [])) {
                allRows.push({
                  label: ct.label,
                  length: ct.length,
                  depth: ct.depth,
                  splashHeight: ct.splashHeight,
                  isIsland: ct.isIsland,
                  room: ct.room || 'Kitchen',
                  selected: true,
                  sourceFile: file.name,
                });
              }
            }
          } catch (err) {
            console.error(`Error processing page ${p}:`, err);
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
            <div className="text-center py-12">
              <Loader2 size={40} className="mx-auto mb-4 animate-spin text-primary" />
              <p className="text-sm font-medium mb-2">{statusMsg}</p>
              <div className="w-64 mx-auto bg-secondary rounded-full h-2 mb-3">
                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{progress}% complete</p>
              <p className="text-xs text-muted-foreground mt-4 italic">"{QUOTES[quoteIdx]}"</p>
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
                        <th>Label</th>
                        <th>Room</th>
                        <th className="text-right">Length"</th>
                        <th className="text-right">Depth"</th>
                        <th className="text-right">Backsplash"</th>
                        <th className="text-center">Island</th>
                        <th className="text-right">SQFT</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => (
                        <tr key={idx} className={!row.selected ? 'opacity-50' : ''}>
                          <td><input type="checkbox" checked={row.selected} onChange={e => updateRow(idx, { selected: e.target.checked })} /></td>
                          <td><input className="est-input w-full text-xs" value={row.label} onChange={e => updateRow(idx, { label: e.target.value })} /></td>
                          <td><input className="est-input w-20 text-xs" value={row.room} onChange={e => updateRow(idx, { room: e.target.value })} /></td>
                          <td className="text-right"><input type="number" className="est-input w-16 text-right text-xs" value={row.length} min={1} onChange={e => updateRow(idx, { length: +e.target.value })} /></td>
                          <td className="text-right"><input type="number" className="est-input w-16 text-right text-xs" value={row.depth} min={1} step={0.5} onChange={e => updateRow(idx, { depth: +e.target.value })} /></td>
                          <td className="text-right"><input type="number" className="est-input w-14 text-right text-xs" value={row.splashHeight ?? ''} min={0} step={0.5} onChange={e => updateRow(idx, { splashHeight: e.target.value ? +e.target.value : null })} placeholder="—" /></td>
                          <td className="text-center">{row.isIsland ? '✓' : '—'}</td>
                          <td className="text-right font-bold" style={{ color: 'hsl(var(--primary))' }}>{calcSqft(row)}</td>
                          <td><button onClick={() => deleteRow(idx)} className="p-1 hover:text-destructive text-muted-foreground"><Trash2 size={12} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-bold border-t border-border">
                        <td colSpan={7} className="text-right">Total SQFT:</td>
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
