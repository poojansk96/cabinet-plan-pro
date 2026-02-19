import { useState } from 'react';
import { Plus, Trash2, Layers } from 'lucide-react';
import type { Project, Unit, Cabinet, CabinetType, Room } from '@/types/project';
import { buildSkuSummary } from '@/lib/calculations';

const CABINET_TYPES: CabinetType[] = ['Base', 'Wall', 'Tall', 'Vanity'];
const ROOMS: Room[] = ['Kitchen', 'Pantry', 'Laundry', 'Bath', 'Other'];

interface Props {
  project: Project;
  selectedUnit: Unit | undefined;
  selectedUnitId: string | null;
  setSelectedUnitId: (id: string) => void;
  addCabinet: (projectId: string, unitId: string, data: Omit<Cabinet, 'id'>) => Cabinet;
  updateCabinet: (projectId: string, unitId: string, cabinetId: string, data: Partial<Cabinet>) => void;
  deleteCabinet: (projectId: string, unitId: string, cabinetId: string) => void;
}

const blankCabinet = (): Omit<Cabinet, 'id'> => ({
  room: 'Kitchen',
  type: 'Base',
  sku: '',
  width: 24,
  height: 34.5,
  depth: 24,
  quantity: 1,
  notes: '',
});

function TypeBadge({ type }: { type: CabinetType }) {
  const cls = type === 'Base' ? 'badge-base' : type === 'Wall' ? 'badge-wall' : type === 'Tall' ? 'badge-tall' : 'badge-wall';
  return <span className={cls}>{type[0]}</span>;
}

