import { Link } from 'react-router-dom';
import { Building2, Plus, Trash2, Calendar, MapPin, LayoutGrid, ArrowRight } from 'lucide-react';
import { useProjectStore } from '@/hooks/useProjectStore';
import { calcProjectSummary } from '@/lib/calculations';
import type { Project } from '@/types/project';

function ProjectCard({ project, onDelete }: { project: Project; onDelete: (id: string) => void }) {
  const summary = calcProjectSummary(project);
  const updatedAt = new Date(project.updatedAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });

  return (
    <div className="est-card hover:shadow-md transition-shadow">
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                project.type === 'Commercial'
                  ? 'bg-purple-100 text-purple-700'
                  : 'bg-blue-100 text-blue-700'
              }`}>
                {project.type}
              </span>
            </div>
            <h3 className="font-semibold text-base text-foreground">{project.name}</h3>
            {project.address && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin size={11} />
                {project.address}
              </p>
            )}
          </div>
          <button
            onClick={(e) => { e.preventDefault(); onDelete(project.id); }}
            className="text-muted-foreground hover:text-destructive transition-colors p-1"
          >
            <Trash2 size={14} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="text-center py-2 rounded bg-secondary">
            <div className="text-lg font-bold text-primary">{summary.totalUnits}</div>
            <div className="text-xs text-muted-foreground">Units</div>
          </div>
          <div className="text-center py-2 rounded bg-secondary">
            <div className="text-lg font-bold text-primary">{summary.totalCabinets}</div>
            <div className="text-xs text-muted-foreground">Cabinets</div>
          </div>
          <div className="text-center py-2 rounded bg-secondary">
            <div className="text-lg font-bold text-primary">{summary.totalCountertopSqft}</div>
            <div className="text-xs text-muted-foreground">CT Sqft</div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Calendar size={11} />
            {updatedAt}
          </span>
          <Link
            to={`/project/${project.id}`}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Open <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { projects, deleteProject } = useProjectStore();

  const handleDelete = (id: string) => {
    if (window.confirm('Delete this project? This cannot be undone.')) {
      deleteProject(id);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Bar */}
      <header className="border-b bg-card shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'hsl(var(--primary))' }}>
              <Building2 size={18} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base leading-none text-foreground">CabinetTakeoff Pro</h1>
              <p className="text-xs text-muted-foreground">Kitchen & Countertop Estimating</p>
            </div>
          </div>
          <Link
            to="/new"
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white transition-colors"
            style={{ background: 'hsl(var(--primary))' }}
          >
            <Plus size={16} />
            New Project
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 flex-1 w-full">
        {/* Stats bar */}
        {projects.length > 0 && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="stat-card">
              <div className="stat-value">{projects.length}</div>
              <div className="stat-label">Total Projects</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {projects.reduce((s, p) => s + p.units.length, 0)}
              </div>
              <div className="stat-label">Total Units</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {projects.reduce((s, p) => s + calcProjectSummary(p).totalCabinets, 0)}
              </div>
              <div className="stat-label">Total Cabinets</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {projects.reduce((s, p) => s + calcProjectSummary(p).totalCountertopSqft, 0).toFixed(0)}
              </div>
              <div className="stat-label">Total CT Sqft</div>
            </div>
          </div>
        )}

        {/* Projects Grid */}
        {projects.length === 0 ? (
          <div className="py-12 max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'hsl(var(--primary) / 0.1)' }}>
                <Building2 size={28} style={{ color: 'hsl(var(--primary))' }} />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Welcome to CabinetTakeoff Pro</h2>
              <p className="text-muted-foreground text-sm">
                The first software of its kind — fully automated cabinet & countertop estimating powered by AI.
              </p>
            </div>

            <div className="space-y-3 mb-8">
              <div className="est-card p-4 flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'hsl(var(--primary))' }}>✓</span>
                <div>
                  <h3 className="font-semibold text-sm text-foreground">Auto-Extract Units & Unit Types from Plans</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Upload architect floor plans, shop drawings, or images — the system uses coding + AI to automatically detect and extract all units and unit types. No manual selection needed.</p>
                </div>
              </div>

              <div className="est-card p-4 flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white bg-orange-500">⟳</span>
                <div>
                  <h3 className="font-semibold text-sm text-foreground">Cabinet & Countertop Calculations</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Automatically calculates cabinet counts and countertop square footage by just uploading the plans. Working and continuously optimizing for accuracy.</p>
                </div>
              </div>

              <div className="est-card p-4 flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'hsl(var(--primary))' }}>✓</span>
                <div>
                  <h3 className="font-semibold text-sm text-foreground">Extract Cabinet SKUs from 2020 Shop Drawings</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Accurately extracts correct unit counts and cabinet SKUs from 2020 Design shop drawings — just upload and let the system handle the rest.</p>
                </div>
              </div>
            </div>

            <div className="est-card p-4 mb-8 border-l-4" style={{ borderLeftColor: 'hsl(var(--primary))' }}>
              <h3 className="font-semibold text-sm text-foreground mb-1">🌍 First of Its Kind in the World</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                No other software in the market offers fully automated AI-powered cabinet and countertop takeoffs. Existing tools are built for general construction takeoffs and require you to manually select and trace every item on the plans. CabinetTakeoff Pro is the first AI project purpose-built for cabinets & countertops — just upload your plans and the system does the rest, requiring far less human effort than anything else available.
              </p>
            </div>

            <div className="text-center">
              <Link
                to="/new"
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md text-sm font-medium text-white"
                style={{ background: 'hsl(var(--primary))' }}
              >
                <Plus size={16} />
                Create Your First Project
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-foreground">
                Projects <span className="text-muted-foreground font-normal">({projects.length})</span>
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map(p => (
                <ProjectCard key={p.id} project={p} onDelete={handleDelete} />
              ))}
            </div>
          </>
        )}
      </main>
      <footer className="text-center py-3 border-t">
        <span style={{ fontSize: '10px' }} className="text-muted-foreground">© {new Date().getFullYear()} Poojan Khilosiya. All rights reserved.</span>
      </footer>
    </div>
  );
}
