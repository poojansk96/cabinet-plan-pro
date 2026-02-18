import { useState } from 'react';
import { Plus, Trash2, Square } from 'lucide-react';
import type { Project, Unit, CountertopSection } from '@/types/project';
import { calcCountertopSqft, calcUnitCountertopTotal } from '@/lib/calculations';

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
  isIsland: false,
  addWaste: false,
});

export default function CountertopModule({ project, selectedUnit, setSelectedUnitId, addCountertop, updateCountertop, deleteCountertop }: Props) {
  const [form, setForm] = useState(blankCT());
  const [showForm, setShowForm] = useState(false);

  const handleAdd = () => {
    if (!selectedUnit || !form.label.trim()) return;
    addCountertop(project.id, selectedUnit.id, form);
    setForm(blankCT());
  };

  const countertops = selectedUnit?.countertops ?? [];
  const totalSqft = selectedUnit ? calcUnitCountertopTotal(selectedUnit) : 0;

  // Project grand total
  const projectTotal = project.units.reduce((s, u) => s + calcUnitCountertopTotal(u), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Square size={16} className="text-primary flex-shrink-0" />
        <span className="font-semibold text-sm">Countertop Takeoff</span>
        <span className="text-muted-foreground text-xs">|</span>
        <span className="text-xs text-muted-foreground">Unit:</span>
        <select
          className="est-input"
          value={selectedUnit?.id ?? ''}
          onChange={e => setSelectedUnitId(e.target.value)}
        >
          {project.units.length === 0 && <option>No units</option>}
          {project.units.map(u => (
            <option key={u.id} value={u.id}>#{u.unitNumber} ({u.type})</option>
          ))}
        </select>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={!selectedUnit}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white disabled:opacity-50"
          style={{ background: 'hsl(var(--primary))' }}
        >
          <Plus size={12} />
          Add Section
        </button>
      </div>

      {/* Formula info */}
      <div className="text-xs text-muted-foreground bg-secondary rounded px-3 py-2 border border-border">
        📐 <strong>Formula:</strong> (Length × Depth) ÷ 144 = sq ft &nbsp;|&nbsp;
        Default depth: 25.5" &nbsp;|&nbsp; +10% waste option available &nbsp;|&nbsp; Rounded to nearest 0.5 sqft
      </div>

      {/* Stats */}
      {selectedUnit && (
        <div className="grid grid-cols-3 gap-2">
          <div className="stat-card text-center">
            <div className="stat-value">{countertops.length}</div>
            <div className="stat-label">Sections</div>
          </div>
          <div className="stat-card text-center">
            <div className="stat-value">{totalSqft.toFixed(1)}</div>
            <div className="stat-label">Unit Total Sqft</div>
          </div>
          <div className="stat-card text-center">
            <div className="stat-value">{projectTotal.toFixed(1)}</div>
            <div className="stat-label">Project Total Sqft</div>
          </div>
        </div>
      )}

      {/* Add form */}
      {showForm && selectedUnit && (
        <div className="est-card p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 items-end">
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
              <label className="block text-xs font-medium text-muted-foreground mb-1">Splash H (in)</label>
              <input type="number" className="est-input w-full" value={form.splashHeight ?? ''} min={0} onChange={e => setForm(f => ({ ...f, splashHeight: +e.target.value || undefined }))} placeholder="opt." />
            </div>
            <div className="flex flex-col gap-1">
              <label className="block text-xs font-medium text-muted-foreground">Island?</label>
              <label className="flex items-center gap-1.5 h-7 cursor-pointer text-xs">
                <input type="checkbox" checked={form.isIsland} onChange={e => setForm(f => ({ ...f, isIsland: e.target.checked }))} />
                Island
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <label className="block text-xs font-medium text-muted-foreground">+10% Waste?</label>
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
      {selectedUnit ? (
        <div className="est-card overflow-hidden">
          <div className="est-section-header">
            Countertop Sections — Unit #{selectedUnit.unitNumber}
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
                  <th className="text-right">Splash"</th>
                  <th className="text-center">Island</th>
                  <th className="text-center">+10%</th>
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
                        onChange={e => updateCountertop(project.id, selectedUnit.id, ct.id, { length: +e.target.value })}
                      />
                    </td>
                    <td className="text-right">
                      <input
                        type="number"
                        className="est-input w-16 text-right"
                        value={ct.depth}
                        min={1}
                        step={0.5}
                        onChange={e => updateCountertop(project.id, selectedUnit.id, ct.id, { depth: +e.target.value })}
                      />
                    </td>
                    <td className="text-right">{ct.splashHeight ?? '—'}</td>
                    <td className="text-center">
                      {ct.isIsland ? <span className="badge-tall">Island</span> : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={ct.addWaste}
                        onChange={e => updateCountertop(project.id, selectedUnit.id, ct.id, { addWaste: e.target.checked })}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="text-right font-bold" style={{ color: 'hsl(var(--primary))' }}>
                      {calcCountertopSqft(ct).toFixed(1)}
                    </td>
                    <td>
                      <button
                        onClick={() => { if (window.confirm('Delete?')) deleteCountertop(project.id, selectedUnit.id, ct.id); }}
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
                  <td colSpan={6} className="px-3 py-1.5 text-sm">UNIT TOTAL</td>
                  <td className="px-3 py-1.5 text-sm text-right" style={{ color: 'hsl(var(--primary))' }}>{totalSqft.toFixed(1)} sqft</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Add units first, then select a unit to add countertop sections.
        </div>
      )}

      {/* All units breakdown */}
      {project.units.length > 0 && (
        <div className="est-card overflow-hidden">
          <div className="est-section-header">Project Countertop Summary</div>
          <table className="est-table">
            <thead>
              <tr>
                <th>Unit #</th>
                <th>Type</th>
                <th className="text-right">Sections</th>
                <th className="text-right">Total Sqft</th>
              </tr>
            </thead>
            <tbody>
              {project.units.map(u => (
                <tr
                  key={u.id}
                  className={`cursor-pointer ${u.id === selectedUnit?.id ? '!bg-accent' : ''}`}
                  onClick={() => setSelectedUnitId(u.id)}
                >
                  <td className="font-medium">#{u.unitNumber}</td>
                  <td>{u.type}</td>
                  <td className="text-right">{u.countertops.length}</td>
                  <td className="text-right font-bold" style={{ color: 'hsl(var(--primary))' }}>
                    {calcUnitCountertopTotal(u).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'hsl(var(--secondary))', fontWeight: 600 }}>
                <td colSpan={3} className="px-3 py-1.5 text-sm">PROJECT TOTAL</td>
                <td className="px-3 py-1.5 text-sm text-right" style={{ color: 'hsl(var(--primary))' }}>{projectTotal.toFixed(1)} sqft</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
