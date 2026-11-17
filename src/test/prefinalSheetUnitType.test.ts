import { describe, it, expect } from 'vitest';
import { extractPrefinalUnitTypeLabelFromText, hasResidentialPrefinalUnitTypeHint } from '@/lib/prefinalCabinetPageLabels';

describe('floor plan sheet unit type', () => {
  it('reads Unit-A2 / Unit B-3 / Unit A1 as TYPE names', () => {
    expect(extractPrefinalUnitTypeLabelFromText('A3-11 Unit-A2 Kitchen Master Bath')).toBe('TYPE A2');
    expect(extractPrefinalUnitTypeLabelFromText('A3-17 Unit B-3 Bath')).toBe('TYPE B3');
    expect(extractPrefinalUnitTypeLabelFromText('A3-16-Unit-B2')).toBe('TYPE B2');
  });
  it('ignores unit numbers', () => {
    expect(extractPrefinalUnitTypeLabelFromText('UNIT# 1109, 1117')).toBeNull();
  });
  it('a residential unit page is not treated as a Master Bath room page', () => {
    expect(hasResidentialPrefinalUnitTypeHint('A3-11 Unit-A2 Master Bath')).toBe(true);
  });
});
