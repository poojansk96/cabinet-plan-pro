import type { Project } from '@/types/project';
import { calcProjectSummary } from '@/lib/calculations';

interface Props {
  project: Project;
  onTabChange?: (tab: string) => void;
}

export default function SummaryPanel({ project }: Props) {
  const summary = calcProjectSummary(project);

  const row = (label: string, value: string | number) => (
    <div key={label} className="flex justify-between items-center py-1.5 border-b" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
      <span className="text-xs" style={{ color: 'hsl(var(--panel-fg))' }}>{label}</span>
      <span className="text-sm font-bold" style={{ color: 'hsl(var(--panel-accent))' }}>{value}</span>
    </div>
  );

  return (
    <div className="p-4 h-full">
      <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'hsl(var(--sidebar-primary))' }}>
        Project Totals
      </div>

      <div className="space-y-0">
        {row('Units', summary.totalUnits)}
      </div>

      {Object.keys(summary.unitsByType).length > 0 && (
        <>
          <div className="text-xs font-bold uppercase tracking-widest mt-4 mb-2" style={{ color: 'hsl(var(--sidebar-primary))' }}>
            By Unit Type
          </div>
          <div className="space-y-0">
            {Object.entries(summary.unitsByType).map(([type, count]) =>
              row(type, count)
            )}
          </div>
        </>
      )}
    </div>
  );
}
