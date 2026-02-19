import { useState } from 'react';
import { BarChart3, Download, FileText, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { Project, Unit } from '@/types/project';
import { calcProjectSummary, calcUnitCabinetTotals, calcUnitCountertopTotal } from '@/lib/calculations';
import { exportProjectPDF } from '@/lib/exportPDF';

interface Props {
  project: Project;
  selectedUnit?: Unit;
  selectedUnitId?: string | null;
  setSelectedUnitId?: (id: string) => void;
}

export default function SummaryModule({ project }: Props) {
  const summary = calcProjectSummary(project);
  const [pdfLoading, setPdfLoading] = useState(false);

  const handleExportPDF = async () => {
    setPdfLoading(true);
    try {
      await new Promise(r => setTimeout(r, 80));
      exportProjectPDF(project);
    } finally {
      setPdfLoading(false);
    }
  };

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Project Info ──────────────────────────────────────
    const infoRows: (string | number)[][] = [
      ['Field', 'Value'],
      ['Project Name', project.name],
      ['Address', project.address],
      ['Type', project.type],
      ['Notes', project.notes || ''],
      [],
      ['Specifications', ''],
      ['Project Super', project.specs?.projectSuper || ''],
      ['Customer', project.specs?.customer || ''],
      ['Door Style', project.specs?.doorStyle || ''],
      ['Hinges', project.specs?.hinges || ''],
      ['Drawer Box', project.specs?.drawerBox || ''],
      ['Drawer Guides', project.specs?.drawerGuides || ''],
      ['Countertops', project.specs?.countertops || ''],
      ['Handles & Hardware', project.specs?.handlesAndHardware || ''],
      ['Tax', project.specs?.tax || ''],
      [],
      ['Generated', new Date().toLocaleString()],
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
    wsInfo['!cols'] = [{ wch: 22 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Project Info');

    // ── Sheet 2: Unit Count ────────────────────────────────────────
    const unitHeader = ['Unit #', 'Type', 'Building', 'Floor'];
    const unitData = project.units.map(u => [u.unitNumber, u.type, u.bldg || '', u.floor || '']);
    const unitTotRow = [`TOTAL: ${project.units.length} unit${project.units.length !== 1 ? 's' : ''}`, '', '', ''];
    const wsUnit = XLSX.utils.aoa_to_sheet([unitHeader, ...unitData, [], unitTotRow]);
    wsUnit['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsUnit, 'Unit Count');

    // ── Sheet 3: SKU Summary ───────────────────────────────────────
    const skuHeader = ['SKU', 'Type', 'Width"', 'Height"', 'Depth"', 'Rooms', 'Total Qty'];
    const skuData = summary.skuSummary.map(s => [s.sku, s.type, s.width, s.height, s.depth, s.rooms.join(', '), s.totalQty]);
    const wsSku = XLSX.utils.aoa_to_sheet([skuHeader, ...skuData]);
    wsSku['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 30 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsSku, 'SKU Summary');

    // ── Sheet 4: Accessories ───────────────────────────────────────
    const accHeader = ['Item', 'Quantity', 'Unit'];
    const accData = [
      ['Fillers', summary.accessorySummary.totalFillers, 'pcs'],
      ['Finished Panels', summary.accessorySummary.totalPanels, 'pcs'],
      ['Toe Kick', summary.accessorySummary.totalToeKickLF, 'LF'],
      ['Crown Molding', summary.accessorySummary.totalCrownLF, 'LF'],
      ['Light Rail', summary.accessorySummary.totalLightRailLF, 'LF'],
      ['Hardware', summary.accessorySummary.totalHardware, 'pcs'],
    ];
    const wsAcc = XLSX.utils.aoa_to_sheet([accHeader, ...accData]);
    wsAcc['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, wsAcc, 'Accessories');

    // ── Sheet 5: Countertops ───────────────────────────────────────
    const ctHeader = ['Unit #', 'Type', 'Bldg', 'Floor', 'CT Sqft'];
    const ctData = project.units.map(u => {
      const sqft = calcUnitCountertopTotal(u);
      return [u.unitNumber, u.type, u.bldg || '', u.floor || '', +sqft.toFixed(1)];
    });
    const ctTotRow = ['TOTAL', '', '', '', +summary.totalCountertopSqft.toFixed(1)];
    const wsCt = XLSX.utils.aoa_to_sheet([ctHeader, ...ctData, [], ctTotRow]);
    wsCt['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsCt, 'Countertops');

    // ── Download ──────────────────────────────────────────────────
    XLSX.writeFile(wb, `${project.name.replace(/[^a-zA-Z0-9]/g, '-')}-takeoff.xlsx`);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-primary" />
          <h2 className="font-semibold text-sm">Project Summary</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border text-foreground hover:bg-secondary transition-colors"
          >
            <Download size={12} />
            Export Excel
          </button>
          <button
            onClick={handleExportPDF}
            disabled={pdfLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white transition-colors disabled:opacity-70"
            style={{ background: 'hsl(var(--primary))' }}
          >
            {pdfLoading
              ? <><Loader2 size={12} className="animate-spin" /> Generating…</>
              : <><FileText size={12} /> Export PDF</>
            }
          </button>
        </div>
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card">
          <div className="stat-value">{summary.totalUnits}</div>
          <div className="stat-label">Total Units</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary.totalCabinets}</div>
          <div className="stat-label">Total Cabinets</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary.totalCountertopSqft.toFixed(1)}</div>
          <div className="stat-label">CT Sqft</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary.skuSummary.length}</div>
          <div className="stat-label">Unique SKUs</div>
        </div>
      </div>

      {/* Cabinet breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Base Cabinets', value: summary.totalBase },
          { label: 'Wall Cabinets', value: summary.totalWall },
          { label: 'Tall Cabinets', value: summary.totalTall },
          { label: 'Vanity Cabinets', value: summary.totalVanity },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Unit breakdown table */}
      <div className="est-card overflow-hidden">
        <div className="est-section-header">Unit Breakdown</div>
        {project.units.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">No units added yet.</div>
        ) : (
          <table className="est-table">
            <thead>
              <tr>
                <th>Unit #</th>
                <th>Type</th>
                <th className="text-right">Total Cabs</th>
                <th className="text-right">Base</th>
                <th className="text-right">Wall</th>
                <th className="text-right">Tall</th>
                <th className="text-right">Fillers</th>
                <th className="text-right">CT Sqft</th>
              </tr>
            </thead>
            <tbody>
              {project.units.map(u => {
                const c = calcUnitCabinetTotals(u);
                const sqft = calcUnitCountertopTotal(u);
                const fillers = u.accessories.filter(a => a.type === 'Filler').reduce((s, a) => s + a.quantity, 0);
                return (
                  <tr key={u.id}>
                    <td className="font-semibold">#{u.unitNumber}</td>
                    <td>{u.type}</td>
                    <td className="text-right font-medium">{c.total}</td>
                    <td className="text-right">{c.base}</td>
                    <td className="text-right">{c.wall}</td>
                    <td className="text-right">{c.tall}</td>
                    <td className="text-right">{fillers}</td>
                    <td className="text-right font-medium">{sqft.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'hsl(var(--secondary))', fontWeight: 700 }}>
                <td colSpan={2} className="px-3 py-1.5 text-sm">TOTAL</td>
                <td className="px-3 py-1.5 text-sm text-right">{summary.totalCabinets}</td>
                <td className="px-3 py-1.5 text-sm text-right">{summary.totalBase}</td>
                <td className="px-3 py-1.5 text-sm text-right">{summary.totalWall}</td>
                <td className="px-3 py-1.5 text-sm text-right">{summary.totalTall}</td>
                <td className="px-3 py-1.5 text-sm text-right">{summary.accessorySummary.totalFillers}</td>
                <td className="px-3 py-1.5 text-sm text-right">{summary.totalCountertopSqft.toFixed(1)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* SKU Summary */}
      {summary.skuSummary.length > 0 && (
        <div className="est-card overflow-hidden">
          <div className="est-section-header">SKU Summary (All Units)</div>
          <table className="est-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Type</th>
                <th className="text-right">W"</th>
                <th className="text-right">H"</th>
                <th className="text-right">D"</th>
                <th>Rooms</th>
                <th className="text-right">Total Qty</th>
              </tr>
            </thead>
            <tbody>
              {summary.skuSummary.map((s, i) => (
                <tr key={i}>
                  <td className="font-mono font-semibold">{s.sku}</td>
                  <td>
                    <span className={
                      s.type === 'Base' ? 'badge-base' :
                      s.type === 'Wall' ? 'badge-wall' :
                      s.type === 'Tall' ? 'badge-tall' : 'badge-wall'
                    }>{s.type}</span>
                  </td>
                  <td className="text-right">{s.width}</td>
                  <td className="text-right">{s.height}</td>
                  <td className="text-right">{s.depth}</td>
                  <td className="text-xs text-muted-foreground">{s.rooms.join(', ')}</td>
                  <td className="text-right font-bold">{s.totalQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Accessories Summary */}
      <div className="est-card overflow-hidden">
        <div className="est-section-header">Accessories Summary (All Units)</div>
        <table className="est-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="text-right">Quantity</th>
              <th>Unit</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'Fillers', value: summary.accessorySummary.totalFillers, unit: 'pcs' },
              { label: 'Finished Panels', value: summary.accessorySummary.totalPanels, unit: 'pcs' },
              { label: 'Toe Kick', value: summary.accessorySummary.totalToeKickLF, unit: 'LF' },
              { label: 'Crown Molding', value: summary.accessorySummary.totalCrownLF, unit: 'LF' },
              { label: 'Light Rail', value: summary.accessorySummary.totalLightRailLF, unit: 'LF' },
              { label: 'Hardware', value: summary.accessorySummary.totalHardware, unit: 'pcs' },
            ].map(row => (
              <tr key={row.label}>
                <td className="font-medium">{row.label}</td>
                <td className="text-right font-bold">{row.value}</td>
                <td className="text-muted-foreground text-xs">{row.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Unit type breakdown */}
      {Object.keys(summary.unitsByType).length > 0 && (
        <div className="est-card overflow-hidden">
          <div className="est-section-header">Units by Type</div>
          <table className="est-table">
            <thead>
              <tr>
                <th>Unit Type</th>
                <th className="text-right">Count</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.unitsByType).map(([type, count]) => (
                <tr key={type}>
                  <td className="font-medium">{type}</td>
                  <td className="text-right font-bold">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {project.notes && (
        <div className="est-card p-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Project Notes</div>
          <p className="text-sm text-foreground whitespace-pre-wrap">{project.notes}</p>
        </div>
      )}
    </div>
  );
}
