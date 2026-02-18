import { useState, useRef, useCallback } from 'react';
import { FileUp, X, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import type { DetectedUnit, PDFExtractionResult } from '@/lib/pdfExtractor';
import type { UnitType } from '@/types/project';

const UNIT_TYPES: UnitType[] = ['Studio', '1BHK', '2BHK', '3BHK', '4BHK', 'Townhouse', 'Condo', 'Other'];

interface UnitRow {
  unitNumber: string;
  type: UnitType;
  selected: boolean;
  confidence: DetectedUnit['confidence'];
  page: number;
}

interface Props {
  onImport: (units: Array<{ unitNumber: string; type: UnitType }>) => void;
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
  const [defaultType, setDefaultType] = useState<UnitType>('1BHK');
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    if (!file.type.includes('pdf')) {
      setError('Please upload a PDF file.');
      return;
    }
    setError(null);
    setStep('processing');

    try {
      // Lazy import to avoid loading pdfjs on initial render
      const { extractUnitsFromPDF } = await import('@/lib/pdfExtractor');
      const res = await extractUnitsFromPDF(file);
      setResult(res);

      const initialRows: UnitRow[] = res.detectedUnits.map(u => ({
        unitNumber: u.unitNumber,
        type: defaultType,
        selected: u.confidence !== 'low',
        confidence: u.confidence,
        page: u.page,
      }));
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

  const handleImport = () => {
    const selected = rows.filter(r => r.selected).map(r => ({ unitNumber: r.unitNumber, type: r.type }));
    if (selected.length === 0) return;
    onImport(selected);
  };

  const confidenceBadge = (c: DetectedUnit['confidence']) => {
    const cls = c === 'high'
      ? 'bg-green-100 text-green-700'
      : c === 'medium'
      ? 'bg-yellow-100 text-yellow-700'
      : 'bg-gray-100 text-gray-500';
    return <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${cls}`}>{c}</span>;
  };

  const selectedCount = rows.filter(r => r.selected).length;

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
                Upload your architectural floor plan PDF. The system will scan for unit numbers and auto-populate the unit list.
              </p>

              {/* Default type picker */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Default Unit Type for Detected Units
                </label>
                <select
                  className="est-input"
                  value={defaultType}
                  onChange={e => setDefaultType(e.target.value as UnitType)}
                >
                  {UNIT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>

              {/* Drop zone */}
              <div
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                  dragging
                    ? 'border-primary bg-accent'
                    : 'border-border hover:border-primary hover:bg-accent/50'
                }`}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <FileUp size={36} className="mx-auto mb-3 text-muted-foreground" />
                <p className="font-semibold text-sm text-foreground">
                  Drop your architectural PDF here
                </p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={handleFile}
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <p>{error}</p>
                </div>
              )}

              <div className="text-xs text-muted-foreground bg-secondary rounded-lg p-3 border border-border">
                <strong>Works best with:</strong> Text-based PDFs with labeled unit numbers (e.g. "Unit 101", "APT 205", "#302"). 
                Scanned image-only PDFs may not yield results — you can still add units manually.
              </div>
            </div>
          )}

          {/* STEP: Processing */}
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 size={40} className="animate-spin text-primary" />
              <p className="font-semibold text-sm">Scanning PDF for unit numbers…</p>
              <p className="text-xs text-muted-foreground">This may take a moment for large files.</p>
            </div>
          )}

          {/* STEP: Review */}
          {step === 'review' && result && (
            <div className="space-y-4">
              {/* Summary bar */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary border border-border">
                <CheckCircle size={18} className="text-green-600 flex-shrink-0" />
                <div className="flex-1 text-sm">
                  <strong className="text-foreground">{result.detectedUnits.length} unit numbers detected</strong>
                  <span className="text-muted-foreground ml-2">across {result.totalPages} page{result.totalPages !== 1 ? 's' : ''} of "{result.fileName}"</span>
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

                  {/* Review table */}
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="est-table">
                      <thead>
                        <tr>
                          <th className="w-8">
                            <input
                              type="checkbox"
                              checked={selectedCount === rows.length}
                              onChange={e => toggleAll(e.target.checked)}
                              className="cursor-pointer"
                            />
                          </th>
                          <th>Unit #</th>
                          <th>Unit Type</th>
                          <th>Confidence</th>
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
                            <td className="font-mono font-bold">{row.unitNumber}</td>
                            <td>
                              <select
                                className="est-input"
                                value={row.type}
                                onChange={e => setRows(r => r.map((x, j) => j === i ? { ...x, type: e.target.value as UnitType } : x))}
                              >
                                {UNIT_TYPES.map(t => <option key={t}>{t}</option>)}
                              </select>
                            </td>
                            <td>{confidenceBadge(row.confidence)}</td>
                            <td className="text-muted-foreground text-xs">{row.page}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Raw text toggle */}
                  <button
                    onClick={() => setShowRawText(!showRawText)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showRawText ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {showRawText ? 'Hide' : 'Show'} extracted text
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
