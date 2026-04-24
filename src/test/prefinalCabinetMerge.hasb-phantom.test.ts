// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { mergePrefinalExtractionPasses } from '@/lib/prefinalCabinetMerge';

describe('Phantom HA-prefix substring filter (HASB36B-REM vs SB36B-REM)', () => {
  it('drops phantom SB36B-REM when HASB36B-REM is also extracted and plan text only has HASB36B-REM', () => {
    // Strip A correctly read HASB36B-REM. Strip B misread the same label as
    // SB36B-REM (dropped the "HA" prefix). The plan text layer only contains
    // the full HASB36B-REM token, so the bare SB36B-REM is a phantom.
    const merged = mergePrefinalExtractionPasses(
      [
        [
          { sku: 'HASB36B-REM', room: 'Kitchen', type: 'Base', quantity: 1 },
          { sku: 'HAB30B', room: 'Kitchen', type: 'Base', quantity: 1 },
        ],
        [
          { sku: 'SB36B-REM', room: 'Kitchen', type: 'Base', quantity: 1 },
          { sku: 'HASB36B-REM', room: 'Kitchen', type: 'Base', quantity: 1 },
        ],
      ],
      {
        'HASB36B-REM': 1,
        HAB30B: 1,
      },
    );

    const skus = merged.map((row) => row.sku);
    expect(skus).toContain('HASB36B-REM');
    expect(skus).not.toContain('SB36B-REM');
    const hasb = merged.find((row) => row.sku === 'HASB36B-REM');
    expect(hasb?.quantity).toBe(1);
  });

  it('keeps SB36B-REM if the plan text layer independently confirms it', () => {
    const merged = mergePrefinalExtractionPasses(
      [
        [{ sku: 'HASB36B-REM', room: 'Kitchen', type: 'Base', quantity: 1 }],
        [{ sku: 'SB36B-REM', room: 'Kitchen', type: 'Base', quantity: 1 }],
      ],
      {
        'HASB36B-REM': 1,
        'SB36B-REM': 1,
      },
    );

    const skus = merged.map((row) => row.sku);
    expect(skus).toContain('HASB36B-REM');
    expect(skus).toContain('SB36B-REM');
  });

  it('does not drop B09FH just because some longer SKU happens to end in "FH"', () => {
    // B09FH is the full SKU, not a phantom suffix. Make sure the filter does
    // not accidentally remove valid filler-head bases.
    const merged = mergePrefinalExtractionPasses(
      [
        [
          { sku: 'V3021B', room: 'Bath', type: 'Vanity', quantity: 1 },
          { sku: 'B09FH', room: 'Bath', type: 'Base', quantity: 1 },
        ],
        [
          { sku: 'V3021B', room: 'Bath', type: 'Vanity', quantity: 1 },
          { sku: 'B09FH', room: 'Bath', type: 'Base', quantity: 1 },
        ],
      ],
      {
        V3021B: 1,
        B09FH: 1,
      },
    );

    const skus = merged.map((row) => row.sku);
    expect(skus).toContain('B09FH');
    expect(skus).toContain('V3021B');
  });

  it('does not drop UREP96 + REP96 false positive when only one is in text layer (REP96 is suffix of UREP96)', () => {
    // Defensive: if AI returns both UREP96 and REP96 with qty=1 and plan text
    // only has UREP96, the bare REP96 should be dropped as phantom. This
    // mirrors the same protection the edge function applies per-pass.
    const merged = mergePrefinalExtractionPasses(
      [
        [{ sku: 'UREP96', room: 'Kitchen', type: 'Accessory', quantity: 1 }],
        [{ sku: 'REP96', room: 'Kitchen', type: 'Accessory', quantity: 1 }],
      ],
      {
        UREP96: 1,
      },
    );

    const skus = merged.map((row) => row.sku);
    expect(skus).toContain('UREP96');
    expect(skus).not.toContain('REP96');
  });

  it('does not drop a phantom suffix when AI quantity is high (>1) — defer to AI confidence', () => {
    // Safety: if AI is very confident (qty 2+), do not silently drop.
    const merged = mergePrefinalExtractionPasses(
      [
        [{ sku: 'HASB36B-REM', room: 'Kitchen', type: 'Base', quantity: 1 }],
        [{ sku: 'SB36B-REM', room: 'Kitchen', type: 'Base', quantity: 2 }],
        [{ sku: 'SB36B-REM', room: 'Kitchen', type: 'Base', quantity: 2 }],
      ],
      {
        'HASB36B-REM': 1,
      },
    );

    const skus = merged.map((row) => row.sku);
    expect(skus).toContain('HASB36B-REM');
    expect(skus).toContain('SB36B-REM');
  });
});
