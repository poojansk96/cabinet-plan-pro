import { useState } from 'react';
import { BarChart3, Download, FileText, Loader2 } from 'lucide-react';
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Project } from '@/types/project';
import { usePrefinalStore, type PrefinalUnitNumber, type PrefinalCabinetRow } from '@/hooks/usePrefinalStore';

interface Props {
  project: Project;
  [key: string]: unknown;
}

// Cabinet type display order
const CAB_TYPE_ORDER = ['Wall', 'Base', 'Tall', 'Vanity', 'Accessory'];

function parseSkuDims(sku: string): { width: number; height: number } {
  const match = sku.replace(/\s/g, '').match(/^[A-Za-z]+(\d+)/);
  if (!match) return { width: 0, height: 0 };
  const digits = match[1];
  if (digits.length === 4) return { width: Number(digits.slice(0, 2)), height: Number(digits.slice(2, 4)) };
  if (digits.length === 3) return { width: Number(digits.slice(0, 1)), height: Number(digits.slice(1, 3)) };
  if (digits.length === 2) return { width: Number(digits), height: 0 };
  return { width: Number(digits), height: 0 };
}

function sortSkusForGroup(skus: string[], group: string): string[] {
  if (group === 'Wall') {
    return [...skus].sort((a, b) => {
      const da = parseSkuDims(a), db = parseSkuDims(b);
      if (da.height !== db.height) return da.height - db.height;
      return da.width - db.width;
    });
  }
  if (group === 'Base') {
    return [...skus].sort((a, b) => {
      const da = parseSkuDims(a), db = parseSkuDims(b);
      if (da.width !== db.width) return da.width - db.width;
      return da.height - db.height;
    });
  }
  return skus;
}

function groupSkusByType(cabinetRows: PrefinalCabinetRow[]) {
  const allSkus = Array.from(new Set(cabinetRows.map(r => r.sku))).sort();
  const skuCabType: Record<string, string> = {};
  const skuTypeMap: Record<string, Set<string>> = {};
  // Build SKU → unitType → quantity mapping (max qty per sku+unitType)
  const skuTypeQty: Record<string, Record<string, number>> = {};
  cabinetRows.forEach(r => {
    if (!skuTypeMap[r.sku]) skuTypeMap[r.sku] = new Set();
    skuTypeMap[r.sku].add(r.unitType);
    if (!skuCabType[r.sku]) skuCabType[r.sku] = r.type;
    if (!skuTypeQty[r.sku]) skuTypeQty[r.sku] = {};
    skuTypeQty[r.sku][r.unitType] = Math.max(skuTypeQty[r.sku][r.unitType] || 0, r.quantity);
  });

  const groups: Record<string, string[]> = {};
  for (const sku of allSkus) {
    const t = skuCabType[sku] || 'Other';
    if (!groups[t]) groups[t] = [];
    groups[t].push(sku);
  }
  const ordered: { group: string; skus: string[] }[] = [];
  for (const g of CAB_TYPE_ORDER) {
    if (groups[g]) { ordered.push({ group: g, skus: sortSkusForGroup(groups[g], g) }); delete groups[g]; }
  }
  for (const [g, skus] of Object.entries(groups)) {
    ordered.push({ group: g, skus: sortSkusForGroup(skus, g) });
  }
  return { allSkus, skuCabType, skuTypeMap, skuTypeQty, groupedSkus: ordered };
}

// ─── PDF Brand colors ───
const BLUE_DARK = [22, 60, 110] as [number, number, number];
const BLUE_MID = [41, 98, 168] as [number, number, number];
const BLUE_LIGHT = [224, 234, 248] as [number, number, number];
const GRAY_LIGHT = [245, 247, 250] as [number, number, number];
const GRAY_MID = [180, 188, 200] as [number, number, number];
const WHITE = [255, 255, 255] as [number, number, number];
const TEXT_DARK = [20, 30, 48] as [number, number, number];
const TEXT_MID = [80, 95, 115] as [number, number, number];

