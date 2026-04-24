// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { extractPlanSkuCountsFromTextItems, mergePrefinalExtractionPasses } from '@/lib/prefinalCabinetMerge';

describe('B15-R repeated-label undercount (Type 2 BR-D, One Post Road)', () => {
  it('extracts BOTH B15-R labels from a kitchen page with two elevations', () => {
    // Top kitchen elevation has W1230-, W3015B, W1530-R, W3318X24B, B15-R, etc.
    // Bottom kitchen elevation (vertically below, separated by title text)
    // has BF3, B15-R, B30B, SB30B, DWR3, DISHW18.
    // pdf.js typically yields these as two y-clusters that share the same
    // X-band on the left side of the page.
    const counts = extractPlanSkuCountsFromTextItems([
      // Top elevation (around y=600)
      { str: 'WF3X30',     transform: [1, 0, 0, 1, 80,  640] },
      { str: 'W1230-',     transform: [1, 0, 0, 1, 100, 600] },
      { str: 'W3015B',     transform: [1, 0, 0, 1, 200, 600] },
      { str: 'W1530-R',    transform: [1, 0, 0, 1, 300, 600] },
      { str: 'W3318X24B',  transform: [1, 0, 0, 1, 400, 600] },
      { str: 'DB12',       transform: [1, 0, 0, 1, 100, 580] },
      { str: 'B15-R',      transform: [1, 0, 0, 1, 300, 580] },
      { str: 'BF3',        transform: [1, 0, 0, 1, 100, 560] },

      // Title block (no SKU positions)

      // Bottom elevation (around y=300)
      { str: 'BF3',        transform: [1, 0, 0, 1, 100, 320] },
      { str: 'B15-R',      transform: [1, 0, 0, 1, 200, 300] },
      { str: 'B30B',       transform: [1, 0, 0, 1, 280, 300] },
      { str: 'SB30B',      transform: [1, 0, 0, 1, 360, 300] },
      { str: 'DISHW18',    transform: [1, 0, 0, 1, 440, 300] },
      { str: 'DWR3',       transform: [1, 0, 0, 1, 500, 280] },
    ]);

    expect(counts['B15-R']).toBe(2);
  });

  it('promotes B15-R to qty 2 when AI returns qty=1 across multiple strip passes', () => {
    // Each strip pass sees only one of the two elevations → qty=1 each time.
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'B15-R', room: 'Kitchen', type: 'Base', quantity: 1 }],
      [{ sku: 'B15-R', room: 'Kitchen', type: 'Base', quantity: 1 }],
      [{ sku: 'B15-R', room: 'Kitchen', type: 'Base', quantity: 1 }],
    ], {
      'B15-R': 2,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].sku).toBe('B15-R');
    expect(merged[0].quantity).toBe(2);
  });

  it('promotes generic base SB30B repeated twice in the same way', () => {
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'SB30B', room: 'Kitchen', type: 'Base', quantity: 1 }],
      [{ sku: 'SB30B', room: 'Kitchen', type: 'Base', quantity: 1 }],
    ], {
      SB30B: 2,
    });

    expect(merged[0].quantity).toBe(2);
  });

  it('promotes a vanity V3321B that appears twice in two bath elevations', () => {
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'V3321B', room: 'Bath', type: 'Vanity', quantity: 1 }],
      [{ sku: 'V3321B', room: 'Bath', type: 'Vanity', quantity: 1 }],
    ], {
      V3321B: 2,
    });

    expect(merged[0].quantity).toBe(2);
  });

  it('does NOT inflate B15-R when the plan text only shows it once', () => {
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'B15-R', room: 'Kitchen', type: 'Base', quantity: 1 }],
      [{ sku: 'B15-R', room: 'Kitchen', type: 'Base', quantity: 1 }],
    ], {
      'B15-R': 1,
    });

    expect(merged[0].quantity).toBe(1);
  });

  it('does NOT promote past safety cap of 3 for B15-R', () => {
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'B15-R', room: 'Kitchen', type: 'Base', quantity: 1 }],
    ], {
      'B15-R': 7,
    });

    expect(merged[0].quantity).toBe(1);
  });
});
