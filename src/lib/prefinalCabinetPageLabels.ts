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

const UNIT_TYPE_LABEL_RE = /\b(?:UNIT|TYPE)[\s-]+([A-Z]{1,2})(?:\s*-\s*|(?<=\b[A-Z])\s+)?(\d{1,2}(?:\.\d)?)(?![\d])((?:\s*-\s*(?:AS|ADA|MIRROR|REV|ALT|OPTION)\b)*)(\s*\([^)]*\))?/;

/** Reads a floor-plan sheet label like "Unit-A2" / "Unit B-3" as "TYPE A2" / "TYPE B3". */
export function extractPrefinalUnitTypeLabelFromText(pageText: string): string | null {
  const m = normalizePageText(pageText).match(UNIT_TYPE_LABEL_RE);
  return m ? `TYPE ${m[1]}${m[2]}${(m[3] || '').replace(/\s*-\s*/g, '-')}${m[4] || ''}`.trim() : null;
}

const TYPE_SUFFIX_RE = '(?:-(?:AS|ADA|MIRROR|REV|ALT|OPTION))*';
const TYPE_CODE_RE = new RegExp(`^[A-Z]{1,3}(?:\\d{1,2}(?:\\.\\d)?)?${TYPE_SUFFIX_RE}$`);
const NON_CODE_WORDS = new Set(['TYPE', 'NO', 'NUM', 'NUMBER', 'PLAN', 'PLANS', 'MIX', 'A', 'I']);

/** Strips "TYPE - UNIT" style prefixes and letter-hyphen-digit gaps: "TYPE - UNIT A-3" -> "A3". */
function typeKey(value: string): string {
  return normalizePageText(value)
    .replace(/^(?:(?:TYPE|UNIT)\b[\s:-]*)+/, '')
    .replace(/\s+/g, '')
    .replace(/(^|[^A-Z])([A-Z]{1,3})-(\d)/g, '$1$2$3');
}

/** Saved name without its "TYPE - UNIT" prefix, spacing kept: "TYPE - UNIT A-1/A-6" -> "A-1 / A-6". */
function savedNameCore(saved: string): string {
  return normalizePageText(saved).replace(/^(?:(?:TYPE|UNIT)\b[\s:-]*)+/, '').trim();
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex for a saved name as printed on its own floor plan: spaces, hyphens and
 * slashes between tokens are interchangeable ("B4/B5" ~ "B4-B5", "A-3" ~ "A3").
 * Short codes need a UNIT/TYPE prefix so SKUs and dimensions never match.
 */
function savedNamePattern(core: string): RegExp | null {
  const tokens = core.match(/[A-Z]+|\d+(?:\.\d+)?|\([^)]*\)/g);
  if (!tokens || tokens.length === 0) return null;
  const body = tokens.map(t => t.startsWith('(')
    ? `\\(\\s*${t.slice(1, -1).trim().split(/\s+/).map(escapeRe).join('\\s*')}\\s*\\)`
    : escapeRe(t)).join('[\\s\\-/]*');
  // A bare name needs to be distinctive: "STUDIO 1", "ST - STUDIO" — never a room word alone.
  const distinctive = tokens.includes('STUDIO')
    || (tokens.some(t => /^[A-Z]{4,}$/.test(t)) && tokens.some(t => /^\d/.test(t)));
  const prefix = distinctive ? '' : '(?:UNIT|TYPE)[\\s:-]*';
  return new RegExp(`(?<![A-Z0-9.])${prefix}${body}(?![A-Z0-9]|\\.\\d)`);
}

/**
 * Finds the saved Unit Count name printed on this page. The longest printed name
 * wins ("B1.1" over "B1"); two different names of equal length are ambiguous.
 */
