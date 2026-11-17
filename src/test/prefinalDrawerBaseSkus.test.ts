import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { collectPlanTextSkuTokens, extractSkuMatches, lockPrefinalItemsToPlanText, splitGluedPrefinalSkus } from '@/lib/prefinalCabinetMerge';

describe('Prefinal 3-drawer bases (3DB12) and WR wall cabinets', () => {
  it('3DB12 is read from the plan text as its own SKU', () => {
    expect(extractSkuMatches('DISHW24 3DB12 W3030')).toContain('3DB12');
  });
  it('WR361824 is read from the plan text', () => {
    expect(extractSkuMatches('W3030 WR361824 B24')).toContain('WR361824');
  });
  it('a drawer base glued after another label splits off', () => {
    expect(splitGluedPrefinalSkus('B12-R3DB12')).toEqual(['B12-R', '3DB12']);
    expect(splitGluedPrefinalSkus('3DB12B09-R')).toEqual(['3DB12', 'B09-R']);
    expect(splitGluedPrefinalSkus('3DB21')).toEqual(['3DB21']);
  });
  it('the text-layer lock keeps 3DB12 and WR361824 instead of dropping them', () => {
    const page = 'B12-R3DB12 WR361824 W3030 SB36 B24';
    const out = lockPrefinalItemsToPlanText([
      { sku: '3DB12', type: 'Base', room: 'Kitchen', quantity: 1 },
      { sku: 'WR361824', type: 'Wall', room: 'Kitchen', quantity: 1 },
    ] as any, page).map(i => i.sku);
    expect(out).toEqual(['3DB12', 'WR361824']);
  });
  const pages: Record<number, string[]> = { 12: ['3DB12', '3DB21', 'WR361824'], 14: ['3DB12', 'WR361824'], 18: ['3DB12', 'WR361824'] };
  for (const [p, skus] of Object.entries(pages)) {
    const f = `/tmp/cc_p${p}.txt`;
    it.skipIf(!existsSync(f))(`Coconut Creek page ${p} text layer has ${skus.join(', ')}`, () => {
      const tokens = collectPlanTextSkuTokens(readFileSync(f, 'utf8'));
      for (const s of skus) expect(tokens.has(s)).toBe(true);
    });
  }
});
