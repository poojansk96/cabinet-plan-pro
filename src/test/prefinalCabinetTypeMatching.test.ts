import { describe, it, expect } from 'vitest';
import { matchPrefinalCabinetUnitType, resolvePrefinalCabinetTypeForPage } from '@/lib/prefinalCabinetPageLabels';

const types = ['TYPE A2', 'TYPE A3', 'TYPE A5 (C1-MODIFIED)', 'TYPE A1 (B3-MODIFIED)', 'TYPE A4'];
describe('Prefinal cabinet type identity', () => {
  it('reads individually positioned title letters from the actual A1 PDF', () => {
    expect(resolvePrefinalCabinetTypeForPage('Master Bath K i t c h e n A 3 - 1 0 U n i t A 1', 'TYPE A', types)).toBe('TYPE A1 (B3-MODIFIED)');
  });
  it('keeps A1 and its complete Unit Count name despite a wrong AI room label', () => {
    expect(resolvePrefinalCabinetTypeForPage('A3-10 Unit A1 Kitchen Master Bath', 'MASTER BATH', types)).toBe('TYPE A1 (B3-MODIFIED)');
  });
  it('uses the full A5 name saved in Unit Count', () => {
    expect(resolvePrefinalCabinetTypeForPage('A3-14 Unit-A5 Kitchen', 'TYPE A', types)).toBe('TYPE A5 (C1-MODIFIED)');
  });
  it('does not invent a Master Bath type in a residential project', () => {
    expect(resolvePrefinalCabinetTypeForPage('Kitchen Master Bath', 'MASTER BATH', types)).toBe('Unassigned');
  });
  it('does not guess TYPE A means A1', () => {
    expect(resolvePrefinalCabinetTypeForPage('', 'TYPE A', types)).toBe('Unassigned');
  });
  it('does not choose between multiple variants', () => {
    expect(matchPrefinalCabinetUnitType('TYPE A5', ['TYPE A5 (ALT)', 'TYPE A5 (MODIFIED)'])).toBeNull();
  });
  it('keeps suffixes distinct', () => {
    expect(matchPrefinalCabinetUnitType('TYPE A1-AS', ['TYPE A1', 'TYPE A1-AS'])).toBe('TYPE A1-AS');
  });
  it('never matches A1 to A10', () => {
    expect(matchPrefinalCabinetUnitType('TYPE A1', ['TYPE A10'])).toBeNull();
  });
});