import React, { useState } from 'react';
import { FileUp, Users, LayoutGrid, Plus, Trash2, RotateCcw, Pencil, Square } from 'lucide-react';
import type { Project, Unit, Cabinet } from '@/types/project';
import { type LabelRow } from './ShopDrawingImportDialog';
import ShopDrawingImportDialog from './ShopDrawingImportDialog';
import UnitTypeImportDialog from './UnitTypeImportDialog';
import StonePDFImportDialog, { type StoneExtractedRow } from './StonePDFImportDialog';
import { usePrefinalStore, type PrefinalStoneRow } from '@/hooks/usePrefinalStore';

interface Props {
  project: Project;
  selectedUnit?: Unit;
  selectedUnitId?: string | null;
  setSelectedUnitId?: (id: string) => void;
  addCabinet: (projectId: string, unitId: string, data: Omit<Cabinet, 'id'>) => Cabinet;
  updateCabinet: (projectId: string, unitId: string, cabinetId: string, data: Partial<Cabinet>) => void;
  deleteCabinet: (projectId: string, unitId: string, cabinetId: string) => void;
  section?: 'units' | 'cabinets' | 'mismatch';
  showMismatchToggle?: boolean;
  [key: string]: unknown;
}

function normalizeUnitType(raw: string): string {
  let s = raw.trim();
  const hasTypePrefix = /^type\s+/i.test(s);
  s = s.replace(/^type\s+/i, '');
  s = s.replace(/\s*-\s*/g, '-');
  s = s.toUpperCase();
  if (hasTypePrefix) s = 'TYPE ' + s;
  return s;
}

