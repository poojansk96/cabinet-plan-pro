import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Building2, ArrowLeft, Users, Layers, Wrench, Square, BarChart3, Pencil, ClipboardCheck, FileUp, X } from 'lucide-react';
import { useProjectStore } from '@/hooks/useProjectStore';
import UnitModule from '@/components/project/UnitModule';
import CabinetModule from '@/components/project/CabinetModule';
import AccessoriesModule from '@/components/project/AccessoriesModule';
import CountertopModule from '@/components/project/CountertopModule';
import SummaryModule from '@/components/project/SummaryModule';
import PreFinalModule from '@/components/project/PreFinalModule';
import PreFinalSummaryModule from '@/components/project/PreFinalSummaryModule';
import SummaryPanel from '@/components/project/SummaryPanel';
import EditProjectDialog from '@/components/project/EditProjectDialog';

type Tab = 'units' | 'cabinets' | 'accessories' | 'countertops' | 'summary' | 'prefinal-units' | 'prefinal-summary';

const TAKEOFF_TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'units', label: 'Units', icon: <Users size={14} /> },
  { key: 'cabinets', label: 'Cabinets', icon: <Layers size={14} /> },
  { key: 'accessories', label: 'Accessories', icon: <Wrench size={14} /> },
  { key: 'countertops', label: 'Countertops', icon: <Square size={14} /> },
  { key: 'summary', label: 'Summary', icon: <BarChart3 size={14} /> },
];

