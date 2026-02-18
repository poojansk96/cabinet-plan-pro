import * as pdfjsLib from 'pdfjs-dist';

// Use the local worker from pdfjs-dist
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface DetectedUnit {
  unitNumber: string;
  rawMatch: string;
  page: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface PDFExtractionResult {
  detectedUnits: DetectedUnit[];
  totalPages: number;
  rawText: string;
  fileName: string;
}

// Regex patterns to detect unit numbers in architectural drawings
const UNIT_PATTERNS = [
  // "Unit 101", "UNIT 2A", "Unit A1"
  { re: /\bunit[s]?\s*#?\s*([A-Z0-9]{1,6}(?:-[A-Z0-9]{1,4})?)\b/gi, confidence: 'high' as const },
  // "APT 101", "APARTMENT 2B"
  { re: /\bapt\.?\s*#?\s*([A-Z0-9]{1,6}(?:-[A-Z0-9]{1,4})?)\b/gi, confidence: 'high' as const },
  // "Suite 101", "STE 2A"
  { re: /\bsuite[s]?\s*#?\s*([A-Z0-9]{1,6}(?:-[A-Z0-9]{1,4})?)\b/gi, confidence: 'high' as const },
  // "#101", "# 205"
  { re: /#\s*([0-9]{2,6}[A-Z]?)\b/g, confidence: 'medium' as const },
  // "No. 101", "NO 205"
  { re: /\bno\.?\s*([0-9]{2,6}[A-Z]?)\b/gi, confidence: 'medium' as const },
  // Standalone 3-digit numbers that look like unit numbers (101-999)
  { re: /\b([1-9][0-9]{2})\b/g, confidence: 'low' as const },
  // Floor-unit combos: "1-01", "2-05", "B-12"
  { re: /\b([1-9A-Z]-[0-9]{2})\b/g, confidence: 'medium' as const },
];

export async function extractUnitsFromPDF(file: File): Promise<PDFExtractionResult> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;

  const allText: string[] = [];
  const pageTexts: Array<{ text: string; page: number }> = [];

  // Extract text from all pages
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const text = content.items
      .filter((item): item is any => 'str' in item)
      .map((item: any) => item.str)
      .join(' ');
    allText.push(text);
    pageTexts.push({ text, page: pageNum });
  }

  const rawText = allText.join('\n');

  // Collect all matches with deduplication
  const seen = new Map<string, DetectedUnit>();

  for (const { text, page } of pageTexts) {
    for (const { re, confidence } of UNIT_PATTERNS) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        const unitNumber = match[1].trim().toUpperCase();

        // Skip obvious false positives
        if (
          unitNumber.length < 1 ||
          unitNumber === '000' ||
          parseInt(unitNumber) > 9999 ||
          // Skip common drawing numbers / scales
          /^(1\/|1:|\\d+\"|SCALE|DATE|REV)/i.test(unitNumber)
        ) continue;

        const key = unitNumber;
        const existing = seen.get(key);

        // Keep the highest confidence match, prefer earlier pages
        if (!existing || confidenceRank(confidence) > confidenceRank(existing.confidence)) {
          seen.set(key, {
            unitNumber,
            rawMatch: match[0].trim(),
            page,
            confidence,
          });
        }
      }
    }
  }

  // Sort: high confidence first, then by unit number
  const detectedUnits = Array.from(seen.values()).sort((a, b) => {
    const cd = confidenceRank(b.confidence) - confidenceRank(a.confidence);
    if (cd !== 0) return cd;
    return a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true });
  });

  return {
    detectedUnits,
    totalPages,
    rawText,
    fileName: file.name,
  };
}

function confidenceRank(c: DetectedUnit['confidence']) {
  return c === 'high' ? 3 : c === 'medium' ? 2 : 1;
}
