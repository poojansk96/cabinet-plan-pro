import { describe, expect, it } from 'vitest';

import { extractPlanSkuCountsFromTextItems, mergePrefinalExtractionPasses } from '@/lib/prefinalCabinetMerge';

describe('extractPlanSkuCountsFromTextItems', () => {
  it('keeps the main plan cluster and ignores a remote duplicate occurrence', () => {
    const counts = extractPlanSkuCountsFromTextItems([
      { str: 'W2430B', transform: [1, 0, 0, 1, 320, 420] },
      { str: 'W2430B', transform: [1, 0, 0, 1, 380, 410] },
      { str: 'W3018B', transform: [1, 0, 0, 1, 440, 405] },
      { str: 'W2430B', transform: [1, 0, 0, 1, 40, 70] },
    ]);

    expect(counts.W2430B).toBe(2);
    expect(counts.W3018B).toBe(1);
  });
});

describe('mergePrefinalExtractionPasses', () => {
  it('recovers the missing +1 on higher-quantity repeated SKUs', () => {
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'W2430B', room: 'Kitchen', type: 'Wall', quantity: 3 }],
      [{ sku: 'W2430B', room: 'Kitchen', type: 'Wall', quantity: 2 }],
      [{ sku: 'W2430B', room: 'Kitchen', type: 'Wall', quantity: 1 }],
      [{ sku: 'W2430B', room: 'Kitchen', type: 'Wall', quantity: 2 }],
    ], {
      W2430B: 4,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(4);
  });

  it('does not add the old extra +1 on lower-count SKUs', () => {
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'W2430B', room: 'Kitchen', type: 'Wall', quantity: 2 }],
      [{ sku: 'W2430B', room: 'Kitchen', type: 'Wall', quantity: 2 }],
      [{ sku: 'W2430B', room: 'Kitchen', type: 'Wall', quantity: 1 }],
    ], {
      W2430B: 3,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(2);
  });
});