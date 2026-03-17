import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Building2, ArrowLeft, HelpCircle } from 'lucide-react';
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

const TOOLTIPS: Record<string, string> = {
  hinges: 'Choose the hinge type used by the cabinet maker — helps estimate hardware cost.',
  drawerBox: 'The drawer box material affects durability and pricing of the cabinetry.',
  drawerGuides: 'Drawer guide type determines smoothness and load capacity.',
  doorStyle: 'Select the cabinet door manufacturer — this drives style, series, and construction options.',
  countertops: 'Kitchen countertop material determines vendor and color group options.',
  vanityCountertops: 'Vanity top material — can match kitchen or be different.',
  handles: 'Handle/pull style included in the cabinet package.',
  tax: 'Sales tax rate applied to material costs in the estimate.',
};

function Tooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex ml-1">
      <HelpCircle
        size={13}
        className="text-muted-foreground/60 hover:text-primary cursor-help transition-colors"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      />
      {show && (
        <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 px-3 py-2 rounded-lg text-[11px] leading-relaxed text-foreground bg-card border border-border shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

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
    takeoffPerson: '',
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

  const handleCreate = () => {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    const project = createProject({ ...form, specs });
    navigate(`/project/${project.id}`);
  };

  const handleSkipCreate = () => {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    const project = createProject({ ...form, specs });
    navigate(`/project/${project.id}`);
  };

  const textField = (label: string, key: keyof typeof form, placeholder = '', hint = '') => (
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
      {hint && !errors[key] && <p className="text-[11px] text-muted-foreground/70 mt-0.5">{hint}</p>}
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

  const specSelectField = (label: string, key: keyof typeof specs, options: string[], placeholder = 'Select…', tooltipKey?: string) => {
    const val = specs[key];
    if (typeof val === 'boolean') return null;
    return (
    <div>
      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        {label}
        {tooltipKey && TOOLTIPS[tooltipKey] && <Tooltip text={TOOLTIPS[tooltipKey]} />}
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
      <header className="border-b bg-card shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'hsl(var(--primary))' }}>
            <Building2 size={18} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-base leading-none">cabinetcounters.com</h1>
            <p className="text-xs text-muted-foreground">Kitchen & Countertop Estimating</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft size={14} />
          Back to Dashboard
        </Link>

        <div className="est-card">
          <div className="est-section-header">
            <Building2 size={15} />
            Create New Project
          </div>

          <div className="p-6 space-y-6">
            {/* ── BASIC INFO SECTION ── */}
            <div className="space-y-4 border-b pb-6">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-4">Basic Information</h3>
              </div>
              
              {textField('Project Name *', 'name', 'e.g. Maple Grove Apt – Kitchen 1')}
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
                  Notes <span className="normal-case font-normal text-muted-foreground/60">(optional)</span>
                </label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  placeholder="Project notes, special requirements..."
                  className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary border-border bg-card resize-none"
                />
              </div>
            </div>

            {/* ── SPECIFICATIONS SECTION ── */}
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-4">Specifications <span className="text-[10px] font-normal text-muted-foreground normal-case">(All optional — you can change later)</span></h3>
              </div>

              {/* Row 1: Project Super + Customer + Takeoff Person */}
              <div className="grid grid-cols-3 gap-4">
                {specTextField('Project Super', 'projectSuper', 'Supervisor name')}
                {specTextField('Customer', 'customer', 'Customer / client name')}
                {specTextField('Takeoff Person', 'takeoffPerson', 'Your name')}
              </div>

              {/* Door Style */}
              <div className="space-y-2">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Door Style
                    <Tooltip text={TOOLTIPS.doorStyle} />
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
                          <option value="">Select…</option>
                          <option value="Solid wood">Solid wood</option>
                          <option value="Frame + panel">Frame + panel</option>
                          <option value="MDF">MDF</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Name/Series</label>
                        <select value={specs.doorStyleName}
                          onChange={e => setSpecs(s => ({ ...s, doorStyleName: e.target.value, doorStyleNameCustom: '' }))}
                          className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                        >
                          <option value="">Select…</option>
                          <option value="Shaker">Shaker</option>
                          <option value="Slab">Slab</option>
                          <option value="Raised">Raised</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      {specs.doorStyleName === 'Other' && (
                        <input type="text" value={specs.doorStyleNameCustom}
                          onChange={e => setSpecs(s => ({ ...s, doorStyleNameCustom: e.target.value }))}
                          placeholder="Describe…"
                          className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                        />
                      )}
                      {specs.doorStyle && specs.doorStyle !== 'India' && (
                        <div>
                          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Framing</label>
                          <select value={specs.doorStyleFraming}
                            onChange={e => setSpecs(s => ({ ...s, doorStyleFraming: e.target.value }))}
                            className="w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30"
                          >
                            <option value="">Select…</option>
                            <option value="Framed">Framed</option>
                            <option value="Frameless">Frameless</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Hardware: Hinges, Drawer Box, Drawer Guides */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                      Hinges
                      <Tooltip text={TOOLTIPS.hinges} />
                    </label>
                    <select
                      value={specs.hinges}
                      onChange={e => setSpecs(s => ({ ...s, hinges: e.target.value, hingesCustom: '' }))}
                      className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                    >
                      <option value="">Select…</option>
                      {HINGE_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  {specs.hinges === 'Other' && (
                    <input type="text" value={specs.hingesCustom}
                      onChange={e => setSpecs(s => ({ ...s, hingesCustom: e.target.value }))}
                      placeholder="Describe hinges…"
                      className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Drawer Box
                    <Tooltip text={TOOLTIPS.drawerBox} />
                  </label>
                  <select
                    value={specs.drawerBox}
                    onChange={e => setSpecs(s => ({ ...s, drawerBox: e.target.value }))}
                    className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                  >
                    <option value="">Select…</option>
                    {DRAWER_BOX_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>

                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                      Drawer Guides
                      <Tooltip text={TOOLTIPS.drawerGuides} />
                    </label>
                    <select
                      value={specs.drawerGuides}
                      onChange={e => setSpecs(s => ({ ...s, drawerGuides: e.target.value, drawerGuidesCustom: '' }))}
                      className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                    >
                      <option value="">Select…</option>
                      {DRAWER_GUIDE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  {specs.drawerGuides === 'Other' && (
                    <input type="text" value={specs.drawerGuidesCustom}
                      onChange={e => setSpecs(s => ({ ...s, drawerGuidesCustom: e.target.value }))}
                      placeholder="Describe…"
                      className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                    />
                  )}
                </div>
              </div>

              {/* Countertops */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Kitchen Countertops
                  <Tooltip text={TOOLTIPS.countertops} />
                </label>
                <select
                  value={specs.countertops}
                  onChange={e => setSpecs(s => ({ ...s, countertops: e.target.value, countertopManufacturer: '', countertopManufacturerCustom: '', countertopColor: '', countertopColorCustom: '', laminateSubstrate: '', laminateSubstrateCustom: '', laminateColor: '', laminateColorCustom: '' }))}
                  className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                >
                  <option value="">Select material…</option>
                  {COUNTERTOP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>

                {specs.countertops && (
                  <div className="mt-3 p-3 bg-accent/30 rounded-md space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Manufacturer</label>
                      <select
                        value={specs.countertopManufacturer}
                        onChange={e => setSpecs(s => ({ ...s, countertopManufacturer: e.target.value, countertopManufacturerCustom: '' }))}
                        className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                      >
                        <option value="">Select…</option>
                        {COUNTERTOP_MANUFACTURERS[specs.countertops]?.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    {specs.countertopManufacturer === 'Other' && (
                      <input type="text" value={specs.countertopManufacturerCustom}
                        onChange={e => setSpecs(s => ({ ...s, countertopManufacturerCustom: e.target.value }))}
                        placeholder="Describe manufacturer…"
                        className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                      />
                    )}

                    {specs.countertops === 'Laminate' && (
                      <>
                        <div>
                          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Substrate</label>
                          <select value={specs.laminateSubstrate}
                            onChange={e => setSpecs(s => ({ ...s, laminateSubstrate: e.target.value, laminateSubstrateCustom: '' }))}
                            className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                          >
                            <option value="">Select…</option>
                            <option value="Particleboard">Particleboard</option>
                            <option value="Plywood">Plywood</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        {specs.laminateSubstrate === 'Other' && (
                          <input type="text" value={specs.laminateSubstrateCustom}
                            onChange={e => setSpecs(s => ({ ...s, laminateSubstrateCustom: e.target.value }))}
                            placeholder="Describe substrate…"
                            className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                          />
                        )}
                        <div>
                          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Color</label>
                          <select value={specs.laminateColor}
                            onChange={e => setSpecs(s => ({ ...s, laminateColor: e.target.value, laminateColorCustom: '' }))}
                            className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                          >
                            <option value="">Select…</option>
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
                      </>
                    )}

                    {specs.countertops !== 'Laminate' && (
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Color</label>
                        <select value={specs.countertopColor}
                          onChange={e => setSpecs(s => ({ ...s, countertopColor: e.target.value, countertopColorCustom: '' }))}
                          className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                        >
                          <option value="">Select…</option>
                          <option value="Group 1 Color">Group 1 Color</option>
                          <option value="Group 2 Color">Group 2 Color</option>
                          <option value="Group 3 Color">Group 3 Color</option>
                          <option value="Group 5 Color">Group 5 Color</option>
                          <option value="Custom/Specific Color">Custom / Specific Color</option>
                        </select>
                      </div>
                    )}
                    {specs.countertops !== 'Laminate' && specs.countertopColor === 'Custom/Specific Color' && (
                      <input type="text" value={specs.countertopColorCustom}
                        onChange={e => setSpecs(s => ({ ...s, countertopColorCustom: e.target.value }))}
                        placeholder="Enter specific color…"
                        className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Vanity Countertops */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Vanity Countertops
                  <Tooltip text={TOOLTIPS.vanityCountertops} />
                </label>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    id="vanitySame"
                    checked={specs.vanitySameAsKitchen}
                    onChange={e => setSpecs(s => ({ ...s, vanitySameAsKitchen: e.target.checked }))}
                    className="w-4 h-4"
                  />
                  <label htmlFor="vanitySame" className="text-sm text-muted-foreground">
                    Same as Kitchen
                  </label>
                </div>

                {!specs.vanitySameAsKitchen && (
                  <>
                    <select
                      value={specs.vanityCountertops}
                      onChange={e => setSpecs(s => ({ ...s, vanityCountertops: e.target.value, vanityManufacturer: '', vanityManufacturerCustom: '', vanityColor: '', vanityColorCustom: '', vanityLaminateSubstrate: '', vanityLaminateSubstrateCustom: '', vanityLaminateColor: '', vanityLaminateColorCustom: '', vanityBowlStyle: '', vanityBowlStyleCustom: '', vanityCMColor: '', vanityCMColorCustom: '' }))}
                      className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                    >
                      <option value="">Select material…</option>
                      {VANITY_COUNTERTOP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>

                    {specs.vanityCountertops && (
                      <div className="mt-3 p-3 bg-accent/30 rounded-md space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Manufacturer</label>
                          <select
                            value={specs.vanityManufacturer}
                            onChange={e => setSpecs(s => ({ ...s, vanityManufacturer: e.target.value, vanityManufacturerCustom: '' }))}
                            className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                          >
                            <option value="">Select…</option>
                            {COUNTERTOP_MANUFACTURERS[specs.vanityCountertops]?.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        {specs.vanityManufacturer === 'Other' && (
                          <input type="text" value={specs.vanityManufacturerCustom}
                            onChange={e => setSpecs(s => ({ ...s, vanityManufacturerCustom: e.target.value }))}
                            placeholder="Describe manufacturer…"
                            className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                          />
                        )}

                        {specs.vanityCountertops === 'Laminate' && (
                          <>
                            <div>
                              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Substrate</label>
                              <select value={specs.vanityLaminateSubstrate}
                                onChange={e => setSpecs(s => ({ ...s, vanityLaminateSubstrate: e.target.value, vanityLaminateSubstrateCustom: '' }))}
                                className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                              >
                                <option value="">Select…</option>
                                <option value="Particleboard">Particleboard</option>
                                <option value="Plywood">Plywood</option>
                                <option value="Other">Other</option>
                              </select>
                            </div>
                            {specs.vanityLaminateSubstrate === 'Other' && (
                              <input type="text" value={specs.vanityLaminateSubstrateCustom}
                                onChange={e => setSpecs(s => ({ ...s, vanityLaminateSubstrateCustom: e.target.value }))}
                                placeholder="Describe substrate…"
                                className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                              />
                            )}
                            <div>
                              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Color</label>
                              <select value={specs.vanityLaminateColor}
                                onChange={e => setSpecs(s => ({ ...s, vanityLaminateColor: e.target.value, vanityLaminateColorCustom: '' }))}
                                className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                              >
                                <option value="">Select…</option>
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
                          </>
                        )}

                        {specs.vanityCountertops !== 'Laminate' && (
                          <div>
                            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Color</label>
                            <select value={specs.vanityColor}
                              onChange={e => setSpecs(s => ({ ...s, vanityColor: e.target.value, vanityColorCustom: '' }))}
                              className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                            >
                              <option value="">Select…</option>
                              <option value="Group 1 Color">Group 1 Color</option>
                              <option value="Group 2 Color">Group 2 Color</option>
                              <option value="Group 3 Color">Group 3 Color</option>
                              <option value="Group 5 Color">Group 5 Color</option>
                              <option value="Custom/Specific Color">Custom / Specific Color</option>
                            </select>
                          </div>
                        )}
                        {specs.vanityCountertops !== 'Laminate' && specs.vanityColor === 'Custom/Specific Color' && (
                          <input type="text" value={specs.vanityColorCustom}
                            onChange={e => setSpecs(s => ({ ...s, vanityColorCustom: e.target.value }))}
                            placeholder="Enter specific color…"
                            className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                          />
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Additional Tops */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    id="additionalTops"
                    checked={specs.additionalTopsEnabled}
                    onChange={e => setSpecs(s => ({ ...s, additionalTopsEnabled: e.target.checked }))}
                    className="w-4 h-4"
                  />
                  <label htmlFor="additionalTops" className="text-sm font-medium text-foreground">
                    Add Additional Tops
                  </label>
                </div>

                {specs.additionalTopsEnabled && (
                  <div className="p-3 bg-accent/30 rounded-md space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Label</label>
                      <input type="text" value={specs.additionalTopsLabel}
                        onChange={e => setSpecs(s => ({ ...s, additionalTopsLabel: e.target.value }))}
                        placeholder="e.g. Island Top"
                        className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                      />
                    </div>
                    <select
                      value={specs.additionalTops}
                      onChange={e => setSpecs(s => ({ ...s, additionalTops: e.target.value, additionalTopsManufacturer: '', additionalTopsManufacturerCustom: '', additionalTopsColor: '', additionalTopsColorCustom: '', additionalTopsLaminateSubstrate: '', additionalTopsLaminateSubstrateCustom: '', additionalTopsLaminateColor: '', additionalTopsLaminateColorCustom: '' }))}
                      className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                    >
                      <option value="">Select material…</option>
                      {COUNTERTOP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>

                    {specs.additionalTops && (
                      <>
                        <div>
                          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Manufacturer</label>
                          <select
                            value={specs.additionalTopsManufacturer}
                            onChange={e => setSpecs(s => ({ ...s, additionalTopsManufacturer: e.target.value, additionalTopsManufacturerCustom: '' }))}
                            className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                          >
                            <option value="">Select…</option>
                            {COUNTERTOP_MANUFACTURERS[specs.additionalTops]?.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        {specs.additionalTopsManufacturer === 'Other' && (
                          <input type="text" value={specs.additionalTopsManufacturerCustom}
                            onChange={e => setSpecs(s => ({ ...s, additionalTopsManufacturerCustom: e.target.value }))}
                            placeholder="Describe manufacturer…"
                            className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                          />
                        )}

                        {specs.additionalTops === 'Laminate' && (
                          <>
                            <div>
                              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Substrate</label>
                              <select value={specs.additionalTopsLaminateSubstrate}
                                onChange={e => setSpecs(s => ({ ...s, additionalTopsLaminateSubstrate: e.target.value, additionalTopsLaminateSubstrateCustom: '' }))}
                                className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                              >
                                <option value="">Select…</option>
                                <option value="Particleboard">Particleboard</option>
                                <option value="Plywood">Plywood</option>
                                <option value="Other">Other</option>
                              </select>
                            </div>
                            {specs.additionalTopsLaminateSubstrate === 'Other' && (
                              <input type="text" value={specs.additionalTopsLaminateSubstrateCustom}
                                onChange={e => setSpecs(s => ({ ...s, additionalTopsLaminateSubstrateCustom: e.target.value }))}
                                placeholder="Describe substrate…"
                                className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                              />
                            )}
                            <div>
                              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Color</label>
                              <select value={specs.additionalTopsLaminateColor}
                                onChange={e => setSpecs(s => ({ ...s, additionalTopsLaminateColor: e.target.value, additionalTopsLaminateColorCustom: '' }))}
                                className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                              >
                                <option value="">Select…</option>
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
                          </>
                        )}

                        {specs.additionalTops !== 'Laminate' && (
                          <div>
                            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Color</label>
                            <select value={specs.additionalTopsColor}
                              onChange={e => setSpecs(s => ({ ...s, additionalTopsColor: e.target.value, additionalTopsColorCustom: '' }))}
                              className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                            >
                              <option value="">Select…</option>
                              <option value="Group 1 Color">Group 1 Color</option>
                              <option value="Group 2 Color">Group 2 Color</option>
                              <option value="Group 3 Color">Group 3 Color</option>
                              <option value="Group 5 Color">Group 5 Color</option>
                              <option value="Custom/Specific Color">Custom / Specific Color</option>
                            </select>
                          </div>
                        )}
                        {specs.additionalTops !== 'Laminate' && specs.additionalTopsColor === 'Custom/Specific Color' && (
                          <input type="text" value={specs.additionalTopsColorCustom}
                            onChange={e => setSpecs(s => ({ ...s, additionalTopsColorCustom: e.target.value }))}
                            placeholder="Enter specific color…"
                            className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                          />
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Tax */}
              <div className="space-y-2">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Sales Tax on Materials
                    <Tooltip text={TOOLTIPS.tax} />
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
                  <input type="text" value={specs.taxCustom}
                    onChange={e => setSpecs(s => ({ ...s, taxCustom: e.target.value }))}
                    placeholder="Enter tax rate (e.g. 8.25%)"
                    className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="px-6 pb-5 flex items-center justify-between border-t">
            <button
              type="button"
              onClick={handleSkipCreate}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Skip & create with defaults →
            </button>
            <button
              type="button"
              onClick={handleCreate}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all"
              style={{ background: 'hsl(var(--primary))' }}
            >
              Create Project & Upload Plans →
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
