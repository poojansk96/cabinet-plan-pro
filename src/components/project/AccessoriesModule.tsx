import { useState } from 'react';
import { Plus, Trash2, Wrench } from 'lucide-react';
import type { Project, Unit, Accessory, AccessoryType } from '@/types/project';

const ACC_TYPES: AccessoryType[] = [
  'Filler', 'Finished Panel', 'Toe Kick', 'Crown Molding', 'Light Rail', 'Hardware', 'Other'
];

interface Props {
  project: Project;
  selectedUnit: Unit | undefined;
  selectedUnitId: string | null;
  setSelectedUnitId: (id: string) => void;
  addAccessory: (projectId: string, unitId: string, data: Omit<Accessory, 'id'>) => Accessory;
  updateAccessory: (projectId: string, unitId: string, accId: string, data: Partial<Accessory>) => void;
  deleteAccessory: (projectId: string, unitId: string, accId: string) => void;
}

const blankAcc = (): Omit<Accessory, 'id'> => ({
  type: 'Filler',
  description: '',
  width: undefined,
  height: undefined,
  linearFeet: undefined,
  quantity: 1,
  notes: '',
});

function needsDimensions(type: AccessoryType) {
  return type === 'Filler' || type === 'Finished Panel';
}

function needsLF(type: AccessoryType) {
  return type === 'Toe Kick' || type === 'Crown Molding' || type === 'Light Rail';
}

export default function AccessoriesModule({ project, selectedUnit, setSelectedUnitId, addAccessory, updateAccessory, deleteAccessory }: Props) {
  const [form, setForm] = useState(blankAcc());
  const [showForm, setShowForm] = useState(false);

  const handleAdd = () => {
    if (!selectedUnit) return;
    addAccessory(project.id, selectedUnit.id, form);
    setForm(blankAcc());
  };

  const accessories = selectedUnit?.accessories ?? [];

  // Summary totals
  const summary = {
    fillers: accessories.filter(a => a.type === 'Filler').reduce((s, a) => s + a.quantity, 0),
    panels: accessories.filter(a => a.type === 'Finished Panel').reduce((s, a) => s + a.quantity, 0),
    toeKickLF: accessories.filter(a => a.type === 'Toe Kick').reduce((s, a) => s + (a.linearFeet ?? 0) * a.quantity, 0),
    crownLF: accessories.filter(a => a.type === 'Crown Molding').reduce((s, a) => s + (a.linearFeet ?? 0) * a.quantity, 0),
    lightRailLF: accessories.filter(a => a.type === 'Light Rail').reduce((s, a) => s + (a.linearFeet ?? 0) * a.quantity, 0),
    hardware: accessories.filter(a => a.type === 'Hardware').reduce((s, a) => s + a.quantity, 0),
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Wrench size={16} className="text-primary flex-shrink-0" />
        <span className="font-semibold text-sm">Accessories & Trim</span>
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
          Add Accessory
        </button>
      </div>

      {/* Summary row */}
      {selectedUnit && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {[
            { label: 'Fillers', value: summary.fillers, unit: 'pcs' },
            { label: 'Panels', value: summary.panels, unit: 'pcs' },
            { label: 'Toe Kick', value: summary.toeKickLF, unit: 'LF' },
            { label: 'Crown', value: summary.crownLF, unit: 'LF' },
            { label: 'Light Rail', value: summary.lightRailLF, unit: 'LF' },
            { label: 'Hardware', value: summary.hardware, unit: 'pcs' },
          ].map(s => (
            <div key={s.label} className="stat-card text-center">
              <div className="stat-value text-xl">{s.value}</div>
              <div className="stat-label">{s.label} <span className="normal-case font-normal">({s.unit})</span></div>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {showForm && selectedUnit && (
        <div className="est-card p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
              <select
                className="est-input w-full"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as AccessoryType }))}
              >
                {ACC_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
              <input className="est-input w-full" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder='e.g. 3" Filler - Left' />
            </div>
            {needsDimensions(form.type) && (
              <>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Width (in)</label>
                  <input type="number" className="est-input w-full" value={form.width ?? ''} min={0} onChange={e => setForm(f => ({ ...f, width: +e.target.value || undefined }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Height (in)</label>
                  <input type="number" className="est-input w-full" value={form.height ?? ''} min={0} onChange={e => setForm(f => ({ ...f, height: +e.target.value || undefined }))} />
                </div>
              </>
            )}
            {needsLF(form.type) && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Linear Feet</label>
                <input type="number" className="est-input w-full" value={form.linearFeet ?? ''} min={0} step={0.1} onChange={e => setForm(f => ({ ...f, linearFeet: +e.target.value || undefined }))} />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Qty</label>
              <input type="number" className="est-input w-full" value={form.quantity} min={1} onChange={e => setForm(f => ({ ...f, quantity: Math.max(1, +e.target.value) }))} />
            </div>
            <div className="flex items-end gap-1">
              <button onClick={handleAdd} className="h-7 px-3 rounded text-xs font-medium text-white" style={{ background: 'hsl(var(--primary))' }}>Add</button>
              <button onClick={() => setShowForm(false)} className="h-7 px-2 rounded text-xs border border-border text-muted-foreground hover:bg-secondary">✕</button>
            </div>
          </div>
        </div>
      )}

      {/* Accessories table */}
      {selectedUnit ? (
        <div className="est-card overflow-hidden">
          <div className="est-section-header">
            Accessories — Unit #{selectedUnit.unitNumber}
          </div>
          {accessories.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No accessories added. Click "Add Accessory" above.
            </div>
          ) : (
            <table className="est-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Description</th>
                  <th className="text-right">W"</th>
                  <th className="text-right">H"</th>
                  <th className="text-right">LF</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Total LF</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {accessories.map(acc => (
                  <tr key={acc.id}>
                    <td>
                      <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-secondary">{acc.type}</span>
                    </td>
                    <td>{acc.description}</td>
                    <td className="text-right">{acc.width ?? '—'}</td>
                    <td className="text-right">{acc.height ?? '—'}</td>
                    <td className="text-right">{acc.linearFeet ?? '—'}</td>
                    <td className="text-right">
                      <input
                        type="number"
                        className="est-input w-14 text-right"
                        value={acc.quantity}
                        min={1}
                        onChange={e => updateAccessory(project.id, selectedUnit.id, acc.id, { quantity: Math.max(1, +e.target.value) })}
                      />
                    </td>
                    <td className="text-right font-medium">
                      {acc.linearFeet ? (acc.linearFeet * acc.quantity).toFixed(1) : '—'}
                    </td>
                    <td>
                      <button
                        onClick={() => { if (window.confirm('Delete?')) deleteAccessory(project.id, selectedUnit.id, acc.id); }}
                        className="p-1 hover:text-destructive text-muted-foreground"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Add units first, then select a unit to manage accessories.
        </div>
      )}
    </div>
  );
}
