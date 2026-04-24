import { describe, expect, it } from 'vitest';

import { extractPlanSkuCountsFromTextItems, mergePrefinalExtractionPasses } from '@/lib/prefinalCabinetMerge';

describe('B09FH filler-head detection (vanity-adjacent)', () => {
  it('extracts B09FH from PDF text items next to a V3021B vanity', () => {
    // Simulates a small bath elevation: V3021B vanity with a B09FH filler beside it
    const counts = extractPlanSkuCountsFromTextItems([
      { str: 'V3021B', transform: [1, 0, 0, 1, 100, 200] },
      { str: 'B09FH',  transform: [1, 0, 0, 1, 130, 200] },
      { str: 'BF3',    transform: [1, 0, 0, 1, 80,  200] },
    ]);

    expect(counts.V3021B).toBe(1);
    expect(counts.B09FH).toBe(1);
    expect(counts.BF3).toBe(1);
  });

  it('also extracts B06FH, B12FH, B15FH, B18FH variants', () => {
    const counts = extractPlanSkuCountsFromTextItems([
      { str: 'V3021B', transform: [1, 0, 0, 1, 100, 200] },
      { str: 'B06FH',  transform: [1, 0, 0, 1, 110, 210] },
      { str: 'B12FH',  transform: [1, 0, 0, 1, 120, 220] },
      { str: 'B15FH',  transform: [1, 0, 0, 1, 130, 230] },
      { str: 'B18FH',  transform: [1, 0, 0, 1, 140, 240] },
    ]);

    expect(counts.B06FH).toBe(1);
    expect(counts.B12FH).toBe(1);
    expect(counts.B15FH).toBe(1);
    expect(counts.B18FH).toBe(1);
  });

  it('preserves B09FH through the prefinal merge pipeline', () => {
    // Simulate one AI pass that found V3021B but missed B09FH,
    // and a second strip pass that did find B09FH.
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'V3021B', room: 'Bath', type: 'Vanity', quantity: 1 }],
      [
        { sku: 'V3021B', room: 'Bath', type: 'Vanity', quantity: 1 },
        { sku: 'B09FH',  room: 'Bath', type: 'Base',   quantity: 1 },
      ],
    ], {
      V3021B: 1,
      B09FH: 1,
    });

    const skus = merged.map((row) => row.sku);
    expect(skus).toContain('V3021B');
    expect(skus).toContain('B09FH');
    const b09fh = merged.find((row) => row.sku === 'B09FH');
    expect(b09fh?.room).toBe('Bath');
    expect(b09fh?.quantity).toBe(1);
  });

  it('keeps B09FH even when only one strip pass detected it (strong-pattern accept)', () => {
    // Even with only a single strip-pass support, multi-letter+digit SKUs like
    // B09FH should be accepted via the isStrongStripOnlySku branch.
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'V3021B', room: 'Bath', type: 'Vanity', quantity: 1 }],
      [
        { sku: 'V3021B', room: 'Bath', type: 'Vanity', quantity: 1 },
        { sku: 'B09FH',  room: 'Bath', type: 'Base',   quantity: 1 },
      ],
    ]);

    const skus = merged.map((row) => row.sku);
    expect(skus).toContain('B09FH');
  });
});
