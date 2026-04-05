import { useState, useCallback } from 'react';
import { Building2, Settings2, Save, Check } from 'lucide-react';
import type { Project } from '@/types/project';

const HINGE_OPTIONS = ['Standard soft close 6 way adjustable hinges', 'Other'];
const DRAWER_BOX_OPTIONS = ['Dovetail Wood', 'Melamine', 'Particleboard', 'Metal (Tandem)', 'Other'];
const DRAWER_GUIDE_OPTIONS = ['Standard NRG guides', 'Upgraded SCG guides', 'Other'];
const COUNTERTOP_OPTIONS = ['Quartz', 'Granite', 'Laminate', 'Solid Surface- Corian', 'Other'];
const VANITY_COUNTERTOP_OPTIONS = ['Quartz', 'Granite', 'Laminate', 'Solid Surface- Corian', 'Cultured Marble', 'Swanstone', 'Other'];

const COUNTERTOP_MANUFACTURERS: Record<string, string[]> = {
  Quartz: ['Overseas', 'Local MSI', 'KOL Marble', 'Other'],
  Granite: ['Overseas', 'Local MSI', 'KOL Marble', 'Other'],
  Laminate: ['Hartson-Kennedy', 'Other'],
  'Solid Surface- Corian': ['Parksite Material+ Sterling surface Install', 'Other'],
  Other: ['Other'],
};

// Door style finish color options per manufacturer + finish type
const OVERSEAS_STAIN_COLORS = ['Walnut', 'Driftwood', 'Caramel', 'Expresso', 'Other'];
const OVERSEAS_PAINT_COLORS = ['Painted White', 'Painted Stratus', 'French Vanilla', 'Other'];
const INDIA_STAIN_COLORS = ['Amaretto', 'Cabernet', 'Toast', 'Cashew', 'Other'];
const INDIA_PAINT_COLORS = ['Ivory', 'Ash', 'Bisque', 'Pewter', 'Other'];
const LEGACY_MADISON_COLORS = ['Super White', 'Gothic Grey', 'Other'];
const LEGACY_EDEN_COLORS = ['Greywood', 'Other'];

interface Props {
  project: Project;
  onSave: (updates: Partial<Project>) => void;
}

