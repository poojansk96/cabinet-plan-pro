// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expandPageBuildingUnits } from '../../supabase/functions/extract-pdf-units/buildingUnits';
import { takeoffUnitKey } from '@/lib/takeoffUnitIdentity';

describe('takeoff shared building rows', () => {
  it('pairs L and M with their individually printed unit numbers', () => {
    expect(expandPageBuildingUnits([{ unitNumbers: ['101', '201'], detectedBldg: 'Building L&M' }]))
      .toEqual([{ unitNumber: '101', detectedBldg: 'Building L' }, { unitNumber: '201', detectedBldg: 'Building M' }]);
  });
  it('maps the uploaded plan label 417/518 to L and M', () => {
    expect(expandPageBuildingUnits([{ unitNumber: '417/518', detectedBldg: 'Building L&M', detectedFloor: '1', detectedType: 'A3-S' }]))
      .toEqual([{ unitNumber: '417', detectedBldg: 'Building L', detectedFloor: '1', detectedType: 'A3-S' }, { unitNumber: '518', detectedBldg: 'Building M', detectedFloor: '1', detectedType: 'A3-S' }]);
  });
  it('includes all four explicitly shared buildings with the printed typical number', () => {
    expect(expandPageBuildingUnits([{ unitNumber: '702', detectedType: 'A4-S' }], 'Building C,E,N&P').map(u => [u.detectedBldg, u.unitNumber]))
      .toEqual([['Building C', '702'], ['Building E', '702'], ['Building N', '702'], ['Building P', '702']]);
  });
  it('never merges the same unit number across buildings', () => {
    expect(takeoffUnitKey('Building L', '101')).not.toBe(takeoffUnitKey('Building M', '101'));
    expect(takeoffUnitKey('Bldg. L', '101')).toBe(takeoffUnitKey('Building L', '101'));
    expect(takeoffUnitKey('', '101')).not.toBe(takeoffUnitKey('Building L', '101'));
  });
  it('flags unpaired numbers without inventing building assignments', () => {
    expect(expandPageBuildingUnits([{ unitNumber: '101/201/301', detectedBldg: 'Building L&M' }]).every(u => u.detectedBldg === null)).toBe(true);
  });
  it('treats a unit number repeated on two floors of one building as a single unit', () => {
    expect(takeoffUnitKey('Building L', '417', '1')).toBe(takeoffUnitKey('Building L', '417', '2'));
    expect(takeoffUnitKey('Building L', '417', 'Floor 1')).toBe(takeoffUnitKey('Building L', '417', '1'));
  });
});