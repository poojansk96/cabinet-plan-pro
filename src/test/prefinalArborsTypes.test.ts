import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolvePrefinalCabinetTypeForPage } from '@/lib/prefinalCabinetPageLabels';

// Arbors at Leisure City: title pages print "TYPE - UNIT A-1/A-6", floor plans print "UNIT A-1/A-6".
const printed = ['STUDIO 1', 'STUDIO 4 (ADA)', 'UNIT A2/STUDIO - 2/3/5/6/7', 'UNIT A-1/A-6', 'UNIT A-3',
  'UNIT A-4/A-5/A-7/A-10/A-11', 'UNIT A-8', 'UNIT A-9 (ADA)', 'UNIT A-12', 'UNIT B-1', 'UNIT B-2', 'UNIT B3 (ADA)', 'UNIT B4/B5'];
const formats: Record<string, (n: string) => string> = {
  'as printed': n => n,
  'TYPE - prefix': n => `TYPE - ${n}`,
  'no UNIT word': n => n.replace(/^UNIT /, ''),
  'TYPE prefix, no UNIT': n => `TYPE ${n.replace(/^UNIT /, '')}`,
};

describe('Prefinal cabinet types read from the full name printed on the floor plan', () => {
  it('a different unit number like A-12 never matches A-1', () => {
    const t = ['UNIT A-1/A-6', 'UNIT A-12'];
    expect(resolvePrefinalCabinetTypeForPage('W3024 Unit A-12 Kitchen', '', t)).toBe('UNIT A-12');
  });
  it('B4-B5 on the plan matches saved B4/B5', () => {
    expect(resolvePrefinalCabinetTypeForPage('Kitchen Unit B4-B5 Bath', '', ['TYPE - UNIT B4/B5', 'TYPE - UNIT B-1'])).toBe('TYPE - UNIT B4/B5');
  });
  it('a room word saved as a type does not claim every page', () => {
    expect(resolvePrefinalCabinetTypeForPage('W3024 KITCHEN BATH', '', ['KITCHEN', 'TYPE A1'])).toBe('Unassigned');
  });

  for (const [label, fmt] of Object.entries(formats)) {
    const types = printed.map(fmt);
    printed.forEach((_, i) => {
      const f = `/tmp/arb_p${(i + 1) * 2}.txt`;
      it.skipIf(!existsSync(f))(`${label}: page ${(i + 1) * 2} -> ${types[i]}`, () => {
        expect(resolvePrefinalCabinetTypeForPage(readFileSync(f, 'utf8'), '', types)).toBe(types[i]);
      });
    });
  }
});
