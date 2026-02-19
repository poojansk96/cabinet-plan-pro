import * as pdfjsLib from 'pdfjs-dist';

// Use the local worker from pdfjs-dist
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface DetectedUnit {
  unitNumber: string;
  detectedType: string | null;   // type name read from the PDF (may be null)
  detectedFloor: string | null;  // floor/level read from the page (may be null)
  detectedBldg: string | null;   // building number read from the page (may be null)
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
// Building detection — scanned from the full page (title block anywhere)
// ---------------------------------------------------------------------------

/** Maps written-out number words (cardinal + ordinal) to digits */
const WORD_TO_NUM: Record<string, string> = {
  one: '1', first: '1',
  two: '2', second: '2',
  three: '3', third: '3',
  four: '4', fourth: '4',
  five: '5', fifth: '5',
  six: '6', sixth: '6',
  seven: '7', seventh: '7',
  eight: '8', eighth: '8',
  nine: '9', ninth: '9',
  ten: '10', tenth: '10',
  eleven: '11', eleventh: '11',
  twelve: '12', twelfth: '12',
};

/** Convert ordinal/cardinal words and ordinal suffixes to plain digits */
function normaliseNumber(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (WORD_TO_NUM[lower]) return WORD_TO_NUM[lower];
  // "1st", "2nd", "3rd", "4th" → "1", "2", "3", "4"
  return raw.replace(/^(\d+)(?:st|nd|rd|th)$/i, '$1').toUpperCase();
}

// Directional building names: East, West, North, South, North-East, etc.
const DIRECTIONS = ['north[\\-\\s]?east', 'north[\\-\\s]?west', 'south[\\-\\s]?east', 'south[\\-\\s]?west', 'north', 'south', 'east', 'west', 'central', 'centre', 'center'];
const BLDG_DIR_PATTERN = new RegExp(
  `\\b(?:building|bldg\\.?|block|tower|wing|phase)\\s*[:\\-]?\\s*(${DIRECTIONS.join('|')})\\b`,
  'gi'
);

// Also extend patterns to match written-out words after the keyword
const BLDG_WORD_PATTERN =
  /\b(?:building|bldg\.?)\s*[:\-]?\s*(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\b/gi;

const BLDG_PATTERNS = [
  // "Building 1", "Bldg 2", "Bldg. A", "BLDG-3"
  /\b(?:building|bldg\.?)\s*[:\-]?\s*([A-Z0-9][\w\-]*)\b/gi,
  // "Block A", "Block 1"
  /\bblock\s*[:\-]?\s*([A-Z0-9][\w\-]*)\b/gi,
  // "Tower A", "Tower 2"
  /\btower\s*[:\-]?\s*([A-Z0-9][\w\-]*)\b/gi,
  // "Wing A", "Wing B1"
  /\bwing\s*[:\-]?\s*([A-Z0-9][\w\-]*)\b/gi,
  // "Phase 1", "Phase 2A"
  /\bphase\s*[:\-]?\s*([A-Z0-9][\w\-]*)\b/gi,
];

/** Detect building number/name from a page — scans bottom strip first, then full page */
/** Strip floor/level references from text before building detection to avoid cross-contamination */
function stripFloorText(text: string): string {
  return text
    .replace(/\b(?:level|lvl\.?)\s*[:\-]?\s*[A-Z0-9][\w\-]*/gi, '')
    .replace(/\b(?:floor|flr\.?)\s*[:\-]?\s*[A-Z0-9][\w\-]*/gi, '')
    .replace(/\bstore?y\s*[:\-]?\s*[A-Z0-9][\w\-]*/gi, '')
    .replace(/\b[1-9]\d*(?:st|nd|rd|th)\s+(?:floor|level|storey)\b/gi, '');
}

function detectBldgFromPage(items: TextItem[]): string | null {
  if (items.length === 0) return null;

  const ys = items.map(i => i.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const threshold = minY + (maxY - minY) * 0.25;

  // Strip floor/level text before building detection
  const bottomText = stripFloorText(items.filter(i => i.y <= threshold).map(i => i.str).join(' '));
  const fullText   = stripFloorText(items.map(i => i.str).join(' '));

  // 1. Directional names first: "Building East", "Tower North-West"
  for (const text of [bottomText, fullText]) {
    BLDG_DIR_PATTERN.lastIndex = 0;
    const m = BLDG_DIR_PATTERN.exec(text);
    if (m) {
      const keyword = m[0].match(/building|bldg|block|tower|wing|phase/i)?.[0] ?? 'Building';
      const label = keyword.charAt(0).toUpperCase() + keyword.slice(1).toLowerCase();
      const dir = m[1].trim();
      // Title-case the direction (handles "north-east" → "North-East")
      const dirFormatted = dir.replace(/\b\w/g, c => c.toUpperCase());
      return `${label} ${dirFormatted}`;
    }
  }

  // 2. Written-out number words: "Building First" → "Building 1"
  for (const text of [bottomText, fullText]) {
    BLDG_WORD_PATTERN.lastIndex = 0;
    const m = BLDG_WORD_PATTERN.exec(text);
    if (m) return `Building ${normaliseNumber(m[1])}`;
  }

  // 3. Alphanumeric patterns: "Building 1", "Tower A", "Block B2"
  for (const re of BLDG_PATTERNS) {
    re.lastIndex = 0;
    let m = re.exec(bottomText);
    if (!m) { re.lastIndex = 0; m = re.exec(fullText); }
    if (m) {
      const raw = (m[1] ?? m[0]).trim();
      if (raw.length === 0) continue;
      const keyword = re.source.match(/building|bldg|block|tower|wing|phase/i)?.[0] ?? 'Building';
      const label = keyword.charAt(0).toUpperCase() + keyword.slice(1).toLowerCase();
      return `${label} ${normaliseNumber(raw)}`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Floor / Level detection — scanned from the bottom third of each page
// ---------------------------------------------------------------------------

// Also extend floor patterns to match written-out words after "level"
const FLOOR_WORD_PATTERN =
  /\b(?:level|lvl\.?|floor|flr\.?|storey|story)\s*[:\-]?\s*(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\b/gi;

const FLOOR_PATTERNS = [
  // "Floor 1", "Floor 2" — but NOT "Floor Plan" or "Floor Area"
  /\b(?:floor|flr\.?)\s*[:\-]?\s*([0-9]+[A-Z]?|[A-Z](?![A-Z]{2,}))\b(?!\s*(?:plan|area|area|layout|drawing|schedule))/gi,
  // "1st Floor", "2nd Floor"
  /\b([1-9]\d*(?:st|nd|rd|th))\s+floor\b/gi,
  // "Ground Floor", "Basement Floor", etc.
  /\b(ground|basement|mezzanine|terrace|roof(?:\s*top)?)\s+floor\b/gi,
  /\b(ground|basement|mezzanine)\b/gi,
  // "Level 1", "Level A" — Level always means floor, never building
  /\b(?:level|lvl\.?)\s*[:\-]?\s*([A-Z0-9][\w\-]*)\b/gi,
  // "Storey 3", "Story 2"
  /\bstore?y\s*[:\-]?\s*([0-9]+[A-Z]?)\b/gi,
];

/** Scan the bottom portion of the page text items for a floor/level label */
function detectFloorFromPage(items: TextItem[]): string | null {
  if (items.length === 0) return null;

  const ys = items.map(i => i.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const threshold = minY + (maxY - minY) * 0.25;

  const bottomText = items.filter(i => i.y <= threshold).map(i => i.str).join(' ');
  const fullText   = items.map(i => i.str).join(' ');

  // Try written-out word patterns first ("Level First" → "Floor 1")
  for (const text of [bottomText, fullText]) {
    FLOOR_WORD_PATTERN.lastIndex = 0;
    const m = FLOOR_WORD_PATTERN.exec(text);
    if (m) return `Floor ${normaliseNumber(m[1])}`;
  }

  for (const re of FLOOR_PATTERNS) {
    re.lastIndex = 0;
    let m = re.exec(bottomText);
    if (!m) { re.lastIndex = 0; m = re.exec(fullText); }
    if (m) {
      const raw = (m[1] ?? m[0]).trim();
      if (raw.length === 0) continue;
      const norm = normaliseNumber(raw);
      return `Floor ${norm}`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function extractUnitsFromPDF(file: File): Promise<PDFExtractionResult> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;

  const allText: string[] = [];
  const pageData: Array<{ text: string; items: TextItem[]; page: number; detectedFloor: string | null; detectedBldg: string | null }> = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const items = await extractPageTextItems(page);
    const text = items.map(i => i.str).join(' ');
    const detectedFloor = detectFloorFromPage(items);
    const detectedBldg  = detectBldgFromPage(items);
    allText.push(text);
    pageData.push({ text, items, page: pageNum, detectedFloor, detectedBldg });
  }

  const rawText = allText.join('\n');

  // --- Collect matches with deduplication ---
  const seen = new Map<string, DetectedUnit>();

  for (const { text, items, page, detectedFloor, detectedBldg } of pageData) {
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
        let detectedType: string | null = null;

        // Strategy 1: look for type keywords in ±120 chars of plain text
        const startIdx = Math.max(0, match.index - 120);
        const endIdx   = Math.min(text.length, match.index + match[0].length + 120);
        const contextText = text.slice(startIdx, endIdx);
        detectedType = detectTypeFromContext(contextText);

        // Strategy 2 (fallback): use spatial proximity on the PDF page
        if (!detectedType) {
          let charCount = 0;
          let matchItem: TextItem | null = null;
          for (const item of items) {
            if (charCount + item.str.length + 1 >= match.index) {
              matchItem = item;
              break;
            }
            charCount += item.str.length + 1;
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
            detectedFloor,
            detectedBldg,
            rawMatch: match[0].trim(),
            page,
            confidence,
          });
        } else if (existing) {
          const updates: Partial<DetectedUnit> = {};
          if (!existing.detectedType  && detectedType)  updates.detectedType  = detectedType;
          if (!existing.detectedFloor && detectedFloor) updates.detectedFloor = detectedFloor;
          if (!existing.detectedBldg  && detectedBldg)  updates.detectedBldg  = detectedBldg;
          if (Object.keys(updates).length) seen.set(key, { ...existing, ...updates });
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
