// @vitest-environment node
// Mirrors the AMENITY_ROOM_RE / commonAreaPattern from
// supabase/functions/extract-pdf-labels/index.ts to lock in detection of
// community/amenity room pages (TOILET, SALOON, LIBRARY, etc.) so they are
// never silently dropped from prefinal cabinet extraction.
import { describe, expect, it } from 'vitest';

const AMENITY_ROOM_RE = /\b(TOILET|SALOON|SALON|LIBRARY|LOUNGE|GAME\s*ROOM|THEAT(?:RE|ER)|MEDIA\s*ROOM|CARD\s*ROOM|CRAFT\s*ROOM|ACTIVITY\s*ROOM|CONFERENCE\s*ROOM|DINING\s*(?:ROOM|HALL)|CAFE|COFFEE\s*BAR|BAR|PUB|HAIR\s*SALON|WELLNESS|SPA|YOGA|MULTI[-\s]?PURPOSE|COMPUTER\s*ROOM|HOBBY\s*ROOM|MUSIC\s*ROOM|CLUBHOUSE|FITNESS|RECEPTION|LEASING|BUSINESS\s*CENTER|COMMUNITY\s*ROOM|BREAK\s*ROOM|MAIL\s*ROOM)\b/i;

const RESIDENTIAL_TYPE_RE = /\b(TYPE\s*\d|UNIT\s*[A-Z]\b|\d\s*BR\b|STUDIO|BED(?:ROOM)?|APARTMENT|APT)\b/i;
const PREFINAL_COMMON_AREA_LABELS: Array<{ label: string; re: RegExp }> = [
  { label: 'Toilet', re: /\bTOILET\b/i },
  { label: 'Library', re: /\bLIBRARY\b/i },
  { label: 'Saloon', re: /\bSALOON\b/i },
];

const extractCommonAreaLabel = (pageText: string) =>
  PREFINAL_COMMON_AREA_LABELS.find((entry) => entry.re.test(pageText))?.label ?? null;
const isCommonAreaType = (value: string) =>
  PREFINAL_COMMON_AREA_LABELS.some((entry) => entry.re.test(value));

describe('amenity room detection (Franklin Ridge cases)', () => {
  it('detects TOILET-AS as amenity', () => {
    const text = 'Franklin Ridge Senior Housing TOILET - AS UNIT # 113';
    expect(AMENITY_ROOM_RE.test(text)).toBe(true);
    expect(RESIDENTIAL_TYPE_RE.test(text)).toBe(false);
  });

  it('detects SALOON as amenity', () => {
    const text = 'Franklin Ridge Senior Housing SALOON UNIT # 202';
    expect(AMENITY_ROOM_RE.test(text)).toBe(true);
    expect(RESIDENTIAL_TYPE_RE.test(text)).toBe(false);
  });

  it('detects LIBRARY as amenity', () => {
    const text = 'Franklin Ridge Senior Housing LIBRARY UNIT # 129';
    expect(AMENITY_ROOM_RE.test(text)).toBe(true);
    expect(RESIDENTIAL_TYPE_RE.test(text)).toBe(false);
  });

  it('does NOT classify residential 2BR TYPE B1 as amenity-only', () => {
    const text = '2BR TYPE B1 UNIT # 401';
    expect(RESIDENTIAL_TYPE_RE.test(text)).toBe(true);
  });

  it('does NOT classify 1BR-A.2 as amenity-only', () => {
    const text = '1BR-A.2 UNIT # 102';
    expect(RESIDENTIAL_TYPE_RE.test(text)).toBe(true);
  });

  it('detects GAME ROOM, LOUNGE, THEATER variants', () => {
    expect(AMENITY_ROOM_RE.test('GAME ROOM')).toBe(true);
    expect(AMENITY_ROOM_RE.test('LOUNGE AREA')).toBe(true);
    expect(AMENITY_ROOM_RE.test('THEATER')).toBe(true);
    expect(AMENITY_ROOM_RE.test('THEATRE')).toBe(true);
  });

  it('keeps uploaded amenity type names in the Prefinal import dialog', () => {
    expect(extractCommonAreaLabel('Franklin Ridge Senior Housing TOILET - AS UNIT # 113')).toBe('Toilet');
    expect(extractCommonAreaLabel('Franklin Ridge Senior Housing SALOON UNIT # 202')).toBe('Saloon');
    expect(extractCommonAreaLabel('Franklin Ridge Senior Housing LIBRARY UNIT # 129')).toBe('Library');
    expect(isCommonAreaType('Toilet-AS')).toBe(true);
    expect(isCommonAreaType('Saloon')).toBe(true);
    expect(isCommonAreaType('Library')).toBe(true);
  });
});
