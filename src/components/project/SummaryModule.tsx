import { useState } from 'react';
import { BarChart3, Download, FileText, Loader2 } from 'lucide-react';
import ExcelJS from 'exceljs';
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

  const fmtFloor = (f: string) => f && /^\d+$/.test(f) ? `Floor ${f}` : (f || '');

  const handleExportExcel = async () => {
    const wb = new ExcelJS.Workbook();

    // Helper: style a header row bold
    const styleHeader = (row: ExcelJS.Row, bgArgb = 'FFD6E4F0') => {
      row.eachCell(cell => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FF999999' } },
        };
      });
    };

    // ── Sheet 1: Project Info ──────────────────────────────────────
    const wsInfo = wb.addWorksheet('Project Info');
    wsInfo.columns = [{ width: 22 }, { width: 40 }];
    const infoHeaderRow = wsInfo.addRow(['Field', 'Value']);
    styleHeader(infoHeaderRow);
    [
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
    ].forEach(r => wsInfo.addRow(r));

    // ── Sheet 2: Unit Count (pivot: units vertical, types horizontal) ──
    const wsUnit = wb.addWorksheet('Unit Count');
    const uniqueTypes = Array.from(new Set(project.units.map(u => u.type).filter(Boolean))).sort();

    // Set column widths: Unit#, Building, Floor fixed; each type column narrow (rotated text)
    wsUnit.columns = [
      { width: 12 },
      { width: 16 },
      { width: 10 },
      ...uniqueTypes.map(() => ({ width: 6 })),
    ];

    // Header row
    const unitHeaderRow = wsUnit.addRow(['Unit #', 'Building', 'Floor', ...uniqueTypes]);
    unitHeaderRow.height = 120; // tall row to show rotated text
    unitHeaderRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
      cell.alignment = { vertical: 'bottom', wrapText: false };
      // Rotate type name columns 90 degrees
      if (colNumber > 3) {
        cell.alignment = { textRotation: 90, vertical: 'bottom', horizontal: 'center' };
      }
    });

    // Data rows
    project.units.forEach(u => {
      const typeFlags = uniqueTypes.map(t => (u.type === t ? 1 : ''));
      const dataRow = wsUnit.addRow([u.unitNumber, u.bldg || '', fmtFloor(u.floor || ''), ...typeFlags]);
      dataRow.eachCell((cell, colNumber) => {
        if (colNumber > 3) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });
    });

    // Empty row then total
    wsUnit.addRow([]);
    const typeCounts = uniqueTypes.map(t => project.units.filter(u => u.type === t).length);
    const unitTotRow = wsUnit.addRow([`TOTAL (${project.units.length})`, '', '', ...typeCounts]);
    unitTotRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      if (colNumber > 3) cell.alignment = { horizontal: 'center' };
    });

    // ── Sheet 3: SKU Summary ───────────────────────────────────────
    const wsSku = wb.addWorksheet('SKU Summary');
    wsSku.columns = [
      { width: 18 }, { width: 10 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 30 }, { width: 10 },
    ];
    styleHeader(wsSku.addRow(['SKU', 'Type', 'Width"', 'Height"', 'Depth"', 'Rooms', 'Total Qty']));
    summary.skuSummary.forEach(s =>
      wsSku.addRow([s.sku, s.type, s.width, s.height, s.depth, s.rooms.join(', '), s.totalQty])
    );

    // ── Sheet 4: Accessories ───────────────────────────────────────
    const wsAcc = wb.addWorksheet('Accessories');
    wsAcc.columns = [{ width: 20 }, { width: 12 }, { width: 8 }];
    styleHeader(wsAcc.addRow(['Item', 'Quantity', 'Unit']));
    [
      ['Fillers', summary.accessorySummary.totalFillers, 'pcs'],
      ['Finished Panels', summary.accessorySummary.totalPanels, 'pcs'],
      ['Toe Kick', summary.accessorySummary.totalToeKickLF, 'LF'],
      ['Crown Molding', summary.accessorySummary.totalCrownLF, 'LF'],
      ['Light Rail', summary.accessorySummary.totalLightRailLF, 'LF'],
      ['Hardware', summary.accessorySummary.totalHardware, 'pcs'],
    ].forEach(r => wsAcc.addRow(r));

    // ── Sheet 5: Countertops ───────────────────────────────────────
    const wsCt = wb.addWorksheet('Countertops');
    wsCt.columns = [{ width: 10 }, { width: 24 }, { width: 14 }, { width: 8 }, { width: 10 }];
    styleHeader(wsCt.addRow(['Unit #', 'Type', 'Building', 'Floor', 'CT Sqft']));
    project.units.forEach(u => {
      const sqft = calcUnitCountertopTotal(u);
      wsCt.addRow([u.unitNumber, u.type, u.bldg || '', fmtFloor(u.floor || ''), +sqft.toFixed(1)]);
    });
    wsCt.addRow([]);
    const ctTotRow = wsCt.addRow(['TOTAL', '', '', '', +summary.totalCountertopSqft.toFixed(1)]);
    ctTotRow.font = { bold: true };

    // ── Download ──────────────────────────────────────────────────
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^a-zA-Z0-9]/g, '-')}-takeoff.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
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
