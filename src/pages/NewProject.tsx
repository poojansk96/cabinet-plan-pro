import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Building2, ArrowLeft, Settings2 } from 'lucide-react';
import { useProjectStore } from '@/hooks/useProjectStore';
import type { ProjectType } from '@/types/project';

const HINGE_OPTIONS = ['Standard soft close 6 way adjustable hinges', 'Other'];
const DRAWER_BOX_OPTIONS = ['Dovetail Wood', 'Melamine', 'Metal (Legrabox)', 'Metal (Tandem)', 'Other'];
const DRAWER_GUIDE_OPTIONS = ['Blum Tandem', 'Blum Legrabox', 'Grass Dynapro', 'King Slide', 'Other'];
const COUNTERTOP_OPTIONS = ['Quartz', 'Granite', 'Laminate', 'Solid Surface', 'Porcelain', 'Marble', 'Other'];

const COUNTERTOP_MANUFACTURERS: Record<string, string[]> = {
  Quartz:          ['Overseas', 'Local MSI', 'KOL Marble', 'Other'],
  Granite:         ['Overseas', 'Local MSI', 'KOL Marble', 'Other'],
  Laminate:        ['Hartson-Kennedy', 'Other'],
  'Solid Surface': ['Corian (DuPont)', 'Avonite', 'Wilsonart SS', 'Staron (Samsung)', 'Other'],
  Porcelain:       ['Porcelanosa', 'Atlas Plan', 'Dekton (Cosentino)', 'Neolith', 'Other'],
  Marble:          ['Carrara', 'Calacatta', 'Statuario', 'Thassos', 'Other'],
  Other:           ['Other'],
};

