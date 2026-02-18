import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Building2, ArrowLeft } from 'lucide-react';
import { useProjectStore } from '@/hooks/useProjectStore';
import type { ProjectType } from '@/types/project';

export default function NewProject() {
  const navigate = useNavigate();
  const { createProject } = useProjectStore();

  const [form, setForm] = useState({
    name: '',
    address: '',
    type: 'Residential' as ProjectType,
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Project name is required';
    return e;
  };

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    const project = createProject(form);
    navigate(`/project/${project.id}`);
  };

  const field = (label: string, key: keyof typeof form, type = 'text', placeholder = '') => (
    <div>
      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </label>
      <input
        type={type}
        value={form[key] as string}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        className={`w-full h-9 px-3 text-sm border rounded-md focus:outline-none focus:ring-2 ${
          errors[key] ? 'border-destructive' : 'border-border focus:ring-primary/30 focus:border-primary'
        } bg-card`}
      />
      {errors[key] && <p className="text-xs text-destructive mt-0.5">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'hsl(var(--primary))' }}>
            <Building2 size={18} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-base leading-none">CabinetTakeoff Pro</h1>
            <p className="text-xs text-muted-foreground">Kitchen & Countertop Estimating</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft size={14} />
          Back to Dashboard
        </Link>

        <div className="est-card">
          <div className="est-section-header">
            <Building2 size={15} />
            New Project Setup
          </div>
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {field('Project Name *', 'name', 'text', 'e.g. Maple Grove Apartments – Phase 1')}
            {field('Project Address', 'address', 'text', 'e.g. 1234 Oak St, Austin, TX 78701')}

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
                Notes
              </label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={3}
                placeholder="Project notes, special requirements..."
                className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary border-border bg-card resize-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Link
                to="/"
                className="px-4 py-2 rounded-md text-sm font-medium border border-border text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </Link>
              <button
                type="submit"
                className="px-5 py-2 rounded-md text-sm font-medium text-white transition-colors"
                style={{ background: 'hsl(var(--primary))' }}
              >
                Create Project →
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
