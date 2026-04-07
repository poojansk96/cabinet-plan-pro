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

const TYPE_PATTERNS = [
  /\bUNIT\s+TYPE\s*[:\-]?\s*[A-Z0-9][A-Z0-9._]*(?:\s*-\s*[A-Z0-9._]+)*(?:\s+\([A-Z0-9 ._-]+\))?/gi,
  /\b(?:STUDIO|\d+\s*BR)\s+TYPE\s+[A-Z0-9][A-Z0-9._]*(?:\s*-\s*[A-Z0-9._]+)*(?:\s+\([A-Z0-9 ._-]+\))?/gi,
  /\bTYPE\s+[A-Z0-9][A-Z0-9._]*(?:\s*-\s*[A-Z0-9._]+)*(?:\s+\([A-Z0-9 ._-]+\))?/gi,
];

type UnitTypeCandidate = {
  value: string;
  score: number;
  source: string;
  lineIndex: number;
};

function normalizeSpacing(value: string): string {
  return String(value || '')
    .replace(/[‐-―]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)\s*/g, ')')
    .trim();
}

function normalizePageTextLines(value: string): string[] {
  return String(value || '')
    .replace(/[|]+/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => normalizeSpacing(line))
    .filter(Boolean);
}

function stripLeadingTypeDecorators(value: string): string {
  const clean = normalizeSpacing(value);
  if (!clean) return '';

  const hadExplicitTypePrefix = /^(?:UNIT|PLAN)\s+TYPE/i.test(clean);
  const stripped = clean
    .replace(/^(?:UNIT|PLAN)\s+TYPE\s*[:\-]?\s*/i, '')
    .trim();

  if (!stripped) return '';
  if (hadExplicitTypePrefix && !/TYPE/i.test(stripped) && !/(?:STUDIO|\d+BR)/i.test(stripped) && !detectCommonAreaLabel(stripped)) {
    return `TYPE ${stripped}`;
  }

  return stripped;
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
  return /TYPE/.test(text)
    || /(?:STUDIO|\d+BR)/.test(text)
    || /(?:^|[-\s])(?:AS|MIRROR|ADA|REV|ALT|OPTION)/.test(text)
    || Boolean(detectCommonAreaLabel(text));
}

function canonicalTypeBase(value: string): string {
  const text = normalizeResolvedUnitType(value).toUpperCase();
  if (!text) return '';
  const commonArea = detectCommonAreaLabel(text);
  if (commonArea) return commonArea.toUpperCase().replace(/\s+/g, '');

  return text
    .replace(/\s+\((AS|MIRROR|ADA|REV|ALT|OPTION)\)$/g, '')
    .replace(/-(AS|MIRROR|ADA|REV|ALT|OPTION)/g, '')
    .replace(/^TYPE\s+/, '')
    .replace(/\s+/g, '')
    .trim();
}

function normalizeComparableCharacters(value: string): string {
  const chars = Array.from(String(value || '').toUpperCase());

  return chars.map((char, index) => {
    const prev = chars[index - 1] || '';
    const next = chars[index + 1] || '';
    const nearDigit = /\d/.test(prev) || /\d/.test(next);

    if (nearDigit && /[OQD]/.test(char)) return '0';
    if (nearDigit && /[IL]/.test(char)) return '1';
    return char;
  }).join('');
}

function comparableTypeBase(value: string): string {
  return normalizeComparableCharacters(canonicalTypeBase(value));
}

function typeSpecificityScore(value: string): number {
  const text = normalizeResolvedUnitType(value).toUpperCase();
  if (!text) return 0;

  let score = text.replace(/\s+/g, '').length;
  if (/TYPE/.test(text)) score += 25;
  if (/(?:STUDIO|\d+BR)/.test(text)) score += 20;
  if (/(?:^|[-\s])(?:AS|MIRROR|ADA|REV|ALT|OPTION)/.test(text)) score += 30;
  if (/\(|\)|\./.test(text)) score += 10;
  if (detectCommonAreaLabel(text)) score += 30;
  return score;
}

