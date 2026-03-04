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
          <div className="py-6 max-w-3xl mx-auto">
            {/* Hero Section — outcome-first */}
            <div className="text-center py-10 px-6 rounded-2xl mb-6" style={{ background: 'linear-gradient(135deg, hsl(var(--primary) / 0.10), hsl(var(--primary) / 0.03))' }}>
              <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-3 leading-tight">
                Get accurate cabinet & countertop takeoffs in minutes.
              </h2>
              <p className="text-muted-foreground text-sm md:text-base max-w-lg mx-auto leading-relaxed mb-6">
                Upload plans — we auto-detect units, cabinets, and square feet so you can bid faster.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  to="/new"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all"
                  style={{ background: 'hsl(var(--primary))' }}
                >
                  <Plus size={16} />
                  Upload a Plan — Get a Free Takeoff
                </Link>
                <a
                  href="#demo"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium border border-border text-foreground hover:bg-secondary transition-colors"
                >
                  ▶ See a 60-sec Demo
                </a>
              </div>
            </div>

            {/* Trust Row */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="est-card p-4 text-center">
                <div className="text-2xl font-bold text-primary">500+</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Projects Processed</div>
              </div>
              <div className="est-card p-4 text-center">
                <div className="text-2xl font-bold text-primary">90%</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Less Manual Effort</div>
              </div>
              <div className="est-card p-4 text-center">
                <div className="text-2xl font-bold text-primary">10x</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Faster Than Traditional Tools</div>
              </div>
            </div>

            {/* Product Flow Visual */}
            <div className="est-card p-5 mb-6 text-center" style={{ background: 'hsl(var(--primary) / 0.03)' }}>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <div className="flex flex-col items-center gap-1.5">
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl" style={{ background: 'hsl(var(--primary) / 0.10)' }}>📄</div>
                  <span className="text-[11px] text-muted-foreground font-medium">Upload PDF</span>
                </div>
                <ArrowRight size={20} className="text-primary" />
                <div className="flex flex-col items-center gap-1.5">
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl" style={{ background: 'hsl(var(--primary) / 0.10)' }}>🤖</div>
                  <span className="text-[11px] text-muted-foreground font-medium">AI Extracts</span>
                </div>
                <ArrowRight size={20} className="text-primary" />
                <div className="flex flex-col items-center gap-1.5">
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl" style={{ background: 'hsl(var(--primary) / 0.10)' }}>📊</div>
                  <span className="text-[11px] text-muted-foreground font-medium">Full Takeoff</span>
                </div>
              </div>
            </div>

            {/* Benefit-first Feature Cards */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 px-1">What You Get</h3>
              <div className="space-y-2">
                <div className="est-card p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
                  <span className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shadow-sm" style={{ background: 'hsl(var(--primary))' }}>✓</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="font-semibold text-sm text-foreground">Find every unit in your plans automatically</h3>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700">Live</span>
                    </div>
                    <ul className="text-xs text-muted-foreground leading-relaxed space-y-0.5 mt-1">
                      <li>• Save time — no manual counting</li>
                      <li>• Works with scanned plans & images</li>
                      <li>• Zero manual selection required</li>
                    </ul>
                  </div>
                </div>

                <div className="est-card p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
                  <span className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shadow-sm bg-orange-500">⟳</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="font-semibold text-sm text-foreground">Get cabinet counts & countertop sqft instantly</h3>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700">Optimizing</span>
                    </div>
                    <ul className="text-xs text-muted-foreground leading-relaxed space-y-0.5 mt-1">
                      <li>• Cut errors — AI-verified calculations</li>
                      <li>• Bid faster with instant results</li>
                      <li>• Continuously improving accuracy</li>
                    </ul>
                  </div>
                </div>

                <div className="est-card p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
                  <span className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shadow-sm" style={{ background: 'hsl(var(--primary))' }}>✓</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="font-semibold text-sm text-foreground">Extract SKUs from 2020 Shop Drawings</h3>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700">Live</span>
                    </div>
                    <ul className="text-xs text-muted-foreground leading-relaxed space-y-0.5 mt-1">
                      <li>• Upload shop drawings, get SKU lists</li>
                      <li>• Handles complex multi-page PDFs</li>
                      <li>• Accurate even with scanned drawings</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Getting Started — collapsed */}
            <div className="mt-4">
              <button
                onClick={() => setIntroOpen(!introOpen)}
                className="flex items-center gap-2 w-full est-card p-3 hover:shadow-md transition-shadow text-left"
              >
                {introOpen ? <ChevronDown size={16} className="text-primary" /> : <ChevronRight size={16} className="text-primary" />}
                <span className="font-semibold text-sm text-foreground">🚀 Getting Started</span>
              </button>

              {introOpen && (
                <div className="est-card mt-2 p-5 border-l-4 rounded-r-xl" style={{ borderLeftColor: 'hsl(var(--chart-2))' }}>
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
              )}
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
        <span style={{ fontSize: '10px' }} className="text-muted-foreground">© {new Date().getFullYear()} PK. All rights reserved.</span>
      </footer>
    </div>
  );
}
