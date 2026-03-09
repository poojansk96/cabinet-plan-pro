import { useState } from 'react';
import { BarChart3, Download, FileText, Loader2 } from 'lucide-react';
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Project } from '@/types/project';
import { usePrefinalStore, type PrefinalUnitNumber, type PrefinalCabinetRow } from '@/hooks/usePrefinalStore';
import { formatDoorStyle, formatKitchenTops, formatVanityTops, formatAdditionalTops } from '@/lib/formatSpecs';
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

    // ── Sheet 1: Project Info ───────────────────────────────────────
    const wsInfo = wb.addWorksheet('Project Info');
    wsInfo.columns = [{ width: 22 }, { width: 40 }];
    const sp = project.specs as Record<string, any> | undefined;

    const boldUnderlineLabels = new Set([
      'Project Name', 'Address', 'Project Super', 'Customer',
      'Specifications', 'Kitchen Tops', 'Vanity Tops', 'Additional Tops',
      'Handles & Hardware', 'Sales Tax on Material',
    ]);

    const infoRows: (string | undefined)[][] = [
      ['Project Name', project.name],
      [],
      ['Address', project.address],
      ['Type', project.type],
      ['Notes', project.notes || ''],
      [],
      ['Project Super', sp?.projectSuper || ''],
      ['Customer', sp?.customer || ''],
      [],
      ['Specifications', ''],
      ['Door Style', formatDoorStyle(project.specs)],
      ['Hinges', resolveOther(sp?.hinges, sp?.hingesCustom)],
      ['Drawer Box', resolveOther(sp?.drawerBox, sp?.drawerBoxCustom)],
      ['Drawer Guides', resolveOther(sp?.drawerGuides, sp?.drawerGuidesCustom)],
      [],
      ['Kitchen Tops', formatKitchenTops(project.specs)],
      ['Vanity Tops', formatVanityTops(project.specs)],
      ...((sp?.additionalTopsEnabled) ? [['Additional Tops', formatAdditionalTops(project.specs)]] : []),
      [],
      ['Handles & Hardware', resolveOther(sp?.handlesAndHardware, sp?.handlesCustom)],
      [],
      ['Sales Tax on Material', resolveOther(sp?.tax, sp?.taxCustom)],
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

    // ── Sheet 2: Unit Count ─────────────────────────────────────────
    const wsUnits = wb.addWorksheet('Unit Count');
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
    const totals = store.unitTypes.map(t => unitTypeTotal(t));
    const grandTotal = totals.reduce((s, v) => s + v, 0);
    const totRow = wsUnits.addRow(['', '', '', `TOTAL (${store.unitNumbers.length})`, ...totals, grandTotal]);
    totRow.eachCell((cell, colNumber) => {
      if (colNumber <= 1) return;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      cell.border = allBorders;
      if (colNumber > 4) cell.alignment = { horizontal: 'center' };
    });

    // ── Sheet 3: Cabinet Count ──────────────────────────────────────
    const wsCabs = wb.addWorksheet('Cabinet Count');
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
          (idx >= colTotalCabFirstType - 1 && idx <= colTotalCabFirstType - 2 + nTypes)) {
        cell.alignment = { textRotation: 90, vertical: 'bottom', horizontal: 'center' };
      }
    });

    // Freeze: top 3 rows (section headers + unit count ref + column headers) AND first column (SKU Name)
    wsCabs.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }];

    const dataRangeStartRow = cabHeader.number + 1;

    // Data rows
    groupedSkus.forEach(({ group, skus }) => {
      const groupRow = wsCabs.addRow([`${group} (${skus.length})`]);
      groupRow.eachCell(cell => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAEAEA' } };
      });

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

        const row = wsCabs.addRow(rowValues);
        const r = row.number;

        // Cabinet Total = SUM(cab type cols)
        setFormula(row.getCell(colCabTotal), `SUM(${ref(colCabFirstType, r)}:${ref(colCabFirstType + nTypes - 1, r)})`, 0);

        // Pulls per type = Pulls/Cab * Cabinet Qty
        for (let i = 0; i < nTypes; i++) {
          const cabQtyCell = ref(colCabFirstType + i, r);
          const pullsPerCabCell = ref(colPullsPerCab, r);
          setFormula(row.getCell(colPullsFirstType + i), `${pullsPerCabCell}*${cabQtyCell}`, 0);
        }
        // Pulls Total = SUM(pulls type cols)
        setFormula(row.getCell(colPullsTotal), `SUM(${ref(colPullsFirstType, r)}:${ref(colPullsFirstType + nTypes - 1, r)})`, 0);

        // Total cabinet count per type = Cabinet Qty * Unit Count (row 2)
        for (let i = 0; i < nTypes; i++) {
          const cabQtyCell = ref(colCabFirstType + i, r);
          const unitCountAbs = `$${excelCol(colTotalCabFirstType + i)}$${unitCountRow.number}`;
          setFormula(row.getCell(colTotalCabFirstType + i), `${cabQtyCell}*${unitCountAbs}`, 0);
        }
        setFormula(row.getCell(colTotalCabGrand), `SUM(${ref(colTotalCabFirstType, r)}:${ref(colTotalCabFirstType + nTypes - 1, r)})`, 0);

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
        `SUM(${excelCol(colCabFirstType + i)}${dataRangeStartRow}:${excelCol(colCabFirstType + i)}${dataRangeEndRow})`,
        0
      );
    }
    setFormula(cabTotRow.getCell(colCabTotal), `SUM(${excelCol(colCabTotal)}${dataRangeStartRow}:${excelCol(colCabTotal)}${dataRangeEndRow})`, 0);

    // Pulls section totals
    for (let i = 0; i < nTypes; i++) {
      setFormula(
        cabTotRow.getCell(colPullsFirstType + i),
        `SUM(${excelCol(colPullsFirstType + i)}${dataRangeStartRow}:${excelCol(colPullsFirstType + i)}${dataRangeEndRow})`,
        0
      );
    }
    setFormula(cabTotRow.getCell(colPullsTotal), `SUM(${excelCol(colPullsTotal)}${dataRangeStartRow}:${excelCol(colPullsTotal)}${dataRangeEndRow})`, 0);

    // Pricing totals (will be filled after pricing formulas are applied on data rows)
    setFormula(cabTotRow.getCell(colPricingBid), `SUM(${excelCol(colPricingBid)}${dataRangeStartRow}:${excelCol(colPricingBid)}${dataRangeEndRow})`, 0);
    setFormula(cabTotRow.getCell(colPricingAdditional), `SUM(${excelCol(colPricingAdditional)}${dataRangeStartRow}:${excelCol(colPricingAdditional)}${dataRangeEndRow})`, 0);
    setFormula(cabTotRow.getCell(colPricingTotal), `SUM(${excelCol(colPricingTotal)}${dataRangeStartRow}:${excelCol(colPricingTotal)}${dataRangeEndRow})`, 0);
    for (let i = 0; i < nTypes; i++) {
      setFormula(
        cabTotRow.getCell(colPricingFirstType + i),
        `SUM(${excelCol(colPricingFirstType + i)}${dataRangeStartRow}:${excelCol(colPricingFirstType + i)}${dataRangeEndRow})`,
        0
      );
    }
    setFormula(cabTotRow.getCell(colPricingTypeTotal), `SUM(${excelCol(colPricingTypeTotal)}${dataRangeStartRow}:${excelCol(colPricingTypeTotal)}${dataRangeEndRow})`, 0);

    // Total cabinet count totals
    cabTotRow.getCell(colTotalCabLabel).value = 'TOTAL';
    for (let i = 0; i < nTypes; i++) {
      setFormula(
        cabTotRow.getCell(colTotalCabFirstType + i),
        `SUM(${excelCol(colTotalCabFirstType + i)}${dataRangeStartRow}:${excelCol(colTotalCabFirstType + i)}${dataRangeEndRow})`,
        0
      );
    }
    setFormula(cabTotRow.getCell(colTotalCabGrand), `SUM(${excelCol(colTotalCabGrand)}${dataRangeStartRow}:${excelCol(colTotalCabGrand)}${dataRangeEndRow})`, 0);

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
      setFormula(cell, `${bidAbs}+${addAbs}`, 0);
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

      for (let i = 0; i < nTypes; i++) {
        const totalCabRef = ref(colTotalCabFirstType + i, r);
        const bidAbs = `$${excelCol(colPricingFirstType + i)}$${bidCostRow.number}`;
        const addAbs = `$${excelCol(colPricingFirstType + i)}$${addCostRow.number}`;
        const totAbs = `$${excelCol(colPricingFirstType + i)}$${totalCostRow.number}`;

        partsBid.push(`(${totalCabRef}*${bidAbs})`);
        partsAdd.push(`(${totalCabRef}*${addAbs})`);

        const typeCell = wsCabs.getRow(r).getCell(colPricingFirstType + i);
        setFormula(typeCell, `${totalCabRef}*${totAbs}`, 0);
        typeCell.numFmt = '$#,##0.00';

        pricingTypeRefs.push(ref(colPricingFirstType + i, r));
      }

      const rowObj = wsCabs.getRow(r);
      const bidCell = rowObj.getCell(colPricingBid);
      const addCell = rowObj.getCell(colPricingAdditional);
      const totCell = rowObj.getCell(colPricingTotal);
      const typeTotCell = rowObj.getCell(colPricingTypeTotal);

      setFormula(bidCell, partsBid.length ? partsBid.join('+') : '0', 0);
      setFormula(addCell, partsAdd.length ? partsAdd.join('+') : '0', 0);
      setFormula(totCell, `${ref(colPricingBid, r)}+${ref(colPricingAdditional, r)}`, 0);
      setFormula(typeTotCell, `SUM(${pricingTypeRefs[0]}:${pricingTypeRefs[pricingTypeRefs.length - 1]})`, 0);

      bidCell.numFmt = '$#,##0.00';
      addCell.numFmt = '$#,##0.00';
      totCell.numFmt = '$#,##0.00';
      typeTotCell.numFmt = '$#,##0.00';
    }

    // ── Sheet 4: Costing ────────────────────────────────────────────
    const wsCosting = wb.addWorksheet('Costing');
    wsCosting.columns = [
      { width: 20 }, { width: 10 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 },
    ];

    wsCosting.addRow([]);
    const costHeader = wsCosting.addRow(['Unit Type', 'Qty', 'Cabinet Cost', 'Additional', 'Handle Cost', 'Total']);
    styleHeader(costHeader);
    costHeader.eachCell(cell => {
      cell.alignment = { horizontal: 'center', vertical: 'bottom' };
    });
    costHeader.getCell(1).alignment = { horizontal: 'left', vertical: 'bottom' };

    const pullsSumRangeForType = (typeIndex: number) => {
      const col = colPullsFirstType + typeIndex;
      return `${excelCol(col)}${dataRangeStartRow}:${excelCol(col)}${dataRangeEndRow}`;
    };

    cabTypes.forEach((t, i) => {
      const row = wsCosting.addRow([t, '', '', '', '', '']);
      const r = row.number;

      // Qty references the Unit Count row in Cabinet Count sheet
      const qtyRef = `'Cabinet Count'!${ref(colTotalCabFirstType + i, unitCountRow.number)}`;
      setFormula(row.getCell(2), qtyRef, 0);
      row.getCell(2).alignment = { horizontal: 'center' };

      // Cabinet cost = Qty * BidCost/Type (editable in Cabinet Count sheet)
      const bidCostRef = `'Cabinet Count'!${ref(colPricingFirstType + i, bidCostRow.number)}`;
      setFormula(row.getCell(3), `${ref(2, r)}*${bidCostRef}`, 0);
      row.getCell(3).numFmt = '$#,##0.00';

      // Additional = Qty * Additional/Type
      const addCostRef = `'Cabinet Count'!${ref(colPricingFirstType + i, addCostRow.number)}`;
      setFormula(row.getCell(4), `${ref(2, r)}*${addCostRef}`, 0);
      row.getCell(4).numFmt = '$#,##0.00';

      // Handle Cost (count) = Qty * SUM(Pulls-per-unit for this type across all SKUs)
      const pullsSumRef = `SUM('Cabinet Count'!${pullsSumRangeForType(i)})`;
      setFormula(row.getCell(5), `${ref(2, r)}*${pullsSumRef}`, 0);
      row.getCell(5).alignment = { horizontal: 'center' };

      // Total = Cabinet + Additional + Handles
      setFormula(row.getCell(6), `${ref(3, r)}+${ref(4, r)}+${ref(5, r)}`, 0);
      row.getCell(6).numFmt = '$#,##0.00';
    });

    wsCosting.addRow([]);
    const totRow = wsCosting.addRow(['TOTAL', '', '', '', '', '']);
    const firstCostDataRow = 3; // blank row + header row => first data row is 3
    const lastCostDataRow = 2 + cabTypes.length; // header is row 2

    setFormula(totRow.getCell(2), `SUM(B${firstCostDataRow}:B${lastCostDataRow})`, 0);
    setFormula(totRow.getCell(3), `SUM(C${firstCostDataRow}:C${lastCostDataRow})`, 0);
    setFormula(totRow.getCell(4), `SUM(D${firstCostDataRow}:D${lastCostDataRow})`, 0);
    setFormula(totRow.getCell(5), `SUM(E${firstCostDataRow}:E${lastCostDataRow})`, 0);
    setFormula(totRow.getCell(6), `SUM(F${firstCostDataRow}:F${lastCostDataRow})`, 0);

    totRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      if (colNumber === 2) cell.alignment = { horizontal: 'center' };
      if ([3, 4, 6].includes(colNumber)) cell.numFmt = '$#,##0.00';
      if (colNumber === 5) cell.alignment = { horizontal: 'center' };
    });

    // ── Sheet 5: Schedule of Values ─────────────────────────────────
    const wsSov = wb.addWorksheet('Schedule of Values');
    const allUnitTypes = store.unitTypes;
    wsSov.columns = [
      { width: 10 }, { width: 10 }, { width: 14 },
      ...allUnitTypes.map(() => ({ width: 14 })),
      { width: 14 }, // Material
      { width: 14 }, // Labor
      { width: 14 }, // Tax
      { width: 14 }, // Total
    ];

    wsSov.addRow([]);
    const sovHeader = wsSov.addRow(['Bldg', 'Floor', 'Unit #', ...allUnitTypes, 'Material', 'Labor', 'Tax', 'Total']);
    sovHeader.height = 120;
    const matColIdx = 3 + allUnitTypes.length + 1; // 1-indexed column for Material
    sovHeader.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
      cell.alignment = { vertical: 'bottom', wrapText: false };
      if (colNumber > 3 && colNumber <= allUnitTypes.length + 3) {
        cell.alignment = { textRotation: 90, vertical: 'bottom', horizontal: 'center' };
      }
      if (colNumber >= matColIdx) {
        cell.alignment = { vertical: 'bottom', horizontal: 'center' };
      }
    });

    const sovDataStartRow = 3; // row number where data starts (after blank + header)
    sortedUnits.forEach((unit, idx) => {
      const typeCells = allUnitTypes.map(t => unit.assignments[t] ? t : '');
      const rowNum = sovDataStartRow + idx;
      const matCol = String.fromCharCode(64 + matColIdx); // e.g. 'G'
      const labCol = String.fromCharCode(64 + matColIdx + 1);
      const taxCol = String.fromCharCode(64 + matColIdx + 2);
      const totCol = String.fromCharCode(64 + matColIdx + 3);
      // Material, Labor, Tax left blank; Total = SUM of those 3
      const row = wsSov.addRow([unit.bldg || '', unit.floor || '', unit.name, ...typeCells, '', '', '']);
      // Add formula for Total column
      const totalCell = row.getCell(matColIdx + 3);
      totalCell.value = { formula: `${matCol}${rowNum + 1}+${labCol}${rowNum + 1}+${taxCol}${rowNum + 1}`, result: 0 } as any;
      totalCell.numFmt = '$#,##0.00';
      row.eachCell((cell, colNumber) => {
        if (colNumber > 3) cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      // Format Material/Labor/Tax as currency
      row.getCell(matColIdx).numFmt = '$#,##0.00';
      row.getCell(matColIdx + 1).numFmt = '$#,##0.00';
      row.getCell(matColIdx + 2).numFmt = '$#,##0.00';
    });

    wsSov.addRow([]);
    const sovTotals = allUnitTypes.map(t => unitTypeTotal(t));
    // Build SUM formulas for Material, Labor, Tax, Total columns
    const dataEndRow = sovDataStartRow + sortedUnits.length; // row after last data
    const matCol = String.fromCharCode(64 + matColIdx);
    const labCol = String.fromCharCode(64 + matColIdx + 1);
    const taxCol = String.fromCharCode(64 + matColIdx + 2);
    const totCol = String.fromCharCode(64 + matColIdx + 3);
    const firstDataExcelRow = sovDataStartRow + 1;
    const lastDataExcelRow = sovDataStartRow + sortedUnits.length;

    const sovTotRow = wsSov.addRow(['', '', `TOTAL (${store.unitNumbers.length})`, ...sovTotals, '', '', '', '']);
    // Set SUM formulas for Material, Labor, Tax, Total in total row
    const totExcelRow = lastDataExcelRow + 2; // +1 for blank row, +1 for this row
    sovTotRow.getCell(matColIdx).value = { formula: `SUM(${matCol}${firstDataExcelRow}:${matCol}${lastDataExcelRow})`, result: 0 } as any;
    sovTotRow.getCell(matColIdx + 1).value = { formula: `SUM(${labCol}${firstDataExcelRow}:${labCol}${lastDataExcelRow})`, result: 0 } as any;
    sovTotRow.getCell(matColIdx + 2).value = { formula: `SUM(${taxCol}${firstDataExcelRow}:${taxCol}${lastDataExcelRow})`, result: 0 } as any;
    sovTotRow.getCell(matColIdx + 3).value = { formula: `SUM(${totCol}${firstDataExcelRow}:${totCol}${lastDataExcelRow})`, result: 0 } as any;
    sovTotRow.getCell(matColIdx).numFmt = '$#,##0.00';
    sovTotRow.getCell(matColIdx + 1).numFmt = '$#,##0.00';
    sovTotRow.getCell(matColIdx + 2).numFmt = '$#,##0.00';
    sovTotRow.getCell(matColIdx + 3).numFmt = '$#,##0.00';
    sovTotRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      if (colNumber > 3) cell.alignment = { horizontal: 'center' };
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
