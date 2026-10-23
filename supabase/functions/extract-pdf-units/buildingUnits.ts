// This helper only resolves evidence from one page; it never infers number sequences.
export function splitBuildingNames(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  const text = value.trim();
  const names = text.replace(/\b(?:BUILDINGS?|BLDGS?|BLD)\b\.?\s*:?/gi, '').trim()
    .split(/\s*(?:[,/&;]|\band\b)\s*/i).filter(Boolean);
  if (names.length < 2) return [text];
  return names.map(name => `Building ${name.trim()}`);
}

interface PageUnit {
  unitNumber?: string;
  unitNumbers?: string[];
  detectedBldg?: string | null;
  detectedType?: string | null;
  detectedFloor?: string | null;
  kitchenConfidence?: string;
}

export function expandPageBuildingUnits(units: PageUnit[], pageBuilding?: string | null) {
  return units.flatMap(unit => {
    const buildings = splitBuildingNames(unit.detectedBldg || pageBuilding);
    const numbers = (unit.unitNumbers?.length ? unit.unitNumbers : String(unit.unitNumber ?? '').split(/\s*[/,;\n]\s*/))
      .map(number => String(number).trim()).filter(Boolean);
    if (!numbers.length) return [];
    const { unitNumbers: _numbers, ...rest } = unit;
    if (buildings.length <= 1) {
      return numbers.map(unitNumber => ({ ...rest, unitNumber, detectedBldg: buildings[0] ?? null }));
    }
    // A single printed number on an explicitly shared typical plan applies to each building.
    if (numbers.length === 1) {
      return buildings.map(detectedBldg => ({ ...rest, unitNumber: numbers[0], detectedBldg }));
    }
    if (numbers.length === buildings.length) {
      return buildings.map((detectedBldg, index) => ({ ...rest, unitNumber: numbers[index], detectedBldg }));
    }
    // Unclear pairing must be reviewed, not silently guessed or discarded.
    return numbers.map(unitNumber => ({ ...rest, unitNumber, detectedBldg: null, kitchenConfidence: 'maybe' }));
  });
}