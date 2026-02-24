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
  doorStyle?: string;
  hinges?: string;
  drawerBox?: string;
  drawerGuides?: string;
  countertops?: string;
  vanityCountertops?: string;
  handlesAndHardware?: string;
  tax?: string;
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
