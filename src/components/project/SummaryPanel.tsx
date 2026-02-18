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
        {row('Total Cabinets', summary.totalCabinets)}
        {row('Base Cabinets', summary.totalBase)}
        {row('Wall Cabinets', summary.totalWall)}
        {row('Tall Cabinets', summary.totalTall)}
        {row('Unique SKUs', summary.skuSummary.length)}
      </div>

      <div className="text-xs font-bold uppercase tracking-widest mt-4 mb-2" style={{ color: 'hsl(var(--sidebar-primary))' }}>
        Countertops
      </div>

      <div className="rounded-lg p-3 text-center mb-3" style={{ background: 'hsl(var(--primary))' }}>
        <div className="text-2xl font-bold text-white">{summary.totalCountertopSqft.toFixed(1)}</div>
        <div className="text-xs text-white/70 font-medium">Total Sqft</div>
      </div>

      <div className="text-xs font-bold uppercase tracking-widest mt-4 mb-2" style={{ color: 'hsl(var(--sidebar-primary))' }}>
        Accessories
      </div>

      <div className="space-y-0">
        {row('Fillers', summary.accessorySummary.totalFillers)}
        {row('Panels', summary.accessorySummary.totalPanels)}
        {row('Toe Kick LF', summary.accessorySummary.totalToeKickLF.toFixed(1))}
        {row('Crown LF', summary.accessorySummary.totalCrownLF.toFixed(1))}
        {row('Light Rail LF', summary.accessorySummary.totalLightRailLF.toFixed(1))}
        {row('Hardware', summary.accessorySummary.totalHardware)}
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
