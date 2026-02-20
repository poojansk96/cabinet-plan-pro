import { ClipboardCheck } from 'lucide-react';
import type { Project, Unit } from '@/types/project';

interface Props {
  project: Project;
  selectedUnit?: Unit;
  selectedUnitId?: string | null;
  setSelectedUnitId?: (id: string) => void;
}

export default function PreFinalModule({ project }: Props) {
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
      {/* Header */}
      <div className="flex items-center gap-2">
        <ClipboardCheck size={16} className="text-primary" />
        <h2 className="font-semibold text-sm">Pre-Final Checklist</h2>
      </div>

      {project.units.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Add units first, then add cabinets.</div>
      ) : allSkus.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No cabinets added yet.</div>
      ) : (
        <div className="est-card overflow-hidden">
          <div className="est-section-header">Cabinet Summary by Unit Type</div>
          <div className="overflow-x-auto">
            <table className="est-table" style={{ whiteSpace: 'nowrap' }}>
              <thead>
                <tr style={{ height: '120px', verticalAlign: 'bottom' }}>
                  <th className="text-left" style={{ verticalAlign: 'bottom' }}>SKU List</th>
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
    </div>
  );
}