export default function PreFinalModule({ project }: Props) {
  const [activeSubTab, setActiveSubTab] = useState<'units' | 'cabinets' | 'stone'>('units');
  const store = usePrefinalStore(project.id);

  // ── Unit Count state ──────────────────────────────────────────────────────
  const [showUnitImport, setShowUnitImport] = useState(false);
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [newUnitType, setNewUnitType] = useState('');
  const [newUnitNumber, setNewUnitNumber] = useState('');
  const [showAddUnitNumber, setShowAddUnitNumber] = useState(false);
  const [editingType, setEditingType] = useState<string | null>(null);
  const [editingTypeValue, setEditingTypeValue] = useState('');
  const [unitImportedCount, setUnitImportedCount] = useState<number | null>(null);

  // ── Cabinet Count state ───────────────────────────────────────────────────
  const [showCabinetImport, setShowCabinetImport] = useState(false);
  const [importTargetType, setImportTargetType] = useState('');
  const [cabinetImportedCount, setCabinetImportedCount] = useState<number | null>(null);
  const [cabinetChecks, setCabinetChecks] = useState<Record<string, boolean>>({});

  // ── Stone SQFT state ──────────────────────────────────────────────────
  const [showStoneImport, setShowStoneImport] = useState(false);
  const [stoneImportedCount, setStoneImportedCount] = useState<number | null>(null);

  // ── Unit import handler ───────────────────────────────────────────────────
  const handleUnitImport = (rows: { unitNumber: string; unitType: string; bldg: string }[], typeOrder?: string[]) => {
    const normalized = rows.map(r => ({ ...r, unitType: normalizeUnitType(r.unitType) }));
    // Use PDF page order if provided, otherwise fall back to Set insertion order
    const normalizedOrder = typeOrder?.map(t => normalizeUnitType(t)) ?? [];
    const orderedTypes = normalizedOrder.length > 0
      ? normalizedOrder.filter((t, i, arr) => arr.indexOf(t) === i) // deduplicate preserving order
      : Array.from(new Set(normalized.map(r => r.unitType)));
    // Add any types from rows that weren't in the order list
    const remaining = Array.from(new Set(normalized.map(r => r.unitType))).filter(t => !orderedTypes.includes(t));
    const finalTypes = [...orderedTypes, ...remaining];
    store.addUnitTypes(finalTypes);
    store.importUnitMappings(normalized);
    setUnitImportedCount(normalized.length);
    setTimeout(() => setUnitImportedCount(null), 4000);
  };

  // ── Cabinet import handler ────────────────────────────────────────────────
  const handleCabinetImport = (rows: Omit<LabelRow, 'selected' | 'sourceFile'>[], detectedUnitType?: string) => {
    const rowsByType = new Map<string, typeof rows>();
    for (const row of rows) {
      const rawType = (row as any).detectedUnitType || detectedUnitType || importTargetType || '';
      const targetType = rawType ? normalizeUnitType(rawType) : '';
      const finalType = targetType || 'Unassigned';
      if (!rowsByType.has(finalType)) rowsByType.set(finalType, []);
      rowsByType.get(finalType)!.push(row);
    }
    for (const [unitType, typeRows] of rowsByType) {
      if (unitType !== 'Unassigned') {
        store.addCabinetUnitTypes([unitType]);
      }
      store.addCabinetImport(
        typeRows.map(r => ({ sku: r.sku, type: r.type, room: r.room, quantity: r.quantity, unitType })),
        unitType
      );
    }
    setCabinetImportedCount(rows.length);
    setShowCabinetImport(false);
    const firstType = Array.from(rowsByType.keys())[0];
    if (firstType && firstType !== 'Unassigned') setImportTargetType(firstType);
    setTimeout(() => setCabinetImportedCount(null), 4000);
  };
  // ── Stone import handler ────────────────────────────────────────────────
  const handleStoneImport = (rows: StoneExtractedRow[], detectedUnitType?: string) => {
    const targetType = detectedUnitType ? normalizeUnitType(detectedUnitType) : 'Unassigned';
    store.addStoneUnitTypes([targetType]);
    const stoneRows: PrefinalStoneRow[] = rows.filter(r => r.selected !== false).map(r => ({
      label: r.label,
      length: r.length,
      depth: r.depth,
      splashHeight: r.splashHeight,
      isIsland: r.isIsland,
      room: r.room,
      unitType: targetType,
    }));
    store.addStoneImport(stoneRows, targetType);
    setStoneImportedCount(stoneRows.length);
    setShowStoneImport(false);
    setTimeout(() => setStoneImportedCount(null), 4000);
  };

  // ── Stone pivot ─────────────────────────────────────────────────────────
  const stoneUnitTypes = (() => {
    const seen = new Set<string>();
    return store.stoneUnitTypes.filter(t => {
      const key = t.toUpperCase().replace(/^TYPE\s+/, '').replace(/\s+/g, '').replace(/-/g, '').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  const calcStoneSqft = (row: PrefinalStoneRow): number => {
    const effectiveDepth = row.depth + (row.splashHeight ?? 0);
    return Math.ceil((row.length * effectiveDepth) / 144);
  };


  const cabUnitTypes = (() => {
    const seen = new Set<string>();
    return store.cabinetUnitTypes.filter(t => {
      const key = t.toUpperCase().replace(/^TYPE\s+/, '').replace(/\s+/g, '').replace(/-/g, '').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();
  const allSkus = Array.from(new Set(store.cabinetRows.map(r => r.sku))).sort();
  const skuTypeQty: Record<string, Record<string, number>> = {};
  const skuCabType: Record<string, string> = {};
  store.cabinetRows.forEach(r => {
    if (!skuTypeQty[r.sku]) skuTypeQty[r.sku] = {};
    skuTypeQty[r.sku][r.unitType] = Math.max(skuTypeQty[r.sku][r.unitType] || 0, r.quantity);
    if (!skuCabType[r.sku]) skuCabType[r.sku] = r.type;
  });

  const parseSkuDims = (sku: string): { width: number; height: number } => {
    const match = sku.replace(/\s/g, '').match(/^[A-Za-z]+(\d+)/);
    if (!match) return { width: 0, height: 0 };
    const digits = match[1];
    if (digits.length === 4) return { width: Number(digits.slice(0, 2)), height: Number(digits.slice(2, 4)) };
    if (digits.length === 3) return { width: Number(digits.slice(0, 1)), height: Number(digits.slice(1, 3)) };
    if (digits.length === 2) return { width: Number(digits), height: 0 };
    return { width: Number(digits), height: 0 };
  };

  const sortSkusForGroup = (skus: string[], group: string): string[] => {
    if (group === 'Wall') {
      return [...skus].sort((a, b) => {
        const da = parseSkuDims(a), db = parseSkuDims(b);
        if (da.height !== db.height) return da.height - db.height;
        return da.width - db.width;
      });
    }
    if (group === 'Base') {
      return [...skus].sort((a, b) => {
        const da = parseSkuDims(a), db = parseSkuDims(b);
        if (da.width !== db.width) return da.width - db.width;
        return da.height - db.height;
      });
    }
    return skus;
  };

  const CAB_TYPE_ORDER = ['Wall', 'Base', 'Tall', 'Vanity', 'Accessory'];
  const groupedSkus: { group: string; skus: string[] }[] = (() => {
    const groups: Record<string, string[]> = {};
    for (const sku of allSkus) {
      const t = skuCabType[sku] || 'Other';
      if (!groups[t]) groups[t] = [];
      groups[t].push(sku);
    }
    const ordered: { group: string; skus: string[] }[] = [];
    for (const g of CAB_TYPE_ORDER) {
      if (groups[g]) { ordered.push({ group: g, skus: sortSkusForGroup(groups[g], g) }); delete groups[g]; }
    }
    for (const [g, skus] of Object.entries(groups)) {
      ordered.push({ group: g, skus: sortSkusForGroup(skus, g) });
    }
    return ordered;
  })();

  const unitTypeTotal = (type: string) =>
    store.unitNumbers.filter(u => u.assignments[type]).length;

  return (
    <div className="space-y-4">
      {/* Unit Import Dialog */}
      {showUnitImport && (
        <UnitTypeImportDialog
          onImport={(rows) => {
            handleUnitImport(rows);
            setShowUnitImport(false);
          }}
          onClose={() => setShowUnitImport(false)}
          prefinalPerson={project.specs?.takeoffPerson}
        />
      )}

      {/* Cabinet Import Dialog */}
      {showCabinetImport && (
        <ShopDrawingImportDialog
          onImport={(rows, detectedUnitType) => {
            handleCabinetImport(rows, detectedUnitType);
          }}
          onClose={() => setShowCabinetImport(false)}
          prefinalPerson={project.specs?.takeoffPerson}
        />
      )}

      {/* Stone Import Dialog */}
      {showStoneImport && (
        <StonePDFImportDialog
          onImport={(rows, detectedUnitType) => handleStoneImport(rows, detectedUnitType)}
          onClose={() => setShowStoneImport(false)}
          prefinalPerson={project.specs?.takeoffPerson}
        />
      )}

      {/* Sub-tab toggle */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setActiveSubTab('units')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors ${activeSubTab === 'units' ? 'text-white' : 'text-muted-foreground border border-border hover:bg-secondary'}`}
          style={activeSubTab === 'units' ? { background: 'hsl(var(--primary))' } : {}}
        >
          <Users size={13} /> Unit Count
        </button>
        <button
          onClick={() => setActiveSubTab('cabinets')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors ${activeSubTab === 'cabinets' ? 'text-white' : 'text-muted-foreground border border-border hover:bg-secondary'}`}
          style={activeSubTab === 'cabinets' ? { background: 'hsl(var(--primary))' } : {}}
        >
          <LayoutGrid size={13} /> Cabinet Count
        </button>
        <button
          onClick={() => setActiveSubTab('stone')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors ${activeSubTab === 'stone' ? 'text-white' : 'text-muted-foreground border border-border hover:bg-secondary'}`}
          style={activeSubTab === 'stone' ? { background: 'hsl(var(--primary))' } : {}}
        >
          <Square size={13} /> Stone - SQFT
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* UNIT COUNT SUB-TAB                                                 */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeSubTab === 'units' && (
        <>

          {unitImportedCount !== null && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white" style={{ background: 'hsl(142 71% 45%)' }}>
              ✓ Successfully imported {unitImportedCount} unit type{unitImportedCount !== 1 ? 's' : ''} from shop drawing
            </div>
          )}

          <div className="est-card overflow-hidden">
            <div className="est-section-header flex items-center gap-2 flex-wrap">
              <Users size={13} className="flex-shrink-0" />
              Pre-Final Unit Count

              <div className="ml-auto flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setShowUnitImport(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white transition-colors"
                  style={{ background: 'hsl(var(--primary))' }}
                >
                  <FileUp size={12} /> Import from PDF
                </button>
                {(store.unitTypes.length > 0 || store.unitNumbers.length > 0) && (
                  <button
                    onClick={() => { if (confirm('Clear all unit count data?')) store.clearUnits(); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-destructive border border-border hover:border-destructive transition-colors"
                  >
                    <RotateCcw size={11} /> Clear
                  </button>
                )}
                <button
                  onClick={() => setShowAddUnit(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus size={12} /> Add Unit Type
                </button>
                {store.unitTypes.length > 0 && (
                  <button
                    onClick={() => setShowAddUnitNumber(v => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus size={12} /> Add Unit #
                  </button>
                )}
              </div>
            </div>

            {showAddUnit && (
              <div className="px-4 py-3 border-b border-border bg-accent/30 flex items-center gap-3 flex-wrap">
                <input
                  className="est-input text-xs h-7 w-36"
                  placeholder="Unit type (e.g. 2BHK)"
                  value={newUnitType}
                  onChange={e => setNewUnitType(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newUnitType.trim()) {
                      store.addUnitTypes([newUnitType.trim()]);
                      setNewUnitType(''); setShowAddUnit(false);
                    }
                  }}
                  autoFocus
                />
                <button
                  onClick={() => {
                    if (!newUnitType.trim()) return;
                    store.addUnitTypes([newUnitType.trim()]);
                    setNewUnitType(''); setShowAddUnit(false);
                  }}
                  className="px-3 py-1 rounded text-xs font-semibold text-white"
                  style={{ background: 'hsl(var(--primary))' }}
                >
                  Add
                </button>
                <button onClick={() => setShowAddUnit(false)} className="text-xs text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </div>
            )}

            {showAddUnitNumber && (
              <div className="px-4 py-3 border-b border-border bg-accent/30 flex items-center gap-3 flex-wrap">
                <input
                  className="est-input text-xs h-7 w-36"
                  placeholder="Unit # (e.g. 101)"
                  value={newUnitNumber}
                  onChange={e => setNewUnitNumber(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newUnitNumber.trim()) {
                      store.addUnitNumber(newUnitNumber.trim());
                      setNewUnitNumber(''); setShowAddUnitNumber(false);
                    }
                  }}
                  autoFocus
                />
                <button
                  onClick={() => {
                    if (!newUnitNumber.trim()) return;
                    store.addUnitNumber(newUnitNumber.trim());
                    setNewUnitNumber(''); setShowAddUnitNumber(false);
                  }}
                  className="px-3 py-1 rounded text-xs font-semibold text-white"
                  style={{ background: 'hsl(var(--primary))' }}
                >
                  Add
                </button>
                <button onClick={() => setShowAddUnitNumber(false)} className="text-xs text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </div>
            )}

            {store.unitTypes.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                No data yet — import a 2020 shop drawing PDF or add unit types manually.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="est-table" style={{ whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr style={{ height: '120px', verticalAlign: 'bottom' }}>
                      <th className="text-left" style={{ verticalAlign: 'bottom' }}>Unit #</th>
                      <th className="text-left" style={{ verticalAlign: 'bottom' }}>Bldg</th>
                      <th className="text-left" style={{ verticalAlign: 'bottom' }}>Floor</th>
                      {store.unitTypes.map(type => (
                        <th key={type} className="text-center" style={{ verticalAlign: 'bottom', padding: '0', minWidth: '42px' }}>
                          <div className="flex flex-col items-center gap-1 py-2" style={{ background: 'hsl(213 72% 35%)', color: '#fff', borderRadius: '4px 4px 0 0', width: '100%' }}>
                            {editingType === type ? (
                              <input
                                className="bg-white/20 text-white text-[11px] font-bold border border-white/40 rounded px-1 py-0.5 w-full text-center outline-none"
                                style={{ maxWidth: '38px' }}
                                value={editingTypeValue}
                                onChange={e => setEditingTypeValue(e.target.value)}
                                onBlur={() => {
                                  if (editingTypeValue.trim() && editingTypeValue.trim() !== type) {
                                    store.renameUnitType(type, editingTypeValue.trim());
                                  }
                                  setEditingType(null);
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                  if (e.key === 'Escape') setEditingType(null);
                                }}
                                autoFocus
                              />
                            ) : (
                              <div
                                onDoubleClick={() => { setEditingType(type); setEditingTypeValue(type); }}
                                className="cursor-pointer"
                                title="Double-click to rename"
                                style={{
                                  writingMode: 'vertical-rl',
                                  transform: 'rotate(180deg)',
                                  whiteSpace: 'nowrap',
                                  fontWeight: 700,
                                  fontSize: '11px',
                                  height: '90px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  letterSpacing: '0.05em',
                                }}>
                                {type}
                              </div>
                            )}
                            <button
                              onClick={() => store.deleteUnitType(type)}
                              className="transition-colors mt-0.5 opacity-50 hover:opacity-100"
                              style={{ color: '#fca5a5' }}
                              title={`Remove ${type}`}
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </th>
                      ))}
                      <th className="w-8" style={{ verticalAlign: 'bottom' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {store.unitNumbers.length === 0 ? (
                      <tr>
                        <td colSpan={store.unitTypes.length + 4} className="text-center text-muted-foreground text-xs py-6">
                          No unit numbers added yet — click "Add Unit #" to start assigning units to types.
                        </td>
                      </tr>
                    ) : (
                      store.unitNumbers.map((unit, i) => (
                        <tr key={i}>
                          <td className="font-medium">
                            <input
                              className="est-input text-xs w-20"
                              value={unit.name}
                              onChange={e => store.updateUnitNumberName(i, e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              className="est-input text-xs w-20"
                              value={unit.bldg || ''}
                              onChange={e => store.updateUnitNumberBldg(i, e.target.value)}
                              placeholder="—"
                            />
                          </td>
                          <td>
                            <input
                              className="est-input text-xs w-16"
                              value={unit.floor || ''}
                              onChange={e => store.updateUnitNumberFloor(i, e.target.value)}
                              placeholder="—"
                            />
                          </td>
                          {store.unitTypes.map(type => (
                            <td key={type} className="text-center">
                              <button
                                onClick={() => store.toggleAssignment(i, type)}
                                className={`w-6 h-6 rounded border text-xs font-bold transition-colors ${
                                  unit.assignments[type]
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'border-border text-transparent hover:border-muted-foreground'
                                }`}
                              >
                                1
                              </button>
                            </td>
                          ))}
                          <td>
                            <button onClick={() => store.deleteUnitNumber(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold border-t border-border">
                      <td>Total</td>
                      <td></td>
                      <td></td>
                      {store.unitTypes.map(type => (
                        <td key={type} className="text-center font-mono">{unitTypeTotal(type) || ''}</td>
                      ))}
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* CABINET COUNT SUB-TAB                                              */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeSubTab === 'cabinets' && (
        <>

          {cabinetImportedCount !== null && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white" style={{ background: 'hsl(142 71% 45%)' }}>
              ✓ Successfully imported {cabinetImportedCount} label{cabinetImportedCount !== 1 ? 's' : ''} from shop drawing
              {importTargetType && <span className="opacity-80 ml-1">for "{importTargetType}"</span>}
            </div>
          )}

          <div className="est-card overflow-hidden">
            <div className="est-section-header flex items-center gap-2 flex-wrap">
              <LayoutGrid size={13} className="flex-shrink-0" />
              Pre-Final Cabinet Count

              <div className="ml-auto flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setShowCabinetImport(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white transition-colors"
                  style={{ background: 'hsl(var(--primary))' }}
                >
                  <FileUp size={12} /> Import from PDF
                </button>
                {store.cabinetRows.length > 0 && (
                  <button
                    onClick={() => { if (confirm('Clear all cabinet import data?')) store.clearCabinets(); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-destructive border border-border hover:border-destructive transition-colors"
                  >
                    <RotateCcw size={11} /> Clear
                  </button>
                )}
                <div className="flex items-center gap-3 border border-border rounded px-3 py-1.5 bg-background">
                  {['CM8', 'LR8', 'TK8', 'TF3X96-Molding', 'Scribe', 'OCM8'].map(item => (
                    <label key={item} className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-foreground select-none">
                      <input
                        type="checkbox"
                        checked={cabinetChecks[item] || false}
                        onChange={e => setCabinetChecks(prev => ({ ...prev, [item]: e.target.checked }))}
                        className="h-3.5 w-3.5 rounded border-border accent-primary"
                      />
                      {item}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {allSkus.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                Import a 2020 shop drawing PDF to extract cabinet and accessory labels.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="est-table" style={{ whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr style={{ height: '120px', verticalAlign: 'bottom' }}>
                      <th className="text-left" style={{ verticalAlign: 'bottom' }}>SKU Name</th>
                      {cabUnitTypes.map(type => (
                        <th key={type} className="text-center" style={{ verticalAlign: 'bottom', padding: '0', minWidth: '42px' }}>
                          <div style={{
                            background: 'hsl(213 72% 35%)',
                            color: '#fff',
                            writingMode: 'vertical-rl',
                            transform: 'rotate(180deg)',
                            whiteSpace: 'nowrap',
                            fontWeight: 700,
                            fontSize: '11px',
                            height: '100px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            letterSpacing: '0.05em',
                            width: '100%',
                            borderRadius: '4px 4px 0 0',
                          }}>
                            {type}
                          </div>
                        </th>
                      ))}
                      <th className="text-center" style={{ verticalAlign: 'bottom', padding: '0', minWidth: '42px' }}>
                        <div style={{
                          background: 'hsl(215 25% 14%)',
                          color: '#fff',
                          fontWeight: 700,
                          fontSize: '11px',
                          height: '100px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          writingMode: 'vertical-rl',
                          transform: 'rotate(180deg)',
                          letterSpacing: '0.05em',
                          width: '100%',
                          borderRadius: '4px 4px 0 0',
                        }}>
                          Total
                        </div>
                      </th>
                      <th className="text-center" style={{ verticalAlign: 'bottom', padding: '0', minWidth: '56px' }}>
                        <div style={{
                          background: 'hsl(280 60% 40%)',
                          color: '#fff',
                          fontWeight: 700,
                          fontSize: '11px',
                          height: '100px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          writingMode: 'vertical-rl',
                          transform: 'rotate(180deg)',
                          letterSpacing: '0.05em',
                          width: '100%',
                          borderRadius: '4px 4px 0 0',
                        }}>
                          Pulls/Cab
                        </div>
                      </th>
                      <th className="w-8" style={{ verticalAlign: 'bottom' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedSkus.map(({ group, skus }) => (
                      <React.Fragment key={`grp-${group}`}>
                        <tr>
                          <td
                            colSpan={3 + cabUnitTypes.length}
                            className="text-xs font-bold uppercase tracking-wider py-1.5 px-3"
                            style={{ background: 'hsl(var(--accent))', color: 'hsl(var(--muted-foreground))' }}
                          >
                            {group} ({skus.length})
                          </td>
                        </tr>
                        {skus.map(sku => {
                          const rowTotal = cabUnitTypes.reduce((sum, t) => sum + (skuTypeQty[sku]?.[t] || 0), 0);
                          return (
                            <tr key={sku}>
                              <td className="font-mono font-medium">{sku}</td>
                              {cabUnitTypes.map(type => {
                                const qty = skuTypeQty[sku]?.[type] || 0;
                                return (
                                  <td key={type} className="text-center font-mono text-xs">
                                    {qty > 0 ? qty : ''}
                                  </td>
                                );
                              })}
                              <td className="text-center font-mono font-bold">{rowTotal || ''}</td>
                              <td className="text-center">
                                <input
                                  type="number"
                                  min={0}
                                  className="est-input text-xs w-12 text-center font-mono"
                                  value={store.handleQtyPerSku[sku] || ''}
                                  onChange={e => store.setHandleQty(sku, Number(e.target.value) || 0)}
                                  placeholder="0"
                                />
                              </td>
                              <td>
                                <button
                                  onClick={() => { if (confirm(`Delete SKU "${sku}"?`)) store.deleteCabinetRow(sku); }}
                                  className="text-muted-foreground hover:text-destructive transition-colors"
                                  title={`Delete ${sku}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold border-t border-border">
                      <td>Total</td>
                      {cabUnitTypes.map(type => {
                        const colTotal = allSkus.reduce((sum, sku) => sum + (skuTypeQty[sku]?.[type] || 0), 0);
                        return <td key={type} className="text-center font-mono">{colTotal || ''}</td>;
                      })}
                      <td className="text-center font-mono">
                        {allSkus.reduce((sum, sku) => sum + cabUnitTypes.reduce((s, t) => s + (skuTypeQty[sku]?.[t] || 0), 0), 0)}
                      </td>
                      <td></td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Bid Cost per Unit Type */}
            {cabUnitTypes.length > 0 && (
              <>
                <div className="px-4 py-3 border-t border-border">
                  <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Bid Cost per Unit Type (for pricing in export)</div>
                  <div className="flex flex-wrap gap-3">
                    {cabUnitTypes.map(type => (
                      <div key={type} className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground truncate max-w-[120px]" title={type}>{type}</span>
                        <span className="text-xs text-muted-foreground">$</span>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="est-input text-xs w-20 font-mono"
                          value={store.bidCostPerType[type] || ''}
                          onChange={e => store.setBidCost(type, Number(e.target.value) || 0)}
                          placeholder="0.00"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="px-4 py-3 border-t border-border">
                  <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Additional Cost per Unit Type</div>
                  <div className="flex flex-wrap gap-3">
                    {cabUnitTypes.map(type => (
                      <div key={type} className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground truncate max-w-[120px]" title={type}>{type}</span>
                        <span className="text-xs text-muted-foreground">$</span>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="est-input text-xs w-20 font-mono"
                          value={store.additionalCostPerType[type] || ''}
                          onChange={e => store.setAdditionalCost(type, Number(e.target.value) || 0)}
                          placeholder="0.00"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* STONE - SQFT SUB-TAB                                               */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeSubTab === 'stone' && (
        <>
          {stoneImportedCount !== null && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white" style={{ background: 'hsl(142 71% 45%)' }}>
              ✓ Successfully imported {stoneImportedCount} countertop section{stoneImportedCount !== 1 ? 's' : ''}
            </div>
          )}

          <div className="est-card overflow-hidden">
            <div className="est-section-header flex items-center gap-2 flex-wrap">
              <Square size={13} className="flex-shrink-0" />
              Stone - SQFT

              <div className="ml-auto flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setShowStoneImport(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white transition-colors"
                  style={{ background: 'hsl(var(--primary))' }}
                >
                  <FileUp size={12} /> Import from PDF
                </button>
                {store.stoneRows.length > 0 && (
                  <button
                    onClick={() => { if (confirm('Clear all stone data?')) store.clearStone(); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-destructive border border-border hover:border-destructive transition-colors"
                  >
                    <RotateCcw size={11} /> Clear
                  </button>
                )}
              </div>
            </div>

            {store.stoneRows.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                No data yet — import 2020 countertop shop drawings to extract stone dimensions and SQFT.
              </div>
            ) : (
              <div className="overflow-x-auto">
                {stoneUnitTypes.map(unitType => {
                  const typeRows = store.stoneRows.filter(r => r.unitType === unitType);
                  if (typeRows.length === 0) return null;
                  const typeSqft = typeRows.reduce((s, r) => s + calcStoneSqft(r), 0);
                  const unitCount = store.unitNumbers.filter(u => u.assignments[unitType]).length;

                  return (
                    <div key={unitType} className="mb-4">
                      <div className="px-4 py-2 flex items-center justify-between" style={{ background: 'hsl(213 72% 35%)', color: '#fff' }}>
                        <span className="text-xs font-bold">{unitType}</span>
                        <div className="flex items-center gap-4 text-xs">
                          <span>Sections: {typeRows.length}</span>
                          <span>SQFT/Unit: <strong>{typeSqft}</strong></span>
                          {unitCount > 0 && (
                            <span>Total SQFT ({unitCount} units): <strong>{typeSqft * unitCount}</strong></span>
                          )}
                        </div>
                      </div>
                      <table className="est-table text-xs">
                        <thead>
                          <tr>
                            <th>Label</th>
                            <th>Room</th>
                            <th className="text-right">Length"</th>
                            <th className="text-right">Depth"</th>
                            <th className="text-right">Backsplash"</th>
                            <th className="text-center">Island</th>
                            <th className="text-right">SQFT</th>
                            <th className="w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {typeRows.map((row, idx) => (
                            <tr key={idx}>
                              <td className="font-medium">{row.label}</td>
                              <td className="text-muted-foreground">{row.room}</td>
                              <td className="text-right font-mono">{row.length}</td>
                              <td className="text-right font-mono">{row.depth}</td>
                              <td className="text-right font-mono">{row.splashHeight ?? '—'}</td>
                              <td className="text-center">{row.isIsland ? '✓' : '—'}</td>
                              <td className="text-right font-bold" style={{ color: 'hsl(var(--primary))' }}>{calcStoneSqft(row)}</td>
                              <td>
                                <button
                                  onClick={() => store.deleteStoneRow(unitType, idx)}
                                  className="text-muted-foreground hover:text-destructive transition-colors"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="font-bold border-t border-border">
                            <td colSpan={6} className="text-right">Type Total SQFT:</td>
                            <td className="text-right" style={{ color: 'hsl(var(--primary))' }}>{typeSqft}</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  );
                })}

                {/* Grand total */}
                {stoneUnitTypes.length > 1 && (
                  <div className="px-4 py-3 border-t border-border flex justify-end">
                    <div className="text-sm font-bold">
                      Grand Total SQFT:{' '}
                      <span style={{ color: 'hsl(var(--primary))' }}>
                        {store.stoneRows.reduce((s, r) => s + calcStoneSqft(r), 0)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Per-type total with unit multiplier summary */}
                <div className="px-4 py-3 border-t border-border">
                  <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Total SQFT by Type (× Unit Count)</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {stoneUnitTypes.map(type => {
                      const typeRows = store.stoneRows.filter(r => r.unitType === type);
                      const typeSqft = typeRows.reduce((s, r) => s + calcStoneSqft(r), 0);
                      const unitCount = store.unitNumbers.filter(u => u.assignments[type]).length || 1;
                      return (
                        <div key={type} className="rounded-lg border border-border p-3 text-center">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase truncate">{type}</div>
                          <div className="text-lg font-bold" style={{ color: 'hsl(var(--primary))' }}>{typeSqft * unitCount}</div>
                          <div className="text-[10px] text-muted-foreground">{typeSqft} sqft × {unitCount} unit{unitCount !== 1 ? 's' : ''}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
