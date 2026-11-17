import { describe, it, expect } from 'vitest';
import { splitGluedPrefinalSkus } from '@/lib/prefinalCabinetMerge';

describe('glued prefinal SKUs', () => {
  it('splits three wall cabinets read as one label', () => {
    expect(splitGluedPrefinalSkus('W12361W183612WA24243612L')).toEqual(['W12361', 'W183612', 'WA24243612L']);
  });
  it('splits two wall cabinets read as one label', () => {
    expect(splitGluedPrefinalSkus('W24361W123612R')).toEqual(['W24361', 'W123612R']);
  });
  it('keeps real single SKUs whole', () => {
    for (const s of ['WA24243612R', 'TF390P249024', 'HAV3621BFH-REM', 'UC18X84', 'BLW36/3930-L', 'W30PFT', '3DB21', 'V3021B'])
      expect(splitGluedPrefinalSkus(s)).toEqual([s]);
  });
});
