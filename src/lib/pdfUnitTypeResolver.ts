const COMMON_AREA_LABELS: Array<{ label: string; re: RegExp }> = [
  { label: 'Kitchenette', re: /\bKITCHENETTE\b/i },
  { label: 'Mail Room', re: /\bMAIL\s*ROOM\b/i },
  { label: 'Break Room', re: /\bBREAK\s*ROOM\b/i },
  { label: 'Business Center', re: /\bBUSINESS\s*CENTER\b/i },
  { label: 'Community Room', re: /\bCOMMUNITY\s*ROOM\b/i },
  { label: 'Pool Bath', re: /\bPOOL\s*BATH\b/i },
  { label: 'Leasing', re: /\bLEASING\b/i },
  { label: 'Clubhouse', re: /\bCLUBHOUSE\b/i },
  { label: 'Fitness', re: /\bFITNESS\b/i },
  { label: 'Laundry', re: /\bLAUNDRY\b/i },
  { label: 'Restroom', re: /\bRESTROOM\b/i },
  { label: 'Lobby', re: /\bLOBBY\b/i },
  { label: 'Office', re: /\bOFFICE\b/i },
  { label: 'Reception', re: /\bRECEPTION\b/i },
  { label: 'Storage', re: /\bSTORAGE\b/i },
  { label: 'Garage', re: /\bGARAGE\b/i },
  { label: 'Corridor', re: /\bCORRIDOR\b/i },
  { label: 'Mechanical', re: /\bMECHANICAL\b/i },
  { label: 'Maintenance', re: /\bMAINTENANCE\b/i },
  { label: 'Trash', re: /\bTRASH\b/i },
];

function normalizeSpacing(value: string): string {
  return String(value || '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)\s*/g, ')')
    .trim();
}

function detectCommonAreaLabel(value: string): string | null {
  for (const entry of COMMON_AREA_LABELS) {
    if (entry.re.test(value)) return entry.label;
  }
  return null;
}

function hasStrongTypeStructure(value: string): boolean {
  const text = normalizeSpacing(value).toUpperCase();
  if (!text) return false;
  return /\bTYPE\b/.test(text)
    || /\b(?:STUDIO|\d+BR)\b/.test(text)
    || /(?:^|[-\s])(?:AS|MIRROR|ADA|REV|ALT|OPTION)\b/.test(text)
    || Boolean(detectCommonAreaLabel(text));
}

function canonicalTypeBase(value: string): string {
  const text = normalizeResolvedUnitType(value).toUpperCase();
  if (!text) return '';
  const commonArea = detectCommonAreaLabel(text);
  if (commonArea) return commonArea.toUpperCase().replace(/\s+/g, '');

  return text
    .replace(/\s+\((AS|MIRROR|ADA|REV|ALT|OPTION)\)$/g, '')
    .replace(/-(AS|MIRROR|ADA|REV|ALT|OPTION)\b/g, '')
    .replace(/^TYPE\s+/, '')
    .replace(/\s+/g, '')
    .trim();
}

function typeSpecificityScore(value: string): number {
  const text = normalizeResolvedUnitType(value).toUpperCase();
  if (!text) return 0;

  let score = text.replace(/\s+/g, '').length;
  if (/\bTYPE\b/.test(text)) score += 25;
  if (/\b(?:STUDIO|\d+BR)\b/.test(text)) score += 20;
  if (/(?:^|[-\s])(?:AS|MIRROR|ADA|REV|ALT|OPTION)\b/.test(text)) score += 30;
  if (/\(|\)|\./.test(text)) score += 10;
  if (detectCommonAreaLabel(text)) score += 30;
  return score;
}

export function normalizeResolvedUnitType(value: string): string {
  const clean = normalizeSpacing(value);
  if (!clean) return '';
  if (/^(?:PLAN|ELEVATION|SECTION|DETAIL|SHEET|DRAWING|LEGEND)\b/i.test(clean)) return '';
  const commonArea = detectCommonAreaLabel(clean);
  if (commonArea) return commonArea;
  return clean.toUpperCase();
}

