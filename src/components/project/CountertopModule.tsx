import { useState, useMemo } from 'react';
import { Plus, Trash2, Square, FileText } from 'lucide-react';
import type { Project, Unit, CountertopSection } from '@/types/project';
import { calcCountertopSqft, calcUnitCountertopTotal } from '@/lib/calculations';
import CountertopPDFImportDialog from './CountertopPDFImportDialog';

interface Props {
  project: Project;
  selectedUnit: Unit | undefined;
  selectedUnitId: string | null;
  setSelectedUnitId: (id: string) => void;
  addCountertop: (projectId: string, unitId: string, data: Omit<CountertopSection, 'id'>) => CountertopSection;
  updateCountertop: (projectId: string, unitId: string, ctId: string, data: Partial<CountertopSection>) => void;
  deleteCountertop: (projectId: string, unitId: string, ctId: string) => void;
}

const DEFAULT_DEPTH = 25.5;

const blankCT = (): Omit<CountertopSection, 'id'> => ({
  label: '',
  length: 96,
  depth: DEFAULT_DEPTH,
  splashHeight: undefined,
  sideSplash: undefined,
  isIsland: false,
  addWaste: false,
});

interface TypeGroup {
  type: string;
  units: Unit[];
  unitNumbers: string[];
}

export default function CountertopModule({ project, selectedUnit, setSelectedUnitId, addCountertop, updateCountertop, deleteCountertop }: Props) {
  const [form, setForm] = useState(blankCT());
  const [showForm, setShowForm] = useState(false);
  const [showPDFImport, setShowPDFImport] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  // Group units by type
  const typeGroups = useMemo<TypeGroup[]>(() => {
    const map = new Map<string, Unit[]>();
    project.units.forEach(u => {
      const existing = map.get(u.type) || [];
      existing.push(u);
      map.set(u.type, existing);
    });
    return Array.from(map.entries()).map(([type, units]) => ({
      type,
      units,
      unitNumbers: units.map(u => `#${u.unitNumber}`),
    }));
  }, [project.units]);

  // Auto-select first type if none selected
  const activeType = selectedType && typeGroups.some(g => g.type === selectedType)
    ? selectedType
    : typeGroups[0]?.type ?? null;

  const activeGroup = typeGroups.find(g => g.type === activeType);
  // Use first unit of the type as the representative
  const representativeUnit = activeGroup?.units[0];

  const handlePDFImport = (sections: Omit<CountertopSection, 'id'>[]) => {
    if (!representativeUnit || !activeGroup) return;
    // Add to all units of this type
    activeGroup.units.forEach(unit => {
      sections.forEach(s => addCountertop(project.id, unit.id, s));
    });
    setShowPDFImport(false);
  };

  const handleAdd = () => {
    if (!representativeUnit || !activeGroup || !form.label.trim()) return;
    // Add to all units of this type
    activeGroup.units.forEach(unit => {
      addCountertop(project.id, unit.id, form);
    });
    setForm(blankCT());
  };

  const handleUpdate = (ctId: string, data: Partial<CountertopSection>) => {
    if (!activeGroup) return;
    // Find the countertop label to match across units
    const refCt = representativeUnit?.countertops.find(c => c.id === ctId);
    if (!refCt) return;
    // Update in representative unit directly
    updateCountertop(project.id, representativeUnit!.id, ctId, data);
    // Update matching countertops in other units of same type (match by label + index position)
    const refIndex = representativeUnit!.countertops.findIndex(c => c.id === ctId);
    activeGroup.units.slice(1).forEach(unit => {
      const matching = unit.countertops[refIndex];
      if (matching) {
        updateCountertop(project.id, unit.id, matching.id, data);
      }
    });
  };

  const handleDelete = (ctId: string) => {
    if (!activeGroup || !representativeUnit) return;
    const refIndex = representativeUnit.countertops.findIndex(c => c.id === ctId);
    if (!window.confirm('Delete this section from all units of this type?')) return;
    // Delete from representative
    deleteCountertop(project.id, representativeUnit.id, ctId);
    // Delete matching from other units
    activeGroup.units.slice(1).forEach(unit => {
      const matching = unit.countertops[refIndex];
      if (matching) {
        deleteCountertop(project.id, unit.id, matching.id);
      }
    });
  };

  const countertops = representativeUnit?.countertops ?? [];
  const typeSqft = representativeUnit ? calcUnitCountertopTotal(representativeUnit) : 0;
  const typeUnitCount = activeGroup?.units.length ?? 0;

  // Project grand total (all units)
  const projectTotal = project.units.reduce((s, u) => s + calcUnitCountertopTotal(u), 0);

  return (
    <div className="space-y-4">
      {showPDFImport && <CountertopPDFImportDialog onImport={handlePDFImport} onClose={() => setShowPDFImport(false)} />}
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Square size={16} className="text-primary flex-shrink-0" />
        <span className="font-semibold text-sm">Countertop Takeoff</span>
        <span className="text-muted-foreground text-xs">|</span>
        <span className="text-xs text-muted-foreground">Type:</span>
        <select
          className="est-input"
          value={activeType ?? ''}
          onChange={e => setSelectedType(e.target.value)}
        >
          {typeGroups.length === 0 && <option>No types</option>}
          {typeGroups.map(g => (
            <option key={g.type} value={g.type}>
              {g.type} ({g.unitNumbers.join(', ')})
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowPDFImport(true)}
          disabled={!representativeUnit}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-primary text-primary hover:bg-primary/10 disabled:opacity-50"
        >
          <FileText size={12} />
          PDF Import
        </button>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={!representativeUnit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white disabled:opacity-50"
          style={{ background: 'hsl(var(--primary))' }}
        >
          <Plus size={12} />
          Add Section
        </button>
      </div>

      {/* Formula info */}
      <div className="text-xs text-muted-foreground bg-secondary rounded px-3 py-2 border border-border">
        📐 <strong>Formula:</strong> (Length × (Depth + Backsplash Height)) ÷ 144 + Sidesplash Qty × (Depth × Backsplash Height) ÷ 144 = sq ft &nbsp;|&nbsp;
        Default depth: 25.5" &nbsp;|&nbsp; +5% waste option available &nbsp;|&nbsp; Rounded up to whole sqft
      </div>

      {/* Stats */}
      {representativeUnit && activeGroup && (
        <div className="grid grid-cols-4 gap-2">
          <div className="stat-card text-center">
            <div className="stat-value">{countertops.length}</div>
            <div className="stat-label">Sections</div>
          </div>
          <div className="stat-card text-center">
            <div className="stat-value">{typeSqft}</div>
            <div className="stat-label">Per Unit Sqft</div>
          </div>
          <div className="stat-card text-center">
            <div className="stat-value">{typeSqft * typeUnitCount}</div>
            <div className="stat-label">Type Total ({typeUnitCount} units)</div>
          </div>
          <div className="stat-card text-center">
            <div className="stat-value">{projectTotal}</div>
            <div className="stat-label">Project Total Sqft</div>
          </div>
        </div>
      )}

      {/* Add form */}
      {showForm && representativeUnit && (
        <div className="est-card p-3">
          <div className="text-xs text-muted-foreground mb-2">
            Adding to all <strong>{typeUnitCount}</strong> unit(s) of type <strong>{activeType}</strong>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 items-end">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Label *</label>
              <input className="est-input w-full" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Perimeter L1" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Length (in)</label>
              <input type="number" className="est-input w-full" value={form.length} min={1} onChange={e => setForm(f => ({ ...f, length: +e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Depth (in)</label>
              <input type="number" className="est-input w-full" value={form.depth} min={1} step={0.5} onChange={e => setForm(f => ({ ...f, depth: +e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Backsplash Height (in)</label>
              <input type="number" className="est-input w-full" value={form.splashHeight ?? ''} min={0} onChange={e => setForm(f => ({ ...f, splashHeight: +e.target.value || undefined }))} placeholder="opt." />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Sidesplash Qty</label>
              <input type="number" className="est-input w-full" value={form.sideSplash ?? ''} min={0} onChange={e => setForm(f => ({ ...f, sideSplash: +e.target.value || undefined }))} placeholder="opt." />
            </div>
            <div className="flex flex-col gap-1">
              <label className="block text-xs font-medium text-muted-foreground">Island?</label>
              <label className="flex items-center gap-1.5 h-7 cursor-pointer text-xs">
                <input type="checkbox" checked={form.isIsland} onChange={e => setForm(f => ({ ...f, isIsland: e.target.checked }))} />
                Island
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <label className="block text-xs font-medium text-muted-foreground">+5% Waste?</label>
              <label className="flex items-center gap-1.5 h-7 cursor-pointer text-xs">
                <input type="checkbox" checked={form.addWaste} onChange={e => setForm(f => ({ ...f, addWaste: e.target.checked }))} />
                Add waste
              </label>
            </div>
            <div className="flex items-end gap-1">
              <button onClick={handleAdd} disabled={!form.label.trim()} className="h-7 px-3 rounded text-xs font-medium text-white disabled:opacity-50" style={{ background: 'hsl(var(--primary))' }}>Add</button>
              <button onClick={() => setShowForm(false)} className="h-7 px-2 rounded text-xs border border-border text-muted-foreground hover:bg-secondary">✕</button>
            </div>
          </div>
        </div>
      )}

      {/* Countertop table */}
      {representativeUnit && activeGroup ? (
        <div className="est-card overflow-hidden">
          <div className="est-section-header">
            Countertop Sections — {activeType} ({activeGroup.unitNumbers.join(', ')})
          </div>
          {countertops.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No sections added. Click "Add Section" above.
            </div>
          ) : (
            <table className="est-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th className="text-right">Length"</th>
                  <th className="text-right">Depth"</th>
                  <th className="text-right">Backsplash Height"</th>
                  <th className="text-right">Sidesplash Qty</th>
                  <th className="text-center">Island</th>
                  <th className="text-center">+5%</th>
                  <th className="text-right">Sqft</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {countertops.map(ct => (
                  <tr key={ct.id}>
                    <td className="font-medium">{ct.label}</td>
                    <td className="text-right">
                      <input
                        type="number"
                        className="est-input w-16 text-right"
                        value={ct.length}
                        min={1}
                        onChange={e => handleUpdate(ct.id, { length: +e.target.value })}
                      />
                    </td>
                    <td className="text-right">
                      <input
                        type="number"
                        className="est-input w-16 text-right"
                        value={ct.depth}
                        min={1}
                        step={0.5}
                        onChange={e => handleUpdate(ct.id, { depth: +e.target.value })}
                      />
                    </td>
                    <td className="text-right">
                      <input
                        type="number"
                        className="est-input w-16 text-right"
                        value={ct.splashHeight ?? ''}
                        min={0}
                        onChange={e => handleUpdate(ct.id, { splashHeight: +e.target.value || undefined })}
                        placeholder="—"
                      />
                    </td>
                    <td className="text-right">
                      <input
                        type="number"
                        className="est-input w-16 text-right"
                        value={ct.sideSplash ?? ''}
                        min={0}
                        onChange={e => handleUpdate(ct.id, { sideSplash: +e.target.value || undefined })}
                        placeholder="—"
                      />
                    </td>
                    <td className="text-center">
                      {ct.isIsland ? <span className="badge-tall">Island</span> : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={ct.addWaste}
                        onChange={e => handleUpdate(ct.id, { addWaste: e.target.checked })}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="text-right font-bold" style={{ color: 'hsl(var(--primary))' }}>
                      {calcCountertopSqft(ct)}
                    </td>
                    <td>
                      <button
                        onClick={() => handleDelete(ct.id)}
                        className="p-1 hover:text-destructive text-muted-foreground"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'hsl(var(--secondary))', fontWeight: 600 }}>
                  <td colSpan={7} className="px-3 py-1.5 text-sm">PER UNIT TOTAL</td>
                  <td className="px-3 py-1.5 text-sm text-right" style={{ color: 'hsl(var(--primary))' }}>{typeSqft} sqft</td>
                  <td></td>
                </tr>
                <tr style={{ background: 'hsl(var(--secondary))', fontWeight: 600 }}>
                  <td colSpan={7} className="px-3 py-1.5 text-sm">TYPE TOTAL ({typeUnitCount} units × {typeSqft} sqft)</td>
                  <td className="px-3 py-1.5 text-sm text-right" style={{ color: 'hsl(var(--primary))' }}>{typeSqft * typeUnitCount} sqft</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Add units first, then select a type to add countertop sections.
        </div>
      )}

      {/* All types breakdown */}
      {typeGroups.length > 0 && (
        <div className="est-card overflow-hidden">
          <div className="est-section-header">Project Countertop Summary (by Type)</div>
          <table className="est-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Units</th>
                <th className="text-right">Sections</th>
                <th className="text-right">Per Unit Sqft</th>
                <th className="text-right"># Units</th>
                <th className="text-right">Type Total Sqft</th>
              </tr>
            </thead>
            <tbody>
              {typeGroups.map(g => {
                const repUnit = g.units[0];
                const perUnitSqft = calcUnitCountertopTotal(repUnit);
                const actualTotal = g.units.reduce((s, u) => s + calcUnitCountertopTotal(u), 0);
                return (
                  <tr
                    key={g.type}
                    className={`cursor-pointer ${g.type === activeType ? '!bg-accent' : ''}`}
                    onClick={() => setSelectedType(g.type)}
                  >
                    <td className="font-medium">{g.type}</td>
                    <td className="text-xs text-muted-foreground">{g.unitNumbers.join(', ')}</td>
                    <td className="text-right">{repUnit.countertops.length}</td>
                    <td className="text-right">{perUnitSqft}</td>
                    <td className="text-right">{g.units.length}</td>
                    <td className="text-right font-bold" style={{ color: 'hsl(var(--primary))' }}>
                      {actualTotal}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'hsl(var(--secondary))', fontWeight: 600 }}>
                <td colSpan={5} className="px-3 py-1.5 text-sm">PROJECT TOTAL</td>
                <td className="px-3 py-1.5 text-sm text-right" style={{ color: 'hsl(var(--primary))' }}>{projectTotal} sqft</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
