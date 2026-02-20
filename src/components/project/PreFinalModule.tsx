import { useState } from 'react';
import { FileUp, Users, LayoutGrid, Plus, Trash2, RotateCcw } from 'lucide-react';
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
  section?: 'units' | 'cabinets';
  [key: string]: unknown;
}

export default function PreFinalModule({ project, section = 'units' }: Props) {
  const store = usePrefinalStore(project.id);

  // ── Unit Count state ──────────────────────────────────────────────────────
  const [showUnitImport, setShowUnitImport] = useState(false);
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [newUnitType, setNewUnitType] = useState('');
  const [newUnitCount, setNewUnitCount] = useState(1);
  const [unitImportedCount, setUnitImportedCount] = useState<number | null>(null);

  // ── Cabinet Count state ───────────────────────────────────────────────────
  const [showCabinetImport, setShowCabinetImport] = useState(false);
  const [importTargetType, setImportTargetType] = useState('');
  const [cabinetImportedCount, setCabinetImportedCount] = useState<number | null>(null);

  const unitTypes = Array.from(new Set(project.units.map(u => u.type)));

  // ── Unit import handler ───────────────────────────────────────────────────
  const handleUnitImport = (rows: { unitType: string; count: number }[]) => {
    rows.forEach(r => store.addManualUnitRow(r.unitType, r.count));
    setUnitImportedCount(rows.length);
    setShowUnitImport(false);
    setTimeout(() => setUnitImportedCount(null), 4000);
  };

  // ── Cabinet import handler ────────────────────────────────────────────────
  const handleCabinetImport = (rows: Omit<LabelRow, 'selected' | 'sourceFile'>[]) => {
    store.addCabinetImport(
      rows.map(r => ({ sku: r.sku, type: r.type, room: r.room, quantity: r.quantity, unitType: importTargetType || 'All' })),
      importTargetType || 'All'
    );
    setCabinetImportedCount(rows.length);
    setShowCabinetImport(false);
    setTimeout(() => setCabinetImportedCount(null), 4000);
  };

  // ── Cabinet pivot ─────────────────────────────────────────────────────────
  const allUnitTypes = Array.from(new Set(store.cabinetRows.map(r => r.unitType)));
  const allSkus = Array.from(new Set(store.cabinetRows.map(r => r.sku))).sort();
  const skuTypeQty: Record<string, Record<string, number>> = {};
  store.cabinetRows.forEach(r => {
    if (!skuTypeQty[r.sku]) skuTypeQty[r.sku] = {};
    skuTypeQty[r.sku][r.unitType] = (skuTypeQty[r.sku][r.unitType] || 0) + r.quantity;
  });
  const skuGrandTotal = (sku: string) =>
    Object.values(skuTypeQty[sku] || {}).reduce((s, n) => s + n, 0);
  const grandTotal = allSkus.reduce((s, sku) => s + skuGrandTotal(sku), 0);

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION: Pre-Final Unit Count
  // ─────────────────────────────────────────────────────────────────────────
  if (section === 'units') {
    const totalUnits = store.unitRows.reduce((s, r) => s + r.count, 0);

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
              {store.unitRows.length > 0 && (
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
                <Plus size={12} /> Add Manually
              </button>
              <button
                onClick={() => setShowUnitImport(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors"
                style={{ borderColor: 'hsl(var(--primary))', color: 'hsl(var(--primary))' }}
              >
                <FileUp size={12} /> Import Shop Drawing PDF
              </button>
            </div>
          </div>

          {/* Manual add row */}
          {showAddUnit && (
            <div className="px-4 py-3 border-b border-border bg-accent/30 flex items-center gap-3 flex-wrap">
              <input
                className="est-input text-xs h-7 w-36"
                placeholder="Unit type (e.g. 2BHK)"
                value={newUnitType}
                onChange={e => setNewUnitType(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newUnitType.trim()) {
                    store.addManualUnitRow(newUnitType.trim(), newUnitCount);
                    setNewUnitType(''); setNewUnitCount(1); setShowAddUnit(false);
                  }
                }}
                autoFocus
              />
              <input
                type="number"
                className="est-input text-xs h-7 w-20"
                placeholder="Count"
                min={1}
                value={newUnitCount}
                onChange={e => setNewUnitCount(Math.max(1, +e.target.value))}
              />
              <button
                onClick={() => {
                  if (!newUnitType.trim()) return;
                  store.addManualUnitRow(newUnitType.trim(), newUnitCount);
                  setNewUnitType(''); setNewUnitCount(1); setShowAddUnit(false);
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

          {store.unitRows.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              No data yet — import a 2020 shop drawing PDF or add unit types manually.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="est-table w-full">
                <thead>
                  <tr>
                    <th className="text-left">Unit Type</th>
                    <th className="text-right">Count</th>
                    <th className="text-right w-20">% of Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {store.unitRows.map(row => (
                    <tr key={row.unitType}>
                      <td className="font-medium">{row.unitType}</td>
                      <td className="text-right">
                        <input
                          type="number"
                          className="est-input text-xs w-16 text-right ml-auto"
                          min={1}
                          value={row.count}
                          onChange={e => store.updateUnitRow(row.unitType, Math.max(1, +e.target.value))}
                        />
                      </td>
                      <td className="text-right text-muted-foreground text-xs">
                        {totalUnits > 0 ? ((row.count / totalUnits) * 100).toFixed(1) : 0}%
                      </td>
                      <td>
                        <button onClick={() => store.deleteUnitRow(row.unitType)} className="text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold border-t border-border">
                    <td>Total</td>
                    <td className="text-right font-mono">{totalUnits}</td>
                    <td className="text-right text-muted-foreground text-xs">100%</td>
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
              {unitTypes.map(t => <option key={t} value={t}>{t}</option>)}
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
                  <th className="text-left" style={{ verticalAlign: 'bottom' }}>SKU / Label</th>
                  {allUnitTypes.map(type => (
                    <th key={type} style={{ verticalAlign: 'bottom', padding: '4px 6px' }}>
                      <div style={{
                        writingMode: 'vertical-rl',
                        transform: 'rotate(180deg)',
                        whiteSpace: 'nowrap',
                        fontWeight: 600,
                        fontSize: '11px',
                        height: '110px',
                        display: 'flex',
                        alignItems: 'center',
                      }}>
                        {type}
                      </div>
                    </th>
                  ))}
                  <th className="text-right" style={{ verticalAlign: 'bottom', paddingBottom: '6px' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {allSkus.map(sku => (
                  <tr key={sku}>
                    <td className="font-mono font-medium">{sku}</td>
                    {allUnitTypes.map(type => (
                      <td key={type} className="text-center font-mono">
                        {skuTypeQty[sku]?.[type] ?? ''}
                      </td>
                    ))}
                    <td className="text-right font-mono font-semibold">{skuGrandTotal(sku)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t border-border">
                  <td>Total</td>
                  {allUnitTypes.map(type => {
                    const colTotal = allSkus.reduce((s, sku) => s + (skuTypeQty[sku]?.[type] || 0), 0);
                    return <td key={type} className="text-center font-mono">{colTotal || ''}</td>;
                  })}
                  <td className="text-right font-mono">{grandTotal}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
