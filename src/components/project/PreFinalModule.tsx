import React, { useState, useMemo } from 'react';
import { FileUp, Users, LayoutGrid, Plus, Trash2, RotateCcw, Pencil, Square, Layers, ChevronDown, ChevronRight, Info } from 'lucide-react';
import type { Project, Unit, Cabinet } from '@/types/project';
import { type LabelRow } from './ShopDrawingImportDialog';
import ShopDrawingImportDialog from './ShopDrawingImportDialog';
import UnitTypeImportDialog from './UnitTypeImportDialog';
import StonePDFImportDialog, { type StoneExtractedRow } from './StonePDFImportDialog';
import VtopPDFImportDialog, { type VtopImportRow, formatVtopSku, getVtopSidesplashItems } from './VtopPDFImportDialog';
import { usePrefinalStore, type PrefinalStoneRow, type PrefinalVtopRow } from '@/hooks/usePrefinalStore';

interface Props {
  project: Project;
  selectedUnit?: Unit;
  selectedUnitId?: string | null;
  setSelectedUnitId?: (id: string) => void;
  addCabinet: (projectId: string, unitId: string, data: Omit<Cabinet, 'id'>) => Cabinet;
  updateCabinet: (projectId: string, unitId: string, cabinetId: string, data: Partial<Cabinet>) => void;
  deleteCabinet: (projectId: string, unitId: string, cabinetId: string) => void;
  section?: 'units' | 'cabinets' | 'mismatch';
  showMismatchToggle?: boolean;
  [key: string]: unknown;
}

function normalizeUnitType(raw: string): string {
  let s = raw.trim();
  // Preserve full type name including bedroom prefixes (e.g., "3BR TYPE C-MIRROR")
  s = s.replace(/\s*-\s*/g, '-');
  s = s.toUpperCase();
  return s;
}

function ProviderToggle({ value, onChange }: { value: 'gemini' | 'dialagram'; onChange: (v: 'gemini' | 'dialagram') => void }) {
  return (
    <div className="inline-flex items-center rounded border border-border overflow-hidden text-[10px] font-medium" title="AI Provider">
      <button
        type="button"
        onClick={() => onChange('gemini')}
        className={`px-2 py-1 transition-colors ${value === 'gemini' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-secondary'}`}
      >
        Gemini
      </button>
      <button
        type="button"
        onClick={() => onChange('dialagram')}
        className={`px-2 py-1 transition-colors ${value === 'dialagram' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-secondary'}`}
      >
        Qwen
      </button>
    </div>
  );
}

