import type { Cabinet, CountertopSection, Unit, Project, ProjectSummary, CabinetSummary } from '@/types/project';

// Countertop square footage calculation
export function calcCountertopSqft(ct: CountertopSection): number {
  const effectiveDepth = ct.depth + (ct.splashHeight ?? 0);
  const raw = (ct.length * effectiveDepth) / 144;
  const withWaste = ct.addWaste ? raw * 1.03 : raw;
  // Round to nearest 0.5
  return Math.ceil(withWaste * 2) / 2;
}

export function calcUnitCountertopTotal(unit: Unit): number {
  return unit.countertops.reduce((sum, ct) => sum + calcCountertopSqft(ct), 0);
}

export function calcUnitCabinetTotals(unit: Unit) {
  const totals = { base: 0, wall: 0, tall: 0, vanity: 0, total: 0 };
  unit.cabinets.forEach(c => {
    totals.total += c.quantity;
    if (c.type === 'Base') totals.base += c.quantity;
    else if (c.type === 'Wall') totals.wall += c.quantity;
    else if (c.type === 'Tall') totals.tall += c.quantity;
    else if (c.type === 'Vanity') totals.vanity += c.quantity;
  });
  return totals;
}

export function buildSkuSummary(cabinets: Cabinet[]): CabinetSummary[] {
  const map = new Map<string, CabinetSummary>();
  cabinets.forEach(c => {
    const key = `${c.sku}|${c.width}|${c.height}|${c.depth}`;
    if (map.has(key)) {
      const existing = map.get(key)!;
      existing.totalQty += c.quantity;
      if (!existing.rooms.includes(c.room)) existing.rooms.push(c.room);
    } else {
      map.set(key, {
        sku: c.sku,
        type: c.type,
        width: c.width,
        height: c.height,
        depth: c.depth,
        totalQty: c.quantity,
        rooms: [c.room],
      });
    }
  });
  return Array.from(map.values()).sort((a, b) => a.sku.localeCompare(b.sku));
}

export function calcProjectSummary(project: Project): ProjectSummary {
  const unitsByType: Record<string, number> = {};
  let totalCabinets = 0, totalBase = 0, totalWall = 0, totalTall = 0, totalVanity = 0;
  let totalCountertopSqft = 0;
  const allCabinets: Cabinet[] = [];
  const accessorySummary = {
    totalFillers: 0,
    totalPanels: 0,
    totalToeKickLF: 0,
    totalCrownLF: 0,
    totalLightRailLF: 0,
    totalHardware: 0,
  };

  project.units.forEach(unit => {
    unitsByType[unit.type] = (unitsByType[unit.type] || 0) + 1;
    const ct = calcUnitCabinetTotals(unit);
    totalCabinets += ct.total;
    totalBase += ct.base;
    totalWall += ct.wall;
    totalTall += ct.tall;
    totalVanity += ct.vanity;
    totalCountertopSqft += calcUnitCountertopTotal(unit);
    allCabinets.push(...unit.cabinets);

    unit.accessories.forEach(acc => {
      if (acc.type === 'Filler') accessorySummary.totalFillers += acc.quantity;
      else if (acc.type === 'Finished Panel') accessorySummary.totalPanels += acc.quantity;
      else if (acc.type === 'Toe Kick') accessorySummary.totalToeKickLF += (acc.linearFeet || 0) * acc.quantity;
      else if (acc.type === 'Crown Molding') accessorySummary.totalCrownLF += (acc.linearFeet || 0) * acc.quantity;
      else if (acc.type === 'Light Rail') accessorySummary.totalLightRailLF += (acc.linearFeet || 0) * acc.quantity;
      else if (acc.type === 'Hardware') accessorySummary.totalHardware += acc.quantity;
    });
  });

  return {
    totalUnits: project.units.length,
    unitsByType,
    totalCabinets,
    totalBase,
    totalWall,
    totalTall,
    totalVanity,
    skuSummary: buildSkuSummary(allCabinets),
    totalCountertopSqft: Math.ceil(totalCountertopSqft * 2) / 2,
    accessorySummary,
  };
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}