export default function PreFinalSummaryModule({ project }: Props) {
  const store = usePrefinalStore(project.id);
  const [pdfLoading, setPdfLoading] = useState(false);

  const { allSkus, skuCabType, skuTypeMap, skuTypeQty, groupedSkus } = groupSkusByType(store.cabinetRows);

  const unitTypeTotal = (type: string) =>
    store.unitNumbers.filter(u => u.assignments[type]).length;

  // ─── Excel Export ────────────────────────────────────────────────
  const handleExportExcel = async () => {
    const wb = new ExcelJS.Workbook();

    const styleHeader = (row: ExcelJS.Row, bgArgb = 'FFD6E4F0') => {
      row.eachCell(cell => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
      });
    };

    // ── Sheet 1: Pre-Final Unit Count ───────────────────────────────
    const wsUnits = wb.addWorksheet('Pre-Final Unit Count');
    const unitTypeCols = store.unitTypes.length;
    wsUnits.columns = [
      { width: 14 },
      { width: 10 },
      { width: 10 },
      ...store.unitTypes.map(() => ({ width: 6 })),
      { width: 8 },
    ];

    const unitHeader = wsUnits.addRow(['Unit #', 'Bldg', 'Floor', ...store.unitTypes, 'Total']);
    unitHeader.height = 120;
    unitHeader.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
      cell.alignment = { vertical: 'bottom', wrapText: false };
      if (colNumber > 3 && colNumber <= unitTypeCols + 3) {
        cell.alignment = { textRotation: 90, vertical: 'bottom', horizontal: 'center' };
      }
      if (colNumber === unitTypeCols + 4) {
        cell.alignment = { vertical: 'bottom', horizontal: 'center' };
      }
    });

    // Sort units by Bldg first, then unit name
    const sortedUnits = [...store.unitNumbers].sort((a, b) => {
      const bldgA = (a.bldg || '').toUpperCase();
      const bldgB = (b.bldg || '').toUpperCase();
      if (bldgA !== bldgB) return bldgA.localeCompare(bldgB, undefined, { numeric: true });
      return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
    });

    sortedUnits.forEach(unit => {
      const flags = store.unitTypes.map(t => unit.assignments[t] ? 1 : '');
      const rowTotal = store.unitTypes.filter(t => unit.assignments[t]).length;
      const row = wsUnits.addRow([unit.name, unit.bldg || '', unit.floor || '', ...flags, rowTotal]);
      row.eachCell((cell, colNumber) => {
        if (colNumber > 3) cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
    });

    wsUnits.addRow([]);
    const totals = store.unitTypes.map(t => unitTypeTotal(t));
    const grandTotal = totals.reduce((s, v) => s + v, 0);
    const totRow = wsUnits.addRow([`TOTAL (${store.unitNumbers.length})`, '', '', ...totals, grandTotal]);
    totRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      if (colNumber > 3) cell.alignment = { horizontal: 'center' };
    });

    // ── Sheet 2: Pre-Final Cabinet Count ────────────────────────────
    const wsCabs = wb.addWorksheet('Pre-Final Cabinet Count');
    const cabTypes = store.cabinetUnitTypes;
    wsCabs.columns = [
      { width: 18 },
      ...cabTypes.map(() => ({ width: 6 })),
      { width: 8 },
    ];

    const cabHeader = wsCabs.addRow(['SKU Name', ...cabTypes, 'Total']);
    cabHeader.height = 120;
    cabHeader.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
      cell.alignment = { vertical: 'bottom', wrapText: false };
      if (colNumber > 1 && colNumber <= cabTypes.length + 1) {
        cell.alignment = { textRotation: 90, vertical: 'bottom', horizontal: 'center' };
      }
      if (colNumber === cabTypes.length + 2) {
        cell.alignment = { vertical: 'bottom', horizontal: 'center' };
      }
    });

    // Add grouped rows
    groupedSkus.forEach(({ group, skus }) => {
      const groupRow = wsCabs.addRow([`${group} (${skus.length})`]);
      groupRow.eachCell(cell => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAEAEA' } };
      });
      skus.forEach(sku => {
        const qtys = cabTypes.map(t => {
          const qty = skuTypeQty[sku]?.[t] || 0;
          return qty > 0 ? qty : '';
        });
        const rowTotal = cabTypes.reduce((sum, t) => sum + (skuTypeQty[sku]?.[t] || 0), 0);
        const row = wsCabs.addRow([sku, ...qtys, rowTotal]);
        row.eachCell((cell, colNumber) => {
          if (colNumber > 1) cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });
      });
    });

    wsCabs.addRow([]);
    const cabColTotals = cabTypes.map(t => allSkus.reduce((sum, sku) => sum + (skuTypeQty[sku]?.[t] || 0), 0));
    const cabGrandTotal = allSkus.reduce((sum, sku) => sum + cabTypes.reduce((s, t) => s + (skuTypeQty[sku]?.[t] || 0), 0), 0);
    const cabTotRow = wsCabs.addRow([`TOTAL (${allSkus.length})`, ...cabColTotals, cabGrandTotal]);
    cabTotRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      if (colNumber > 1) cell.alignment = { horizontal: 'center' };
    });

    // Download
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^a-zA-Z0-9]/g, '-')}-prefinal.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── PDF Export ──────────────────────────────────────────────────
  const handleExportPDF = async () => {
    setPdfLoading(true);
    try {
      await new Promise(r => setTimeout(r, 80));

      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 40;
      const contentW = pageW - margin * 2;

      // Header banner
      doc.setFillColor(...BLUE_DARK);
      doc.rect(0, 0, pageW, 60, 'F');
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...WHITE);
      doc.text('cabinetcounters.com — Pre-Final Report', margin + 10, 28);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...GRAY_MID);
      doc.text(project.name, margin + 10, 44);
      doc.setFontSize(8);
      doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, pageW - margin, 44, { align: 'right' });

      let y = 76;

      // ── Section: Pre-Final Unit Count ─────────────────────────────
      const sectionHeader = (title: string, yPos: number) => {
        doc.setFillColor(...BLUE_DARK);
        doc.roundedRect(margin, yPos, contentW, 20, 2, 2, 'F');
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...WHITE);
        doc.text(title, margin + 10, yPos + 13);
        return yPos + 24;
      };

      if (store.unitTypes.length > 0) {
        y = sectionHeader('PRE-FINAL UNIT COUNT', y);

        const unitHead = ['Unit #', ...store.unitTypes, 'Total'];
        const unitBody = store.unitNumbers.map(u => {
          const flags = store.unitTypes.map(t => u.assignments[t] ? '1' : '');
          const rowTotal = store.unitTypes.filter(t => u.assignments[t]).length;
          return [u.name, ...flags, String(rowTotal)];
        });
        const totals = store.unitTypes.map(t => String(unitTypeTotal(t)));
        const grandTotal = store.unitTypes.reduce((s, t) => s + unitTypeTotal(t), 0);
        unitBody.push(['TOTAL', ...totals, String(grandTotal)]);

        autoTable(doc, {
          startY: y,
          head: [unitHead],
          body: unitBody,
          margin: { left: margin, right: margin },
          styles: { fontSize: 7, cellPadding: 3, textColor: TEXT_DARK, lineColor: [220, 228, 240], lineWidth: 0.5 },
          headStyles: { fillColor: BLUE_MID, textColor: WHITE, fontStyle: 'bold', fontSize: 7, halign: 'center' },
          columnStyles: { 0: { halign: 'left' } },
          alternateRowStyles: { fillColor: GRAY_LIGHT },
          didParseCell: (data) => {
            if (data.row.index === unitBody.length - 1) {
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fillColor = BLUE_LIGHT;
              data.cell.styles.textColor = BLUE_DARK;
            }
            if (data.column.index > 0) {
              data.cell.styles.halign = 'center';
            }
          },
        });

        y = (doc as any).lastAutoTable.finalY + 18;
      }

      // ── Section: Pre-Final Cabinet Count ──────────────────────────
      if (allSkus.length > 0) {
        if (y > pageH - 100) { doc.addPage(); y = 40; }
        y = sectionHeader('PRE-FINAL CABINET COUNT', y);

        const cabHead = ['SKU Name', ...store.cabinetUnitTypes, 'Total'];
        const cabBody: string[][] = [];

        groupedSkus.forEach(({ group, skus }) => {
          // Group header row
          cabBody.push([`▸ ${group} (${skus.length})`, ...store.cabinetUnitTypes.map(() => ''), '']);
          skus.forEach(sku => {
            const qtys = store.cabinetUnitTypes.map(t => {
              const qty = skuTypeQty[sku]?.[t] || 0;
              return qty > 0 ? String(qty) : '';
            });
            const rowTotal = store.cabinetUnitTypes.reduce((sum, t) => sum + (skuTypeQty[sku]?.[t] || 0), 0);
            cabBody.push([sku, ...qtys, String(rowTotal)]);
          });
        });

        const cabColTotals = store.cabinetUnitTypes.map(t => String(allSkus.reduce((sum, sku) => sum + (skuTypeQty[sku]?.[t] || 0), 0)));
        const cabGrandTotal = allSkus.reduce((sum, sku) => sum + store.cabinetUnitTypes.reduce((s, t) => s + (skuTypeQty[sku]?.[t] || 0), 0), 0);
        cabBody.push(['TOTAL', ...cabColTotals, String(cabGrandTotal)]);

        // Track group header indices for styling
        const groupRowIndices = new Set<number>();
        let idx = 0;
        groupedSkus.forEach(({ skus }) => {
          groupRowIndices.add(idx);
          idx += 1 + skus.length;
        });

        autoTable(doc, {
          startY: y,
          head: [cabHead],
          body: cabBody,
          margin: { left: margin, right: margin },
          styles: { fontSize: 7, cellPadding: 3, textColor: TEXT_DARK, lineColor: [220, 228, 240], lineWidth: 0.5 },
          headStyles: { fillColor: BLUE_MID, textColor: WHITE, fontStyle: 'bold', fontSize: 7, halign: 'center' },
          columnStyles: { 0: { halign: 'left', font: 'courier' } },
          alternateRowStyles: { fillColor: GRAY_LIGHT },
          didParseCell: (data) => {
            // Group header rows
            if (groupRowIndices.has(data.row.index)) {
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fillColor = [234, 234, 234] as any;
              data.cell.styles.textColor = TEXT_MID;
              data.cell.styles.font = 'helvetica';
            }
            // Total row
            if (data.row.index === cabBody.length - 1) {
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fillColor = BLUE_LIGHT;
              data.cell.styles.textColor = BLUE_DARK;
            }
            if (data.column.index > 0) {
              data.cell.styles.halign = 'center';
            }
          },
        });

        y = (doc as any).lastAutoTable.finalY + 14;
      }

      // Footer on all pages
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFillColor(...BLUE_DARK);
        doc.rect(0, pageH - 24, pageW, 24, 'F');
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...GRAY_MID);
        doc.text('cabinetcounters.com  |  Pre-Final Report', margin, pageH - 9);
        doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 9, { align: 'right' });
        doc.text(project.name, pageW / 2, pageH - 9, { align: 'center' });
      }

      const filename = `${project.name.replace(/[^a-zA-Z0-9]/g, '-')}-prefinal-report.pdf`;
      doc.save(filename);
    } finally {
      setPdfLoading(false);
    }
  };

  // ─── Summary stats ───────────────────────────────────────────────
  const totalUnitNumbers = store.unitNumbers.length;
  const totalUnitTypes = store.unitTypes.length;
  const totalSkus = allSkus.length;
  const totalCabTypes = groupedSkus.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-primary" />
          <h2 className="font-semibold text-sm">Pre-Final Summary</h2>
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

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card">
          <div className="stat-value">{totalUnitTypes}</div>
          <div className="stat-label">Unit Types</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalUnitNumbers}</div>
          <div className="stat-label">Unit Numbers</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalSkus}</div>
          <div className="stat-label">Unique SKUs</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalCabTypes}</div>
          <div className="stat-label">Cabinet Types</div>
        </div>
      </div>

      {/* Unit type breakdown */}
      {store.unitTypes.length > 0 && (
        <div className="est-card overflow-hidden">
          <div className="est-section-header">Unit Type Breakdown</div>
          <table className="est-table">
            <thead>
              <tr>
                <th>Unit Type</th>
                <th className="text-right">Assigned Units</th>
              </tr>
            </thead>
            <tbody>
              {store.unitTypes.map(type => (
                <tr key={type}>
                  <td className="font-medium">{type}</td>
                  <td className="text-right font-bold">{unitTypeTotal(type)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'hsl(var(--secondary))', fontWeight: 700 }}>
                <td className="px-3 py-1.5 text-sm">TOTAL</td>
                <td className="px-3 py-1.5 text-sm text-right">
                  {store.unitTypes.reduce((s, t) => s + unitTypeTotal(t), 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Cabinet type breakdown */}
      {groupedSkus.length > 0 && (
        <div className="est-card overflow-hidden">
          <div className="est-section-header">Cabinet SKU Breakdown</div>
          <table className="est-table">
            <thead>
              <tr>
                <th>Cabinet Type</th>
                <th className="text-right">SKU Count</th>
              </tr>
            </thead>
            <tbody>
              {groupedSkus.map(({ group, skus }) => (
                <tr key={group}>
                  <td className="font-medium">{group}</td>
                  <td className="text-right font-bold">{skus.length}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'hsl(var(--secondary))', fontWeight: 700 }}>
                <td className="px-3 py-1.5 text-sm">TOTAL</td>
                <td className="px-3 py-1.5 text-sm text-right">{allSkus.length}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {store.unitTypes.length === 0 && allSkus.length === 0 && (
        <div className="est-card p-8 text-center text-muted-foreground text-sm">
          No pre-final data yet. Import data in the Pre-Final Unit Count and Cabinet Count tabs first.
        </div>
      )}
    </div>
  );
}
