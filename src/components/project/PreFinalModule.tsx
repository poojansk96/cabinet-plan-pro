import { useState } from 'react';
import { ClipboardCheck, FileUp, Users, LayoutGrid } from 'lucide-react';
import type { Project, Unit, Cabinet, CabinetType, Room } from '@/types/project';
import ShopDrawingImportDialog, { type LabelRow } from './ShopDrawingImportDialog';

interface Props {
  project: Project;
  selectedUnit?: Unit;
  selectedUnitId?: string | null;
  setSelectedUnitId?: (id: string) => void;
  addCabinet: (projectId: string, unitId: string, data: Omit<Cabinet, 'id'>) => Cabinet;
  updateCabinet: (projectId: string, unitId: string, cabinetId: string, data: Partial<Cabinet>) => void;
  deleteCabinet: (projectId: string, unitId: string, cabinetId: string) => void;
  [key: string]: unknown;
}

export default function PreFinalModule({
  project,
  addCabinet,
}: Props) {
  const [showImport, setShowImport] = useState(false);
  const [importTargetType, setImportTargetType] = useState('');
  const [importedCount, setImportedCount] = useState<number | null>(null);

  const unitTypes = Array.from(new Set(project.units.map(u => u.type)));

  const handleImport = (rows: Omit<LabelRow, 'selected' | 'sourceFile'>[]) => {
    const targetUnits = importTargetType
      ? project.units.filter(u => u.type === importTargetType)
      : project.units;

    targetUnits.forEach(unit => {
      rows.forEach(row => {
        const cabinetType: CabinetType =
          (['Base', 'Wall', 'Tall', 'Vanity'] as string[]).includes(row.type)
            ? (row.type as CabinetType)
            : 'Base';

        addCabinet(project.id, unit.id, {
          room: (['Kitchen', 'Pantry', 'Laundry', 'Bath', 'Other'] as string[]).includes(row.room)
            ? (row.room as Room)
            : 'Other',
          type: cabinetType,
          sku: row.sku,
          width: 0,
          height: 0,
          depth: 0,
          quantity: row.quantity,
          notes: row.type === 'Accessory' ? 'Accessory' : '',
        });
      });
    });

    setImportedCount(rows.length);
    setShowImport(false);
    setTimeout(() => setImportedCount(null), 4000);
  };

  // ── Data derivations ────────────────────────────────────────────────────────

  // Section 1: Unit count by type
  const unitTypeCounts: Record<string, number> = {};
  project.units.forEach(u => {
    unitTypeCounts[u.type] = (unitTypeCounts[u.type] || 0) + 1;
  });
  const totalUnits = project.units.length;

  // Section 2: Cabinet pivot — SKU rows × unit type columns
  const unitTypeKeys = Array.from(new Set(project.units.map(u => u.type)));
  const allSkus = Array.from(new Set(project.units.flatMap(u => u.cabinets.map(c => c.sku)))).sort();

  // skuTypeQty[sku][unitType] = total quantity across all units of that type
  const skuTypeQty: Record<string, Record<string, number>> = {};
  project.units.forEach(u => {
    u.cabinets.forEach(c => {
      if (!skuTypeQty[c.sku]) skuTypeQty[c.sku] = {};
      skuTypeQty[c.sku][u.type] = (skuTypeQty[c.sku][u.type] || 0) + c.quantity;
    });
  });

  // Grand total per SKU
  const skuGrandTotal = (sku: string) =>
    Object.values(skuTypeQty[sku] || {}).reduce((s, n) => s + n, 0);

  return (
    <div className="space-y-6">
      {showImport && (
        <ShopDrawingImportDialog
          unitType={importTargetType || undefined}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* ── Import toolbar ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <ClipboardCheck size={16} className="text-primary flex-shrink-0" />
        <span className="font-semibold text-sm">Pre-Final — Shop Drawing Import</span>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {unitTypes.length > 0 && (
            <select
              className="est-input text-xs h-7 pr-6"
              value={importTargetType}
              onChange={e => setImportTargetType(e.target.value)}
              title="Apply import to units of this type"
            >
              <option value="">All unit types</option>
              {unitTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}

          <button
            onClick={() => setShowImport(true)}
            disabled={project.units.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors disabled:opacity-50"
            style={{ borderColor: 'hsl(var(--primary))', color: 'hsl(var(--primary))' }}
          >
            <FileUp size={12} />
            Import Shop Drawing PDF
          </button>
        </div>
      </div>

      {/* Import success toast */}
      {importedCount !== null && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white" style={{ background: 'hsl(142 71% 45%)' }}>
          ✓ Successfully imported {importedCount} label{importedCount !== 1 ? 's' : ''} from shop drawing
          {importTargetType && <span className="opacity-80 ml-1">into "{importTargetType}" units</span>}
        </div>
      )}

      {project.units.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Add units first, then import shop drawings.
        </div>
      )}

      {project.units.length > 0 && (
        <>
          {/* ── SECTION 1: Pre-Final Unit Count ──────────────────────────── */}
          <div className="est-card overflow-hidden">
            <div className="est-section-header flex items-center gap-2">
              <Users size={13} className="flex-shrink-0" />
              Pre-Final Unit Count
            </div>
            <div className="overflow-x-auto">
              <table className="est-table w-full">
                <thead>
                  <tr>
                    <th className="text-left">Unit Type</th>
                    <th className="text-right">Count</th>
                    <th className="text-right w-20">% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(unitTypeCounts).map(([type, count]) => (
                    <tr key={type}>
                      <td className="font-medium">{type}</td>
                      <td className="text-right font-mono">{count}</td>
                      <td className="text-right text-muted-foreground text-xs">
                        {totalUnits > 0 ? ((count / totalUnits) * 100).toFixed(1) : 0}%
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold border-t border-border">
                    <td>Total</td>
                    <td className="text-right font-mono">{totalUnits}</td>
                    <td className="text-right text-muted-foreground text-xs">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* ── SECTION 2: Pre-Final Cabinet Count ───────────────────────── */}
          <div className="est-card overflow-hidden">
            <div className="est-section-header flex items-center gap-2">
              <LayoutGrid size={13} className="flex-shrink-0" />
              Pre-Final Cabinet Count
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
                      {unitTypeKeys.map(type => (
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
                        {unitTypeKeys.map(type => (
                          <td key={type} className="text-center font-mono">
                            {skuTypeQty[sku]?.[type] ? skuTypeQty[sku][type] : ''}
                          </td>
                        ))}
                        <td className="text-right font-mono font-semibold">{skuGrandTotal(sku)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold border-t border-border">
                      <td>Total</td>
                      {unitTypeKeys.map(type => {
                        const colTotal = allSkus.reduce((s, sku) => s + (skuTypeQty[sku]?.[type] || 0), 0);
                        return <td key={type} className="text-center font-mono">{colTotal || ''}</td>;
                      })}
                      <td className="text-right font-mono">
                        {allSkus.reduce((s, sku) => s + skuGrandTotal(sku), 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
