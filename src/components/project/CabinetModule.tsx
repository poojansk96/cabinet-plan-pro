import { useState } from 'react';
import { Plus, Layers, FileUp } from 'lucide-react';
import type { Project, Unit, Cabinet, CabinetType, Room } from '@/types/project';
import { buildSkuSummary } from '@/lib/calculations';
import CabinetPDFImportDialog from './CabinetPDFImportDialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

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

type SectionKey = 'elevation' | 'enlarge';

function SectionControls({
  sectionLabel,
  unitTypes,
  importTargetType,
  setImportTargetType,
  onImportPDF,
  onAddCabinet,
  showForm,
  setShowForm,
  selectedUnit,
  projectHasUnits,
}: {
  sectionLabel: string;
  unitTypes: string[];
  importTargetType: string;
  setImportTargetType: (v: string) => void;
  onImportPDF: () => void;
  onAddCabinet: () => void;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  selectedUnit: Unit | undefined;
  projectHasUnits: boolean;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground">{sectionLabel}</span>
      <div className="ml-auto flex items-center gap-2 flex-wrap">
        {unitTypes.length > 0 && (
          <select
            className="est-input text-xs h-7 pr-6"
            value={importTargetType}
            onChange={e => setImportTargetType(e.target.value)}
            title="Select unit type to import cabinets for"
          >
            <option value="">All unit types</option>
            {unitTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <button
          onClick={onImportPDF}
          disabled={!projectHasUnits}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors disabled:opacity-50"
          style={{ borderColor: 'hsl(var(--primary))', color: 'hsl(var(--primary))' }}
        >
          <FileUp size={12} />
          Import PDF
        </button>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={!selectedUnit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white disabled:opacity-50"
          style={{ background: 'hsl(var(--primary))' }}
        >
          <Plus size={12} />
          Add Cabinet
        </button>
      </div>
    </div>
  );
}

export default function CabinetModule({ project, selectedUnit, addCabinet, updateCabinet, deleteCabinet }: Props) {
  const [activeSection, setActiveSection] = useState<SectionKey>('elevation');
  const [form, setForm] = useState(blankCabinet());
  const [showForm, setShowForm] = useState(false);
  const [showPDFImport, setShowPDFImport] = useState(false);
  const [importTargetType, setImportTargetType] = useState<string>('');
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [importedSection, setImportedSection] = useState<string>('');

  const handleAdd = () => {
    if (!selectedUnit || !form.sku.trim()) return;
    addCabinet(project.id, selectedUnit.id, form);
    setForm(f => ({ ...f, sku: '', notes: '' }));
  };

  const unitTypes = Array.from(new Set(project.units.map(u => u.type)));

  const handlePDFImport = (cabinets: Array<Omit<Cabinet, 'id'>>) => {
    const targetUnits = importTargetType
      ? project.units.filter(u => u.type === importTargetType)
      : project.units;

    targetUnits.forEach(unit => {
      cabinets.forEach(cab => {
        addCabinet(project.id, unit.id, cab);
      });
    });

    setImportedCount(cabinets.length);
    setImportedSection(activeSection === 'elevation' ? 'Elevation' : 'Enlarge & Elev.');
    setShowPDFImport(false);
    setTimeout(() => setImportedCount(null), 4000);
  };

  // Summary data
  const unitTypeGroups = project.units.reduce<Record<string, { unitCount: number; base: number; wall: number; tall: number; vanity: number; skus: string[] }>>((acc, u) => {
    if (!acc[u.type]) acc[u.type] = { unitCount: 0, base: 0, wall: 0, tall: 0, vanity: 0, skus: [] };
    acc[u.type].unitCount += 1;
    u.cabinets.forEach(c => {
      if (c.type === 'Base') acc[u.type].base += c.quantity;
      else if (c.type === 'Wall') acc[u.type].wall += c.quantity;
      else if (c.type === 'Tall') acc[u.type].tall += c.quantity;
      else if (c.type === 'Vanity') acc[u.type].vanity += c.quantity;
      if (!acc[u.type].skus.includes(c.sku)) acc[u.type].skus.push(c.sku);
    });
    return acc;
  }, {});

  const addForm = showForm && selectedUnit && (
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
  );

  return (
    <div className="space-y-4">
      {showPDFImport && (
        <CabinetPDFImportDialog
          unitType={importTargetType || undefined}
          onImport={handlePDFImport}
          onClose={() => setShowPDFImport(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-2">
        <Layers size={16} className="text-primary flex-shrink-0" />
        <span className="font-semibold text-sm">Cabinet Takeoff</span>
      </div>

      {/* Import success toast */}
      {importedCount !== null && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white" style={{ background: 'hsl(var(--success, 142 71% 45%))' }}>
          ✓ Imported {importedCount} cabinet{importedCount !== 1 ? 's' : ''} from {importedSection} PDF
          {importTargetType && <span className="opacity-80 ml-1">into "{importTargetType}" units</span>}
        </div>
      )}

      {project.units.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Add units first, then add cabinets.
        </div>
      ) : (
        <Tabs value={activeSection} onValueChange={(v) => { setActiveSection(v as SectionKey); setShowForm(false); }}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="elevation">1) Elevation</TabsTrigger>
            <TabsTrigger value="enlarge">2) Enlarge &amp; Elev.</TabsTrigger>
          </TabsList>

          <TabsContent value="elevation" className="space-y-3">
            <p className="text-xs text-muted-foreground">Upload cabinet elevation PDFs to extract cabinets by type.</p>
            <SectionControls
              sectionLabel=""
              unitTypes={unitTypes}
              importTargetType={importTargetType}
              setImportTargetType={setImportTargetType}
              onImportPDF={() => setShowPDFImport(true)}
              onAddCabinet={() => setShowForm(!showForm)}
              showForm={showForm}
              setShowForm={setShowForm}
              selectedUnit={selectedUnit}
              projectHasUnits={project.units.length > 0}
            />
            {addForm}
          </TabsContent>

          <TabsContent value="enlarge" className="space-y-3">
            <p className="text-xs text-muted-foreground">Upload enlarged unit type plans &amp; cabinet elevation PDFs to extract cabinets by type.</p>
            <SectionControls
              sectionLabel=""
              unitTypes={unitTypes}
              importTargetType={importTargetType}
              setImportTargetType={setImportTargetType}
              onImportPDF={() => setShowPDFImport(true)}
              onAddCabinet={() => setShowForm(!showForm)}
              showForm={showForm}
              setShowForm={setShowForm}
              selectedUnit={selectedUnit}
              projectHasUnits={project.units.length > 0}
            />
            {addForm}
          </TabsContent>
        </Tabs>
      )}

      {/* Cabinet Summary by Unit Type */}
      {Object.keys(unitTypeGroups).length > 0 && (() => {
        const types = Object.keys(unitTypeGroups);
        const allSkus = Array.from(new Set(project.units.flatMap(u => u.cabinets.map(c => c.sku)))).sort();
        const skuTypeQty: Record<string, Record<string, number>> = {};
        project.units.forEach(u => {
          u.cabinets.forEach(c => {
            if (!skuTypeQty[c.sku]) skuTypeQty[c.sku] = {};
            skuTypeQty[c.sku][u.type] = (skuTypeQty[c.sku][u.type] || 0) + c.quantity;
          });
        });
        return (
          <div className="est-card overflow-hidden">
            <div className="est-section-header">Cabinet Summary by Unit Type</div>
            <div className="overflow-x-auto">
              <table className="est-table" style={{ whiteSpace: 'nowrap' }}>
                <thead>
                  <tr style={{ height: '120px', verticalAlign: 'bottom' }}>
                    <th className="text-left" style={{ verticalAlign: 'bottom' }}>SKU List</th>
                    {types.map(type => (
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
                      {types.map(type => (
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
        );
      })()}
    </div>
  );
}
