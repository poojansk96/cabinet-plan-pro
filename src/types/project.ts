export type ProjectType = 'Residential' | 'Commercial';
export type UnitType = 'Studio' | '1BHK' | '2BHK' | '3BHK' | '4BHK' | 'Townhouse' | 'Condo' | 'Other' | string;
export type CabinetType = 'Base' | 'Wall' | 'Tall' | 'Vanity';
export type Room = 'Kitchen' | 'Pantry' | 'Laundry' | 'Bath' | 'Other';
export type AccessoryType =
  | 'Filler'
  | 'Finished Panel'
  | 'Toe Kick'
  | 'Crown Molding'
  | 'Light Rail'
  | 'Hardware'
  | 'Other';

export interface Cabinet {
  id: string;
  room: Room;
  type: CabinetType;
  sku: string;
  width: number;        // inches
  height: number;       // inches
  depth: number;        // inches
  quantity: number;
  notes?: string;
}

export interface Accessory {
  id: string;
  type: AccessoryType;
  description: string;
  width?: number;       // inches (fillers, panels)
  height?: number;      // inches (panels)
  linearFeet?: number;  // (molding, rail, toe kick)
  quantity: number;
  notes?: string;
}

export interface CountertopSection {
  id: string;
  label: string;
  length: number;       // inches
  depth: number;        // inches (default 25.5)
  splashHeight?: number;  // inches (optional backsplash height)
  sideSplash?: number;    // inches (optional sidesplash)
  isIsland: boolean;
  addWaste: boolean;    // 5% waste
}

export interface Unit {
  id: string;
  unitNumber: string;
  type: UnitType;
  bldg?: string;
  floor?: string;
  cabinets: Cabinet[];
  accessories: Accessory[];
  countertops: CountertopSection[];
  notes?: string;
}

export interface ProjectSpecs {
  projectSuper?: string;
  customer?: string;
  takeoffPerson?: string;
  doorStyle?: string;
  doorStyleCustom?: string;
  doorStyleStyle?: string;
  doorStyleStyleCustom?: string;
  doorStyleConstruction?: string;
  doorStyleSeries?: string;
  doorStyleFraming?: string;
  doorStyleName?: string;
  doorStyleNameCustom?: string;
  doorStyleFinish?: string;
  doorStyleFinishColor?: string;
  doorStyleFinishColorCustom?: string;
  hinges?: string;
  hingesCustom?: string;
  drawerBox?: string;
  drawerGuides?: string;
  drawerGuidesCustom?: string;
  countertops?: string;
  countertopManufacturer?: string;
  countertopManufacturerCustom?: string;
  countertopColor?: string;
  countertopColorCustom?: string;
  laminateSubstrate?: string;
  laminateSubstrateCustom?: string;
  laminateColor?: string;
  laminateColorCustom?: string;
  vanityCountertops?: string;
  vanityManufacturer?: string;
  vanityManufacturerCustom?: string;
  vanityColor?: string;
  vanityColorCustom?: string;
  vanityLaminateSubstrate?: string;
  vanityLaminateSubstrateCustom?: string;
  vanityLaminateColor?: string;
  vanityLaminateColorCustom?: string;
  vanityBowlStyle?: string;
  vanityBowlStyleCustom?: string;
  vanityCMColor?: string;
  vanityCMColorCustom?: string;
  vanitySameAsKitchen?: string | boolean;
  additionalTopsEnabled?: string | boolean;
  additionalTopsLabel?: string;
  additionalTops?: string;
  additionalTopsManufacturer?: string;
  additionalTopsManufacturerCustom?: string;
  additionalTopsColor?: string;
  additionalTopsColorCustom?: string;
  additionalTopsLaminateSubstrate?: string;
  additionalTopsLaminateSubstrateCustom?: string;
  additionalTopsLaminateColor?: string;
  additionalTopsLaminateColorCustom?: string;
  handlesAndHardware?: string;
  handlesCustom?: string;
  tax?: string;
  taxCustom?: string;
  [key: string]: string | boolean | undefined;
}

export interface Project {
  id: string;
  name: string;
  address: string;
  type: ProjectType;
  notes?: string;
  specs?: ProjectSpecs;
  units: Unit[];
  createdAt: string;
  updatedAt: string;
}

// Calculated types
export interface CabinetSummary {
  sku: string;
  type: CabinetType;
  width: number;
  height: number;
  depth: number;
  totalQty: number;
  rooms: string[];
}

export interface ProjectSummary {
  totalUnits: number;
  unitsByType: Record<string, number>;
  totalCabinets: number;
  totalBase: number;
  totalWall: number;
  totalTall: number;
  totalVanity: number;
  skuSummary: CabinetSummary[];
  totalCountertopSqft: number;
  accessorySummary: {
    totalFillers: number;
    totalPanels: number;
    totalToeKickLF: number;
    totalCrownLF: number;
    totalLightRailLF: number;
    totalHardware: number;
  };
}
