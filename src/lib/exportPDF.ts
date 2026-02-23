import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Project } from '@/types/project';
import { calcProjectSummary, calcUnitCabinetTotals, calcUnitCountertopTotal, calcCountertopSqft } from '@/lib/calculations';

// Brand colors
const BLUE_DARK = [22, 60, 110] as [number, number, number];
const BLUE_MID = [41, 98, 168] as [number, number, number];
const BLUE_LIGHT = [224, 234, 248] as [number, number, number];
const GRAY_LIGHT = [245, 247, 250] as [number, number, number];
const GRAY_MID = [180, 188, 200] as [number, number, number];
const WHITE = [255, 255, 255] as [number, number, number];
const TEXT_DARK = [20, 30, 48] as [number, number, number];
const TEXT_MID = [80, 95, 115] as [number, number, number];

function hexColor(rgb: [number, number, number]) {
  return rgb.map(v => v.toString(16).padStart(2, '0')).join('');
}

export function exportProjectPDF(project: Project) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const summary = calcProjectSummary(project);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageW - margin * 2;

  // ─── HEADER BANNER ───
  doc.setFillColor(...BLUE_DARK);
  doc.rect(0, 0, pageW, 70, 'F');

  // Logo circle
  doc.setFillColor(...BLUE_MID);
  doc.circle(margin + 22, 35, 22, 'F');
  doc.setFillColor(...WHITE);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...WHITE);
  doc.text('CT', margin + 22, 35, { align: 'center', baseline: 'middle' });

  // App name
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...WHITE);
  doc.text('CabinetTakeoff Pro', margin + 50, 30);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY_MID);
  doc.text('Kitchen & Countertop Estimating', margin + 50, 44);

  // Report label on right
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLUE_LIGHT);
  doc.text('TAKEOFF REPORT', pageW - margin, 27, { align: 'right' });
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY_MID);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, pageW - margin, 42, { align: 'right' });

  let y = 90;

  // ─── PROJECT INFO ───
  doc.setFillColor(...GRAY_LIGHT);
  doc.roundedRect(margin, y, contentW, 70, 4, 4, 'F');
  doc.setDrawColor(...BLUE_MID);
  doc.setLineWidth(3);
  doc.line(margin, y + 4, margin, y + 66);
  doc.setLineWidth(0.5);

  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TEXT_DARK);
  doc.text(project.name, margin + 14, y + 22);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_MID);
  if (project.address) doc.text(`📍  ${project.address}`, margin + 14, y + 37);
  doc.text(`Project Type: ${project.type}`, margin + 14, y + 51);

  // Type badge on right
  doc.setFillColor(...BLUE_MID);
  doc.roundedRect(pageW - margin - 70, y + 15, 70, 20, 3, 3, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...WHITE);
  doc.text(project.type.toUpperCase(), pageW - margin - 35, y + 28, { align: 'center' });

  y += 85;

  // ─── SUMMARY STAT CARDS ───
  const cardW = (contentW - 12) / 4;
  const stats = [
    { label: 'Total Units', value: String(summary.totalUnits) },
    { label: 'Total Cabinets', value: String(summary.totalCabinets) },
    { label: 'Unique SKUs', value: String(summary.skuSummary.length) },
    { label: 'CT Total Sqft', value: String(summary.totalCountertopSqft) },
  ];
  stats.forEach((s, i) => {
    const x = margin + i * (cardW + 4);
    doc.setFillColor(...WHITE);
    doc.setDrawColor(...BLUE_LIGHT);
    doc.setLineWidth(1);
    doc.roundedRect(x, y, cardW, 48, 3, 3, 'FD');
    doc.setFillColor(...BLUE_MID);
    doc.rect(x, y, cardW, 4, 'F');
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BLUE_DARK);
    doc.text(s.value, x + cardW / 2, y + 28, { align: 'center' });
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_MID);
    doc.text(s.label.toUpperCase(), x + cardW / 2, y + 40, { align: 'center' });
  });

  y += 62;

  // ─── CABINET BREAKDOWN CARDS ───
  const cStats = [
    { label: 'Base', value: summary.totalBase },
    { label: 'Wall', value: summary.totalWall },
    { label: 'Tall', value: summary.totalTall },
    { label: 'Vanity', value: summary.totalVanity },
  ];
  const cCardW = (contentW - 12) / 4;
  cStats.forEach((s, i) => {
    const x = margin + i * (cCardW + 4);
    doc.setFillColor(...BLUE_LIGHT);
    doc.roundedRect(x, y, cCardW, 32, 3, 3, 'F');
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BLUE_DARK);
    doc.text(String(s.value), x + cCardW / 2, y + 16, { align: 'center' });
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_MID);
    doc.text(`${s.label.toUpperCase()} CABINETS`, x + cCardW / 2, y + 27, { align: 'center' });
  });

  y += 44;

  // ─── SECTION HEADER helper ───
  const sectionHeader = (title: string, yPos: number) => {
    doc.setFillColor(...BLUE_DARK);
    doc.roundedRect(margin, yPos, contentW, 20, 2, 2, 'F');
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...WHITE);
    doc.text(title, margin + 10, yPos + 13);
    return yPos + 24;
  };

  // ─── UNIT BREAKDOWN TABLE ───
  if (project.units.length > 0) {
    y = sectionHeader('UNIT BREAKDOWN', y);

    const unitRows = project.units.map(u => {
      const c = calcUnitCabinetTotals(u);
      const sqft = calcUnitCountertopTotal(u);
      const fillers = u.accessories.filter(a => a.type === 'Filler').reduce((s, a) => s + a.quantity, 0);
      return [
        `#${u.unitNumber}`,
        u.type,
        String(c.total),
        String(c.base),
        String(c.wall),
        String(c.tall),
        String(fillers),
        sqft.toFixed(0),
      ];
    });

    // Totals row
    unitRows.push([
      'TOTAL', '',
      String(summary.totalCabinets),
      String(summary.totalBase),
      String(summary.totalWall),
      String(summary.totalTall),
      String(summary.accessorySummary.totalFillers),
      String(summary.totalCountertopSqft),
    ]);

    autoTable(doc, {
      startY: y,
      head: [['Unit #', 'Type', 'Cabinets', 'Base', 'Wall', 'Tall', 'Fillers', 'CT Sqft']],
      body: unitRows,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 4, textColor: TEXT_DARK, lineColor: [220, 228, 240], lineWidth: 0.5 },
      headStyles: { fillColor: BLUE_MID, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5 },
      alternateRowStyles: { fillColor: GRAY_LIGHT },
      didParseCell: (data) => {
        if (data.row.index === unitRows.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = BLUE_LIGHT;
          data.cell.styles.textColor = BLUE_DARK;
        }
      },
    });

    y = (doc as any).lastAutoTable.finalY + 14;
  }

  // ─── SKU SUMMARY TABLE ───
  if (summary.skuSummary.length > 0) {
    // Check if we need a new page
    if (y > pageH - 200) {
      doc.addPage();
      y = 40;
    }

    y = sectionHeader('SKU SUMMARY — ALL UNITS', y);

    const skuRows = summary.skuSummary.map(s => [
      s.sku,
      s.type,
      `${s.width}"`,
      `${s.height}"`,
      `${s.depth}"`,
      s.rooms.join(', '),
      String(s.totalQty),
    ]);

    autoTable(doc, {
      startY: y,
      head: [['SKU', 'Type', 'Width', 'Height', 'Depth', 'Rooms', 'Total Qty']],
      body: skuRows,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 4, textColor: TEXT_DARK, lineColor: [220, 228, 240], lineWidth: 0.5, font: 'courier' },
      headStyles: { fillColor: BLUE_MID, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5, font: 'helvetica' },
      alternateRowStyles: { fillColor: GRAY_LIGHT },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 70 },
        6: { fontStyle: 'bold', halign: 'right' },
      },
    });

    y = (doc as any).lastAutoTable.finalY + 14;
  }

  // ─── ACCESSORIES TABLE ───
  if (y > pageH - 200) {
    doc.addPage();
    y = 40;
  }

  y = sectionHeader('ACCESSORIES SUMMARY', y);

  const accRows = [
    ['Fillers', String(summary.accessorySummary.totalFillers), 'pcs'],
    ['Finished Panels', String(summary.accessorySummary.totalPanels), 'pcs'],
    ['Toe Kick', summary.accessorySummary.totalToeKickLF.toFixed(1), 'Linear Feet'],
    ['Crown Molding', summary.accessorySummary.totalCrownLF.toFixed(1), 'Linear Feet'],
    ['Light Rail', summary.accessorySummary.totalLightRailLF.toFixed(1), 'Linear Feet'],
    ['Hardware', String(summary.accessorySummary.totalHardware), 'pcs'],
  ];

  autoTable(doc, {
    startY: y,
    head: [['Item', 'Quantity', 'Unit']],
    body: accRows,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: 4, textColor: TEXT_DARK, lineColor: [220, 228, 240], lineWidth: 0.5 },
    headStyles: { fillColor: BLUE_MID, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: GRAY_LIGHT },
    columnStyles: {
      1: { fontStyle: 'bold', halign: 'right' },
      2: { textColor: TEXT_MID },
    },
    tableWidth: contentW / 2,
  });

  y = (doc as any).lastAutoTable.finalY + 14;

  // ─── COUNTERTOP SUMMARY ───
  if (y > pageH - 200) {
    doc.addPage();
    y = 40;
  }

  y = sectionHeader('COUNTERTOP SUMMARY — BY UNIT', y);

  if (project.units.some(u => u.countertops.length > 0)) {
    const ctRows: string[][] = [];
    project.units.forEach(u => {
      u.countertops.forEach(ct => {
        const rounded = calcCountertopSqft(ct);
        ctRows.push([
          `#${u.unitNumber}`,
          ct.label,
          `${ct.length}"`,
          `${ct.depth}"`,
          ct.isIsland ? 'Island' : 'Perimeter',
          ct.addWaste ? 'Yes' : 'No',
          String(rounded),
        ]);
      });
    });

    // Grand total row
    ctRows.push([
      'TOTAL', '', '', '', '', '',
      String(summary.totalCountertopSqft),
    ]);

    autoTable(doc, {
      startY: y,
      head: [['Unit #', 'Label', 'Length', 'Depth', 'Tag', '+3% Waste', 'Sqft']],
      body: ctRows,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 4, textColor: TEXT_DARK, lineColor: [220, 228, 240], lineWidth: 0.5 },
      headStyles: { fillColor: BLUE_MID, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5 },
      alternateRowStyles: { fillColor: GRAY_LIGHT },
      didParseCell: (data) => {
        if (data.row.index === ctRows.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = BLUE_LIGHT;
          data.cell.styles.textColor = BLUE_DARK;
        }
      },
      columnStyles: { 6: { fontStyle: 'bold', halign: 'right' } },
    });

    y = (doc as any).lastAutoTable.finalY + 14;
  } else {
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MID);
    doc.text('No countertop sections recorded.', margin + 10, y + 10);
    y += 24;
  }

  // ─── NOTES ───
  if (project.notes) {
    if (y > pageH - 120) { doc.addPage(); y = 40; }
    y = sectionHeader('PROJECT NOTES', y);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_DARK);
    const lines = doc.splitTextToSize(project.notes, contentW - 20);
    doc.text(lines, margin + 10, y + 10);
    y += lines.length * 11 + 16;
  }

  // ─── FOOTER on all pages ───
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFillColor(...BLUE_DARK);
    doc.rect(0, pageH - 28, pageW, 28, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY_MID);
    doc.text('CabinetTakeoff Pro  |  Professional Estimating Tool', margin, pageH - 12);
    doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 12, { align: 'right' });
    doc.text(project.name, pageW / 2, pageH - 12, { align: 'center' });
  }

  // Save
  const filename = `${project.name.replace(/[^a-zA-Z0-9]/g, '-')}-takeoff-report.pdf`;
  doc.save(filename);
}
