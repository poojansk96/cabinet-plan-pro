import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, Trash2, MapPin, ArrowRight, ChevronDown, ChevronRight, Search, Upload, AlertCircle, Clock, Pencil, HelpCircle, FileSpreadsheet } from 'lucide-react';
import { useProjectStore } from '@/hooks/useProjectStore';
import { calcProjectSummary } from '@/lib/calculations';
import type { Project } from '@/types/project';

function getProjectStatus(project: Project): { label: string; color: string; bg: string } {
  const summary = calcProjectSummary(project);
  if (summary.totalUnits === 0) return { label: 'Draft', color: 'text-muted-foreground', bg: 'bg-secondary' };
  if (summary.totalCabinets === 0 && summary.totalCountertopSqft === 0) return { label: 'Needs Cabinets', color: 'text-orange-700', bg: 'bg-orange-100' };
  if (summary.totalCountertopSqft === 0) return { label: 'Needs Countertops', color: 'text-amber-700', bg: 'bg-amber-100' };
  return { label: 'Complete', color: 'text-green-700', bg: 'bg-green-100' };
}

function getProjectProgress(project: Project): number {
  const summary = calcProjectSummary(project);
  let score = 0;
  if (summary.totalUnits > 0) score += 40;
  if (summary.totalCabinets > 0) score += 30;
  if (summary.totalCountertopSqft > 0) score += 30;
  return score;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function ProjectCard({ project, onDelete, onRename }: { project: Project; onDelete: (id: string) => void; onRename: (id: string) => void }) {
  const summary = calcProjectSummary(project);
  const status = getProjectStatus(project);
  const progress = getProjectProgress(project);
  const isEmpty = summary.totalUnits === 0 && summary.totalCabinets === 0 && summary.totalCountertopSqft === 0;

  return (
    <div className="est-card hover:shadow-md transition-shadow">
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                project.type === 'Commercial'
                  ? 'bg-purple-100 text-purple-700'
                  : 'bg-blue-100 text-blue-700'
              }`}>
                {project.type}
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${status.bg} ${status.color}`}>
                {status.label}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <h3 className="font-semibold text-sm text-foreground truncate">{project.name}</h3>
              <button
                onClick={(e) => { e.preventDefault(); onRename(project.id); }}
                className="text-muted-foreground hover:text-primary transition-colors p-0.5 flex-shrink-0 focus-visible:ring-2 focus-visible:ring-ring rounded"
                aria-label={`Rename project ${project.name}`}
              >
                <Pencil size={11} />
              </button>
            </div>
            {project.address && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                <MapPin size={10} />
                {project.address}
              </p>
            )}
          </div>
          <button
            onClick={(e) => { e.preventDefault(); onDelete(project.id); }}
            className="text-muted-foreground hover:text-destructive transition-colors p-1 flex-shrink-0 focus-visible:ring-2 focus-visible:ring-ring rounded"
            aria-label={`Delete project ${project.name}`}
          >
            <Trash2 size={13} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">Progress</span>
            <span className="text-[10px] font-medium text-foreground">{progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress}%`,
                background: progress === 100 ? 'hsl(142, 71%, 45%)' : 'hsl(var(--primary))'
              }}
            />
          </div>
        </div>

        {/* Conditional: show stats or empty-state CTA */}
        {isEmpty ? (
          <div className="flex items-center justify-center py-4 mb-3">
            <Link
              to={`/project/${project.id}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Plus size={14} />
              Start Measuring
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            <div className="text-center py-1.5 rounded bg-secondary">
              <div className="text-sm font-bold text-primary">{summary.totalUnits}</div>
              <div className="text-[10px] text-muted-foreground">Units</div>
            </div>
            <div className="text-center py-1.5 rounded bg-secondary">
              <div className="text-sm font-bold text-primary">{summary.totalCabinets}</div>
              <div className="text-[10px] text-muted-foreground">Cabinets</div>
            </div>
            <div className="text-center py-1.5 rounded bg-secondary">
              <div className="text-sm font-bold text-primary">{summary.totalCountertopSqft}</div>
              <div className="text-[10px] text-muted-foreground">CT Sqft</div>
            </div>
          </div>
        )}

        {/* Microcopy line */}
        <p className="text-[10px] text-muted-foreground/70 mb-2.5 flex items-center gap-1">
          <Clock size={10} />
          Updated {timeAgo(project.updatedAt)}
          {summary.totalUnits > 0 && <span>— {summary.totalUnits} unit{summary.totalUnits !== 1 ? 's' : ''} detected</span>}
        </p>

        <div className="flex items-center gap-2">
          <Link
            to={`/project/${project.id}`}
            className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-md text-xs font-semibold border-2 border-primary text-primary bg-transparent hover:bg-primary/5 transition-colors focus-visible:ring-2 focus-visible:ring-ring"
          >
            Continue Estimating <ArrowRight size={11} />
          </Link>
          <Link
            to={`/project/${project.id}`}
            className="inline-flex items-center justify-center gap-1 py-2 px-3 rounded-md text-xs font-medium border border-border text-foreground hover:bg-secondary transition-colors focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Upload plans to ${project.name}`}
          >
            <Upload size={11} /> Upload
          </Link>
        </div>
      </div>
    </div>
  );
}