function scoreTextCandidate(candidate: string, source: string, lineIndex: number, lineCount: number): number {
  const normalizedCandidate = normalizeResolvedUnitType(candidate);
  const normalizedSource = normalizeResolvedUnitType(source);

  let score = typeSpecificityScore(normalizedCandidate);
  if (!normalizedCandidate) return 0;
  if (normalizedSource === normalizedCandidate) score += 80;
  if (/UNIT\s+TYPE/i.test(source)) score += 50;
  else if (/TYPE/i.test(source)) score += 25;
  if (source.length <= candidate.length + 10) score += 30;
  else if (source.length <= candidate.length + 24) score += 10;
  if (lineIndex >= Math.floor(lineCount * 0.6)) score += 10;
  if (/-(AS|MIRROR|ADA|REV|ALT|OPTION)/i.test(candidate)) score += 10;
  if (/\d/.test(candidate)) score += 8;
  if (/(?:BLDG|BUILDING|UNIT\s*#?|FLOOR|LEVEL)/i.test(source) && !/UNIT\s+TYPE/i.test(source)) score -= 20;
  return score;
}

function collectCandidatesFromChunk(source: string, lineIndex: number, lineCount: number): UnitTypeCandidate[] {
  const candidates: UnitTypeCandidate[] = [];

  for (const pattern of TYPE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const resolved = normalizeResolvedUnitType(stripLeadingTypeDecorators(match[0]));
      if (!resolved || isSuspiciousUnitTypeCandidate(resolved)) continue;

      candidates.push({
        value: resolved,
        score: scoreTextCandidate(resolved, source, lineIndex, lineCount),
        source,
        lineIndex,
      });
    }
  }

  const commonArea = detectCommonAreaLabel(source);
  if (commonArea) {
    candidates.push({
      value: commonArea,
      score: scoreTextCandidate(commonArea, source, lineIndex, lineCount) + 20,
      source,
      lineIndex,
    });
  }

  return candidates;
}

function extractPreferredUnitTypeCandidate(pageText: string): UnitTypeCandidate | null {
  const lines = normalizePageTextLines(pageText);
  if (!lines.length) return null;

  const chunks: Array<{ text: string; lineIndex: number }> = [];
  const seenChunks = new Set<string>();
  const pushChunk = (text: string, lineIndex: number) => {
    const normalized = normalizeSpacing(text);
    if (!normalized || seenChunks.has(normalized)) return;
    seenChunks.add(normalized);
    chunks.push({ text: normalized, lineIndex });
  };

  lines.forEach((line, lineIndex) => {
    pushChunk(line, lineIndex);

    const nextLine = lines[lineIndex + 1];
    if (nextLine) {
      const likelySplitType = /(?:UNIT\s+TYPE|TYPE|STUDIO|\d+\s*BR)/i.test(line)
        || /^[-(A-Z0-9]/i.test(nextLine);
      if (likelySplitType) pushChunk(`${line} ${nextLine}`, lineIndex);
    }
  });

  if (lines.length > 1) pushChunk(lines.join(' '), lines.length);

  let bestCandidate: UnitTypeCandidate | null = null;
  for (const chunk of chunks) {
    for (const candidate of collectCandidatesFromChunk(chunk.text, chunk.lineIndex, lines.length)) {
      if (!bestCandidate
        || candidate.score > bestCandidate.score
        || (candidate.score == bestCandidate.score && typeSpecificityScore(candidate.value) > typeSpecificityScore(bestCandidate.value))
        || (candidate.score == bestCandidate.score && candidate.value.length > bestCandidate.value.length)) {
        bestCandidate = candidate;
      }
    }
  }

  return bestCandidate;
}

export function normalizeResolvedUnitType(value: string): string {
  const clean = stripLeadingTypeDecorators(value);
  if (!clean) return '';
  if (/^(?:PLAN|ELEVATION|SECTION|DETAIL|SHEET|DRAWING|LEGEND)/i.test(clean)) return '';
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
  if (/^(?:BLDG|BUILDING|FLOOR|LEVEL|UNIT)/i.test(text)) return true;

  const compact = text.toUpperCase().replace(/\s+/g, '');
  return /^[A-Z]?\d{1,4}[A-Z]?(?:-\d{1,4}[A-Z]?)?$/.test(compact);
}

export function extractPreferredUnitTypeFromPageText(pageText: string): string | null {
  return extractPreferredUnitTypeCandidate(pageText)?.value ?? null;
}

export function resolvePreferredUnitType(detectedType: string, pageText: string, unitNumber = ''): string {
  const resolvedDetected = normalizeResolvedUnitType(detectedType);
  const textCandidate = extractPreferredUnitTypeCandidate(pageText);
  const resolvedFromText = textCandidate?.value || '';

  if (!resolvedDetected) return resolvedFromText;
  if (!resolvedFromText) return resolvedDetected;
  if (isSuspiciousUnitTypeCandidate(resolvedDetected, unitNumber)) return resolvedFromText;
  if (!hasStrongTypeStructure(resolvedDetected) && hasStrongTypeStructure(resolvedFromText)) return resolvedFromText;

  const detectedBase = canonicalTypeBase(resolvedDetected);
  const textBase = canonicalTypeBase(resolvedFromText);
  const detectedComparable = comparableTypeBase(resolvedDetected);
  const textComparable = comparableTypeBase(resolvedFromText);
  const detectedScore = typeSpecificityScore(resolvedDetected);
  const textScore = typeSpecificityScore(resolvedFromText) + (textCandidate?.score || 0);

  if (detectedBase && textBase && detectedBase === textBase && textScore >= detectedScore) {
    return resolvedFromText;
  }

  if (detectedComparable && textComparable && detectedComparable === textComparable && textScore >= detectedScore) {
    return resolvedFromText;
  }

  if (detectCommonAreaLabel(resolvedFromText) && !detectCommonAreaLabel(resolvedDetected)) {
    return resolvedFromText;
  }

  if (textCandidate && textCandidate.score >= 110 && textScore >= detectedScore + 10) {
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
