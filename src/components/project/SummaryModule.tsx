import { useState } from 'react';
import { BarChart3, Download, FileText, Loader2 } from 'lucide-react';
import ExcelJS from 'exceljs';
import type { Project, Unit } from '@/types/project';
import { calcProjectSummary, calcUnitCabinetTotals, calcUnitCountertopTotal, calcCountertopSqft } from '@/lib/calculations';
import { exportProjectPDF } from '@/lib/exportPDF';
import { formatDoorStyle, formatKitchenTops, formatVanityTops, formatAdditionalTops } from '@/lib/formatSpecs';

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
    const boldUnderlineLabels = new Set([
      'Project Name', 'Address', 'Project Super', 'Customer', 'Specifications',
      'Kitchen Tops', 'Vanity Tops', 'Additional Tops', 'Handles & Hardware', 'Sales Tax on Material',
    ]);

    const infoRows: (string | undefined)[][] = [
      ['Project Name', project.name],
      [],
      ['Address', project.address],
      ['Type', project.type],
      ['Notes', project.notes || ''],
      [],
      ['Project Super', project.specs?.projectSuper || ''],
      ['Customer', project.specs?.customer || ''],
      [],
      ['Specifications', ''],
      ['Door Style', formatDoorStyle(project.specs)],
      ['Hinges', project.specs?.hinges || ''],
      ['Drawer Box', project.specs?.drawerBox || ''],
      ['Drawer Guides', project.specs?.drawerGuides || ''],
      [],
      ['Kitchen Tops', formatKitchenTops(project.specs)],
      ['Vanity Tops', formatVanityTops(project.specs)],
      ...((project.specs as any)?.additionalTopsEnabled ? [['Additional Tops', formatAdditionalTops(project.specs)]] : []),
      [],
      ['Handles & Hardware', project.specs?.handlesAndHardware || ''],
      [],
      ['Sales Tax on Material', project.specs?.tax || ''],
      [],
      ['Generated', new Date().toLocaleString()],
    ];

    infoRows.forEach(r => {
      const row = wsInfo.addRow(r);
      if (r.length > 0 && r[0] && boldUnderlineLabels.has(r[0])) {
        const cell = row.getCell(1);
        cell.font = { bold: true, underline: true };
      }
    });

    // ── Sheet 2: Unit Count (pivot: units vertical, types horizontal) ──
    const wsUnit = wb.addWorksheet('Unit Count');
    const uniqueTypes = Array.from(new Set(project.units.map(u => u.type).filter(Boolean))).sort();

    const allBorders: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FF999999' } },
      bottom: { style: 'thin', color: { argb: 'FF999999' } },
      left: { style: 'thin', color: { argb: 'FF999999' } },
      right: { style: 'thin', color: { argb: 'FF999999' } },
    };

    // Set column widths: blank col A, then Unit#, Building, Floor, types
    wsUnit.columns = [
      { width: 3 },
      { width: 12 },
      { width: 16 },
      { width: 10 },
      ...uniqueTypes.map(() => ({ width: 6 })),
    ];

    // Blank row 1
    wsUnit.addRow([]);

    // Header row (starting from col B)
    const unitHeaderRow = wsUnit.addRow(['', 'Unit #', 'Building', 'Floor', ...uniqueTypes]);
    unitHeaderRow.height = 120;
    unitHeaderRow.eachCell((cell, colNumber) => {
      if (colNumber <= 1) return;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
      cell.border = allBorders;
      cell.alignment = { vertical: 'bottom', wrapText: false };
      if (colNumber > 4) {
        cell.alignment = { textRotation: 90, vertical: 'bottom', horizontal: 'center' };
      }
    });

    // Data rows
    project.units.forEach(u => {
      const typeFlags = uniqueTypes.map(t => (u.type === t ? 1 : ''));
      const dataRow = wsUnit.addRow(['', u.unitNumber, u.bldg || '', fmtFloor(u.floor || ''), ...typeFlags]);
      dataRow.eachCell((cell, colNumber) => {
        if (colNumber <= 1) return;
        cell.border = allBorders;
        if (colNumber > 4) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });
    });

    // Empty row then total
    wsUnit.addRow([]);
    const typeCounts = uniqueTypes.map(t => project.units.filter(u => u.type === t).length);
    const unitTotRow = wsUnit.addRow(['', `TOTAL (${project.units.length})`, '', '', ...typeCounts]);
    unitTotRow.eachCell((cell, colNumber) => {
      if (colNumber <= 1) return;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      cell.border = allBorders;
      if (colNumber > 4) cell.alignment = { horizontal: 'center' };
    });

    // ── Sheet 3: Countertops by Unit Type ────────────────────────
    const wsCt = wb.addWorksheet('Countertops');
    wsCt.columns = [
      { width: 20 }, { width: 22 }, { width: 10 }, { width: 10 },
      { width: 14 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 10 },
    ];
    styleHeader(wsCt.addRow(['Unit Type (Qty)', 'Label', 'Length"', 'Depth"', 'Backsplash Ht"', 'Sidesplash Qty', 'Tag', '+5% Waste', 'Sqft']));

    // Group units by type
    const typeMap = new Map<string, typeof project.units>();
    project.units.forEach(u => {
      const arr = typeMap.get(u.type) || [];
      arr.push(u);
      typeMap.set(u.type, arr);
    });

    typeMap.forEach((units, type) => {
      const unitCount = units.length;
      const allCts = units.flatMap(u => u.countertops);
      if (allCts.length === 0) return;

      const rep = units[0];
      rep.countertops.forEach(ct => {
        const sqft = calcCountertopSqft(ct);
        wsCt.addRow([
          `${type} (x${unitCount})`,
          ct.label,
          ct.length,
          ct.depth,
          ct.splashHeight ?? 0,
          ct.sideSplash ?? 0,
          ct.isIsland ? 'Island' : 'Perimeter',
          ct.addWaste ? 'Yes' : 'No',
          sqft,
        ]);
      });

      // Extra countertops in non-representative units
      units.slice(1).forEach(u => {
        u.countertops.slice(rep.countertops.length).forEach(ct => {
          const sqft = calcCountertopSqft(ct);
          wsCt.addRow([
            `${type} — #${u.unitNumber}`,
            ct.label,
            ct.length,
            ct.depth,
            ct.splashHeight ?? 0,
            ct.sideSplash ?? 0,
            ct.isIsland ? 'Island' : 'Perimeter',
            ct.addWaste ? 'Yes' : 'No',
            sqft,
          ]);
        });
      });

      // Subtotal using actual data from all units
      const typeSqft = units.reduce((s, u) => s + calcUnitCountertopTotal(u), 0);
      const subRow = wsCt.addRow(['', '', '', '', '', '', '', `Subtotal (×${unitCount})`, typeSqft]);
      subRow.eachCell(cell => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      });
    });

    wsCt.addRow([]);
    const ctTotRow = wsCt.addRow(['GRAND TOTAL', '', '', '', '', '', '', '', summary.totalCountertopSqft]);
    ctTotRow.eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
    });

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
          <div className="stat-value">{summary.totalCountertopSqft}</div>
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
                    <td className="text-right font-medium">{sqft}</td>
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
                <td className="px-3 py-1.5 text-sm text-right">{summary.totalCountertopSqft}</td>
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
