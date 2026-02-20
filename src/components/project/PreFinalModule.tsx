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
  const [newUnitNumber, setNewUnitNumber] = useState('');
  const [showAddUnitNumber, setShowAddUnitNumber] = useState(false);
  const [unitImportedCount, setUnitImportedCount] = useState<number | null>(null);

  // ── Cabinet Count state ───────────────────────────────────────────────────
  const [showCabinetImport, setShowCabinetImport] = useState(false);
  const [importTargetType, setImportTargetType] = useState('');
  const [cabinetImportedCount, setCabinetImportedCount] = useState<number | null>(null);

  const unitTypes = Array.from(new Set(project.units.map(u => u.type)));

  // ── Unit import handler ───────────────────────────────────────────────────
  const handleUnitImport = (rows: { unitType: string; count: number }[]) => {
    store.addUnitTypes(rows.map(r => r.unitType));
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
  const allCabUnitTypes = Array.from(new Set(store.cabinetRows.map(r => r.unitType)));
  const allSkus = Array.from(new Set(store.cabinetRows.map(r => r.sku))).sort();
  const skuTypeQty: Record<string, Record<string, number>> = {};
  store.cabinetRows.forEach(r => {
    if (!skuTypeQty[r.sku]) skuTypeQty[r.sku] = {};
    skuTypeQty[r.sku][r.unitType] = (skuTypeQty[r.sku][r.unitType] || 0) + r.quantity;
  });
  const skuGrandTotal = (sku: string) =>
    Object.values(skuTypeQty[sku] || {}).reduce((s, n) => s + n, 0);
  const grandTotal = allSkus.reduce((s, sku) => s + skuGrandTotal(sku), 0);

  // ── Unit type totals (count of "1"s per column) ───────────────────────────
  const unitTypeTotal = (type: string) =>
    store.unitNumbers.filter(u => u.assignments[type]).length;

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION: Pre-Final Unit Count
  // ─────────────────────────────────────────────────────────────────────────
  if (section === 'units') {
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
                    {store.unitTypes.map(type => (
                      <th key={type} style={{ verticalAlign: 'bottom', padding: '4px 6px' }}>
                        <div className="flex items-end gap-1">
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
                          <button
                            onClick={() => store.deleteUnitType(type)}
                            className="text-muted-foreground hover:text-destructive transition-colors mb-1"
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
                      <td colSpan={store.unitTypes.length + 2} className="text-center text-muted-foreground text-xs py-6">
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
                  {allCabUnitTypes.map(type => (
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
                    {allCabUnitTypes.map(type => (
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
                  {allCabUnitTypes.map(type => {
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
