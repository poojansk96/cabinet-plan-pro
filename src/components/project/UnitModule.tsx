import { useState } from 'react';
import { Plus, Trash2, Copy, Users, FileUp } from 'lucide-react';
import type { Project, Unit, UnitType } from '@/types/project';
import { calcUnitCabinetTotals, calcUnitCountertopTotal } from '@/lib/calculations';
import PDFImportDialog from './PDFImportDialog';

const blankForm = () => ({ unitNumber: '', type: '' as UnitType, bldg: '', floor: '', notes: '' });

interface Props {
  project: Project;
  selectedUnit: Unit | undefined;
  selectedUnitId: string | null;
  setSelectedUnitId: (id: string) => void;
  addUnit: (projectId: string, data: Omit<Unit, 'id' | 'cabinets' | 'accessories' | 'countertops'>) => Unit;
  updateUnit: (projectId: string, unitId: string, data: Partial<Unit>) => void;
  deleteUnit: (projectId: string, unitId: string) => void;
  duplicateUnit: (projectId: string, unitId: string) => void;
}

export default function UnitModule({ project, selectedUnitId, setSelectedUnitId, addUnit, deleteUnit, duplicateUnit }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankForm());
  const [showPDFImport, setShowPDFImport] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  const resolvedType = form.type.trim() || 'Other';

  const handleAdd = () => {
    if (!form.unitNumber.trim()) return;
    const unit = addUnit(project.id, { unitNumber: form.unitNumber, type: resolvedType, bldg: form.bldg, floor: form.floor, notes: form.notes });
    setSelectedUnitId(unit.id);
    setForm(blankForm());
    setShowForm(false);
  };

  const handlePDFImport = (units: Array<{ unitNumber: string; type: UnitType; floor: string; bldg: string }>) => {
    let lastUnit: Unit | null = null;
    units.forEach(u => {
      const exists = project.units.some(pu => pu.unitNumber === u.unitNumber);
      if (!exists) {
        lastUnit = addUnit(project.id, { unitNumber: u.unitNumber, type: u.type, floor: u.floor || '', bldg: u.bldg || '', notes: '' });
      }
    });
    if (lastUnit) setSelectedUnitId((lastUnit as Unit).id);
    setImportedCount(units.length);
    setShowPDFImport(false);
    setTimeout(() => setImportedCount(null), 4000);
  };

  const numericAsc = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

  // Group by type, then sort units within each group: bldg → floor → unit number (all ascending)
  const byType = project.units.reduce<Record<string, Unit[]>>((acc, u) => {
    const t = u.type || 'Other';
    if (!acc[t]) acc[t] = [];
    acc[t].push(u);
    return acc;
  }, {});

  Object.values(byType).forEach(units =>
    units.sort((a, b) => {
      const bldgCmp = numericAsc(a.bldg || '', b.bldg || '');
      if (bldgCmp !== 0) return bldgCmp;
      const floorCmp = numericAsc(a.floor || '', b.floor || '');
      if (floorCmp !== 0) return floorCmp;
      return numericAsc(a.unitNumber, b.unitNumber);
    })
  );

  return (
    <div className="space-y-4">
      {/* PDF Import Dialog */}
      {showPDFImport && (
        <PDFImportDialog
          onImport={handlePDFImport}
          onClose={() => setShowPDFImport(false)}
        />
      )}

      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-primary" />
          <h2 className="font-semibold text-sm">Unit Count</h2>
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: 'hsl(var(--accent))', color: 'hsl(var(--accent-foreground))' }}>
            {project.units.length} total
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPDFImport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors"
            style={{ borderColor: 'hsl(var(--primary))', color: 'hsl(var(--primary))' }}
          >
            <FileUp size={12} />
            Import from PDF
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white"
            style={{ background: 'hsl(var(--primary))' }}
          >
            <Plus size={12} />
            Add Unit
          </button>
        </div>
      </div>

      {/* Import success toast */}
      {importedCount !== null && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white" style={{ background: 'hsl(var(--success))' }}>
          ✓ Successfully imported {importedCount} unit{importedCount !== 1 ? 's' : ''} from PDF
        </div>
      )}

      {/* Add unit form */}
      {showForm && (
        <div className="est-card p-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Unit # *</label>
              <input
                className="est-input w-full"
                placeholder="101"
                value={form.unitNumber}
                onChange={e => setForm(f => ({ ...f, unitNumber: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Bldg</label>
              <input
                className="est-input w-full"
                placeholder="A"
                value={form.bldg}
                onChange={e => setForm(f => ({ ...f, bldg: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Floor</label>
              <input
                className="est-input w-full"
                placeholder="1"
                value={form.floor}
                onChange={e => setForm(f => ({ ...f, floor: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Unit Type</label>
              <input
                className="est-input w-full"
                placeholder="e.g. 2BHK, Studio, Penthouse…"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as UnitType }))}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
              <input
                className="est-input w-full"
                placeholder="Optional"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={handleAdd}
                className="h-7 px-3 rounded text-xs font-medium text-white"
                style={{ background: 'hsl(var(--primary))' }}
              >
                Add
              </button>
              <button
                onClick={() => { setShowForm(false); setForm(blankForm()); }}
                className="h-7 px-3 rounded text-xs font-medium border border-border text-muted-foreground hover:bg-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {project.units.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users size={36} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium mb-1">No units added yet</p>
          <p className="text-xs mb-4">Upload your architectural PDF to auto-detect units, or add manually.</p>
          <button
            onClick={() => setShowPDFImport(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border"
            style={{ borderColor: 'hsl(var(--primary))', color: 'hsl(var(--primary))' }}
          >
            <FileUp size={14} />
            Import from PDF Plan
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Unit type groups */}
          {Object.entries(byType).map(([type, units]) => (
            <div key={type} className="est-card overflow-hidden">
              <div className="est-section-header">
                <span>{type}</span>
                <span className="ml-auto text-xs font-normal text-muted-foreground">{units.length} unit{units.length !== 1 ? 's' : ''}</span>
              </div>
              <table className="est-table">
                <thead>
                  <tr>
                    <th>Unit #</th>
                    <th>Bldg</th>
                    <th>Floor</th>
                    <th>Type</th>
                    <th className="text-right">Cabinets</th>
                    <th className="text-right">Base</th>
                    <th className="text-right">Wall</th>
                    <th className="text-right">Tall</th>
                    <th className="text-right">CT Sqft</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {units.map(unit => {
                    const ct = calcUnitCabinetTotals(unit);
                    const sqft = calcUnitCountertopTotal(unit);
                    const isSelected = unit.id === selectedUnitId;
                    return (
                      <tr
                        key={unit.id}
                        onClick={() => setSelectedUnitId(unit.id)}
                        className={`cursor-pointer ${isSelected ? '!bg-accent' : ''}`}
                      >
                        <td className="font-semibold">{unit.unitNumber}</td>
                        <td>{unit.bldg || '—'}</td>
                        <td>{unit.floor || '—'}</td>
                        <td>{unit.type}</td>
                        <td className="text-right font-medium">{ct.total}</td>
                        <td className="text-right">{ct.base}</td>
                        <td className="text-right">{ct.wall}</td>
                        <td className="text-right">{ct.tall}</td>
                        <td className="text-right">{sqft.toFixed(1)}</td>
                        <td>
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={(e) => { e.stopPropagation(); duplicateUnit(project.id, unit.id); }}
                              className="p-1 hover:text-primary text-muted-foreground"
                              title="Duplicate unit"
                            >
                              <Copy size={12} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm('Delete this unit?')) deleteUnit(project.id, unit.id);
                              }}
                              className="p-1 hover:text-destructive text-muted-foreground"
                              title="Delete unit"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {/* Summary by type */}
          <div className="est-card overflow-hidden">
            <div className="est-section-header">Unit Type Summary</div>
            <table className="est-table">
              <thead>
                <tr>
                  <th>Unit Type</th>
                  <th className="text-right">Count</th>
                  <th className="text-right">Total Cabinets</th>
                  <th className="text-right">CT Sqft</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byType).map(([type, units]) => (
                  <tr key={type}>
                    <td className="font-medium">{type}</td>
                    <td className="text-right">{units.length}</td>
                    <td className="text-right">{units.reduce((s, u) => s + calcUnitCabinetTotals(u).total, 0)}</td>
                    <td className="text-right">{units.reduce((s, u) => s + calcUnitCountertopTotal(u), 0).toFixed(1)}</td>
                  </tr>
                ))}
                <tr className="font-bold" style={{ background: 'hsl(var(--secondary))' }}>
                  <td>TOTAL</td>
                  <td className="text-right">{project.units.length}</td>
                  <td className="text-right">{project.units.reduce((s, u) => s + calcUnitCabinetTotals(u).total, 0)}</td>
                  <td className="text-right">{project.units.reduce((s, u) => s + calcUnitCountertopTotal(u), 0).toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
