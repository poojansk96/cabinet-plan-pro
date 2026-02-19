import { useState, useRef, useCallback } from 'react';
import { FileUp, X, Loader2, CheckCircle, AlertCircle, Sparkles, Trash2, Ruler } from 'lucide-react';
import type { Cabinet, CabinetType, Room } from '@/types/project';
import { toast } from 'sonner';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-pdf-cabinets`;

interface CabinetRow extends Omit<Cabinet, 'id'> {
  selected: boolean;
}

interface Props {
  unitType?: string;
  onImport: (cabinets: Array<Omit<Cabinet, 'id'>>) => void;
  onClose: () => void;
}

type Step = 'upload' | 'processing' | 'review';

const CABINET_TYPES: CabinetType[] = ['Base', 'Wall', 'Tall', 'Vanity'];
const ROOMS: Room[] = ['Kitchen', 'Pantry', 'Laundry', 'Bath', 'Other'];

const COMMON_SCALES = [
  { label: '1/4" = 1\'-0"',  factor: 48 },
  { label: '3/8" = 1\'-0"',  factor: 32 },
  { label: '1/2" = 1\'-0"',  factor: 24 },
  { label: '3/4" = 1\'-0"',  factor: 16 },
  { label: '1" = 1\'-0"',    factor: 12 },
  { label: '1-1/2" = 1\'-0"',factor: 8 },
  { label: '3" = 1\'-0"',    factor: 4 },
  { label: '1:1 (full size)', factor: 1 },
  { label: 'Custom ratio…',   factor: -1 },
];

/** Render a PDF page to a base64 PNG image using pdfjs canvas */
async function renderPageToBase64(page: any, scale = 2): Promise<string> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  // Return base64 data (strip the data:image/png;base64, prefix)
  return canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
}

export default function CabinetPDFImportDialog({ unitType, onImport, onClose }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<CabinetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('Rendering PDF pages…');
  const [selectedScaleIdx, setSelectedScaleIdx] = useState(0);
  const [customRatio, setCustomRatio] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const getScaleFactor = (): number | null => {
    const sel = COMMON_SCALES[selectedScaleIdx];
    if (sel.factor !== -1) return sel.factor;
    const trimmed = customRatio.trim();
    if (!trimmed) return null;
    if (trimmed.includes(':')) {
      const [, denom] = trimmed.split(':').map(Number);
      return isNaN(denom) || denom <= 0 ? null : denom;
    }
    const n = Number(trimmed);
    return isNaN(n) || n <= 0 ? null : n;
  };

  const processFile = async (file: File) => {
    if (!file.type.includes('pdf')) { setError('Please upload a PDF file.'); return; }
    const scaleFactor = getScaleFactor();
    if (!scaleFactor) { setError('Please enter a valid scale ratio before uploading.'); return; }

    setError(null);
    setStep('processing');

    try {
      setProcessingStatus('Loading PDF…');
      const arrayBuffer = await file.arrayBuffer();
      const pdfjsLib = (await import('pdfjs-dist')) as any;
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      const pageImages: string[] = [];

      for (let p = 1; p <= pdf.numPages; p++) {
        setProcessingStatus(`Rendering page ${p} of ${pdf.numPages}…`);
        const page = await pdf.getPage(p);
        const b64 = await renderPageToBase64(page, 2); // 2× for clarity
        pageImages.push(b64);
      }

      setProcessingStatus('AI is analyzing elevation drawings and measuring cabinet boxes…');

      const scaleLabel = COMMON_SCALES[selectedScaleIdx].factor !== -1
        ? COMMON_SCALES[selectedScaleIdx].label
        : `1:${scaleFactor}`;

      const aiResponse = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageImages, scaleFactor, scaleLabel, unitType }),
      });

      if (!aiResponse.ok) {
        if (aiResponse.status === 429) toast.error('AI rate limit reached. Try again shortly.');
        else if (aiResponse.status === 402) toast.error('AI credits exhausted.');
        else toast.error('AI analysis failed. Please try again.');
        setStep('upload');
        return;
      }

      const data = await aiResponse.json();
      if (data.error) {
        setError(data.error);
        setStep('upload');
        return;
      }

      const cabinets: CabinetRow[] = (data.cabinets ?? []).map((c: any) => ({
        sku: c.sku,
        type: c.type as CabinetType,
        room: c.room as Room,
        width: c.width,
        height: c.height,
        depth: c.depth,
        quantity: c.quantity,
        notes: '',
        selected: true,
      }));

      if (cabinets.length === 0) {
        setError('No cabinet schedules detected. Make sure the PDF contains cabinet elevation drawings with SKU labels.');
        setStep('upload');
        return;
      }

      setRows(cabinets);
      setStep('review');
    } catch (err) {
      console.error(err);
      setError('Failed to process PDF. The file may be encrypted or corrupted.');
      setStep('upload');
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [selectedScaleIdx, customRatio, unitType]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const toggleAll = (val: boolean) => setRows(r => r.map(row => ({ ...row, selected: val })));
  const updateRow = (i: number, patch: Partial<CabinetRow>) =>
    setRows(r => r.map((x, j) => j === i ? { ...x, ...patch } : x));
  const deleteRow = (i: number) => setRows(r => r.filter((_, j) => j !== i));

  const handleImport = () => {
    const selected = rows.filter(r => r.selected).map(({ selected: _, ...cab }) => cab);
    if (selected.length === 0) return;
    onImport(selected);
  };

  const selectedCount = rows.filter(r => r.selected).length;
  const isCustomScale = COMMON_SCALES[selectedScaleIdx].factor === -1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileUp size={18} className="text-primary" />
            <h2 className="font-bold text-base">Import Cabinets from PDF</h2>
            {unitType && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-accent text-accent-foreground border border-border">
                {unitType}
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
              <Sparkles size={9} />AI Vision
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {/* Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload your <strong>cabinet elevation PDF</strong>. The AI renders each page as an image and visually reads the elevation — identifying cabinet boxes, SKUs, and measuring widths using your drawing scale.
              </p>

              {/* Scale selector */}
              <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-3">
                <div className="flex items-center gap-2">
                  <Ruler size={15} className="text-primary flex-shrink-0" />
                  <span className="text-sm font-semibold text-foreground">
                    Drawing Scale <span className="text-destructive">*</span>
                  </span>
                  <span className="text-xs text-muted-foreground">(required — same scale as shown in title block)</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="est-input text-sm"
                    value={selectedScaleIdx}
                    onChange={e => setSelectedScaleIdx(Number(e.target.value))}
                  >
                    {COMMON_SCALES.map((s, i) => (
                      <option key={i} value={i}>{s.label}</option>
                    ))}
                  </select>
                  {isCustomScale && (
                    <input
                      className="est-input text-sm w-28"
                      placeholder="e.g. 1:48"
                      value={customRatio}
                      onChange={e => setCustomRatio(e.target.value)}
                    />
                  )}
                  {!isCustomScale && (
                    <span className="text-xs text-muted-foreground">
                      1 drawn inch = <strong>{COMMON_SCALES[selectedScaleIdx].factor}"</strong> real world
                    </span>
                  )}
                </div>
              </div>

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
                <p className="font-semibold text-sm text-foreground">Drop your cabinet elevation PDF here</p>
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
                <p className="flex items-center gap-1.5">
                  <Sparkles size={11} className="text-primary flex-shrink-0" />
                  <strong>Vision AI:</strong> Each page is rendered as a high-resolution image and sent to a multimodal AI that visually reads the elevation — just like an estimator would — identifying cabinet boxes and applying your scale to measure widths.
                </p>
                <p>Works with <strong>any PDF</strong> including scanned drawings, CAD exports, and image-heavy files. The AI sees the actual drawing, not just extracted text.</p>
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
              <p className="font-semibold text-sm text-center">{processingStatus}</p>
              <p className="text-xs text-muted-foreground">Rendering pages and analyzing elevation drawings…</p>
            </div>
          )}

          {/* Review */}
          {step === 'review' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary border border-border">
                <CheckCircle size={18} className="text-primary flex-shrink-0" />
                <div className="flex-1 text-sm">
                  <strong className="text-foreground">{rows.length} cabinet line items detected</strong>
                  <span className="text-muted-foreground ml-2">Review and edit before importing</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button onClick={() => toggleAll(true)} className="text-xs text-primary hover:underline">Select all</button>
                <button onClick={() => toggleAll(false)} className="text-xs text-muted-foreground hover:underline">Deselect all</button>
                <span className="text-xs text-muted-foreground ml-auto">{selectedCount} of {rows.length} selected</span>
              </div>

              <div className="border border-border rounded-lg overflow-hidden overflow-x-auto">
                <table className="est-table" style={{ whiteSpace: 'nowrap', minWidth: '700px' }}>
                  <thead>
                    <tr>
                      <th className="w-8"></th>
                      <th>SKU</th>
                      <th>Type</th>
                      <th>Room</th>
                      <th className="text-right">W"</th>
                      <th className="text-right">H"</th>
                      <th className="text-right">D"</th>
                      <th className="text-right">Qty</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className={!row.selected ? 'opacity-40' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={row.selected}
                            onChange={e => updateRow(i, { selected: e.target.checked })}
                            className="cursor-pointer"
                          />
                        </td>
                        <td>
                          <input
                            className="est-input font-mono w-24 text-xs"
                            value={row.sku}
                            onChange={e => updateRow(i, { sku: e.target.value.toUpperCase() })}
                          />
                        </td>
                        <td>
                          <select
                            className="est-input text-xs w-20"
                            value={row.type}
                            onChange={e => updateRow(i, { type: e.target.value as CabinetType })}
                          >
                            {CABINET_TYPES.map(t => <option key={t}>{t}</option>)}
                          </select>
                        </td>
                        <td>
                          <select
                            className="est-input text-xs w-24"
                            value={row.room}
                            onChange={e => updateRow(i, { room: e.target.value as Room })}
                          >
                            {ROOMS.map(r => <option key={r}>{r}</option>)}
                          </select>
                        </td>
                        <td>
                          <input type="number" className="est-input text-xs w-16 text-right" value={row.width} min={1}
                            onChange={e => updateRow(i, { width: +e.target.value })} />
                        </td>
                        <td>
                          <input type="number" className="est-input text-xs w-16 text-right" value={row.height} min={1}
                            onChange={e => updateRow(i, { height: +e.target.value })} />
                        </td>
                        <td>
                          <input type="number" className="est-input text-xs w-16 text-right" value={row.depth} min={1}
                            onChange={e => updateRow(i, { depth: +e.target.value })} />
                        </td>
                        <td>
                          <input type="number" className="est-input text-xs w-14 text-right" value={row.quantity} min={1}
                            onChange={e => updateRow(i, { quantity: Math.max(1, +e.target.value) })} />
                        </td>
                        <td>
                          <button onClick={() => deleteRow(i)} className="p-1 hover:text-destructive text-muted-foreground" title="Remove row">
                            <Trash2 size={12} />
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
        <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3">
          <button
            onClick={() => { setStep('upload'); setRows([]); setError(null); }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Upload different file
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
                Import {selectedCount} cabinet{selectedCount !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
