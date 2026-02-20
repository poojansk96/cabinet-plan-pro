import { useState, useRef, useCallback } from 'react';
import { FileUp, X, Loader2, CheckCircle, AlertCircle, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-pdf-unit-types`;

export interface UnitMappingRow {
  unitNumber: string;
  unitType: string;
  selected: boolean;
}

interface Props {
  onImport: (rows: Omit<UnitMappingRow, 'selected'>[]) => void;
  onClose: () => void;
}

async function renderPageToBase64(page: any): Promise<string> {
  const MAX_PX = 4096;
  const baseViewport = page.getViewport({ scale: 1 });
  const longSide = Math.max(baseViewport.width, baseViewport.height);
  const scale = Math.min(4, MAX_PX / longSide);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
}

type Step = 'upload' | 'processing' | 'review';

export default function UnitTypeImportDialog({ onImport, onClose }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<UnitMappingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const processFiles = async (files: File[]) => {
    const nonPdfs = files.filter(f => !f.type.includes('pdf'));
    if (nonPdfs.length) { setError(`Only PDF files supported.`); return; }
    setError(null);
    setStep('processing');

    try {
      setProcessingStatus('Loading PDF library…');
      const pdfjsLib = (await import('pdfjs-dist')) as any;
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

      const allMappings: Map<string, UnitMappingRow> = new Map();

      for (const file of files) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        for (let p = 1; p <= pdf.numPages; p++) {
          setProcessingStatus(`Scanning "${file.name}" page ${p}/${pdf.numPages} for units…`);
          const page = await pdf.getPage(p);
          const pageImage = await renderPageToBase64(page);

          const fetchWithRetry = async (attempts = 2): Promise<Response> => {
            for (let attempt = 1; attempt <= attempts; attempt++) {
              const controller = new AbortController();
              const tid = setTimeout(() => controller.abort(), 5 * 60 * 1000);
              try {
                const res = await fetch(EDGE_FUNCTION_URL, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ pageImage }),
                  signal: controller.signal,
                });
                clearTimeout(tid);
                return res;
              } catch (err: any) {
                clearTimeout(tid);
                if (attempt === attempts) throw err;
                await new Promise(r => setTimeout(r, 2000));
              }
            }
            throw new Error('All attempts failed');
          };

          let aiResponse: Response;
          try {
            aiResponse = await fetchWithRetry();
          } catch {
            console.warn(`Page ${p} of "${file.name}" timed out, skipping`);
            continue;
          }

          if (!aiResponse.ok) {
            const status = aiResponse.status;
            if (status === 429) { toast.error('AI rate limit reached. Try again shortly.'); setStep('upload'); return; }
            if (status === 402) { toast.error('AI credits exhausted.'); setStep('upload'); return; }
            continue;
          }

          const data = await aiResponse.json();
          if (data.error === 'rate_limit') { toast.error('AI rate limit reached.'); setStep('upload'); return; }
          if (data.error === 'credits') { toast.error('AI credits exhausted.'); setStep('upload'); return; }

          for (const u of (data.units ?? [])) {
            const num = String(u.unitNumber ?? '').trim();
            const type = String(u.unitType ?? '').trim();
            if (!num || !type) continue;
            // Deduplicate by unit number (keep first seen type, or overwrite — last wins)
            allMappings.set(num, { unitNumber: num, unitType: type, selected: true });
          }
        }
      }

      const result = Array.from(allMappings.values()).sort((a, b) =>
        a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })
      );

      if (result.length === 0) {
        setError('No unit numbers or types detected. The drawing may not contain unit schedules or labels.');
        setStep('upload');
        return;
      }

      setRows(result);
      setStep('review');
    } catch (err) {
      console.error(err);
      setError('Failed to process files. Please try again.');
      setStep('upload');
    }
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

  const updateRow = (i: number, patch: Partial<UnitMappingRow>) =>
    setRows(r => r.map((x, j) => j === i ? { ...x, ...patch } : x));
  const deleteRow = (i: number) => setRows(r => r.filter((_, j) => j !== i));
  const toggleAll = (val: boolean) => setRows(r => r.map(x => ({ ...x, selected: val })));

  const handleImport = () => {
    const selected = rows.filter(r => r.selected).map(({ selected: _, ...rest }) => rest);
    if (!selected.length) return;
    onImport(selected);
  };

  const selectedCount = rows.filter(r => r.selected).length;
  const uniqueTypes = Array.from(new Set(rows.filter(r => r.selected).map(r => r.unitType)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-border">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileUp size={18} className="text-primary" />
            <h2 className="font-bold text-base">Import Units from Shop Drawing</h2>
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
                Upload your <strong>2020 Design shop drawing PDFs</strong>. The AI scans each page to extract unit numbers and their associated unit types.
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
                  <strong>What the AI looks for:</strong> unit numbers (101, 102, 201…) and their associated unit types (TYPE A, A1-As, 2BHK…) from schedules, floor plans, and title blocks.
                </p>
              </div>
            </div>
          )}

          {/* Processing */}
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="relative">
                <Loader2 size={40} className="animate-spin text-primary" />
                <Sparkles size={14} className="absolute -top-1 -right-1 text-primary" />
              </div>
              <p className="font-semibold text-sm text-center max-w-sm">{processingStatus}</p>
              <p className="text-xs text-muted-foreground">Detecting unit numbers and types from drawings…</p>
            </div>
          )}

          {/* Review */}
          {step === 'review' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary border border-border">
                <CheckCircle size={18} className="text-primary flex-shrink-0" />
                <div className="flex-1 text-sm">
                  <strong className="text-foreground">{rows.length} unit{rows.length !== 1 ? 's' : ''} detected</strong>
                  <span className="text-muted-foreground ml-2">across {uniqueTypes.length} unit type{uniqueTypes.length !== 1 ? 's' : ''}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button onClick={() => toggleAll(true)} className="text-xs text-primary hover:underline">Select all</button>
                <button onClick={() => toggleAll(false)} className="text-xs text-muted-foreground hover:underline">Deselect all</button>
                <span className="text-xs text-muted-foreground ml-auto">{selectedCount} of {rows.length} selected</span>
              </div>

              <div className="border border-border rounded-lg overflow-hidden">
                <table className="est-table w-full">
                  <thead>
                    <tr>
                      <th className="w-8"></th>
                      <th className="text-left">Unit #</th>
                      <th className="text-left">Unit Type</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className={!row.selected ? 'opacity-40' : ''}>
                        <td>
                          <input type="checkbox" checked={row.selected} onChange={e => updateRow(i, { selected: e.target.checked })} className="cursor-pointer" />
                        </td>
                        <td>
                          <input
                            className="est-input text-xs w-24"
                            value={row.unitNumber}
                            onChange={e => updateRow(i, { unitNumber: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className="est-input text-xs w-full"
                            value={row.unitType}
                            onChange={e => updateRow(i, { unitType: e.target.value })}
                          />
                        </td>
                        <td>
                          <button onClick={() => deleteRow(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              disabled={selectedCount === 0}
              className="px-4 py-2 rounded text-sm font-semibold text-white transition-colors disabled:opacity-50"
              style={{ background: 'hsl(var(--primary))' }}
            >
              Import {selectedCount} Unit{selectedCount !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
