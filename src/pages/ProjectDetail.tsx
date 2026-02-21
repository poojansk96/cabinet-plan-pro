import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Building2, ArrowLeft, Users, Layers, Wrench, Square, BarChart3, Pencil, ClipboardCheck } from 'lucide-react';
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

type Tab = 'units' | 'cabinets' | 'accessories' | 'countertops' | 'summary' | 'prefinal-units' | 'prefinal-cabinets' | 'prefinal-summary';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'units', label: 'Units', icon: <Users size={14} /> },
  { key: 'cabinets', label: 'Cabinets', icon: <Layers size={14} /> },
  { key: 'accessories', label: 'Accessories', icon: <Wrench size={14} /> },
  { key: 'countertops', label: 'Countertops', icon: <Square size={14} /> },
  { key: 'summary', label: 'Summary', icon: <BarChart3 size={14} /> },
  { key: 'prefinal-units', label: 'Pre-Final Unit Count', icon: <ClipboardCheck size={14} /> },
  { key: 'prefinal-cabinets', label: 'Pre-Final Cabinet Count', icon: <ClipboardCheck size={14} /> },
  { key: 'prefinal-summary', label: 'Pre-Final Summary', icon: <BarChart3 size={14} /> },
];

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getProject, updateProject, ...store } = useProjectStore();
  const [activeTab, setActiveTab] = useState<Tab>('units');
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);

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
    <div className="min-h-screen bg-background flex flex-col">
      {showEdit && (
        <EditProjectDialog
          project={project}
          onSave={(updates) => updateProject(project.id, updates)}
          onClose={() => setShowEdit(false)}
        />
      )}
      {/* Header */}
      <header className="border-b bg-card shadow-sm sticky top-0 z-20">
        <div className="px-4 py-2 flex items-center gap-3">
          <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'hsl(var(--primary))' }}>
            <Building2 size={15} className="text-white" />
          </div>
          <Link to="/" className="text-muted-foreground hover:text-foreground">
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors flex-shrink-0"
            title="Edit project details"
          >
            <Pencil size={12} />
            Edit Details
          </button>
        </div>

        {/* Tabs */}
        <div className="px-4 flex border-t" style={{ borderColor: 'hsl(var(--border))' }}>
          {TABS.map((tab) => (
            <>
              {tab.key === 'prefinal-units' && (
                <div key="sep" className="w-px my-1 mx-12 bg-border flex-shrink-0" />
              )}
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`module-tab flex items-center gap-1.5 mr-1 ${activeTab === tab.key ? 'active' : ''}`}
              >
                {tab.icon}
                {tab.label}
              </button>
            </>
          ))}
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
            {activeTab === 'prefinal-units' && <PreFinalModule {...storeProps} section="units" />}
            {activeTab === 'prefinal-cabinets' && <PreFinalModule {...storeProps} section="cabinets" />}
            {activeTab === 'prefinal-summary' && <PreFinalSummaryModule {...storeProps} />}
          </div>
        </main>

        {/* Sticky Summary Panel — hidden on Pre-Final tabs */}
        {!activeTab.startsWith('prefinal') && (
          <aside className="w-56 flex-shrink-0 hidden lg:block summary-panel overflow-auto">
            <SummaryPanel project={project} onTabChange={(tab) => setActiveTab(tab as Tab)} />
          </aside>
        )}
      </div>
      <footer className="text-center py-2 border-t bg-card flex-shrink-0">
        <span style={{ fontSize: '10px' }} className="text-muted-foreground">© {new Date().getFullYear()} Poojan Khilosiya. All rights reserved.</span>
      </footer>
    </div>
  );
}
