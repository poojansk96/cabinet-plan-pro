import { useState } from 'react';
import { ClipboardCheck, FileUp, Plus, Trash2 } from 'lucide-react';
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
  selectedUnit,
  selectedUnitId,
  setSelectedUnitId,
  addCabinet,
  deleteCabinet,
}: Props) {
  const [showImport, setShowImport] = useState(false);
  const [importTargetType, setImportTargetType] = useState('');
  const [importedCount, setImportedCount] = useState<number | null>(null);

  const unitTypes = Array.from(new Set(project.units.map(u => u.type)));

  // Handle imported labels: apply to all units of chosen type as cabinets
  const handleImport = (rows: Omit<LabelRow, 'selected' | 'sourceFile'>[]) => {
    const targetUnits = importTargetType
      ? project.units.filter(u => u.type === importTargetType)
      : project.units;

    targetUnits.forEach(unit => {
      rows.forEach(row => {
        // Map accessory type to Base as fallback for cabinet store
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

  // Build pivot: SKU rows × unit type columns (same as Cabinet tab)
  const unitTypeKeys = Array.from(new Set(project.units.map(u => u.type)));
  const allSkus = Array.from(new Set(project.units.flatMap(u => u.cabinets.map(c => c.sku)))).sort();
  const skuTypeQty: Record<string, Record<string, number>> = {};
  project.units.forEach(u => {
    u.cabinets.forEach(c => {
      if (!skuTypeQty[c.sku]) skuTypeQty[c.sku] = {};
      skuTypeQty[c.sku][u.type] = (skuTypeQty[c.sku][u.type] || 0) + c.quantity;
    });
  });

  return (
    <div className="space-y-4">
      {showImport && (
        <ShopDrawingImportDialog
          unitType={importTargetType || undefined}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* Header */}
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
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white" style={{ background: 'hsl(var(--success, 142 71% 45%))' }}>
          ✓ Successfully imported {importedCount} label{importedCount !== 1 ? 's' : ''} from shop drawing
          {importTargetType && <span className="opacity-80 ml-1">into "{importTargetType}" units</span>}
        </div>
      )}

      {/* Cabinet Summary by Unit Type — same pivot table as Cabinets tab */}
      {allSkus.length > 0 && (
        <div className="est-card overflow-hidden">
          <div className="est-section-header">Cabinet &amp; Label Summary by Unit Type</div>
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
                </tr>
              </thead>
              <tbody>
                {allSkus.map(sku => (
                  <tr key={sku}>
                    <td className="font-mono font-medium">{sku}</td>
                    {unitTypeKeys.map(type => (
                      <td key={type} className="text-center">
                        {skuTypeQty[sku]?.[type] ? '1' : ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {project.units.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Add units first, then import shop drawings.
        </div>
      )}

      {project.units.length > 0 && allSkus.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Import a 2020 shop drawing PDF to extract cabinet and accessory labels.
        </div>
      )}
    </div>
  );
}
