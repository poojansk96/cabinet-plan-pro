import { useState, useRef, useCallback } from 'react';
import { FileUp, X, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp, FileText, Tag, Sparkles } from 'lucide-react';
import type { DetectedUnit, PDFExtractionResult } from '@/lib/pdfExtractor';
import type { UnitType } from '@/types/project';
import { toast } from 'sonner';

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
}

type Step = 'upload' | 'processing' | 'review';

export default function PDFImportDialog({ onImport, onClose }: Props) {
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
  const fileRef = useRef<HTMLInputElement>(null);

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
      setProgress(30);

      // Step 2: Re-extract page texts for AI (pdfjs already loaded)
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
      for (let p = 1; p <= totalPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const text = content.items
          .filter((item: any) => 'str' in item)
          .map((item: any) => item.str)
          .join(' ');
        pageTexts.push(text);
        // Progress 30→60 during page extraction
        setProgress(30 + Math.round((p / totalPages) * 30));
        setProgressLabel(`Reading page ${p} of ${totalPages}`);
      }

      // Step 3: Call AI edge function
      setProcessingStatus('AI is analyzing floor plans for units with cabinets/countertops…');
      setProgress(65);
      setProgressLabel('AI analyzing…');
      let detectedUnits: DetectedUnit[] = res.detectedUnits;

      const aiResponse = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageTexts }),
      });

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        if (aiData.detectedUnits && aiData.detectedUnits.length > 0) {
          detectedUnits = aiData.detectedUnits;
          setUsedAI(true);
        }
      } else if (aiResponse.status === 429) {
        toast.error('AI rate limit reached. Using standard detection instead.');
      } else if (aiResponse.status === 402) {
        toast.error('AI credits exhausted. Using standard detection instead.');
      } else {
        toast.warning('AI analysis unavailable. Using standard detection.');
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
        const fa = parseFloat(a.floor) || 0;
        const fb = parseFloat(b.floor) || 0;
        if (fa !== fb) return fa - fb;
        return a.floor.localeCompare(b.floor, undefined, { numeric: true });
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

              {/* Status text */}
              <div className="text-center space-y-1 max-w-xs">
                <p className="font-semibold text-sm text-foreground leading-snug">{processingStatus}</p>
                {progressLabel && (
                  <p className="text-xs text-muted-foreground">{progressLabel}</p>
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

              {rows.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <AlertCircle size={32} className="mx-auto mb-2 opacity-40" />
                  <p>No units with cabinet/countertop drawings found.</p>
                  <p className="text-xs mt-1">The PDF may be image-only or have no kitchen content. Please add units manually.</p>
                </div>
              ) : (
                <>
                  {/* Building name banner */}
                  {(() => {
                    const noBldg = rows.every(r => !r.bldg.trim());
                    const someMissingBldg = !noBldg && rows.some(r => !r.bldg.trim());
                    const allHaveBldg = rows.every(r => r.bldg.trim());
                    return (
                      <div className={`flex items-center gap-2 p-3 rounded-lg border ${noBldg ? 'bg-amber-50 border-amber-300' : allHaveBldg ? 'bg-secondary border-border' : 'bg-secondary border-border'}`}>
                        <div className="flex flex-col gap-0.5 flex-shrink-0">
                          <span className={`text-xs font-semibold whitespace-nowrap ${noBldg ? 'text-amber-800' : 'text-foreground'}`}>
                            {noBldg ? '⚠ Building not detected — enter name:' : someMissingBldg ? 'Building (apply to empty rows):' : '🏢 Building detected — apply to all:'}
                          </span>
                        </div>
                        <input
                          className="est-input text-xs flex-1 min-w-0"
                          placeholder="e.g. Building A, Bldg 1, North Tower…"
                          value={bulkBldg}
                          onChange={e => setBulkBldg(e.target.value)}
                          autoFocus={noBldg}
                        />
                        <button
                          onClick={() => {
                            if (!bulkBldg.trim()) return;
                            setRows(r => r.map(x => ({ ...x, bldg: bulkBldg.trim(), bldgOverridden: true })));
                          }}
                          className="px-3 py-1 rounded text-xs font-medium text-white flex-shrink-0"
                          style={{ background: noBldg ? 'hsl(32 95% 44%)' : 'hsl(var(--primary))' }}
                        >
                          Apply to All
                        </button>
                      </div>
                    );
                  })()}

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
                                className="est-input text-xs w-16"
                                value={row.floor}
                                placeholder="e.g. 1"
                                onChange={e => setRowFloor(i, e.target.value)}
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
