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
            <div className="text-lg font-bold text-primary">{summary.totalCountertopSqft.toFixed(1)}</div>
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
          <div className="text-center py-20">
            <LayoutGrid size={48} className="mx-auto mb-4 text-muted-foreground opacity-30" />
            <h2 className="text-xl font-semibold text-foreground mb-2">No Projects Yet</h2>
            <p className="text-muted-foreground mb-6 text-sm">
              Create your first project to start estimating cabinets and countertops.
            </p>
            <Link
              to="/new"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md text-sm font-medium text-white"
              style={{ background: 'hsl(var(--primary))' }}
            >
              <Plus size={16} />
              Create First Project
            </Link>
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
