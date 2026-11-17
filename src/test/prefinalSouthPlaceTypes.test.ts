import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { matchPrefinalCabinetUnitType, resolvePrefinalCabinetTypeForPage } from '@/lib/prefinalCabinetPageLabels';

const types = ['TYPE A1 / A1.1', 'TYPE A2', 'TYPE B1', 'TYPE B1.1', 'TYPE B1.2', 'TYPE B1.3', 'TYPE B2 / B2.1', 'TYPE B3', 'TYPE C1', 'TYPE C1.1', 'TYPE ST - STUDIO'];

describe('Prefinal cabinet types with slash / descriptor names', () => {
  it('UNIT-A1 floor plan goes to the saved "A1 / A1.1" type', () => {
    expect(resolvePrefinalCabinetTypeForPage('W3618 UNIT-A1 Kitchen Bathroom', 'TYPE A1', types)).toBe('TYPE A1 / A1.1');
  });
  it('UNIT B2 floor plan goes to the saved "B2 / B2.1" type', () => {
    expect(resolvePrefinalCabinetTypeForPage('Bathroom UNIT B2 W1236L Kitchen', 'KITCHEN', types)).toBe('TYPE B2 / B2.1');
  });
  it('UNIT ST floor plan goes to the saved "ST - STUDIO" type', () => {
    expect(resolvePrefinalCabinetTypeForPage('SB36 UNIT ST W3018 Kitchen', 'KITCHEN', types)).toBe('TYPE ST - STUDIO');
  });
  it('exact B1.1 still wins over other B1 names', () => {
    expect(matchPrefinalCabinetUnitType('TYPE B1.1', types)).toBe('TYPE B1.1');
    expect(matchPrefinalCabinetUnitType('TYPE B1', types)).toBe('TYPE B1');
  });
  it('does not pick between two saved names sharing a code', () => {
    expect(matchPrefinalCabinetUnitType('TYPE A1', ['TYPE A1 / A1.1', 'TYPE A1 (ALT)'])).toBeNull();
  });
  it('variant suffix is not treated as a descriptor', () => {
    expect(matchPrefinalCabinetUnitType('TYPE A1', ['TYPE A1-AS'])).toBeNull();
  });
  it('UNIT# numbers never become a type', () => {
    expect(resolvePrefinalCabinetTypeForPage('UNIT# 111, 113 Kitchen', 'KITCHEN', types)).toBe('Unassigned');
  });

  const expected: Record<number, string> = { 2: 'TYPE A1 / A1.1', 4: 'TYPE A2', 6: 'TYPE B1', 8: 'TYPE B1.1', 10: 'TYPE B1.2', 12: 'TYPE B1.3', 14: 'TYPE B2 / B2.1', 16: 'TYPE B3', 18: 'TYPE C1', 20: 'TYPE C1.1', 22: 'TYPE ST - STUDIO' };
  for (const [page, type] of Object.entries(expected)) {
    const f = `/tmp/sp${page}.txt`;
    it.skipIf(!existsSync(f))(`South Place page ${page} -> ${type}`, () => {
      expect(resolvePrefinalCabinetTypeForPage(readFileSync(f, 'utf8'), '', types)).toBe(type);
    });
  }
});
