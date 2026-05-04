import { describe, expect, it } from 'vitest';
import { splitPrefinalUnitRowsByAssignment, type PrefinalUnitNumber } from '@/hooks/usePrefinalStore';

describe('prefinal unit count row splitting', () => {
  it('keeps duplicate unit numbers in separate rows when they belong to different types', () => {
    const rows: PrefinalUnitNumber[] = [
      {
        name: '311',
        bldg: 'BLDG 1',
        floor: 'Floor 3',
        assignments: { Laundry: true, 'Type A(ADA)-Mirror': true },
      },
    ];

    expect(splitPrefinalUnitRowsByAssignment(rows)).toEqual([
      {
        name: '311',
        bldg: 'BLDG 1',
        floor: 'Floor 3',
        assignments: { Laundry: true },
      },
      {
        name: '311',
        bldg: 'BLDG 1',
        floor: 'Floor 3',
        assignments: { 'Type A(ADA)-Mirror': true },
      },
    ]);
  });

  it('does not create a row with total 2-style multiple assignments', () => {
    const [first, second] = splitPrefinalUnitRowsByAssignment([
      { name: '311', bldg: 'BLDG 1', floor: '3', assignments: { Laundry: true, Library: true } },
    ]);

    expect(Object.values(first.assignments).filter(Boolean)).toHaveLength(1);
    expect(Object.values(second.assignments).filter(Boolean)).toHaveLength(1);
  });
});