export default function PreFinalModule({ project }: Props) {
  const store = usePrefinalStore(project.id);
  const [activeSubTab, setActiveSubTab] = useState<'units' | 'cabinets' | 'stone' | 'laminate' | 'cmarble'>('units');

  // ── Unit Count state ──────────────────────────────────────────────────────
  const [showUnitImport, setShowUnitImport] = useState(false);
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [newUnitType, setNewUnitType] = useState('');
  const [newUnitNumber, setNewUnitNumber] = useState('');
  const [showAddUnitNumber, setShowAddUnitNumber] = useState(false);
  const [editingType, setEditingType] = useState<string | null>(null);
  const [editingTypeValue, setEditingTypeValue] = useState('');
  const [unitImportedCount, setUnitImportedCount] = useState<number | null>(null);

  // ── Cabinet Count state ───────────────────────────────────────────────────
  const [showCabinetImport, setShowCabinetImport] = useState(false);
  const [importTargetType, setImportTargetType] = useState('');
  const [cabinetImportedCount, setCabinetImportedCount] = useState<number | null>(null);
  const [cabinetChecks, setCabinetChecks] = useState<Record<string, boolean>>({});
  const [cabinetAiModel, setCabinetAiModel] = useState<'fast' | 'accu'>('fast');
  // AI provider toggles — Gemini default; Qwen (dialagram, qwen-3.6-plus) optional
  const [unitAiProvider, setUnitAiProvider] = useState<'gemini' | 'dialagram'>('gemini');
  const [cabinetAiProvider, setCabinetAiProvider] = useState<'gemini' | 'dialagram'>('gemini');
  // Stone/Laminate/Vtop AI provider — Qwen (dialagram) is now the default for Stone SQFT
  // because it handles dense 2020 shop-drawing dimension text more reliably than Gemini.
  const [stoneAiProvider, setStoneAiProvider] = useState<'gemini' | 'dialagram'>('dialagram');
  const [vtopAiProvider, setVtopAiProvider] = useState<'gemini' | 'dialagram'>('dialagram');

  // ── Stone SQFT state ──────────────────────────────────────────────────
  const [showStoneImport, setShowStoneImport] = useState(false);
  const [stoneImportedCount, setStoneImportedCount] = useState<number | null>(null);
  const [expandedStoneTypes, setExpandedStoneTypes] = useState<Record<string, boolean>>({});

  // ── Laminate LFT state ──────────────────────────────────────────────────
  const [showLaminateImport, setShowLaminateImport] = useState(false);
  const [laminateImportedCount, setLaminateImportedCount] = useState<number | null>(null);

  // ── Cmarble/Swan Vtop state ──────────────────────────────────────────────
  const [showVtopImport, setShowVtopImport] = useState(false);
  const [vtopImportedCount, setVtopImportedCount] = useState<number | null>(null);

  // ── Unit import handler ───────────────────────────────────────────────────
  const handleUnitImport = (rows: { unitNumber: string; unitType: string; bldg: string }[], typeOrder?: string[]) => {
    const normalized = rows.map(r => ({ ...r, unitType: normalizeUnitType(r.unitType) }));
    // Use PDF page order if provided, otherwise fall back to Set insertion order
    const normalizedOrder = typeOrder?.map(t => normalizeUnitType(t)) ?? [];
    const orderedTypes = normalizedOrder.length > 0
      ? normalizedOrder.filter((t, i, arr) => arr.indexOf(t) === i) // deduplicate preserving order
      : Array.from(new Set(normalized.map(r => r.unitType)));
    // Add any types from rows that weren't in the order list
    const remaining = Array.from(new Set(normalized.map(r => r.unitType))).filter(t => !orderedTypes.includes(t));
    const finalTypes = [...orderedTypes, ...remaining];
    store.addUnitTypes(finalTypes);
    store.importUnitMappings(normalized);
    setUnitImportedCount(normalized.length);
    setTimeout(() => setUnitImportedCount(null), 4000);
  };

  // ── Cabinet import handler ────────────────────────────────────────────────
  const handleCabinetImport = (rows: Omit<LabelRow, 'selected' | 'sourceFile'>[], detectedUnitType?: string, importTypeOrder?: string[]) => {
    const toTypeKey = (value: string) =>
      String(value || '')
        .toUpperCase()
        .trim()
        .replace(/^TYPE\s+/, '')
        .replace(/[^A-Z0-9]/g, '');

    // IMPORTANT: cabinet import replaces cabinet data, so only map against Unit Count types.
    // Never reuse previous cabinet-only types from older imports.
    const knownTypes = [...store.unitTypes];
    const resolveKnownType = (raw: string): string => {
      const key = toTypeKey(raw);
      if (!key) return '';

      const exact = knownTypes.find(t => toTypeKey(t) === key);
      return exact || '';
    };


    const rowsByType = new Map<string, typeof rows>();
    // Clear all existing cabinet data before importing fresh
    store.clearCabinets();

    // Track order of types as they appear (PDF page order)
    const orderedTypes: string[] = [];

    for (const row of rows) {
      const rawType = (row as any).detectedUnitType || detectedUnitType || '';
      const normalizedIncoming = rawType ? normalizeUnitType(rawType) : '';
      const incomingKey = toTypeKey(normalizedIncoming);
      const knownResolved = resolveKnownType(rawType) || resolveKnownType(normalizedIncoming);

      // Only promote detected types that have structural validity (bedroom prefix, TYPE keyword, or underscore compound)
      // This prevents AI hallucinations like "2BR-C" when no such type exists in unit count or PDF text
      const hasStructure = /\b(\d+BR|STUDIO)\b/i.test(normalizedIncoming) ||
        /\bTYPE\b/i.test(normalizedIncoming) ||
        /_/.test(normalizedIncoming) ||
        /\bKITCHENETTE\b/i.test(normalizedIncoming);
      const canPromoteIncomingType = Boolean(incomingKey) && hasStructure;

      const finalType = knownResolved || (canPromoteIncomingType ? normalizedIncoming : 'Unassigned');

      if (!rowsByType.has(finalType)) rowsByType.set(finalType, []);
      rowsByType.get(finalType)!.push(row);
      if (!orderedTypes.includes(finalType)) orderedTypes.push(finalType);
    }

    // ── STRICT PDF PAGE ORDER ──────────────────────────────────────────────
    // The dialog provides `importTypeOrder` built page-by-page in PDF order.
    // That MUST be the single source of truth for column order. Row iteration order
    // (which is sorted by SKU/room priority in the dialog's mergeRows) must NEVER
    // influence column order, otherwise small SKU sort differences can swap two
    // adjacent type columns.
    if (importTypeOrder && importTypeOrder.length > 0) {
      // 1) Resolve each page-order type against known Unit Count types (preserves casing).
      const normalizedOrder = importTypeOrder.map(t => {
        const norm = normalizeUnitType(t);
        const resolved = resolveKnownType(t) || resolveKnownType(norm);
        return resolved || norm;
      });

      // 2) Key-based dedup so "Type A" / "TYPE A" / "type-a" can't all reserve a slot.
      const seenKeys = new Set<string>();
      const pageOrdered: string[] = [];
      for (const t of normalizedOrder) {
        const k = toTypeKey(t);
        if (!k || seenKeys.has(k)) continue;
        seenKeys.add(k);
        pageOrdered.push(t);
      }

      // 3) Append any row-derived types NOT present in the PDF page order at the END
      //    (only happens when AI invented a type from a cabinet label that wasn't in
      //    any title block — rare and intentionally pushed last so it never displaces
      //    a real page-ordered type).
      const tail: string[] = [];
      for (const t of orderedTypes) {
        if (t === 'Unassigned') continue;
        const k = toTypeKey(t);
        if (!k || seenKeys.has(k)) continue;
        seenKeys.add(k);
        tail.push(t);
      }

      const finalOrder = [...pageOrdered, ...tail].filter(t => t !== 'Unassigned');
      store.addCabinetUnitTypes(finalOrder, true);
    } else {
      // No page order from dialog → fall back to row-iteration order (legacy path),
      // still using key-based dedup so casing/whitespace can't double-add a type.
      const seenKeys = new Set<string>();
      const finalOrder: string[] = [];
      for (const t of orderedTypes) {
        if (t === 'Unassigned') continue;
        const k = toTypeKey(t);
        if (!k || seenKeys.has(k)) continue;
        seenKeys.add(k);
        finalOrder.push(t);
      }
      store.addCabinetUnitTypes(finalOrder, true);
    }

    for (const [unitType, typeRows] of rowsByType) {
      store.addCabinetImport(
        typeRows.map(r => ({ sku: r.sku, type: r.type, room: r.room, quantity: r.quantity, unitType })),
        unitType
      );
    }

    // ── Auto-add TK8 based on Base+Tall width sum / 96, separate Kitchen vs each Vanity ──
    const typesWithCabinets = Array.from(rowsByType.keys()).filter(t => {
      const typeRows = rowsByType.get(t);
      return t !== 'Unassigned' && typeRows && typeRows.length > 0;
    });

    // Extract width from SKU: ALWAYS first 2 digits after letter prefix
    // W3030→30, W1830→18, UC18X90→18, UX1890→18, UC1221X90→12, B36→36, VDB12→12
    const parseWidthFromSku = (sku: string): number => {
      const cleaned = sku.replace(/\s/g, '');
      const m = cleaned.match(/^[A-Za-z]+(\d{2})/);
      if (!m) return 0;
      return Number(m[1]) || 0;
    };

    // Determine if a cabinet is Base or Tall type (contributes to TK8)
    const isBaseOrTall = (row: { type: string; sku: string }): boolean => {
      const t = row.type?.toLowerCase() || '';
      if (t === 'base' || t === 'tall') return true;
      // Fallback: check SKU prefix
      const s = row.sku.toUpperCase();
      if (/^(B|DB|SB|CB|EB|LSB?|LS)\d/.test(s)) return true;
      if (/^(T|UT|TC|PT|PTC|UC)\d/.test(s)) return true;
      if (/^(V|VB|VD|VDB)\d/.test(s)) return true; // vanity base counts too
      return false;
    };

    const isVanityRow = (row: { type: string; sku: string; room: string }): boolean => {
      if (row.type?.toLowerCase() === 'vanity') return true;
      const s = row.sku.toUpperCase();
      if (/^(V|VB|VD|VDB)\d/.test(s)) return true;
      if (row.room?.toLowerCase().includes('vanity') || row.room?.toLowerCase().includes('bath')) return true;
      return false;
    };

    if (typesWithCabinets.length > 0) {
      for (const unitType of typesWithCabinets) {
        const typeRows = rowsByType.get(unitType) || [];
        const baseTallRows = typeRows.filter(r => isBaseOrTall(r));

        // Split into kitchen (non-vanity) and vanity groups
        const kitchenRows = baseTallRows.filter(r => !isVanityRow(r));
        const vanityRows = baseTallRows.filter(r => isVanityRow(r));

        // Group vanity rows by room for separate TK8 counts
        const vanityByRoom = new Map<string, typeof vanityRows>();
        for (const r of vanityRows) {
          const roomKey = r.room?.toLowerCase() || 'vanity';
          if (!vanityByRoom.has(roomKey)) vanityByRoom.set(roomKey, []);
          vanityByRoom.get(roomKey)!.push(r);
        }

        let totalTk8 = 0;

        // Kitchen TK8: sum of widths of all kitchen base+tall, /96, round up
        if (kitchenRows.length > 0) {
          const kitchenWidthSum = kitchenRows.reduce((sum, r) => {
            return sum + parseWidthFromSku(r.sku) * r.quantity;
          }, 0);
          if (kitchenWidthSum > 0) {
            totalTk8 += Math.ceil(kitchenWidthSum / 96);
          }
        }

        // Each vanity room: separate width sum /96 round up
        for (const [, vRows] of vanityByRoom) {
          const vanityWidthSum = vRows.reduce((sum, r) => {
            return sum + parseWidthFromSku(r.sku) * r.quantity;
          }, 0);
          if (vanityWidthSum > 0) {
            totalTk8 += Math.ceil(vanityWidthSum / 96);
          }
        }

        if (totalTk8 > 0) {
          store.addCabinetImport(
            [{ sku: 'TK8', type: 'Base', room: 'Kitchen', quantity: totalTk8, unitType }],
            unitType
          );
        }
      }
    }

    setCabinetImportedCount(rows.length);
    setShowCabinetImport(false);
    const firstType = Array.from(rowsByType.keys()).find(t => t !== 'Unassigned');
    if (firstType) setImportTargetType(firstType);
    setTimeout(() => setCabinetImportedCount(null), 4000);
  };
  // ── Stone import handler ────────────────────────────────────────────────
  const handleStoneImport = (rows: StoneExtractedRow[], detectedTypes?: string[]) => {
    // Group rows by their per-page unitType
    const rowsByType = new Map<string, StoneExtractedRow[]>();
    const typeOrder: string[] = [];

    for (const r of rows) {
      if (r.selected === false) continue;
      const type = r.unitType ? normalizeUnitType(r.unitType) : 'Unassigned';
      if (!rowsByType.has(type)) {
        rowsByType.set(type, []);
        typeOrder.push(type);
      }
      rowsByType.get(type)!.push(r);
    }

    // Clear existing stone data first, then add types and rows
    store.clearStone();

    // If detectedTypes provided, use that ordering, then append any remaining
    if (detectedTypes && detectedTypes.length > 0) {
      const normalizedOrder = detectedTypes.map(t => normalizeUnitType(t)).filter((t, i, a) => a.indexOf(t) === i);
      const remaining = typeOrder.filter(t => !normalizedOrder.includes(t));
      const finalOrder = [...normalizedOrder, ...remaining];
      store.addStoneUnitTypes(finalOrder);
    } else {
      store.addStoneUnitTypes(typeOrder);
    }

    for (const [unitType, typeRows] of rowsByType) {
      const stoneRows: PrefinalStoneRow[] = typeRows.map(r => ({
        label: r.label,
        length: r.length,
        depth: r.depth,
        backsplashLength: r.backsplashLength ?? 0,
        isIsland: r.isIsland,
        category: r.category || 'kitchen',
        unitType,
      }));
      store.addStoneImport(stoneRows, unitType);
    }

    setStoneImportedCount(rows.filter(r => r.selected !== false).length);
    setShowStoneImport(false);
    setTimeout(() => setStoneImportedCount(null), 4000);
  };

  // ── Laminate import handler ────────────────────────────────────────────
  const handleLaminateImport = (rows: StoneExtractedRow[], detectedTypes?: string[]) => {
    const rowsByType = new Map<string, StoneExtractedRow[]>();
    const typeOrder: string[] = [];

    for (const r of rows) {
      if (r.selected === false) continue;
      const type = r.unitType ? normalizeUnitType(r.unitType) : 'Unassigned';
      if (!rowsByType.has(type)) {
        rowsByType.set(type, []);
        typeOrder.push(type);
      }
      rowsByType.get(type)!.push(r);
    }

    store.clearLaminate();

    if (detectedTypes && detectedTypes.length > 0) {
      const normalizedOrder = detectedTypes.map(t => normalizeUnitType(t)).filter((t, i, a) => a.indexOf(t) === i);
      const remaining = typeOrder.filter(t => !normalizedOrder.includes(t));
      store.addLaminateUnitTypes([...normalizedOrder, ...remaining]);
    } else {
      store.addLaminateUnitTypes(typeOrder);
    }

    for (const [unitType, typeRows] of rowsByType) {
      const laminateRows: PrefinalStoneRow[] = typeRows.map(r => ({
        label: r.label,
        length: r.length,
        depth: r.depth,
        backsplashLength: r.backsplashLength ?? 0,
        isIsland: r.isIsland,
        category: r.category || 'kitchen',
        unitType,
      }));
      store.addLaminateImport(laminateRows, unitType);
    }

    setLaminateImportedCount(rows.filter(r => r.selected !== false).length);
    setShowLaminateImport(false);
    setTimeout(() => setLaminateImportedCount(null), 4000);
  };

  // ── Vtop import handler ────────────────────────────────────────────────
  const handleVtopImport = (rows: VtopImportRow[], detectedTypes?: string[]) => {
    const rowsByType = new Map<string, VtopImportRow[]>();
    const typeOrder: string[] = [];

    for (const r of rows) {
      if (!r.selected) continue;
      const type = r.unitType ? normalizeUnitType(r.unitType) : 'Unassigned';
      if (!rowsByType.has(type)) {
        rowsByType.set(type, []);
        typeOrder.push(type);
      }
      rowsByType.get(type)!.push(r);
    }

    store.clearVtops();

    if (detectedTypes && detectedTypes.length > 0) {
      const normalizedOrder = detectedTypes.map(t => normalizeUnitType(t)).filter((t, i, a) => a.indexOf(t) === i);
      const remaining = typeOrder.filter(t => !normalizedOrder.includes(t));
      store.addVtopUnitTypes([...normalizedOrder, ...remaining]);
    } else {
      store.addVtopUnitTypes(typeOrder);
    }

    for (const [unitType, typeRows] of rowsByType) {
      const vtopRows: PrefinalVtopRow[] = typeRows.map(r => ({
        length: r.length,
        depth: r.depth,
        bowlPosition: r.bowlPosition,
        bowlOffset: r.bowlOffset,
        leftWall: r.leftWall,
        rightWall: r.rightWall,
        unitType,
      }));
      store.addVtopImport(vtopRows, unitType);
    }

    setVtopImportedCount(rows.filter(r => r.selected).length);
    setShowVtopImport(false);
    setTimeout(() => setVtopImportedCount(null), 4000);
  };

  // ── Stone pivot ─────────────────────────────────────────────────────────
  const stoneUnitTypes = (() => {
    const seen = new Set<string>();
    return store.stoneUnitTypes.filter(t => {
      const key = t.toUpperCase().replace(/^TYPE\s+/, '').replace(/\s+/g, '').replace(/-/g, '').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  const calcTopSqft = (row: PrefinalStoneRow): number => {
    return Math.ceil((row.length * row.depth) / 144);
  };

  const calcBacksplashSqft = (backsplashInches: number, heightInches: number): number => {
    return Math.ceil((backsplashInches * heightInches) / 144);
  };


  const cabUnitTypes = (() => {
    const seen = new Set<string>();
    return store.cabinetUnitTypes.filter(t => {
      const key = t.toUpperCase().replace(/^TYPE\s+/, '').replace(/\s+/g, '').replace(/-/g, '').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();
  const allSkus = Array.from(new Set(store.cabinetRows.map(r => r.sku))).sort();
  const skuTypeQty: Record<string, Record<string, number>> = {};
  const skuCabType: Record<string, string> = {};
  store.cabinetRows.forEach(r => {
    if (!skuTypeQty[r.sku]) skuTypeQty[r.sku] = {};
    skuTypeQty[r.sku][r.unitType] = Math.max(skuTypeQty[r.sku][r.unitType] || 0, r.quantity);
    if (!skuCabType[r.sku]) skuCabType[r.sku] = r.type;
  });

  const parseSkuDims = (sku: string): { width: number; height: number } => {
    const match = sku.replace(/\s/g, '').match(/^[A-Za-z]+(\d+)/);
    if (!match) return { width: 0, height: 0 };
    const digits = match[1];
    if (digits.length === 4) return { width: Number(digits.slice(0, 2)), height: Number(digits.slice(2, 4)) };
    if (digits.length === 3) return { width: Number(digits.slice(0, 1)), height: Number(digits.slice(1, 3)) };
    if (digits.length === 2) return { width: Number(digits), height: 0 };
    return { width: Number(digits), height: 0 };
  };

  const sortSkusForGroup = (skus: string[], group: string): string[] => {
    const isHA = (sku: string) => /^HA/i.test(sku);
    if (group === 'Wall') {
      const wallPrefixOrder = (sku: string): number => {
        const u = sku.toUpperCase();
        if (/^(BLW)\d/i.test(u)) return 1;
        if (/^W\d/i.test(u)) return 0;
        return 2;
      };
      return [...skus].sort((a, b) => {
        const haA = isHA(a) ? 1 : 0, haB = isHA(b) ? 1 : 0;
        if (haA !== haB) return haA - haB;
        const da = parseSkuDims(a), db = parseSkuDims(b);
        if (da.height !== db.height) return da.height - db.height;
        const pa = wallPrefixOrder(a.replace(/^HA/i, '')), pb = wallPrefixOrder(b.replace(/^HA/i, ''));
        if (pa !== pb) return pa - pb;
        return da.width - db.width;
      });
    }
    if (group === 'Base') {
      const basePrefixOrder = (sku: string): number => {
        const u = sku.toUpperCase();
        if (/^(BLB|BLD|BLW|BRW)\d/i.test(u)) return 2;
        if (/^SB\d/i.test(u)) return 3;
        if (/^(DB|CB|EB)\d/i.test(u)) return 1;
        if (/^B\d/i.test(u)) return 0;
        return 4;
      };
      return [...skus].sort((a, b) => {
        const haA = isHA(a) ? 1 : 0, haB = isHA(b) ? 1 : 0;
        if (haA !== haB) return haA - haB;
        const pa = basePrefixOrder(a.replace(/^HA/i, '')), pb = basePrefixOrder(b.replace(/^HA/i, ''));
        if (pa !== pb) return pa - pb;
        const da = parseSkuDims(a), db = parseSkuDims(b);
        if (da.width !== db.width) return da.width - db.width;
        return da.height - db.height;
      });
    }
    if (group === 'UC') {
      return [...skus].sort((a, b) => {
        const haA = isHA(a) ? 1 : 0, haB = isHA(b) ? 1 : 0;
        if (haA !== haB) return haA - haB;
        const da = parseSkuDims(a), db = parseSkuDims(b);
        if (da.width !== db.width) return da.width - db.width;
        return da.height - db.height;
      });
    }
    return skus;
  };

  const CAB_TYPE_ORDER = ['Wall', 'Base', 'Tall', 'Vanity', 'Accessory'];
  const groupedSkus: { group: string; skus: string[] }[] = (() => {
    const groups: Record<string, string[]> = {};
    for (const sku of allSkus) {
      const t = skuCabType[sku] || 'Other';
      if (!groups[t]) groups[t] = [];
      groups[t].push(sku);
    }
    const ordered: { group: string; skus: string[] }[] = [];
    for (const g of CAB_TYPE_ORDER) {
      if (groups[g]) { ordered.push({ group: g, skus: sortSkusForGroup(groups[g], g) }); delete groups[g]; }
    }
    for (const [g, skus] of Object.entries(groups)) {
      ordered.push({ group: g, skus: sortSkusForGroup(skus, g) });
    }
    return ordered;
  })();

  const unitTypeTotal = (type: string) =>
    store.unitNumbers.filter(u => u.assignments[type]).length;

  return (
    <div className="space-y-4">
      {/* Unit Import Dialog */}
      {showUnitImport && (
        <UnitTypeImportDialog
          onImport={(rows, typeOrder) => {
            handleUnitImport(rows, typeOrder);
            setShowUnitImport(false);
          }}
          onClose={() => setShowUnitImport(false)}
          prefinalPerson={project.specs?.takeoffPerson}
          speedMode="thorough"
          aiProvider={unitAiProvider}
          dialagramModel="qwen-3.6-plus"
        />
      )}

      {/* Cabinet Import Dialog */}
      {showCabinetImport && (
        <ShopDrawingImportDialog
          onImport={(rows, detectedUnitType, importTypeOrder) => {
            handleCabinetImport(rows, detectedUnitType, importTypeOrder);
          }}
          onClose={() => setShowCabinetImport(false)}
          prefinalPerson={project.specs?.takeoffPerson}
          speedMode="thorough"
          skipClassify
          aiModel={cabinetAiModel}
          aiProvider={cabinetAiProvider}
          dialagramModel="qwen-3.6-plus"
        />
      )}

      {/* Stone Import Dialog */}
      {showStoneImport && (
        <StonePDFImportDialog
          onImport={(rows, detectedTypes) => handleStoneImport(rows, detectedTypes)}
          onClose={() => setShowStoneImport(false)}
          prefinalPerson={project.specs?.takeoffPerson}
          extractionType="stone"
          aiProvider={stoneAiProvider}
        />
      )}

      {/* Laminate Import Dialog */}
      {showLaminateImport && (
        <StonePDFImportDialog
          onImport={(rows, detectedTypes) => handleLaminateImport(rows, detectedTypes)}
          onClose={() => setShowLaminateImport(false)}
          prefinalPerson={project.specs?.takeoffPerson}
          extractionType="laminate"
          aiProvider={stoneAiProvider}
        />
      )}

      {/* Vtop Import Dialog */}
      {showVtopImport && (
        <VtopPDFImportDialog
          onImport={(rows, detectedTypes) => handleVtopImport(rows, detectedTypes)}
          onClose={() => setShowVtopImport(false)}
          prefinalPerson={project.specs?.takeoffPerson}
          aiProvider={vtopAiProvider}
        />
      )}

      {/* Sub-tab toggle + speed mode */}
      <div className="flex items-center gap-1 flex-wrap">
        <button
          onClick={() => setActiveSubTab('units')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors ${activeSubTab === 'units' ? 'text-white' : 'text-muted-foreground border border-border hover:bg-secondary'}`}
          style={activeSubTab === 'units' ? { background: 'hsl(var(--primary))' } : {}}
        >
          <Users size={13} /> Unit Count
        </button>
        <button
          onClick={() => setActiveSubTab('cabinets')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors ${activeSubTab === 'cabinets' ? 'text-white' : 'text-muted-foreground border border-border hover:bg-secondary'}`}
          style={activeSubTab === 'cabinets' ? { background: 'hsl(var(--primary))' } : {}}
        >
          <LayoutGrid size={13} /> Cabinet Count
        </button>
        <button
          onClick={() => setActiveSubTab('stone')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors ${activeSubTab === 'stone' ? 'text-white' : 'text-muted-foreground border border-border hover:bg-secondary'}`}
          style={activeSubTab === 'stone' ? { background: 'hsl(var(--primary))' } : {}}
        >
          <Square size={13} /> Stone - SQFT
        </button>
        <button
          onClick={() => setActiveSubTab('laminate')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors ${activeSubTab === 'laminate' ? 'text-white' : 'text-muted-foreground border border-border hover:bg-secondary'}`}
          style={activeSubTab === 'laminate' ? { background: 'hsl(142 50% 50%)' } : {}}
        >
          <Layers size={13} /> Laminate LFT
        </button>
        <button
          onClick={() => setActiveSubTab('cmarble')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors ${activeSubTab === 'cmarble' ? 'text-white' : 'text-muted-foreground border border-border hover:bg-secondary'}`}
          style={activeSubTab === 'cmarble' ? { background: 'hsl(280 45% 58%)' } : {}}
        >
          🛁 Cmarble/Swan Vtop
        </button>

      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* UNIT COUNT SUB-TAB                                                 */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeSubTab === 'units' && (
        <>

          {unitImportedCount !== null && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white" style={{ background: 'hsl(142 71% 45%)' }}>
              ✓ Successfully imported {unitImportedCount} unit type{unitImportedCount !== 1 ? 's' : ''} from shop drawing
            </div>
          )}

          <div className="est-card overflow-hidden">
            <div className="est-section-header flex items-center gap-2 flex-wrap">
              <Users size={13} className="flex-shrink-0" />
              Pre-Final Unit Count

              <div className="ml-auto flex items-center gap-2 flex-wrap">
                <ProviderToggle value={unitAiProvider} onChange={setUnitAiProvider} />
                <button
                  onClick={() => setShowUnitImport(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white transition-colors"
                  style={{ background: 'hsl(var(--primary))' }}
                >
                  <FileUp size={12} /> Upload 2020 floor plans
                </button>
                {(store.unitTypes.length > 0 || store.unitNumbers.length > 0) && (
                  <button
                    onClick={() => { if (confirm('Clear all unit count data?')) store.clearUnits(); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-destructive border border-border hover:border-destructive transition-colors"
                  >
                    <RotateCcw size={11} /> Clear
                  </button>
                )}
                <button
                  onClick={() => setShowAddUnit(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus size={12} /> Add Unit Type
                </button>
                {store.unitTypes.length > 0 && (
                  <button
                    onClick={() => setShowAddUnitNumber(v => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus size={12} /> Add Unit #
                  </button>
                )}
              </div>
            </div>

            {showAddUnit && (
              <div className="px-4 py-3 border-b border-border bg-accent/30 flex items-center gap-3 flex-wrap">
                <input
                  className="est-input text-xs h-7 w-36"
                  placeholder="Unit type (e.g. 2BHK)"
                  value={newUnitType}
                  onChange={e => setNewUnitType(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newUnitType.trim()) {
                      store.addUnitTypes([newUnitType.trim()]);
                      setNewUnitType(''); setShowAddUnit(false);
                    }
                  }}
                  autoFocus
                />
                <button
                  onClick={() => {
                    if (!newUnitType.trim()) return;
                    store.addUnitTypes([newUnitType.trim()]);
                    setNewUnitType(''); setShowAddUnit(false);
                  }}
                  className="px-3 py-1 rounded text-xs font-semibold text-white"
                  style={{ background: 'hsl(var(--primary))' }}
                >
                  Add
                </button>
                <button onClick={() => setShowAddUnit(false)} className="text-xs text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </div>
            )}

            {showAddUnitNumber && (
              <div className="px-4 py-3 border-b border-border bg-accent/30 flex items-center gap-3 flex-wrap">
                <input
                  className="est-input text-xs h-7 w-36"
                  placeholder="Unit # (e.g. 101)"
                  value={newUnitNumber}
                  onChange={e => setNewUnitNumber(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newUnitNumber.trim()) {
                      store.addUnitNumber(newUnitNumber.trim());
                      setNewUnitNumber(''); setShowAddUnitNumber(false);
                    }
                  }}
                  autoFocus
                />
                <button
                  onClick={() => {
                    if (!newUnitNumber.trim()) return;
                    store.addUnitNumber(newUnitNumber.trim());
                    setNewUnitNumber(''); setShowAddUnitNumber(false);
                  }}
                  className="px-3 py-1 rounded text-xs font-semibold text-white"
                  style={{ background: 'hsl(var(--primary))' }}
                >
                  Add
                </button>
                <button onClick={() => setShowAddUnitNumber(false)} className="text-xs text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </div>
            )}

            {store.unitTypes.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                No data yet — import a 2020 shop drawing PDF or add unit types manually.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="est-table" style={{ whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr style={{ height: '120px', verticalAlign: 'bottom' }}>
                      <th className="text-left" style={{ verticalAlign: 'bottom' }}>Unit #</th>
                      <th className="text-left" style={{ verticalAlign: 'bottom' }}>Bldg</th>
                      <th className="text-left" style={{ verticalAlign: 'bottom' }}>Floor</th>
                      {store.unitTypes.map(type => (
                        <th key={type} className="text-center" style={{ verticalAlign: 'bottom', padding: '0', minWidth: '42px' }}>
                          <div className="flex flex-col items-center gap-1 py-2" style={{ background: 'hsl(213 72% 35%)', color: '#fff', borderRadius: '4px 4px 0 0', width: '100%' }}>
                            {editingType === type ? (
                              <input
                                className="bg-white/20 text-white text-[11px] font-bold border border-white/40 rounded px-1 py-0.5 w-full text-center outline-none"
                                style={{ maxWidth: '38px' }}
                                value={editingTypeValue}
                                onChange={e => setEditingTypeValue(e.target.value)}
                                onBlur={() => {
                                  if (editingTypeValue.trim() && editingTypeValue.trim() !== type) {
                                    store.renameUnitType(type, editingTypeValue.trim());
                                  }
                                  setEditingType(null);
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                  if (e.key === 'Escape') setEditingType(null);
                                }}
                                autoFocus
                              />
                            ) : (
                              <div
                                onDoubleClick={() => { setEditingType(type); setEditingTypeValue(type); }}
                                className="cursor-pointer"
                                title="Double-click to rename"
                                style={{
                                  writingMode: 'vertical-rl',
                                  transform: 'rotate(180deg)',
                                  whiteSpace: 'nowrap',
                                  fontWeight: 700,
                                  fontSize: '11px',
                                  height: '90px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  letterSpacing: '0.05em',
                                }}>
                                {type}
                              </div>
                            )}
                            <button
                              onClick={() => store.deleteUnitType(type)}
                              className="transition-colors mt-0.5 opacity-50 hover:opacity-100"
                              style={{ color: '#fca5a5' }}
                              title={`Remove ${type}`}
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </th>
                      ))}
                      <th className="w-8" style={{ verticalAlign: 'bottom' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {store.unitNumbers.length === 0 ? (
                      <tr>
                        <td colSpan={store.unitTypes.length + 4} className="text-center text-muted-foreground text-xs py-6">
                          No unit numbers added yet — click "Add Unit #" to start assigning units to types.
                        </td>
                      </tr>
                    ) : (
                      store.unitNumbers.map((unit, i) => (
                        <tr key={i}>
                          <td className="font-medium">
                            <input
                              className="est-input text-xs w-20"
                              value={unit.name}
                              onChange={e => store.updateUnitNumberName(i, e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              className="est-input text-xs w-20"
                              value={unit.bldg || ''}
                              onChange={e => store.updateUnitNumberBldg(i, e.target.value)}
                              placeholder="—"
                            />
                          </td>
                          <td>
                            <input
                              className="est-input text-xs w-16"
                              value={unit.floor || ''}
                              onChange={e => store.updateUnitNumberFloor(i, e.target.value)}
                              placeholder="—"
                            />
                          </td>
                          {store.unitTypes.map(type => (
                            <td key={type} className="text-center">
                              <button
                                onClick={() => store.toggleAssignment(i, type)}
                                className={`w-6 h-6 rounded border text-xs font-bold transition-colors ${
                                  unit.assignments[type]
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'border-border text-transparent hover:border-muted-foreground'
                                }`}
                              >
                                1
                              </button>
                            </td>
                          ))}
                          <td>
                            <button onClick={() => store.deleteUnitNumber(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold border-t border-border">
                      <td>Total</td>
                      <td></td>
                      <td></td>
                      {store.unitTypes.map(type => (
                        <td key={type} className="text-center font-mono">{unitTypeTotal(type) || ''}</td>
                      ))}
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* CABINET COUNT SUB-TAB                                              */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeSubTab === 'cabinets' && (
        <>

          {cabinetImportedCount !== null && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white" style={{ background: 'hsl(142 71% 45%)' }}>
              ✓ Successfully imported {cabinetImportedCount} label{cabinetImportedCount !== 1 ? 's' : ''} from shop drawing
              {importTargetType && <span className="opacity-80 ml-1">for "{importTargetType}"</span>}
            </div>
          )}

          <div className="est-card overflow-hidden">
            <div className="est-section-header flex items-center gap-2 flex-wrap">
              <LayoutGrid size={13} className="flex-shrink-0" />
              Pre-Final Cabinet Count

              <div className="ml-auto flex items-center gap-2 flex-wrap">
                {/* AI Provider Toggle (Gemini default vs Qwen) */}
                <ProviderToggle value={cabinetAiProvider} onChange={setCabinetAiProvider} />
                {/* Fast Gemini lite mode is kept as the cabinet aiModel; Accu (3.1 thinking) toggle removed in favor of Qwen */}
                <button
                  onClick={() => setShowCabinetImport(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white transition-colors"
                  style={{ background: 'hsl(var(--primary))' }}
                >
                  <FileUp size={12} /> Upload 2020 Floor plan
                </button>
                {store.cabinetRows.length > 0 && (
                  <button
                    onClick={() => { if (confirm('Clear all cabinet import data?')) store.clearCabinets(); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-destructive border border-border hover:border-destructive transition-colors"
                  >
                    <RotateCcw size={11} /> Clear
                  </button>
                )}
                <div className="flex items-center gap-3 border border-border rounded px-3 py-1.5 bg-background">
                  {['CM8', 'LR8', 'TF3X96-Molding', 'Scribe'].map(item => (
                    <label key={item} className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-foreground select-none">
                      <input
                        type="checkbox"
                        checked={cabinetChecks[item] || false}
                        onChange={e => {
                          const checked = e.target.checked;
                          setCabinetChecks(prev => ({ ...prev, [item]: checked }));
                          if (checked) {
                            // Calculate qty from wall cabinet widths per type
                            // ALWAYS first 2 digits after letter prefix = width
                            const parseWidth = (sku: string): number => {
                              const m = sku.replace(/\s/g, '').match(/^[A-Za-z]+(\d{2})/);
                              return m ? (Number(m[1]) || 0) : 0;
                            };
                            const isWall = (r: { type: string; sku: string }) => {
                              if (r.type?.toLowerCase() === 'wall') return true;
                              return /^(W|UB|OH|WC)\d/i.test(r.sku);
                            };
                            const types = store.cabinetUnitTypes;
                            for (const unitType of types) {
                              const typeRows = store.cabinetRows.filter(r => r.unitType === unitType && r.sku.toUpperCase() !== item.toUpperCase());
                              const wallRows = typeRows.filter(r => isWall(r));
                              if (wallRows.length === 0) continue;
                              const widthSum = wallRows.reduce((s, r) => s + parseWidth(r.sku) * r.quantity, 0);
                              if (widthSum <= 0) continue;
                              const qty = Math.ceil(widthSum / 96);
                              store.addCabinetImport(
                                [{ sku: item, type: 'Accessory', room: 'Kitchen', quantity: qty, unitType }],
                                unitType
                              );
                            }
                          } else {
                            store.deleteCabinetRow(item);
                          }
                        }}
                        className="h-3.5 w-3.5 rounded border-border accent-primary"
                      />
                      {item}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {allSkus.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                Import a 2020 shop drawing PDF to extract cabinet and accessory labels.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="est-table" style={{ whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr style={{ height: '120px', verticalAlign: 'bottom' }}>
                      <th className="text-left" style={{ verticalAlign: 'bottom' }}>SKU Name</th>
                      {cabUnitTypes.map(type => (
                        <th key={type} className="text-center" style={{ verticalAlign: 'bottom', padding: '0', minWidth: '42px' }}>
                          <div style={{
                            background: 'hsl(213 72% 35%)',
                            color: '#fff',
                            writingMode: 'vertical-rl',
                            transform: 'rotate(180deg)',
                            whiteSpace: 'nowrap',
                            fontWeight: 700,
                            fontSize: '11px',
                            height: '100px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            letterSpacing: '0.05em',
                            width: '100%',
                            borderRadius: '4px 4px 0 0',
                          }}>
                            {type}
                          </div>
                        </th>
                      ))}
                      <th className="text-center" style={{ verticalAlign: 'bottom', padding: '0', minWidth: '42px' }}>
                        <div style={{
                          background: 'hsl(215 25% 14%)',
                          color: '#fff',
                          fontWeight: 700,
                          fontSize: '11px',
                          height: '100px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          writingMode: 'vertical-rl',
                          transform: 'rotate(180deg)',
                          letterSpacing: '0.05em',
                          width: '100%',
                          borderRadius: '4px 4px 0 0',
                        }}>
                          Total
                        </div>
                      </th>
                      <th className="text-center" style={{ verticalAlign: 'bottom', padding: '0', minWidth: '56px' }}>
                        <div style={{
                          background: 'hsl(280 45% 55%)',
                          color: '#fff',
                          fontWeight: 700,
                          fontSize: '11px',
                          height: '100px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          writingMode: 'vertical-rl',
                          transform: 'rotate(180deg)',
                          letterSpacing: '0.05em',
                          width: '100%',
                          borderRadius: '4px 4px 0 0',
                        }}>
                          Pulls/Cab
                        </div>
                      </th>
                      <th className="w-8" style={{ verticalAlign: 'bottom' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedSkus.map(({ group, skus }) => (
                      <React.Fragment key={`grp-${group}`}>
                        <tr>
                          <td
                            colSpan={3 + cabUnitTypes.length}
                            className="text-xs font-bold uppercase tracking-wider py-1.5 px-3"
                            style={{ background: 'hsl(var(--accent))', color: 'hsl(var(--muted-foreground))' }}
                          >
                            {group} ({skus.length})
                          </td>
                        </tr>
                        {skus.map(sku => {
                          const rowTotal = cabUnitTypes.reduce((sum, t) => sum + (skuTypeQty[sku]?.[t] || 0), 0);
                          return (
                            <tr key={sku}>
                              <td className="font-mono font-medium">{sku}</td>
                              {cabUnitTypes.map(type => {
                                const qty = skuTypeQty[sku]?.[type] || 0;
                                return (
                                  <td key={type} className="text-center font-mono text-xs">
                                    {qty > 0 ? qty : ''}
                                  </td>
                                );
                              })}
                              <td className="text-center font-mono font-bold">{rowTotal || ''}</td>
                              <td className="text-center">
                                <input
                                  type="number"
                                  min={0}
                                  className="est-input text-xs w-12 text-center font-mono"
                                  value={store.handleQtyPerSku[sku] || ''}
                                  onChange={e => store.setHandleQty(sku, Number(e.target.value) || 0)}
                                  placeholder="0"
                                />
                              </td>
                              <td>
                                <button
                                  onClick={() => { if (confirm(`Delete SKU "${sku}"?`)) store.deleteCabinetRow(sku); }}
                                  className="text-muted-foreground hover:text-destructive transition-colors"
                                  title={`Delete ${sku}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold border-t border-border">
                      <td>Total</td>
                      {cabUnitTypes.map(type => {
                        const colTotal = allSkus.reduce((sum, sku) => sum + (skuTypeQty[sku]?.[type] || 0), 0);
                        return <td key={type} className="text-center font-mono">{colTotal || ''}</td>;
                      })}
                      <td className="text-center font-mono">
                        {allSkus.reduce((sum, sku) => sum + cabUnitTypes.reduce((s, t) => s + (skuTypeQty[sku]?.[t] || 0), 0), 0)}
                      </td>
                      <td></td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Bid Cost per Unit Type */}
            {cabUnitTypes.length > 0 && (
              <>
                <div className="px-4 py-3 border-t border-border">
                  <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Bid Cost per Unit Type (for pricing in export)</div>
                  <div className="flex flex-wrap gap-3">
                    {cabUnitTypes.map(type => (
                      <div key={type} className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground truncate max-w-[120px]" title={type}>{type}</span>
                        <span className="text-xs text-muted-foreground">$</span>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="est-input text-xs w-20 font-mono"
                          value={store.bidCostPerType[type] || ''}
                          onChange={e => store.setBidCost(type, Number(e.target.value) || 0)}
                          placeholder="0.00"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="px-4 py-3 border-t border-border">
                  <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Additional Cost per Unit Type</div>
                  <div className="flex flex-wrap gap-3">
                    {cabUnitTypes.map(type => (
                      <div key={type} className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground truncate max-w-[120px]" title={type}>{type}</span>
                        <span className="text-xs text-muted-foreground">$</span>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="est-input text-xs w-20 font-mono"
                          value={store.additionalCostPerType[type] || ''}
                          onChange={e => store.setAdditionalCost(type, Number(e.target.value) || 0)}
                          placeholder="0.00"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* STONE - SQFT SUB-TAB                                               */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeSubTab === 'stone' && (() => {
        // Pre-compute all type data for sticky summary
        const allTypeData = stoneUnitTypes.map(type => {
          const typeRows = store.stoneRows.filter(r => r.unitType === type);
          const unitCount = store.unitNumbers.filter(u => u.assignments[type]).length || 1;
          const kGroups = new Map<number, { len: number; bs: number }>();
          const bGroups = new Map<number, { len: number; bs: number }>();
          for (const r of typeRows) {
            const map = r.category === 'kitchen' ? kGroups : bGroups;
            const g = map.get(r.depth) || { len: 0, bs: 0 };
            g.len += r.length; g.bs += r.backsplashLength;
            map.set(r.depth, g);
          }
          const typeKBsH = store.getTypeBsHeight(type, 'kitchen');
          const typeBBsH = store.getTypeBsHeight(type, 'bath');
          let kSqft = 0, bSqft = 0;
          for (const [depth, g] of kGroups) {
            const topKey = `${type}|kitchen|${depth}|topInches`;
            const bsKey = `${type}|kitchen|${depth}|bsInches`;
            const effTop = store.stoneInchesOverrideMap[topKey] !== undefined ? store.stoneInchesOverrideMap[topKey] : g.len;
            const effBs = store.stoneInchesOverrideMap[bsKey] !== undefined ? store.stoneInchesOverrideMap[bsKey] : g.bs;
            const ssQty = store.sidesplashQtyMap[`${type}|kitchen|${depth}`] || 0;
            const rawTop = (effTop * depth) / 144;
            const rawBs = (effBs * typeKBsH) / 144;
            const rawSs = ssQty > 0 ? (depth * typeKBsH * ssQty) / 144 : 0;
            kSqft += Math.ceil(rawTop + rawBs + rawSs);
          }
          for (const [depth, g] of bGroups) {
            const topKey = `${type}|bath|${depth}|topInches`;
            const bsKey = `${type}|bath|${depth}|bsInches`;
            const effTop = store.stoneInchesOverrideMap[topKey] !== undefined ? store.stoneInchesOverrideMap[topKey] : g.len;
            const effBs = store.stoneInchesOverrideMap[bsKey] !== undefined ? store.stoneInchesOverrideMap[bsKey] : g.bs;
            const ssQty = store.sidesplashQtyMap[`${type}|bath|${depth}`] || 0;
            const rawTop = (effTop * depth) / 144;
            const rawBs = (effBs * typeBBsH) / 144;
            const rawSs = ssQty > 0 ? (depth * typeBBsH * ssQty) / 144 : 0;
            bSqft += Math.ceil(rawTop + rawBs + rawSs);
          }
          return { type, unitCount, kSqft, bSqft };
        });
        const grandKitchen = allTypeData.reduce((s, d) => s + d.kSqft * d.unitCount, 0);
        const grandBath = allTypeData.reduce((s, d) => s + d.bSqft * d.unitCount, 0);
        const totalUnits = allTypeData.reduce((s, d) => s + d.unitCount, 0);

        return (
        <>
          {stoneImportedCount !== null && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white" style={{ background: 'hsl(142 71% 45%)' }}>
              ✓ Successfully imported {stoneImportedCount} countertop section{stoneImportedCount !== 1 ? 's' : ''}
            </div>
          )}

          {/* ── Sticky Summary Bar ─────────────────────────────────────────── */}
          {store.stoneRows.length > 0 && (
            <div className="sticky top-0 z-20 rounded-lg border shadow-sm mb-4" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
              <div className="px-5 py-3 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <Square size={16} style={{ color: 'hsl(var(--primary))' }} />
                  <span className="text-sm font-bold text-foreground">Stone Area</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}>
                    {stoneUnitTypes.length} type{stoneUnitTypes.length !== 1 ? 's' : ''} · {totalUnits} unit{totalUnits !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Kitchen Total:</span>
                    <span className="text-lg font-bold font-mono" style={{ color: 'hsl(var(--primary))' }}>{grandKitchen}</span>
                    <span className="text-xs text-muted-foreground">sqft</span>
                  </div>
                  <div className="w-px h-6" style={{ background: 'hsl(var(--border))' }} />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Bath Total:</span>
                    <span className="text-lg font-bold font-mono" style={{ color: 'hsl(38 80% 45%)' }}>{grandBath}</span>
                    <span className="text-xs text-muted-foreground">sqft</span>
                  </div>
                  <div className="w-px h-6" style={{ background: 'hsl(var(--border))' }} />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Combined:</span>
                    <span className="text-lg font-bold font-mono text-foreground">{grandKitchen + grandBath}</span>
                    <span className="text-xs text-muted-foreground">sqft</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ProviderToggle value={stoneAiProvider} onChange={setStoneAiProvider} />
                  <button
                    onClick={() => setShowStoneImport(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white transition-colors"
                    style={{ background: 'hsl(var(--primary))' }}
                  >
                    <FileUp size={12} /> Upload Countertop Plans
                  </button>
                  <button
                    onClick={() => { if (confirm('Clear all stone data?')) store.clearStone(); }}
                    className="flex items-center gap-1 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-destructive border border-border hover:border-destructive transition-colors"
                  >
                    <RotateCcw size={11} /> Clear
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="est-card overflow-hidden">
            {/* Header — only show when no data */}
            {store.stoneRows.length === 0 && (
              <div className="est-section-header flex items-center gap-2 flex-wrap">
                <Square size={13} className="flex-shrink-0" />
                Stone Area

                <div className="ml-auto flex items-center gap-2 flex-wrap">
                  <ProviderToggle value={stoneAiProvider} onChange={setStoneAiProvider} />
                  <button
                    onClick={() => setShowStoneImport(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white transition-colors"
                    style={{ background: 'hsl(var(--primary))' }}
                  >
                    <FileUp size={12} /> Upload Countertop Plans
                  </button>
                </div>
              </div>
            )}

            {store.stoneRows.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                No data yet — import 2020 countertop shop drawings to extract stone dimensions.
              </div>
            ) : (
              <div className="space-y-3">
                {/* Global Backsplash Height Controls */}
                <div className="px-5 py-3 rounded-lg border flex items-center gap-8 flex-wrap" style={{ background: 'hsl(var(--secondary) / 0.4)', borderColor: 'hsl(var(--border))' }}>
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    Default Backsplash Height
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] cursor-help" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }} title="Sets the default backsplash height for all types. You can override per-type below.">?</span>
                  </span>
                  <label className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground font-medium">Kitchen:</span>
                    <select
                      className="est-input text-xs w-16 h-8"
                      value={store.kitchenBacksplashHeight}
                      onChange={e => store.setKitchenBacksplashHeight(Number(e.target.value))}
                    >
                      {[0, 2, 3, 4, 5, 6, 8, 10, 12, 18].map(h => (
                        <option key={h} value={h}>{h}"</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground font-medium">Bath:</span>
                    <select
                      className="est-input text-xs w-16 h-8"
                      value={store.bathBacksplashHeight}
                      onChange={e => store.setBathBacksplashHeight(Number(e.target.value))}
                    >
                      {[0, 2, 3, 4, 5, 6, 8, 10, 12, 18].map(h => (
                        <option key={h} value={h}>{h}"</option>
                      ))}
                    </select>
                  </label>
                </div>

                {stoneUnitTypes.map(unitType => {
                  const typeRows = store.stoneRows.filter(r => r.unitType === unitType);
                  if (typeRows.length === 0) return null;
                  const unitCount = store.unitNumbers.filter(u => u.assignments[unitType]).length;

                  const kitchenRows = typeRows.filter(r => r.category === 'kitchen');
                  const bathRows = typeRows.filter(r => r.category === 'bath');

                  type DepthGroup = { depth: number; totalLength: number; totalBsLength: number; rows: PrefinalStoneRow[] };
                  const groupByDepth = (rows: PrefinalStoneRow[]): DepthGroup[] => {
                    const map = new Map<number, DepthGroup>();
                    for (const r of rows) {
                      const existing = map.get(r.depth);
                      if (existing) {
                        existing.totalLength += r.length;
                        existing.totalBsLength += r.backsplashLength;
                        existing.rows.push(r);
                      } else {
                        map.set(r.depth, { depth: r.depth, totalLength: r.length, totalBsLength: r.backsplashLength, rows: [r] });
                      }
                    }
                    return Array.from(map.values()).sort((a, b) => b.depth - a.depth);
                  };

                  const kitchenGroups = groupByDepth(kitchenRows);
                  const bathGroups = groupByDepth(bathRows);

                  const getEffectiveTopInches = (g: DepthGroup, cat: string) => {
                    const key = `${unitType}|${cat}|${g.depth}|topInches`;
                    return store.stoneInchesOverrideMap[key] !== undefined ? store.stoneInchesOverrideMap[key] : g.totalLength;
                  };
                  const getEffectiveBsInches = (g: DepthGroup, cat: string) => {
                    const key = `${unitType}|${cat}|${g.depth}|bsInches`;
                    return store.stoneInchesOverrideMap[key] !== undefined ? store.stoneInchesOverrideMap[key] : g.totalBsLength;
                  };
                  const calcGroupRawTop = (g: DepthGroup, cat: string) => (getEffectiveTopInches(g, cat) * g.depth) / 144;
                  const calcGroupRawBs = (g: DepthGroup, bsHeight: number, cat: string) => (getEffectiveBsInches(g, cat) * bsHeight) / 144;
                  const calcGroupRawSs = (g: DepthGroup, bsHeight: number, ssQty: number) => ssQty > 0 ? (g.depth * bsHeight * ssQty) / 144 : 0;
                  const calcGroupTotalSqft = (g: DepthGroup, bsHeight: number, cat: string) => {
                    const ssQty = store.sidesplashQtyMap[`${unitType}|${cat}|${g.depth}`] || 0;
                    return Math.ceil(calcGroupRawTop(g, cat) + calcGroupRawBs(g, bsHeight, cat) + calcGroupRawSs(g, bsHeight, ssQty));
                  };

                  const typeKitchenBsH = store.getTypeBsHeight(unitType, 'kitchen');
                  const typeBathBsH = store.getTypeBsHeight(unitType, 'bath');

                  const kitchenTotalSqft = kitchenGroups.reduce((s, g) => s + calcGroupTotalSqft(g, typeKitchenBsH, 'kitchen'), 0);
                  const bathTotalSqft = bathGroups.reduce((s, g) => s + calcGroupTotalSqft(g, typeBathBsH, 'bath'), 0);

                  // Accordion state
                  const isExpanded = expandedStoneTypes[unitType] !== false; // default expanded

                  const renderCategoryTable = (
                    label: string,
                    groups: DepthGroup[],
                    bsHeight: number,
                    totalSqft: number,
                    accentColor: string,
                    category: 'kitchen' | 'bath',
                  ) => {
                    if (groups.length === 0) return null;
                    return (
                      <div>
                        <div className="px-4 py-2 text-xs font-bold flex items-center gap-2" style={{ background: `${accentColor.replace(')', ' / 0.12)')}`, color: accentColor }}>
                          {label}
                        </div>
                        <table className="est-table text-xs" style={{ tableLayout: 'fixed' }}>
                          <colgroup>
                            <col style={{ width: '11%' }} />
                            <col style={{ width: '15%' }} />
                            <col style={{ width: '15%' }} />
                            <col style={{ width: '13%' }} />
                            <col style={{ width: '11%' }} />
                            <col style={{ width: '13%' }} />
                            <col style={{ width: '13%' }} />
                            <col style={{ width: '9%' }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="text-left" title="Countertop depth in inches">Depth</th>
                              <th className="text-right" title="Total countertop length in inches (editable)">
                                <span className="flex items-center justify-end gap-1">Top Inches <Pencil size={9} className="opacity-40" /></span>
                              </th>
                              <th className="text-right" title="Backsplash length in inches (editable)">
                                <span className="flex items-center justify-end gap-1">Backsplash In. <Pencil size={9} className="opacity-40" /></span>
                              </th>
                              <th className="text-right" title="Side splash quantity (editable)">
                                <span className="flex items-center justify-end gap-1">Side Splash <Pencil size={9} className="opacity-40" /></span>
                              </th>
                              <th className="text-right" title="Backsplash height in inches">BS Ht.</th>
                              <th className="text-right" title="Countertop area in square feet">Top Sqft</th>
                              <th className="text-right" title="Backsplash + side splash combined area">BS+SS Sqft</th>
                              <th className="text-right font-bold" title="Total square footage">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groups.map((g, gi) => {
                              const topInchesKey = `${unitType}|${category}|${g.depth}|topInches`;
                              const bsInchesKey = `${unitType}|${category}|${g.depth}|bsInches`;
                              const effectiveTopInches = store.stoneInchesOverrideMap[topInchesKey] !== undefined ? store.stoneInchesOverrideMap[topInchesKey] : g.totalLength;
                              const effectiveBsInches = store.stoneInchesOverrideMap[bsInchesKey] !== undefined ? store.stoneInchesOverrideMap[bsInchesKey] : g.totalBsLength;
                              const topRaw = (effectiveTopInches * g.depth) / 144;
                              const bsRaw = (effectiveBsInches * bsHeight) / 144;
                              const ssKey = `${unitType}|${category}|${g.depth}`;
                              const ssQty = store.sidesplashQtyMap[ssKey] || 0;
                              const ssRaw = ssQty > 0 ? (g.depth * bsHeight * ssQty) / 144 : 0;
                              const rowTotal = Math.ceil(topRaw + bsRaw + ssRaw);
                              return (
                                <tr key={gi}>
                                  <td className="font-medium text-foreground">{g.depth}"</td>
                                  <td className="text-right">
                                    <input
                                      type="number"
                                      className="w-full text-right text-xs font-mono px-2 py-1.5 rounded border focus:outline-none focus:ring-1"
                                      style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--primary) / 0.3)', color: 'hsl(var(--foreground))' }}
                                      value={effectiveTopInches || ''}
                                      min={0}
                                      onChange={e => store.setStoneInchesOverride(unitType, category, g.depth, 'topInches', +e.target.value || 0)}
                                      placeholder={String(g.totalLength)}
                                    />
                                  </td>
                                  <td className="text-right">
                                    <input
                                      type="number"
                                      className="w-full text-right text-xs font-mono px-2 py-1.5 rounded border focus:outline-none focus:ring-1"
                                      style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--primary) / 0.3)', color: 'hsl(var(--foreground))' }}
                                      value={effectiveBsInches || ''}
                                      min={0}
                                      onChange={e => store.setStoneInchesOverride(unitType, category, g.depth, 'bsInches', +e.target.value || 0)}
                                      placeholder={String(g.totalBsLength)}
                                    />
                                  </td>
                                  <td className="text-right">
                                    <input
                                      type="number"
                                      className="w-full text-right text-xs font-mono px-2 py-1.5 rounded border focus:outline-none focus:ring-1"
                                      style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--primary) / 0.3)', color: 'hsl(var(--foreground))' }}
                                      value={ssQty || ''}
                                      min={0}
                                      onChange={e => store.setSidesplashQty(unitType, category, g.depth, +e.target.value || 0)}
                                      placeholder="0"
                                    />
                                  </td>
                                  {/* Computed values — gray background, no border */}
                                  <td className="text-right font-mono text-muted-foreground" style={{ background: 'hsl(var(--muted) / 0.5)' }}>{bsHeight}"</td>
                                  <td className="text-right font-mono text-muted-foreground" style={{ background: 'hsl(var(--muted) / 0.5)' }}>{Math.round(topRaw)}</td>
                                  <td className="text-right font-mono text-muted-foreground" style={{ background: 'hsl(var(--muted) / 0.5)' }}>{Math.round(bsRaw + ssRaw)}</td>
                                  <td className="text-right font-bold font-mono" style={{ background: 'hsl(var(--muted) / 0.5)', color: accentColor }}>{rowTotal}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{ background: 'hsl(var(--secondary) / 0.6)' }}>
                              <td className="text-left font-bold text-xs">Total</td>
                              <td className="text-right font-mono font-bold text-xs">{groups.reduce((s, g) => s + getEffectiveTopInches(g, category), 0)}</td>
                              <td className="text-right font-mono font-bold text-xs">{groups.reduce((s, g) => s + getEffectiveBsInches(g, category), 0)}</td>
                              <td></td>
                              <td className="text-right font-mono text-xs">{bsHeight}"</td>
                              <td className="text-right font-mono font-bold text-xs">{Math.round(groups.reduce((s, g) => s + calcGroupRawTop(g, category), 0))}</td>
                              <td className="text-right font-mono font-bold text-xs">{Math.round(groups.reduce((s, g) => s + calcGroupRawBs(g, bsHeight, category) + calcGroupRawSs(g, bsHeight, store.sidesplashQtyMap[`${unitType}|${category}|${g.depth}`] || 0), 0))}</td>
                              <td className="text-right font-bold text-sm" style={{ color: accentColor }}>{totalSqft}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    );
                  };

                  return (
                    <div key={unitType} className="rounded-lg border overflow-hidden" style={{ borderColor: 'hsl(var(--border))' }}>
                      {/* Accordion header — clickable */}
                      <button
                        onClick={() => setExpandedStoneTypes(prev => ({ ...prev, [unitType]: !isExpanded }))}
                        className="w-full px-5 py-3 flex items-center justify-between transition-colors hover:opacity-90"
                        style={{ background: 'hsl(var(--primary) / 0.12)', color: 'hsl(var(--primary))' }}
                      >
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span className="text-sm font-bold" style={{ color: 'hsl(var(--primary))' }}>{unitType}</span>
                          {unitCount > 0 && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'hsl(var(--primary) / 0.15)', color: 'hsl(var(--primary))' }}>
                              {unitCount} unit{unitCount !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        {/* Summary chips — always visible */}
                        <div className="flex items-center gap-3 text-xs">
                          {kitchenTotalSqft > 0 && (
                            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold" style={{ background: 'hsl(213 60% 50% / 0.1)', color: 'hsl(213 60% 50%)' }}>
                              🍳 Kitchen: {kitchenTotalSqft} sqft
                            </span>
                          )}
                          {bathTotalSqft > 0 && (
                            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold" style={{ background: 'hsl(38 80% 45% / 0.1)', color: 'hsl(38 80% 45%)' }}>
                              🚿 Bath: {bathTotalSqft} sqft
                            </span>
                          )}
                          {unitCount > 0 && (
                            <span className="font-bold text-foreground">
                              × {unitCount} = {(kitchenTotalSqft + bathTotalSqft) * unitCount} sqft
                            </span>
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-1 pb-3">
                          {/* Per-type BS height overrides */}
                          <div className="px-4 py-2.5 mx-3 mt-3 mb-2 rounded-md flex items-center gap-8 flex-wrap" style={{ background: 'hsl(var(--muted) / 0.4)' }}>
                            <span className="text-xs text-muted-foreground font-semibold">Backsplash Height Override:</span>
                            {kitchenGroups.length > 0 && (
                              <label className="flex items-center gap-2 text-xs">
                                <span className="text-muted-foreground font-medium">Kitchen:</span>
                                <select
                                  className="est-input text-xs w-16 h-8"
                                  value={typeKitchenBsH}
                                  onChange={e => store.setTypeBacksplashHeight(unitType, 'kitchen', Number(e.target.value))}
                                >
                                  {[0, 2, 3, 4, 5, 6, 8, 10, 12, 18].map(h => (
                                    <option key={h} value={h}>{h}"</option>
                                  ))}
                                </select>
                              </label>
                            )}
                            {bathGroups.length > 0 && (
                              <label className="flex items-center gap-2 text-xs">
                                <span className="text-muted-foreground font-medium">Bath:</span>
                                <select
                                  className="est-input text-xs w-16 h-8"
                                  value={typeBathBsH}
                                  onChange={e => store.setTypeBacksplashHeight(unitType, 'bath', Number(e.target.value))}
                                >
                                  {[0, 2, 3, 4, 5, 6, 8, 10, 12, 18].map(h => (
                                    <option key={h} value={h}>{h}"</option>
                                  ))}
                                </select>
                              </label>
                            )}
                          </div>

                          <div className="flex gap-3 px-3" style={{ alignItems: 'flex-start' }}>
                            <div className="flex-1 min-w-0">
                              {renderCategoryTable('🍳 Kitchen Tops', kitchenGroups, typeKitchenBsH, kitchenTotalSqft, 'hsl(213 60% 50%)', 'kitchen')}
                            </div>
                            <div className="flex-1 min-w-0">
                              {renderCategoryTable('🚿 Bath / Vanity Tops', bathGroups, typeBathBsH, bathTotalSqft, 'hsl(38 80% 45%)', 'bath')}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Type-wise SQFT Summary */}
                <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'hsl(var(--border))' }}>
                  <div className="px-5 py-3" style={{ background: 'hsl(var(--secondary))' }}>
                    <span className="text-xs font-bold text-foreground uppercase tracking-wider">Area Summary by Type</span>
                  </div>
                  <table className="est-table text-xs w-full" style={{ tableLayout: 'fixed' }}>
                    <colgroup>
                      <col style={{ width: '22%' }} />
                      <col style={{ width: '10%' }} />
                      <col style={{ width: '17%' }} />
                      <col style={{ width: '17%' }} />
                      <col style={{ width: '17%' }} />
                      <col style={{ width: '17%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className="text-left">Type</th>
                        <th className="text-right">Units</th>
                        <th className="text-right" title="Kitchen sqft per unit type">Kitchen Sqft</th>
                        <th className="text-right" title="Kitchen sqft × number of units">Kitchen × Units</th>
                        <th className="text-right" title="Bath sqft per unit type">Bath Sqft</th>
                        <th className="text-right" title="Bath sqft × number of units">Bath × Units</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allTypeData.map(d => (
                        <tr key={d.type}>
                          <td className="font-bold">{d.type}</td>
                          <td className="text-right font-mono" style={{ background: 'hsl(var(--muted) / 0.5)' }}>{d.unitCount}</td>
                          <td className="text-right font-mono" style={{ background: 'hsl(var(--muted) / 0.5)' }}>{d.kSqft}</td>
                          <td className="text-right font-bold font-mono" style={{ color: 'hsl(var(--primary))' }}>{d.kSqft * d.unitCount}</td>
                          <td className="text-right font-mono" style={{ background: 'hsl(var(--muted) / 0.5)' }}>{d.bSqft}</td>
                          <td className="text-right font-bold font-mono" style={{ color: 'hsl(38 80% 45%)' }}>{d.bSqft * d.unitCount}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'hsl(var(--secondary) / 0.8)' }}>
                        <td className="font-bold text-sm">Grand Total</td>
                        <td></td>
                        <td></td>
                        <td className="text-right text-base font-bold font-mono" style={{ color: 'hsl(var(--primary))' }}>{grandKitchen}</td>
                        <td></td>
                        <td className="text-right text-base font-bold font-mono" style={{ color: 'hsl(38 80% 45%)' }}>{grandBath}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* LAMINATE LFT SUB-TAB                                                */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeSubTab === 'laminate' && (
        <>
          {laminateImportedCount !== null && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white" style={{ background: 'hsl(142 71% 45%)' }}>
              ✓ Successfully imported {laminateImportedCount} countertop section{laminateImportedCount !== 1 ? 's' : ''}
            </div>
          )}

          <div className="est-card overflow-hidden">
            <div className="est-section-header flex items-center gap-2 flex-wrap">
              <Layers size={13} className="flex-shrink-0" />
              P-Laminate KTOP

              <div className="ml-auto flex items-center gap-2 flex-wrap">
                <ProviderToggle value={stoneAiProvider} onChange={setStoneAiProvider} />
                <button
                  onClick={() => setShowLaminateImport(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white transition-colors"
                  style={{ background: 'hsl(142 50% 50%)' }}
                >
                  <FileUp size={12} /> Upload 2020 Ctop plans
                </button>
                {store.laminateRows.length > 0 && (
                  <button
                    onClick={() => { if (confirm('Clear all laminate data?')) store.clearLaminate(); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-destructive border border-border hover:border-destructive transition-colors"
                  >
                    <RotateCcw size={11} /> Clear
                  </button>
                )}
              </div>
            </div>

            {store.laminateRows.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                No data yet — import 2020 countertop shop drawings to extract laminate LFT dimensions.
              </div>
            ) : (
              <div className="overflow-x-auto">
                {(() => {
                  const lamUnitTypes = (() => {
                    const seen = new Set<string>();
                    return store.laminateUnitTypes.filter(t => {
                      const key = t.toUpperCase().replace(/^TYPE\s+/, '').replace(/\s+/g, '').replace(/-/g, '').trim();
                      if (seen.has(key)) return false;
                      seen.add(key);
                      return true;
                    });
                  })();

                  // Slab assignment: pick single slab size (8,10,12) that minimizes waste for total LFT
                  const SLAB_SIZES = [8, 10, 12];
                  const calcSlabUsage = (totalLft: number): { size: number; qty: number; totalSlabLft: number } => {
                    if (totalLft <= 0) return { size: 8, qty: 0, totalSlabLft: 0 };
                    let best = { size: 8, qty: Math.ceil(totalLft / 8), totalSlabLft: Math.ceil(totalLft / 8) * 8 };
                    for (const size of SLAB_SIZES) {
                      const qty = Math.ceil(totalLft / size);
                      const total = qty * size;
                      if (total < best.totalSlabLft || (total === best.totalSlabLft && size < best.size)) {
                        best = { size, qty, totalSlabLft: total };
                      }
                    }
                    return best;
                  };

                  return (
                    <>
                      {lamUnitTypes.map(unitType => {
                        const typeRows = store.laminateRows.filter(r => r.unitType === unitType);
                        if (typeRows.length === 0) return null;
                        const unitCount = store.unitNumbers.filter(u => u.assignments[unitType]).length;

                        // Split into KTOP (non-island) and BARTOP (island)
                        const ktopPieces = typeRows.filter(r => !r.isIsland);
                        const bartopPieces = typeRows.filter(r => r.isIsland);

                        // Calculate LFT per piece (round up inches/12)
                        const ktopLfts = ktopPieces.map(r => Math.ceil(r.length / 12));
                        const bartopLfts = bartopPieces.map(r => Math.ceil(r.length / 12));

                        const ktopTotalLft = ktopLfts.reduce((s, v) => s + v, 0);
                        const bartopTotalLft = bartopLfts.reduce((s, v) => s + v, 0);

                        const ktopSlab = calcSlabUsage(ktopTotalLft);
                        const bartopSlab = calcSlabUsage(bartopTotalLft);

                        const ssQty = store.laminateManualMap[`${unitType}|ssQty`] || 0;

                        return (
                          <div key={unitType} className="mb-4">
                            <div className="px-4 py-2 flex items-center justify-between" style={{ background: 'hsl(142 40% 75%)', color: '#1a3a2a' }}>
                              <span className="text-xs font-bold">{unitType}</span>
                              {unitCount > 0 && (
                                <span className="text-xs">× {unitCount} units</span>
                              )}
                            </div>
                            <table className="est-table text-xs w-full" style={{ tableLayout: 'fixed' }}>
                              <colgroup>
                                <col style={{ width: '16%' }} />
                                <col style={{ width: '14%' }} />
                                <col style={{ width: '14%' }} />
                                <col style={{ width: '16%' }} />
                                <col style={{ width: '14%' }} />
                                <col style={{ width: '14%' }} />
                                <col style={{ width: '12%' }} />
                              </colgroup>
                              <thead>
                                <tr>
                                  <th className="text-center text-[10px] leading-tight" style={{ background: 'hsl(142 40% 90%)' }}>KTOP LFT<br/>CALC</th>
                                  <th className="text-center text-[10px] leading-tight" style={{ background: 'hsl(142 40% 90%)' }}>KTOP SLAB<br/>USAGE</th>
                                  <th className="text-center text-[10px] leading-tight" style={{ background: 'hsl(142 40% 90%)' }}>KTOP SLAB<br/>LFT CALC</th>
                                  <th className="text-center text-[10px] leading-tight" style={{ background: 'hsl(38 70% 90%)' }}>BARTOP<br/>LFT CALC</th>
                                  <th className="text-center text-[10px] leading-tight" style={{ background: 'hsl(38 70% 90%)' }}>BARTOP SLAB<br/>USAGE</th>
                                  <th className="text-center text-[10px] leading-tight" style={{ background: 'hsl(38 70% 90%)' }}>BARTOP SLAB<br/>LFT CALC</th>
                                  <th className="text-center text-[10px] leading-tight" style={{ background: 'hsl(280 30% 90%)' }}>KTOP SS<br/>QTY</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td className="text-center font-mono text-xs">
                                    {ktopLfts.length > 0 ? ktopLfts.join('+') : '—'}
                                  </td>
                                  <td className="text-center font-mono text-xs font-bold">
                                    {ktopSlab.qty > 0 ? `${ktopSlab.size}X${ktopSlab.qty}` : '—'}
                                  </td>
                                  <td className="text-center font-mono text-xs">
                                    {ktopSlab.totalSlabLft || '—'}
                                  </td>
                                  <td className="text-center font-mono text-xs">
                                    {bartopLfts.length > 0 ? bartopLfts.join('+') : '—'}
                                  </td>
                                  <td className="text-center font-mono text-xs font-bold">
                                    {bartopSlab.qty > 0 ? `${bartopSlab.size}X${bartopSlab.qty}` : '—'}
                                  </td>
                                  <td className="text-center font-mono text-xs">
                                    {bartopSlab.totalSlabLft || '—'}
                                  </td>
                                  <td className="text-center">
                                    <input
                                      type="number"
                                      min={0}
                                      className="est-input w-14 text-xs text-center font-mono"
                                      value={ssQty || ''}
                                      onChange={e => store.setLaminateManual(unitType, 'ssQty', +e.target.value || 0)}
                                      placeholder="0"
                                    />
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        );
                      })}

                      {/* Summary */}
                      <div className="px-4 py-4 border-t-2 border-border">
                        <div className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Laminate LFT Summary by Type</div>
                        <table className="est-table text-xs w-full" style={{ tableLayout: 'fixed' }}>
                          <colgroup>
                            <col style={{ width: '30%' }} />
                            <col style={{ width: '15%' }} />
                            <col style={{ width: '20%' }} />
                            <col style={{ width: '20%' }} />
                            <col style={{ width: '15%' }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="text-left">Type</th>
                              <th className="text-right">Units</th>
                              <th className="text-right">KTOP Slab Usage</th>
                              <th className="text-right">BARTOP Slab Usage</th>
                              <th className="text-right">SS QTY</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lamUnitTypes.map(type => {
                              const unitCount = store.unitNumbers.filter(u => u.assignments[type]).length || 1;
                              const typeRows = store.laminateRows.filter(r => r.unitType === type);
                              const ktopLft = typeRows.filter(r => !r.isIsland).reduce((s, r) => s + Math.ceil(r.length / 12), 0);
                              const bartopLft = typeRows.filter(r => r.isIsland).reduce((s, r) => s + Math.ceil(r.length / 12), 0);
                              const kSlab = calcSlabUsage(ktopLft);
                              const bSlab = calcSlabUsage(bartopLft);
                              const ssQty = store.laminateManualMap[`${type}|ssQty`] || 0;
                              return (
                                <tr key={type}>
                                  <td className="font-bold">{type}</td>
                                  <td className="text-right font-mono">{unitCount}</td>
                                  <td className="text-right font-mono">{kSlab.qty > 0 ? `${kSlab.size}'×${kSlab.qty}` : '—'}</td>
                                  <td className="text-right font-mono">{bSlab.qty > 0 ? `${bSlab.size}'×${bSlab.qty}` : '—'}</td>
                                  <td className="text-right font-mono">{ssQty || '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* CMARBLE/SWAN VTOP SUB-TAB                                          */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeSubTab === 'cmarble' && (
        <>
          {vtopImportedCount !== null && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white" style={{ background: 'hsl(280 45% 58%)' }}>
              ✓ Successfully imported {vtopImportedCount} vanity top{vtopImportedCount !== 1 ? 's' : ''}
            </div>
          )}

          <div className="est-card overflow-hidden">
            <div className="est-section-header flex items-center gap-2 flex-wrap">
              🛁 Cmarble/Swan Vtop

              <div className="ml-auto flex items-center gap-2 flex-wrap">
                <ProviderToggle value={vtopAiProvider} onChange={setVtopAiProvider} />
                <button
                  onClick={() => setShowVtopImport(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white transition-colors"
                  style={{ background: 'hsl(280 45% 58%)' }}
                >
                  <FileUp size={12} /> Upload 2020 Ctop plans
                </button>
                {store.vtopRows.length > 0 && (
                  <button
                    onClick={() => { if (confirm('Clear all Cmarble/Swan Vtop data?')) store.clearVtops(); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-destructive border border-border hover:border-destructive transition-colors"
                  >
                    <RotateCcw size={11} /> Clear
                  </button>
                )}
              </div>
            </div>

            {store.vtopRows.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                No data yet — import 2020 countertop shop drawings to extract vanity top sizes.
              </div>
            ) : (
              <div className="overflow-x-auto">
                {(() => {
                  const vtopUnitTypes = (() => {
                    const seen = new Set<string>();
                    return store.vtopUnitTypes.filter(t => {
                      const key = t.toUpperCase().replace(/^TYPE\s+/, '').replace(/\s+/g, '').replace(/-/g, '').trim();
                      if (seen.has(key)) return false;
                      seen.add(key);
                      return true;
                    });
                  })();

                  return (
                    <>
                      {vtopUnitTypes.map(unitType => {
                        const typeRows = store.vtopRows.filter(r => r.unitType === unitType);
                        if (typeRows.length === 0) return null;
                        const unitCount = store.unitNumbers.filter(u => u.assignments[unitType]).length;

                        return (
                          <div key={unitType} className="mb-4">
                            <div className="px-4 py-2 flex items-center justify-between" style={{ background: 'hsl(280 40% 80%)', color: '#3a1a4a' }}>
                              <span className="text-xs font-bold">{unitType}</span>
                              {unitCount > 0 && (
                                <span className="text-xs">× {unitCount} units</span>
                              )}
                            </div>
                            <table className="est-table text-xs w-full">
                              <thead>
                                <tr>
                                  <th className="text-left text-[10px]" style={{ width: '5%' }}>#</th>
                                  <th className="text-left text-[10px]" style={{ width: '45%' }}>VTop SKU</th>
                                  <th className="text-center text-[10px]" style={{ width: '10%' }}>QTY</th>
                                  <th className="text-left text-[10px]" style={{ width: '35%' }}>Sidesplash</th>
                                  <th style={{ width: '5%' }}></th>
                                </tr>
                              </thead>
                              <tbody>
                                {typeRows.map((row, idx) => {
                                  const sku = formatVtopSku({ ...row, selected: true });
                                  const ssItems = getVtopSidesplashItems({ ...row, selected: true });
                                  return (
                                    <tr key={idx}>
                                      <td className="text-muted-foreground">{idx + 1}</td>
                                      <td className="font-mono text-[10px] font-bold">{sku}</td>
                                      <td className="text-center font-mono">1</td>
                                      <td className="text-[10px]">
                                        {ssItems.length > 0
                                          ? ssItems.map((s, i) => <div key={i}>{s} — 1 qty</div>)
                                          : <span className="text-muted-foreground">None</span>}
                                      </td>
                                      <td>
                                        <button
                                          onClick={() => store.deleteVtopRow(unitType, idx)}
                                          className="p-1 hover:text-destructive"
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        );
                      })}

                      {/* Summary */}
                      <div className="px-4 py-4 border-t-2 border-border">
                        <div className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Vtop Summary by Type</div>
                        <table className="est-table text-xs w-full" style={{ tableLayout: 'fixed' }}>
                          <colgroup>
                            <col style={{ width: '30%' }} />
                            <col style={{ width: '15%' }} />
                            <col style={{ width: '15%' }} />
                            <col style={{ width: '20%' }} />
                            <col style={{ width: '20%' }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="text-left">Type</th>
                              <th className="text-right">Units</th>
                              <th className="text-right">Vtops</th>
                              <th className="text-right">Total Vtops</th>
                              <th className="text-right">Total SS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {vtopUnitTypes.map(type => {
                              const unitCount = store.unitNumbers.filter(u => u.assignments[type]).length || 1;
                              const typeRows = store.vtopRows.filter(r => r.unitType === type);
                              const vtopCount = typeRows.length;
                              const ssCount = typeRows.reduce((s, r) => s + (r.leftWall ? 1 : 0) + (r.rightWall ? 1 : 0), 0);
                              return (
                                <tr key={type}>
                                  <td className="font-bold">{type}</td>
                                  <td className="text-right font-mono">{unitCount}</td>
                                  <td className="text-right font-mono">{vtopCount}</td>
                                  <td className="text-right font-mono font-bold" style={{ color: 'hsl(280 45% 58%)' }}>{vtopCount * unitCount}</td>
                                  <td className="text-right font-mono font-bold" style={{ color: 'hsl(280 45% 58%)' }}>{ssCount * unitCount}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
