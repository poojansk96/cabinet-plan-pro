// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { extractPlanSkuCountsFromTextItems, mergePrefinalExtractionPasses } from '@/lib/prefinalCabinetMerge';

describe('W1530-L repeated-label undercount (Type 2 BR-C, One Post Road)', () => {
  it('extracts BOTH W1530-L labels from the plan text layer (vertical column)', () => {
    // Two W1530-L labels appear in the same tall vertical column on the plan,
    // separated vertically (one near y=420, one near y=200). They should both
    // be picked up by the primary cluster (everything else is in the same
    // column too).
    const counts = extractPlanSkuCountsFromTextItems([
      { str: 'W2730B',    transform: [1, 0, 0, 1, 100, 480] },
      { str: 'B27B',      transform: [1, 0, 0, 1, 100, 460] },
      { str: 'W1530-L',   transform: [1, 0, 0, 1, 100, 420] },
      { str: 'DB15',      transform: [1, 0, 0, 1, 100, 400] },
      { str: 'W3015B',    transform: [1, 0, 0, 1, 100, 320] },
      { str: 'W1530-L',   transform: [1, 0, 0, 1, 100, 200] },
      { str: 'BF6',       transform: [1, 0, 0, 1, 100, 180] },
    ]);

    expect(counts['W1530-L']).toBe(2);
  });

  it('promotes merged qty to the plan-text count (2) when AI returns only qty=1 across passes', () => {
    // Simulate the real failure: the AI sees "W1530-L" on multiple strip
    // passes but always reports qty=1 (it does not realize the same label is
    // drawn twice in different rooms of the same column). The plan text layer
    // correctly shows it twice — we should trust the text and promote to 2.
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'W1530-L', room: 'Kitchen', type: 'Wall', quantity: 1 }],
      [{ sku: 'W1530-L', room: 'Kitchen', type: 'Wall', quantity: 1 }],
      [{ sku: 'W1530-L', room: 'Kitchen', type: 'Wall', quantity: 1 }],
    ], {
      'W1530-L': 2,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].sku).toBe('W1530-L');
    expect(merged[0].quantity).toBe(2);
  });

  it('promotes when only one strip pass detected the SKU (support = 1)', () => {
    const merged = mergePrefinalExtractionPasses([
      [],
      [{ sku: 'W1530-L', room: 'Kitchen', type: 'Wall', quantity: 1 }],
    ], {
      'W1530-L': 2,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(2);
  });

  it('does NOT promote past planTextCount=4 (safety cap)', () => {
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'W1530-L', room: 'Kitchen', type: 'Wall', quantity: 1 }],
    ], {
      'W1530-L': 8,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(1);
  });

  it('does NOT promote when AI quantity is already higher than plan text (cap-down still wins)', () => {
    const merged = mergePrefinalExtractionPasses([
      [{ sku: 'W1530-L', room: 'Kitchen', type: 'Wall', quantity: 2 }],
    ], {
      'W1530-L': 1,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(1);
  });

  it('does NOT inflate single-pass hallucinations (no AI support → no promote)', () => {
    // No AI pass detected the SKU at all → it never reaches the merge map,
    // so there is nothing to promote. Plan text alone never seeds rows.
    const merged = mergePrefinalExtractionPasses([
      [],
      [],
    ], {
      'W1530-L': 2,
    });

    expect(merged).toHaveLength(0);
  });
});
