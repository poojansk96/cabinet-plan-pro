import { useState } from 'react';
import { BarChart3, Download, FileText, Loader2 } from 'lucide-react';
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Project } from '@/types/project';
import { usePrefinalStore, type PrefinalUnitNumber, type PrefinalCabinetRow, type PrefinalVtopRow } from '@/hooks/usePrefinalStore';
import { formatDoorStyle, formatKitchenTops, formatVanityTops, formatAdditionalTops, getDoorStylePendingFields } from '@/lib/formatSpecs';
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

  const normalizeTypeKey = (value: string) =>
    String(value || '').toUpperCase().trim().replace(/^TYPE\s+/, '').replace(/[^A-Z0-9]/g, '');

  const countUnitsForType = (type: string) => {
    const target = normalizeTypeKey(type);
    return store.unitNumbers.filter(u =>
      Object.entries(u.assignments || {}).some(([k, enabled]) => enabled && normalizeTypeKey(k) === target)
    ).length;
  };

  const { allSkus, skuCabType, skuTypeMap, skuTypeQty, groupedSkus } = groupSkusByType(store.cabinetRows);

  const unitTypeTotal = (type: string) => countUnitsForType(type);
  // ─── Excel Export ────────────────────────────────────────────────
  const handleExportExcel = async () => {
    const wb = new ExcelJS.Workbook();

    const allBorders: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FF999999' } },
      bottom: { style: 'thin', color: { argb: 'FF999999' } },
      left: { style: 'thin', color: { argb: 'FF999999' } },
      right: { style: 'thin', color: { argb: 'FF999999' } },
    };

    const styleHeader = (row: ExcelJS.Row, bgArgb = 'FFD6E4F0') => {
      row.eachCell(cell => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
        cell.border = allBorders;
      });
    };

    const resolveOther = (val?: string, custom?: string) => {
      if (!val) return '';
      return val === 'Other' ? (custom || '') : val;
    };

    const HANDLE_DESCRIPTIONS: Record<string, string> = {
      'BP20596195': 'BP20596195-Modern Steel -96mm CTC- 205 Brushed Nickel Finish From Richelieu',
      'BP33206195': 'BP33206195-Functional Steel 4 Inch CTC - 332 Brushed nickel finish from Richelieu',
      'BP9041195': 'BP9041195 - Modern Metal Knob - 9041  - Brushed Nickel Finish From Richelieu',
    };

    const resolveHandles = (val?: string, custom?: string): string => {
      if (!val) return '';
      if (val === 'Other') return custom || '';
      return HANDLE_DESCRIPTIONS[val] || val;
    };

    const getHandlesPending = (val?: string, custom?: string): string | undefined => {
      if (!val) return 'Handles selection is pending';
      if (val === 'Other' && !custom?.trim()) return 'Handles selection is pending';
      return undefined;
    };

    // ── Sheet 1: Project Info ───────────────────────────────────────
    const wsInfo = wb.addWorksheet('1-Project Info');
    wsInfo.columns = [{ width: 22 }, { width: 40 }, { width: 30 }];
    const sp = project.specs as Record<string, any> | undefined;

    const boldUnderlineLabels = new Set([
      'Project Name', 'Address', 'Project Super', 'Customer',
      'Specifications', 'Kitchen Tops', 'Vanity Tops', 'Additional Tops',
      'Handles & Hardware', 'Sales Tax on Material',
    ]);

    // Build door style rows with pending indicators
    const doorStylePendingFields = getDoorStylePendingFields(project.specs);
    const doorStyleSummaryRow: (string | undefined)[] = ['Door Style', formatDoorStyle(project.specs)];

    // Check if the overall door style string is incomplete
    const hasDoorPending = doorStylePendingFields.some(f => f.pending);

    const infoRows: { cells: (string | undefined)[]; pendingNote?: string }[] = [
      { cells: ['Project Name', project.name] },
      { cells: [] },
      { cells: ['Address', project.address || '?'] },
      { cells: ['Notes', project.notes || ''] },
      { cells: [] },
      { cells: ['Project Super', sp?.projectSuper || '?'] },
      { cells: ['Customer', sp?.customer || '?'] },
      { cells: [] },
      { cells: ['Specifications', ''] },
      { cells: doorStyleSummaryRow, pendingNote: hasDoorPending ? doorStylePendingFields.filter(f => f.pending).map(f => f.pending).join(', ') : undefined },
      { cells: ['Hinges', resolveOther(sp?.hinges, sp?.hingesCustom)], pendingNote: !sp?.hinges ? 'Hinges selection is pending' : undefined },
      { cells: ['Drawer Box', resolveOther(sp?.drawerBox, sp?.drawerBoxCustom)], pendingNote: !sp?.drawerBox ? 'Drawer box selection is pending' : undefined },
      { cells: ['Drawer Guides', resolveOther(sp?.drawerGuides, sp?.drawerGuidesCustom)], pendingNote: !sp?.drawerGuides ? 'Drawer guides selection is pending' : undefined },
      { cells: [] },
      { cells: ['Kitchen Tops', formatKitchenTops(project.specs)], pendingNote: (() => {
        if (!sp?.countertops) return 'Kitchen tops material is pending';
        const pending: string[] = [];
        if (!sp.countertopManufacturer) pending.push('Vendor is pending');
        if (!sp.countertopColor && sp.countertops !== 'Laminate') pending.push('Color selection is pending');
        if (sp.countertops === 'Laminate' && !sp.laminateSubstrate) pending.push('Substrate is pending');
        if (sp.countertops === 'Laminate' && !sp.laminateColor) pending.push('Color selection is pending');
        return pending.length > 0 ? pending.join(', ') : undefined;
      })() },
      { cells: ['Vanity Tops', formatVanityTops(project.specs)], pendingNote: (() => {
        if (sp?.vanitySameAsKitchen) return undefined;
        if (!sp?.vanityCountertops) return 'Vanity tops material is pending';
        const pending: string[] = [];
        if (sp.vanityCountertops !== 'Cultured Marble' && sp.vanityCountertops !== 'Swanstone' && !sp.vanityManufacturer) pending.push('Vendor is pending');
        if ((sp.vanityCountertops === 'Quartz' || sp.vanityCountertops === 'Granite' || sp.vanityCountertops === 'Solid Surface- Corian') && !sp.vanityColor) pending.push('Color selection is pending');
        if ((sp.vanityCountertops === 'Cultured Marble' || sp.vanityCountertops === 'Swanstone') && !sp.vanityCMColor) pending.push('Color selection is pending');
        if ((sp.vanityCountertops === 'Cultured Marble' || sp.vanityCountertops === 'Swanstone') && !sp.faucetSelection) pending.push('Faucet selection is pending');
        if (sp.vanityCountertops === 'Laminate' && !sp.vanityLaminateSubstrate) pending.push('Substrate is pending');
        if (sp.vanityCountertops === 'Laminate' && !sp.vanityLaminateColor) pending.push('Color selection is pending');
        return pending.length > 0 ? pending.join(', ') : undefined;
      })() },
      ...((sp?.additionalTopsEnabled) ? [{ cells: ['Additional Tops', formatAdditionalTops(project.specs)] as (string | undefined)[], pendingNote: (() => {
        if (!sp?.additionalTops) return 'Material selection is pending';
        const pending: string[] = [];
        if (sp.additionalTops !== 'Cultured Marble' && sp.additionalTops !== 'Swanstone' && !sp.additionalTopsManufacturer) pending.push('Vendor is pending');
        if ((sp.additionalTops === 'Quartz' || sp.additionalTops === 'Granite' || sp.additionalTops === 'Solid Surface- Corian') && !sp.additionalTopsColor) pending.push('Color selection is pending');
        if (sp.additionalTops === 'Laminate' && !sp.additionalTopsLaminateSubstrate) pending.push('Substrate is pending');
        if (sp.additionalTops === 'Laminate' && !sp.additionalTopsLaminateColor) pending.push('Color selection is pending');
        return pending.length > 0 ? pending.join(', ') : undefined;
      })() }] : []),
      { cells: [] },
      { cells: ['Handles & Hardware', resolveHandles(sp?.handlesAndHardware, sp?.handlesCustom)], pendingNote: getHandlesPending(sp?.handlesAndHardware, sp?.handlesCustom) },
      { cells: [] },
      { cells: ['Sales Tax on Material', resolveOther(sp?.tax, sp?.taxCustom)], pendingNote: !sp?.tax ? 'Tax selection is pending' : (sp?.tax === 'Tax Exempt' ? 'Tax exempt certificate?' : undefined) },
      { cells: [] },
      { cells: ['Generated', new Date().toLocaleString()] },
    ];

    const redFont: Partial<ExcelJS.Font> = { color: { argb: 'FFCC0000' } };

    infoRows.forEach(({ cells: r, pendingNote }) => {
      const row = wsInfo.addRow(r);
      if (r.length > 0 && r[0] && boldUnderlineLabels.has(r[0])) {
        const cell = row.getCell(1);
        cell.font = { bold: true, underline: true };
      }
      // If value is empty/pending, color value cell red and add pending note in col C
      if (pendingNote) {
        const valCell = row.getCell(2);
        if (!valCell.value || String(valCell.value).trim() === '') {
          valCell.value = '—';
        }
        valCell.font = { ...valCell.font as any, ...redFont };
        const noteCell = row.getCell(3);
        noteCell.value = pendingNote;
        noteCell.font = { italic: true, ...redFont };
      }
    });

    // ── Sheet 2: Unit Count ─────────────────────────────────────────
    const wsUnits = wb.addWorksheet('2-Unit Count');
    const unitTypeCols = store.unitTypes.length;
    wsUnits.columns = [
      { width: 3 },   // blank col A
      { width: 10 },
      { width: 10 },
      { width: 14 },
      ...store.unitTypes.map(() => ({ width: 6 })),
      { width: 8 },
    ];

    // Row 1: blank
    wsUnits.addRow([]);

    // Row 2: Title "UNIT COUNT" in col B, bold, with border
    const titleRow = wsUnits.addRow([]);
    const titleCell = titleRow.getCell(2);
    titleCell.value = 'UNIT COUNT';
    titleCell.font = { bold: true, size: 11 };
    titleCell.border = allBorders;

    // Row 3: blank
    wsUnits.addRow([]);

    // Row 4: header — [blank] | Bldg | Floor | Unit # | types... | Total
    const unitHeader = wsUnits.addRow(['', 'Bldg', 'Floor', 'Unit #', ...store.unitTypes, 'Total']);
    unitHeader.height = 120;
    unitHeader.eachCell((cell, colNumber) => {
      if (colNumber <= 1) return;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
      cell.border = allBorders;
      cell.alignment = { vertical: 'bottom', wrapText: false };
      if (colNumber > 4 && colNumber <= unitTypeCols + 4) {
        cell.alignment = { textRotation: 90, vertical: 'bottom', horizontal: 'center' };
      }
      if (colNumber === unitTypeCols + 5) {
        cell.alignment = { vertical: 'bottom', horizontal: 'center' };
      }
    });

    // Freeze rows 1-4 (header area) so headings stay visible when scrolling
    wsUnits.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];

    const sortedUnits = [...store.unitNumbers].sort((a, b) => {
      const bldgA = (a.bldg || '').toUpperCase();
      const bldgB = (b.bldg || '').toUpperCase();
      if (bldgA !== bldgB) return bldgA.localeCompare(bldgB, undefined, { numeric: true });
      return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
    });

    sortedUnits.forEach(unit => {
      const flags = store.unitTypes.map(t => unit.assignments[t] ? 1 : '');
      const rowTotal = store.unitTypes.filter(t => unit.assignments[t]).length;
      const row = wsUnits.addRow(['', unit.bldg || '', unit.floor || '', unit.name, ...flags, rowTotal]);
      row.eachCell((cell, colNumber) => {
        if (colNumber <= 1) return;
        cell.border = allBorders;
        if (colNumber > 4) cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
    });

    wsUnits.addRow([]);
    // Total row with SUM formulas so manual edits auto-update
    const dataStartRow = 5; // row 5 is first data row (after blank, title, blank, header)
    const dataEndRow = dataStartRow + sortedUnits.length - 1;
    const totRowValues: any[] = ['', '', '', `TOTAL (${store.unitNumbers.length})`];
    // Placeholder values for types + grand total (will be overwritten by formulas)
    for (let i = 0; i < store.unitTypes.length + 1; i++) totRowValues.push(0);
    const totRow = wsUnits.addRow(totRowValues);
    const ucTotRowNum = totRow.number;

    // Helper to convert 1-based column number to Excel letter(s)
    const ucColLetter = (col: number) => {
      let n = col; let s = '';
      while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
      return s;
    };

    // Set SUM formulas for each type column (columns starting at col 5 = E)
    store.unitTypes.forEach((_t, idx) => {
      const cl = ucColLetter(5 + idx);
      const cell = totRow.getCell(5 + idx);
      const total = unitTypeTotal(store.unitTypes[idx]);
      cell.value = { formula: `SUM(${cl}${dataStartRow}:${cl}${dataEndRow})`, result: total } as any;
    });
    // Grand total column = SUM of type totals in this row
    const grandTotalCol = 5 + store.unitTypes.length;
    const grandTotalCell = totRow.getCell(grandTotalCol);
    const grandTotal = store.unitTypes.reduce((s, t) => s + unitTypeTotal(t), 0);
    grandTotalCell.value = { formula: `SUM(${ucColLetter(5)}${ucTotRowNum}:${ucColLetter(4 + store.unitTypes.length)}${ucTotRowNum})`, result: grandTotal } as any;

    totRow.eachCell((cell, colNumber) => {
      if (colNumber <= 1) return;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      cell.border = allBorders;
      if (colNumber > 4) cell.alignment = { horizontal: 'center' };
    });

    // ── Sheet 3: Cabinet Count ──────────────────────────────────────
    const wsCabs = wb.addWorksheet('3-Cabinet Count');
    const cabTypes = store.cabinetUnitTypes;
    const nTypes = cabTypes.length;

    const unitCountPerType: Record<string, number> = {};
    for (const t of cabTypes) {
      unitCountPerType[t] = countUnitsForType(t);
    }

    // Excel helpers
    const excelCol = (col: number) => {
      let n = col;
      let s = '';
      while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
      }
      return s;
    };
    const ref = (col: number, row: number) => `${excelCol(col)}${row}`;
    const setFormula = (cell: ExcelJS.Cell, formula: string, result: number | string = 0) => {
      cell.value = { formula, result } as any;
    };

    // Excel-safe wrappers to prevent #VALUE!/errors when inputs are blank/text
    const n = (expr: string) => `N(${expr})`;
    const safeMul = (a: string, b: string) => `IFERROR(${n(a)}*${n(b)},0)`;
    const safeAdd = (a: string, b: string) => `IFERROR(${n(a)}+${n(b)},0)`;
    const safeSum = (startRef: string, endRef: string) => `IFERROR(SUM(${startRef}:${endRef}),0)`;
    const safeSumColRange = (colRef: string, startRow: number, endRow: number) =>
      `IFERROR(SUM(${colRef}${startRow}:${colRef}${endRow}),0)`;

    // Column layout (1-indexed)
    const colSku = 1;
    const colCabFirstType = 2;
    const colCabTotal = colCabFirstType + nTypes;
    const colSpacer1 = colCabTotal + 1;

    const colPullsPerCab = colSpacer1 + 1;
    const colPullsFirstType = colPullsPerCab + 1;
    const colPullsTotal = colPullsFirstType + nTypes;
    const colSpacer2 = colPullsTotal + 1;

    const colPricingBid = colSpacer2 + 1;
    const colPricingAdditional = colSpacer2 + 2;
    const colPricingTotal = colSpacer2 + 3;
    const colPricingFirstType = colSpacer2 + 4;
    const colPricingTypeTotal = colPricingFirstType + nTypes;
    const colSpacer3 = colPricingTypeTotal + 1;

    const colTotalCabLabel = colSpacer3 + 1;
    const colTotalCabFirstType = colTotalCabLabel + 1;
    const colTotalCabGrand = colTotalCabFirstType + nTypes;

    // Cabinet Count Per Unit section (right of Total Cabinet Count)
    const colSpacer4 = colTotalCabGrand + 1;
    const colCpuLabel = colSpacer4 + 1;
    const colCpuFirstType = colCpuLabel + 1;

    const pricingStart = colSpacer2; // keep naming used below
    const totalCabStart = colSpacer3; // keep naming used below

    // Column widths (kept consistent with existing layout)
    const colWidths: { width: number }[] = [];
    colWidths.push({ width: 22 });
    for (let i = 0; i < nTypes; i++) colWidths.push({ width: 6 });
    colWidths.push({ width: 8 });
    colWidths.push({ width: 3 });
    colWidths.push({ width: 10 });
    for (let i = 0; i < nTypes; i++) colWidths.push({ width: 6 });
    colWidths.push({ width: 8 });
    colWidths.push({ width: 3 });
    colWidths.push({ width: 10 }); // Bid Cost
    colWidths.push({ width: 10 }); // Additional
    colWidths.push({ width: 10 }); // Total Cost
    for (let i = 0; i < nTypes; i++) colWidths.push({ width: 8 });
    colWidths.push({ width: 10 });
    colWidths.push({ width: 3 });
    colWidths.push({ width: 14 });
    for (let i = 0; i < nTypes; i++) colWidths.push({ width: 6 });
    colWidths.push({ width: 8 });
    // Spacer + Cabinet Count Per Unit
    colWidths.push({ width: 3 });
    colWidths.push({ width: 18 });
    for (let i = 0; i < nTypes; i++) colWidths.push({ width: 6 });
    wsCabs.columns = colWidths;

    // Section headers
    const sectionRow = wsCabs.addRow([]);
    sectionRow.getCell(colSku).value = 'CABINET COUNT';
    sectionRow.getCell(colSku).font = { bold: true, size: 9 };
    sectionRow.getCell(colPullsPerCab).value = 'PULLS';
    sectionRow.getCell(colPullsPerCab).font = { bold: true, size: 9 };
    sectionRow.getCell(colPricingBid).value = 'PRICING';
    sectionRow.getCell(colPricingBid).font = { bold: true, size: 9 };
    sectionRow.getCell(colTotalCabLabel).value = 'TOTAL CABINET COUNT';
    sectionRow.getCell(colTotalCabLabel).font = { bold: true, size: 9 };
    sectionRow.getCell(colCpuLabel).value = '*Cabinet Count Per Unit';
    sectionRow.getCell(colCpuLabel).font = { bold: true, size: 9 };

    // Unit count reference row (used by formulas)
    const unitCountRow = wsCabs.addRow([]);
    unitCountRow.getCell(colTotalCabLabel).value = 'Unit Count';
    unitCountRow.getCell(colTotalCabLabel).font = { bold: true, italic: true, size: 8 };
    for (let i = 0; i < nTypes; i++) {
      const cell = unitCountRow.getCell(colTotalCabFirstType + i);
      cell.value = unitCountPerType[cabTypes[i]] || 0;
      cell.alignment = { horizontal: 'center' };
      cell.font = { bold: true, size: 8 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
    }
    const totalUnitCount = Object.values(unitCountPerType).reduce((s, v) => s + v, 0);
    const ucTotalCell = unitCountRow.getCell(colTotalCabFirstType + nTypes);
    ucTotalCell.value = totalUnitCount;
    ucTotalCell.alignment = { horizontal: 'center' };
    ucTotalCell.font = { bold: true, size: 8 };
    ucTotalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };

    // Header row
    const headerValues: (string | number)[] = [];
    headerValues.push('SKU Name');
    cabTypes.forEach(t => headerValues.push(t));
    headerValues.push('Total');
    headerValues.push('');
    headerValues.push('Pulls/Cab');
    cabTypes.forEach(t => headerValues.push(t));
    headerValues.push('Total');
    headerValues.push('');
    headerValues.push('Bid Cost');
    headerValues.push('Additional');
    headerValues.push('Total Cost');
    cabTypes.forEach(t => headerValues.push(t));
    headerValues.push('Total');
    headerValues.push('');
    headerValues.push('Total Cab Count');
    cabTypes.forEach(t => headerValues.push(t));
    headerValues.push('Grand Total');
    // Cabinet Count Per Unit section
    headerValues.push('');
    headerValues.push('Cab Count/Unit');
    cabTypes.forEach(t => headerValues.push(t));

    const cabHeader = wsCabs.addRow(headerValues);
    cabHeader.height = 120;
    cabHeader.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
      cell.alignment = { vertical: 'bottom', wrapText: false };
      const idx = colNumber - 1;
      if ((idx >= 1 && idx <= nTypes) ||
          (idx >= colPullsFirstType - 1 && idx <= colPullsFirstType - 2 + nTypes) ||
          (idx >= colPricingFirstType - 1 && idx <= colPricingFirstType - 2 + nTypes) ||
          (idx >= colTotalCabFirstType - 1 && idx <= colTotalCabFirstType - 2 + nTypes) ||
          (idx >= colCpuFirstType - 1 && idx <= colCpuFirstType - 2 + nTypes)) {
        cell.alignment = { textRotation: 90, vertical: 'bottom', horizontal: 'center' };
      }
    });

    // Freeze: top 3 rows (section headers + unit count ref + column headers) AND first column (SKU Name)
    wsCabs.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }];

    const dataRangeStartRow = cabHeader.number + 1;

    const CABINET_BOX_TYPES = new Set(['Wall', 'Base', 'Tall', 'Vanity']);

    // Data rows
    groupedSkus.forEach(({ group, skus }) => {
      const groupRow = wsCabs.addRow([`${group} (${skus.length})`]);
      groupRow.eachCell(cell => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAEAEA' } };
      });

      const isCabinetBox = CABINET_BOX_TYPES.has(group);

      skus.forEach(sku => {
        const pullsPerCab = store.handleQtyPerSku[sku] || 0;

        // Build row with only the editable inputs + base quantities; everything else becomes formulas
        const rowValues: (string | number)[] = [];
        rowValues.push(sku);

        // Cabinet quantities per type
        cabTypes.forEach(t => {
          const qty = skuTypeQty[sku]?.[t] || 0;
          rowValues.push(qty > 0 ? qty : '');
        });

        // Cabinet total (formula set after row is created)
        rowValues.push('');
        rowValues.push('');

        // Pulls/Cab (editable)
        rowValues.push(pullsPerCab || '');

        // Pulls per type + total (formulas)
        cabTypes.forEach(() => rowValues.push(''));
        rowValues.push('');
        rowValues.push('');

        // Pricing (formulas)
        rowValues.push('');
        rowValues.push('');
        rowValues.push('');
        cabTypes.forEach(() => rowValues.push(''));
        rowValues.push('');
        rowValues.push('');

        // Total cabinet count (formulas)
        rowValues.push('');
        cabTypes.forEach(() => rowValues.push(''));
        rowValues.push('');

        // Cabinet Count Per Unit (spacer + label + types)
        rowValues.push('');
        rowValues.push(''); // label col stays blank for data rows
        cabTypes.forEach(t => {
          if (isCabinetBox) {
            const qty = skuTypeQty[sku]?.[t] || 0;
            rowValues.push(qty > 0 ? qty : '');
          } else {
            rowValues.push(''); // accessories left blank
          }
        });

        const row = wsCabs.addRow(rowValues);
        const r = row.number;

        // Yellow background for TK8, CM8, LR8, TF3X96-Molding, Scribe quantity cells
        const yellowSkus = ['TK8', 'CM8', 'LR8', 'TF3X96-MOLDING', 'SCRIBE'];
        if (yellowSkus.includes(sku.toUpperCase())) {
          const yellowFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFFF00' } };
          for (let i = 0; i < nTypes; i++) {
            row.getCell(colCabFirstType + i).fill = yellowFill;
          }
        }

        // Cabinet Total = SUM(cab type cols)
        setFormula(
          row.getCell(colCabTotal),
          nTypes > 0
            ? safeSum(ref(colCabFirstType, r), ref(colCabFirstType + nTypes - 1, r))
            : '0',
          0
        );

        // Pulls per type = Pulls/Cab * Cabinet Qty (safe: blank/text => 0)
        for (let i = 0; i < nTypes; i++) {
          const cabQtyCell = ref(colCabFirstType + i, r);
          const pullsPerCabCell = ref(colPullsPerCab, r);
          setFormula(row.getCell(colPullsFirstType + i), safeMul(pullsPerCabCell, cabQtyCell), 0);
        }
        // Pulls Total = SUM(pulls type cols)
        setFormula(
          row.getCell(colPullsTotal),
          nTypes > 0
            ? safeSum(ref(colPullsFirstType, r), ref(colPullsFirstType + nTypes - 1, r))
            : '0',
          0
        );

        // Total cabinet count per type = Cabinet Qty * Unit Count (row 2)
        for (let i = 0; i < nTypes; i++) {
          const cabQtyCell = ref(colCabFirstType + i, r);
          const unitCountAbs = `$${excelCol(colTotalCabFirstType + i)}$${unitCountRow.number}`;
          setFormula(row.getCell(colTotalCabFirstType + i), safeMul(cabQtyCell, unitCountAbs), 0);
        }
        setFormula(
          row.getCell(colTotalCabGrand),
          nTypes > 0
            ? safeSum(ref(colTotalCabFirstType, r), ref(colTotalCabFirstType + nTypes - 1, r))
            : '0',
          0
        );

        // Pricing (uses per-type Bid/Additional rows written after totals; formulas patched later)
        row.eachCell((cell, colNumber) => {
          if (colNumber > 1) cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });
      });
    });

    const dataRangeEndRow = wsCabs.lastRow?.number || dataRangeStartRow;

    // Totals row (all formulas so Excel recalculates after edits)
    wsCabs.addRow([]);
    const cabTotRow = wsCabs.addRow([]);
    cabTotRow.getCell(colSku).value = `TOTAL (${allSkus.length})`;

     // Cabinet section totals
     for (let i = 0; i < nTypes; i++) {
       setFormula(
         cabTotRow.getCell(colCabFirstType + i),
         safeSumColRange(excelCol(colCabFirstType + i), dataRangeStartRow, dataRangeEndRow),
         0
       );
     }
     setFormula(
       cabTotRow.getCell(colCabTotal),
       safeSumColRange(excelCol(colCabTotal), dataRangeStartRow, dataRangeEndRow),
       0
     );

     // Pulls section totals
     for (let i = 0; i < nTypes; i++) {
       setFormula(
         cabTotRow.getCell(colPullsFirstType + i),
         safeSumColRange(excelCol(colPullsFirstType + i), dataRangeStartRow, dataRangeEndRow),
         0
       );
     }
     setFormula(
       cabTotRow.getCell(colPullsTotal),
       safeSumColRange(excelCol(colPullsTotal), dataRangeStartRow, dataRangeEndRow),
       0
     );

     // Pricing totals (safe so blanks/missing data never show #VALUE!)
     setFormula(
       cabTotRow.getCell(colPricingBid),
       safeSumColRange(excelCol(colPricingBid), dataRangeStartRow, dataRangeEndRow),
       0
     );
     setFormula(
       cabTotRow.getCell(colPricingAdditional),
       safeSumColRange(excelCol(colPricingAdditional), dataRangeStartRow, dataRangeEndRow),
       0
     );
     setFormula(
       cabTotRow.getCell(colPricingTotal),
       safeSumColRange(excelCol(colPricingTotal), dataRangeStartRow, dataRangeEndRow),
       0
     );
     for (let i = 0; i < nTypes; i++) {
       setFormula(
         cabTotRow.getCell(colPricingFirstType + i),
         safeSumColRange(excelCol(colPricingFirstType + i), dataRangeStartRow, dataRangeEndRow),
         0
       );
     }
     setFormula(
       cabTotRow.getCell(colPricingTypeTotal),
       safeSumColRange(excelCol(colPricingTypeTotal), dataRangeStartRow, dataRangeEndRow),
       0
     );

     // Total cabinet count totals
     cabTotRow.getCell(colTotalCabLabel).value = 'TOTAL';
     for (let i = 0; i < nTypes; i++) {
       setFormula(
         cabTotRow.getCell(colTotalCabFirstType + i),
         safeSumColRange(excelCol(colTotalCabFirstType + i), dataRangeStartRow, dataRangeEndRow),
         0
       );
     }
     setFormula(
       cabTotRow.getCell(colTotalCabGrand),
       safeSumColRange(excelCol(colTotalCabGrand), dataRangeStartRow, dataRangeEndRow),
       0
     );

    // Style totals row
    cabTotRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      if (colNumber > 1) cell.alignment = { horizontal: 'center' };
    });

    // Pricing inputs (editable) + per-type total cost (formula)
    const bidCostRow = wsCabs.addRow([]);
    bidCostRow.getCell(colPricingBid).value = 'Bid Cost/Type';
    bidCostRow.getCell(colPricingBid).font = { bold: true, italic: true, size: 8 };
    for (let i = 0; i < nTypes; i++) {
      const cell = bidCostRow.getCell(colPricingFirstType + i);
      cell.value = store.bidCostPerType[cabTypes[i]] || 0;
      cell.numFmt = '$#,##0.00';
      cell.alignment = { horizontal: 'center' };
      cell.font = { italic: true, size: 8 };
    }

    const addCostRow = wsCabs.addRow([]);
    addCostRow.getCell(colPricingAdditional).value = 'Additional/Type';
    addCostRow.getCell(colPricingAdditional).font = { bold: true, italic: true, size: 8 };
    for (let i = 0; i < nTypes; i++) {
      const cell = addCostRow.getCell(colPricingFirstType + i);
      cell.value = store.additionalCostPerType[cabTypes[i]] || 0;
      cell.numFmt = '$#,##0.00';
      cell.alignment = { horizontal: 'center' };
      cell.font = { italic: true, size: 8 };
    }

     const totalCostRow = wsCabs.addRow([]);
     totalCostRow.getCell(colPricingTotal).value = 'Total/Type';
     totalCostRow.getCell(colPricingTotal).font = { bold: true, italic: true, size: 8 };
     for (let i = 0; i < nTypes; i++) {
       const cell = totalCostRow.getCell(colPricingFirstType + i);
       const bidAbs = `$${excelCol(colPricingFirstType + i)}$${bidCostRow.number}`;
       const addAbs = `$${excelCol(colPricingFirstType + i)}$${addCostRow.number}`;
       setFormula(cell, safeAdd(bidAbs, addAbs), 0);
       cell.numFmt = '$#,##0.00';
       cell.alignment = { horizontal: 'center' };
       cell.font = { italic: true, size: 8 };
     }

    // Patch pricing formulas onto each SKU row now that we know the pricing input row numbers
    for (let r = dataRangeStartRow; r <= dataRangeEndRow; r++) {
      // Skip group rows (they have text in SKU column and no numbers elsewhere)
      const skuVal = wsCabs.getRow(r).getCell(colSku).value;
      if (typeof skuVal !== 'string' || skuVal.includes('(')) continue;

       const partsBid: string[] = [];
       const partsAdd: string[] = [];
       const pricingTypeRefs: string[] = [];

       const rowObj = wsCabs.getRow(r);
       const bidCell = rowObj.getCell(colPricingBid);
       const addCell = rowObj.getCell(colPricingAdditional);
       const totCell = rowObj.getCell(colPricingTotal);
       const typeTotCell = rowObj.getCell(colPricingTypeTotal);

       // If there are no cabinet unit types yet, keep pricing as 0s (prevents invalid SUM ranges)
       if (nTypes === 0) {
         setFormula(bidCell, '0', 0);
         setFormula(addCell, '0', 0);
         setFormula(totCell, '0', 0);
         setFormula(typeTotCell, '0', 0);
         continue;
       }

       for (let i = 0; i < nTypes; i++) {
         const totalCabRef = ref(colTotalCabFirstType + i, r);
         const bidAbs = `$${excelCol(colPricingFirstType + i)}$${bidCostRow.number}`;
         const addAbs = `$${excelCol(colPricingFirstType + i)}$${addCostRow.number}`;
         const totAbs = `$${excelCol(colPricingFirstType + i)}$${totalCostRow.number}`;

         partsBid.push(safeMul(totalCabRef, bidAbs));
         partsAdd.push(safeMul(totalCabRef, addAbs));

         const typeCell = rowObj.getCell(colPricingFirstType + i);
         setFormula(typeCell, safeMul(totalCabRef, totAbs), 0);
         typeCell.numFmt = '$#,##0.00';

         pricingTypeRefs.push(ref(colPricingFirstType + i, r));
       }

       setFormula(bidCell, partsBid.length ? partsBid.join('+') : '0', 0);
       setFormula(addCell, partsAdd.length ? partsAdd.join('+') : '0', 0);
       setFormula(totCell, safeAdd(ref(colPricingBid, r), ref(colPricingAdditional, r)), 0);
       setFormula(
         typeTotCell,
         pricingTypeRefs.length ? safeSum(pricingTypeRefs[0], pricingTypeRefs[pricingTypeRefs.length - 1]) : '0',
         0
       );

       bidCell.numFmt = '$#,##0.00';
       addCell.numFmt = '$#,##0.00';
       totCell.numFmt = '$#,##0.00';
       typeTotCell.numFmt = '$#,##0.00';
    }

    // ── VTOP section (Swanstone / Cultured Marble) at bottom of Cabinet Count tab ──
    if (store.vtopRows.length > 0) {
      const vanityMaterial = project.specs?.vanityCountertops || '';
      const vtopLabel = vanityMaterial === 'Swanstone' ? 'SWANSTONE VTOPS'
        : vanityMaterial === 'Cultured Marble' ? 'CULTURED MARBLE VTOPS'
        : 'CMARBLE/SWAN VTOPS';

      // Get vtop unit types that actually have data
      const vtopTypes = store.vtopUnitTypes.filter(t =>
        store.vtopRows.some(r => r.unitType === t)
      );
      const nVtopTypes = vtopTypes.length;

      if (nVtopTypes > 0) {
        // 2 blank rows
        wsCabs.addRow([]);
        wsCabs.addRow([]);

        // Vtop section header
        const vtopSectionRow = wsCabs.addRow([]);
        vtopSectionRow.getCell(colSku).value = vtopLabel;
        vtopSectionRow.getCell(colSku).font = { bold: true, size: 9 };

        // Build unique vtop SKU descriptions
        type VtopSkuKey = string;
        interface VtopSkuInfo {
          label: string;       // e.g. "31"X22"D (Center Bowl,One end finish)"
          modNote: string;     // e.g. "EV1B2231" — left blank for user to fill
          typeQty: Record<string, number>;
        }

        const formatVtopLabel = (row: PrefinalVtopRow): string => {
          const size = `${row.length}"X${row.depth}"D`;
          const bowl = row.bowlPosition === 'center'
            ? '(Center Bowl'
            : `(${row.bowlPosition === 'offset-left' ? 'Offset Left' : 'Offset Right'} Bowl`;
          let endFinish: string;
          if (row.leftWall && row.rightWall) {
            endFinish = 'No end finish';
          } else if (row.leftWall && !row.rightWall) {
            endFinish = 'Right end finish';
          } else if (!row.leftWall && row.rightWall) {
            endFinish = 'Left end finish';
          } else {
            endFinish = 'Both end finish';
          }
          return `${size} ${bowl},${endFinish})`;
        };

        const vtopSkuKey = (row: PrefinalVtopRow): string =>
          `${row.length}|${row.depth}|${row.bowlPosition}|${row.bowlOffset ?? 'null'}|${row.leftWall}|${row.rightWall}`;

        const vtopSkuMap = new Map<VtopSkuKey, VtopSkuInfo>();
        // Track left/right sidesplash separately per type
        const leftSsByType: Record<string, number> = {};
        const rightSsByType: Record<string, number> = {};
        const vtopDepth = store.vtopRows[0]?.depth || 22;

        for (const row of store.vtopRows) {
          const key = vtopSkuKey(row);
          if (!vtopSkuMap.has(key)) {
            vtopSkuMap.set(key, {
              label: formatVtopLabel(row),
              modNote: '',
              typeQty: {},
            });
          }
          const info = vtopSkuMap.get(key)!;
          info.typeQty[row.unitType] = (info.typeQty[row.unitType] || 0) + 1;

          // Count left/right sidesplashes separately per type
          if (row.leftWall) {
            leftSsByType[row.unitType] = (leftSsByType[row.unitType] || 0) + 1;
          }
          if (row.rightWall) {
            rightSsByType[row.unitType] = (rightSsByType[row.unitType] || 0) + 1;
          }
        }

        // Vtop header row with rotated type names
        const vtopHeaderValues: (string | number)[] = [];
        vtopHeaderValues.push('ITEM LIST');
        vtopHeaderValues.push('MODIFICATION NOTE');
        vtopTypes.forEach(t => vtopHeaderValues.push(t));

        const vtopHeader = wsCabs.addRow(vtopHeaderValues);
        vtopHeader.height = 120;
        vtopHeader.eachCell((cell, colNumber) => {
          cell.font = { bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
          cell.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
          cell.alignment = { vertical: 'bottom', wrapText: false };
          if (colNumber >= 3 && colNumber <= 2 + nVtopTypes) {
            cell.alignment = { textRotation: 90, vertical: 'bottom', horizontal: 'center' };
          }
        });

        // Vtop SKU rows
        for (const [, info] of vtopSkuMap) {
          const rowValues: (string | number)[] = [];
          rowValues.push(info.label);
          rowValues.push(info.modNote);
          vtopTypes.forEach(t => {
            const qty = info.typeQty[t] || 0;
            rowValues.push(qty > 0 ? qty : '');
          });
          const row = wsCabs.addRow(rowValues);
          row.getCell(1).font = { size: 9 };
          row.getCell(1).border = { left: { style: 'thin', color: { argb: 'FF4472C4' } }, bottom: { style: 'thin', color: { argb: 'FF4472C4' } } };
          row.getCell(2).font = { size: 9 };
          for (let i = 0; i < nVtopTypes; i++) {
            row.getCell(3 + i).alignment = { horizontal: 'center' };
          }
        }

        // Left end sidesplash row
        const hasLeftSs = Object.values(leftSsByType).some(v => v > 0);
        if (hasLeftSs) {
          const vals: (string | number)[] = [`${vtopDepth}"D Left end sidesplash`, ''];
          vtopTypes.forEach(t => { const q = leftSsByType[t] || 0; vals.push(q > 0 ? q : ''); });
          const row = wsCabs.addRow(vals);
          row.getCell(1).font = { size: 9 };
          for (let i = 0; i < nVtopTypes; i++) row.getCell(3 + i).alignment = { horizontal: 'center' };
        }

        // Right end sidesplash row
        const hasRightSs = Object.values(rightSsByType).some(v => v > 0);
        if (hasRightSs) {
          const vals: (string | number)[] = [`${vtopDepth}"D Right end sidesplash`, ''];
          vtopTypes.forEach(t => { const q = rightSsByType[t] || 0; vals.push(q > 0 ? q : ''); });
          const row = wsCabs.addRow(vals);
          row.getCell(1).font = { size: 9 };
          for (let i = 0; i < nVtopTypes; i++) row.getCell(3 + i).alignment = { horizontal: 'center' };
        }
      }
    }


    // ── Sheet 4: Costing ────────────────────────────────────────────
    const wsCosting = wb.addWorksheet('4-Costing');

    // Column indices (1-based) — col 1 is blank pad
    const cc = {
      blank: 1, type: 2, qty: 3, cabsCost: 4,
      pullsQty: 5, pullsCost: 6,
      plamLft: 7, plamSlab: 8, plamTotalLft: 9, plamCost: 10,
      plamSsQty: 11, plamSsCost: 12,
      bartopLft: 13, bartopSlab: 14, bartopTotalLft: 15, bartopCost: 16,
      ktopSqft: 17, ktopCost: 18,
      kTopSqftOnly: 19, kBackSplash: 20, kSinkCutout: 21, kFaucetHoles: 22, kRangeCutout: 23,
      vtopSqft: 24, vtopCost: 25,
      vTopSqftOnly: 26, vBackSplash: 27, vSinkCutout: 28, vFaucetHoles: 29,
      stickQty: 30, stickCost: 31,
      dwQty: 32, dwCost: 33,
      laborCost: 34, deliveryCost: 35, ldCost: 36,
      costPerUnit: 37, costExt: 38,
      spacer: 39,
      cabsRetail: 40, pullsRetail: 41, plamRetail: 42, ktopRetail: 43, vtopRetail: 44,
      stickRetail: 45, dwRetail: 46, laborRetail: 47, deliveryRetail: 48, ldRetail: 49,
      retailPerUnit: 50, retailExt: 51,
      spacer2: 52,
      cabsTotalCost: 53, cabsTotalRetail: 54,
      pullsTotalCost: 55, pullsTotalRetail: 56,
      plamTotalCostCol: 57, plamTotalRetailCol: 58,
      ktopTotalCost: 59, ktopTotalRetail: 60,
      vtopTotalCost: 61, vtopTotalRetail: 62,
      stickTotalCost: 63, stickTotalRetail: 64,
      dwTotalCost: 65, dwTotalRetail: 66,
      laborTotalCost: 67, laborTotalRetail: 68,
      deliveryTotalCost: 69, deliveryTotalRetail: 70,
      ldTotalCost: 71, ldTotalRetail: 72,
      material: 73, labor: 74, tax: 75,
      retailPerUnit2: 76, retailExt2: 77,
      spacer3: 78,
      sumLabel: 79, sumRetail: 80, sumMargin: 81,
      spacer4: 82, sumCost: 83,
    };

    const SAFFRON = 'FFFFF2CC';

    wsCosting.columns = [
      { width: 3 },   // blank col A
      { width: 30 }, { width: 8 }, { width: 14 },
      { width: 10 }, { width: 12 },
      { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 }, // PLAM LFT, SLAB, TOTAL LFT, COST
      { width: 10 }, { width: 14 }, // PLAM SS QTY, PLAM SS COST
      { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 }, // BARTOP LFT, SLAB, TOTAL LFT, COST
      { width: 10 }, { width: 14 },
      { width: 10 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 14 },
      { width: 10 }, { width: 14 },
      { width: 10 }, { width: 14 }, { width: 14 }, { width: 12 },
      { width: 10 }, { width: 12 },
      { width: 10 }, { width: 12 },
      { width: 12 }, { width: 12 }, { width: 12 },
      { width: 14 }, { width: 14 },
      { width: 3 },
      { width: 12 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 },
      { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
      { width: 14 }, { width: 14 },
      { width: 3 },
      { width: 14 }, { width: 14 },
      { width: 14 }, { width: 14 },
      { width: 14 }, { width: 14 },
      { width: 14 }, { width: 14 },
      { width: 14 }, { width: 14 },
      { width: 14 }, { width: 14 },
      { width: 14 }, { width: 14 },
      { width: 14 }, { width: 14 },
      { width: 14 }, { width: 14 },
      { width: 14 }, { width: 14 },
      { width: 14 }, { width: 14 }, { width: 14 },
      { width: 3 },
      { width: 28 }, { width: 16 }, { width: 10 },
      { width: 3 }, { width: 16 },
    ];

    // Row 1: Section titles
    const secTitleRow = wsCosting.addRow([]);
    secTitleRow.getCell(cc.plamLft).value = 'PLAM KTOP';
    secTitleRow.getCell(cc.plamLft).font = { bold: true, size: 9 };
    secTitleRow.getCell(cc.ktopSqft).value = 'STONE / SOLID SURFACE K-TOPS';
    secTitleRow.getCell(cc.ktopSqft).font = { bold: true, size: 9 };
    secTitleRow.getCell(cc.vtopSqft).value = 'STONE / SOLID SURFACE V-TOPS';
    secTitleRow.getCell(cc.vtopSqft).font = { bold: true, size: 9 };
    secTitleRow.getCell(cc.cabsRetail).value = 'RETAIL';
    secTitleRow.getCell(cc.cabsRetail).font = { bold: true, size: 9 };
    secTitleRow.getCell(cc.cabsTotalCost).value = 'TOTAL COST & TOTAL RETAIL';
    secTitleRow.getCell(cc.cabsTotalCost).font = { bold: true, size: 9 };

    // Row 2: Column headers
    const costHeaders: Record<number, string> = {
      [cc.type]: 'Unit types',
      [cc.qty]: 'QTY',
      [cc.cabsCost]: 'CABS\nCOST',
      [cc.pullsQty]: 'PULLS\nQTY',
      [cc.pullsCost]: 'PULLS\nCOST',
      [cc.plamLft]: 'KTOP\nLFT',
      [cc.plamSlab]: 'KTOP\nSLAB',
      [cc.plamTotalLft]: 'TOTAL\nKTOP LFT',
      [cc.plamCost]: 'PLAM\nKTOP COST',
      [cc.plamSsQty]: 'PLAM KTOP\nSS',
      [cc.plamSsCost]: 'PLAM KTOP\nSS COST',
      [cc.bartopLft]: 'BARTOP\nLFT',
      [cc.bartopSlab]: 'BARTOP\nSLAB',
      [cc.bartopTotalLft]: 'TOTAL\nBARTOP LFT',
      [cc.bartopCost]: 'PLAM\nBARTOP COST',
      [cc.ktopSqft]: 'KTOP\nSQFT',
      [cc.ktopCost]: 'QUARTZ GRP1\nKTOP COST',
      [cc.kTopSqftOnly]: 'TOP\nSQFT',
      [cc.kBackSplash]: 'BACK &\nSIDESPLASH\nSQFT',
      [cc.kSinkCutout]: 'UNDERMOUNT\nKITCHEN SINK\nCUTOUT',
      [cc.kFaucetHoles]: 'FAUCET\nHOLES\n(select upto 3)',
      [cc.kRangeCutout]: 'FREE STANDING\nRANGE CUTOUT\nQTY',
      [cc.vtopSqft]: 'VTOP\nSQFT',
      [cc.vtopCost]: 'QUARTZ GRP1\nVTOP COST',
      [cc.vTopSqftOnly]: 'TOP\nSQFT',
      [cc.vBackSplash]: 'BACK &\nSIDESPLASH\nSQFT',
      [cc.vSinkCutout]: 'UNDERMOUNT\nVANITY SINK\nCUTOUT',
      [cc.vFaucetHoles]: 'FAUCET HOLES\nfor each sink\n(select)',
      [cc.stickQty]: '2X3X8\nSTICK QTY',
      [cc.stickCost]: '2X3X8\nSTICK COST',
      [cc.dwQty]: 'DW\nBRACKETS\nQTY',
      [cc.dwCost]: 'DW\nBRACKETS\nCOST',
      [cc.laborCost]: 'LABOR\nCOST',
      [cc.deliveryCost]: 'DELIVERY\nCOST',
      [cc.ldCost]: 'LOAD &\nDISTRIBUTION\nCOST',
      [cc.costPerUnit]: 'COST\nPER UNIT',
      [cc.costExt]: 'COST\nEXT',
      [cc.cabsRetail]: 'CABS\nRETAIL',
      [cc.pullsRetail]: 'PULLS\nRETAIL',
      [cc.plamRetail]: 'PLAM KTOP\nRETAIL',
      [cc.ktopRetail]: 'QUARTZ KTOP\nGRP1 RETAIL',
      [cc.vtopRetail]: 'QUARTZ VTOP\nGRP1 RETAIL',
      [cc.stickRetail]: '2X3X8\nRETAIL',
      [cc.dwRetail]: 'DW BRACKETS\nRETAIL',
      [cc.laborRetail]: 'LABOR\nRETAIL',
      [cc.deliveryRetail]: 'DELIVERY\nRETAIL',
      [cc.ldRetail]: 'LOAD &\nDISTRIBUTION\nRETAIL',
      [cc.retailPerUnit]: 'RETAIL\nPER UNIT',
      [cc.retailExt]: 'RETAIL\nEXT',
      [cc.cabsTotalCost]: 'CABS\nTOTAL COST',
      [cc.cabsTotalRetail]: 'CABS\nTOTAL RETAIL',
      [cc.pullsTotalCost]: 'PULLS\nTOTAL COST',
      [cc.pullsTotalRetail]: 'PULLS\nTOTAL RETAIL',
      [cc.plamTotalCostCol]: 'PLAM KTOP\nTOTAL COST',
      [cc.plamTotalRetailCol]: 'PLAM KTOP\nTOTAL RETAIL',
      [cc.ktopTotalCost]: 'QUARTZ GRP1\nKTOP\nTOTAL COST',
      [cc.ktopTotalRetail]: 'QUARTZ GRP1\nKTOP\nTOTAL RETAIL',
      [cc.vtopTotalCost]: 'QUARTZ GRP1\nVTOP\nTOTAL COST',
      [cc.vtopTotalRetail]: 'QUARTZ GRP1\nVTOP\nTOTAL RETAIL',
      [cc.stickTotalCost]: '2X3X8\nTOTAL COST',
      [cc.stickTotalRetail]: '2X3X8\nTOTAL RETAIL',
      [cc.dwTotalCost]: 'DW BRACKETS\nTOTAL COST',
      [cc.dwTotalRetail]: 'DW BRACKETS\nTOTAL RETAIL',
      [cc.laborTotalCost]: 'LABOR\nTOTAL COST',
      [cc.laborTotalRetail]: 'LABOR\nTOTAL RETAIL',
      [cc.deliveryTotalCost]: 'DELIVERY\nTOTAL COST',
      [cc.deliveryTotalRetail]: 'DELIVERY\nTOTAL RETAIL',
      [cc.ldTotalCost]: 'LOAD & DIST\nTOTAL COST',
      [cc.ldTotalRetail]: 'LOAD & DIST\nTOTAL RETAIL',
      [cc.material]: 'MATERIAL',
      [cc.labor]: 'LABOR',
      [cc.tax]: 'TAX',
      [cc.retailPerUnit2]: 'RETAIL\nPER UNIT',
      [cc.retailExt2]: 'RETAIL\nEXT',
    };

    const costHeaderRow2 = wsCosting.addRow([]);
    Object.entries(costHeaders).forEach(([col, label]) => {
      const cell = costHeaderRow2.getCell(Number(col));
      cell.value = label;
      cell.font = { bold: true, size: 8 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
      cell.border = allBorders;
      cell.alignment = { vertical: 'bottom', wrapText: true, horizontal: 'center' };
    });
    costHeaderRow2.getCell(cc.type).alignment = { vertical: 'bottom', wrapText: true, horizontal: 'left' };
    costHeaderRow2.height = 80;

    // Row 3: Saffron rate/multiplier row (user-editable rates)
    const costRateRow = wsCosting.addRow([]);
    const saffronCostCols = [cc.pullsCost, cc.plamCost, cc.plamSsCost, cc.bartopCost, cc.ktopCost, cc.vtopCost, cc.stickCost, cc.dwCost, cc.deliveryCost, cc.ldCost];
    const saffronRetailCols = [cc.cabsRetail, cc.pullsRetail, cc.plamRetail, cc.ktopRetail, cc.vtopRetail, cc.stickRetail, cc.dwRetail, cc.laborRetail, cc.deliveryRetail, cc.ldRetail];
    const saffronTotalCols = [cc.tax]; // tax multiplier
    [...saffronCostCols, ...saffronRetailCols, ...saffronTotalCols].forEach(col => {
      const cell = costRateRow.getCell(col);
      cell.value = (col === cc.deliveryCost || col === cc.ldCost) ? 100 : 0;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SAFFRON } };
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center' };
    });
    saffronCostCols.forEach(col => { costRateRow.getCell(col).numFmt = '$#,##0.00'; });

    const costRateRowNum = costRateRow.number;
    const costDataStart = costRateRowNum + 1;

    // Build mapping from cabType to Unit Count sheet column index (1-based, types start at col 5)
    const ucTypeIndexMap: Record<string, number> = {};
    store.unitTypes.forEach((ut, idx) => { ucTypeIndexMap[normalizeTypeKey(ut)] = idx; });
    const ucHeaderRow = 4; // Unit Count header row

    // Data rows per unit type
    cabTypes.forEach((t, i) => {
      const row = wsCosting.addRow([]);
      const r = row.number;

      // TYPE NAME — reference Unit Count sheet header if possible
      const ucIdx = ucTypeIndexMap[normalizeTypeKey(t)];
      if (ucIdx !== undefined) {
        const ucTypeCol = ucColLetter(5 + ucIdx);
        setFormula(row.getCell(cc.type), `'2-Unit Count'!${ucTypeCol}${ucHeaderRow}`, t);
      } else {
        row.getCell(cc.type).value = t;
      }
      row.getCell(cc.type).border = allBorders;
      row.getCell(cc.qty).border = allBorders;

      // QTY — reference Unit Count sheet total row
      if (ucIdx !== undefined) {
        const ucTypeCol = ucColLetter(5 + ucIdx);
        setFormula(row.getCell(cc.qty), `'2-Unit Count'!${ucTypeCol}${ucTotRowNum}`, unitTypeTotal(t));
      } else {
        setFormula(row.getCell(cc.qty), `'3-Cabinet Count'!${ref(colTotalCabFirstType + i, unitCountRow.number)}`, 0);
      }

      // CABS COST per unit
      setFormula(row.getCell(cc.cabsCost), safeMul(
        `'3-Cabinet Count'!${ref(colCabFirstType + i, cabTotRow.number)}`,
        `'3-Cabinet Count'!${ref(colPricingFirstType + i, totalCostRow.number)}`
      ), 0);
      row.getCell(cc.cabsCost).numFmt = '$#,##0.00';

      // PULLS QTY
      setFormula(row.getCell(cc.pullsQty), `'3-Cabinet Count'!${ref(colPullsFirstType + i, cabTotRow.number)}`, 0);

      // PULLS COST = QTY × rate
      setFormula(row.getCell(cc.pullsCost), safeMul(ref(cc.pullsQty, r), `$${excelCol(cc.pullsCost)}$${costRateRowNum}`), 0);
      row.getCell(cc.pullsCost).numFmt = '$#,##0.00';

      // PLAM KTOP LFT, SLAB, TOTAL LFT — blank for user to fill
      row.getCell(cc.plamLft).border = allBorders;
      row.getCell(cc.plamSlab).border = allBorders;
      row.getCell(cc.plamTotalLft).border = allBorders;

      // PLAM KTOP COST = TOTAL KTOP LFT × rate
      setFormula(row.getCell(cc.plamCost), safeMul(ref(cc.plamTotalLft, r), `$${excelCol(cc.plamCost)}$${costRateRowNum}`), 0);
      row.getCell(cc.plamCost).numFmt = '$#,##0.00';

      // PLAM SS COST = SS QTY × rate
      setFormula(row.getCell(cc.plamSsCost), safeMul(ref(cc.plamSsQty, r), `$${excelCol(cc.plamSsCost)}$${costRateRowNum}`), 0);
      row.getCell(cc.plamSsCost).numFmt = '$#,##0.00';

      // BARTOP LFT, SLAB, TOTAL LFT — blank for user
      row.getCell(cc.bartopLft).border = allBorders;
      row.getCell(cc.bartopSlab).border = allBorders;
      row.getCell(cc.bartopTotalLft).border = allBorders;

      // BARTOP COST = TOTAL BARTOP LFT × rate
      setFormula(row.getCell(cc.bartopCost), safeMul(ref(cc.bartopTotalLft, r), `$${excelCol(cc.bartopCost)}$${costRateRowNum}`), 0);
      row.getCell(cc.bartopCost).numFmt = '$#,##0.00';

      // KTOP COST
      setFormula(row.getCell(cc.ktopCost), safeMul(ref(cc.ktopSqft, r), `$${excelCol(cc.ktopCost)}$${costRateRowNum}`), 0);
      row.getCell(cc.ktopCost).numFmt = '$#,##0.00';

      // VTOP COST
      setFormula(row.getCell(cc.vtopCost), safeMul(ref(cc.vtopSqft, r), `$${excelCol(cc.vtopCost)}$${costRateRowNum}`), 0);
      row.getCell(cc.vtopCost).numFmt = '$#,##0.00';

      // 2X3X8 STICK COST
      setFormula(row.getCell(cc.stickCost), safeMul(ref(cc.stickQty, r), `$${excelCol(cc.stickCost)}$${costRateRowNum}`), 0);
      row.getCell(cc.stickCost).numFmt = '$#,##0.00';

      // DW BRACKETS COST
      setFormula(row.getCell(cc.dwCost), safeMul(ref(cc.dwQty, r), `$${excelCol(cc.dwCost)}$${costRateRowNum}`), 0);
      row.getCell(cc.dwCost).numFmt = '$#,##0.00';

      // DELIVERY COST = saffron $100 via formula
      setFormula(row.getCell(cc.deliveryCost), `$${excelCol(cc.deliveryCost)}$${costRateRowNum}`, 100);
      row.getCell(cc.deliveryCost).numFmt = '$#,##0.00';

      // LOAD & DISTRIBUTION COST = saffron $100 via formula
      setFormula(row.getCell(cc.ldCost), `$${excelCol(cc.ldCost)}$${costRateRowNum}`, 100);
      row.getCell(cc.ldCost).numFmt = '$#,##0.00';

      // COST PER UNIT = sum of all cost columns (including plamCost + plamSsCost)
      const costCols = [cc.cabsCost, cc.pullsCost, cc.plamCost, cc.plamSsCost, cc.bartopCost, cc.ktopCost, cc.vtopCost, cc.stickCost, cc.dwCost, cc.laborCost, cc.deliveryCost, cc.ldCost];
      setFormula(row.getCell(cc.costPerUnit), `IFERROR(${costCols.map(c => `N(${ref(c, r)})`).join('+')},0)`, 0);
      row.getCell(cc.costPerUnit).numFmt = '$#,##0.00';

      // COST EXT = COST PER UNIT × QTY
      setFormula(row.getCell(cc.costExt), safeMul(ref(cc.costPerUnit, r), ref(cc.qty, r)), 0);
      row.getCell(cc.costExt).numFmt = '$#,##0.00';

      // RETAIL = cost × multiplier (saffron)
      const retailMap = [
        { retail: cc.cabsRetail, cost: cc.cabsCost },
        { retail: cc.pullsRetail, cost: cc.pullsCost },
        { retail: cc.ktopRetail, cost: cc.ktopCost },
        { retail: cc.vtopRetail, cost: cc.vtopCost },
        { retail: cc.stickRetail, cost: cc.stickCost },
        { retail: cc.dwRetail, cost: cc.dwCost },
        { retail: cc.laborRetail, cost: cc.laborCost },
        { retail: cc.deliveryRetail, cost: cc.deliveryCost },
        { retail: cc.ldRetail, cost: cc.ldCost },
      ];
      retailMap.forEach(({ retail, cost }) => {
        setFormula(row.getCell(retail), safeMul(ref(cost, r), `$${excelCol(retail)}$${costRateRowNum}`), 0);
        row.getCell(retail).numFmt = '$#,##0.00';
      });
      // PLAM RETAIL = (plamCost + plamSsCost + bartopCost) × multiplier
      setFormula(row.getCell(cc.plamRetail), `IFERROR((N(${ref(cc.plamCost, r)})+N(${ref(cc.plamSsCost, r)})+N(${ref(cc.bartopCost, r)}))*N($${excelCol(cc.plamRetail)}$${costRateRowNum}),0)`, 0);
      row.getCell(cc.plamRetail).numFmt = '$#,##0.00';

      // RETAIL PER UNIT (includes plamRetail separately since it combines plamCost+plamSsCost)
      const allRetailRefs = [...retailMap.map(m => `N(${ref(m.retail, r)})`), `N(${ref(cc.plamRetail, r)})`];
      setFormula(row.getCell(cc.retailPerUnit), `IFERROR(${allRetailRefs.join('+')},0)`, 0);
      row.getCell(cc.retailPerUnit).numFmt = '$#,##0.00';

      // RETAIL EXT = RETAIL PER UNIT × QTY
      setFormula(row.getCell(cc.retailExt), safeMul(ref(cc.retailPerUnit, r), ref(cc.qty, r)), 0);
      row.getCell(cc.retailExt).numFmt = '$#,##0.00';

      // ── TOTAL COST & TOTAL RETAIL section ──
      const totalPairs = [
        { totalCost: cc.cabsTotalCost, totalRetail: cc.cabsTotalRetail, cost: cc.cabsCost, retail: cc.cabsRetail },
        { totalCost: cc.pullsTotalCost, totalRetail: cc.pullsTotalRetail, cost: cc.pullsCost, retail: cc.pullsRetail },
        { totalCost: cc.plamTotalCostCol, totalRetail: cc.plamTotalRetailCol, cost: cc.plamCost, retail: cc.plamRetail, extraCosts: [cc.plamSsCost, cc.bartopCost] },
        { totalCost: cc.ktopTotalCost, totalRetail: cc.ktopTotalRetail, cost: cc.ktopCost, retail: cc.ktopRetail },
        { totalCost: cc.vtopTotalCost, totalRetail: cc.vtopTotalRetail, cost: cc.vtopCost, retail: cc.vtopRetail },
        { totalCost: cc.stickTotalCost, totalRetail: cc.stickTotalRetail, cost: cc.stickCost, retail: cc.stickRetail },
        { totalCost: cc.dwTotalCost, totalRetail: cc.dwTotalRetail, cost: cc.dwCost, retail: cc.dwRetail },
        { totalCost: cc.laborTotalCost, totalRetail: cc.laborTotalRetail, cost: cc.laborCost, retail: cc.laborRetail },
        { totalCost: cc.deliveryTotalCost, totalRetail: cc.deliveryTotalRetail, cost: cc.deliveryCost, retail: cc.deliveryRetail },
        { totalCost: cc.ldTotalCost, totalRetail: cc.ldTotalRetail, cost: cc.ldCost, retail: cc.ldRetail },
      ];
      totalPairs.forEach(({ totalCost, totalRetail, cost, retail, extraCost }: any) => {
        if (extraCost) {
          // PLAM TOTAL COST = (plamCost + plamSsCost) × QTY
          setFormula(row.getCell(totalCost), `IFERROR((N(${ref(cost, r)})+N(${ref(extraCost, r)}))*N(${ref(cc.qty, r)}),0)`, 0);
        } else {
          setFormula(row.getCell(totalCost), safeMul(ref(cost, r), ref(cc.qty, r)), 0);
        }
        row.getCell(totalCost).numFmt = '$#,##0.00';
        setFormula(row.getCell(totalRetail), safeMul(ref(retail, r), ref(cc.qty, r)), 0);
        row.getCell(totalRetail).numFmt = '$#,##0.00';
      });

      // MATERIAL = sum of all total retail EXCEPT labor, delivery, L&D
      const matRetailCols = [cc.cabsTotalRetail, cc.pullsTotalRetail, cc.plamTotalRetailCol, cc.ktopTotalRetail, cc.vtopTotalRetail, cc.stickTotalRetail, cc.dwTotalRetail];
      setFormula(row.getCell(cc.material), `IFERROR(${matRetailCols.map(c => `N(${ref(c, r)})`).join('+')},0)`, 0);
      row.getCell(cc.material).numFmt = '$#,##0.00';

      // LABOR = labor total retail
      setFormula(row.getCell(cc.labor), `N(${ref(cc.laborTotalRetail, r)})`, 0);
      row.getCell(cc.labor).numFmt = '$#,##0.00';

      // TAX = material × saffron tax rate
      const taxRateAbs = `$${excelCol(cc.tax)}$${costRateRowNum}`;
      setFormula(row.getCell(cc.tax), safeMul(ref(cc.material, r), taxRateAbs), 0);
      row.getCell(cc.tax).numFmt = '$#,##0.00';

      // RETAIL PER UNIT 2 = material + labor + tax
      setFormula(row.getCell(cc.retailPerUnit2), `IFERROR(N(${ref(cc.material, r)})+N(${ref(cc.labor, r)})+N(${ref(cc.tax, r)}),0)`, 0);
      row.getCell(cc.retailPerUnit2).numFmt = '$#,##0.00';

      // RETAIL EXT 2 = retail per unit 2 × qty
      setFormula(row.getCell(cc.retailExt2), safeMul(ref(cc.retailPerUnit2, r), ref(cc.qty, r)), 0);
      row.getCell(cc.retailExt2).numFmt = '$#,##0.00';

      // Center-align all numeric cells
      for (let c = cc.qty; c <= cc.retailExt2; c++) {
        if (c !== cc.spacer && c !== cc.spacer2) row.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
      }
    });

    const costDataEnd = wsCosting.lastRow?.number || costDataStart;

    // TOTAL row
    wsCosting.addRow([]);
    const costTotRow2 = wsCosting.addRow([]);
    costTotRow2.getCell(cc.type).value = 'TOTAL';
    costTotRow2.getCell(cc.type).border = allBorders;
    costTotRow2.getCell(cc.qty).border = allBorders;

    const summedCols = [
      cc.qty, cc.cabsCost, cc.pullsQty, cc.pullsCost,
      cc.plamLft, cc.plamTotalLft, cc.plamCost, cc.plamSsQty, cc.plamSsCost,
      cc.ktopSqft, cc.ktopCost, cc.kTopSqftOnly, cc.kBackSplash, cc.kSinkCutout, cc.kFaucetHoles, cc.kRangeCutout,
      cc.vtopSqft, cc.vtopCost, cc.vTopSqftOnly, cc.vBackSplash, cc.vSinkCutout, cc.vFaucetHoles,
      cc.stickQty, cc.stickCost, cc.dwQty, cc.dwCost, cc.laborCost,
      cc.deliveryCost, cc.ldCost,
      cc.costPerUnit, cc.costExt,
      cc.cabsRetail, cc.pullsRetail, cc.plamRetail, cc.ktopRetail, cc.vtopRetail, cc.stickRetail, cc.dwRetail, cc.laborRetail,
      cc.deliveryRetail, cc.ldRetail,
      cc.retailPerUnit, cc.retailExt,
      cc.cabsTotalCost, cc.cabsTotalRetail, cc.pullsTotalCost, cc.pullsTotalRetail,
      cc.plamTotalCostCol, cc.plamTotalRetailCol,
      cc.ktopTotalCost, cc.ktopTotalRetail, cc.vtopTotalCost, cc.vtopTotalRetail,
      cc.stickTotalCost, cc.stickTotalRetail, cc.dwTotalCost, cc.dwTotalRetail,
      cc.laborTotalCost, cc.laborTotalRetail,
      cc.deliveryTotalCost, cc.deliveryTotalRetail, cc.ldTotalCost, cc.ldTotalRetail,
      cc.material, cc.labor, cc.tax, cc.retailPerUnit2, cc.retailExt2,
    ];
    const dollarCols = new Set([
      cc.cabsCost, cc.pullsCost, cc.plamCost, cc.ktopCost, cc.vtopCost, cc.stickCost, cc.dwCost, cc.laborCost,
      cc.deliveryCost, cc.ldCost,
      cc.costPerUnit, cc.costExt,
      cc.cabsRetail, cc.pullsRetail, cc.plamRetail, cc.ktopRetail, cc.vtopRetail, cc.stickRetail, cc.dwRetail, cc.laborRetail,
      cc.deliveryRetail, cc.ldRetail,
      cc.retailPerUnit, cc.retailExt,
      cc.cabsTotalCost, cc.cabsTotalRetail, cc.pullsTotalCost, cc.pullsTotalRetail,
      cc.plamTotalCostCol, cc.plamTotalRetailCol,
      cc.ktopTotalCost, cc.ktopTotalRetail, cc.vtopTotalCost, cc.vtopTotalRetail,
      cc.stickTotalCost, cc.stickTotalRetail, cc.dwTotalCost, cc.dwTotalRetail,
      cc.laborTotalCost, cc.laborTotalRetail,
      cc.deliveryTotalCost, cc.deliveryTotalRetail, cc.ldTotalCost, cc.ldTotalRetail,
      cc.material, cc.labor, cc.tax, cc.retailPerUnit2, cc.retailExt2,
    ]);

    summedCols.forEach(c => {
      setFormula(costTotRow2.getCell(c), safeSumColRange(excelCol(c), costDataStart, costDataEnd), 0);
      if (dollarCols.has(c)) costTotRow2.getCell(c).numFmt = '$#,##0.00';
    });

    costTotRow2.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      cell.alignment = { horizontal: 'center' };
    });

    // ── Stone SQFT section below TOTAL row ──────────────────────────
    if (store.stoneRows.length > 0) {
      wsCosting.addRow([]); // blank row 1
      wsCosting.addRow([]); // blank row 2

      // Compute per-type stone sqft: total, top-only, backsplash
      const kitchenTypes: string[] = [];
      const stoneByType: Record<string, { totalSqft: number; topSqft: number; bsSqft: number }> = {};

      for (const row of store.stoneRows) {
        if (row.category !== 'kitchen') continue;
        const t = row.unitType;
        if (!stoneByType[t]) {
          stoneByType[t] = { totalSqft: 0, topSqft: 0, bsSqft: 0 };
          kitchenTypes.push(t);
        }
        const topArea = (row.length * row.depth) / 144; // sq inches to sqft
        const bsHeight = store.getTypeBsHeight(t, 'kitchen');
        const bsArea = (row.backsplashLength * bsHeight) / 144;
        stoneByType[t].topSqft += topArea;
        stoneByType[t].bsSqft += bsArea;
        stoneByType[t].totalSqft += topArea + bsArea;
      }

      // Write type rows
      for (const t of kitchenTypes) {
        const r = wsCosting.addRow([]);
        r.getCell(cc.type).value = t;
        r.getCell(cc.type).font = { bold: true, size: 9 };
        r.getCell(cc.type).border = allBorders;
        r.getCell(cc.ktopSqft).value = Math.ceil(stoneByType[t].totalSqft);
        r.getCell(cc.ktopSqft).alignment = { horizontal: 'center' };
        r.getCell(cc.ktopSqft).border = allBorders;
        r.getCell(cc.kTopSqftOnly).value = Math.ceil(stoneByType[t].topSqft);
        r.getCell(cc.kTopSqftOnly).alignment = { horizontal: 'center' };
        r.getCell(cc.kTopSqftOnly).border = allBorders;
        r.getCell(cc.kBackSplash).value = Math.ceil(stoneByType[t].bsSqft);
        r.getCell(cc.kBackSplash).alignment = { horizontal: 'center' };
        r.getCell(cc.kBackSplash).border = allBorders;
      }

      // Vanity/bath stone
      const bathTypes: string[] = [];
      const stoneBathByType: Record<string, { totalSqft: number; topSqft: number; bsSqft: number }> = {};

      for (const row of store.stoneRows) {
        if (row.category !== 'bath') continue;
        const t = row.unitType;
        if (!stoneBathByType[t]) {
          stoneBathByType[t] = { totalSqft: 0, topSqft: 0, bsSqft: 0 };
          bathTypes.push(t);
        }
        const topArea = (row.length * row.depth) / 144;
        const bsHeight = store.getTypeBsHeight(t, 'bath');
        const bsArea = (row.backsplashLength * bsHeight) / 144;
        stoneBathByType[t].topSqft += topArea;
        stoneBathByType[t].bsSqft += bsArea;
        stoneBathByType[t].totalSqft += topArea + bsArea;
      }

      if (bathTypes.length > 0) {
        wsCosting.addRow([]); // blank separator
        for (const t of bathTypes) {
          const r = wsCosting.addRow([]);
          r.getCell(cc.type).value = t;
          r.getCell(cc.type).font = { bold: true, size: 9 };
          r.getCell(cc.type).border = allBorders;
          r.getCell(cc.vtopSqft).value = Math.ceil(stoneBathByType[t].totalSqft);
          r.getCell(cc.vtopSqft).alignment = { horizontal: 'center' };
          r.getCell(cc.vtopSqft).border = allBorders;
          r.getCell(cc.vTopSqftOnly).value = Math.ceil(stoneBathByType[t].topSqft);
          r.getCell(cc.vTopSqftOnly).alignment = { horizontal: 'center' };
          r.getCell(cc.vTopSqftOnly).border = allBorders;
          r.getCell(cc.vBackSplash).value = Math.ceil(stoneBathByType[t].bsSqft);
          r.getCell(cc.vBackSplash).alignment = { horizontal: 'center' };
          r.getCell(cc.vBackSplash).border = allBorders;
        }
      }
    }

    // Position summary at header row level
    const sumHeaderRowNum = costHeaderRow2.number;
    const sumStartRow = sumHeaderRowNum;

    // Summary headers
    const sumHdrRow = wsCosting.getRow(sumStartRow);
    sumHdrRow.getCell(cc.sumLabel).value = '';
    sumHdrRow.getCell(cc.sumRetail).value = 'RETAIL';
    sumHdrRow.getCell(cc.sumRetail).font = { bold: true, size: 9 };
    sumHdrRow.getCell(cc.sumRetail).alignment = { horizontal: 'center' };
    sumHdrRow.getCell(cc.sumRetail).border = allBorders;
    sumHdrRow.getCell(cc.sumMargin).value = 'Margin';
    sumHdrRow.getCell(cc.sumMargin).font = { bold: true, size: 9 };
    sumHdrRow.getCell(cc.sumMargin).alignment = { horizontal: 'center' };
    sumHdrRow.getCell(cc.sumMargin).border = allBorders;
    sumHdrRow.getCell(cc.sumCost).value = 'COST';
    sumHdrRow.getCell(cc.sumCost).font = { bold: true, size: 9 };
    sumHdrRow.getCell(cc.sumCost).alignment = { horizontal: 'center' };
    sumHdrRow.getCell(cc.sumCost).border = allBorders;

    // Summary data rows (placed after saffron rate row)
    const summaryItems = [
      { label: 'CABS TOTAL RETAIL', retailCol: cc.cabsTotalRetail, costCol: cc.cabsTotalCost, showMargin: true },
      { label: 'PULLS TOTAL RETAIL', retailCol: cc.pullsTotalRetail, costCol: cc.pullsTotalCost, showMargin: true },
      { label: 'PLAM KTOP TOTAL RETAIL', retailCol: cc.plamTotalRetailCol, costCol: cc.plamTotalCostCol, showMargin: true },
      { label: 'QUARTZ GRP1 KTOP TOTAL RETAIL', retailCol: cc.ktopTotalRetail, costCol: cc.ktopTotalCost, showMargin: true },
      { label: 'QUARTZ GRP1 VTOP TOTAL RETAIL', retailCol: cc.vtopTotalRetail, costCol: cc.vtopTotalCost, showMargin: true },
      { label: 'LABOR TOTAL RETAIL', retailCol: cc.laborTotalRetail, costCol: cc.laborTotalCost, showMargin: true },
      { label: 'Delivery charges', retailCol: cc.deliveryTotalRetail, costCol: cc.deliveryTotalCost, showMargin: false },
      { label: 'Load & Distubution charges', retailCol: cc.ldTotalRetail, costCol: cc.ldTotalCost, showMargin: false },
    ];

    const totRowNum = costTotRow2.number;
    const sumDataStartRow = costRateRowNum + 1; // row after saffron = first data row area
    // We place summary items starting right after the header row in the summary columns
    const sumItemStartRow = sumStartRow + 1; // row after summary header

    summaryItems.forEach((item, idx) => {
      const targetRow = sumItemStartRow + idx;
      let rowObj = wsCosting.getRow(targetRow);

      rowObj.getCell(cc.sumLabel).value = item.label;
      rowObj.getCell(cc.sumLabel).font = { size: 8 };
      rowObj.getCell(cc.sumLabel).border = allBorders;

      // Retail = SUM of that total retail column across data rows
      const retailRef = `${excelCol(item.retailCol)}${totRowNum}`;
      setFormula(rowObj.getCell(cc.sumRetail), `N(${retailRef})`, 0);
      rowObj.getCell(cc.sumRetail).numFmt = '$#,##0.00';
      rowObj.getCell(cc.sumRetail).alignment = { horizontal: 'center' };
      rowObj.getCell(cc.sumRetail).border = allBorders;

      // Margin = 1 - (cost / retail)
      if (item.showMargin) {
        const costRef = `${excelCol(item.costCol)}${totRowNum}`;
        const retRef = ref(cc.sumRetail, targetRow);
        setFormula(rowObj.getCell(cc.sumMargin), `IFERROR(1-(N(${costRef})/N(${retRef})),0)`, 0);
        rowObj.getCell(cc.sumMargin).numFmt = '0.00%';
      }
      rowObj.getCell(cc.sumMargin).alignment = { horizontal: 'center' };
      rowObj.getCell(cc.sumMargin).border = allBorders;

      // Cost = total cost column total
      const costRef2 = `${excelCol(item.costCol)}${totRowNum}`;
      setFormula(rowObj.getCell(cc.sumCost), `N(${costRef2})`, 0);
      rowObj.getCell(cc.sumCost).numFmt = '$#,##0.00';
      rowObj.getCell(cc.sumCost).alignment = { horizontal: 'center' };
      rowObj.getCell(cc.sumCost).border = allBorders;
    });

    // TOTAL row for summary
    const sumTotalRowNum = sumItemStartRow + summaryItems.length;
    const sumTotRow = wsCosting.getRow(sumTotalRowNum);
    sumTotRow.getCell(cc.sumLabel).value = 'TOTAL';
    sumTotRow.getCell(cc.sumLabel).font = { bold: true, size: 9 };
    sumTotRow.getCell(cc.sumLabel).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    sumTotRow.getCell(cc.sumLabel).border = allBorders;

    // Total Retail = SUM of summary retail cells
    setFormula(sumTotRow.getCell(cc.sumRetail),
      safeSum(ref(cc.sumRetail, sumItemStartRow), ref(cc.sumRetail, sumItemStartRow + summaryItems.length - 1)), 0);
    sumTotRow.getCell(cc.sumRetail).numFmt = '$#,##0.00';
    sumTotRow.getCell(cc.sumRetail).font = { bold: true };
    sumTotRow.getCell(cc.sumRetail).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    sumTotRow.getCell(cc.sumRetail).alignment = { horizontal: 'center' };
    sumTotRow.getCell(cc.sumRetail).border = allBorders;

    // Total Cost = SUM of summary cost cells
    setFormula(sumTotRow.getCell(cc.sumCost),
      safeSum(ref(cc.sumCost, sumItemStartRow), ref(cc.sumCost, sumItemStartRow + summaryItems.length - 1)), 0);
    sumTotRow.getCell(cc.sumCost).numFmt = '$#,##0.00';
    sumTotRow.getCell(cc.sumCost).font = { bold: true };
    sumTotRow.getCell(cc.sumCost).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    sumTotRow.getCell(cc.sumCost).alignment = { horizontal: 'center' };
    sumTotRow.getCell(cc.sumCost).border = allBorders;

    // Total Margin = 1 - (total cost / total retail)
    setFormula(sumTotRow.getCell(cc.sumMargin),
      `IFERROR(1-(N(${ref(cc.sumCost, sumTotalRowNum)})/N(${ref(cc.sumRetail, sumTotalRowNum)})),0)`, 0);
    sumTotRow.getCell(cc.sumMargin).numFmt = '0.00%';
    sumTotRow.getCell(cc.sumMargin).font = { bold: true };
    sumTotRow.getCell(cc.sumMargin).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    sumTotRow.getCell(cc.sumMargin).alignment = { horizontal: 'center' };
    sumTotRow.getCell(cc.sumMargin).border = allBorders;

    // ── Sheet 5: Schedule of Values ─────────────────────────────────
    // Flat format: BLDG | FLOOR | Unit# | ADA | UNIT TYPE NAME | MATERIAL | LABOR | TAX | Total
    const wsSov = wb.addWorksheet('5-Schedule of Values');

    // Column layout (1-indexed, col A = 1)
    // A: blank pad | B: BLDG | C: FLOOR | D: Unit# | E: ADA | F: UNIT TYPE NAME | G: MATERIAL | H: LABOR | I: TAX | J: Total
    const sovColBldg = 2, sovColFloor = 3, sovColUnit = 4, sovColAda = 5;
    const sovColTypeName = 6, sovColMat = 7, sovColLab = 8, sovColTax = 9, sovColTotal = 10;

    wsSov.columns = [
      { width: 3 },   // A blank
      { width: 14 },  // B BLDG
      { width: 10 },  // C FLOOR
      { width: 12 },  // D Unit#
      { width: 8 },   // E ADA
      { width: 44 },  // F UNIT TYPE NAME
      { width: 14 },  // G MATERIAL
      { width: 10 },  // H LABOR
      { width: 10 },  // I TAX
      { width: 14 },  // J Total
    ];

    // Row 1: blank
    wsSov.addRow([]);

    // Row 2: Job Name box
    const sovJobRow = wsSov.addRow([]);
    const sovJobCell = sovJobRow.getCell(sovColBldg);
    sovJobCell.value = `Job Name:- ${project.name}`;
    sovJobCell.font = { bold: true, size: 11 };
    sovJobCell.border = allBorders;

    // Row 3: blank
    wsSov.addRow([]);

    // Row 4: Schedule of Values label box
    const sovLabelRow = wsSov.addRow([]);
    const sovLabelCell = sovLabelRow.getCell(sovColBldg);
    sovLabelCell.value = 'SCHEDULE OF VALUES';
    sovLabelCell.font = { bold: true, size: 11 };
    sovLabelCell.border = allBorders;

    // Rows 5-6: blank
    wsSov.addRow([]);
    wsSov.addRow([]);

    // Row 7: Column headers
    const sovHeader = wsSov.addRow(['', 'BLDG', 'FLOOR', 'Unit#', 'ADA', 'UNIT TYPE NAME', 'MATERIAL', 'LABOR', 'TAX', 'Total']);
    sovHeader.height = 30;
    sovHeader.eachCell((cell, colNumber) => {
      if (colNumber <= 1) return;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
      cell.border = allBorders;
      cell.alignment = { vertical: 'middle', horizontal: colNumber >= sovColMat ? 'center' : 'left', wrapText: false };
    });

    // Freeze top 7 rows
    wsSov.views = [{ state: 'frozen', xSplit: 0, ySplit: 7 }];

    const sovDataStart = sovHeader.number + 1; // Excel row number of first data row

    sortedUnits.forEach(unit => {
      // Resolve assigned type name(s) for this unit
      const assignedTypes = Object.entries(unit.assignments || {})
        .filter(([, v]) => v)
        .map(([k]) => k);
      const unitTypeName = assignedTypes.join(' / ');

      const row = wsSov.addRow([
        '', unit.bldg || '', unit.floor || '', unit.name, '', unitTypeName, '', '', '',
      ]);
      const r = row.number;
      // Total = MATERIAL + LABOR + TAX (safe)
      row.getCell(sovColTotal).value = {
        formula: `IFERROR(${excelCol(sovColMat)}${r}+${excelCol(sovColLab)}${r}+${excelCol(sovColTax)}${r},0)`,
        result: 0,
      } as any;
      row.eachCell((cell, colNumber) => {
        if (colNumber <= 1) return;
        cell.border = allBorders;
        if (colNumber >= sovColMat) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.numFmt = '$#,##0.00';
        }
      });
    });

    const sovDataEnd = wsSov.lastRow?.number || sovDataStart;

    // Blank row then totals
    wsSov.addRow([]);
    const sovTotRow = wsSov.addRow([]);
    sovTotRow.getCell(sovColUnit).value = `TOTAL (${sortedUnits.length})`;
    sovTotRow.getCell(sovColUnit).font = { bold: true };

    // SUM formulas for MATERIAL, LABOR, TAX, Total
    [sovColMat, sovColLab, sovColTax, sovColTotal].forEach(col => {
      const cell = sovTotRow.getCell(col);
      cell.value = {
        formula: `IFERROR(SUM(${excelCol(col)}${sovDataStart}:${excelCol(col)}${sovDataEnd}),0)`,
        result: 0,
      } as any;
      cell.numFmt = '$#,##0.00';
      cell.alignment = { horizontal: 'center' };
    });
    sovTotRow.eachCell((cell, colNumber) => {
      if (colNumber <= 1) return;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      cell.border = allBorders;
    });

    // ── Sheet 5.1: SOV - Installer Payment ──────────────────────────
    const wsInstaller = wb.addWorksheet('5.1-SOV-Installer Payment');
    const instColBldg = 2, instColFloor = 3, instColUnit = 4, instColAda = 5;
    const instColTypeName = 6, instColMat = 7, instColLab = 8, instColTax = 9, instColTotal = 10;
    const instColBlank = 11, instColInstaller = 12;

    wsInstaller.columns = [
      { width: 3 },   // A blank
      { width: 14 },  // B BLDG
      { width: 10 },  // C FLOOR
      { width: 12 },  // D Unit#
      { width: 8 },   // E ADA
      { width: 44 },  // F UNIT TYPE NAME
      { width: 14 },  // G MATERIAL
      { width: 10 },  // H LABOR
      { width: 10 },  // I TAX
      { width: 14 },  // J Total
      { width: 4 },   // K blank spacer
      { width: 18 },  // L Installer Payment
    ];

    // Row 1: blank
    wsInstaller.addRow([]);

    // Row 2: Job Name box
    const instJobRow = wsInstaller.addRow([]);
    const instJobCell = instJobRow.getCell(instColBldg);
    instJobCell.value = `Job Name:- ${project.name}`;
    instJobCell.font = { bold: true, size: 11 };
    instJobCell.border = allBorders;

    // Row 3: blank
    wsInstaller.addRow([]);

    // Row 4: label
    const instLabelRow = wsInstaller.addRow([]);
    const instLabelCell = instLabelRow.getCell(instColBldg);
    instLabelCell.value = 'SOV - INSTALLER PAYMENT';
    instLabelCell.font = { bold: true, size: 11 };
    instLabelCell.border = allBorders;

    // Rows 5-6: blank
    wsInstaller.addRow([]);
    wsInstaller.addRow([]);

    // Row 7: Column headers
    const instHeader = wsInstaller.addRow(['', 'BLDG', 'FLOOR', 'Unit#', 'ADA', 'UNIT TYPE NAME', 'MATERIAL', 'LABOR', 'TAX', 'Total', '', 'Installer Payment']);
    instHeader.height = 30;
    instHeader.eachCell((cell, colNumber) => {
      if (colNumber <= 1 || colNumber === instColBlank) return;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
      cell.border = allBorders;
      cell.alignment = { vertical: 'middle', horizontal: (colNumber >= instColMat) ? 'center' : 'left', wrapText: false };
    });

    wsInstaller.views = [{ state: 'frozen', xSplit: 0, ySplit: 7 }];

    const instDataStart = instHeader.number + 1;

    sortedUnits.forEach(unit => {
      const assignedTypes = Object.entries(unit.assignments || {})
        .filter(([, v]) => v)
        .map(([k]) => k);
      const unitTypeName = assignedTypes.join(' / ');

      const row = wsInstaller.addRow([
        '', unit.bldg || '', unit.floor || '', unit.name, '', unitTypeName, '', '', '', '', '', '',
      ]);
      const r = row.number;
      row.getCell(instColTotal).value = {
        formula: `IFERROR(${excelCol(instColMat)}${r}+${excelCol(instColLab)}${r}+${excelCol(instColTax)}${r},0)`,
        result: 0,
      } as any;
      row.eachCell((cell, colNumber) => {
        if (colNumber <= 1 || colNumber === instColBlank) return;
        cell.border = allBorders;
        if (colNumber >= instColMat && colNumber <= instColTotal) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.numFmt = '$#,##0.00';
        }
        if (colNumber === instColInstaller) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.numFmt = '$#,##0.00';
        }
      });
    });

    const instDataEnd = wsInstaller.lastRow?.number || instDataStart;

    // Blank row then totals
    wsInstaller.addRow([]);
    const instTotRow = wsInstaller.addRow([]);
    instTotRow.getCell(instColUnit).value = `TOTAL (${sortedUnits.length})`;
    instTotRow.getCell(instColUnit).font = { bold: true };

    [instColMat, instColLab, instColTax, instColTotal, instColInstaller].forEach(col => {
      const cell = instTotRow.getCell(col);
      cell.value = {
        formula: `IFERROR(SUM(${excelCol(col)}${instDataStart}:${excelCol(col)}${instDataEnd}),0)`,
        result: 0,
      } as any;
      cell.numFmt = '$#,##0.00';
      cell.alignment = { horizontal: 'center' };
    });
    instTotRow.eachCell((cell, colNumber) => {
      if (colNumber <= 1 || colNumber === instColBlank) return;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      cell.border = allBorders;
    });

    // ── Sheet 6: Slab Order ─────────────────────────────────────────
    const wsSlab = wb.addWorksheet('6-Slab Order');
    const slabColBldg = 2, slabColFloor = 3, slabColUnit = 4, slabColTypeName = 5;

    wsSlab.columns = [
      { width: 3 },   // A blank
      { width: 14 },  // B BLDG
      { width: 10 },  // C FLOOR
      { width: 12 },  // D Unit#
      { width: 44 },  // E UNIT TYPE NAME
    ];

    // Row 1: blank
    wsSlab.addRow([]);

    // Row 2: Job Name box
    const slabJobRow = wsSlab.addRow([]);
    const slabJobCell = slabJobRow.getCell(slabColBldg);
    slabJobCell.value = `Job Name:- ${project.name}`;
    slabJobCell.font = { bold: true, size: 11 };
    slabJobCell.border = allBorders;

    // Row 3: blank
    wsSlab.addRow([]);

    // Row 4: label
    const slabLabelRow = wsSlab.addRow([]);
    const slabLabelCell = slabLabelRow.getCell(slabColBldg);
    slabLabelCell.value = 'SLAB ORDER';
    slabLabelCell.font = { bold: true, size: 11 };
    slabLabelCell.border = allBorders;

    // Rows 5-6: blank
    wsSlab.addRow([]);
    wsSlab.addRow([]);

    // Row 7: Column headers
    const slabHeader = wsSlab.addRow(['', 'BLDG', 'FLOOR', 'Unit#', 'UNIT TYPE NAME']);
    slabHeader.height = 30;
    slabHeader.eachCell((cell, colNumber) => {
      if (colNumber <= 1) return;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
      cell.border = allBorders;
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
    });

    wsSlab.views = [{ state: 'frozen', xSplit: 0, ySplit: 7 }];

    sortedUnits.forEach(unit => {
      const assignedTypes = Object.entries(unit.assignments || {})
        .filter(([, v]) => v)
        .map(([k]) => k);
      const unitTypeName = assignedTypes.join(' / ');

      const row = wsSlab.addRow(['', unit.bldg || '', unit.floor || '', unit.name, unitTypeName]);
      row.eachCell((cell, colNumber) => {
        if (colNumber <= 1) return;
        cell.border = allBorders;
      });
    });

    // Blank row then total
    wsSlab.addRow([]);
    const slabTotRow = wsSlab.addRow([]);
    slabTotRow.getCell(slabColUnit).value = `TOTAL (${sortedUnits.length})`;
    slabTotRow.getCell(slabColUnit).font = { bold: true };
    slabTotRow.eachCell((cell, colNumber) => {
      if (colNumber <= 1) return;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      cell.border = allBorders;
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

        // ── Section: Total Cabinet Count (cab qty × unit count) ─────
        if (y > pageH - 100) { doc.addPage(); y = 40; }
        y = sectionHeader('TOTAL CABINET COUNT (Qty × Unit Count)', y);

        const unitCountPerTypePdf: Record<string, number> = {};
        for (const t of store.cabinetUnitTypes) {
          unitCountPerTypePdf[t] = countUnitsForType(t);
        }

        const tcHead = ['SKU Name', ...store.cabinetUnitTypes, 'Total'];
        const tcBody: string[][] = [];

        // Unit count reference row
        tcBody.push(['Unit Count', ...store.cabinetUnitTypes.map(t => String(unitCountPerTypePdf[t] || 0)),
          String(Object.values(unitCountPerTypePdf).reduce((s, v) => s + v, 0))]);

        groupedSkus.forEach(({ group, skus }) => {
          tcBody.push([`▸ ${group} (${skus.length})`, ...store.cabinetUnitTypes.map(() => ''), '']);
          skus.forEach(sku => {
            const vals = store.cabinetUnitTypes.map(t => {
              const total = (skuTypeQty[sku]?.[t] || 0) * (unitCountPerTypePdf[t] || 0);
              return total > 0 ? String(total) : '';
            });
            const rowTotal = store.cabinetUnitTypes.reduce((sum, t) =>
              sum + ((skuTypeQty[sku]?.[t] || 0) * (unitCountPerTypePdf[t] || 0)), 0);
            tcBody.push([sku, ...vals, String(rowTotal)]);
          });
        });

        // Totals
        const tcColTotals = store.cabinetUnitTypes.map(t =>
          String(allSkus.reduce((sum, sku) => sum + ((skuTypeQty[sku]?.[t] || 0) * (unitCountPerTypePdf[t] || 0)), 0))
        );
        const tcGrandTotal = store.cabinetUnitTypes.reduce((sum, t) =>
          sum + allSkus.reduce((s, sku) => s + ((skuTypeQty[sku]?.[t] || 0) * (unitCountPerTypePdf[t] || 0)), 0), 0);
        tcBody.push(['TOTAL', ...tcColTotals, String(tcGrandTotal)]);

        const tcGroupIndices = new Set<number>();
        let tcIdx = 1; // skip unit count row
        groupedSkus.forEach(({ skus }) => { tcGroupIndices.add(tcIdx); tcIdx += 1 + skus.length; });

        autoTable(doc, {
          startY: y,
          head: [tcHead],
          body: tcBody,
          margin: { left: margin, right: margin },
          styles: { fontSize: 7, cellPadding: 3, textColor: TEXT_DARK, lineColor: [220, 228, 240], lineWidth: 0.5 },
          headStyles: { fillColor: BLUE_MID, textColor: WHITE, fontStyle: 'bold', fontSize: 7, halign: 'center' },
          columnStyles: { 0: { halign: 'left', font: 'courier' } },
          alternateRowStyles: { fillColor: GRAY_LIGHT },
          didParseCell: (data) => {
            // Unit count row
            if (data.row.index === 0) {
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fillColor = BLUE_LIGHT;
              data.cell.styles.textColor = BLUE_DARK;
            }
            if (tcGroupIndices.has(data.row.index)) {
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fillColor = [234, 234, 234] as any;
              data.cell.styles.textColor = TEXT_MID;
              data.cell.styles.font = 'helvetica';
            }
            if (data.row.index === tcBody.length - 1) {
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fillColor = BLUE_LIGHT;
              data.cell.styles.textColor = BLUE_DARK;
            }
            if (data.column.index > 0) data.cell.styles.halign = 'center';
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
