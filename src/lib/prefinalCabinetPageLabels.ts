function normalizePageText(value: string): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
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

export function hasResidentialPrefinalUnitTypeHint(pageText: string): boolean {
  const text = normalizePageText(pageText);
  return /\b(?:STUDIO|\d+\s*BR|\d+\s*BED(?:ROOM)?|TYPE\s+[A-Z0-9._-]+|UNIT\s+TYPE|APT\s+TYPE|APARTMENT\s+TYPE)\b/.test(text);
}

export function extractPrefinalCabinetPageLabelFromText(pageText: string): string | null {
  const text = normalizePageText(pageText);
  if (!text) return null;

  const upperBath = text.match(/\bUPPER\s+BATH\s+(\d+(?:\.\d+)?)\b/);
  if (upperBath) return `UPPER BATH ${upperBath[1]}`;

  const ordered: Array<[RegExp, string]> = [
    [/\bMUD\s*ROOM\s*\/\s*DROP\s+ZONE\s*\/\s*LOCKERS\b/, 'MUDROOM / DROP ZONE / LOCKERS'],
    [/\bGATHERING\s+ROOM\b(?=.*\bWET\s+BAR\b)/, 'GATHERING ROOM WET BAR'],
    [/\bOWNER'?S\s+BATH\b(?=.*\bDRESSING\s+AREA\b)|\bDRESSING\s+AREA\b(?=.*\bOWNER'?S\s+BATH\b)/, "OWNER'S BATH & DRESSING AREA"],
    [/\bOWNER'?S\s+BATH\b/, "OWNER'S BATH"],
    [/\bBASEMENT\s+KITCHEN\b/, 'BASEMENT KITCHEN'],
    [/\bMAIN\s+LAUNDRY\b/, 'MAIN LAUNDRY'],
    [/\bUPPER\s+LAUNDRY\b/, 'UPPER LAUNDRY'],
    [/\bPOWDER\s+BATH\b/, 'POWDER BATH'],
    [/\bPOOL\s+BATH\b/, 'POOL BATH'],
    [/\bBUNK\s*ROOM\s+BATH\b/, 'BUNKROOM BATH'],
    [/\bGUEST\s+BATH\b/, 'GUEST BATH'],
    [/\bOFFICE\s+BOOKCASE\b/, 'OFFICE BOOKCASE'],
    [/\bWET\s+BAR\b/, 'WET BAR'],
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