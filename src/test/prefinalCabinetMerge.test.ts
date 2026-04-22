import { describe, expect, it } from 'vitest';

import { extractPlanSkuCountsFromTextItems, mergePrefinalExtractionPasses } from '@/lib/prefinalCabinetMerge';

function classifyPrefinalCabinetSku(value: string): string {
  const sku = String(value || '')
    .toUpperCase()
    .trim()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '');
  if (!sku) return 'Base';
  if (/^(BLW|BRW)/i.test(sku)) return 'Wall';
  if (/^(W|WDC|UB|WC|OH)\d/i.test(sku)) return 'Wall';
  if (/^(HAW|HAWDC)\d/i.test(sku)) return 'Wall';
  if (/^HCW\d/i.test(sku)) return 'Wall';
  if (/^HW\d/i.test(sku)) return 'Wall';
  if (/^(T|UT|TC|PT|PTC|UC)(\d|$)/i.test(sku)) return 'Tall';
  if (/^(HALC|HAUC|HCUC|HCYC)\d/i.test(sku)) return 'Tall';
  if (/^(V|VB|VD|VDB|VDC)\d/i.test(sku)) return 'Vanity';
  if (/^(HAV|HAVDB)\d/i.test(sku)) return 'Vanity';
  if (/^(BP|SCRIBE)$/i.test(sku)) return 'Accessory';
  if (/^(FIL|BF|WF|BFFIL|WFFIL|TK|TKRUN|CM|LR|EP|FP|DWR|TF|APPRON|UREP|REP)\d/i.test(sku)) return 'Accessory';
  if (/^(HAB|HADB|HAOC|HASB|HACB|HAEB|HALS|HALSB|HCDB|HCLS|HWSB|HWS)\d/i.test(sku)) return 'Base';
  return 'Base';
}

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

  it('counts BLB and HABLB labels from plan text items', () => {
    const counts = extractPlanSkuCountsFromTextItems([
      { str: 'BLB42/45FH-R', transform: [1, 0, 0, 1, 320, 420] },
      { str: 'HABLB42/45FH-R', transform: [1, 0, 0, 1, 360, 425] },
      { str: 'BLB42/45FH-R', transform: [1, 0, 0, 1, 400, 430] },
    ]);

    expect(counts['BLB42/45FH-R']).toBe(2);
    expect(counts['HABLB42/45FH-R']).toBe(1);
  });

  it('extracts VDB15 vanity drawer-base SKU from text items (regression)', () => {
    const counts = extractPlanSkuCountsFromTextItems([
      { str: 'V3021B', transform: [1, 0, 0, 1, 320, 420] },
      { str: 'VDB15', transform: [1, 0, 0, 1, 360, 410] },
      { str: 'BF3', transform: [1, 0, 0, 1, 380, 405] },
    ]);

    expect(counts.V3021B).toBe(1);
    expect(counts.VDB15).toBe(1);
  });

  it('classifies VDB15 under vanity, not base', () => {
    expect(classifyPrefinalCabinetSku('VDB15')).toBe('Vanity');
  });
});

describe('BLW height parsing for sorting', () => {
  // Mirror the parseSkuDims used in PreFinalModule/PreFinalSummaryModule
  function parseSkuDims(sku: string): { width: number; height: number } {
    const cleaned = sku.replace(/\s/g, '').toUpperCase();
    const blwMatch = cleaned.match(/^(?:HA)?(?:BLW|BRW|BLB)(\d+)\/(\d+)/);
    if (blwMatch) {
      const width = Number(blwMatch[1]);
      const second = blwMatch[2];
      const height = second.length >= 2 ? Number(second.slice(-2)) : Number(second);
      return { width, height };
    }
    const match = cleaned.match(/^[A-Z]+(\d+)/);
    if (!match) return { width: 0, height: 0 };
    const digits = match[1];
    if (digits.length === 4) return { width: Number(digits.slice(0, 2)), height: Number(digits.slice(2, 4)) };
    if (digits.length === 3) return { width: Number(digits.slice(0, 1)), height: Number(digits.slice(1, 3)) };
    if (digits.length === 2) return { width: Number(digits), height: 0 };
    return { width: Number(digits), height: 0 };
  }

  it('parses BLW27/3030-L as height 30 (not 0)', () => {
    expect(parseSkuDims('BLW27/3030-L').height).toBe(30);
    expect(parseSkuDims('BLW27/3030-L').width).toBe(27);
  });

  it('parses BLW27/3036-L as height 36', () => {
    expect(parseSkuDims('BLW27/3036-L').height).toBe(36);
  });

  it('parses HABLB42/4530-R as height 30', () => {
    expect(parseSkuDims('HABLB42/4530-R').height).toBe(30);
    expect(parseSkuDims('HABLB42/4530-R').width).toBe(42);
  });

  it('sorts BLW after W cabinets at the same height', () => {
    const skus = ['W3018B', 'W2430', 'W3030', 'BLW27/3030-L', 'W1542', 'BLW27/3036-L'];
    const sorted = [...skus].sort((a, b) => {
      const da = parseSkuDims(a), db = parseSkuDims(b);
      if (da.height !== db.height) return da.height - db.height;
      const isBLW = (s: string) => /^(?:HA)?(?:BLW|BRW|BLB)/i.test(s);
      const pa = isBLW(a) ? 1 : 0, pb = isBLW(b) ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return da.width - db.width;
    });
    // Expected: W3018B(h18), W2430(h30), W3030(h30), BLW27/3030-L(h30), BLW27/3036-L(h36), W1542(h42)
    expect(sorted.indexOf('BLW27/3030-L')).toBeGreaterThan(sorted.indexOf('W3030'));
    expect(sorted.indexOf('BLW27/3030-L')).toBeGreaterThan(sorted.indexOf('W2430'));
    expect(sorted.indexOf('BLW27/3036-L')).toBeGreaterThan(sorted.indexOf('BLW27/3030-L'));
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

  it('caps down AI quantity to text layer count when AI hallucinates extra', () => {
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'W3018X24B', room: 'Kitchen', type: 'Wall', quantity: 1 }],
      [{ sku: 'W3018X24B', room: 'Kitchen', type: 'Wall', quantity: 2 }],
      [{ sku: 'W3018X24B', room: 'Kitchen', type: 'Wall', quantity: 1 }],
    ], {
      W3018X24B: 1,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(1);
  });

  it('collapses ambiguous UC left/right variants into one hidden-label base row', () => {
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'UC18X84-L', room: 'Kitchen', type: 'Tall', quantity: 1 }],
      [{ sku: 'UC18X84-R', room: 'Kitchen', type: 'Tall', quantity: 1 }],
      [{ sku: 'UC18X84-L', room: 'Kitchen', type: 'Tall', quantity: 1 }],
    ], {
      UC18X84: 1,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].sku).toBe('UC18X84-');
    expect(merged[0].quantity).toBe(1);
  });

  it('does not turn a single vanity label into qty 2 when text layer shows only one', () => {
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'V3021', room: 'Bath', type: 'Vanity', quantity: 1 }],
      [{ sku: 'V3021', room: 'Bath', type: 'Vanity', quantity: 1 }],
      [{ sku: 'V3021', room: 'Bath', type: 'Vanity', quantity: 1 }],
    ], {
      V3021: 1,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(1);
  });
});