const PREFINAL_TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'prefinal-units', label: 'Pre-Final', icon: <ClipboardCheck size={14} /> },
  { key: 'prefinal-summary', label: 'Summary', icon: <BarChart3 size={14} /> },
];

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getProject, updateProject, ...store } = useProjectStore();
  const [activeTab, setActiveTab] = useState<Tab>('units');
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showTour, setShowTour] = useState(false);

  // First-run tour: show once per project
  useEffect(() => {
    if (!id) return;
    const key = `tour-shown-${id}`;
    if (!localStorage.getItem(key)) {
      setShowTour(true);
      localStorage.setItem(key, '1');
    }
  }, [id]);

  const project = id ? getProject(id) : undefined;

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Project not found.</p>
          <Link to="/" className="text-primary hover:underline">Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  const selectedUnit = selectedUnitId
    ? project.units.find(u => u.id === selectedUnitId) ?? project.units[0]
    : project.units[0];

  const storeProps = {
    project,
    selectedUnit,
    selectedUnitId: selectedUnit?.id ?? null,
    setSelectedUnitId,
    ...store,
  };

  return (
    <div
      className="min-h-screen bg-background flex flex-col relative"
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={e => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
      onDrop={e => { e.preventDefault(); setIsDragging(false); }}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'hsl(var(--primary) / 0.12)', backdropFilter: 'blur(4px)' }}>
          <div className="text-center p-8 rounded-2xl border-2 border-dashed" style={{ borderColor: 'hsl(var(--primary))' }}>
            <FileUp size={48} className="mx-auto mb-3 text-primary animate-bounce" />
            <h3 className="text-lg font-bold text-foreground mb-1">Drop your PDF here</h3>
            <p className="text-sm text-muted-foreground">We'll auto-detect units, cabinets, and countertops</p>
          </div>
        </div>
      )}

      {/* First-run tour overlay */}
      {showTour && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-card rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 relative">
            <button onClick={() => setShowTour(false)} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground">
              <X size={18} />
            </button>
            <h3 className="text-lg font-bold text-foreground mb-1">Welcome to your project! 🎉</h3>
            <p className="text-sm text-muted-foreground mb-5">Here's how to get your takeoff done in 3 easy steps:</p>
            <div className="space-y-4 mb-6">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'hsl(var(--primary))' }}>1</span>
                <div>
                  <strong className="text-sm text-foreground">Upload your PDF plans</strong>
                  <p className="text-xs text-muted-foreground">Click "Import from PDF" in the Units tab or drag a PDF onto this page.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'hsl(var(--primary))' }}>2</span>
                <div>
                  <strong className="text-sm text-foreground">Review detected units & cabinets</strong>
                  <p className="text-xs text-muted-foreground">AI extracts units, cabinet SKUs, and countertop dimensions automatically.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'hsl(var(--primary))' }}>3</span>
                <div>
                  <strong className="text-sm text-foreground">Export your takeoff</strong>
                  <p className="text-xs text-muted-foreground">Review the Summary tab and export to PDF or Excel.</p>
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowTour(false)}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
              style={{ background: 'hsl(var(--primary))' }}
            >
              Got it — Let's start!
            </button>
          </div>
        </div>
      )}

      {showEdit && (
        <EditProjectDialog
          project={project}
          onSave={(updates) => updateProject(project.id, updates)}
          onClose={() => setShowEdit(false)}
        />
      )}
      {/* Header — slim */}
      <header className="border-b bg-card sticky top-0 z-20" style={{ boxShadow: '0 1px 3px 0 hsl(var(--foreground) / 0.04)' }}>
        <div className="px-4 py-1.5 flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground" aria-label="Back to dashboard">
            <ArrowLeft size={16} />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${
                project.type === 'Commercial' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
              }`}>{project.type}</span>
              <h1 className="font-bold text-sm truncate">{project.name}</h1>
              {project.address && <span className="text-xs text-muted-foreground hidden md:block truncate">— {project.address}</span>}
            </div>
          </div>
          <div className="text-xs text-muted-foreground hidden sm:block flex-shrink-0">
            {project.units.length} unit{project.units.length !== 1 ? 's' : ''}
          </div>
          <button
            onClick={() => setShowEdit(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors flex-shrink-0 focus-visible:ring-2 focus-visible:ring-ring"
            title="Edit project details"
            aria-label="Edit project details"
          >
            <Pencil size={12} />
            Edit
          </button>
        </div>

        {/* Tabs */}
        <div className="px-4 flex items-end gap-0 overflow-x-auto">
          <div className="flex flex-col">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground px-1 pt-1">Takeoff</span>
            <div className="flex">
              {TAKEOFF_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`module-tab flex items-center gap-1.5 mr-1 ${activeTab === tab.key ? 'active' : ''}`}
                  aria-selected={activeTab === tab.key}
                  role="tab"
                >
                  {tab.icon}
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="w-px my-1 mx-4 bg-border flex-shrink-0 self-stretch" />
          <div className="flex flex-col">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground px-1 pt-1">Prefinal</span>
            <div className="flex">
              {PREFINAL_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`module-tab flex items-center gap-1.5 mr-1 ${activeTab === tab.key ? 'active' : ''}`}
                  aria-selected={activeTab === tab.key}
                  role="tab"
                >
                  {tab.icon}
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-auto">
          <div className="p-4">
            {activeTab === 'units' && <UnitModule {...storeProps} />}
            {activeTab === 'cabinets' && <CabinetModule {...storeProps} />}
            {activeTab === 'accessories' && <AccessoriesModule {...storeProps} />}
            {activeTab === 'countertops' && <CountertopModule {...storeProps} />}
            {activeTab === 'summary' && <SummaryModule {...storeProps} />}
            {activeTab === 'prefinal-units' && <PreFinalModule key="prefinal" {...storeProps} />}
            {activeTab === 'prefinal-summary' && <PreFinalSummaryModule {...storeProps} />}
          </div>
        </main>

        {/* Summary Panel — light, consistent */}
        {!activeTab.startsWith('prefinal') && (
          <aside className="w-56 flex-shrink-0 hidden lg:block overflow-auto border-l" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--panel-bg))' }}>
            <SummaryPanel project={project} activeTab={activeTab} onTabChange={(tab) => setActiveTab(tab as Tab)} />
          </aside>
        )}
      </div>
      <footer className="text-center py-2 border-t bg-card flex-shrink-0">
        <span style={{ fontSize: '10px' }} className="text-muted-foreground">© {new Date().getFullYear()} Poojan K. All rights reserved.</span>
      </footer>
    </div>
  );
}
