// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { mergePrefinalExtractionPasses } from '@/lib/prefinalCabinetMerge';

describe('mergePrefinalExtractionPasses UC hidden-label collapse', () => {
  it('collapses UC left/right variants when text layer only supports one directional label', () => {
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'UC18X84-L', room: 'Kitchen', type: 'Tall', quantity: 1 }],
      [{ sku: 'UC18X84-R', room: 'Kitchen', type: 'Tall', quantity: 1 }],
    ], {
      'UC18X84-R': 1,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].sku).toBe('UC18X84-');
    expect(merged[0].quantity).toBe(1);
  });

  it('keeps both UC directional variants when text layer supports two labels', () => {
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'UC18X84-L', room: 'Kitchen', type: 'Tall', quantity: 1 }],
      [{ sku: 'UC18X84-R', room: 'Kitchen', type: 'Tall', quantity: 1 }],
    ], {
      'UC18X84-L': 1,
      'UC18X84-R': 1,
    });

    expect(merged).toHaveLength(2);
    expect(merged.map((row) => row.sku).sort()).toEqual(['UC18X84-L', 'UC18X84-R']);
  });
});