export function takeoffBuildingKey(value: string) {
  return String(value || '').toUpperCase().replace(/\b(?:BUILDINGS?|BLDGS?|BLD)\b\.?\s*:?/g, '').replace(/[^A-Z0-9]/g, '');
}

export function takeoffUnitKey(building: string, number: string, floor = '') {
  const floorKey = String(floor || '').toUpperCase().replace(/^(?:FLOOR|LEVEL)\s*/i, '').replace(/\s+/g, '');
  return `${takeoffBuildingKey(building)}__${String(number || '').trim().toUpperCase().replace(/\s+/g, '')}__${floorKey}`;
}