/* Getting Started stepper for when all metrics are zero */
function GettingStartedStepper() {
  const steps = [
    { num: 1, title: 'Upload your first floor plan', icon: '📄' },
    { num: 2, title: 'Let AI detect units & types', icon: '🤖' },
    { num: 3, title: 'Import cabinets & countertops', icon: '⚙️' },
    { num: 4, title: 'Export your takeoff report', icon: '📊' },
  ];

  return (
    <div className="est-card p-4 mb-4">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Getting Started</h3>
      <div className="flex items-start gap-2 overflow-x-auto">
        {steps.map((step, i) => (
          <div key={step.num} className="flex items-center gap-2 flex-1 min-w-[140px]">
            <div className="flex flex-col items-center text-center flex-1">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg mb-1.5" style={{ background: 'hsl(var(--primary) / 0.1)' }}>
                {step.icon}
              </div>
              <span className="text-[10px] font-semibold text-primary">Step {step.num}</span>
              <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">{step.title}</span>
            </div>
            {i < steps.length - 1 && (
              <ArrowRight size={14} className="text-muted-foreground/40 flex-shrink-0 mt-3" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* Pro-Tips / Sample Template card */
function ProTipsCard() {
  return (
    <div className="est-card p-5 mt-6 border-l-4" style={{ borderLeftColor: 'hsl(var(--primary))', background: 'hsl(var(--primary) / 0.03)' }}>
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0" style={{ background: 'hsl(var(--primary) / 0.1)' }}>
          <FileSpreadsheet size={24} className="text-primary" />
        </div>
        <div className="flex-1">
          <h4 className="font-semibold text-sm text-foreground mb-1">📋 Pro Tip: What a finished estimate looks like</h4>
          <p className="text-xs text-muted-foreground leading-relaxed mb-2">
            A completed project includes units detected from floor plans, cabinet SKUs extracted from shop drawings, and countertop sqft calculated — all exported into a ready-to-bid Excel report with costing, pulls, and summary sheets.
          </p>
          <div className="flex gap-3">
            <div className="text-center px-3 py-1.5 rounded bg-secondary">
              <div className="text-xs font-bold text-primary">12</div>
              <div className="text-[9px] text-muted-foreground">Units</div>
            </div>
            <div className="text-center px-3 py-1.5 rounded bg-secondary">
              <div className="text-xs font-bold text-primary">86</div>
              <div className="text-[9px] text-muted-foreground">Cabinets</div>
            </div>
            <div className="text-center px-3 py-1.5 rounded bg-secondary">
              <div className="text-xs font-bold text-primary">340</div>
              <div className="text-[9px] text-muted-foreground">CT Sqft</div>
            </div>
            <div className="text-center px-3 py-1.5 rounded" style={{ background: 'hsl(142, 70%, 95%)' }}>
              <div className="text-xs font-bold" style={{ color: 'hsl(142, 70%, 35%)' }}>100%</div>
              <div className="text-[9px] text-muted-foreground">Complete</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { projects, deleteProject, updateProject } = useProjectStore();
  const [introOpen, setIntroOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [openFeature, setOpenFeature] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    if (window.confirm('Delete this project? This cannot be undone.')) {
      deleteProject(id);
    }
  };

  const handleRename = (id: string) => {
    const project = projects.find(p => p.id === id);
    if (!project) return;
    const newName = window.prompt('Rename project:', project.name);
    if (newName && newName.trim() && newName.trim() !== project.name) {
      updateProject(id, { name: newName.trim() });
    }
  };

  // Most recently updated project
  const lastProject = useMemo(() => {
    if (projects.length === 0) return null;
    return [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  }, [projects]);

  // Projects needing attention
  const needsAttention = useMemo(() => {
    return projects.filter(p => {
      const status = getProjectStatus(p);
      return status.label !== 'Complete';
    });
  }, [projects]);

  // Filtered projects
  const filteredProjects = useMemo(() => {
    let filtered = projects;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.address?.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') {
      filtered = filtered.filter(p => getProjectStatus(p).label === statusFilter);
    }
    return filtered;
  }, [projects, searchQuery, statusFilter]);

  // Check if all aggregate metrics are zero
  const allMetricsZero = useMemo(() => {
    const totalUnits = projects.reduce((s, p) => s + p.units.length, 0);
    const totalCabinets = projects.reduce((s, p) => s + calcProjectSummary(p).totalCabinets, 0);
    const totalCtSqft = projects.reduce((s, p) => s + calcProjectSummary(p).totalCountertopSqft, 0);
    return totalUnits === 0 && totalCabinets === 0 && totalCtSqft === 0;
  }, [projects]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Bar */}
      <header className="border-b bg-card sticky top-0 z-10" style={{ boxShadow: '0 1px 3px 0 hsl(var(--foreground) / 0.04)' }}>
        <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'hsl(var(--primary))' }}>
              <Building2 size={15} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-sm leading-none text-foreground">cabinetcounters.com</h1>
              <p className="text-[11px] text-muted-foreground">Kitchen & Countertop Estimating</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/new"
              className="hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90 transition-colors focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Upload Floor Plan"
            >
              <Upload size={14} />
              Upload Floor Plan
            </Link>
            <Link
              to="/new"
              className="md:hidden flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90 transition-colors focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Create new project"
            >
              <Plus size={16} />
              New Project
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 flex-1 w-full">
        {/* Stats bar OR Getting Started stepper */}
        {projects.length > 0 && (
          <>
            {allMetricsZero ? (
              <GettingStartedStepper />
            ) : (
              <div className="grid grid-cols-4 gap-4 mb-4">
                <div className="stat-card py-2">
                  <div className="stat-value text-base">{projects.length}</div>
                  <div className="stat-label">Total Projects</div>
                </div>
                <div className="stat-card py-2">
                  <div className="stat-value text-base">
                    {projects.reduce((s, p) => s + p.units.length, 0)}
                  </div>
                  <div className="stat-label">Total Units</div>
                </div>
                <div className="stat-card py-2">
                  <div className="stat-value text-base">
                    {projects.reduce((s, p) => s + calcProjectSummary(p).totalCabinets, 0)}
                  </div>
                  <div className="stat-label">Total Cabinets</div>
                </div>
                <div className="stat-card py-2">
                  <div className="stat-value text-base">
                    {projects.reduce((s, p) => s + calcProjectSummary(p).totalCountertopSqft, 0).toFixed(0)}
                  </div>
                  <div className="stat-label">Total CT Sqft</div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Projects Grid */}
        {projects.length === 0 ? (
          <div className="py-6 max-w-3xl mx-auto">
            {/* Hero Section — outcome-first */}
            <div className="text-center py-14 px-6 rounded-2xl mb-10" style={{ background: 'linear-gradient(145deg, hsl(var(--primary) / 0.14), hsl(var(--primary) / 0.06) 50%, hsl(var(--primary) / 0.02))' }}>
              <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4 leading-tight">
                Get accurate cabinet, countertop & appliance takeoffs in minutes.
              </h2>
              <p className="text-muted-foreground text-sm md:text-base max-w-xl mx-auto mb-2" style={{ lineHeight: '1.6' }}>
                Auto-detect units, cabinet SKUs, appliance counts and countertop sqft from plans and 2020 shop drawings — export ready Excel reports for costing, parts, and handles.
              </p>
              <p className="text-xs text-muted-foreground/70 mb-8 italic">
                Designed for multi-unit residential estimating workflows.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  to="/new"
                  className="inline-flex items-center gap-2.5 px-8 py-3.5 rounded-lg text-base font-bold text-white shadow-lg transition-all hover:shadow-xl hover:scale-[1.03]"
                  style={{ background: 'hsl(var(--primary))' }}
                >
                  <Upload size={18} />
                  Upload Floor Plan → Generate Takeoff
                </Link>
                <a
                   href="#demo"
                   className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium border border-border text-foreground hover:bg-secondary transition-colors"
                 >
                   ▶ Watch 60-Second Demo
                 </a>
               </div>
              <p className="text-[11px] text-muted-foreground/50 mt-5 max-w-md mx-auto" style={{ lineHeight: '1.5' }}>
                🔒 Plans are processed only to generate reports. Files are not stored and are never accessible to other users or developers.
              </p>
            </div>

            {/* Trust Row */}
            <div className="grid grid-cols-3 gap-4 mb-10">
              <div className="est-card p-4 text-center">
                <div className="text-2xl font-bold text-primary">300+</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Kitchens Estimated</div>
              </div>
              <div className="est-card p-4 text-center">
                <div className="text-2xl font-bold text-primary">90%</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Less Manual Counting</div>
              </div>
              <div className="est-card p-4 text-center">
                <div className="text-2xl font-bold text-primary">10×</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Faster Takeoffs</div>
              </div>
            </div>

            {/* Product Flow Visual */}
            <div className="est-card p-6 mb-10 text-center" style={{ background: 'hsl(var(--primary) / 0.03)' }}>
              <div className="flex items-center justify-center gap-4 flex-wrap">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl" style={{ background: 'hsl(var(--primary) / 0.10)' }}>📄</div>
                  <span className="text-xs text-muted-foreground font-medium">Upload PDF</span>
                </div>
                <ArrowRight size={24} className="text-primary" />
                <div className="flex flex-col items-center gap-2">
                  <div className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl" style={{ background: 'hsl(var(--primary) / 0.10)' }}>⚙️</div>
                  <span className="text-xs text-muted-foreground font-medium">Custom Takeoff Engine</span>
                </div>
                <ArrowRight size={24} className="text-primary" />
                <div className="flex flex-col items-center gap-2">
                  <div className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl" style={{ background: 'hsl(var(--primary) / 0.10)' }}>🤖</div>
                  <span className="text-xs text-muted-foreground font-medium">AI Detects</span>
                </div>
                <ArrowRight size={24} className="text-primary" />
                <div className="flex flex-col items-center gap-2">
                  <div className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl" style={{ background: 'hsl(var(--primary) / 0.10)' }}>📊</div>
                  <span className="text-xs text-muted-foreground font-medium">Full Takeoff</span>
                </div>
              </div>
            </div>

            {/* Repeated primary CTA */}
            <div className="text-center mb-10">
              <Link
                to="/new"
                className="inline-flex items-center gap-2.5 px-8 py-3.5 rounded-lg text-base font-bold text-white shadow-lg transition-all hover:shadow-xl hover:scale-[1.03]"
                style={{ background: 'hsl(var(--primary))' }}
              >
                <Upload size={18} />
                Upload Floor Plan → Generate Takeoff
              </Link>
            </div>

            {/* Benefit-first Feature Accordions */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 px-1">What You Get</h3>
              <div className="space-y-2">
                {/* Estimating */}
                <button
                  onClick={() => setOpenFeature(openFeature === 'estimating' ? null : 'estimating')}
                  className="w-full est-card p-4 flex items-start gap-3 hover:shadow-md transition-shadow text-left"
                >
                  <span className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shadow-sm" style={{ background: 'hsl(var(--primary))' }}>✓</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm text-foreground">Estimating Output (Excel)</h3>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: 'hsl(142, 71%, 95%)', color: 'hsl(142, 71%, 30%)' }}>Live</span>
                      <ChevronDown size={14} className={`ml-auto text-muted-foreground transition-transform ${openFeature === 'estimating' ? 'rotate-180' : ''}`} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Auto-detect every unit, floor type & building. Calculate cabinet quantities and countertop sqft instantly.</p>
                  </div>
                </button>
                {openFeature === 'estimating' && (
                  <div className="est-card p-4 ml-11 border-l-2 animate-fade-in" style={{ borderLeftColor: 'hsl(var(--primary))' }}>
                    <ul className="text-xs text-muted-foreground leading-relaxed space-y-1">
                      <li>• Save time — no manual counting</li>
                      <li>• Works with scanned plans & images</li>
                      <li>• Zero manual selection required</li>
                      <li>• Cut errors — AI-verified calculations</li>
                      <li>• Bid faster with instant results</li>
                      <li>• Continuously improving accuracy</li>
                    </ul>
                  </div>
                )}

                {/* Shop Drawing SKU Extraction */}
                <button
                  onClick={() => setOpenFeature(openFeature === 'sku' ? null : 'sku')}
                  className="w-full est-card p-4 flex items-start gap-3 hover:shadow-md transition-shadow text-left"
                >
                  <span className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shadow-sm" style={{ background: 'hsl(var(--primary))' }}>✓</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm text-foreground">Shop Drawing SKU Extraction</h3>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: 'hsl(142, 71%, 95%)', color: 'hsl(142, 71%, 30%)' }}>Live</span>
                      <ChevronDown size={14} className={`ml-auto text-muted-foreground transition-transform ${openFeature === 'sku' ? 'rotate-180' : ''}`} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Extract units & cabinet SKUs directly from 2020 shop drawings with auto Excel generation.</p>
                  </div>
                </button>
                {openFeature === 'sku' && (
                  <div className="est-card p-4 ml-11 border-l-2 animate-fade-in" style={{ borderLeftColor: 'hsl(var(--primary))' }}>
                    <ul className="text-xs text-muted-foreground leading-relaxed space-y-1">
                      <li>• Upload shop drawings, get SKU lists</li>
                      <li>• Handles complex multi-page PDFs</li>
                      <li>• Accurate even with scanned drawings</li>
                      <li>• Auto-generates Excel for pulls, costing, and total cabinet counts by type with formulas</li>
                    </ul>
                  </div>
                )}

                {/* Appliance & appliance counts — muted roadmap item */}
                <div className="rounded-lg border border-dashed border-border/50 p-3 flex items-center gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-[10px] bg-muted text-muted-foreground">⚡</span>
                  <div className="flex items-center gap-2 flex-1">
                    <h3 className="font-medium text-xs text-muted-foreground/70">Appliance & Appliance Counts</h3>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-muted text-muted-foreground/60 tracking-wide uppercase">Beta</span>
                  </div>
                </div>

                <div className="est-card p-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    Developed by Poojan K. — for any queries, email at{' '}
                    <a href="mailto:poojansk96@gmail.com" className="text-primary font-semibold hover:underline">
                      poojansk96@gmail.com
                    </a>
                  </p>
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
            {/* Welcome line + resume action */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="font-semibold text-foreground text-lg">Your Projects</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {projects.length} project{projects.length !== 1 ? 's' : ''}
                  {lastProject && <> · Last worked on <strong className="text-foreground">{lastProject.name}</strong></>}
                </p>
              </div>
              {lastProject && (
                <Link
                  to={`/project/${lastProject.id}`}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium text-white transition-colors shadow-sm"
                  style={{ background: 'hsl(var(--primary))' }}
                >
                  <ArrowRight size={13} />
                  Resume "{lastProject.name}"
                </Link>
              )}
            </div>

            {/* Needs Attention Panel — dynamic per-project message */}
            {needsAttention.length > 0 && (
              <div className="est-card p-3.5 mb-4 border-l-4" style={{ borderLeftColor: 'hsl(35, 92%, 50%)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle size={14} className="text-amber-600" />
                  <span className="text-xs font-semibold text-foreground">
                    {needsAttention.length === 1
                      ? `${needsAttention[0].name} is ${getProjectProgress(needsAttention[0])}% complete. Continue estimating to finish your quote.`
                      : `${needsAttention.length} projects need attention. Continue estimating to finish your quotes.`
                    }
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {needsAttention.slice(0, 5).map(p => {
                    const st = getProjectStatus(p);
                    const prog = getProjectProgress(p);
                    return (
                      <Link key={p.id} to={`/project/${p.id}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border border-border hover:bg-secondary transition-colors"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${st.label === 'Draft' ? 'bg-muted-foreground' : 'bg-amber-500'}`} />
                        {p.name}
                        <span className="text-muted-foreground">· {prog}%</span>
                      </Link>
                    );
                  })}
                  {needsAttention.length > 5 && (
                    <span className="text-[11px] text-muted-foreground self-center">+{needsAttention.length - 5} more</span>
                  )}
                </div>
              </div>
            )}

            {/* Search + Filters — single compact row */}
            <div className="flex items-center gap-2 mb-4">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search projects…"
                  className="w-full h-8 pl-9 pr-3 text-xs border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
                />
              </div>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="h-8 px-2 text-xs border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-card"
              >
                <option value="all">All Status</option>
                <option value="Draft">Draft</option>
                <option value="Needs Cabinets">Needs Cabinets</option>
                <option value="Needs Countertops">Needs Countertops</option>
                <option value="Complete">Complete</option>
              </select>
            </div>

            {/* Project Cards Grid */}
            {filteredProjects.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">
                No projects match your search.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredProjects.map(p => (
                  <ProjectCard key={p.id} project={p} onDelete={handleDelete} onRename={handleRename} />
                ))}
              </div>
            )}

            {/* Pro-Tips card below project list */}
            <ProTipsCard />
          </>
        )}
      </main>

      {/* Floating Help Button */}
      <button
        className="fixed bottom-6 right-6 w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-primary-foreground z-50 hover:scale-110 transition-transform"
        style={{ background: 'hsl(var(--primary))' }}
        onClick={() => window.open('mailto:poojansk96@gmail.com', '_blank')}
        aria-label="Help & Support"
      >
        <HelpCircle size={22} />
      </button>

      <footer className="text-center py-3 border-t">
        <span style={{ fontSize: '10px' }} className="text-muted-foreground">© {new Date().getFullYear()} Poojan K. All rights reserved.</span>
      </footer>
    </div>
  );
}