export default function NewProject() {
  const navigate = useNavigate();
  const { createProject } = useProjectStore();

  const [form, setForm] = useState({
    name: '',
    address: '',
    type: 'Residential' as ProjectType,
    notes: '',
  });

  const [specs, setSpecs] = useState({
    projectSuper: '',
    customer: '',
    doorStyle: '',
    hinges: '',
    hingesCustom: '',
    drawerBox: '',
    drawerGuides: '',
    countertops: '',
    countertopManufacturer: '',
    countertopManufacturerCustom: '',
    countertopColor: '',
    countertopColorCustom: '',
    laminateSubstrate: '',
    laminateSubstrateCustom: '',
    laminateColor: '',
    laminateColorCustom: '',
    handlesAndHardware: '',
    tax: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Project name is required';
    return e;
  };

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    const project = createProject({ ...form, specs });
    navigate(`/project/${project.id}`);
  };

  const textField = (label: string, key: keyof typeof form, placeholder = '') => (
    <div>
      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </label>
      <input
        type="text"
        value={form[key] as string}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        className={`w-full h-9 px-3 text-sm border rounded-md focus:outline-none focus:ring-2 ${
          errors[key] ? 'border-destructive' : 'border-border focus:ring-primary/30 focus:border-primary'
        } bg-card`}
      />
      {errors[key] && <p className="text-xs text-destructive mt-0.5">{errors[key]}</p>}
    </div>
  );

  const specTextField = (label: string, key: keyof typeof specs, placeholder = '') => (
    <div>
      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </label>
      <input
        type="text"
        value={specs[key]}
        onChange={e => setSpecs(s => ({ ...s, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
      />
    </div>
  );

  const specSelectField = (label: string, key: keyof typeof specs, options: string[], placeholder = 'Select…') => (
    <div>
      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </label>
      <select
        value={specs[key]}
        onChange={e => {
          const val = e.target.value;
          // Reset manufacturer when countertop type changes
          if (key === 'countertops') {
            setSpecs(s => ({ ...s, countertops: val, countertopManufacturer: '', countertopManufacturerCustom: '', countertopColor: '', countertopColorCustom: '', laminateSubstrate: '', laminateSubstrateCustom: '', laminateColor: '', laminateColorCustom: '' }));
          } else {
            setSpecs(s => ({ ...s, [key]: val }));
          }
        }}
        className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'hsl(var(--primary))' }}>
            <Building2 size={18} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-base leading-none">CabinetTakeoff Pro</h1>
            <p className="text-xs text-muted-foreground">Kitchen & Countertop Estimating</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft size={14} />
          Back to Dashboard
        </Link>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* ── Basic Info ── */}
          <div className="est-card">
            <div className="est-section-header">
              <Building2 size={15} />
              New Project Setup
            </div>
            <div className="p-6 space-y-4">
              {textField('Project Name *', 'name', 'e.g. Maple Grove Apartments – Phase 1')}
              {textField('Project Address', 'address', 'e.g. 1234 Oak St, Austin, TX 78701')}

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Project Type
                </label>
                <div className="flex gap-3">
                  {(['Residential', 'Commercial'] as ProjectType[]).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, type: t }))}
                      className={`flex-1 py-2 rounded-md text-sm font-medium border transition-colors ${
                        form.type === t
                          ? 'border-primary text-white'
                          : 'border-border text-muted-foreground hover:border-primary'
                      }`}
                      style={form.type === t ? { background: 'hsl(var(--primary))' } : {}}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Notes
                </label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  placeholder="Project notes, special requirements..."
                  className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary border-border bg-card resize-none"
                />
              </div>
            </div>
          </div>

          {/* ── Project Specifications ── */}
          <div className="est-card">
            <div className="est-section-header">
              <Settings2 size={15} />
              Project Specifications
            </div>
            <div className="p-6 space-y-4">

              {/* Row 1: Project Super + Customer */}
              <div className="grid grid-cols-2 gap-4">
                {specTextField('Project Super', 'projectSuper', 'Supervisor name')}
                {specTextField('Customer', 'customer', 'Customer / client name')}
              </div>

              {/* Row 2: Door Style + Countertops */}
              <div className="grid grid-cols-2 gap-4">
                {specTextField('Door Style', 'doorStyle', 'e.g. Shaker, Slab, Raised Panel…')}
                <div className="space-y-2">
                  {specSelectField('Countertops', 'countertops', COUNTERTOP_OPTIONS)}
                  {specs.countertops && COUNTERTOP_MANUFACTURERS[specs.countertops] && (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                          Manufacturer
                        </label>
                        <select
                          value={specs.countertopManufacturer}
                          onChange={e => setSpecs(s => ({ ...s, countertopManufacturer: e.target.value, countertopManufacturerCustom: '' }))}
                          className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                        >
                          <option value="">Select manufacturer…</option>
                          {COUNTERTOP_MANUFACTURERS[specs.countertops].map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                      {specs.countertopManufacturer === 'Other' && (
                        <input
                          type="text"
                          value={specs.countertopManufacturerCustom}
                          onChange={e => setSpecs(s => ({ ...s, countertopManufacturerCustom: e.target.value }))}
                          placeholder="Enter manufacturer name…"
                          className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                          autoFocus
                        />
                      )}
                      {/* Color selection — only for Quartz & Granite */}
                      {(specs.countertops === 'Quartz' || specs.countertops === 'Granite') && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                              Color
                            </label>
                            <select
                              value={specs.countertopColor}
                              onChange={e => setSpecs(s => ({ ...s, countertopColor: e.target.value, countertopColorCustom: '' }))}
                              className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                            >
                              <option value="">Select color group…</option>
                              <option value="Group 1 Color">Group 1 Color</option>
                              <option value="Group 2 Color">Group 2 Color</option>
                              <option value="Group 3 Color">Group 3 Color</option>
                              <option value="Custom/Specific Color">Custom / Specific Color</option>
                            </select>
                          </div>
                          {specs.countertopColor === 'Custom/Specific Color' && (
                            <input
                              type="text"
                              value={specs.countertopColorCustom}
                              onChange={e => setSpecs(s => ({ ...s, countertopColorCustom: e.target.value }))}
                              placeholder="Enter specific color name or code…"
                              className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                              autoFocus
                            />
                          )}
                        </div>
                      )}
                      {/* Substrate selection — only for Laminate */}
                      {specs.countertops === 'Laminate' && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                              Substrate
                            </label>
                            <select
                              value={specs.laminateSubstrate}
                              onChange={e => setSpecs(s => ({ ...s, laminateSubstrate: e.target.value, laminateSubstrateCustom: '' }))}
                              className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                            >
                              <option value="">Select substrate…</option>
                              <option value="Particleboard">Particleboard</option>
                              <option value="Plywood">Plywood</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                          {specs.laminateSubstrate === 'Other' && (
                            <input
                              type="text"
                              value={specs.laminateSubstrateCustom}
                              onChange={e => setSpecs(s => ({ ...s, laminateSubstrateCustom: e.target.value }))}
                              placeholder="Enter substrate type…"
                              className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                              autoFocus
                            />
                          )}
                          {/* Color selection for Laminate */}
                          <div>
                            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                              Color
                            </label>
                            <select
                              value={specs.laminateColor}
                              onChange={e => setSpecs(s => ({ ...s, laminateColor: e.target.value, laminateColorCustom: '' }))}
                              className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                            >
                              <option value="">Select color group…</option>
                              <option value="Group 1 Color">Group 1 Color</option>
                              <option value="Group 2 Color">Group 2 Color</option>
                              <option value="Group 3 Color">Group 3 Color</option>
                              <option value="Group 5 Color">Group 5 Color</option>
                              <option value="Custom/Specific Color">Custom / Specific Color</option>
                            </select>
                          </div>
                          {specs.laminateColor === 'Custom/Specific Color' && (
                            <input
                              type="text"
                              value={specs.laminateColorCustom}
                              onChange={e => setSpecs(s => ({ ...s, laminateColorCustom: e.target.value }))}
                              placeholder="Enter specific color name or code…"
                              className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                              autoFocus
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Row 3: Hinges + Drawer Box */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  {specSelectField('Hinges', 'hinges', HINGE_OPTIONS)}
                  {specs.hinges === 'Other' && (
                    <input
                      type="text"
                      value={specs.hingesCustom}
                      onChange={e => setSpecs(s => ({ ...s, hingesCustom: e.target.value }))}
                      placeholder="Describe hinge type…"
                      className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                      autoFocus
                    />
                  )}
                </div>
                {specSelectField('Drawer Box', 'drawerBox', DRAWER_BOX_OPTIONS)}
              </div>

              {/* Row 4: Drawer Guides + Handles & Hardware */}
              <div className="grid grid-cols-2 gap-4">
                {specSelectField('Drawer Guides', 'drawerGuides', DRAWER_GUIDE_OPTIONS)}
                {specTextField('Handles & Hardware', 'handlesAndHardware', 'e.g. Amerock BP55342, Brushed Nickel')}
              </div>

              {/* Row 5: Tax */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Tax (%)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      value={specs.tax}
                      onChange={e => setSpecs(s => ({ ...s, tax: e.target.value }))}
                      placeholder="e.g. 8.25"
                      className="w-full h-9 px-3 pr-8 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* ── Actions ── */}
          <div className="flex justify-end gap-3">
            <Link
              to="/"
              className="px-4 py-2 rounded-md text-sm font-medium border border-border text-muted-foreground hover:bg-secondary transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="px-5 py-2 rounded-md text-sm font-medium text-white transition-colors"
              style={{ background: 'hsl(var(--primary))' }}
            >
              Create Project →
            </button>
          </div>

        </form>
      </main>
    </div>
  );
}
