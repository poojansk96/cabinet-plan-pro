import { useState, useRef, useCallback, useMemo } from 'react';
import { FileUp, X, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp, FileText, Tag, Building2 } from 'lucide-react';
import type { DetectedUnit, PDFExtractionResult } from '@/lib/pdfExtractor';
import type { UnitType } from '@/types/project';



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
  const [defaultType] = useState<string>(''); // empty = user must enter manually
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    if (!file.type.includes('pdf')) {
      setError('Please upload a PDF file.');
      return;
    }
    setError(null);
    setStep('processing');

    try {
      const { extractUnitsFromPDF } = await import('@/lib/pdfExtractor');
      const res = await extractUnitsFromPDF(file);
      setResult(res);

      const initialRows: UnitRow[] = res.detectedUnits.map(u => {
        const resolvedType = u.detectedType ?? '';
        return {
          unitNumber: u.unitNumber,
          type: resolvedType,
          detectedType: u.detectedType,
          detectedFloor: u.detectedFloor,
          detectedBldg: u.detectedBldg,
          floor: u.detectedFloor ?? '',
          bldg: u.detectedBldg ?? '',
          selected: u.confidence !== 'low',
          confidence: u.confidence,
          page: u.page,
          typeOverridden: false,
          floorOverridden: false,
          bldgOverridden: false,
        };
      });
      setRows(initialRows);
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
  }, [defaultType]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const toggleAll = (val: boolean) => setRows(r => r.map(row => ({ ...row, selected: val })));

  const setRowType  = (i: number, type: string)  => setRows(r => r.map((x, j) => j === i ? { ...x, type,  typeOverridden: true  } : x));
  const setRowFloor = (i: number, floor: string)  => setRows(r => r.map((x, j) => j === i ? { ...x, floor, floorOverridden: true } : x));
  const setRowBldg  = (i: number, bldg: string)   => setRows(r => r.map((x, j) => j === i ? { ...x, bldg,  bldgOverridden: true  } : x));

  const handleImport = () => {
    const selected = rows.filter(r => r.selected).map(r => ({ unitNumber: r.unitNumber, type: r.type as UnitType, floor: r.floor, bldg: r.bldg }));
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

  // Group rows by bldg label (empty bldg → "—"), then sort buildings and units ascending
  const grouped = useMemo(() => {
    const map = new Map<string, { globalIndex: number; row: UnitRow }[]>();
    rows.forEach((row, i) => {
      const key = row.bldg.trim() || '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ globalIndex: i, row });
    });

    const numericAsc = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

    // Sort buildings ascending (unknown last)
    const sorted = Array.from(map.entries()).sort(([a], [b]) => {
      if (a === '—') return 1;
      if (b === '—') return -1;
      return numericAsc(a, b);
    });

    // Sort units within each building: floor ascending, then unit number ascending
    sorted.forEach(([, entries]) => {
      entries.sort((a, b) => {
        const floorCmp = numericAsc(a.row.floor || '', b.row.floor || '');
        if (floorCmp !== 0) return floorCmp;
        return numericAsc(a.row.unitNumber, b.row.unitNumber);
      });
    });

    return sorted;
  }, [rows]);

  const toggleBldg = (bldgKey: string, val: boolean) => {
    const indices = new Set(
      grouped.find(([k]) => k === bldgKey)?.[1].map(g => g.globalIndex) ?? []
    );
    setRows(r => r.map((x, i) => indices.has(i) ? { ...x, selected: val } : x));
  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-primary" />
            <h2 className="font-bold text-base">Import Units from PDF Plan</h2>
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
                Upload your architectural floor plan PDF. The system will scan for unit numbers <strong>and unit type labels</strong> (e.g. "2BHK", "Studio", "Penthouse") written on the plan.
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
                <p><strong>Unit numbers detected from:</strong> "Unit 101", "APT 205", "#302", "Suite A", "1-01"</p>
                <p><strong>Unit types detected from:</strong> "2BHK", "2 Bed", "Studio", "Penthouse", "Type A", "Plan B"</p>
                <p><strong>Floor detected from:</strong> "Floor 1", "Level 3", "Ground Floor", bottom title block text</p>
                <p><strong>Building detected from:</strong> "Building 1", "Bldg A", "Block 2", "Tower B", "Wing C"</p>
                <p className="opacity-70 pt-1">Scanned image-only PDFs may yield no results — add units manually in that case.</p>
              </div>
            </div>
          )}

          {/* STEP: Processing */}
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 size={40} className="animate-spin text-primary" />
              <p className="font-semibold text-sm">Scanning PDF for unit numbers and types…</p>
              <p className="text-xs text-muted-foreground">This may take a moment for large files.</p>
            </div>
          )}

          {/* STEP: Review */}
          {step === 'review' && result && (
            <div className="space-y-4">
              {/* Summary bar */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary border border-border">
                <CheckCircle size={18} className="text-primary flex-shrink-0" />
                <div className="flex-1 text-sm">
                  <strong className="text-foreground">{result.detectedUnits.length} units detected</strong>
                  <span className="text-muted-foreground ml-2">
                    across {result.totalPages} page{result.totalPages !== 1 ? 's' : ''}
                  </span>
                  {detectedCount > 0 && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-primary bg-accent px-2 py-0.5 rounded-full border border-border">
                      <Tag size={10} />
                      {detectedCount} unit type{detectedCount !== 1 ? 's' : ''} auto-detected from PDF
                    </span>
                  )}
                </div>
              </div>

              {rows.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <AlertCircle size={32} className="mx-auto mb-2 opacity-40" />
                  <p>No unit numbers found in this PDF.</p>
                  <p className="text-xs mt-1">The PDF may be image-only. Please add units manually.</p>
                </div>
              ) : (
                <>
                  {/* Controls */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={() => toggleAll(true)} className="text-xs text-primary hover:underline">Select all</button>
                    <button onClick={() => toggleAll(false)} className="text-xs text-muted-foreground hover:underline">Deselect all</button>
                    <span className="text-xs text-muted-foreground ml-auto">{selectedCount} of {rows.length} selected</span>
                  </div>

                  {/* Grouped by building */}
                  <div className="space-y-3">
                    {grouped.map(([bldgKey, entries]) => {
                      const bldgSelected = entries.filter(e => e.row.selected).length;
                      const bldgTotal = entries.length;
                      const allBldgSelected = bldgSelected === bldgTotal;

                      return (
                        <div key={bldgKey} className="border border-border rounded-lg overflow-hidden">
                          {/* Building group header */}
                          <div className="flex items-center gap-2 px-3 py-2 bg-secondary border-b border-border">
                            <input
                              type="checkbox"
                              checked={allBldgSelected}
                              onChange={e => toggleBldg(bldgKey, e.target.checked)}
                              className="cursor-pointer"
                            />
                            <Building2 size={13} className="text-primary flex-shrink-0" />
                            <span className="text-xs font-semibold text-foreground">
                              {bldgKey === '—' ? 'No Building Detected' : bldgKey}
                            </span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {bldgSelected}/{bldgTotal} selected
                            </span>
                          </div>

                          <table className="est-table">
                            <thead>
                              <tr>
                                <th className="w-8"></th>
                                <th>Unit #</th>
                                <th>
                                  <span className="flex items-center gap-1">
                                    Unit Type
                                    <span className="text-[10px] font-normal text-muted-foreground">(PDF / override)</span>
                                  </span>
                                </th>
                                <th>Floor</th>
                                <th>Confidence</th>
                                <th>Page</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entries.map(({ globalIndex: i, row }) => (
                                <tr key={i} className={!row.selected ? 'opacity-40' : ''}>
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={row.selected}
                                      onChange={e => setRows(r => r.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))}
                                      className="cursor-pointer"
                                    />
                                  </td>
                                  <td className="font-mono font-bold">{row.unitNumber}</td>
                                   <td>
                                    <div className="flex items-center gap-1.5">
                                      {row.detectedType && (
                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent text-primary border border-border flex-shrink-0" title="Detected from PDF text">
                                          <Tag size={8} />PDF
                                        </span>
                                      )}
                                      <input
                                        className="est-input w-full text-xs"
                                        value={row.type}
                                        placeholder="Enter type (e.g. 2BHK, Studio…)"
                                        onChange={e => setRowType(i, e.target.value)}
                                      />
                                    </div>
                                  </td>
                                  {/* Floor — editable inline */}
                                  <td>
                                    <div className="flex items-center gap-1">
                                      {row.detectedFloor && !row.floorOverridden && (
                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent text-primary border border-border flex-shrink-0" title="Detected from PDF">
                                          <Tag size={8} />PDF
                                        </span>
                                      )}
                                      <input className="est-input text-xs w-16" value={row.floor} placeholder="e.g. 1" onChange={e => setRowFloor(i, e.target.value)} />
                                    </div>
                                  </td>
                                  <td>{confidenceBadge(row.confidence)}</td>
                                  <td className="text-muted-foreground text-xs">{row.page}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>

                  {/* Raw text toggle */}
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
            onClick={() => { setStep('upload'); setResult(null); setRows([]); }}
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