export default function CabinetModule({ project, selectedUnit, setSelectedUnitId, addCabinet, updateCabinet, deleteCabinet }: Props) {
  const [form, setForm] = useState(blankCabinet());
  const [showForm, setShowForm] = useState(false);
  const [filterType, setFilterType] = useState<CabinetType | 'All'>('All');

  const handleAdd = () => {
    if (!selectedUnit || !form.sku.trim()) return;
    addCabinet(project.id, selectedUnit.id, form);
    setForm(f => ({ ...f, sku: '', notes: '' }));
  };

  const cabinets = selectedUnit?.cabinets ?? [];
  const filtered = filterType === 'All' ? cabinets : cabinets.filter(c => c.type === filterType);

  // Totals
  const totals = CABINET_TYPES.reduce<Record<string, number>>((acc, t) => {
    acc[t] = cabinets.filter(c => c.type === t).reduce((s, c) => s + c.quantity, 0);
    return acc;
  }, {});
  totals['All'] = cabinets.reduce((s, c) => s + c.quantity, 0);

  const skuSummary = selectedUnit ? buildSkuSummary(selectedUnit.cabinets) : [];

  return (
    <div className="space-y-4">
      {/* Unit selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <Layers size={16} className="text-primary flex-shrink-0" />
        <span className="font-semibold text-sm">Cabinet Takeoff</span>
        <span className="text-muted-foreground text-xs">|</span>
        <span className="text-xs text-muted-foreground">Unit:</span>
        <select
          className="est-input"
          value={selectedUnit?.id ?? ''}
          onChange={e => setSelectedUnitId(e.target.value)}
        >
          {project.units.length === 0 && <option value="">No units — add units first</option>}
          {project.units.map(u => (
            <option key={u.id} value={u.id}>
              #{u.unitNumber} ({u.type})
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={!selectedUnit}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white disabled:opacity-50"
          style={{ background: 'hsl(var(--primary))' }}
        >
          <Plus size={12} />
          Add Cabinet
        </button>
      </div>

      {/* Quick stats */}
      {selectedUnit && (
        <div className="grid grid-cols-5 gap-2">
          {(['All', ...CABINET_TYPES] as const).map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t as CabinetType | 'All')}
              className={`stat-card text-center cursor-pointer transition-all ${filterType === t ? 'ring-2' : ''}`}
              style={filterType === t ? { '--tw-ring-color': 'hsl(var(--primary))' } as React.CSSProperties : {}}
            >
              <div className="stat-value text-xl">{totals[t] ?? 0}</div>
              <div className="stat-label">{t}</div>
            </button>
          ))}
        </div>
      )}

      {/* Add form */}
      {showForm && selectedUnit && (
        <div className="est-card p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Room</label>
              <select className="est-input w-full" value={form.room} onChange={e => setForm(f => ({ ...f, room: e.target.value as Room }))}>
                {ROOMS.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
              <select className="est-input w-full" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as CabinetType }))}>
                {CABINET_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">SKU *</label>
              <input className="est-input w-full" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value.toUpperCase() }))} placeholder="B24" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">W (in)</label>
              <input type="number" className="est-input w-full" value={form.width} min={1} onChange={e => setForm(f => ({ ...f, width: +e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">H (in)</label>
              <input type="number" className="est-input w-full" value={form.height} min={1} onChange={e => setForm(f => ({ ...f, height: +e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">D (in)</label>
              <input type="number" className="est-input w-full" value={form.depth} min={1} onChange={e => setForm(f => ({ ...f, depth: +e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Qty</label>
              <input type="number" className="est-input w-full" value={form.quantity} min={1} onChange={e => setForm(f => ({ ...f, quantity: Math.max(1, +e.target.value) }))} />
            </div>
            <div className="flex items-end gap-1">
              <button onClick={handleAdd} disabled={!form.sku.trim()} className="h-7 px-3 rounded text-xs font-medium text-white disabled:opacity-50" style={{ background: 'hsl(var(--primary))' }}>
                Add
              </button>
              <button onClick={() => setShowForm(false)} className="h-7 px-2 rounded text-xs border border-border text-muted-foreground hover:bg-secondary">✕</button>
            </div>
          </div>
        </div>
      )}

      {/* Cabinet table */}
      {selectedUnit ? (
        <div className="space-y-4">
          <div className="est-card overflow-hidden">
            <div className="est-section-header">
              <span>Cabinet List — Unit #{selectedUnit.unitNumber}</span>
              {filterType !== 'All' && <span className="ml-2 text-muted-foreground font-normal">({filterType} only)</span>}
            </div>
            {filtered.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No cabinets{filterType !== 'All' ? ` of type "${filterType}"` : ''}. Click "Add Cabinet" above.
              </div>
            ) : (
              <table className="est-table">
                <thead>
                  <tr>
                    <th>Room</th>
                    <th>Type</th>
                    <th>SKU</th>
                    <th className="text-right">W"</th>
                    <th className="text-right">H"</th>
                    <th className="text-right">D"</th>
                    <th className="text-right">Qty</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(cab => (
                    <tr key={cab.id}>
                      <td>{cab.room}</td>
                      <td><TypeBadge type={cab.type} /></td>
                      <td className="font-mono font-medium">{cab.sku}</td>
                      <td className="text-right">{cab.width}</td>
                      <td className="text-right">{cab.height}</td>
                      <td className="text-right">{cab.depth}</td>
                      <td className="text-right">
                        <input
                          type="number"
                          className="est-input w-14 text-right"
                          value={cab.quantity}
                          min={1}
                          onChange={e => updateCabinet(project.id, selectedUnit.id, cab.id, { quantity: Math.max(1, +e.target.value) })}
                        />
                      </td>
                      <td>
                        <button
                          onClick={() => { if (window.confirm('Delete?')) deleteCabinet(project.id, selectedUnit.id, cab.id); }}
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
                    <td colSpan={6} className="px-3 py-1.5 text-sm">TOTAL</td>
                    <td className="px-3 py-1.5 text-sm text-right">{filtered.reduce((s, c) => s + c.quantity, 0)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* SKU Summary */}
          {skuSummary.length > 0 && (
            <div className="est-card overflow-hidden">
              <div className="est-section-header">SKU Summary — Unit #{selectedUnit.unitNumber}</div>
              <table className="est-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Type</th>
                    <th className="text-right">W"</th>
                    <th className="text-right">H"</th>
                    <th className="text-right">D"</th>
                    <th>Rooms</th>
                    <th className="text-right">Total Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {skuSummary.map((s, i) => (
                    <tr key={i}>
                      <td className="font-mono font-semibold">{s.sku}</td>
                      <td><TypeBadge type={s.type} /></td>
                      <td className="text-right">{s.width}</td>
                      <td className="text-right">{s.height}</td>
                      <td className="text-right">{s.depth}</td>
                      <td className="text-xs text-muted-foreground">{s.rooms.join(', ')}</td>
                      <td className="text-right font-bold">{s.totalQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Add units first, then select a unit to add cabinets.
        </div>
      )}
    </div>
  );
}
