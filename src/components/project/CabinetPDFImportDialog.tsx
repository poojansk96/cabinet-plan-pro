import { useState, useRef, useCallback, useEffect } from 'react';
import { FileUp, X, Loader2, CheckCircle, AlertCircle, Sparkles, Trash2, Ruler, FilePlus, FileText } from 'lucide-react';
import type { Cabinet, CabinetType, Room } from '@/types/project';
import { toast } from 'sonner';
import { startExtraction, useExtractionJobByType, clearExtractionJob } from '@/hooks/useExtractionStore';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-pdf-cabinets`;

interface CabinetRow extends Omit<Cabinet, 'id'> {
  selected: boolean;
  sourceFile?: string;
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
  { label: '1/4" = 1\'-0"',   factor: 48 },
  { label: '3/8" = 1\'-0"',   factor: 32 },
  { label: '1/2" = 1\'-0"',   factor: 24 },
  { label: '3/4" = 1\'-0"',   factor: 16 },
  { label: '1" = 1\'-0"',     factor: 12 },
  { label: '1-1/2" = 1\'-0"', factor: 8 },
  { label: '3" = 1\'-0"',     factor: 4 },
  { label: '1:1 (full size)',  factor: 1 },
  { label: 'Custom ratio…',    factor: -1 },
];

async function renderPageToBase64(page: any, scale = 2): Promise<string> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
}

export default function CabinetPDFImportDialog({ unitType, onImport, onClose }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<CabinetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [selectedScaleIdx, setSelectedScaleIdx] = useState(0);
  const [customRatio, setCustomRatio] = useState('');
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [filterSource, setFilterSource] = useState<string>('all');
  const fileRef = useRef<HTMLInputElement>(null);
  const bgPickedUpRef = useRef(false);

  // ── Pick up background job results ──
  const bgJob = useExtractionJobByType('takeoff-cabinet');

  useEffect(() => {
    if (!bgJob || bgPickedUpRef.current) return;
    if (bgJob.status === 'processing') {
      setStep('processing');
      setProcessingStatus(bgJob.statusText);
    } else if (bgJob.status === 'done') {
      bgPickedUpRef.current = true;
      const r = bgJob.results as { rows: CabinetRow[] } | null;
      if (r) {
        setRows(r.rows);
        setFilterSource('all');
      }
      setStep('review');
      clearExtractionJob('takeoff-cabinet');
    } else if (bgJob.status === 'error') {
      bgPickedUpRef.current = true;
      setError(bgJob.error || 'Failed');
      setStep('upload');
      clearExtractionJob('takeoff-cabinet');
    }
  }, [bgJob]);

  useEffect(() => {
    if (!bgJob || bgJob.status !== 'processing' || bgPickedUpRef.current) return;
    setProcessingStatus(bgJob.statusText);
  }, [bgJob?.statusText]);

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

  /** Process a single PDF file — calls edge function once per page for reliability */
  const processSingleFile = async (
    file: File,
    scaleFactor: number,
    scaleLabel: string,
    pdfjsLib: any,
    onStatus: (msg: string) => void
  ): Promise<CabinetRow[]> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const allCabinets: CabinetRow[] = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      onStatus(`Rendering "${file.name}" page ${p}/${pdf.numPages}…`);
      const page = await pdf.getPage(p);
      // Render at 1.5× — enough for AI to read, keeps payload small
      const pageImage = await renderPageToBase64(page, 1.5);

      onStatus(`AI analyzing "${file.name}" page ${p}/${pdf.numPages}…`);

      const aiResponse = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageImage, scaleFactor, scaleLabel, unitType }),
      });

      if (!aiResponse.ok) {
        const status = aiResponse.status;
        if (status === 429) throw new Error('rate_limit');
        if (status === 402) throw new Error('credits');
        console.warn(`Page ${p} of "${file.name}" failed (${status}), skipping`);
        continue; // skip this page, continue with next
      }

      const data = await aiResponse.json();
      if (data.error === 'rate_limit') throw new Error('rate_limit');
      if (data.error === 'credits') throw new Error('credits');

      const pageCabinets = (data.cabinets ?? []).map((c: any) => ({
        sku: c.sku,
        type: c.type as CabinetType,
        room: c.room as Room,
        width: c.width,
        height: c.height,
        depth: c.depth,
        quantity: c.quantity,
        notes: '',
        selected: true,
        sourceFile: file.name,
      }));
      allCabinets.push(...pageCabinets);
    }

    return allCabinets;
  };

  const processFiles = async (files: File[]) => {
    const scaleFactor = getScaleFactor();
    if (!scaleFactor) { setError('Please enter a valid scale ratio before uploading.'); return; }
    const nonPdfs = files.filter(f => !f.type.includes('pdf'));
    if (nonPdfs.length > 0) { setError(`Only PDF files are supported. Remove: ${nonPdfs.map(f => f.name).join(', ')}`); return; }

    setError(null);
    setStep('processing');

    const scaleLabel = COMMON_SCALES[selectedScaleIdx].factor !== -1
      ? COMMON_SCALES[selectedScaleIdx].label
      : `1:${scaleFactor}`;

    try {
      setProcessingStatus('Loading PDF library…');
      const pdfjsLib = (await import('pdfjs-dist')) as any;
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();

      // Merge cabinets by key across all files
      const allCabinets: Record<string, CabinetRow> = {};
      let filesProcessed = 0;

      for (const file of files) {
        setProcessingStatus(`Processing file ${filesProcessed + 1} of ${files.length}: "${file.name}"…`);
        try {
          const cabinets = await processSingleFile(file, scaleFactor, scaleLabel, pdfjsLib, setProcessingStatus);
          for (const cab of cabinets) {
            const key = `${cab.sku}__${cab.type}__${cab.room}__${cab.width}__${cab.height}__${cab.depth}__${cab.sourceFile}`;
            if (allCabinets[key]) {
              allCabinets[key].quantity += cab.quantity;
            } else {
              allCabinets[key] = { ...cab };
            }
          }
          filesProcessed++;
        } catch (err: any) {
          if (err.message === 'rate_limit') { toast.error('AI rate limit reached. Try again shortly.'); setStep('upload'); return; }
          if (err.message === 'credits') { toast.error('AI credits exhausted.'); setStep('upload'); return; }
          toast.error(`Skipped "${file.name}": ${err.message}`);
          filesProcessed++;
        }
      }

      const merged = Object.values(allCabinets).sort((a, b) =>
        a.sku.localeCompare(b.sku, undefined, { numeric: true })
      );

      if (merged.length === 0) {
        setError('No cabinet schedules detected in any of the uploaded files.');
        setStep('upload');
        return;
      }

      setRows(merged);
      setFilterSource('all');
      setStep('review');
    } catch (err) {
      console.error(err);
      setError('Failed to process files. Please try again.');
      setStep('upload');
    }
  };

  const addMoreFiles = async (newFiles: File[]) => {
    const scaleFactor = getScaleFactor();
    if (!scaleFactor) { toast.error('Scale factor not set.'); return; }
    const scaleLabel = COMMON_SCALES[selectedScaleIdx].factor !== -1
      ? COMMON_SCALES[selectedScaleIdx].label
      : `1:${scaleFactor}`;

    setStep('processing');
    try {
      const pdfjsLib = (await import('pdfjs-dist')) as any;
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();

      const newCabinets: CabinetRow[] = [];
      for (const file of newFiles) {
        setProcessingStatus(`Processing "${file.name}"…`);
        try {
          const cabs = await processSingleFile(file, scaleFactor, scaleLabel, pdfjsLib, setProcessingStatus);
          newCabinets.push(...cabs);
        } catch (err: any) {
          toast.error(`Skipped "${file.name}": ${err.message}`);
        }
      }

      setRows(prev => {
        const merged: Record<string, CabinetRow> = {};
        for (const cab of [...prev, ...newCabinets]) {
          const key = `${cab.sku}__${cab.type}__${cab.room}__${cab.width}__${cab.height}__${cab.depth}__${cab.sourceFile}`;
          if (merged[key]) merged[key].quantity += cab.quantity;
          else merged[key] = { ...cab };
        }
        return Object.values(merged).sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
      });
      setStep('review');
    } catch (err) {
      console.error(err);
      toast.error('Failed to process additional files.');
      setStep('review');
    }
  };

  const addMoreRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.includes('pdf'));
    if (files.length) {
      setQueuedFiles(files);
      processFiles(files);
    }
  }, [selectedScaleIdx, customRatio, unitType]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) {
      setQueuedFiles(files);
      processFiles(files);
    }
    e.target.value = '';
  };

  const handleAddMore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f => f.type.includes('pdf'));
    if (files.length) addMoreFiles(files);
    e.target.value = '';
  };

  const toggleAll = (val: boolean) => setRows(r => r.map(row => ({ ...row, selected: val })));
  const updateRow = (i: number, patch: Partial<CabinetRow>) =>
    setRows(r => r.map((x, j) => j === i ? { ...x, ...patch } : x));
  const deleteRow = (i: number) => setRows(r => r.filter((_, j) => j !== i));

  const handleImport = () => {
    const selected = rows
      .filter(r => r.selected)
      .map(({ selected: _, sourceFile: __, ...cab }) => cab);
    if (selected.length === 0) return;
    onImport(selected);
  };

  const sourceFiles = Array.from(new Set(rows.map(r => r.sourceFile ?? 'Unknown')));
  const visibleRows = filterSource === 'all' ? rows : rows.filter(r => r.sourceFile === filterSource);
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

          {/* Upload step */}
          {step === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload one or more <strong>cabinet elevation PDFs</strong>. The AI renders each page as an image, visually identifies cabinet boxes, and measures widths using your drawing scale. All files are merged into one review table.
              </p>

              {/* Scale selector */}
              <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-3">
                <div className="flex items-center gap-2">
                  <Ruler size={15} className="text-primary flex-shrink-0" />
                  <span className="text-sm font-semibold text-foreground">
                    Drawing Scale <span className="text-destructive">*</span>
                  </span>
                  <span className="text-xs text-muted-foreground">(as shown in title block — applies to all files)</span>
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

              {/* Drop zone — multiple files */}
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
                <p className="font-semibold text-sm text-foreground">Drop cabinet elevation PDFs here</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse — you can select multiple files</p>
                <input ref={fileRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleFileSelect} />
              </div>

              {/* Queued file list preview */}
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
                  <strong>Vision AI:</strong> Each page is rendered as a high-resolution image and analyzed by a multimodal AI — just like an estimator reading an elevation. Cabinet boxes are identified visually and widths are measured using your scale.
                </p>
                <p>Works with <strong>any PDF</strong> including scanned drawings and CAD exports. Select all elevation sheets at once to merge them into one take-off list.</p>
              </div>
            </div>
          )}

          {/* Processing step */}
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="relative">
                <Loader2 size={40} className="animate-spin text-primary" />
                <Sparkles size={14} className="absolute -top-1 -right-1 text-primary" />
              </div>
              <p className="font-semibold text-sm text-center max-w-sm">{processingStatus}</p>
              <p className="text-xs text-muted-foreground">Rendering pages and analyzing elevation drawings…</p>
            </div>
          )}

          {/* Review step */}
          {step === 'review' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary border border-border">
                <CheckCircle size={18} className="text-primary flex-shrink-0" />
                <div className="flex-1 text-sm">
                  <strong className="text-foreground">{rows.length} cabinet line items detected</strong>
                  {sourceFiles.length > 1 && (
                    <span className="text-muted-foreground ml-2">from {sourceFiles.length} files</span>
                  )}
                  <span className="text-muted-foreground ml-2">— review and edit before importing</span>
                </div>
                {/* Add more files button */}
                <button
                  onClick={() => addMoreRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <FilePlus size={13} />
                  Add more PDFs
                </button>
                <input ref={addMoreRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleAddMore} />
              </div>

              {/* Source file filter tabs */}
              {sourceFiles.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setFilterSource('all')}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      filterSource === 'all'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-muted-foreground border border-border hover:text-foreground'
                    }`}
                  >
                    All ({rows.length})
                  </button>
                  {sourceFiles.map(src => (
                    <button
                      key={src}
                      onClick={() => setFilterSource(src)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${
                        filterSource === src
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-muted-foreground border border-border hover:text-foreground'
                      }`}
                    >
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
                <table className="est-table" style={{ whiteSpace: 'nowrap', minWidth: sourceFiles.length > 1 ? '820px' : '700px' }}>
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
                      {sourceFiles.length > 1 && <th>File</th>}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, i) => {
                      const globalIdx = rows.indexOf(row);
                      return (
                        <tr key={globalIdx} className={!row.selected ? 'opacity-40' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              checked={row.selected}
                              onChange={e => updateRow(globalIdx, { selected: e.target.checked })}
                              className="cursor-pointer"
                            />
                          </td>
                          <td>
                            <input
                              className="est-input font-mono w-24 text-xs"
                              value={row.sku}
                              onChange={e => updateRow(globalIdx, { sku: e.target.value.toUpperCase() })}
                            />
                          </td>
                          <td>
                            <select
                              className="est-input text-xs w-20"
                              value={row.type}
                              onChange={e => updateRow(globalIdx, { type: e.target.value as CabinetType })}
                            >
                              {CABINET_TYPES.map(t => <option key={t}>{t}</option>)}
                            </select>
                          </td>
                          <td>
                            <select
                              className="est-input text-xs w-24"
                              value={row.room}
                              onChange={e => updateRow(globalIdx, { room: e.target.value as Room })}
                            >
                              {ROOMS.map(r => <option key={r}>{r}</option>)}
                            </select>
                          </td>
                          <td>
                            <input type="number" className="est-input text-xs w-16 text-right" value={row.width} min={1}
                              onChange={e => updateRow(globalIdx, { width: +e.target.value })} />
                          </td>
                          <td>
                            <input type="number" className="est-input text-xs w-16 text-right" value={row.height} min={1}
                              onChange={e => updateRow(globalIdx, { height: +e.target.value })} />
                          </td>
                          <td>
                            <input type="number" className="est-input text-xs w-16 text-right" value={row.depth} min={1}
                              onChange={e => updateRow(globalIdx, { depth: +e.target.value })} />
                          </td>
                          <td>
                            <input type="number" className="est-input text-xs w-14 text-right" value={row.quantity} min={1}
                              onChange={e => updateRow(globalIdx, { quantity: Math.max(1, +e.target.value) })} />
                          </td>
                          {sourceFiles.length > 1 && (
                            <td>
                              <span className="text-[10px] text-muted-foreground truncate max-w-[100px] block">
                                {(row.sourceFile ?? '').replace(/\.pdf$/i, '')}
                              </span>
                            </td>
                          )}
                          <td>
                            <button onClick={() => deleteRow(globalIdx)} className="p-1 hover:text-destructive text-muted-foreground" title="Remove row">
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
          <button
            onClick={() => { setStep('upload'); setRows([]); setQueuedFiles([]); setError(null); }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
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
                Import {selectedCount} cabinet{selectedCount !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
