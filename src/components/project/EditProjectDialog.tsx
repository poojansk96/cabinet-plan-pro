import { useState } from 'react';
import { X, Building2, Settings2, Save } from 'lucide-react';
import type { Project, ProjectType } from '@/types/project';

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
  Other:           ['Other'],
};

interface Props {
  project: Project;
  onSave: (updates: Partial<Project>) => void;
  onClose: () => void;
}

export default function EditProjectDialog({ project, onSave, onClose }: Props) {
  const [form, setForm] = useState({
    name: project.name,
    address: project.address || '',
    type: project.type,
    notes: project.notes || '',
  });

  const rawSpecs = project.specs as Record<string, string> | undefined;
  const [specs, setSpecs] = useState({
    projectSuper:               rawSpecs?.projectSuper               ?? '',
    customer:                   rawSpecs?.customer                   ?? '',
    doorStyle:                  rawSpecs?.doorStyle                  ?? '',
    doorStyleCustom:            rawSpecs?.doorStyleCustom            ?? '',
    doorStyleStyle:             rawSpecs?.doorStyleStyle             ?? '',
    doorStyleStyleCustom:       rawSpecs?.doorStyleStyleCustom       ?? '',
    doorStyleConstruction:      rawSpecs?.doorStyleConstruction      ?? '',
    doorStyleFraming:           rawSpecs?.doorStyleFraming           ?? '',
    doorStyleName:              rawSpecs?.doorStyleName              ?? '',
    doorStyleNameCustom:        rawSpecs?.doorStyleNameCustom        ?? '',
    hinges:                     rawSpecs?.hinges                     ?? '',
    hingesCustom:               rawSpecs?.hingesCustom               ?? '',
    drawerBox:                  rawSpecs?.drawerBox                  ?? '',
    drawerGuides:               rawSpecs?.drawerGuides               ?? '',
    drawerGuidesCustom:         rawSpecs?.drawerGuidesCustom         ?? '',
    countertops:                rawSpecs?.countertops                ?? '',
    countertopManufacturer:     rawSpecs?.countertopManufacturer     ?? '',
    countertopManufacturerCustom: rawSpecs?.countertopManufacturerCustom ?? '',
    countertopColor:            rawSpecs?.countertopColor            ?? '',
    countertopColorCustom:      rawSpecs?.countertopColorCustom      ?? '',
    laminateSubstrate:          rawSpecs?.laminateSubstrate          ?? '',
    laminateSubstrateCustom:    rawSpecs?.laminateSubstrateCustom    ?? '',
    laminateColor:              rawSpecs?.laminateColor              ?? '',
    laminateColorCustom:        rawSpecs?.laminateColorCustom        ?? '',
    vanityCountertops:          rawSpecs?.vanityCountertops          ?? '',
    vanityManufacturer:         rawSpecs?.vanityManufacturer         ?? '',
    vanityManufacturerCustom:   rawSpecs?.vanityManufacturerCustom   ?? '',
    vanityColor:                rawSpecs?.vanityColor                ?? '',
    vanityColorCustom:          rawSpecs?.vanityColorCustom          ?? '',
    vanityLaminateSubstrate:    rawSpecs?.vanityLaminateSubstrate    ?? '',
    vanityLaminateSubstrateCustom: rawSpecs?.vanityLaminateSubstrateCustom ?? '',
    vanityLaminateColor:        rawSpecs?.vanityLaminateColor        ?? '',
    vanityLaminateColorCustom:  rawSpecs?.vanityLaminateColorCustom  ?? '',
    vanityBowlStyle:            rawSpecs?.vanityBowlStyle            ?? '',
    vanityBowlStyleCustom:      rawSpecs?.vanityBowlStyleCustom      ?? '',
    vanityCMColor:              rawSpecs?.vanityCMColor              ?? '',
    vanityCMColorCustom:        rawSpecs?.vanityCMColorCustom        ?? '',
    handlesAndHardware:         rawSpecs?.handlesAndHardware         ?? '',
    handlesCustom:              rawSpecs?.handlesCustom              ?? '',
    tax:                        rawSpecs?.tax                        ?? '',
    taxCustom:                  rawSpecs?.taxCustom                  ?? '',
  });

  const [error, setError] = useState('');

  const handleSave = () => {
    if (!form.name.trim()) { setError('Project name is required.'); return; }
    onSave({ ...form, specs });
    onClose();
  };

  /* ── small helpers ── */
  const inputCls = 'w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card';
  const subInputCls = 'w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30';
  const labelCls = 'block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1';

  const TF = (label: string, key: keyof typeof form, placeholder = '') => (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        className={`${inputCls}${key === 'name' && error ? ' border-destructive' : ''}`}
        value={form[key] as string}
        placeholder={placeholder}
        onChange={e => { setForm(f => ({ ...f, [key]: e.target.value })); if (key === 'name') setError(''); }}
      />
      {key === 'name' && error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
    </div>
  );

  const STF = (label: string, key: keyof typeof specs, placeholder = '') => (
    <div>
      <label className={labelCls}>{label}</label>
      <input className={inputCls} value={specs[key]} placeholder={placeholder}
        onChange={e => setSpecs(s => ({ ...s, [key]: e.target.value }))} />
    </div>
  );

  const SSF = (label: string, key: keyof typeof specs, options: string[], placeholder = 'Select…', sub = false) => (
    <div>
      <label className={labelCls}>{label}</label>
      <select
        value={specs[key]}
        className={sub ? subInputCls : inputCls}
        onChange={e => {
          const val = e.target.value;
          if (key === 'countertops') {
            setSpecs(s => ({ ...s, countertops: val, countertopManufacturer: '', countertopManufacturerCustom: '', countertopColor: '', countertopColorCustom: '', laminateSubstrate: '', laminateSubstrateCustom: '', laminateColor: '', laminateColorCustom: '' }));
          } else if (key === 'vanityCountertops') {
            setSpecs(s => ({ ...s, vanityCountertops: val, vanityManufacturer: '', vanityManufacturerCustom: '', vanityColor: '', vanityColorCustom: '', vanityLaminateSubstrate: '', vanityLaminateSubstrateCustom: '', vanityLaminateColor: '', vanityLaminateColorCustom: '', vanityBowlStyle: '', vanityBowlStyleCustom: '', vanityCMColor: '', vanityCMColorCustom: '' }));
          } else {
            setSpecs(s => ({ ...s, [key]: val }));
          }
        }}
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col border border-border">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Building2 size={16} className="text-primary" />
            <h2 className="font-bold text-base">Edit Project Details</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-auto p-5 space-y-5">

          {/* Basic Info */}
          <div className="est-card">
            <div className="est-section-header"><Building2 size={14} />Basic Info</div>
            <div className="p-4 space-y-3">
              {TF('Project Name *', 'name', 'e.g. Maple Grove Apartments – Phase 1')}
              {TF('Project Address', 'address', 'e.g. 1234 Oak St, Austin, TX 78701')}
              <div>
                <label className={labelCls}>Project Type</label>
                <div className="flex gap-3">
                  {(['Residential', 'Commercial'] as ProjectType[]).map(t => (
                    <button key={t} type="button"
                      onClick={() => setForm(f => ({ ...f, type: t }))}
                      className={`flex-1 py-2 rounded-md text-sm font-medium border transition-colors ${form.type === t ? 'border-primary text-white' : 'border-border text-muted-foreground hover:border-primary'}`}
                      style={form.type === t ? { background: 'hsl(var(--primary))' } : {}}
                    >{t}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>Notes</label>
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

          {/* Specs */}
          <div className="est-card">
            <div className="est-section-header"><Settings2 size={14} />Project Specifications</div>
            <div className="p-4 space-y-4">

              {/* Super + Customer */}
              <div className="grid grid-cols-2 gap-4">
                {STF('Project Super', 'projectSuper', 'Supervisor name')}
                {STF('Customer', 'customer', 'Customer / client name')}
              </div>

              {/* Door Style */}
              <div className="space-y-2">
                <div>
                  <label className={labelCls}>Door Style</label>
                  <select value={specs.doorStyle} className={inputCls}
                    onChange={e => setSpecs(s => ({ ...s, doorStyle: e.target.value, doorStyleCustom: '', doorStyleStyle: '', doorStyleStyleCustom: '', doorStyleConstruction: '', doorStyleFraming: '', doorStyleName: '', doorStyleNameCustom: '' }))}>
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
                  <input type="text" value={specs.doorStyleCustom} className={inputCls}
                    onChange={e => setSpecs(s => ({ ...s, doorStyleCustom: e.target.value }))}
                    placeholder="Describe door style / manufacturer…" />
                )}
                {specs.doorStyle && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <div>
                        <label className={labelCls}>Style</label>
                        <select value={specs.doorStyleStyle} className={subInputCls}
                          onChange={e => setSpecs(s => ({ ...s, doorStyleStyle: e.target.value, doorStyleStyleCustom: '' }))}>
                          <option value="">Select style…</option>
                          {specs.doorStyle !== 'India' && <option value="Full overlay shaker">Full overlay shaker</option>}
                          <option value="Full overlay slab">Full overlay slab</option>
                          {specs.doorStyle !== 'India' && <option value="Other">Other</option>}
                        </select>
                      </div>
                      {specs.doorStyleStyle === 'Other' && (
                        <input type="text" value={specs.doorStyleStyleCustom} className={inputCls}
                          onChange={e => setSpecs(s => ({ ...s, doorStyleStyleCustom: e.target.value }))}
                          placeholder="Describe style…" />
                      )}
                      <div>
                        <label className={labelCls}>Construction</label>
                        <select value={specs.doorStyleConstruction} className={subInputCls}
                          onChange={e => setSpecs(s => ({ ...s, doorStyleConstruction: e.target.value }))}>
                          <option value="">Select construction…</option>
                          <option value="Particleboard">Particleboard</option>
                          <option value="Plywood">Plywood</option>
                        </select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <label className={labelCls}>Framing</label>
                        <select value={specs.doorStyleFraming} className={subInputCls}
                          onChange={e => setSpecs(s => ({ ...s, doorStyleFraming: e.target.value }))}>
                          <option value="">Select framing…</option>
                          <option value="Framed">Framed</option>
                          <option value="Frameless">Frameless</option>
                        </select>
                      </div>
                      {(() => {
                        const nameOptions: Record<string, string[]> = {
                          Overseas: ['Avon Group 9', 'Avon Group 10- PTK', 'Kerala Slab', 'Other'],
                          India:    ['Madison', 'Eden', 'Other'],
                        };
                        const opts = nameOptions[specs.doorStyle];
                        if (!opts) return null;
                        return (
                          <div className="space-y-2">
                            <div>
                              <label className={labelCls}>Door Style Name</label>
                              <select value={specs.doorStyleName} className={subInputCls}
                                onChange={e => setSpecs(s => ({ ...s, doorStyleName: e.target.value, doorStyleNameCustom: '' }))}>
                                <option value="">Select door style name…</option>
                                {opts.map(o => <option key={o} value={o}>{o}</option>)}
                              </select>
                            </div>
                            {specs.doorStyleName === 'Other' && (
                              <input type="text" value={specs.doorStyleNameCustom} className={inputCls}
                                onChange={e => setSpecs(s => ({ ...s, doorStyleNameCustom: e.target.value }))}
                                placeholder="Enter door style name…" />
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {/* Kitchen Tops & Vanity Tops */}
              <div className="grid grid-cols-2 gap-4">
                {/* Kitchen Tops */}
                <div className="space-y-2">
                  <div className="text-xs font-bold text-foreground uppercase tracking-wider border-b border-border pb-1 mb-1">🍳 Kitchen Tops</div>
                  {SSF('Material', 'countertops', COUNTERTOP_OPTIONS)}
                  {specs.countertops && COUNTERTOP_MANUFACTURERS[specs.countertops] && (
                    <div className="space-y-2">
                      <div>
                        <label className={labelCls}>Vendor</label>
                        <select value={specs.countertopManufacturer} className={subInputCls}
                          onChange={e => setSpecs(s => ({ ...s, countertopManufacturer: e.target.value, countertopManufacturerCustom: '' }))}>
                          <option value="">Select vendor…</option>
                          {COUNTERTOP_MANUFACTURERS[specs.countertops].map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      {specs.countertopManufacturer === 'Other' && (
                        <input type="text" value={specs.countertopManufacturerCustom} className={inputCls}
                          onChange={e => setSpecs(s => ({ ...s, countertopManufacturerCustom: e.target.value }))}
                          placeholder="Enter manufacturer name…" />
                      )}
                      {(specs.countertops === 'Quartz' || specs.countertops === 'Granite') && (
                        <div className="space-y-2">
                          <div>
                            <label className={labelCls}>Color</label>
                            <select value={specs.countertopColor} className={subInputCls}
                              onChange={e => setSpecs(s => ({ ...s, countertopColor: e.target.value, countertopColorCustom: '' }))}>
                              <option value="">Select color group…</option>
                              <option value="Group 1 Color">Group 1 Color</option>
                              <option value="Group 2 Color">Group 2 Color</option>
                              <option value="Group 3 Color">Group 3 Color</option>
                              <option value="Custom/Specific Color">Custom / Specific Color</option>
                            </select>
                          </div>
                          {specs.countertopColor === 'Custom/Specific Color' && (
                            <input type="text" value={specs.countertopColorCustom} className={inputCls}
                              onChange={e => setSpecs(s => ({ ...s, countertopColorCustom: e.target.value }))}
                              placeholder="Enter specific color…" />
                          )}
                        </div>
                      )}
                      {specs.countertops === 'Laminate' && (
                        <div className="space-y-2">
                          <div>
                            <label className={labelCls}>Substrate</label>
                            <select value={specs.laminateSubstrate} className={subInputCls}
                              onChange={e => setSpecs(s => ({ ...s, laminateSubstrate: e.target.value, laminateSubstrateCustom: '' }))}>
                              <option value="">Select substrate…</option>
                              <option value="Particleboard">Particleboard</option>
                              <option value="Plywood">Plywood</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                          {specs.laminateSubstrate === 'Other' && (
                            <input type="text" value={specs.laminateSubstrateCustom} className={inputCls}
                              onChange={e => setSpecs(s => ({ ...s, laminateSubstrateCustom: e.target.value }))}
                              placeholder="Enter substrate type…" />
                          )}
                          <div>
                            <label className={labelCls}>Color</label>
                            <select value={specs.laminateColor} className={subInputCls}
                              onChange={e => setSpecs(s => ({ ...s, laminateColor: e.target.value, laminateColorCustom: '' }))}>
                              <option value="">Select color group…</option>
                              <option value="Group 1 Color">Group 1 Color</option>
                              <option value="Group 2 Color">Group 2 Color</option>
                              <option value="Group 3 Color">Group 3 Color</option>
                              <option value="Group 5 Color">Group 5 Color</option>
                              <option value="Custom/Specific Color">Custom / Specific Color</option>
                            </select>
                          </div>
                          {specs.laminateColor === 'Custom/Specific Color' && (
                            <input type="text" value={specs.laminateColorCustom} className={inputCls}
                              onChange={e => setSpecs(s => ({ ...s, laminateColorCustom: e.target.value }))}
                              placeholder="Enter specific color…" />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Vanity Tops */}
                <div className="space-y-2">
                  <div className="text-xs font-bold text-foreground uppercase tracking-wider border-b border-border pb-1 mb-1">🚿 Vanity Tops</div>
                  {SSF('Material', 'vanityCountertops', VANITY_COUNTERTOP_OPTIONS)}
                  {specs.vanityCountertops && COUNTERTOP_MANUFACTURERS[specs.vanityCountertops] && (
                    <div className="space-y-2">
                      <div>
                        <label className={labelCls}>Vendor</label>
                        <select value={specs.vanityManufacturer} className={subInputCls}
                          onChange={e => setSpecs(s => ({ ...s, vanityManufacturer: e.target.value, vanityManufacturerCustom: '' }))}>
                          <option value="">Select vendor…</option>
                          {COUNTERTOP_MANUFACTURERS[specs.vanityCountertops].map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      {specs.vanityManufacturer === 'Other' && (
                        <input type="text" value={specs.vanityManufacturerCustom} className={inputCls}
                          onChange={e => setSpecs(s => ({ ...s, vanityManufacturerCustom: e.target.value }))}
                          placeholder="Enter manufacturer name…" />
                      )}
                      {(specs.vanityCountertops === 'Quartz' || specs.vanityCountertops === 'Granite') && (
                        <div className="space-y-2">
                          <div>
                            <label className={labelCls}>Color</label>
                            <select value={specs.vanityColor} className={subInputCls}
                              onChange={e => setSpecs(s => ({ ...s, vanityColor: e.target.value, vanityColorCustom: '' }))}>
                              <option value="">Select color group…</option>
                              <option value="Group 1 Color">Group 1 Color</option>
                              <option value="Group 2 Color">Group 2 Color</option>
                              <option value="Group 3 Color">Group 3 Color</option>
                              <option value="Custom/Specific Color">Custom / Specific Color</option>
                            </select>
                          </div>
                          {specs.vanityColor === 'Custom/Specific Color' && (
                            <input type="text" value={specs.vanityColorCustom} className={inputCls}
                              onChange={e => setSpecs(s => ({ ...s, vanityColorCustom: e.target.value }))}
                              placeholder="Enter specific color…" />
                          )}
                        </div>
                      )}
                      {specs.vanityCountertops === 'Laminate' && (
                        <div className="space-y-2">
                          <div>
                            <label className={labelCls}>Substrate</label>
                            <select value={specs.vanityLaminateSubstrate} className={subInputCls}
                              onChange={e => setSpecs(s => ({ ...s, vanityLaminateSubstrate: e.target.value, vanityLaminateSubstrateCustom: '' }))}>
                              <option value="">Select substrate…</option>
                              <option value="Particleboard">Particleboard</option>
                              <option value="Plywood">Plywood</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                          {specs.vanityLaminateSubstrate === 'Other' && (
                            <input type="text" value={specs.vanityLaminateSubstrateCustom} className={inputCls}
                              onChange={e => setSpecs(s => ({ ...s, vanityLaminateSubstrateCustom: e.target.value }))}
                              placeholder="Enter substrate type…" />
                          )}
                          <div>
                            <label className={labelCls}>Color</label>
                            <select value={specs.vanityLaminateColor} className={subInputCls}
                              onChange={e => setSpecs(s => ({ ...s, vanityLaminateColor: e.target.value, vanityLaminateColorCustom: '' }))}>
                              <option value="">Select color group…</option>
                              <option value="Group 1 Color">Group 1 Color</option>
                              <option value="Group 2 Color">Group 2 Color</option>
                              <option value="Group 3 Color">Group 3 Color</option>
                              <option value="Group 5 Color">Group 5 Color</option>
                              <option value="Custom/Specific Color">Custom / Specific Color</option>
                            </select>
                          </div>
                          {specs.vanityLaminateColor === 'Custom/Specific Color' && (
                            <input type="text" value={specs.vanityLaminateColorCustom} className={inputCls}
                              onChange={e => setSpecs(s => ({ ...s, vanityLaminateColorCustom: e.target.value }))}
                              placeholder="Enter specific color…" />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {/* Cultured Marble */}
                  {specs.vanityCountertops === 'Cultured Marble' && (
                    <div className="space-y-2">
                      <div>
                        <label className={labelCls}>Bowl Style</label>
                        <select value={specs.vanityBowlStyle} className={subInputCls}
                          onChange={e => setSpecs(s => ({ ...s, vanityBowlStyle: e.target.value, vanityBowlStyleCustom: '' }))}>
                          <option value="">Select bowl style…</option>
                          <option value="Oval">Oval</option>
                          <option value="Recessed Oval">Recessed Oval</option>
                          <option value="Rectangular - Custom">Rectangular - Custom</option>
                          <option value="Wave - Custom">Wave - Custom</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Color</label>
                        <select value={specs.vanityCMColor} className={subInputCls}
                          onChange={e => setSpecs(s => ({ ...s, vanityCMColor: e.target.value, vanityCMColorCustom: '' }))}>
                          <option value="">Select color…</option>
                          <option value="Solid White">Solid White</option>
                          <option value="Solid Biscuit">Solid Biscuit</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      {specs.vanityCMColor === 'Other' && (
                        <input type="text" value={specs.vanityCMColorCustom} className={inputCls}
                          onChange={e => setSpecs(s => ({ ...s, vanityCMColorCustom: e.target.value }))}
                          placeholder="Enter color…" />
                      )}
                    </div>
                  )}
                  {/* Swanstone */}
                  {specs.vanityCountertops === 'Swanstone' && (
                    <div className="space-y-2">
                      <div>
                        <label className={labelCls}>Bowl Style</label>
                        <select value={specs.vanityBowlStyle} className={subInputCls}
                          onChange={e => setSpecs(s => ({ ...s, vanityBowlStyle: e.target.value, vanityBowlStyleCustom: '' }))}>
                          <option value="">Select bowl style…</option>
                          <option value="Contour Style Vanity Tops">Contour Style Vanity Tops</option>
                          <option value="Custom Vanity Tops">Custom Vanity Tops</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Color</label>
                        <select value={specs.vanityCMColor} className={subInputCls}
                          onChange={e => setSpecs(s => ({ ...s, vanityCMColor: e.target.value, vanityCMColorCustom: '' }))}>
                          <option value="">Select color…</option>
                          <option value="Solid White">Solid White</option>
                          <option value="Solid Bisque">Solid Bisque</option>
                          <option value="Solid Bone">Solid Bone</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      {specs.vanityCMColor === 'Other' && (
                        <input type="text" value={specs.vanityCMColorCustom} className={inputCls}
                          onChange={e => setSpecs(s => ({ ...s, vanityCMColorCustom: e.target.value }))}
                          placeholder="Enter color…" />
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Hinges + Drawer Box */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  {SSF('Hinges', 'hinges', HINGE_OPTIONS)}
                  {specs.hinges === 'Other' && (
                    <input type="text" value={specs.hingesCustom} className={inputCls}
                      onChange={e => setSpecs(s => ({ ...s, hingesCustom: e.target.value }))}
                      placeholder="Describe hinge type…" />
                  )}
                </div>
                {SSF('Drawer Box', 'drawerBox', DRAWER_BOX_OPTIONS)}
              </div>

              {/* Drawer Guides + Handles */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  {SSF('Drawer Guides', 'drawerGuides', DRAWER_GUIDE_OPTIONS)}
                  {specs.drawerGuides === 'Other' && (
                    <input type="text" value={specs.drawerGuidesCustom} className={inputCls}
                      onChange={e => setSpecs(s => ({ ...s, drawerGuidesCustom: e.target.value }))}
                      placeholder="Describe drawer guide type…" />
                  )}
                </div>
                <div className="space-y-2">
                  <div>
                    <label className={labelCls}>Handles</label>
                    <select value={specs.handlesAndHardware} className={inputCls}
                      onChange={e => setSpecs(s => ({ ...s, handlesAndHardware: e.target.value, handlesCustom: '' }))}>
                      <option value="">Select handles…</option>
                      <option value='Standard knob, 4" wire pulls or 96mm barpulls in Brushed nickel finish'>Standard knob, 4" wire pulls or 96mm barpulls in Brushed nickel finish</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  {specs.handlesAndHardware === 'Other' && (
                    <input type="text" value={specs.handlesCustom} className={inputCls}
                      onChange={e => setSpecs(s => ({ ...s, handlesCustom: e.target.value }))}
                      placeholder="Describe handle style…" />
                  )}
                </div>
              </div>

              {/* Tax */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div>
                    <label className={labelCls}>Sales Tax on Materials</label>
                    <select value={specs.tax} className={inputCls}
                      onChange={e => setSpecs(s => ({ ...s, tax: e.target.value, taxCustom: '' }))}>
                      <option value="">Select tax rate…</option>
                      <option value="CT-6.35%">CT — 6.35%</option>
                      <option value="MA-6.25%">MA — 6.25%</option>
                      <option value="Tax Exempt">Tax Exempt</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  {specs.tax === 'Other' && (
                    <input type="text" value={specs.taxCustom} className={inputCls}
                      onChange={e => setSpecs(s => ({ ...s, taxCustom: e.target.value }))}
                      placeholder="Enter tax rate (e.g. 8.25%)" />
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center justify-between flex-shrink-0">
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 rounded-md text-sm font-semibold text-white transition-colors"
            style={{ background: 'hsl(var(--primary))' }}
          >
            <Save size={14} />
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
