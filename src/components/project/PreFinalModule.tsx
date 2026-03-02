import { useState, useRef } from 'react';
import { FileUp, Users, LayoutGrid, Plus, Trash2, RotateCcw, Pencil } from 'lucide-react';
import type { Project, Unit, Cabinet } from '@/types/project';
import ShopDrawingImportDialog, { type LabelRow } from './ShopDrawingImportDialog';
import UnitTypeImportDialog from './UnitTypeImportDialog';
import { usePrefinalStore } from '@/hooks/usePrefinalStore';

interface Props {
  project: Project;
  selectedUnit?: Unit;
  selectedUnitId?: string | null;
  setSelectedUnitId?: (id: string) => void;
  addCabinet: (projectId: string, unitId: string, data: Omit<Cabinet, 'id'>) => Cabinet;
  updateCabinet: (projectId: string, unitId: string, cabinetId: string, data: Partial<Cabinet>) => void;
  deleteCabinet: (projectId: string, unitId: string, cabinetId: string) => void;
  section?: 'units' | 'cabinets' | 'mismatch';
  [key: string]: unknown;
}

// Normalize unit type names: preserve "TYPE" prefix if present in original text
// "TYPE B ADA" → "TYPE B ADA", "TYPE A1 - AS" → "TYPE A1-AS", "A1-AS" stays "A1-AS"
function normalizeUnitType(raw: string): string {
  let s = raw.trim();
  const hasTypePrefix = /^type\s+/i.test(s);
  // Remove leading "TYPE " for normalization
  s = s.replace(/^type\s+/i, '');
  // Normalize spaces around hyphens: "A1 - AS" → "A1-AS"
  s = s.replace(/\s*-\s*/g, '-');
  // Uppercase
  s = s.toUpperCase();
  // Re-add TYPE prefix if it was in the original
  if (hasTypePrefix) s = 'TYPE ' + s;
  return s;
}

