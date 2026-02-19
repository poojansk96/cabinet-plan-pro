import * as pdfjsLib from 'pdfjs-dist';

// Use the local worker from pdfjs-dist
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface DetectedUnit {
  unitNumber: string;
  detectedType: string | null;   // type name read from the PDF (may be null)
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

// ---------------------------------------------------------------------------
// Unit-number patterns
// ---------------------------------------------------------------------------
const UNIT_NUMBER_PATTERNS = [
  { re: /\bunit[s]?\s*#?\s*([A-Z0-9]{1,6}(?:-[A-Z0-9]{1,4})?)\b/gi, confidence: 'high' as const },
  { re: /\bapt\.?\s*#?\s*([A-Z0-9]{1,6}(?:-[A-Z0-9]{1,4})?)\b/gi,   confidence: 'high' as const },
  { re: /\bapartment\s*#?\s*([A-Z0-9]{1,6}(?:-[A-Z0-9]{1,4})?)\b/gi, confidence: 'high' as const },
  { re: /\bsuite[s]?\s*#?\s*([A-Z0-9]{1,6}(?:-[A-Z0-9]{1,4})?)\b/gi, confidence: 'high' as const },
  { re: /#\s*([0-9]{2,6}[A-Z]?)\b/g,                                   confidence: 'medium' as const },
  { re: /\bno\.?\s*([0-9]{2,6}[A-Z]?)\b/gi,                            confidence: 'medium' as const },
  { re: /\b([1-9A-Z]-[0-9]{2,3})\b/g,                                  confidence: 'medium' as const },
  { re: /\b([1-9][0-9]{2,3}[A-Z]?)\b/g,                                confidence: 'low' as const },
];

// ---------------------------------------------------------------------------
// Unit type detection
// Architectural plans typically label units like:
//   "2 BED", "2BR", "1 BEDROOM", "STUDIO", "3BHK", "PENTHOUSE", "TOWNHOUSE"
// We look for these in a ±120-char window around each unit-number match.
// ---------------------------------------------------------------------------

interface TypePattern {
  re: RegExp;
  label: string;
}

const UNIT_TYPE_PATTERNS: TypePattern[] = [
  // BHK style  → "3BHK", "2 BHK", "4 B.H.K"
  { re: /\b([1-6])\s*b\.?h\.?k\.?\b/gi,                   label: '$1BHK' },
  // Bedroom count  → "2 BEDROOM", "2 BED", "2BR", "2 BD"
  { re: /\b([1-6])\s*(?:bed(?:room)?s?|br|bd)\b/gi,        label: '$1BR' },
  // Studio / Efficiency
  { re: /\b(studio|efficiency|eff\.?)\b/gi,                 label: 'Studio' },
  // Penthouse
  { re: /\b(penthouse|ph)\b/gi,                             label: 'Penthouse' },
  // Townhouse / Townhome
  { re: /\b(townhouse|townhome|town\s*house)\b/gi,          label: 'Townhouse' },
  // Condo / Condominium
  { re: /\b(condo(?:minium)?)\b/gi,                         label: 'Condo' },
  // Loft
  { re: /\b(loft)\b/gi,                                     label: 'Loft' },
  // Duplex / Triplex
  { re: /\b(duplex|triplex)\b/gi,                           label: '$1' },
  // "4 BED" / "4 BR"  (already caught by second pattern but belt-and-suspenders)
  { re: /\b([1-6])\s*(?:room|rms?)\b/gi,                   label: '$1BR' },
  // Generic "Type X" / "Plan X" / "Unit Type X"  →  any letter/number suffix
  { re: /\bunit\s*type\s+([A-Z0-9][\w\-]*)\b/gi,           label: 'Type $1' },
  { re: /\btype\s*[:\-]?\s*([A-Z0-9][\w\-]*)\b/gi,         label: 'Type $1' },
  { re: /\bplan\s*[:\-]?\s*([A-Z0-9][\w\-]*)\b/gi,         label: 'Plan $1' },
  { re: /\bfloor\s*plan\s*[:\-]?\s*([A-Z0-9][\w\-]*)\b/gi, label: 'Plan $1' },
  // Layout labels  → "Layout A", "Model B2"
  { re: /\blayout\s*[:\-]?\s*([A-Z0-9][\w\-]*)\b/gi,       label: 'Layout $1' },
  { re: /\bmodel\s*[:\-]?\s*([A-Z0-9][\w\-]*)\b/gi,        label: 'Model $1' },
];

/** Try to detect a unit type from a text snippet surrounding the match */
function detectTypeFromContext(contextText: string): string | null {
  for (const { re, label } of UNIT_TYPE_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(contextText);
    if (m) {
      // Resolve capture-group references in label (e.g. '$1BR')
      const resolved = label.replace(/\$(\d+)/g, (_, n) => (m[parseInt(n)] ?? '').toUpperCase());
      return resolved;
    }
  }

  // Broad fallback: grab any standalone ALL-CAPS word or short ALL-CAPS phrase
  // that looks like a type label (2–20 chars, possibly hyphenated, not a noise word)
  const NOISE = /^(UNIT|APT|NO|NUM|FIG|DWG|REV|DATE|SCALE|THE|AND|FOR|WITH|FROM)$/;
  const capsRe = /\b([A-Z][A-Z0-9\-]{1,19})\b/g;
  let cm: RegExpExecArray | null;
  while ((cm = capsRe.exec(contextText)) !== null) {
    const word = cm[1];
    if (!NOISE.test(word) && !/^\d+$/.test(word)) {
      return word;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// PDF text extraction helpers
// ---------------------------------------------------------------------------

interface TextItem {
  str: string;
  /** X position on the page (from PDF viewport) */
  x: number;
  /** Y position on the page */
  y: number;
}

async function extractPageTextItems(page: pdfjsLib.PDFPageProxy): Promise<TextItem[]> {
  const content = await page.getTextContent();
  return content.items
    .filter((item): item is any => 'str' in item)
    .map((item: any) => ({
      str: item.str as string,
      x: (item.transform as number[])[4],
      y: (item.transform as number[])[5],
    }));
}

/**
 * Given a list of positioned text items and a target position,
 * find all text items within `radius` units and return them joined.
 */
function getNearbyText(items: TextItem[], targetX: number, targetY: number, radius = 200): string {
  return items
    .filter(it => Math.abs(it.x - targetX) < radius && Math.abs(it.y - targetY) < radius)
    .map(it => it.str)
    .join(' ');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function extractUnitsFromPDF(file: File): Promise<PDFExtractionResult> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;

  const allText: string[] = [];
  const pageData: Array<{ text: string; items: TextItem[]; page: number }> = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const items = await extractPageTextItems(page);
    const text = items.map(i => i.str).join(' ');
    allText.push(text);
    pageData.push({ text, items, page: pageNum });
  }

  const rawText = allText.join('\n');

  // --- Collect matches with deduplication ---
  const seen = new Map<string, DetectedUnit>();

  for (const { text, items, page } of pageData) {
    for (const { re, confidence } of UNIT_NUMBER_PATTERNS) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = re.exec(text)) !== null) {
        const unitNumber = match[1].trim().toUpperCase();

        // Skip false positives
        if (
          unitNumber.length < 1 ||
          unitNumber === '000' ||
          /^(SCALE|DATE|REV|NO|NUM|FIG|DWG)$/i.test(unitNumber) ||
          (parseInt(unitNumber) > 9999 && /^\d+$/.test(unitNumber))
        ) continue;

        // ---- Detect type from positional context ----
        // Find the approximate position of this match in the items array
        let detectedType: string | null = null;

        // Strategy 1: look for type keywords in ±120 chars of plain text
        const startIdx = Math.max(0, match.index - 120);
        const endIdx   = Math.min(text.length, match.index + match[0].length + 120);
        const contextText = text.slice(startIdx, endIdx);
        detectedType = detectTypeFromContext(contextText);

        // Strategy 2 (fallback): use spatial proximity on the PDF page
        if (!detectedType) {
          // Find which text item contains this match by accumulating char counts
          let charCount = 0;
          let matchItem: TextItem | null = null;
          for (const item of items) {
            if (charCount + item.str.length + 1 >= match.index) {
              matchItem = item;
              break;
            }
            charCount += item.str.length + 1; // +1 for the space joiner
          }
          if (matchItem) {
            const nearby = getNearbyText(items, matchItem.x, matchItem.y, 250);
            detectedType = detectTypeFromContext(nearby);
          }
        }

        const key = unitNumber;
        const existing = seen.get(key);

        if (!existing || confidenceRank(confidence) > confidenceRank(existing.confidence)) {
          seen.set(key, {
            unitNumber,
            detectedType,
            rawMatch: match[0].trim(),
            page,
            confidence,
          });
        } else if (existing && !existing.detectedType && detectedType) {
          // Keep better type info even if confidence is same
          seen.set(key, { ...existing, detectedType });
        }
      }
    }
  }

  const detectedUnits = Array.from(seen.values()).sort((a, b) => {
    const cd = confidenceRank(b.confidence) - confidenceRank(a.confidence);
    if (cd !== 0) return cd;
    return a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true });
  });

  return { detectedUnits, totalPages, rawText, fileName: file.name };
}

function confidenceRank(c: DetectedUnit['confidence']) {
  return c === 'high' ? 3 : c === 'medium' ? 2 : 1;
}