export function isSuspiciousUnitTypeCandidate(value: string, unitNumber = ''): boolean {
  const text = normalizeResolvedUnitType(value);
  const normalizedUnit = normalizeSpacing(unitNumber).toUpperCase();

  if (!text) return true;
  if (normalizedUnit && text.toUpperCase() === normalizedUnit) return true;
  if (hasStrongTypeStructure(text)) return false;
  if (/^(?:BLDG|BUILDING|FLOOR|LEVEL|UNIT)\b/i.test(text)) return true;

  const compact = text.toUpperCase().replace(/\s+/g, '');
  return /^[A-Z]?\d{1,4}[A-Z]?(?:-\d{1,4}[A-Z]?)?$/.test(compact);
}

export function extractPreferredUnitTypeFromPageText(pageText: string): string | null {
  const text = normalizeSpacing(pageText).replace(/[|]+/g, ' ');
  if (!text) return null;

  const typePatterns = [
    /\b(?:STUDIO|\d+\s*BR)\s+TYPE\s+[A-Z0-9][A-Z0-9._]*(?:\s*-\s*[A-Z0-9._]+)*(?:\s+\([A-Z0-9 ._-]+\))?/i,
    /\bTYPE\s+[A-Z0-9][A-Z0-9._]*(?:\s*-\s*[A-Z0-9._]+)*(?:\s+\([A-Z0-9 ._-]+\))?/i,
  ];

  for (const pattern of typePatterns) {
    const match = text.match(pattern)?.[0];
    if (!match) continue;
    const resolved = normalizeResolvedUnitType(match);
    if (resolved && !isSuspiciousUnitTypeCandidate(resolved)) return resolved;
  }

  return detectCommonAreaLabel(text);
}

export function resolvePreferredUnitType(detectedType: string, pageText: string, unitNumber = ''): string {
  const resolvedDetected = normalizeResolvedUnitType(detectedType);
  const resolvedFromText = extractPreferredUnitTypeFromPageText(pageText) || '';

  if (!resolvedDetected) return resolvedFromText;
  if (!resolvedFromText) return resolvedDetected;
  if (isSuspiciousUnitTypeCandidate(resolvedDetected, unitNumber)) return resolvedFromText;

  const detectedBase = canonicalTypeBase(resolvedDetected);
  const textBase = canonicalTypeBase(resolvedFromText);
  if (detectedBase && textBase && detectedBase === textBase && typeSpecificityScore(resolvedFromText) > typeSpecificityScore(resolvedDetected)) {
    return resolvedFromText;
  }

  return resolvedDetected;
}

export async function extractPageTextForTypeDetection(page: any): Promise<string> {
  try {
    const textContent = await page.getTextContent();
    const items = Array.isArray(textContent?.items) ? textContent.items : [];

    const positioned = items
      .map((item: any) => ({
        str: String(item?.str || '').trim(),
        x: Number(item?.transform?.[4] ?? 0),
        y: Number(item?.transform?.[5] ?? 0),
      }))
      .filter((item) => item.str);

    if (!positioned.length) return '';

    positioned.sort((left, right) => {
      if (Math.abs(right.y - left.y) > 2.5) return right.y - left.y;
      return left.x - right.x;
    });

    const lines: string[] = [];
    let currentY: number | null = null;
    let currentParts: string[] = [];

    for (const item of positioned) {
      if (currentY === null || Math.abs(item.y - currentY) <= 2.5) {
        currentParts.push(item.str);
        currentY = currentY ?? item.y;
        continue;
      }

      if (currentParts.length) lines.push(normalizeSpacing(currentParts.join(' ')));
      currentParts = [item.str];
      currentY = item.y;
    }

    if (currentParts.length) lines.push(normalizeSpacing(currentParts.join(' ')));
    return lines.join('\n').trim();
  } catch {
    return '';
  }
}