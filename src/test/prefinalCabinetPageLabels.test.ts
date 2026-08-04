// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { extractPrefinalCabinetPageLabelFromText, hasResidentialPrefinalUnitTypeHint, isGenericPrefinalCabinetPageLabel } from '@/lib/prefinalCabinetPageLabels';

describe('prefinal cabinet page label extraction', () => {
  it('extracts all 17 design/page labels from the uploaded floor-plan set text', () => {
    const pageTexts = [
      'KITCHEN MAIN FLOOR',
      'PANTRY MAIN FLOOR',
      'MAIN FLOOR GATHERING ROOM WET BAR BF334.5 SB27BD',
      'MAIN FLOOR MAIN LAUNDRY WASH.STD DRY.STD',
      "MAIN FLOOR DRESSING AREA OWNER'S BATH & TF384",
      'MAIN FLOOR POWDER BATH BF334.5 V362134.5BD',
      'MAIN FLOOR OFFICE BOOKCASE TBC309613 TF396',
      'MAIN FLOOR MUDROOM / DROP ZONE / LOCKERS W331213BD',
      'UPPER FLOOR UPPER LAUNDRY BF334.5 WF342',
      'BASEMENT FLOOR BASEMENT KITCHEN B42BD B36BD',
      'BASEMENT FLOOR POOL BATH V362134.5BD',
      'BUNKROOM BATH BASEMENT FLOOR V302134.5BD',
      'GUEST BATH BASEMENT FLOOR VDB182134.53',
      'UPPER FLOOR UPPER BATH 3 V4D542134.5BD',
      'UPPER FLOOR UPPER BATH 2.2 TF384',
      'UPPER FLOOR UPPER BATH 5 V4D722134.5BD',
      'UPPER BATH 2 UPPER FLOOR V4D722134.5BD',
    ];

    expect(pageTexts.map(extractPrefinalCabinetPageLabelFromText)).toEqual([
      'KITCHEN',
      'PANTRY',
      'GATHERING ROOM WET BAR',
      'MAIN LAUNDRY',
      "OWNER'S BATH & DRESSING AREA",
      'POWDER BATH',
      'OFFICE BOOKCASE',
      'MUDROOM / DROP ZONE / LOCKERS',
      'UPPER LAUNDRY',
      'BASEMENT KITCHEN',
      'POOL BATH',
      'BUNKROOM BATH',
      'GUEST BATH',
      'UPPER BATH 3',
      'UPPER BATH 2.2',
      'UPPER BATH 5',
      'UPPER BATH 2',
    ]);
  });

  it('treats floor names as generic but preserves residential unit type pages', () => {
    expect(isGenericPrefinalCabinetPageLabel('MAIN FLOOR')).toBe(true);
    expect(hasResidentialPrefinalUnitTypeHint('2BR TYPE B1 UNIT # 401')).toBe(true);
    expect(hasResidentialPrefinalUnitTypeHint('MAIN FLOOR GATHERING ROOM WET BAR')).toBe(false);
  });

  it('keeps full bath and lower-level bar labels from the attached floor plan text', () => {
    expect(extractPrefinalCabinetPageLabelFromText('MAIN FLOOR BF3 VSB24 V1221L MASTER BATH 3DB1221D')).toBe('MASTER BATH');
    expect(extractPrefinalCabinetPageLabelFromText('MAIN FLOOR OFFICE BATH V1521R VSB33 V1521L TOIL.STD BF3')).toBe('OFFICE BATH');
    expect(extractPrefinalCabinetPageLabelFromText('LOWER FLOOR TOIL.STD LOWER LEVEL BATH VSB42 BF3')).toBe('LOWER LEVEL BATH');
    expect(extractPrefinalCabinetPageLabelFromText('LOWER FLOOR BMC24 B33 BF3 LOWER LEVEL BAR DWR3 SB33')).toBe('LOWER LEVEL BAR');
  });

  it('keeps every uploaded room page independent, including abbreviated bath titles', () => {
    expect(extractPrefinalCabinetPageLabelFromText('MASTER BATH OC339624')).toBe('MASTER BATH');
    expect(extractPrefinalCabinetPageLabelFromText('M BATH OC339624')).toBe('MASTER BATH');
    expect(extractPrefinalCabinetPageLabelFromText('POWDER ROOM (PWD) VSB21')).toBe('POWDER ROOM');
    expect(extractPrefinalCabinetPageLabelFromText('BATH #1 VSB21')).toBe('BATH #1');
    expect(extractPrefinalCabinetPageLabelFromText("BUTLER'S PANTRY DWR3")).toBe("BUTLER'S PANTRY");
    expect(extractPrefinalCabinetPageLabelFromText('MUDROOM - LAUNDRY OC339624')).toBe('MUDROOM - LAUNDRY');
  });
});