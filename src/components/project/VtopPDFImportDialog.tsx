import { useState, useRef } from 'react';
import { X, Upload, Loader2, Sparkles, Trash2 } from 'lucide-react';
import type { PrefinalVtopRow } from '@/hooks/usePrefinalStore';

export interface VtopImportRow extends PrefinalVtopRow {
  selected: boolean;
  sourceFile?: string;
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
  let b64 = btoa(binary);
  if (b64.length > 3_500_000 && scale > 1.5) {
    return renderPageToBase64(page, scale - 0.5);
  }
  return b64;
}

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

export default function VtopPDFImportDialog({ onImport, onClose, prefinalPerson }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<VtopImportRow[]>([]);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [personalQuoteIdx, setPersonalQuoteIdx] = useState(0);
  const [quoteVisible, setQuoteVisible] = useState(true);
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
          const pageImage = await renderPageToBase64(page);

          const MAX_CLIENT_RETRIES = 5;
          let pageSuccess = false;
          for (let attempt = 0; attempt < MAX_CLIENT_RETRIES && !pageSuccess; attempt++) {
            try {
              if (attempt > 0) {
                const delay = Math.min(3000 * attempt, 15000);
                await new Promise(r => setTimeout(r, delay));
              }
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 180000);
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
                  allRows.push({
                    length: vt.length,
                    depth: vt.depth,
                    bowlPosition: vt.bowlPosition,
                    bowlOffset: vt.bowlOffset,
                    leftWall: vt.leftWall,
                    rightWall: vt.rightWall,
                    unitType: pageUnitType || 'Unassigned',
                    selected: true,
                    sourceFile: file.name,
                  });
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
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
                <p className="text-sm font-medium">
                  Found {rows.length} vanity top{rows.length !== 1 ? 's' : ''}
                </p>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={selectedCount === rows.length && rows.length > 0} onChange={e => toggleAll(e.target.checked)} />
                  Select all
                </label>
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
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => (
                        <tr key={idx} className={!row.selected ? 'opacity-50' : ''}>
                          <td>
                            <input type="checkbox" checked={row.selected} onChange={() => setRows(r => r.map((rr, i) => i === idx ? { ...rr, selected: !rr.selected } : rr))} />
                          </td>
                          <td className="font-medium text-[10px]">{row.unitType}</td>
                          <td className="font-mono text-[10px] font-bold">{formatVtopSku(row)}</td>
                          <td className="text-[10px]">
                            {getVtopSidesplashItems(row).length > 0
                              ? getVtopSidesplashItems(row).map((s, i) => <div key={i}>{s} — 1 qty</div>)
                              : <span className="text-muted-foreground">None</span>}
                          </td>
                          <td>
                            <button onClick={() => deleteRow(idx)} className="p-1 hover:text-destructive"><Trash2 size={12} /></button>
                          </td>
                        </tr>
                      ))}
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
