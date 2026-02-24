import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, Trash2, Calendar, MapPin, ArrowRight, ChevronDown, ChevronRight } from 'lucide-react';
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
  const [introOpen, setIntroOpen] = useState(false);

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
              <h1 className="font-bold text-base leading-none text-foreground">cabinetcounters.com</h1>
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
          <div className="py-6 max-w-2xl mx-auto">
            <div className="text-center mb-6">
              <Link
                to="/new"
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md text-sm font-medium text-white"
                style={{ background: 'hsl(var(--primary))' }}
              >
                <Plus size={16} />
                Create Your First Project
              </Link>
            </div>

            <button
              onClick={() => setIntroOpen(!introOpen)}
              className="flex items-center gap-2 w-full est-card p-3 hover:shadow-md transition-shadow text-left"
            >
              {introOpen ? <ChevronDown size={16} className="text-primary" /> : <ChevronRight size={16} className="text-primary" />}
              <span className="font-semibold text-sm text-foreground">Introduction</span>
            </button>

            {introOpen && (
              <div className="mt-4 space-y-4">
                {/* Hero Section */}
                <div className="text-center py-6 px-4 rounded-xl" style={{ background: 'linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.02))' }}>
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm" style={{ background: 'hsl(var(--primary))' }}>
                    <Building2 size={30} className="text-white" />
                  </div>
                  <h2 className="text-2xl font-bold text-foreground mb-2">Welcome to cabinetcounters.com</h2>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto leading-relaxed">
                    The first software of its kind — fully automated cabinet & countertop estimating powered by AI. Upload your plans and get instant takeoffs.
                  </p>
                </div>

                {/* Core Capabilities */}
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 px-1">Core Capabilities</h3>
                  <div className="space-y-2">
                    <div className="est-card p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
                      <span className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shadow-sm" style={{ background: 'hsl(var(--primary))' }}>✓</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="font-semibold text-sm text-foreground">Auto-Extract Units & Unit Types</h3>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700">Live</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">Upload architect floor plans, shop drawings, or images — AI automatically detects and extracts all units and unit types. Zero manual selection required.</p>
                      </div>
                    </div>

                    <div className="est-card p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
                      <span className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shadow-sm bg-orange-500">⟳</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="font-semibold text-sm text-foreground">Cabinet & Countertop Calculations</h3>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700">Optimizing</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">Automatically calculates cabinet counts and countertop square footage from uploaded plans. Continuously improving accuracy with each update.</p>
                      </div>
                    </div>

                    <div className="est-card p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
                      <span className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shadow-sm" style={{ background: 'hsl(var(--primary))' }}>✓</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="font-semibold text-sm text-foreground">Extract SKUs from 2020 Shop Drawings</h3>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700">Live</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">Accurately extracts unit counts and cabinet SKUs from 2020 Design shop drawings — upload and let the system handle the rest.</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Why It's Different */}
                <div className="est-card p-5 border-l-4 rounded-r-xl" style={{ borderLeftColor: 'hsl(var(--primary))', background: 'hsl(var(--primary) / 0.03)' }}>
                  <h3 className="font-semibold text-sm text-foreground mb-2 flex items-center gap-2">
                    🌍 First of Its Kind
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    No other software offers fully automated AI-powered cabinet and countertop takeoffs. Traditional tools require you to manually select and trace every item on the plans.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg p-2.5 text-center" style={{ background: 'hsl(var(--primary) / 0.08)' }}>
                      <div className="text-lg font-bold text-primary">90%</div>
                      <div className="text-[10px] text-muted-foreground">Less Manual Effort</div>
                    </div>
                    <div className="rounded-lg p-2.5 text-center" style={{ background: 'hsl(var(--primary) / 0.08)' }}>
                      <div className="text-lg font-bold text-primary">10x</div>
                      <div className="text-[10px] text-muted-foreground">Faster Takeoffs</div>
                    </div>
                  </div>
                </div>

                {/* Getting Started */}
                <div className="est-card p-5 border-l-4 rounded-r-xl" style={{ borderLeftColor: 'hsl(var(--chart-2))' }}>
                  <h3 className="font-semibold text-sm text-foreground mb-3">🚀 Getting Started</h3>
                  <ol className="space-y-3 text-xs text-muted-foreground list-none">
                    <li className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-sm" style={{ background: 'hsl(var(--primary))' }}>1</span>
                      <div>
                        <strong className="text-foreground block mb-0.5">Create a Project</strong>
                        <span>Click "New Project" and enter the name, type (Residential / Commercial), and address.</span>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-sm" style={{ background: 'hsl(var(--primary))' }}>2</span>
                      <div>
                        <strong className="text-foreground block mb-0.5">Import Units from Plans</strong>
                        <span>Upload architect floor plans or images in the Units tab. AI auto-detects and extracts all units and unit types.</span>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-sm" style={{ background: 'hsl(var(--primary))' }}>3</span>
                      <div>
                        <strong className="text-foreground block mb-0.5">Import Cabinets & Countertops</strong>
                        <span>Upload shop drawings in the Cabinets and Countertops tabs to auto-extract SKUs, counts, and square footage.</span>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-sm" style={{ background: 'hsl(var(--primary))' }}>4</span>
                      <div>
                        <strong className="text-foreground block mb-0.5">Review & Export</strong>
                        <span>Check the Summary tab for a full overview, then export to PDF or Excel.</span>
                      </div>
                    </li>
                  </ol>
                </div>
              </div>
            )}
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
