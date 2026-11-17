import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolvePrefinalCabinetTypeForPage } from '@/lib/prefinalCabinetPageLabels';

// Coconut Creek: floor plans print "A3-11 Unit-A2", "Unit B1- A3-15", "Unit C-1"; titles print "TYPE A5 (C1 - MODIFIED)".
const types = ['TYPE A2', 'TYPE A3', 'TYPE A5 (C1 - MODIFIED)', 'TYPE B1', 'TYPE B2', 'TYPE B3', 'TYPE C1', 'TYPE C2', 'TYPE A1 (B3 - MODIFIED)', 'TYPE B4', 'TYPE A4'];
const arbors = ['STUDIO 1', 'UNIT A2/STUDIO - 2/3/5/6/7', 'UNIT A-1/A-6', 'UNIT A-3', 'UNIT B-1'];

describe('Coconut Creek floor plans re-match to the Unit Count names saved at import time', () => {
  it('a page first typed against an older project\'s names re-matches to the current names', () => {
    const page = 'A3-11 Unit-A2 W093612R SB33';
    expect(resolvePrefinalCabinetTypeForPage(page, 'TYPE A2', arbors)).toBe('UNIT A2/STUDIO - 2/3/5/6/7');
    expect(resolvePrefinalCabinetTypeForPage(page, 'TYPE A2', types)).toBe('TYPE A2');
  });
  const expected = ['TYPE A2', 'TYPE A3', 'TYPE A5 (C1 - MODIFIED)', 'TYPE B1', 'TYPE B2', 'TYPE B3', 'TYPE C1', 'TYPE C2', 'TYPE A1 (B3 - MODIFIED)', 'TYPE B4', 'TYPE A4'];
  expected.forEach((type, i) => {
    const f = `/tmp/cc_p${(i + 1) * 2}.txt`;
    it.skipIf(!existsSync(f))(`page ${(i + 1) * 2} -> ${type}`, () => {
      expect(resolvePrefinalCabinetTypeForPage(readFileSync(f, 'utf8'), '', types)).toBe(type);
    });
  });
});
