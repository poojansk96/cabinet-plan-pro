export function takeoffBuildingKey(value: string) {
  return String(value || '').toUpperCase().replace(/\b(?:BUILDINGS?|BLDGS?|BLD)\b\.?\s*:?/g, '').replace(/[^A-Z0-9]/g, '');
}

// A unit number never repeats within one building: a number seen on two floors is one
// (e.g. two-storey townhouse) unit, so floor is intentionally not part of the identity.
export function takeoffUnitKey(building: string, number: string, _floor = '') {
  return `${takeoffBuildingKey(building)}__${String(number || '').trim().toUpperCase().replace(/\s+/g, '')}`;
}

export const TAKEOFF_DUP_FLAG = 'CHECK: repeated unit #';