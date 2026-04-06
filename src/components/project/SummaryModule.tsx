import { useState } from 'react';
import { BarChart3, Download, FileText, Loader2 } from 'lucide-react';
import ExcelJS from 'exceljs';
import type { Project, Unit } from '@/types/project';
import { calcProjectSummary, calcUnitCabinetTotals, calcUnitCountertopTotal, calcCountertopSqft } from '@/lib/calculations';
import { exportProjectPDF } from '@/lib/exportPDF';
import { formatDoorStyle, formatKitchenTops, formatVanityTops, formatAdditionalTops, getDoorStylePendingFields } from '@/lib/formatSpecs';

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

    const allBorders: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FF999999' } },
      bottom: { style: 'thin', color: { argb: 'FF999999' } },
      left: { style: 'thin', color: { argb: 'FF999999' } },
      right: { style: 'thin', color: { argb: 'FF999999' } },
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

    // Excel helpers
    const excelCol = (col: number) => {
      let nn = col; let s = '';
      while (nn > 0) { const m = (nn - 1) % 26; s = String.fromCharCode(65 + m) + s; nn = Math.floor((nn - 1) / 26); }
      return s;
    };
    const ref = (col: number, row: number) => `${excelCol(col)}${row}`;
    const setFormula = (cell: ExcelJS.Cell, formula: string, result: number | string = 0) => {
      cell.value = { formula, result } as any;
    };
    const n = (expr: string) => `N(${expr})`;
    const safeMul = (a: string, b: string) => `IFERROR(${n(a)}*${n(b)},0)`;
    const safeAdd = (a: string, b: string) => `IFERROR(${n(a)}+${n(b)},0)`;
    const safeSum = (startRef: string, endRef: string) => `IFERROR(SUM(${startRef}:${endRef}),0)`;
    const safeSumColRange = (colRef: string, startRow: number, endRow: number) =>
      `IFERROR(SUM(${colRef}${startRow}:${colRef}${endRow}),0)`;

    const sp = project.specs as Record<string, any> | undefined;
    const redFont: Partial<ExcelJS.Font> = { color: { argb: 'FFCC0000' } };

    // ── Sheet 1: Project Info ───────────────────────────────────────
    const wsInfo = wb.addWorksheet('1-Project Info');
    wsInfo.columns = [{ width: 22 }, { width: 40 }, { width: 30 }];

    const boldUnderlineLabels = new Set([
      'Project Name', 'Address', 'Project Super', 'Customer',
      'Specifications', 'Kitchen Tops', 'Vanity Tops', 'Additional Tops',
      'Handles & Hardware', 'Sales Tax on Material',
    ]);

    const doorStylePendingFields = getDoorStylePendingFields(project.specs);
    const doorStyleSummaryRow: (string | undefined)[] = ['Door Style', formatDoorStyle(project.specs)];
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

    infoRows.forEach(({ cells: r, pendingNote }) => {
      const row = wsInfo.addRow(r);
      if (r.length > 0 && r[0] && boldUnderlineLabels.has(r[0])) {
        row.getCell(1).font = { bold: true, underline: true };
      }
      if (pendingNote) {
        const valCell = row.getCell(2);
        if (!valCell.value || String(valCell.value).trim() === '') valCell.value = '—';
        valCell.font = { ...valCell.font as any, ...redFont };
        const noteCell = row.getCell(3);
        noteCell.value = pendingNote;
        noteCell.font = { italic: true, ...redFont };
      }
    });

    // ── Sheet 2: Unit Count ─────────────────────────────────────────
    const uniqueTypes = Array.from(new Set(project.units.map(u => u.type).filter(Boolean))).sort();
    const wsUnits = wb.addWorksheet('2-Unit Count');
    wsUnits.columns = [
      { width: 3 },
      { width: 10 },
      { width: 10 },
      { width: 14 },
      ...uniqueTypes.map(() => ({ width: 6 })),
      { width: 8 },
    ];

    wsUnits.addRow([]);
    const titleRow = wsUnits.addRow([]);
    titleRow.getCell(2).value = 'UNIT COUNT';
    titleRow.getCell(2).font = { bold: true, size: 11 };
    titleRow.getCell(2).border = allBorders;
    wsUnits.addRow([]);

    // Row 4: header
    const unitHeader = wsUnits.addRow(['', 'Bldg', 'Floor', 'Unit #', ...uniqueTypes, 'Total']);
    unitHeader.height = 120;
    unitHeader.eachCell((cell, colNumber) => {
      if (colNumber <= 1) return;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
      cell.border = allBorders;
      cell.alignment = { vertical: 'bottom', wrapText: false };
      if (colNumber > 4 && colNumber <= uniqueTypes.length + 4) {
        cell.alignment = { textRotation: 90, vertical: 'bottom', horizontal: 'center' };
      }
      if (colNumber === uniqueTypes.length + 5) {
        cell.alignment = { vertical: 'bottom', horizontal: 'center' };
      }
    });

    wsUnits.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];

    const sortedUnits = [...project.units].sort((a, b) => {
      const bA = (a.bldg || '').toUpperCase();
      const bB = (b.bldg || '').toUpperCase();
      if (bA !== bB) return bA.localeCompare(bB, undefined, { numeric: true });
      return (a.unitNumber || '').localeCompare(b.unitNumber || '', undefined, { numeric: true });
    });

    sortedUnits.forEach(u => {
      const flags = uniqueTypes.map(t => (u.type === t ? 1 : ''));
      const rowTotal = uniqueTypes.filter(t => u.type === t).length;
      const row = wsUnits.addRow(['', u.bldg || '', fmtFloor(u.floor || ''), u.unitNumber, ...flags, rowTotal]);
      row.eachCell((cell, colNumber) => {
        if (colNumber <= 1) return;
        cell.border = allBorders;
        if (colNumber > 4) cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
    });

    wsUnits.addRow([]);
    const dataStartRow = 5;
    const dataEndRow = dataStartRow + sortedUnits.length - 1;
    const totRowValues: any[] = ['', '', '', `TOTAL (${project.units.length})`];
    for (let i = 0; i < uniqueTypes.length + 1; i++) totRowValues.push(0);
    const totRow = wsUnits.addRow(totRowValues);
    const ucTotRowNum = totRow.number;

    uniqueTypes.forEach((_t, idx) => {
      const cl = excelCol(5 + idx);
      const cell = totRow.getCell(5 + idx);
      const total = project.units.filter(u => u.type === uniqueTypes[idx]).length;
      cell.value = { formula: `SUM(${cl}${dataStartRow}:${cl}${dataEndRow})`, result: total } as any;
    });
    const grandTotalCol = 5 + uniqueTypes.length;
    const grandTotalCell = totRow.getCell(grandTotalCol);
    grandTotalCell.value = { formula: `SUM(${excelCol(5)}${ucTotRowNum}:${excelCol(4 + uniqueTypes.length)}${ucTotRowNum})`, result: project.units.length } as any;

    totRow.eachCell((cell, colNumber) => {
      if (colNumber <= 1) return;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      cell.border = allBorders;
      if (colNumber > 4) cell.alignment = { horizontal: 'center' };
    });

    // ── Sheet 3: Cabinet Count (blank template — 50 empty rows) ─────
    const wsCabs = wb.addWorksheet('3-Cabinet Count');
    const cabTypes = uniqueTypes; // same as unit types
    const nTypes = cabTypes.length;
    const ucHeaderRow = 4; // Unit Count header row (row 4)

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

    const colSpacer4 = colTotalCabGrand + 1;
    const colCpuLabel = colSpacer4 + 1;
    const colCpuFirstType = colCpuLabel + 1;

    // Column widths
    const colWidths: { width: number }[] = [];
    colWidths.push({ width: 22 });
    for (let i = 0; i < nTypes; i++) colWidths.push({ width: 6 });
    colWidths.push({ width: 8 });
    colWidths.push({ width: 3 });
    colWidths.push({ width: 10 });
    for (let i = 0; i < nTypes; i++) colWidths.push({ width: 6 });
    colWidths.push({ width: 8 });
    colWidths.push({ width: 3 });
    colWidths.push({ width: 10 });
    colWidths.push({ width: 10 });
    colWidths.push({ width: 10 });
    for (let i = 0; i < nTypes; i++) colWidths.push({ width: 8 });
    colWidths.push({ width: 10 });
    colWidths.push({ width: 3 });
    colWidths.push({ width: 14 });
    for (let i = 0; i < nTypes; i++) colWidths.push({ width: 6 });
    colWidths.push({ width: 8 });
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

    // Unit count reference row
    const unitCountRow = wsCabs.addRow([]);
    unitCountRow.getCell(colTotalCabLabel).value = 'Unit Count';
    unitCountRow.getCell(colTotalCabLabel).font = { bold: true, italic: true, size: 8 };
    for (let i = 0; i < nTypes; i++) {
      const cell = unitCountRow.getCell(colTotalCabFirstType + i);
      const cnt = project.units.filter(u => u.type === cabTypes[i]).length;
      cell.value = cnt;
      cell.alignment = { horizontal: 'center' };
      cell.font = { bold: true, size: 8 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
    }
    const totalUnitCount = project.units.length;
    const ucTotalCell = unitCountRow.getCell(colTotalCabFirstType + nTypes);
    ucTotalCell.value = totalUnitCount;
    ucTotalCell.alignment = { horizontal: 'center' };
    ucTotalCell.font = { bold: true, size: 8 };
    ucTotalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };

    // Header row — unit type names reference Unit Count sheet via formula
    const headerValues: (string | number)[] = [];
    headerValues.push('SKU Name');
    cabTypes.forEach(() => headerValues.push('')); // placeholder, formula set below
    headerValues.push('Total');
    headerValues.push('');
    headerValues.push('Pulls/Cab');
    cabTypes.forEach(() => headerValues.push(''));
    headerValues.push('Total');
    headerValues.push('');
    headerValues.push('Bid Cost');
    headerValues.push('Additional');
    headerValues.push('Total Cost');
    cabTypes.forEach(() => headerValues.push(''));
    headerValues.push('Total');
    headerValues.push('');
    headerValues.push('Total Cab Count');
    cabTypes.forEach(() => headerValues.push(''));
    headerValues.push('Grand Total');
    headerValues.push('');
    headerValues.push('Cab Count/Unit');
    cabTypes.forEach(() => headerValues.push(''));

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

    // Set unit type header names via formula from Unit Count sheet
    for (let i = 0; i < nTypes; i++) {
      const ucTypeCol = excelCol(5 + i);
      // Cabinet section type headers
      setFormula(cabHeader.getCell(colCabFirstType + i), `'2-Unit Count'!${ucTypeCol}${ucHeaderRow}`, cabTypes[i]);
      // Pulls section type headers
      setFormula(cabHeader.getCell(colPullsFirstType + i), `'2-Unit Count'!${ucTypeCol}${ucHeaderRow}`, cabTypes[i]);
      // Pricing section type headers
      setFormula(cabHeader.getCell(colPricingFirstType + i), `'2-Unit Count'!${ucTypeCol}${ucHeaderRow}`, cabTypes[i]);
      // Total cab count type headers
      setFormula(cabHeader.getCell(colTotalCabFirstType + i), `'2-Unit Count'!${ucTypeCol}${ucHeaderRow}`, cabTypes[i]);
      // Cab count per unit type headers
      setFormula(cabHeader.getCell(colCpuFirstType + i), `'2-Unit Count'!${ucTypeCol}${ucHeaderRow}`, cabTypes[i]);
    }

    wsCabs.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }];

    const dataRangeStartRow = cabHeader.number + 1;

    // 50 blank rows for user to fill in cabinet SKUs
    for (let rowIdx = 0; rowIdx < 50; rowIdx++) {
      const rowValues: (string | number)[] = [];
      rowValues.push(''); // SKU blank
      for (let i = 0; i < nTypes; i++) rowValues.push(''); // cab qty
      rowValues.push(''); // cab total
      rowValues.push(''); // spacer
      rowValues.push(''); // pulls/cab
      for (let i = 0; i < nTypes; i++) rowValues.push(''); // pulls per type
      rowValues.push(''); // pulls total
      rowValues.push(''); // spacer
      rowValues.push(''); // bid
      rowValues.push(''); // additional
      rowValues.push(''); // total cost
      for (let i = 0; i < nTypes; i++) rowValues.push(''); // pricing per type
      rowValues.push(''); // pricing total
      rowValues.push(''); // spacer
      rowValues.push(''); // total cab label
      for (let i = 0; i < nTypes; i++) rowValues.push(''); // total cab per type
      rowValues.push(''); // grand total
      rowValues.push(''); // spacer
      rowValues.push(''); // cpu label
      for (let i = 0; i < nTypes; i++) rowValues.push(''); // cpu per type

      const row = wsCabs.addRow(rowValues);
      const r = row.number;

      // Cabinet Total = SUM(cab type cols)
      if (nTypes > 0) {
        setFormula(row.getCell(colCabTotal), safeSum(ref(colCabFirstType, r), ref(colCabFirstType + nTypes - 1, r)), 0);
      }

      // Pulls per type = Pulls/Cab × Cabinet Qty
      for (let i = 0; i < nTypes; i++) {
        setFormula(row.getCell(colPullsFirstType + i), safeMul(ref(colPullsPerCab, r), ref(colCabFirstType + i, r)), 0);
      }
      if (nTypes > 0) {
        setFormula(row.getCell(colPullsTotal), safeSum(ref(colPullsFirstType, r), ref(colPullsFirstType + nTypes - 1, r)), 0);
      }

      // Total cabinet count per type = Cabinet Qty × Unit Count
      for (let i = 0; i < nTypes; i++) {
        const unitCountAbs = `$${excelCol(colTotalCabFirstType + i)}$${unitCountRow.number}`;
        setFormula(row.getCell(colTotalCabFirstType + i), safeMul(ref(colCabFirstType + i, r), unitCountAbs), 0);
      }
      if (nTypes > 0) {
        setFormula(row.getCell(colTotalCabGrand), safeSum(ref(colTotalCabFirstType, r), ref(colTotalCabFirstType + nTypes - 1, r)), 0);
      }

      row.eachCell((cell, colNumber) => {
        if (colNumber > 1) cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
    }

    const dataRangeEndRow = wsCabs.lastRow?.number || dataRangeStartRow;

    // Totals row
    wsCabs.addRow([]);
    const cabTotRow = wsCabs.addRow([]);
    cabTotRow.getCell(colSku).value = 'TOTAL';

    for (let i = 0; i < nTypes; i++) {
      setFormula(cabTotRow.getCell(colCabFirstType + i), safeSumColRange(excelCol(colCabFirstType + i), dataRangeStartRow, dataRangeEndRow), 0);
    }
    setFormula(cabTotRow.getCell(colCabTotal), safeSumColRange(excelCol(colCabTotal), dataRangeStartRow, dataRangeEndRow), 0);
    for (let i = 0; i < nTypes; i++) {
      setFormula(cabTotRow.getCell(colPullsFirstType + i), safeSumColRange(excelCol(colPullsFirstType + i), dataRangeStartRow, dataRangeEndRow), 0);
    }
    setFormula(cabTotRow.getCell(colPullsTotal), safeSumColRange(excelCol(colPullsTotal), dataRangeStartRow, dataRangeEndRow), 0);
    setFormula(cabTotRow.getCell(colPricingBid), safeSumColRange(excelCol(colPricingBid), dataRangeStartRow, dataRangeEndRow), 0);
    setFormula(cabTotRow.getCell(colPricingAdditional), safeSumColRange(excelCol(colPricingAdditional), dataRangeStartRow, dataRangeEndRow), 0);
    setFormula(cabTotRow.getCell(colPricingTotal), safeSumColRange(excelCol(colPricingTotal), dataRangeStartRow, dataRangeEndRow), 0);
    for (let i = 0; i < nTypes; i++) {
      setFormula(cabTotRow.getCell(colPricingFirstType + i), safeSumColRange(excelCol(colPricingFirstType + i), dataRangeStartRow, dataRangeEndRow), 0);
    }
    setFormula(cabTotRow.getCell(colPricingTypeTotal), safeSumColRange(excelCol(colPricingTypeTotal), dataRangeStartRow, dataRangeEndRow), 0);
    cabTotRow.getCell(colTotalCabLabel).value = 'TOTAL';
    for (let i = 0; i < nTypes; i++) {
      setFormula(cabTotRow.getCell(colTotalCabFirstType + i), safeSumColRange(excelCol(colTotalCabFirstType + i), dataRangeStartRow, dataRangeEndRow), 0);
    }
    setFormula(cabTotRow.getCell(colTotalCabGrand), safeSumColRange(excelCol(colTotalCabGrand), dataRangeStartRow, dataRangeEndRow), 0);

    cabTotRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };
      if (colNumber > 1) cell.alignment = { horizontal: 'center' };
    });

    // Pricing input rows
    const bidCostRow = wsCabs.addRow([]);
    bidCostRow.getCell(colPricingBid).value = 'Bid Cost/Type';
    bidCostRow.getCell(colPricingBid).font = { bold: true, italic: true, size: 8 };
    for (let i = 0; i < nTypes; i++) {
      const cell = bidCostRow.getCell(colPricingFirstType + i);
      cell.value = 0;
      cell.numFmt = '$#,##0.00';
      cell.alignment = { horizontal: 'center' };
      cell.font = { italic: true, size: 8 };
    }

    const addCostRow = wsCabs.addRow([]);
    addCostRow.getCell(colPricingAdditional).value = 'Additional/Type';
    addCostRow.getCell(colPricingAdditional).font = { bold: true, italic: true, size: 8 };
    for (let i = 0; i < nTypes; i++) {
      const cell = addCostRow.getCell(colPricingFirstType + i);
      cell.value = 0;
      cell.numFmt = '$#,##0.00';
      cell.alignment = { horizontal: 'center' };
      cell.font = { italic: true, size: 8 };
    }

    const totalCostRow = wsCabs.addRow([]);
    totalCostRow.getCell(colPricingTotal).value = 'Total/Type';
    totalCostRow.getCell(colPricingTotal).font = { bold: true, italic: true, size: 8 };
    for (let i = 0; i < nTypes; i++) {
      const cell = totalCostRow.getCell(colPricingFirstType + i);
      setFormula(cell, safeAdd(`$${excelCol(colPricingFirstType + i)}$${bidCostRow.number}`, `$${excelCol(colPricingFirstType + i)}$${addCostRow.number}`), 0);
      cell.numFmt = '$#,##0.00';
      cell.alignment = { horizontal: 'center' };
      cell.font = { italic: true, size: 8 };
    }

    // Patch pricing formulas onto each blank row
    for (let r = dataRangeStartRow; r <= dataRangeEndRow; r++) {
      const rowObj = wsCabs.getRow(r);
      const bidCell = rowObj.getCell(colPricingBid);
      const addCell = rowObj.getCell(colPricingAdditional);
      const totCell = rowObj.getCell(colPricingTotal);
      const typeTotCell = rowObj.getCell(colPricingTypeTotal);

      if (nTypes === 0) {
        setFormula(bidCell, '0', 0);
        setFormula(addCell, '0', 0);
        setFormula(totCell, '0', 0);
        setFormula(typeTotCell, '0', 0);
        continue;
      }

      const partsBid: string[] = [];
      const partsAdd: string[] = [];
      const pricingTypeRefs: string[] = [];

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

      setFormula(bidCell, partsBid.join('+'), 0);
      setFormula(addCell, partsAdd.join('+'), 0);
      setFormula(totCell, safeAdd(ref(colPricingBid, r), ref(colPricingAdditional, r)), 0);
      setFormula(typeTotCell, safeSum(pricingTypeRefs[0], pricingTypeRefs[pricingTypeRefs.length - 1]), 0);

      bidCell.numFmt = '$#,##0.00';
      addCell.numFmt = '$#,##0.00';
      totCell.numFmt = '$#,##0.00';
      typeTotCell.numFmt = '$#,##0.00';
    }

    // ── Sheet 4: Costing ────────────────────────────────────────────
    const wsCosting = wb.addWorksheet('4-Costing');

    const cc = {
      blank: 1, type: 2, qty: 3, cabsCost: 4,
      pullsQty: 5, pullsCost: 6,
      plamLft: 7, plamSlab: 8, plamTotalLft: 9, plamCost: 10,
      plamSsQty: 11, plamSsCost: 12,
      bartopLft: 13, bartopSlab: 14, bartopTotalLft: 15, bartopCost: 16,
      ktopSqft: 17, ktopCost: 18,
      kBackSplash: 19, kSinkCutout: 20, kFaucetHoles: 21, kRangeCutout: 22,
      vtopSqft: 23, vtopCost: 24,
      vBackSplash: 25, vSinkCutout: 26, vFaucetHoles: 27,
      stickQty: 28, stickCost: 29,
      dwQty: 30, dwCost: 31,
      laborCost: 32, deliveryCost: 33, ldCost: 34,
      costPerUnit: 35, costExt: 36,
      spacer: 37,
      cabsRetail: 38, pullsRetail: 39, plamRetail: 40, ktopRetail: 41, vtopRetail: 42,
      stickRetail: 43, dwRetail: 44, laborRetail: 45, deliveryRetail: 46, ldRetail: 47,
      retailPerUnit: 48, retailExt: 49,
      spacer2: 50,
      cabsTotalCost: 51, cabsTotalRetail: 52,
      pullsTotalCost: 53, pullsTotalRetail: 54,
      plamTotalCostCol: 55, plamTotalRetailCol: 56,
      ktopTotalCost: 57, ktopTotalRetail: 58,
      vtopTotalCost: 59, vtopTotalRetail: 60,
      stickTotalCost: 61, stickTotalRetail: 62,
      dwTotalCost: 63, dwTotalRetail: 64,
      laborTotalCost: 65, laborTotalRetail: 66,
      deliveryTotalCost: 67, deliveryTotalRetail: 68,
      ldTotalCost: 69, ldTotalRetail: 70,
      material: 71, labor: 72, tax: 73,
      retailPerUnit2: 74, retailExt2: 75,
      spacer3: 76,
      sumLabel: 77, sumRetail: 78, sumMargin: 79,
      spacer4: 80, sumCost: 81,
    };

    const SAFFRON = 'FFFFF2CC';

    wsCosting.columns = [
      { width: 3 },
      { width: 30 }, { width: 8 }, { width: 14 },
      { width: 10 }, { width: 12 },
      { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 },
      { width: 10 }, { width: 14 }, // PLAM SS QTY, PLAM SS COST
      { width: 10 }, { width: 14 },
      { width: 14 }, { width: 14 }, { width: 12 }, { width: 14 },
      { width: 10 }, { width: 14 },
      { width: 14 }, { width: 14 }, { width: 12 },
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
      [cc.kBackSplash]: 'BACK &\nSIDESPLASH\nSQFT',
      [cc.kSinkCutout]: 'UNDERMOUNT\nKITCHEN SINK\nCUTOUT',
      [cc.kFaucetHoles]: 'FAUCET\nHOLES\n(select upto 3)',
      [cc.kRangeCutout]: 'FREE STANDING\nRANGE CUTOUT\nQTY',
      [cc.vtopSqft]: 'VTOP\nSQFT',
      [cc.vtopCost]: 'QUARTZ GRP1\nVTOP COST',
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

    // Row 3: Saffron rate/multiplier row
    const costRateRow = wsCosting.addRow([]);
    const saffronCostCols = [cc.pullsCost, cc.plamCost, cc.plamSsCost, cc.ktopCost, cc.vtopCost, cc.stickCost, cc.dwCost, cc.deliveryCost, cc.ldCost];
    const saffronRetailCols = [cc.cabsRetail, cc.pullsRetail, cc.plamRetail, cc.ktopRetail, cc.vtopRetail, cc.stickRetail, cc.dwRetail, cc.laborRetail, cc.deliveryRetail, cc.ldRetail];
    const saffronTotalCols = [cc.tax];
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

    // Build mapping from type to Unit Count sheet column index
    const ucTypeIndexMap: Record<string, number> = {};
    uniqueTypes.forEach((ut, idx) => { ucTypeIndexMap[ut] = idx; });

    // Data rows per unit type
    cabTypes.forEach((t, i) => {
      const row = wsCosting.addRow([]);
      const r = row.number;

      // TYPE NAME — reference Unit Count sheet header
      const ucIdx = ucTypeIndexMap[t];
      if (ucIdx !== undefined) {
        const ucTypeCol = excelCol(5 + ucIdx);
        setFormula(row.getCell(cc.type), `'2-Unit Count'!${ucTypeCol}${ucHeaderRow}`, t);
      } else {
        row.getCell(cc.type).value = t;
      }
      row.getCell(cc.type).border = allBorders;
      row.getCell(cc.qty).border = allBorders;

      // QTY — reference Unit Count sheet total row
      if (ucIdx !== undefined) {
        const ucTypeCol = excelCol(5 + ucIdx);
        setFormula(row.getCell(cc.qty), `'2-Unit Count'!${ucTypeCol}${ucTotRowNum}`, project.units.filter(u => u.type === t).length);
      } else {
        row.getCell(cc.qty).value = project.units.filter(u => u.type === t).length;
      }

      // CABS COST per unit
      setFormula(row.getCell(cc.cabsCost), safeMul(
        `'3-Cabinet Count'!${ref(colCabFirstType + i, cabTotRow.number)}`,
        `'3-Cabinet Count'!${ref(colPricingFirstType + i, totalCostRow.number)}`
      ), 0);
      row.getCell(cc.cabsCost).numFmt = '$#,##0.00';

      // PULLS QTY
      setFormula(row.getCell(cc.pullsQty), `'3-Cabinet Count'!${ref(colPullsFirstType + i, cabTotRow.number)}`, 0);

      // PULLS COST
      setFormula(row.getCell(cc.pullsCost), safeMul(ref(cc.pullsQty, r), `$${excelCol(cc.pullsCost)}$${costRateRowNum}`), 0);
      row.getCell(cc.pullsCost).numFmt = '$#,##0.00';

      // PLAM KTOP LFT, SLAB, TOTAL LFT — blank for user
      row.getCell(cc.plamLft).border = allBorders;
      row.getCell(cc.plamSlab).border = allBorders;
      row.getCell(cc.plamTotalLft).border = allBorders;

      // PLAM KTOP COST
      setFormula(row.getCell(cc.plamCost), safeMul(ref(cc.plamTotalLft, r), `$${excelCol(cc.plamCost)}$${costRateRowNum}`), 0);
      row.getCell(cc.plamCost).numFmt = '$#,##0.00';

      // PLAM SS COST = SS QTY × rate
      setFormula(row.getCell(cc.plamSsCost), safeMul(ref(cc.plamSsQty, r), `$${excelCol(cc.plamSsCost)}$${costRateRowNum}`), 0);
      row.getCell(cc.plamSsCost).numFmt = '$#,##0.00';

      // KTOP COST
      setFormula(row.getCell(cc.ktopCost), safeMul(ref(cc.ktopSqft, r), `$${excelCol(cc.ktopCost)}$${costRateRowNum}`), 0);
      row.getCell(cc.ktopCost).numFmt = '$#,##0.00';

      // VTOP COST
      setFormula(row.getCell(cc.vtopCost), safeMul(ref(cc.vtopSqft, r), `$${excelCol(cc.vtopCost)}$${costRateRowNum}`), 0);
      row.getCell(cc.vtopCost).numFmt = '$#,##0.00';

      // STICK COST
      setFormula(row.getCell(cc.stickCost), safeMul(ref(cc.stickQty, r), `$${excelCol(cc.stickCost)}$${costRateRowNum}`), 0);
      row.getCell(cc.stickCost).numFmt = '$#,##0.00';

      // DW BRACKETS COST
      setFormula(row.getCell(cc.dwCost), safeMul(ref(cc.dwQty, r), `$${excelCol(cc.dwCost)}$${costRateRowNum}`), 0);
      row.getCell(cc.dwCost).numFmt = '$#,##0.00';

      // DELIVERY
      setFormula(row.getCell(cc.deliveryCost), `$${excelCol(cc.deliveryCost)}$${costRateRowNum}`, 100);
      row.getCell(cc.deliveryCost).numFmt = '$#,##0.00';

      // LOAD & DISTRIBUTION
      setFormula(row.getCell(cc.ldCost), `$${excelCol(cc.ldCost)}$${costRateRowNum}`, 100);
      row.getCell(cc.ldCost).numFmt = '$#,##0.00';

      // COST PER UNIT
      const costCols = [cc.cabsCost, cc.pullsCost, cc.plamCost, cc.plamSsCost, cc.ktopCost, cc.vtopCost, cc.stickCost, cc.dwCost, cc.laborCost, cc.deliveryCost, cc.ldCost];
      setFormula(row.getCell(cc.costPerUnit), `IFERROR(${costCols.map(c => `N(${ref(c, r)})`).join('+')},0)`, 0);
      row.getCell(cc.costPerUnit).numFmt = '$#,##0.00';

      // COST EXT
      setFormula(row.getCell(cc.costExt), safeMul(ref(cc.costPerUnit, r), ref(cc.qty, r)), 0);
      row.getCell(cc.costExt).numFmt = '$#,##0.00';

      // RETAIL
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
      // PLAM RETAIL = (plamCost + plamSsCost) × multiplier
      setFormula(row.getCell(cc.plamRetail), `IFERROR((N(${ref(cc.plamCost, r)})+N(${ref(cc.plamSsCost, r)}))*N($${excelCol(cc.plamRetail)}$${costRateRowNum}),0)`, 0);
      row.getCell(cc.plamRetail).numFmt = '$#,##0.00';

      // RETAIL PER UNIT (includes plamRetail separately)
      const allRetailRefs = [...retailMap.map(m => `N(${ref(m.retail, r)})`), `N(${ref(cc.plamRetail, r)})`];
      setFormula(row.getCell(cc.retailPerUnit), `IFERROR(${allRetailRefs.join('+')},0)`, 0);
      row.getCell(cc.retailPerUnit).numFmt = '$#,##0.00';

      // RETAIL EXT
      setFormula(row.getCell(cc.retailExt), safeMul(ref(cc.retailPerUnit, r), ref(cc.qty, r)), 0);
      row.getCell(cc.retailExt).numFmt = '$#,##0.00';

      // TOTAL COST & TOTAL RETAIL
      const totalPairs = [
        { totalCost: cc.cabsTotalCost, totalRetail: cc.cabsTotalRetail, cost: cc.cabsCost, retail: cc.cabsRetail },
        { totalCost: cc.pullsTotalCost, totalRetail: cc.pullsTotalRetail, cost: cc.pullsCost, retail: cc.pullsRetail },
        { totalCost: cc.plamTotalCostCol, totalRetail: cc.plamTotalRetailCol, cost: cc.plamCost, retail: cc.plamRetail, extraCost: cc.plamSsCost },
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
          setFormula(row.getCell(totalCost), `IFERROR((N(${ref(cost, r)})+N(${ref(extraCost, r)}))*N(${ref(cc.qty, r)}),0)`, 0);
        } else {
          setFormula(row.getCell(totalCost), safeMul(ref(cost, r), ref(cc.qty, r)), 0);
        }
        row.getCell(totalCost).numFmt = '$#,##0.00';
        setFormula(row.getCell(totalRetail), safeMul(ref(retail, r), ref(cc.qty, r)), 0);
        row.getCell(totalRetail).numFmt = '$#,##0.00';
      });

      // MATERIAL
      const matRetailCols = [cc.cabsTotalRetail, cc.pullsTotalRetail, cc.plamTotalRetailCol, cc.ktopTotalRetail, cc.vtopTotalRetail, cc.stickTotalRetail, cc.dwTotalRetail];
      setFormula(row.getCell(cc.material), `IFERROR(${matRetailCols.map(c => `N(${ref(c, r)})`).join('+')},0)`, 0);
      row.getCell(cc.material).numFmt = '$#,##0.00';

      // LABOR
      setFormula(row.getCell(cc.labor), `N(${ref(cc.laborTotalRetail, r)})`, 0);
      row.getCell(cc.labor).numFmt = '$#,##0.00';

      // TAX
      setFormula(row.getCell(cc.tax), safeMul(ref(cc.material, r), `$${excelCol(cc.tax)}$${costRateRowNum}`), 0);
      row.getCell(cc.tax).numFmt = '$#,##0.00';

      // RETAIL PER UNIT 2
      setFormula(row.getCell(cc.retailPerUnit2), `IFERROR(N(${ref(cc.material, r)})+N(${ref(cc.labor, r)})+N(${ref(cc.tax, r)}),0)`, 0);
      row.getCell(cc.retailPerUnit2).numFmt = '$#,##0.00';

      // RETAIL EXT 2
      setFormula(row.getCell(cc.retailExt2), safeMul(ref(cc.retailPerUnit2, r), ref(cc.qty, r)), 0);
      row.getCell(cc.retailExt2).numFmt = '$#,##0.00';

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
      cc.ktopSqft, cc.ktopCost, cc.kBackSplash, cc.kSinkCutout, cc.kFaucetHoles, cc.kRangeCutout,
      cc.vtopSqft, cc.vtopCost, cc.vBackSplash, cc.vSinkCutout, cc.vFaucetHoles,
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
      cc.cabsCost, cc.pullsCost, cc.plamCost, cc.plamSsCost, cc.ktopCost, cc.vtopCost, cc.stickCost, cc.dwCost, cc.laborCost,
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

    // Summary table
    const sumHeaderRowNum = costHeaderRow2.number;
    const sumStartRow = sumHeaderRowNum;

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
    const sumItemStartRow = sumStartRow + 1;

    summaryItems.forEach((item, idx) => {
      const targetRow = sumItemStartRow + idx;
      const rowObj = wsCosting.getRow(targetRow);

      rowObj.getCell(cc.sumLabel).value = item.label;
      rowObj.getCell(cc.sumLabel).font = { size: 8 };
      rowObj.getCell(cc.sumLabel).border = allBorders;

      const retailRef = `${excelCol(item.retailCol)}${totRowNum}`;
      setFormula(rowObj.getCell(cc.sumRetail), `N(${retailRef})`, 0);
      rowObj.getCell(cc.sumRetail).numFmt = '$#,##0.00';
      rowObj.getCell(cc.sumRetail).alignment = { horizontal: 'center' };
      rowObj.getCell(cc.sumRetail).border = allBorders;

      if (item.showMargin) {
        const costRef = `${excelCol(item.costCol)}${totRowNum}`;
        const retRef = ref(cc.sumRetail, targetRow);
        setFormula(rowObj.getCell(cc.sumMargin), `IFERROR(1-(N(${costRef})/N(${retRef})),0)`, 0);
        rowObj.getCell(cc.sumMargin).numFmt = '0.00%';
      }
      rowObj.getCell(cc.sumMargin).alignment = { horizontal: 'center' };
      rowObj.getCell(cc.sumMargin).border = allBorders;

      const costRef2 = `${excelCol(item.costCol)}${totRowNum}`;
      setFormula(rowObj.getCell(cc.sumCost), `N(${costRef2})`, 0);
      rowObj.getCell(cc.sumCost).numFmt = '$#,##0.00';
      rowObj.getCell(cc.sumCost).alignment = { horizontal: 'center' };
      rowObj.getCell(cc.sumCost).border = allBorders;
    });

    const sumTotalRowNum = sumItemStartRow + summaryItems.length;
    const sumTotRow = wsCosting.getRow(sumTotalRowNum);
    sumTotRow.getCell(cc.sumLabel).value = 'TOTAL';
    sumTotRow.getCell(cc.sumLabel).font = { bold: true, size: 9 };
    sumTotRow.getCell(cc.sumLabel).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    sumTotRow.getCell(cc.sumLabel).border = allBorders;

    setFormula(sumTotRow.getCell(cc.sumRetail),
      safeSum(ref(cc.sumRetail, sumItemStartRow), ref(cc.sumRetail, sumItemStartRow + summaryItems.length - 1)), 0);
    sumTotRow.getCell(cc.sumRetail).numFmt = '$#,##0.00';
    sumTotRow.getCell(cc.sumRetail).font = { bold: true };
    sumTotRow.getCell(cc.sumRetail).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    sumTotRow.getCell(cc.sumRetail).alignment = { horizontal: 'center' };
    sumTotRow.getCell(cc.sumRetail).border = allBorders;

    setFormula(sumTotRow.getCell(cc.sumCost),
      safeSum(ref(cc.sumCost, sumItemStartRow), ref(cc.sumCost, sumItemStartRow + summaryItems.length - 1)), 0);
    sumTotRow.getCell(cc.sumCost).numFmt = '$#,##0.00';
    sumTotRow.getCell(cc.sumCost).font = { bold: true };
    sumTotRow.getCell(cc.sumCost).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    sumTotRow.getCell(cc.sumCost).alignment = { horizontal: 'center' };
    sumTotRow.getCell(cc.sumCost).border = allBorders;

    setFormula(sumTotRow.getCell(cc.sumMargin),
      `IFERROR(1-(N(${ref(cc.sumCost, sumTotalRowNum)})/N(${ref(cc.sumRetail, sumTotalRowNum)})),0)`, 0);
    sumTotRow.getCell(cc.sumMargin).numFmt = '0.00%';
    sumTotRow.getCell(cc.sumMargin).font = { bold: true };
    sumTotRow.getCell(cc.sumMargin).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    sumTotRow.getCell(cc.sumMargin).alignment = { horizontal: 'center' };
    sumTotRow.getCell(cc.sumMargin).border = allBorders;

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
