import { useState } from 'react';
import { Plus, Trash2, Copy, Users, FileUp, Eraser } from 'lucide-react';
import type { Project, Unit, UnitType } from '@/types/project';
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
  clearUnits: (projectId: string) => void;
  duplicateUnit: (projectId: string, unitId: string) => void;
}

export default function UnitModule({ project, selectedUnitId, setSelectedUnitId, addUnit, updateUnit, deleteUnit, clearUnits, duplicateUnit }: Props) {
  const [editingCell, setEditingCell] = useState<{ id: string; field: 'unitNumber' | 'bldg' | 'floor' | 'type' | 'notes' } | null>(null);
  const [cellValue, setCellValue] = useState('');

  const startEditing = (id: string, field: typeof editingCell extends null ? never : NonNullable<typeof editingCell>['field'], value: string) => {
    setEditingCell({ id, field });
    setCellValue(value);
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const { id, field } = editingCell;
    updateUnit(project.id, id, { [field]: cellValue });
    setEditingCell(null);
  };

  const handleCellKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      commitEdit();
    }
  };
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankForm());
  const [showPDFImport, setShowPDFImport] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const resolvedType = form.type.trim() || 'Other';

  const handleAdd = () => {
    if (!form.unitNumber.trim()) return;
    const unit = addUnit(project.id, { unitNumber: form.unitNumber, type: resolvedType, bldg: form.bldg, floor: form.floor, notes: form.notes });
    setSelectedUnitId(unit.id);
    setForm(blankForm());
    setShowForm(false);
  };

  const handlePDFImport = (units: Array<{ unitNumber: string; type: UnitType; floor: string; bldg: string }>) => {
    const normalizeUnitKey = (val: string) => String(val || '').toUpperCase().replace(/\s+/g, '');
    const parseFloor = (f: string) => {
      const n = parseFloat(String(f || '').replace(/^Floor\s*/i, ''));
      return isNaN(n) ? Infinity : n;
    };

    // Deduplicate imported rows by normalized unit number, keeping the lowest floor
    const bestImportedByUnit = new Map<string, typeof units[0]>();
    for (const u of units) {
      const key = normalizeUnitKey(u.unitNumber);
      if (!key) continue;
      const existing = bestImportedByUnit.get(key);
      if (!existing || parseFloor(u.floor) < parseFloor(existing.floor)) {
        bestImportedByUnit.set(key, u);
      }
    }

    let lastUnit: Unit | null = null;
    let addedCount = 0;

    // Apply imported rows against current project data, collapsing duplicates to one (lowest floor) per unit number
    for (const imported of bestImportedByUnit.values()) {
      const key = normalizeUnitKey(imported.unitNumber);
      const matches = project.units.filter(pu => normalizeUnitKey(pu.unitNumber) === key);

      if (matches.length === 0) {
        lastUnit = addUnit(project.id, {
          unitNumber: imported.unitNumber,
          type: imported.type,
          floor: imported.floor || '',
          bldg: imported.bldg || '',
          notes: '',
        });
        addedCount++;
        continue;
      }

      // Keep one existing record and update it to the lower floor if needed
      const keeper = matches[0];
      const best = [...matches.map(m => ({ unitNumber: m.unitNumber, type: m.type as UnitType, floor: m.floor, bldg: m.bldg })), imported]
        .sort((a, b) => parseFloor(a.floor) - parseFloor(b.floor))[0];

      updateUnit(project.id, keeper.id, {
        unitNumber: best.unitNumber,
        type: best.type,
        floor: best.floor || '',
        bldg: best.bldg || '',
      });

      // Remove duplicate existing rows for the same normalized unit number
      for (const dup of matches.slice(1)) {
        deleteUnit(project.id, dup.id);
      }
    }

    if (lastUnit) setSelectedUnitId((lastUnit as Unit).id);
    setImportedCount(addedCount);
    setShowPDFImport(false);
    setTimeout(() => setImportedCount(null), 4000);
  };

  const numericAsc = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

  const floorVal = (f: string) => {
    const n = parseFloat(f);
    return isNaN(n) ? Infinity : n;
  };

  // Sort all units: bldg → floor (ascending: numeric then alpha) → unit number (ascending)
  const sortedUnits = [...project.units].sort((a, b) => {
    const bldgCmp = numericAsc(a.bldg || '', b.bldg || '');
    if (bldgCmp !== 0) return bldgCmp;
    // Floor sort: empty floors go last, then numeric ascending, then alpha ascending
    const flA = a.floor || '';
    const flB = b.floor || '';
    if (flA === '' && flB !== '') return 1;
    if (flA !== '' && flB === '') return -1;
    // Try numeric comparison first
    const nA = parseFloat(flA);
    const nB = parseFloat(flB);
    const aIsNum = !isNaN(nA);
    const bIsNum = !isNaN(nB);
    if (aIsNum && bIsNum) {
      if (nA !== nB) return nA - nB;
    } else if (aIsNum && !bIsNum) {
      return -1; // numbers before letters
    } else if (!aIsNum && bIsNum) {
      return 1;
    } else {
      const flCmp = flA.localeCompare(flB, undefined, { numeric: true, sensitivity: 'base' });
      if (flCmp !== 0) return flCmp;
    }
    return numericAsc(a.unitNumber, b.unitNumber);
  });

  const allSelected = sortedUnits.length > 0 && sortedUnits.every(u => selectedIds.has(u.id));
  const someSelected = selectedIds.size > 0;

  const toggleOne = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(sortedUnits.map(u => u.id)));
  };

  const deleteSelected = () => {
    if (!window.confirm(`Delete ${selectedIds.size} selected unit${selectedIds.size !== 1 ? 's' : ''}?`)) return;
    selectedIds.forEach(id => deleteUnit(project.id, id));
    setSelectedIds(new Set());
  };


  return (
    <div className="space-y-4">
      {/* PDF Import Dialog */}
      {showPDFImport && (
        <PDFImportDialog
          onImport={handlePDFImport}
          onClose={() => setShowPDFImport(false)}
          takeoffPerson={(project.specs as Record<string, string> | undefined)?.takeoffPerson}
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
            Upload Architect Floor Plan
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
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl" style={{ background: 'hsl(var(--primary) / 0.10)' }}>📄</div>
          <h3 className="text-lg font-bold text-foreground mb-1.5">Upload a floor plan — AI will detect every unit, cabinet type, and countertop automatically.</h3>
          <p className="text-sm text-muted-foreground mb-5 max-w-sm mx-auto">
            Upload an architectural floor plan PDF. The system automatically identifies unit types, cabinet layouts, SKUs, and countertop quantities.
          </p>
          <div className="flex items-center justify-center gap-3 mb-5">
            <button
              onClick={() => setShowPDFImport(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all"
              style={{ background: 'hsl(var(--primary))' }}
            >
              <FileUp size={15} />
              Upload Architect Floor Plan
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-secondary transition-colors"
            >
              <Plus size={15} />
              Add Unit Manually
            </button>
          </div>
          <div className="mt-5 rounded-xl border border-primary/20 px-5 py-4 text-left max-w-xs mx-auto" style={{ background: 'hsl(var(--primary) / 0.05)' }}>
            <p className="text-xs font-bold uppercase tracking-wider text-primary mb-2.5">Auto-detects:</p>
            <ul className="space-y-1.5">
              <li className="flex items-center gap-2 text-xs font-medium text-foreground">
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: 'hsl(var(--primary))' }}>✓</span>
                Units &amp; unit types
              </li>
              <li className="flex items-center gap-2 text-xs font-medium text-foreground">
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: 'hsl(var(--primary))' }}>✓</span>
                Cabinet types &amp; SKUs
              </li>
              <li className="flex items-center gap-2 text-xs font-medium text-foreground">
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: 'hsl(var(--primary))' }}>✓</span>
                Countertop square footage
              </li>
              <li className="flex items-center gap-2 text-xs font-medium text-foreground">
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: 'hsl(var(--primary))' }}>✓</span>
                Cabinet counts per unit
              </li>
            </ul>
          </div>
        </div>
      ) : (
        <>
          {/* Floor-wise unit totals */}
          {(() => {
            const floorCounts: Record<string, number> = {};
            for (const u of project.units) {
              const fl = u.floor ? (/^\d+$/.test(u.floor) ? `Floor ${u.floor}` : u.floor) : 'Unassigned';
              floorCounts[fl] = (floorCounts[fl] || 0) + 1;
            }
            const sortedFloors = Object.entries(floorCounts).sort((a, b) => {
              const na = parseFloat(a[0].replace(/^Floor\s*/i, '')) || 0;
              const nb = parseFloat(b[0].replace(/^Floor\s*/i, '')) || 0;
              if (na !== nb) return na - nb;
              return a[0].localeCompare(b[0], undefined, { numeric: true });
            });
            return (
              <div className="flex flex-wrap items-center gap-2">
                {sortedFloors.map(([fl, count]) => (
                  <span key={fl} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-accent border border-border text-foreground">
                    {fl}: <strong>{count}</strong> unit{count !== 1 ? 's' : ''}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-primary/10 border border-primary/20 text-primary">
                  Total: <strong>{project.units.length}</strong> unit{project.units.length !== 1 ? 's' : ''}
                </span>
              </div>
            );
          })()}

        <div className="est-card overflow-hidden">
          {/* Bulk action bar */}
          {someSelected && (
            <div className="flex items-center gap-3 px-3 py-2 bg-accent border-b border-border">
              <span className="text-xs font-medium text-foreground">{selectedIds.size} unit{selectedIds.size !== 1 ? 's' : ''} selected</span>
              <button
                onClick={deleteSelected}
                className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium border border-destructive text-destructive hover:bg-destructive/10 transition-colors ml-auto"
              >
                <Trash2 size={12} />
                Delete selected
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          )}

          <table className="est-table">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="cursor-pointer"
                    title="Select all"
                  />
                </th>
                <th>Unit #</th>
                <th>Bldg</th>
                <th>Floor</th>
                <th>Type</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedUnits.map(unit => {
                const isActive = unit.id === selectedUnitId;
                const isChecked = selectedIds.has(unit.id);
                return (
                  <tr
                    key={unit.id}
                    onClick={() => setSelectedUnitId(unit.id)}
                    className={`cursor-pointer ${isActive ? '!bg-accent' : ''}`}
                  >
                    <td onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOne(unit.id)}
                        className="cursor-pointer"
                      />
                    </td>
                    {(['unitNumber', 'bldg', 'floor', 'type', 'notes'] as const).map(field => {
                      const isEditing = editingCell?.id === unit.id && editingCell?.field === field;
                      let display: React.ReactNode = unit[field] || '—';
                      if (field === 'floor' && unit.floor) {
                        display = /^\d+$/.test(unit.floor) ? `Floor ${unit.floor}` : unit.floor;
                      }
                      if (field === 'unitNumber') {
                        display = <span className="font-semibold">{unit.unitNumber}</span>;
                      }
                      if (field === 'notes' && !unit.notes) {
                        display = <span className="opacity-40 italic">Add note…</span>;
                      }
                      return (
                        <td
                          key={field}
                          className={field === 'notes' ? 'text-muted-foreground text-xs' : ''}
                          onClick={e => { e.stopPropagation(); startEditing(unit.id, field, unit[field] || ''); }}
                        >
                          {isEditing ? (
                            <input
                              className="est-input text-xs w-full"
                              value={cellValue}
                              onChange={e => setCellValue(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={handleCellKeyDown}
                              autoFocus
                            />
                          ) : (
                            <span className="cursor-text hover:text-foreground transition-colors" title={`Click to edit`}>
                              {display}
                            </span>
                          )}
                        </td>
                      );
                    })}
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
        </>
      )}

      {/* Clear all units */}
      {project.units.length > 0 && (
        <div className="flex justify-end pt-1">
          <button
            onClick={() => {
              if (window.confirm(`Delete all ${project.units.length} unit${project.units.length !== 1 ? 's' : ''}? This cannot be undone.`)) {
                clearUnits(project.id);
                setSelectedUnitId('');
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-destructive text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Eraser size={12} />
            Clear All Units
          </button>
        </div>
      )}
    </div>
  );
}
