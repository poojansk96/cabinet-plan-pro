import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Building2, ArrowLeft, Settings2 } from 'lucide-react';
import { useProjectStore } from '@/hooks/useProjectStore';
import type { ProjectType } from '@/types/project';

const HINGE_OPTIONS = ['Standard soft close 6 way adjustable hinges', 'Other'];
const DRAWER_BOX_OPTIONS = ['Dovetail Wood', 'Melamine', 'Particleboard', 'Metal (Tandem)', 'Other'];
const DRAWER_GUIDE_OPTIONS = ['Standard NRG guides', 'Upgraded SCG guides', 'Other'];
const COUNTERTOP_OPTIONS = ['Quartz', 'Granite', 'Laminate', 'Solid Surface- Corian', 'Other'];
const VANITY_COUNTERTOP_OPTIONS = ['Quartz', 'Granite', 'Laminate', 'Solid Surface- Corian', 'Cultured Marble', 'Swanstone', 'Other'];

const COUNTERTOP_MANUFACTURERS: Record<string, string[]> = {
  Quartz:          ['Overseas', 'Local MSI', 'KOL Marble', 'Other'],
  Granite:         ['Overseas', 'Local MSI', 'KOL Marble', 'Other'],
  Laminate:        ['Hartson-Kennedy', 'Other'],
  'Solid Surface- Corian': ['Parksite Material+ Sterling surface Install', 'Other'],
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
    doorStyleCustom: '',
    doorStyleStyle: '',
    doorStyleStyleCustom: '',
    doorStyleConstruction: '',
    doorStyleSeries: '',
    doorStyleFraming: '',
    doorStyleName: '',
    doorStyleNameCustom: '',
    hinges: '',
    hingesCustom: '',
    drawerGuidesCustom: '',
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
    vanityCountertops: '',
    vanityManufacturer: '',
    vanityManufacturerCustom: '',
    vanityColor: '',
    vanityColorCustom: '',
    vanityLaminateSubstrate: '',
    vanityLaminateSubstrateCustom: '',
    vanityLaminateColor: '',
    vanityLaminateColorCustom: '',
    vanityBowlStyle: '',
    vanityBowlStyleCustom: '',
    vanityCMColor: '',
    vanityCMColorCustom: '',
    vanitySameAsKitchen: false,
    additionalTopsEnabled: false,
    additionalTopsLabel: '',
    additionalTops: '',
    additionalTopsManufacturer: '',
    additionalTopsManufacturerCustom: '',
    additionalTopsColor: '',
    additionalTopsColorCustom: '',
    additionalTopsLaminateSubstrate: '',
    additionalTopsLaminateSubstrateCustom: '',
    additionalTopsLaminateColor: '',
    additionalTopsLaminateColorCustom: '',
    handlesCustom: '',
    handlesAndHardware: '',
    tax: '',
    taxCustom: '',
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
        value={specs[key] as string}
        onChange={e => setSpecs(s => ({ ...s, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
      />
    </div>
  );

  const specSelectField = (label: string, key: keyof typeof specs, options: string[], placeholder = 'Select…') => {
    const val = specs[key];
    if (typeof val === 'boolean') return null;
    return (
    <div>
      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </label>
      <select
        value={val}
        onChange={e => {
          const v = e.target.value;
          if (key === 'countertops') {
            setSpecs(s => ({ ...s, countertops: v, countertopManufacturer: '', countertopManufacturerCustom: '', countertopColor: '', countertopColorCustom: '', laminateSubstrate: '', laminateSubstrateCustom: '', laminateColor: '', laminateColorCustom: '' }));
          } else if (key === 'vanityCountertops') {
            setSpecs(s => ({ ...s, vanityCountertops: v, vanityManufacturer: '', vanityManufacturerCustom: '', vanityColor: '', vanityColorCustom: '', vanityLaminateSubstrate: '', vanityLaminateSubstrateCustom: '', vanityLaminateColor: '', vanityLaminateColorCustom: '', vanityBowlStyle: '', vanityBowlStyleCustom: '', vanityCMColor: '', vanityCMColorCustom: '' }));
          } else if (key === 'additionalTops') {
            setSpecs(s => ({ ...s, additionalTops: v, additionalTopsManufacturer: '', additionalTopsManufacturerCustom: '', additionalTopsColor: '', additionalTopsColorCustom: '', additionalTopsLaminateSubstrate: '', additionalTopsLaminateSubstrateCustom: '', additionalTopsLaminateColor: '', additionalTopsLaminateColorCustom: '' }));
          } else {
            setSpecs(s => ({ ...s, [key]: v }));
          }
        }}
        className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
    );
  };

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

              {/* Door Style */}
              <div className="space-y-2">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Door Style
                  </label>
                  <select
                    value={specs.doorStyle}
                    onChange={e => setSpecs(s => ({ ...s, doorStyle: e.target.value, doorStyleCustom: '', doorStyleStyle: '', doorStyleStyleCustom: '', doorStyleConstruction: '', doorStyleFraming: '', doorStyleSeries: '', doorStyleName: '', doorStyleNameCustom: '' }))}
                    className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                  >
                    <option value="">Select manufacturer…</option>
                    <option value="Overseas">Overseas</option>
                    <option value="India">India</option>
                    <option value="Legacy">Legacy</option>
                    <option value="Bristol">Bristol</option>
                    <option value="India box+ Bristol door">India box+ Bristol door</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                {specs.doorStyle === 'Other' && (
                  <input
                    type="text"
                    value={specs.doorStyleCustom}
                    onChange={e => setSpecs(s => ({ ...s, doorStyleCustom: e.target.value }))}
                    placeholder="Describe door style / manufacturer…"
                    className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                    autoFocus
                  />
                )}
                {specs.doorStyle && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Style</label>
                        <select
                          value={specs.doorStyleStyle}
                          onChange={e => setSpecs(s => ({ ...s, doorStyleStyle: e.target.value, doorStyleStyleCustom: '' }))}
                          className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                        >
                          <option value="">Select style…</option>
                          {specs.doorStyle !== 'India' && <option value="Full overlay shaker">Full overlay shaker</option>}
                          <option value="Full overlay slab">Full overlay slab</option>
                          {specs.doorStyle !== 'India' && <option value="Other">Other</option>}
                        </select>
                      </div>
                      {specs.doorStyleStyle === 'Other' && (
                        <input type="text" value={specs.doorStyleStyleCustom}
                          onChange={e => setSpecs(s => ({ ...s, doorStyleStyleCustom: e.target.value }))}
                          placeholder="Describe style…"
                          className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                        />
                      )}
                      {specs.doorStyle === 'Legacy' && (
                        <div>
                          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Series</label>
                          <select value={specs.doorStyleSeries}
                            onChange={e => setSpecs(s => ({ ...s, doorStyleSeries: e.target.value, doorStyleConstruction: '' }))}
                            className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                          >
                            <option value="">Select series…</option>
                            <option value="Advantage">Advantage</option>
                            <option value="Debut">Debut</option>
                            <option value="Presidential">Presidential</option>
                          </select>
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Construction</label>
                        <select value={specs.doorStyleConstruction}
                          onChange={e => setSpecs(s => ({ ...s, doorStyleConstruction: e.target.value }))}
                          className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                        >
                          <option value="">Select construction…</option>
                          {specs.doorStyle === 'Legacy' && specs.doorStyleSeries === 'Advantage' ? (
                            <>
                              <option value="Standard">Standard</option>
                              <option value="Verde">Verde</option>
                              <option value="Intence">Intence</option>
                            </>
                          ) : specs.doorStyle === 'Legacy' && specs.doorStyleSeries === 'Debut' ? (
                            <>
                              <option value="Standard">Standard</option>
                              <option value="Plywood">Plywood</option>
                              <option value="Extreme">Extreme</option>
                            </>
                          ) : (
                            <>
                              <option value="Particleboard">Particleboard</option>
                              <option value="Plywood">Plywood</option>
                            </>
                          )}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Framing</label>
                        <select value={specs.doorStyleFraming}
                          onChange={e => setSpecs(s => ({ ...s, doorStyleFraming: e.target.value }))}
                          className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                        >
                          <option value="">Select framing…</option>
                          {specs.doorStyle !== 'India' && <option value="Framed">Framed</option>}
                          <option value="Frameless">Frameless</option>
                        </select>
                      </div>
                      {(() => {
                        const nameOptions: Record<string, string[]> = {
                          Overseas: ['Avon Group 9', 'Avon Group 10- PTK', 'Kerala Slab', 'Other'],
                          India:    ['Madison', 'Eden', 'Other'],
                          Legacy:   ['Sagamore Shaker Maple', 'Venetian MDF Painted', 'Other'],
                        };
                        const opts = nameOptions[specs.doorStyle];
                        if (!opts) return null;
                        return (
                          <div className="space-y-2">
                            <div>
                              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Door Style Name</label>
                              <select value={specs.doorStyleName}
                                onChange={e => setSpecs(s => ({ ...s, doorStyleName: e.target.value, doorStyleNameCustom: '' }))}
                                className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                              >
                                <option value="">Select door style name…</option>
                                {opts.map(o => <option key={o} value={o}>{o}</option>)}
                              </select>
                            </div>
                            {specs.doorStyleName === 'Other' && (
                              <input type="text" value={specs.doorStyleNameCustom}
                                onChange={e => setSpecs(s => ({ ...s, doorStyleNameCustom: e.target.value }))}
                                placeholder="Enter door style name…"
                                className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                              />
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
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
                <div className="space-y-2">
                  {specSelectField('Drawer Guides', 'drawerGuides', DRAWER_GUIDE_OPTIONS)}
                  {specs.drawerGuides === 'Other' && (
                    <input
                      type="text"
                      value={specs.drawerGuidesCustom}
                      onChange={e => setSpecs(s => ({ ...s, drawerGuidesCustom: e.target.value }))}
                      placeholder="Describe drawer guide type…"
                      className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                      autoFocus
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                      Handles
                    </label>
                    <select
                      value={specs.handlesAndHardware}
                      onChange={e => setSpecs(s => ({ ...s, handlesAndHardware: e.target.value, handlesCustom: '' }))}
                      className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                    >
                      <option value="">Select handles…</option>
                      <option value="Standard knob, 4&quot; wire pulls or 96mm barpulls in Brushed nickel finish">
                        Standard knob, 4" wire pulls or 96mm barpulls in Brushed nickel finish
                      </option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  {specs.handlesAndHardware === 'Other' && (
                    <input
                      type="text"
                      value={specs.handlesCustom}
                      onChange={e => setSpecs(s => ({ ...s, handlesCustom: e.target.value }))}
                      placeholder="Describe handle style…"
                      className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                      autoFocus
                    />
                  )}
                </div>
              </div>

              {/* Kitchen Tops & Vanity Tops — side by side */}
              <div className="grid grid-cols-2 gap-4">
                {/* Kitchen Tops */}
                <div className="space-y-2">
                  <div className="text-xs font-bold text-foreground uppercase tracking-wider border-b border-border pb-1 mb-1">🍳 Kitchen Tops</div>
                  {specSelectField('Material', 'countertops', COUNTERTOP_OPTIONS)}
                  {specs.countertops && COUNTERTOP_MANUFACTURERS[specs.countertops] && (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Vendor</label>
                        <select value={specs.countertopManufacturer}
                          onChange={e => setSpecs(s => ({ ...s, countertopManufacturer: e.target.value, countertopManufacturerCustom: '' }))}
                          className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                        >
                          <option value="">Select vendor…</option>
                          {COUNTERTOP_MANUFACTURERS[specs.countertops].map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      {specs.countertopManufacturer === 'Other' && (
                        <input type="text" value={specs.countertopManufacturerCustom}
                          onChange={e => setSpecs(s => ({ ...s, countertopManufacturerCustom: e.target.value }))}
                          placeholder="Enter manufacturer name…"
                          className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                        />
                      )}
                      {(specs.countertops === 'Quartz' || specs.countertops === 'Granite') && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Color</label>
                            <select value={specs.countertopColor}
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
                            <input type="text" value={specs.countertopColorCustom}
                              onChange={e => setSpecs(s => ({ ...s, countertopColorCustom: e.target.value }))}
                              placeholder="Enter specific color…"
                              className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                            />
                          )}
                        </div>
                      )}
                      {specs.countertops === 'Laminate' && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Substrate</label>
                            <select value={specs.laminateSubstrate}
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
                            <input type="text" value={specs.laminateSubstrateCustom}
                              onChange={e => setSpecs(s => ({ ...s, laminateSubstrateCustom: e.target.value }))}
                              placeholder="Enter substrate type…"
                              className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                            />
                          )}
                          <div>
                            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Color</label>
                            <select value={specs.laminateColor}
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
                            <input type="text" value={specs.laminateColorCustom}
                              onChange={e => setSpecs(s => ({ ...s, laminateColorCustom: e.target.value }))}
                              placeholder="Enter specific color…"
                              className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Vanity Tops */}
                <div className="space-y-2">
                  <div className="text-xs font-bold text-foreground uppercase tracking-wider border-b border-border pb-1 mb-1">🚿 Vanity Tops</div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={specs.vanitySameAsKitchen as boolean}
                      onChange={e => {
                        const checked = e.target.checked;
                        if (checked) {
                          setSpecs(s => ({ ...s, vanitySameAsKitchen: true, vanityCountertops: s.countertops, vanityManufacturer: s.countertopManufacturer, vanityManufacturerCustom: s.countertopManufacturerCustom, vanityColor: s.countertopColor, vanityColorCustom: s.countertopColorCustom, vanityLaminateSubstrate: s.laminateSubstrate, vanityLaminateSubstrateCustom: s.laminateSubstrateCustom, vanityLaminateColor: s.laminateColor, vanityLaminateColorCustom: s.laminateColorCustom, vanityBowlStyle: '', vanityBowlStyleCustom: '', vanityCMColor: '', vanityCMColorCustom: '' }));
                        } else {
                          setSpecs(s => ({ ...s, vanitySameAsKitchen: false }));
                        }
                      }}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <span className="text-xs font-medium text-muted-foreground">Same as Kitchen Tops</span>
                  </label>
                  {!specs.vanitySameAsKitchen && (
                    <>
                  {specSelectField('Material', 'vanityCountertops', VANITY_COUNTERTOP_OPTIONS)}
                  {specs.vanityCountertops && COUNTERTOP_MANUFACTURERS[specs.vanityCountertops] && (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Vendor</label>
                        <select value={specs.vanityManufacturer}
                          onChange={e => setSpecs(s => ({ ...s, vanityManufacturer: e.target.value, vanityManufacturerCustom: '' }))}
                          className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                        >
                          <option value="">Select vendor…</option>
                          {COUNTERTOP_MANUFACTURERS[specs.vanityCountertops].map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      {specs.vanityManufacturer === 'Other' && (
                        <input type="text" value={specs.vanityManufacturerCustom}
                          onChange={e => setSpecs(s => ({ ...s, vanityManufacturerCustom: e.target.value }))}
                          placeholder="Enter manufacturer name…"
                          className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                        />
                      )}
                      {(specs.vanityCountertops === 'Quartz' || specs.vanityCountertops === 'Granite') && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Color</label>
                            <select value={specs.vanityColor}
                              onChange={e => setSpecs(s => ({ ...s, vanityColor: e.target.value, vanityColorCustom: '' }))}
                              className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                            >
                              <option value="">Select color group…</option>
                              <option value="Group 1 Color">Group 1 Color</option>
                              <option value="Group 2 Color">Group 2 Color</option>
                              <option value="Group 3 Color">Group 3 Color</option>
                              <option value="Custom/Specific Color">Custom / Specific Color</option>
                            </select>
                          </div>
                          {specs.vanityColor === 'Custom/Specific Color' && (
                            <input type="text" value={specs.vanityColorCustom}
                              onChange={e => setSpecs(s => ({ ...s, vanityColorCustom: e.target.value }))}
                              placeholder="Enter specific color…"
                              className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                            />
                          )}
                        </div>
                      )}
                      {specs.vanityCountertops === 'Laminate' && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Substrate</label>
                            <select value={specs.vanityLaminateSubstrate}
                              onChange={e => setSpecs(s => ({ ...s, vanityLaminateSubstrate: e.target.value, vanityLaminateSubstrateCustom: '' }))}
                              className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                            >
                              <option value="">Select substrate…</option>
                              <option value="Particleboard">Particleboard</option>
                              <option value="Plywood">Plywood</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                          {specs.vanityLaminateSubstrate === 'Other' && (
                            <input type="text" value={specs.vanityLaminateSubstrateCustom}
                              onChange={e => setSpecs(s => ({ ...s, vanityLaminateSubstrateCustom: e.target.value }))}
                              placeholder="Enter substrate type…"
                              className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                            />
                          )}
                          <div>
                            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Color</label>
                            <select value={specs.vanityLaminateColor}
                              onChange={e => setSpecs(s => ({ ...s, vanityLaminateColor: e.target.value, vanityLaminateColorCustom: '' }))}
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
                          {specs.vanityLaminateColor === 'Custom/Specific Color' && (
                            <input type="text" value={specs.vanityLaminateColorCustom}
                              onChange={e => setSpecs(s => ({ ...s, vanityLaminateColorCustom: e.target.value }))}
                              placeholder="Enter specific color…"
                              className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {/* Cultured Marble */}
                  {specs.vanityCountertops === 'Cultured Marble' && (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Bowl Style</label>
                        <select value={specs.vanityBowlStyle}
                          onChange={e => setSpecs(s => ({ ...s, vanityBowlStyle: e.target.value, vanityBowlStyleCustom: '' }))}
                          className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                        >
                          <option value="">Select bowl style…</option>
                          <option value="Oval">Oval</option>
                          <option value="Recessed Oval">Recessed Oval</option>
                          <option value="Rectangular - Custom">Rectangular - Custom</option>
                          <option value="Wave - Custom">Wave - Custom</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Color</label>
                        <select value={specs.vanityCMColor}
                          onChange={e => setSpecs(s => ({ ...s, vanityCMColor: e.target.value, vanityCMColorCustom: '' }))}
                          className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                        >
                          <option value="">Select color…</option>
                          <option value="Solid White">Solid White</option>
                          <option value="Solid Biscuit">Solid Biscuit</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      {specs.vanityCMColor === 'Other' && (
                        <input type="text" value={specs.vanityCMColorCustom}
                          onChange={e => setSpecs(s => ({ ...s, vanityCMColorCustom: e.target.value }))}
                          placeholder="Enter color…"
                          className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                        />
                      )}
                    </div>
                  )}
                  {/* Swanstone */}
                  {specs.vanityCountertops === 'Swanstone' && (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Bowl Style</label>
                        <select value={specs.vanityBowlStyle}
                          onChange={e => setSpecs(s => ({ ...s, vanityBowlStyle: e.target.value, vanityBowlStyleCustom: '' }))}
                          className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                        >
                          <option value="">Select bowl style…</option>
                          <option value="Contour Style Vanity Tops">Contour Style Vanity Tops</option>
                          <option value="Custom Vanity Tops">Custom Vanity Tops</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Color</label>
                        <select value={specs.vanityCMColor}
                          onChange={e => setSpecs(s => ({ ...s, vanityCMColor: e.target.value, vanityCMColorCustom: '' }))}
                          className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                        >
                          <option value="">Select color…</option>
                          <option value="Solid White">Solid White</option>
                          <option value="Solid Bisque">Solid Bisque</option>
                          <option value="Solid Bone">Solid Bone</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      {specs.vanityCMColor === 'Other' && (
                        <input type="text" value={specs.vanityCMColorCustom}
                          onChange={e => setSpecs(s => ({ ...s, vanityCMColorCustom: e.target.value }))}
                          placeholder="Enter color…"
                          className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                        />
                      )}
                    </div>
                  )}
                    </>
                  )}
                  {specs.vanitySameAsKitchen && specs.countertops && (
                    <p className="text-xs text-muted-foreground italic">Using Kitchen Tops selection: {specs.countertops}</p>
                  )}
                </div>
              </div>

              {/* Additional Tops */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={specs.additionalTopsEnabled as boolean}
                    onChange={e => {
                      const checked = e.target.checked;
                      setSpecs(s => ({ ...s, additionalTopsEnabled: checked, ...(!checked ? { additionalTopsLabel: '', additionalTops: '', additionalTopsManufacturer: '', additionalTopsManufacturerCustom: '', additionalTopsColor: '', additionalTopsColorCustom: '', additionalTopsLaminateSubstrate: '', additionalTopsLaminateSubstrateCustom: '', additionalTopsLaminateColor: '', additionalTopsLaminateColorCustom: '' } : {}) }));
                    }}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-xs font-bold text-foreground uppercase tracking-wider">➕ Additional Tops</span>
                </label>
                {specs.additionalTopsEnabled && (
                  <div className="space-y-2 pl-1 border-l-2 border-primary/20 ml-2">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Description / Area</label>
                      <input type="text" value={specs.additionalTopsLabel}
                        onChange={e => setSpecs(s => ({ ...s, additionalTopsLabel: e.target.value }))}
                        placeholder="e.g. Common area tops, Clubhouse tops…"
                        className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                      />
                    </div>
                    {specSelectField('Material', 'additionalTops', COUNTERTOP_OPTIONS)}
                    {specs.additionalTops && COUNTERTOP_MANUFACTURERS[specs.additionalTops] && (
                      <div className="space-y-2">
                        <div>
                          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Vendor</label>
                          <select value={specs.additionalTopsManufacturer}
                            onChange={e => setSpecs(s => ({ ...s, additionalTopsManufacturer: e.target.value, additionalTopsManufacturerCustom: '' }))}
                            className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                          >
                            <option value="">Select vendor…</option>
                            {COUNTERTOP_MANUFACTURERS[specs.additionalTops].map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        {specs.additionalTopsManufacturer === 'Other' && (
                          <input type="text" value={specs.additionalTopsManufacturerCustom}
                            onChange={e => setSpecs(s => ({ ...s, additionalTopsManufacturerCustom: e.target.value }))}
                            placeholder="Enter manufacturer name…"
                            className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                          />
                        )}
                        {(specs.additionalTops === 'Quartz' || specs.additionalTops === 'Granite') && (
                          <div className="space-y-2">
                            <div>
                              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Color</label>
                              <select value={specs.additionalTopsColor}
                                onChange={e => setSpecs(s => ({ ...s, additionalTopsColor: e.target.value, additionalTopsColorCustom: '' }))}
                                className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                              >
                                <option value="">Select color group…</option>
                                <option value="Group 1 Color">Group 1 Color</option>
                                <option value="Group 2 Color">Group 2 Color</option>
                                <option value="Group 3 Color">Group 3 Color</option>
                                <option value="Custom/Specific Color">Custom / Specific Color</option>
                              </select>
                            </div>
                            {specs.additionalTopsColor === 'Custom/Specific Color' && (
                              <input type="text" value={specs.additionalTopsColorCustom}
                                onChange={e => setSpecs(s => ({ ...s, additionalTopsColorCustom: e.target.value }))}
                                placeholder="Enter specific color…"
                                className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                              />
                            )}
                          </div>
                        )}
                        {specs.additionalTops === 'Laminate' && (
                          <div className="space-y-2">
                            <div>
                              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Substrate</label>
                              <select value={specs.additionalTopsLaminateSubstrate}
                                onChange={e => setSpecs(s => ({ ...s, additionalTopsLaminateSubstrate: e.target.value, additionalTopsLaminateSubstrateCustom: '' }))}
                                className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                              >
                                <option value="">Select substrate…</option>
                                <option value="Particleboard">Particleboard</option>
                                <option value="Plywood">Plywood</option>
                                <option value="Other">Other</option>
                              </select>
                            </div>
                            {specs.additionalTopsLaminateSubstrate === 'Other' && (
                              <input type="text" value={specs.additionalTopsLaminateSubstrateCustom}
                                onChange={e => setSpecs(s => ({ ...s, additionalTopsLaminateSubstrateCustom: e.target.value }))}
                                placeholder="Enter substrate type…"
                                className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                              />
                            )}
                            <div>
                              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Color</label>
                              <select value={specs.additionalTopsLaminateColor}
                                onChange={e => setSpecs(s => ({ ...s, additionalTopsLaminateColor: e.target.value, additionalTopsLaminateColorCustom: '' }))}
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
                            {specs.additionalTopsLaminateColor === 'Custom/Specific Color' && (
                              <input type="text" value={specs.additionalTopsLaminateColorCustom}
                                onChange={e => setSpecs(s => ({ ...s, additionalTopsLaminateColorCustom: e.target.value }))}
                                placeholder="Enter specific color…"
                                className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                              />
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                      Sales Tax on Materials
                    </label>
                    <select
                      value={specs.tax}
                      onChange={e => setSpecs(s => ({ ...s, tax: e.target.value, taxCustom: '' }))}
                      className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                    >
                      <option value="">Select tax rate…</option>
                      <option value="CT-6.35%">CT — 6.35%</option>
                      <option value="MA-6.25%">MA — 6.25%</option>
                      <option value="Tax Exempt">Tax Exempt</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  {specs.tax === 'Other' && (
                    <input
                      type="text"
                      value={specs.taxCustom}
                      onChange={e => setSpecs(s => ({ ...s, taxCustom: e.target.value }))}
                      placeholder="Enter tax rate (e.g. 8.25%)"
                      className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                      autoFocus
                    />
                  )}
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
