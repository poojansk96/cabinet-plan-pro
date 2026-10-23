export function takeoffBuildingKey(value: string) {
  return String(value || '').toUpperCase().replace(/\b(?:BUILDINGS?|BLDGS?|BLD)\b\.?\s*:?/g, '').replace(/[^A-Z0-9]/g, '');
}

export function takeoffUnitKey(building: string, number: string) {
  return `${takeoffBuildingKey(building)}__${String(number || '').trim().toUpperCase().replace(/\s+/g, '')}`;
}