export function findSavedPrefinalTypeOnPage(pageText: string, knownTypes: string[]): string | null {
  const text = normalizePageText(pageText);
  if (!text) return null;
  let best: { type: string; len: number } | null = null;
  let tie = false;
  for (const type of knownTypes) {
    const core = savedNameCore(type);
    const variants = [core, core.replace(/\s*\([^)]*\)\s*$/, '')].filter((v, i, a) => v && a.indexOf(v) === i);
    for (const variant of variants) {
      const re = savedNamePattern(variant);
      const m = re ? text.match(re) : null;
      if (!m) continue;
      const len = m[0].replace(/^(?:UNIT|TYPE)[\s:-]*/, '').length;
      if (!best || len > best.len) { best = { type, len }; tie = false; }
      else if (len === best.len && best.type !== type) tie = true;
      break;
    }
  }
  return best && !tie ? best.type : null;
}

/**
 * Codes a saved Unit Count name answers to, from that name alone:
 * "TYPE A1 / A1.1" -> A1, A1.1; "TYPE ST - STUDIO" -> ST; "TYPE A5 (C1-MODIFIED)" -> A5.
 */
function savedTypeCodes(saved: string): string[] {
  const full = typeKey(saved);
  const codes = new Set<string>([full]);
  const base = full.replace(/\([^)]*\)$/, '');
  codes.add(base);
  for (const alt of base.split('/').filter(Boolean)) {
    codes.add(alt);
    codes.add(alt.replace(/^([A-Z]{1,3})-(\d)/, '$1$2'));
    // Drop a trailing descriptive word ("ST-STUDIO"), never a variant suffix ("A1-AS").
    const m = alt.match(/^([A-Z]{1,3}(?:\d{1,2}(?:\.\d)?)?)-([A-Z]{3,})$/);
    if (m && !/^(?:ADA|REV|ALT|MIRROR|OPTION)$/.test(m[2])) codes.add(m[1]);
  }
  return [...codes];
}

/** Match complete codes, never prefixes: A must not become A1, or A1 become A10. */
export function matchPrefinalCabinetUnitType(raw: string, knownTypes: string[]): string | null {
  const incoming = typeKey(raw);
  if (!incoming) return null;
  const exact = knownTypes.find(t => typeKey(t) === incoming);
  if (exact) return exact;
  // A floor plan may print only one complete code of the saved name (parenthesis,
  // "A1 / A1.1" alternatives, "ST - STUDIO" descriptor). Only a unique owner counts.
  if (!TYPE_CODE_RE.test(incoming)) return null;
  const candidates = knownTypes.filter(t => savedTypeCodes(t).includes(incoming));
  return candidates.length === 1 ? candidates[0] : null;
}

/** Letter-only sheet codes like "UNIT ST", tried only against saved Unit Count names. */
function letterOnlySheetCodes(pageText: string): string[] {
  const text = normalizePageText(pageText);
  const out: string[] = [];
  for (const m of text.matchAll(/\bUNIT[\s-]+([A-Z]{1,3})\b(?![#.\d])/g)) {
    if (!NON_CODE_WORDS.has(m[1])) out.push(m[1]);
  }
  return out;
}

export function resolvePrefinalCabinetTypeForPage(pageText: string, aiType: string, knownTypes: string[]): string {
  const printed = findSavedPrefinalTypeOnPage(pageText, knownTypes);
  if (printed) return printed;
  const sheet = extractPrefinalUnitTypeLabelFromText(pageText);
  const raw = sheet || aiType;
  const known = matchPrefinalCabinetUnitType(raw, knownTypes);
  if (known) return known;
  if (!sheet) {
    for (const code of letterOnlySheetCodes(pageText)) {
      const hit = matchPrefinalCabinetUnitType(code, knownTypes);
      if (hit) return hit;
    }
  }
  // A project with residential types must not acquire room-name/partial-type columns.
  if (knownTypes.some(t => extractPrefinalUnitTypeLabelFromText(t))) return 'Unassigned';
  return raw || 'Unassigned';
}

export function hasResidentialPrefinalUnitTypeHint(pageText: string): boolean {
  const text = normalizePageText(pageText);
  if (UNIT_TYPE_LABEL_RE.test(text)) return true;
  if (letterOnlySheetCodes(text).length > 0) return true;
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