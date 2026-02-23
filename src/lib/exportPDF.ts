import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Project, Unit } from '@/types/project';
import { calcProjectSummary, calcUnitCountertopTotal, calcCountertopSqft } from '@/lib/calculations';

// Brand colors
const BLUE_DARK = [22, 60, 110] as [number, number, number];
const BLUE_MID = [41, 98, 168] as [number, number, number];
const BLUE_LIGHT = [224, 234, 248] as [number, number, number];
const GRAY_LIGHT = [245, 247, 250] as [number, number, number];
const GRAY_MID = [180, 188, 200] as [number, number, number];
const WHITE = [255, 255, 255] as [number, number, number];
const TEXT_DARK = [20, 30, 48] as [number, number, number];
const TEXT_MID = [80, 95, 115] as [number, number, number];

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
  const cardW = (contentW - 8) / 3;
  const stats = [
    { label: 'Total Units', value: String(summary.totalUnits) },
    { label: 'Unit Types', value: String(Object.keys(summary.unitsByType).length) },
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

  // ─── COUNTERTOP SUMMARY — BY UNIT TYPE ───
  // Group units by type
  const typeMap = new Map<string, Unit[]>();
  project.units.forEach(u => {
    const arr = typeMap.get(u.type) || [];
    arr.push(u);
    typeMap.set(u.type, arr);
  });

  const hasCountertops = project.units.some(u => u.countertops.length > 0);

  if (hasCountertops) {
    y = sectionHeader('COUNTERTOP SUMMARY — BY UNIT TYPE', y);

    const ctRows: string[][] = [];
    let grandTotal = 0;

    typeMap.forEach((units, type) => {
      const representative = units[0];
      const unitCount = units.length;
      if (representative.countertops.length === 0) return;

      // Type header row
      const typeSqft = calcUnitCountertopTotal(representative);
      const typeTotalSqft = typeSqft * unitCount;
      grandTotal += typeTotalSqft;

      representative.countertops.forEach(ct => {
        const sqft = calcCountertopSqft(ct);
        ctRows.push([
          `${type} (x${unitCount})`,
          ct.label,
          `${ct.length}"`,
          `${ct.depth}"`,
          `${ct.splashHeight ?? 0}"`,
          String(ct.sideSplash ?? 0),
          ct.isIsland ? 'Island' : 'Perimeter',
          ct.addWaste ? 'Yes' : 'No',
          String(sqft),
        ]);
      });

      // Per-type subtotal
      ctRows.push([
        '', '', '', '', '', '', '', `Subtotal (×${unitCount})`,
        String(typeTotalSqft),
      ]);
    });

    // Grand total row
    ctRows.push([
      'GRAND TOTAL', '', '', '', '', '', '', '',
      String(summary.totalCountertopSqft),
    ]);

    autoTable(doc, {
      startY: y,
      head: [['Unit Type (Qty)', 'Label', 'Length', 'Depth', 'Backsplash Ht', 'Sidesplash Qty', 'Tag', '+5% Waste', 'Sqft']],
      body: ctRows,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7.5, cellPadding: 3.5, textColor: TEXT_DARK, lineColor: [220, 228, 240], lineWidth: 0.5 },
      headStyles: { fillColor: BLUE_MID, textColor: WHITE, fontStyle: 'bold', fontSize: 7 },
      alternateRowStyles: { fillColor: GRAY_LIGHT },
      didParseCell: (data) => {
        const rowIdx = data.row.index;
        const rowData = ctRows[rowIdx];
        // Subtotal rows
        if (rowData && rowData[7]?.startsWith('Subtotal')) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = BLUE_LIGHT;
          data.cell.styles.textColor = BLUE_DARK;
        }
        // Grand total row
        if (rowIdx === ctRows.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = BLUE_DARK;
          data.cell.styles.textColor = WHITE;
        }
      },
      columnStyles: { 8: { fontStyle: 'bold', halign: 'right' } },
    });

    y = (doc as any).lastAutoTable.finalY + 14;
  } else {
    y = sectionHeader('COUNTERTOP SUMMARY', y);
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
