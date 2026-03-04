import { Link } from 'react-router-dom';
import type { Project } from '@/types/project';
import { calcProjectSummary } from '@/lib/calculations';

interface Props {
  project: Project;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

export default function SummaryPanel({ project, activeTab }: Props) {
  const summary = calcProjectSummary(project);
  const isUnitsTab = activeTab === 'units';
  const isCountertopsTab = activeTab === 'countertops';
  const hideCabinets = isUnitsTab || isCountertopsTab;
  const hideAccessories = isUnitsTab || isCountertopsTab;

  // Accuracy / progress score
  const hasUnits = summary.totalUnits > 0;
  const hasCabinets = summary.totalCabinets > 0;
  const hasCountertops = summary.totalCountertopSqft > 0;
  const completedSteps = [hasUnits, hasCabinets, hasCountertops].filter(Boolean).length;
  const accuracyScore = Math.round((completedSteps / 3) * 100);

  const row = (label: string, value: string | number) => (
    <div key={label} className="flex justify-between items-center py-1.5 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-bold text-primary">{value}</span>
    </div>
  );

  return (
    <div className="p-4 h-full">
      {/* Quick Insights */}
      <div className="rounded-lg p-3 mb-4 border" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--accent))' }}>
        <div className="text-[10px] font-bold uppercase tracking-widest mb-2 text-primary">
          Completion
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'hsl(var(--border))' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${accuracyScore}%`,
                background: accuracyScore === 100 ? 'hsl(142, 71%, 45%)' : 'hsl(var(--primary))'
              }}
            />
          </div>
          <span className="text-xs font-bold text-primary">{accuracyScore}%</span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: hasUnits ? 'hsl(142, 71%, 35%)' : undefined }}>
            <span>{hasUnits ? '✓' : '○'}</span>
            <span className={hasUnits ? '' : 'text-muted-foreground'}>{hasUnits ? `${summary.totalUnits} units detected` : 'Upload plans to detect units'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: hasCabinets ? 'hsl(142, 71%, 35%)' : undefined }}>
            <span>{hasCabinets ? '✓' : '○'}</span>
            <span className={hasCabinets ? '' : 'text-muted-foreground'}>{hasCabinets ? `${summary.totalCabinets} cabinets` : 'Import cabinet data'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: hasCountertops ? 'hsl(142, 71%, 35%)' : undefined }}>
            <span>{hasCountertops ? '✓' : '○'}</span>
            <span className={hasCountertops ? '' : 'text-muted-foreground'}>{hasCountertops ? `${summary.totalCountertopSqft} sqft countertops` : 'Add countertop data'}</span>
          </div>
        </div>
      </div>

      <div className="text-xs font-bold uppercase tracking-widest mb-3 text-primary">
        Project Totals
      </div>

      <div className="space-y-0">
        {row('Units', summary.totalUnits)}
        {!hideCabinets && row('Total Cabinets', summary.totalCabinets)}
        {!hideCabinets && row('Base Cabinets', summary.totalBase)}
        {!hideCabinets && row('Wall Cabinets', summary.totalWall)}
        {!hideCabinets && row('Tall Cabinets', summary.totalTall)}
        {!hideCabinets && row('Unique SKUs', summary.skuSummary.length)}
      </div>

      {!isUnitsTab && (
        <>
          <div className="text-xs font-bold uppercase tracking-widest mt-4 mb-2 text-primary">
            Countertops
          </div>
          <div className="rounded-lg p-3 text-center mb-3" style={{ background: 'hsl(var(--primary))' }}>
            <div className="text-2xl font-bold text-white">{summary.totalCountertopSqft}</div>
            <div className="text-xs text-white/70 font-medium">Total Sqft</div>
          </div>
        </>
      )}

      {!hideAccessories && (
        <>
          <div className="text-xs font-bold uppercase tracking-widest mt-4 mb-2 text-primary">
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
        </>
      )}

      {Object.keys(summary.unitsByType).length > 0 && (
        <>
          <div className="text-xs font-bold uppercase tracking-widest mt-4 mb-2 text-primary">
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
