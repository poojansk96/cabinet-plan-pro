import { useState, useRef, useCallback, useEffect } from 'react';
import { FileUp, X, Loader2, CheckCircle, AlertCircle, Sparkles, Trash2, LayoutGrid, FileText, Search, Building2 } from 'lucide-react';
import { toast } from 'sonner';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-pdf-unit-types`;

export interface UnitMappingRow {
  unitNumber: string;
  unitType: string;
  bldg: string;
  floor: string;
  selected: boolean;
  conflict?: string; // description of cross-page mismatch
}

interface PageSighting {
  unitNumber: string;
  unitType: string;
  bldg: string;
  floor: string;
  page: number;
  file: string;
}

interface Props {
  onImport: (rows: Omit<UnitMappingRow, 'selected'>[]) => void;
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

async function renderPageToBase64(page: any): Promise<string> {
  const MAX_PX = 4096;
  const baseViewport = page.getViewport({ scale: 1 });
  const longSide = Math.max(baseViewport.width, baseViewport.height);
  // Use higher scale (up to 5) for better title block readability
  const scale = Math.min(5, MAX_PX / longSide);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  // Use higher quality JPEG for better text clarity
  return canvas.toDataURL('image/jpeg', 0.98).split(',')[1];
}

type Step = 'upload' | 'processing' | 'review';

export default function UnitTypeImportDialog({ onImport, onClose, prefinalPerson }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<UnitMappingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * QUOTES.length));
  const [personalQuoteIndex, setPersonalQuoteIndex] = useState(() => Math.floor(Math.random() * PERSONAL_QUOTES.length));
  const [quoteVisible, setQuoteVisible] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // Rotate quotes every 4s during processing
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

  const processFiles = async (files: File[]) => {
    const nonPdfs = files.filter(f => !f.type.includes('pdf'));
    if (nonPdfs.length) { setError(`Only PDF files supported.`); return; }
    setError(null);
    setStep('processing');

    try {
      setProgress(8);
      const pdfjsLib = (await import('pdfjs-dist')) as any;
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

      // Track every sighting of each unit across pages
      const sightings: Map<string, PageSighting[]> = new Map();

      // Count total pages across all PDFs for progress tracking
      const pdfs: { file: File; pdf: any }[] = [];
      let totalPages = 0;
      for (const file of files) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        pdfs.push({ file, pdf });
        totalPages += pdf.numPages; // Process ALL pages to find title pages
      }
      setProgress(10);

      let pagesProcessed = 0;
      for (const { file, pdf } of pdfs) {
        // Scan ALL pages — the AI will identify title pages and skip others
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const pageImage = await renderPageToBase64(page);

          const fetchWithRetry = async (attempts = 3): Promise<Response> => {
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
                if ((res.status === 503 || res.status === 500) && attempt < attempts) {
                  console.warn(`Page ${p} attempt ${attempt}: AI unavailable (${res.status}), retrying in ${3 * attempt}s…`);
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

          const pageUnits = data.units ?? [];
          console.log(`Page ${p}/${pdf.numPages} of "${file.name}": found ${pageUnits.length} unit(s)`, pageUnits);

          const keyPart = (v: string) => v.toUpperCase().replace(/\s+/g, '').trim();

          for (const u of pageUnits) {
            const num = String(u.unitNumber ?? '').trim();
            const type = String(u.unitType ?? '').trim();
            const bldg = String(u.bldg ?? '').trim();
            const floor = String(u.floor ?? '').trim();
            if (!num || !type) continue;

            const sightingKey = `${keyPart(num)}|${keyPart(bldg)}|${keyPart(floor)}`;
            const nextSighting: PageSighting = { unitNumber: num, unitType: type, bldg, floor, page: p, file: file.name };
            const existing = sightings.get(sightingKey);
            if (existing) existing.push(nextSighting);
            else sightings.set(sightingKey, [nextSighting]);
          }

          pagesProcessed++;
          setProgress(10 + Math.round((pagesProcessed / totalPages) * 85));
        }
      }

      // Build rows with cross-page conflict detection
      const result: UnitMappingRow[] = [];
      for (const pages of sightings.values()) {
        // Use the last sighting as the "primary" value (most detailed page usually comes later)
        const primary = pages[pages.length - 1];
        let conflict: string | undefined;

        // Check for mismatches across pages
        const uniqueTypes = [...new Set(pages.map(p => p.unitType).filter(Boolean))];
        const uniqueBldgs = [...new Set(pages.map(p => p.bldg).filter(Boolean))];
        const uniqueFloors = [...new Set(pages.map(p => p.floor).filter(Boolean))];

        const mismatches: string[] = [];
        if (uniqueTypes.length > 1) {
          mismatches.push(`Type: ${uniqueTypes.map((t, i) => `"${t}" (pg ${pages.filter(p => p.unitType === t).map(p => p.page).join(',')})`).join(' vs ')}`);
        }
        if (uniqueBldgs.length > 1) {
          mismatches.push(`Bldg: ${uniqueBldgs.map((b) => `"${b}" (pg ${pages.filter(p => p.bldg === b).map(p => p.page).join(',')})`).join(' vs ')}`);
        }
        if (uniqueFloors.length > 1) {
          mismatches.push(`Floor: ${uniqueFloors.map((f) => `"${f}" (pg ${pages.filter(p => p.floor === f).map(p => p.page).join(',')})`).join(' vs ')}`);
        }

        if (mismatches.length > 0) {
          conflict = mismatches.join('; ');
        }

        result.push({
          unitNumber: primary.unitNumber,
          unitType: primary.unitType,
          bldg: primary.bldg,
          floor: primary.floor,
          selected: true,
          conflict,
        });
      }

      result.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));

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

              {/* Cross-page conflict warning */}
              {(() => {
                const conflictRows = rows.filter(r => r.conflict);
                if (!conflictRows.length) return null;
                return (
                  <div className="p-3 rounded-lg border border-yellow-500/50 bg-yellow-500/10 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-yellow-700 dark:text-yellow-400">
                      <AlertCircle size={16} />
                      <span>{conflictRows.length} unit{conflictRows.length !== 1 ? 's' : ''} with cross-page mismatches</span>
                    </div>
                    <div className="text-xs text-yellow-700/80 dark:text-yellow-400/80 space-y-1 max-h-32 overflow-auto">
                      {conflictRows.map(r => (
                        <p key={r.unitNumber}>
                          <strong>{r.unitNumber}:</strong> {r.conflict}
                        </p>
                      ))}
                    </div>
                    <p className="text-[10px] text-yellow-600/70 dark:text-yellow-400/60">
                      The same unit was read differently on different pages. Review highlighted rows below and correct as needed.
                    </p>
                  </div>
                );
              })()}

              {/* Per-floor summary */}
              {(() => {
                const floorMap: Record<string, number> = {};
                for (const r of rows) {
                  let floor = '?';
                  const num = r.unitNumber.replace(/[^0-9]/g, '');
                  if (num.length >= 3) {
                    floor = num.slice(0, num.length - 2);
                  } else if (num.length === 2) {
                    floor = num[0];
                  } else if (num.length === 1) {
                    floor = num;
                  }
                  const label = floor === '?' ? 'Other' : `Floor ${floor}`;
                  floorMap[label] = (floorMap[label] || 0) + 1;
                }
                const floors = Object.entries(floorMap).sort((a, b) => {
                  const numA = parseInt(a[0].replace(/\D/g, ''));
                  const numB = parseInt(b[0].replace(/\D/g, ''));
                  if (isNaN(numA) && isNaN(numB)) return 0;
                  if (isNaN(numA)) return 1;
                  if (isNaN(numB)) return -1;
                  return numA - numB;
                });
                return (
                  <div className="flex flex-wrap gap-2">
                    {floors.map(([label, count]) => (
                      <div key={label} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-accent border border-border text-xs">
                        <Building2 size={12} className="text-primary" />
                        <span className="font-medium text-foreground">{label}</span>
                        <span className="text-muted-foreground">— {count} unit{count !== 1 ? 's' : ''}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

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
                      <th className="text-left">Bldg</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className={`${!row.selected ? 'opacity-40' : ''} ${row.conflict ? 'bg-yellow-500/10' : ''}`} title={row.conflict || undefined}>
                        <td>
                          <input type="checkbox" checked={row.selected} onChange={e => updateRow(i, { selected: e.target.checked })} className="cursor-pointer" />
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            {row.conflict && <AlertCircle size={12} className="text-yellow-500 flex-shrink-0" />}
                            <input
                              className="est-input text-xs w-24"
                              value={row.unitNumber}
                              onChange={e => updateRow(i, { unitNumber: e.target.value })}
                            />
                          </div>
                        </td>
                        <td>
                          <input
                            className="est-input text-xs w-full"
                            value={row.unitType}
                            onChange={e => updateRow(i, { unitType: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className="est-input text-xs w-24"
                            value={row.bldg}
                            onChange={e => updateRow(i, { bldg: e.target.value })}
                            placeholder="—"
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