export default function PreFinalModule({ project, section = 'units' }: Props) {
  const store = usePrefinalStore(section === 'mismatch' ? `${project.id}_mismatch` : project.id);

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

  

  // ── Unit import handler ───────────────────────────────────────────────────
  const handleUnitImport = (rows: { unitNumber: string; unitType: string; bldg: string }[]) => {
    const normalized = rows.map(r => ({ ...r, unitType: normalizeUnitType(r.unitType) }));
    const types = Array.from(new Set(normalized.map(r => r.unitType)));
    store.addUnitTypes(types);
    store.importUnitMappings(normalized);
    setUnitImportedCount(normalized.length);
    setShowUnitImport(false);
    setTimeout(() => setUnitImportedCount(null), 4000);
  };

  // ── Cabinet import handler ────────────────────────────────────────────────
  const handleCabinetImport = (rows: Omit<LabelRow, 'selected' | 'sourceFile'>[], detectedUnitType?: string) => {
    const rawType = detectedUnitType || importTargetType || '';
    const targetType = rawType ? normalizeUnitType(rawType) : '';
    if (targetType) {
      // Auto-add the unit type as a cabinet column if not already present
      store.addCabinetUnitTypes([targetType]);
    }
    const finalType = targetType || 'All';
    store.addCabinetImport(
      rows.map(r => ({ sku: r.sku, type: r.type, room: r.room, quantity: r.quantity, unitType: finalType })),
      finalType
    );
    setCabinetImportedCount(rows.length);
    setShowCabinetImport(false);
    if (targetType) setImportTargetType(targetType);
    setTimeout(() => setCabinetImportedCount(null), 4000);
  };

  // ── Cabinet pivot (use unit types from the unit count section) ──────────
  // Deduplicate cabinet unit types at render time (safety net)
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
  // Build SKU → unitType → quantity mapping
  const skuTypeQty: Record<string, Record<string, number>> = {};
  const skuCabType: Record<string, string> = {};
  store.cabinetRows.forEach(r => {
    if (!skuTypeQty[r.sku]) skuTypeQty[r.sku] = {};
    // Use max quantity (same dedup logic as import)
    skuTypeQty[r.sku][r.unitType] = Math.max(skuTypeQty[r.sku][r.unitType] || 0, r.quantity);
    if (!skuCabType[r.sku]) skuCabType[r.sku] = r.type;
  });

  // Parse SKU dimensions: e.g. W1230 → width=12, height=30; W3024 → width=30, height=24
  const parseSkuDims = (sku: string): { width: number; height: number } => {
    const match = sku.replace(/\s/g, '').match(/^[A-Za-z]+(\d+)/);
    if (!match) return { width: 0, height: 0 };
    const digits = match[1];
    if (digits.length === 4) return { width: Number(digits.slice(0, 2)), height: Number(digits.slice(2, 4)) };
    if (digits.length === 3) return { width: Number(digits.slice(0, 1)), height: Number(digits.slice(1, 3)) };
    if (digits.length === 2) return { width: Number(digits), height: 0 };
    return { width: Number(digits), height: 0 };
  };

  // Sort SKUs within a group based on cabinet type
  const sortSkusForGroup = (skus: string[], group: string): string[] => {
    if (group === 'Wall') {
      // Sort by height ascending (last 2 digits), then by width
      return [...skus].sort((a, b) => {
        const da = parseSkuDims(a), db = parseSkuDims(b);
        if (da.height !== db.height) return da.height - db.height;
        return da.width - db.width;
      });
    }
    if (group === 'Base') {
      // Sort by width (size) ascending
      return [...skus].sort((a, b) => {
        const da = parseSkuDims(a), db = parseSkuDims(b);
        if (da.width !== db.width) return da.width - db.width;
        return da.height - db.height;
      });
    }
    return skus; // default: keep alphabetical from allSkus
  };

  // Group SKUs by cabinet type in display order
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

  // ── Unit type totals (count of "1"s per column) ───────────────────────────
  const unitTypeTotal = (type: string) =>
    store.unitNumbers.filter(u => u.assignments[type]).length;

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION: Pre-Final Unit Count
  // ─────────────────────────────────────────────────────────────────────────
  if (section === 'units' || section === 'mismatch') {
    return (
      <div className="space-y-4">
        {showUnitImport && (
          <UnitTypeImportDialog
            onImport={handleUnitImport}
            onClose={() => setShowUnitImport(false)}
          />
        )}

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
              <button
                onClick={() => setShowUnitImport(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors"
                style={{ borderColor: 'hsl(var(--primary))', color: 'hsl(var(--primary))' }}
              >
                <FileUp size={12} /> Import Shop Drawing PDF
              </button>
            </div>
          </div>

          {/* Manual add unit type */}
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

          {/* Manual add unit number */}
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
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION: Pre-Final Cabinet Count
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {showCabinetImport && (
        <ShopDrawingImportDialog
          unitType={importTargetType || undefined}
          onImport={handleCabinetImport}
          onClose={() => setShowCabinetImport(false)}
        />
      )}

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
            {store.cabinetRows.length > 0 && (
              <button
                onClick={() => { if (confirm('Clear all cabinet import data?')) store.clearCabinets(); }}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-destructive border border-border hover:border-destructive transition-colors"
              >
                <RotateCcw size={11} /> Clear
              </button>
            )}
            <select
              className="est-input text-xs h-7 pr-6"
              value={importTargetType}
              onChange={e => setImportTargetType(e.target.value)}
              title="Unit type this drawing belongs to"
            >
              <option value="">Select unit type…</option>
              {store.cabinetUnitTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button
              onClick={() => setShowCabinetImport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors"
              style={{ borderColor: 'hsl(var(--primary))', color: 'hsl(var(--primary))' }}
            >
              <FileUp size={12} /> Import Shop Drawing PDF
            </button>
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
                  <th className="w-8" style={{ verticalAlign: 'bottom' }}></th>
                </tr>
              </thead>
              <tbody>
                {groupedSkus.map(({ group, skus }) => (
                  <>
                    <tr key={`group-${group}`}>
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
                  </>
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
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