export default function ProjectInfoModule({ project, onSave }: Props) {
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    name: project.name,
    address: project.address || '',
    type: project.type,
    notes: project.notes || '',
  });

  const rawSpecs = project.specs as Record<string, string> | undefined;
  const [specs, setSpecs] = useState(() => ({
    projectSuper: rawSpecs?.projectSuper ?? '',
    customer: rawSpecs?.customer ?? '',
    doorStyle: rawSpecs?.doorStyle ?? '',
    doorStyleCustom: rawSpecs?.doorStyleCustom ?? '',
    doorStyleStyle: rawSpecs?.doorStyleStyle ?? '',
    doorStyleStyleCustom: rawSpecs?.doorStyleStyleCustom ?? '',
    doorStyleConstruction: rawSpecs?.doorStyleConstruction ?? '',
    doorStyleSeries: rawSpecs?.doorStyleSeries ?? '',
    doorStyleFraming: rawSpecs?.doorStyleFraming ?? '',
    doorStyleName: rawSpecs?.doorStyleName ?? '',
    doorStyleNameCustom: rawSpecs?.doorStyleNameCustom ?? '',
    doorStyleFinish: rawSpecs?.doorStyleFinish ?? '',
    doorStyleFinishColor: rawSpecs?.doorStyleFinishColor ?? '',
    doorStyleFinishColorCustom: rawSpecs?.doorStyleFinishColorCustom ?? '',
    hinges: rawSpecs?.hinges ?? '',
    hingesCustom: rawSpecs?.hingesCustom ?? '',
    drawerBox: rawSpecs?.drawerBox ?? '',
    drawerGuides: rawSpecs?.drawerGuides ?? '',
    drawerGuidesCustom: rawSpecs?.drawerGuidesCustom ?? '',
    countertops: rawSpecs?.countertops ?? '',
    countertopManufacturer: rawSpecs?.countertopManufacturer ?? '',
    countertopManufacturerCustom: rawSpecs?.countertopManufacturerCustom ?? '',
    countertopColor: rawSpecs?.countertopColor ?? '',
    countertopColorCustom: rawSpecs?.countertopColorCustom ?? '',
    laminateSubstrate: rawSpecs?.laminateSubstrate ?? '',
    laminateSubstrateCustom: rawSpecs?.laminateSubstrateCustom ?? '',
    laminateColor: rawSpecs?.laminateColor ?? '',
    laminateColorCustom: rawSpecs?.laminateColorCustom ?? '',
    vanityCountertops: rawSpecs?.vanityCountertops ?? '',
    vanityManufacturer: rawSpecs?.vanityManufacturer ?? '',
    vanityManufacturerCustom: rawSpecs?.vanityManufacturerCustom ?? '',
    vanityColor: rawSpecs?.vanityColor ?? '',
    vanityColorCustom: rawSpecs?.vanityColorCustom ?? '',
    vanityLaminateSubstrate: rawSpecs?.vanityLaminateSubstrate ?? '',
    vanityLaminateSubstrateCustom: rawSpecs?.vanityLaminateSubstrateCustom ?? '',
    vanityLaminateColor: rawSpecs?.vanityLaminateColor ?? '',
    vanityLaminateColorCustom: rawSpecs?.vanityLaminateColorCustom ?? '',
    vanityBowlStyle: rawSpecs?.vanityBowlStyle ?? '',
    vanityBowlStyleCustom: rawSpecs?.vanityBowlStyleCustom ?? '',
    vanityCMColor: rawSpecs?.vanityCMColor ?? '',
    vanityCMColorCustom: rawSpecs?.vanityCMColorCustom ?? '',
    vanitySameAsKitchen: rawSpecs?.vanitySameAsKitchen === 'true' || (rawSpecs?.vanitySameAsKitchen as unknown) === true,
    additionalTopsEnabled: rawSpecs?.additionalTopsEnabled === 'true' || (rawSpecs?.additionalTopsEnabled as unknown) === true,
    additionalTopsLabel: rawSpecs?.additionalTopsLabel ?? '',
    additionalTops: rawSpecs?.additionalTops ?? '',
    additionalTopsManufacturer: rawSpecs?.additionalTopsManufacturer ?? '',
    additionalTopsManufacturerCustom: rawSpecs?.additionalTopsManufacturerCustom ?? '',
    additionalTopsColor: rawSpecs?.additionalTopsColor ?? '',
    additionalTopsColorCustom: rawSpecs?.additionalTopsColorCustom ?? '',
    additionalTopsLaminateSubstrate: rawSpecs?.additionalTopsLaminateSubstrate ?? '',
    additionalTopsLaminateSubstrateCustom: rawSpecs?.additionalTopsLaminateSubstrateCustom ?? '',
    additionalTopsLaminateColor: rawSpecs?.additionalTopsLaminateColor ?? '',
    additionalTopsLaminateColorCustom: rawSpecs?.additionalTopsLaminateColorCustom ?? '',
    handlesAndHardware: rawSpecs?.handlesAndHardware ?? '',
    handlesCustom: rawSpecs?.handlesCustom ?? '',
    faucetSelection: rawSpecs?.faucetSelection ?? '',
    tax: rawSpecs?.tax ?? '',
    taxCustom: rawSpecs?.taxCustom ?? '',
    takeoffPerson: rawSpecs?.takeoffPerson ?? '',
  }));

  const handleSave = useCallback(() => {
    if (!form.name.trim()) return;
    onSave({ ...form, specs });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [form, specs, onSave]);

  const inputCls = 'w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card';
  const subInputCls = 'w-full h-9 px-3 text-sm border border-primary/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-accent/30';
  const labelCls = 'block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1';

  const TF = (label: string, key: keyof typeof form, placeholder = '') => (
    <div>
      <label className={labelCls}>{label}</label>
      <input className={inputCls} value={form[key] as string} placeholder={placeholder}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
    </div>
  );

  const STF = (label: string, key: keyof typeof specs, placeholder = '') => (
    <div>
      <label className={labelCls}>{label}</label>
      <input className={inputCls} value={specs[key] as string} placeholder={placeholder}
        onChange={e => setSpecs(s => ({ ...s, [key]: e.target.value }))} />
    </div>
  );

  const SSF = (label: string, key: keyof typeof specs, options: string[], placeholder = 'Select…', sub = false) => {
    const val = specs[key];
    if (typeof val === 'boolean') return null;
    return (
      <div>
        <label className={labelCls}>{label}</label>
        <select value={val} className={sub ? subInputCls : inputCls}
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
          }}>
          <option value="">{placeholder}</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  };

  // Get finish color options based on manufacturer, finish type, and door name
  const getFinishColorOptions = (): string[] => {
    const { doorStyle, doorStyleFinish, doorStyleName } = specs;
    if (doorStyle === 'Overseas') {
      return doorStyleFinish === 'Stained' ? OVERSEAS_STAIN_COLORS : doorStyleFinish === 'Painted' ? OVERSEAS_PAINT_COLORS : [];
    }
    if (doorStyle === 'India') {
      return doorStyleFinish === 'Stained' ? INDIA_STAIN_COLORS : doorStyleFinish === 'Painted' ? INDIA_PAINT_COLORS : [];
    }
    if (doorStyle === 'Legacy') {
      if (doorStyleName === 'Madison') return LEGACY_MADISON_COLORS;
      if (doorStyleName === 'Eden') return LEGACY_EDEN_COLORS;
      return [];
    }
    return [];
  };

  // Determine which fields to show per manufacturer
  const showStyle = specs.doorStyle === 'Legacy' || specs.doorStyle === 'Bristol' || specs.doorStyle === 'India box+ Bristol door';
  const showFraming = specs.doorStyle === 'Legacy' || specs.doorStyle === 'Bristol' || specs.doorStyle === 'India box+ Bristol door';
  const showConstruction = specs.doorStyle === 'India' || specs.doorStyle === 'Legacy' || specs.doorStyle === 'Bristol' || specs.doorStyle === 'India box+ Bristol door';
  const showSeries = specs.doorStyle === 'Legacy';
  const showFinish = specs.doorStyle === 'Overseas' || specs.doorStyle === 'India' || specs.doorStyle === 'Legacy';

  const finishColorOptions = getFinishColorOptions();

  // Door name options per manufacturer
  const doorNameOptions: Record<string, string[]> = {
    Overseas: ['Avon Group 9', 'Avon Group 10- PTK', 'Kerala Slab', 'Other'],
    India: ['Madison', 'Eden', 'Other'],
    Legacy: ['Sagamore Shaker Maple', 'Venetian MDF Painted', 'Other'],
  };

  return (
    <div className="space-y-4">
      {/* Basic Info */}
      <div className="est-card">
        <div className="est-section-header flex items-center justify-between">
          <div className="flex items-center gap-2"><Building2 size={14} />Basic Info</div>
          <button onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold text-white transition-colors"
            style={{ background: saved ? 'hsl(142 71% 45%)' : 'hsl(var(--primary))' }}>
            {saved ? <><Check size={12} /> Saved</> : <><Save size={12} /> Save</>}
          </button>
        </div>
        <div className="p-4 space-y-3">
          {TF('Project Name *', 'name', 'e.g. Maple Grove Apartments – Phase 1')}
          {TF('Project Address', 'address', 'e.g. 1234 Oak St, Austin, TX 78701')}
          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2} placeholder="Project notes, special requirements..."
              className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary border-border bg-card resize-none" />
          </div>
        </div>
      </div>

      {/* Specs */}
      <div className="est-card">
        <div className="est-section-header"><Settings2 size={14} />Project Specifications</div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {STF('Project Super', 'projectSuper', 'Supervisor name')}
            {STF('Customer', 'customer', 'Customer / client name')}
            {STF('Prefinal Person', 'takeoffPerson', 'Person doing the prefinal')}
          </div>

          {/* Door Style */}
          <div className="space-y-2">
            <div>
              <label className={labelCls}>Door Style</label>
              <select value={specs.doorStyle} className={inputCls}
                onChange={e => setSpecs(s => ({ ...s, doorStyle: e.target.value, doorStyleCustom: '', doorStyleStyle: '', doorStyleStyleCustom: '', doorStyleConstruction: '', doorStyleFraming: '', doorStyleSeries: '', doorStyleName: '', doorStyleNameCustom: '', doorStyleFinish: '', doorStyleFinishColor: '', doorStyleFinishColorCustom: '' }))}>
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
                onChange={e => setSpecs(s => ({ ...s, doorStyleCustom: e.target.value }))} placeholder="Describe door style / manufacturer…" />
            )}
            {specs.doorStyle && specs.doorStyle !== 'Other' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  {/* Style - only for Legacy, Bristol, India box+ Bristol door */}
                  {showStyle && (
                    <div>
                      <label className={labelCls}>Style</label>
                      <select value={specs.doorStyleStyle} className={subInputCls}
                        onChange={e => setSpecs(s => ({ ...s, doorStyleStyle: e.target.value, doorStyleStyleCustom: '' }))}>
                        <option value="">Select style…</option>
                        <option value="Full overlay shaker">Full overlay shaker</option>
                        <option value="Full overlay slab">Full overlay slab</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  )}
                  {showStyle && specs.doorStyleStyle === 'Other' && (
                    <input type="text" value={specs.doorStyleStyleCustom} className={inputCls}
                      onChange={e => setSpecs(s => ({ ...s, doorStyleStyleCustom: e.target.value }))} placeholder="Describe style…" />
                  )}

                  {/* Series - Legacy only */}
                  {showSeries && (
                    <div>
                      <label className={labelCls}>Series</label>
                      <select value={specs.doorStyleSeries} className={subInputCls}
                        onChange={e => setSpecs(s => ({ ...s, doorStyleSeries: e.target.value, doorStyleConstruction: '' }))}>
                        <option value="">Select series…</option>
                        <option value="Advantage">Advantage</option>
                        <option value="Debut">Debut</option>
                        <option value="Presidential">Presidential</option>
                      </select>
                    </div>
                  )}

                  {/* Construction - India, Legacy, Bristol, India box+ Bristol door */}
                  {showConstruction && (
                    <div>
                      <label className={labelCls}>Construction</label>
                      <select value={specs.doorStyleConstruction} className={subInputCls}
                        onChange={e => setSpecs(s => ({ ...s, doorStyleConstruction: e.target.value }))}>
                        <option value="">Select construction…</option>
                        {specs.doorStyle === 'Legacy' && specs.doorStyleSeries === 'Advantage' ? (
                          <><option value="Standard">Standard</option><option value="Verde">Verde</option><option value="Intense">Intense</option></>
                        ) : specs.doorStyle === 'Legacy' && specs.doorStyleSeries === 'Debut' ? (
                          <><option value="Standard">Standard</option><option value="Plywood">Plywood</option><option value="Extreme">Extreme</option></>
                        ) : (
                          <><option value="Particleboard">Particleboard</option><option value="Plywood">Plywood</option></>
                        )}
                      </select>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  {/* Framing - Legacy, Bristol, India box+ Bristol door */}
                  {showFraming && (
                    <div>
                      <label className={labelCls}>Framing</label>
                      <select value={specs.doorStyleFraming} className={subInputCls}
                        onChange={e => setSpecs(s => ({ ...s, doorStyleFraming: e.target.value }))}>
                        <option value="">Select framing…</option>
                        <option value="Framed">Framed</option>
                        <option value="Frameless">Frameless</option>
                      </select>
                    </div>
                  )}

                  {/* Door Style Name */}
                  {doorNameOptions[specs.doorStyle] && (
                    <div className="space-y-2">
                      <div>
                        <label className={labelCls}>Door Style Name</label>
                        <select value={specs.doorStyleName} className={subInputCls}
                          onChange={e => setSpecs(s => ({ ...s, doorStyleName: e.target.value, doorStyleNameCustom: '', doorStyleFinish: specs.doorStyle === 'Legacy' ? '' : s.doorStyleFinish, doorStyleFinishColor: specs.doorStyle === 'Legacy' ? '' : s.doorStyleFinishColor, doorStyleFinishColorCustom: specs.doorStyle === 'Legacy' ? '' : s.doorStyleFinishColorCustom }))}>
                          <option value="">Select door style name…</option>
                          {doorNameOptions[specs.doorStyle].map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                      {specs.doorStyleName === 'Other' && (
                        <input type="text" value={specs.doorStyleNameCustom} className={inputCls}
                          onChange={e => setSpecs(s => ({ ...s, doorStyleNameCustom: e.target.value }))} placeholder="Enter door style name…" />
                      )}
                    </div>
                  )}

                  {/* Door Style Finish - Overseas, India: Stained/Painted select; Legacy: based on door name */}
                  {showFinish && (specs.doorStyle === 'Overseas' || specs.doorStyle === 'India') && (
                    <div>
                      <label className={labelCls}>Door Style Finish</label>
                      <select value={specs.doorStyleFinish} className={subInputCls}
                        onChange={e => setSpecs(s => ({ ...s, doorStyleFinish: e.target.value, doorStyleFinishColor: '', doorStyleFinishColorCustom: '' }))}>
                        <option value="">Select finish…</option>
                        <option value="Stained">Stained</option>
                        <option value="Painted">Painted</option>
                      </select>
                    </div>
                  )}

                  {/* Legacy: Finish label appears when door name is Madison or Eden */}
                  {specs.doorStyle === 'Legacy' && (specs.doorStyleName === 'Madison' || specs.doorStyleName === 'Eden') && (
                    <div>
                      <label className={labelCls}>Door Style Finish</label>
                      <p className="text-xs text-muted-foreground italic mb-1">Color options for {specs.doorStyleName}</p>
                    </div>
                  )}

                  {/* Finish Color */}
                  {finishColorOptions.length > 0 && (
                    <div className="space-y-2">
                      <div>
                        <label className={labelCls}>Finish Color</label>
                        <select value={specs.doorStyleFinishColor} className={subInputCls}
                          onChange={e => setSpecs(s => ({ ...s, doorStyleFinishColor: e.target.value, doorStyleFinishColorCustom: '' }))}>
                          <option value="">Select color…</option>
                          {finishColorOptions.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                      {specs.doorStyleFinishColor === 'Other' && (
                        <input type="text" value={specs.doorStyleFinishColorCustom} className={inputCls}
                          onChange={e => setSpecs(s => ({ ...s, doorStyleFinishColorCustom: e.target.value }))} placeholder="Enter color…" />
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Hinges + Drawer Box */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              {SSF('Hinges', 'hinges', HINGE_OPTIONS)}
              {specs.hinges === 'Other' && (
                <input type="text" value={specs.hingesCustom} className={inputCls}
                  onChange={e => setSpecs(s => ({ ...s, hingesCustom: e.target.value }))} placeholder="Describe hinge type…" />
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
                  onChange={e => setSpecs(s => ({ ...s, drawerGuidesCustom: e.target.value }))} placeholder="Describe drawer guide type…" />
              )}
            </div>
            <div className="space-y-2">
              <div>
                <label className={labelCls}>Handles</label>
                <select value={specs.handlesAndHardware} className={inputCls}
                  onChange={e => setSpecs(s => ({ ...s, handlesAndHardware: e.target.value, handlesCustom: '' }))}>
                  <option value="">Select handles…</option>
                  <option value="BP20596195">BP20596195</option>
                  <option value="BP33206195">BP33206195</option>
                  <option value="BP9041195">BP9041195</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              {specs.handlesAndHardware === 'Other' && (
                <input type="text" value={specs.handlesCustom} className={inputCls}
                  onChange={e => setSpecs(s => ({ ...s, handlesCustom: e.target.value }))} placeholder="Enter handle details…" />
              )}
            </div>
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
                      onChange={e => setSpecs(s => ({ ...s, countertopManufacturerCustom: e.target.value }))} placeholder="Enter manufacturer name…" />
                  )}
                  {(specs.countertops === 'Quartz' || specs.countertops === 'Granite') && (
                    <div>
                      <label className={labelCls}>Color</label>
                      <input type="text" value={specs.countertopColor} className={inputCls}
                        onChange={e => setSpecs(s => ({ ...s, countertopColor: e.target.value }))} placeholder="Enter color name…" />
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
                          onChange={e => setSpecs(s => ({ ...s, laminateSubstrateCustom: e.target.value }))} placeholder="Enter substrate type…" />
                      )}
                      <div>
                        <label className={labelCls}>Color</label>
                        <input type="text" value={specs.laminateColor} className={inputCls}
                          onChange={e => setSpecs(s => ({ ...s, laminateColor: e.target.value }))} placeholder="Enter color name…" />
                      </div>
                    </div>
                  )}
                  {specs.countertops === 'Solid Surface- Corian' && (
                    <div>
                      <label className={labelCls}>Color</label>
                      <input type="text" value={specs.countertopColor} className={inputCls}
                        onChange={e => setSpecs(s => ({ ...s, countertopColor: e.target.value }))} placeholder="Enter color name…" />
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
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary" />
                <span className="text-xs font-medium text-muted-foreground">Same as Kitchen Tops</span>
              </label>
              {!specs.vanitySameAsKitchen && (
                <>
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
                          onChange={e => setSpecs(s => ({ ...s, vanityManufacturerCustom: e.target.value }))} placeholder="Enter manufacturer name…" />
                      )}
                      {(specs.vanityCountertops === 'Quartz' || specs.vanityCountertops === 'Granite') && (
                        <div>
                          <label className={labelCls}>Color</label>
                          <input type="text" value={specs.vanityColor} className={inputCls}
                            onChange={e => setSpecs(s => ({ ...s, vanityColor: e.target.value }))} placeholder="Enter color name…" />
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
                              onChange={e => setSpecs(s => ({ ...s, vanityLaminateSubstrateCustom: e.target.value }))} placeholder="Enter substrate type…" />
                          )}
                          <div>
                            <label className={labelCls}>Color</label>
                            <input type="text" value={specs.vanityLaminateColor} className={inputCls}
                              onChange={e => setSpecs(s => ({ ...s, vanityLaminateColor: e.target.value }))} placeholder="Enter color name…" />
                          </div>
                        </div>
                      )}
                      {specs.vanityCountertops === 'Solid Surface- Corian' && (
                        <div>
                          <label className={labelCls}>Color</label>
                          <input type="text" value={specs.vanityColor} className={inputCls}
                            onChange={e => setSpecs(s => ({ ...s, vanityColor: e.target.value }))} placeholder="Enter color name…" />
                        </div>
                      )}
                    </div>
                  )}
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
                          onChange={e => setSpecs(s => ({ ...s, vanityCMColorCustom: e.target.value }))} placeholder="Enter color…" />
                      )}
                    </div>
                  )}
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
                          onChange={e => setSpecs(s => ({ ...s, vanityCMColorCustom: e.target.value }))} placeholder="Enter color…" />
                      )}
                    </div>
                  )}
                  {/* Faucet Selection for Cultured Marble / Swanstone */}
                  {(specs.vanityCountertops === 'Cultured Marble' || specs.vanityCountertops === 'Swanstone') && (
                    <div>
                      <label className={labelCls}>Faucet Selection</label>
                      <select value={specs.faucetSelection} className={subInputCls}
                        onChange={e => setSpecs(s => ({ ...s, faucetSelection: e.target.value }))}>
                        <option value="">Select faucet type…</option>
                        <option value="Single Hole">Single Hole</option>
                        <option value='4"CC - 3 Holes'>4"CC - 3 Holes</option>
                        <option value='8"CC - 3 Holes'>8"CC - 3 Holes</option>
                      </select>
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
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary" />
              <span className="text-xs font-bold text-foreground uppercase tracking-wider">➕ Additional Tops</span>
            </label>
            {specs.additionalTopsEnabled && (
              <div className="space-y-2 pl-1 border-l-2 border-primary/20 ml-2">
                <div>
                  <label className={labelCls}>Description / Area</label>
                  <input type="text" value={specs.additionalTopsLabel} className={inputCls}
                    onChange={e => setSpecs(s => ({ ...s, additionalTopsLabel: e.target.value }))} placeholder="e.g. Common area tops, Clubhouse tops…" />
                </div>
                {SSF('Material', 'additionalTops', COUNTERTOP_OPTIONS)}
                {specs.additionalTops && COUNTERTOP_MANUFACTURERS[specs.additionalTops] && (
                  <div className="space-y-2">
                    <div>
                      <label className={labelCls}>Vendor</label>
                      <select value={specs.additionalTopsManufacturer} className={subInputCls}
                        onChange={e => setSpecs(s => ({ ...s, additionalTopsManufacturer: e.target.value, additionalTopsManufacturerCustom: '' }))}>
                        <option value="">Select vendor…</option>
                        {COUNTERTOP_MANUFACTURERS[specs.additionalTops].map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    {specs.additionalTopsManufacturer === 'Other' && (
                      <input type="text" value={specs.additionalTopsManufacturerCustom} className={inputCls}
                        onChange={e => setSpecs(s => ({ ...s, additionalTopsManufacturerCustom: e.target.value }))} placeholder="Enter manufacturer name…" />
                    )}
                    {(specs.additionalTops === 'Quartz' || specs.additionalTops === 'Granite' || specs.additionalTops === 'Solid Surface- Corian') && (
                      <div>
                        <label className={labelCls}>Color</label>
                        <input type="text" value={specs.additionalTopsColor} className={inputCls}
                          onChange={e => setSpecs(s => ({ ...s, additionalTopsColor: e.target.value }))} placeholder="Enter color name…" />
                      </div>
                    )}
                    {specs.additionalTops === 'Laminate' && (
                      <div className="space-y-2">
                        <div>
                          <label className={labelCls}>Substrate</label>
                          <select value={specs.additionalTopsLaminateSubstrate} className={subInputCls}
                            onChange={e => setSpecs(s => ({ ...s, additionalTopsLaminateSubstrate: e.target.value, additionalTopsLaminateSubstrateCustom: '' }))}>
                            <option value="">Select substrate…</option>
                            <option value="Particleboard">Particleboard</option>
                            <option value="Plywood">Plywood</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        {specs.additionalTopsLaminateSubstrate === 'Other' && (
                          <input type="text" value={specs.additionalTopsLaminateSubstrateCustom} className={inputCls}
                            onChange={e => setSpecs(s => ({ ...s, additionalTopsLaminateSubstrateCustom: e.target.value }))} placeholder="Enter substrate type…" />
                        )}
                        <div>
                          <label className={labelCls}>Color</label>
                          <input type="text" value={specs.additionalTopsLaminateColor} className={inputCls}
                            onChange={e => setSpecs(s => ({ ...s, additionalTopsLaminateColor: e.target.value }))} placeholder="Enter color name…" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
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
                  onChange={e => setSpecs(s => ({ ...s, taxCustom: e.target.value }))} placeholder="Enter tax rate (e.g. 8.25%)" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
