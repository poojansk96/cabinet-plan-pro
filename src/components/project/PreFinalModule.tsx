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

  

  // ── Unit import handler ───────────────────────────────────────────────────
  const handleUnitImport = (rows: { unitNumber: string; unitType: string }[]) => {
    // Extract unique types
    const types = Array.from(new Set(rows.map(r => r.unitType)));
    store.addUnitTypes(types);
    // Add unit numbers with their assignments
    store.importUnitMappings(rows);
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

  // ── Cabinet pivot (use unit types from the unit count section) ──────────
  const cabUnitTypes = store.unitTypes; // horizontal columns from prefinal unit count
  const allSkus = Array.from(new Set(store.cabinetRows.map(r => r.sku))).sort();
  // Build SKU → unitType → boolean mapping (1 = connected)
  const skuTypeMap: Record<string, Set<string>> = {};
  const skuCabType: Record<string, string> = {};
  store.cabinetRows.forEach(r => {
    if (!skuTypeMap[r.sku]) skuTypeMap[r.sku] = new Set();
    skuTypeMap[r.sku].add(r.unitType);
    if (!skuCabType[r.sku]) skuCabType[r.sku] = r.type;
  });

  // Group SKUs by cabinet type in display order
  const CAB_TYPE_ORDER = ['Base', 'Wall', 'Tall', 'Vanity', 'Accessory'];
  const groupedSkus: { group: string; skus: string[] }[] = (() => {
    const groups: Record<string, string[]> = {};
    for (const sku of allSkus) {
      const t = skuCabType[sku] || 'Other';
      if (!groups[t]) groups[t] = [];
      groups[t].push(sku);
    }
    const ordered: { group: string; skus: string[] }[] = [];
    for (const g of CAB_TYPE_ORDER) {
      if (groups[g]) { ordered.push({ group: g, skus: groups[g] }); delete groups[g]; }
    }
    // Any remaining types not in the predefined order
    for (const [g, skus] of Object.entries(groups)) {
      ordered.push({ group: g, skus });
    }
    return ordered;
  })();

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
                      <th key={type} className="text-center" style={{ verticalAlign: 'bottom', padding: '4px 6px' }}>
                        <div className="flex flex-col items-center gap-1">
                          <div style={{
                            writingMode: 'vertical-rl',
                            transform: 'rotate(180deg)',
                            whiteSpace: 'nowrap',
                            fontWeight: 600,
                            fontSize: '11px',
                            height: '110px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                          }}>
                            {type}
                          </div>
                          <button
                            onClick={() => store.deleteUnitType(type)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
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
              {store.unitTypes.map(t => <option key={t} value={t}>{t}</option>)}
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
                    <th key={type} className="text-center" style={{ verticalAlign: 'bottom', padding: '4px 6px', minWidth: '36px' }}>
                      <div style={{
                        writingMode: 'vertical-rl',
                        transform: 'rotate(180deg)',
                        whiteSpace: 'nowrap',
                        fontWeight: 600,
                        fontSize: '11px',
                        height: '110px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        overflow: 'visible',
                        color: 'hsl(var(--foreground))',
                        margin: '0 auto',
                      }}>
                        {type}
                      </div>
                    </th>
                  ))}
                  <th className="text-center font-bold" style={{ verticalAlign: 'bottom', padding: '4px 6px', minWidth: '36px' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {groupedSkus.map(({ group, skus }) => (
                  <>
                    <tr key={`group-${group}`}>
                      <td
                        colSpan={1 + cabUnitTypes.length}
                        className="text-xs font-bold uppercase tracking-wider py-1.5 px-3"
                        style={{ background: 'hsl(var(--accent))', color: 'hsl(var(--muted-foreground))' }}
                      >
                        {group} ({skus.length})
                      </td>
                    </tr>
                    {skus.map(sku => (
                      <tr key={sku}>
                        <td className="font-mono font-medium">{sku}</td>
                        {cabUnitTypes.map(type => (
                          <td key={type} className="text-center">
                            {skuTypeMap[sku]?.has(type) ? (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-primary text-primary-foreground text-xs font-bold">1</span>
                            ) : ''}
                          </td>
                        ))}
                        <td className="text-center font-mono font-bold">{skuTypeMap[sku]?.size || 0}</td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t border-border">
                  <td>Total</td>
                  {cabUnitTypes.map(type => {
                    const colTotal = allSkus.filter(sku => skuTypeMap[sku]?.has(type)).length;
                    return <td key={type} className="text-center font-mono">{colTotal || ''}</td>;
                  })}
                  <td className="text-center font-mono">{allSkus.reduce((sum, sku) => sum + (skuTypeMap[sku]?.size || 0), 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
