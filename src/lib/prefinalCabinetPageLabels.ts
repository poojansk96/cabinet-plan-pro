function normalizePageText(value: string): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    // pdf.js can expose a title's individually positioned letters as "U n i t".
    .replace(/\bU\s+N\s+I\s+T\b/g, 'UNIT')
    .replace(/\bT\s+Y\s+P\s+E\b/g, 'TYPE')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleFromMatch(text: string, pattern: RegExp, label: string): string | null {
  return pattern.test(text) ? label : null;
}

export function isGenericPrefinalCabinetPageLabel(value: string): boolean {
  const text = normalizePageText(value);
  if (!text) return true;
  return /^(?:MAIN|UPPER|BASEMENT|LOWER|GROUND)?\s*FLOOR$/.test(text)
    || /^(?:MAIN|UPPER|BASEMENT|LOWER|GROUND)\s*LEVEL$/.test(text)
    || /^(?:PLAN|FLOOR PLAN|CABINET PLAN|SHOP DRAWING|SHEET)$/.test(text);
}

const UNIT_TYPE_LABEL_RE = /\b(?:UNIT|TYPE)[\s-]+([A-Z]{1,2})\s*-?\s*(\d{1,2}(?:\.\d)?)(?![\d])((?:\s*-\s*(?:AS|ADA|MIRROR|REV|ALT|OPTION)\b)*)(\s*\([^)]*\))?/;

/** Reads a floor-plan sheet label like "Unit-A2" / "Unit B-3" as "TYPE A2" / "TYPE B3". */
export function extractPrefinalUnitTypeLabelFromText(pageText: string): string | null {
  const m = normalizePageText(pageText).match(UNIT_TYPE_LABEL_RE);
  return m ? `TYPE ${m[1]}${m[2]}${(m[3] || '').replace(/\s*-\s*/g, '-')}${m[4] || ''}`.trim() : null;
}

/** Match complete codes, never prefixes: A must not become A1, or A1 become A10. */
export function matchPrefinalCabinetUnitType(raw: string, knownTypes: string[]): string | null {
  const key = (value: string) => normalizePageText(value).replace(/^TYPE[\s-]+/, '').replace(/\s+/g, '').replace(/\s*-\s*/g, '-');
  const incoming = key(raw);
  if (!incoming) return null;
  const exact = knownTypes.find(t => key(t) === incoming);
  if (exact) return exact;
  // A floor plan may omit the explanatory parenthesis printed in Unit Count.
  // Only a unique complete base code can recover that full saved name.
  if (!/^[A-Z]{1,2}\d{1,2}(?:\.\d)?(?:-(?:AS|ADA|MIRROR|REV|ALT|OPTION))*$/.test(incoming)) return null;
  const candidates = knownTypes.filter(t => key(t).replace(/\([^)]*\)$/, '') === incoming);
  return candidates.length === 1 ? candidates[0] : null;
}

export function resolvePrefinalCabinetTypeForPage(pageText: string, aiType: string, knownTypes: string[]): string {
  const sheet = extractPrefinalUnitTypeLabelFromText(pageText);
  const raw = sheet || aiType;
  const known = matchPrefinalCabinetUnitType(raw, knownTypes);
  if (known) return known;
  // A project with residential types must not acquire room-name/partial-type columns.
  if (knownTypes.some(t => extractPrefinalUnitTypeLabelFromText(t))) return 'Unassigned';
  return raw || 'Unassigned';
}

export function hasResidentialPrefinalUnitTypeHint(pageText: string): boolean {
  const text = normalizePageText(pageText);
  if (UNIT_TYPE_LABEL_RE.test(text)) return true;
  return /\b(?:STUDIO|\d+\s*BR|\d+\s*BED(?:ROOM)?|TYPE\s+[A-Z0-9._-]+|UNIT\s+TYPE|APT\s+TYPE|APARTMENT\s+TYPE)\b/.test(text);
}

export function extractPrefinalCabinetPageLabelFromText(pageText: string): string | null {
  const text = normalizePageText(pageText);
  if (!text) return null;

  const upperBath = text.match(/\bUPPER\s+BATH\s+(\d+(?:\.\d+)?)\b/);
  if (upperBath) return `UPPER BATH ${upperBath[1]}`;

  const numberedBath = text.match(/\bBATH(?:ROOM)?\s*#\s*(\d+(?:\.\d+)?)\b/);
  if (numberedBath) return `BATH #${numberedBath[1]}`;

  const ordered: Array<[RegExp, string]> = [
    [/\bMUD\s*ROOM\s*\/\s*DROP\s+ZONE\s*\/\s*LOCKERS\b/, 'MUDROOM / DROP ZONE / LOCKERS'],
    [/\bGATHERING\s+ROOM\b(?=.*\bWET\s+BAR\b)/, 'GATHERING ROOM WET BAR'],
    [/\bLOWER\s+LEVEL\s+BAR\b/, 'LOWER LEVEL BAR'],
    [/\bOWNER'?S\s+BATH\b(?=.*\bDRESSING\s+AREA\b)|\bDRESSING\s+AREA\b(?=.*\bOWNER'?S\s+BATH\b)/, "OWNER'S BATH & DRESSING AREA"],
    [/\bOWNER'?S\s+BATH\b/, "OWNER'S BATH"],
    [/\bMASTER\s+BATH\b/, 'MASTER BATH'],
    [/\bM\.?\s*BATH\b/, 'MASTER BATH'],
    [/\bOFFICE\s+BATH\b/, 'OFFICE BATH'],
    [/\bLOWER\s+LEVEL\s+BATH\b/, 'LOWER LEVEL BATH'],
    [/\bLOWER\s+BATH\b/, 'LOWER BATH'],
    [/\bBASEMENT\s+KITCHEN\b/, 'BASEMENT KITCHEN'],
    [/\bMAIN\s+LAUNDRY\b/, 'MAIN LAUNDRY'],
    [/\bUPPER\s+LAUNDRY\b/, 'UPPER LAUNDRY'],
    [/\bPOWDER\s+BATH\b/, 'POWDER BATH'],
    [/\bPOWDER\s+ROOM\b(?:\s*\(\s*PWD\s*\))?|\bPWD\b/, 'POWDER ROOM'],
    [/\bPOOL\s+BATH\b/, 'POOL BATH'],
    [/\bBUNK\s*ROOM\s+BATH\b/, 'BUNKROOM BATH'],
    [/\bGUEST\s+BATH\b/, 'GUEST BATH'],
    [/\bOFFICE\s+BOOKCASE\b/, 'OFFICE BOOKCASE'],
    [/\bWET\s+BAR\b/, 'WET BAR'],
    [/\bBUTLER'?S\s+PANTRY\b/, "BUTLER'S PANTRY"],
    [/\bMUD\s*ROOM\s*-\s*LAUNDRY\b/, 'MUDROOM - LAUNDRY'],
    [/\bPANTRY\b/, 'PANTRY'],
    [/\bKITCHEN\b/, 'KITCHEN'],
    [/\bLAUNDRY\b/, 'LAUNDRY'],
  ];

  for (const [pattern, label] of ordered) {
    const match = titleFromMatch(text, pattern, label);
    if (match) return match;
  }

  return null;
}