import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { splitGluedPrefinalSkus, lockPrefinalItemsToPlanText } from '@/lib/prefinalCabinetMerge';

const PAGE = 'A3-11 Unit-A2 TF390 TP249024 PFTE390 W153612R W093612R W243612 W123612LW243612 3DB12B09-R VSB27 V3D15 BF330 WF336 SB33 WR361824 HOOD30-3 DISHW24';
const skus = (items: { sku?: string }[]) => items.map((i) => i.sku).sort();

describe('prefinal labels locked to the plan text', () => {
  it('splits a filler glued to a tall cabinet', () => {
    expect(splitGluedPrefinalSkus('TF390P249024')).toEqual(['TF390', 'P249024']);
    expect(splitGluedPrefinalSkus('TF390TP249024')).toEqual(['TF390', 'TP249024']);
  });
  it('splits labels joined by a dot', () => {
    expect(splitGluedPrefinalSkus('TF2490.TF390')).toEqual(['TF2490', 'TF390']);
  });
  it('snaps a split tall label to the printed TP249024', () => {
    expect(skus(lockPrefinalItemsToPlanText([{ sku: 'TF390P249024', room: 'Kitchen', quantity: 1 }], PAGE))).toEqual(['TF390', 'TP249024']);
  });
  it('drops made-up labels not printed on the page', () => {
    const out = lockPrefinalItemsToPlanText([
      { sku: 'W12', room: 'Kitchen', quantity: 1 },
      { sku: 'W18', room: 'Kitchen', quantity: 1 },
      { sku: 'TF2490.TF390', room: 'Kitchen', quantity: 1 },
      { sku: 'W243612', room: 'Kitchen', quantity: 1 },
    ], PAGE);
    expect(skus(out)).toEqual(['TF390', 'W243612']);
  });
  it('snaps a truncated label only when one printed label fits', () => {
    expect(skus(lockPrefinalItemsToPlanText([{ sku: 'W12361', room: 'Kitchen', quantity: 1 }], PAGE))).toEqual(['W123612L']);
  });
  it('keeps 3-drawer bases and added accessories', () => {
    const out = lockPrefinalItemsToPlanText([
      { sku: '3DB12', room: 'Kitchen', quantity: 1 },
      { sku: 'TK8', room: 'Kitchen', quantity: 2 },
    ], PAGE);
    expect(skus(out)).toEqual(['3DB12', 'TK8']);
  });
});
