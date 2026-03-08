import { useState, useEffect, useCallback } from 'react';

export interface PrefinalUnitNumber {
  name: string;
  bldg: string;
  floor: string;
  assignments: Record<string, boolean>; // unitType -> true/false
}

export interface PrefinalCabinetRow {
  sku: string;
  type: string;
  room: string;
  quantity: number;
  unitType: string;
}

export interface PrefinalStoneRow {
  label: string;
  length: number;       // inches
  depth: number;        // inches
  splashHeight: number | null;
  isIsland: boolean;
  room: string;
  unitType: string;
}

interface PrefinalData {
  unitTypes: string[];
  unitNumbers: PrefinalUnitNumber[];
  cabinetRows: PrefinalCabinetRow[];
  cabinetUnitTypes: string[];
  handleQtyPerSku: Record<string, number>;
  bidCostPerType: Record<string, number>;
  additionalCostPerType: Record<string, number>;
  stoneRows: PrefinalStoneRow[];
  stoneUnitTypes: string[];
}

function normalizeUnitKeyPart(value: string): string {
  return String(value || '').toUpperCase().replace(/\s+/g, '').trim();
}

function normalizeBldgKeyPart(value: string): string {
  const raw = String(value || '').toUpperCase().trim();
  if (!raw) return '';
  return raw
    .replace(/BUILDING/g, 'BLDG')
    .replace(/[^A-Z0-9]/g, '');
}

function makeUnitCompositeKey(name: string, bldg: string): string {
  return `${normalizeUnitKeyPart(name)}__${normalizeBldgKeyPart(bldg)}`;
}

function parseFloorNumber(floor: string): number | null {
  const n = parseInt(String(floor || '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function dedupeUnitNumbers(unitNumbers: PrefinalUnitNumber[]): PrefinalUnitNumber[] {
  const map = new Map<string, PrefinalUnitNumber>();

  for (const unit of unitNumbers) {
    const key = makeUnitCompositeKey(unit.name, unit.bldg);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        ...unit,
        name: String(unit.name || '').trim(),
        bldg: String(unit.bldg || '').trim(),
        floor: String(unit.floor || '').trim(),
        assignments: { ...unit.assignments },
      });
      continue;
    }

    const existingFloorNum = parseFloorNumber(existing.floor);
    const incomingFloorNum = parseFloorNumber(unit.floor);

    const pickedFloor = (() => {
      if (existingFloorNum !== null && incomingFloorNum !== null) return Math.min(existingFloorNum, incomingFloorNum).toString();
      if (existingFloorNum !== null) return existing.floor;
      if (incomingFloorNum !== null) return String(unit.floor || '').trim();
      return existing.floor || String(unit.floor || '').trim();
    })();

    map.set(key, {
      ...existing,
      name: existing.name || String(unit.name || '').trim(),
      bldg: existing.bldg || String(unit.bldg || '').trim(),
      floor: pickedFloor,
      assignments: { ...existing.assignments, ...unit.assignments },
    });
  }

  return Array.from(map.values());
}

function loadData(projectId: string): PrefinalData {
  try {
    const raw = localStorage.getItem(`prefinal_${projectId}`);
    if (!raw) return { unitTypes: [], unitNumbers: [], cabinetRows: [], cabinetUnitTypes: [], handleQtyPerSku: {}, bidCostPerType: {}, additionalCostPerType: {}, stoneRows: [], stoneUnitTypes: [] };
    const parsed = JSON.parse(raw);
    // Migration: old format had unitRows
    if (parsed.unitRows && !parsed.unitTypes) {
      return {
        unitTypes: parsed.unitRows.map((r: any) => r.unitType),
        unitNumbers: [],
        cabinetRows: parsed.cabinetRows || [],
        cabinetUnitTypes: parsed.cabinetUnitTypes || [],
        handleQtyPerSku: parsed.handleQtyPerSku || {},
        bidCostPerType: parsed.bidCostPerType || {},
        additionalCostPerType: parsed.additionalCostPerType || {},
        stoneRows: parsed.stoneRows || [],
        stoneUnitTypes: parsed.stoneUnitTypes || [],
      };
    }
    // Normalize + deduplicate cabinetUnitTypes
    const rawCabTypes: string[] = parsed.cabinetUnitTypes || [];
    const seenNorm = new Set<string>();
    const dedupedCabTypes: string[] = [];
    for (const t of rawCabTypes) {
      // Normalize the stored value: uppercase, collapse spaces around hyphens
      let normalized = t.trim().toUpperCase().replace(/\s*-\s*/g, '-');
      // Strip "TYPE " prefix for dedup key
      const key = normalized.replace(/^TYPE\s+/, '').replace(/\s+/g, '').replace(/-/g, '');
      if (!key || seenNorm.has(key)) continue;
      seenNorm.add(key);
      dedupedCabTypes.push(normalized);
    }
    // Also normalize cabinetRows unitType values to match
    const cabinetRows = (parsed.cabinetRows || []).map((r: any) => ({
      ...r,
      unitType: r.unitType ? r.unitType.trim().toUpperCase().replace(/\s*-\s*/g, '-') : r.unitType,
    }));
    const rawUnitNumbers = (parsed.unitNumbers || []).map((u: any) => ({
      ...u,
      name: String(u.name || '').trim(),
      bldg: String(u.bldg || '').trim(),
      floor: String(u.floor || '').trim(),
      assignments: { ...(u.assignments || {}) },
    }));
    const unitNumbers = dedupeUnitNumbers(rawUnitNumbers);
    return { unitTypes: parsed.unitTypes || [], unitNumbers, cabinetRows, cabinetUnitTypes: dedupedCabTypes, handleQtyPerSku: parsed.handleQtyPerSku || {}, bidCostPerType: parsed.bidCostPerType || {}, additionalCostPerType: parsed.additionalCostPerType || {}, stoneRows: parsed.stoneRows || [], stoneUnitTypes: parsed.stoneUnitTypes || [] };
  } catch {
    return { unitTypes: [], unitNumbers: [], cabinetRows: [], cabinetUnitTypes: [], handleQtyPerSku: {}, bidCostPerType: {}, additionalCostPerType: {}, stoneRows: [], stoneUnitTypes: [] };
  }
}

function saveData(projectId: string, data: PrefinalData) {
  localStorage.setItem(`prefinal_${projectId}`, JSON.stringify(data));
}

export function usePrefinalStore(projectId: string) {
  const [data, setData] = useState<PrefinalData>(() => loadData(projectId));

  useEffect(() => {
    setData(loadData(projectId));
  }, [projectId]);

  const commit = useCallback((next: PrefinalData) => {
    saveData(projectId, next);
    setData(next);
  }, [projectId]);

  // ── Unit Types (columns) ──────────────────────────────────────────────
  const addUnitTypes = useCallback((types: string[]) => {
    setData(prev => {
      const existing = new Set(prev.unitTypes);
      const newTypes = types.filter(t => !existing.has(t));
      if (!newTypes.length) return prev;
      const unitTypes = [...prev.unitTypes, ...newTypes];
      const next = { ...prev, unitTypes };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const deleteUnitType = useCallback((type: string) => {
    setData(prev => {
      const unitTypes = prev.unitTypes.filter(t => t !== type);
      const unitNumbers = prev.unitNumbers.map(u => {
        const assignments = { ...u.assignments };
        delete assignments[type];
        return { ...u, assignments };
      });
      const next = { ...prev, unitTypes, unitNumbers };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const renameUnitType = useCallback((oldName: string, newName: string) => {
    if (!newName.trim() || oldName === newName) return;
    setData(prev => {
      const unitTypes = prev.unitTypes.map(t => t === oldName ? newName : t);
      const unitNumbers = prev.unitNumbers.map(u => {
        const assignments = { ...u.assignments };
        if (oldName in assignments) {
          assignments[newName] = assignments[oldName];
          delete assignments[oldName];
        }
        return { ...u, assignments };
      });
      const cabinetRows = prev.cabinetRows.map(r =>
        r.unitType === oldName ? { ...r, unitType: newName } : r
      );
      const cabinetUnitTypes = prev.cabinetUnitTypes.map(t => t === oldName ? newName : t);
      const next = { ...prev, unitTypes, unitNumbers, cabinetRows, cabinetUnitTypes };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  // ── Unit Numbers (rows) ───────────────────────────────────────────────
  const addUnitNumber = useCallback((name: string, bldg: string = '', floor: string = '') => {
    setData(prev => {
      const unitNumbers = [...prev.unitNumbers, { name, bldg, floor, assignments: {} }];
      const next = { ...prev, unitNumbers };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const updateUnitNumberFloor = useCallback((index: number, floor: string) => {
    setData(prev => {
      const unitNumbers = prev.unitNumbers.map((u, i) => i === index ? { ...u, floor } : u);
      const next = { ...prev, unitNumbers };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const updateUnitNumberName = useCallback((index: number, name: string) => {
    setData(prev => {
      const unitNumbers = prev.unitNumbers.map((u, i) => i === index ? { ...u, name } : u);
      const next = { ...prev, unitNumbers };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const updateUnitNumberBldg = useCallback((index: number, bldg: string) => {
    setData(prev => {
      const unitNumbers = prev.unitNumbers.map((u, i) => i === index ? { ...u, bldg } : u);
      const next = { ...prev, unitNumbers };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const deleteUnitNumber = useCallback((index: number) => {
    setData(prev => {
      const unitNumbers = prev.unitNumbers.filter((_, i) => i !== index);
      const next = { ...prev, unitNumbers };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const toggleAssignment = useCallback((unitIndex: number, unitType: string) => {
    setData(prev => {
      const unitNumbers = prev.unitNumbers.map((u, i) => {
        if (i !== unitIndex) return u;
        const assignments = { ...u.assignments };
        assignments[unitType] = !assignments[unitType];
        return { ...u, assignments };
      });
      const next = { ...prev, unitNumbers };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  // ── Import unit mappings (unit# → type with "1" assignment) ────────────
  const importUnitMappings = useCallback((mappings: { unitNumber: string; unitType: string; bldg?: string; floor?: string }[]) => {
    setData(prev => {
      const baseUnits = dedupeUnitNumbers(
        prev.unitNumbers.map(u => ({ ...u, assignments: { ...u.assignments } }))
      );

      const existingKeys = new Map<string, number>();
      baseUnits.forEach((u, i) => existingKeys.set(makeUnitCompositeKey(u.name, u.bldg), i));

      const updatedNumbers = [...baseUnits];
      for (const m of mappings) {
        const key = makeUnitCompositeKey(m.unitNumber, m.bldg || '');
        const existingIdx = existingKeys.get(key);

        if (existingIdx !== undefined) {
          const current = updatedNumbers[existingIdx];
          const currentFloorNum = parseFloorNumber(current.floor);
          const incomingFloorNum = parseFloorNumber(m.floor || '');
          const mergedFloor = (() => {
            if (currentFloorNum !== null && incomingFloorNum !== null) return String(Math.min(currentFloorNum, incomingFloorNum));
            if (currentFloorNum !== null) return current.floor;
            return (m.floor || '').trim() || current.floor || '';
          })();

          updatedNumbers[existingIdx] = {
            ...current,
            name: current.name || String(m.unitNumber || '').trim(),
            bldg: current.bldg || String(m.bldg || '').trim(),
            floor: mergedFloor,
            assignments: { ...current.assignments, [m.unitType]: true },
          };
        } else {
          updatedNumbers.push({
            name: String(m.unitNumber || '').trim(),
            bldg: String(m.bldg || '').trim(),
            floor: String(m.floor || '').trim(),
            assignments: { [m.unitType]: true },
          });
          existingKeys.set(key, updatedNumbers.length - 1);
        }
      }

      const unitNumbers = dedupeUnitNumbers(updatedNumbers);
      const next = { ...prev, unitNumbers };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  // ── Cabinet Unit Types (independent columns for cabinet section) ────────
  const addCabinetUnitTypes = useCallback((types: string[]) => {
    setData(prev => {
      const normalizeKey = (t: string) => t.toUpperCase().replace(/^TYPE\s+/, '').replace(/\s+/g, '').replace(/-/g, '').trim();
      const existingKeys = new Set(prev.cabinetUnitTypes.map(t => normalizeKey(t)));
      const newTypes = types.filter(t => {
        const key = normalizeKey(t);
        if (!key || existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      });
      if (!newTypes.length) return prev;
      const cabinetUnitTypes = [...prev.cabinetUnitTypes, ...newTypes];
      const next = { ...prev, cabinetUnitTypes };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const deleteCabinetUnitType = useCallback((type: string) => {
    setData(prev => {
      const cabinetUnitTypes = prev.cabinetUnitTypes.filter(t => t !== type);
      const cabinetRows = prev.cabinetRows.filter(r => r.unitType !== type);
      const next = { ...prev, cabinetUnitTypes, cabinetRows };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  // ── Cabinet imports ───────────────────────────────────────────────────
  const addCabinetImport = useCallback((rows: Omit<PrefinalCabinetRow, never>[], unitType: string) => {
    setData(prev => {
      const merged: Record<string, PrefinalCabinetRow> = {};
      for (const r of prev.cabinetRows) {
        const key = `${r.sku}__${r.room}__${r.unitType}`;
        merged[key] = { ...r };
      }
      for (const r of rows) {
        const key = `${r.sku}__${r.room}__${unitType}`;
        if (merged[key]) {
          merged[key].quantity = Math.max(merged[key].quantity, r.quantity);
        } else {
          merged[key] = { ...r, unitType };
        }
      }
      const cabinetRows = Object.values(merged).sort((a, b) =>
        a.sku.localeCompare(b.sku, undefined, { numeric: true })
      );
      const next = { ...prev, cabinetRows };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const deleteCabinetRow = useCallback((sku: string) => {
    setData(prev => {
      const cabinetRows = prev.cabinetRows.filter(r => r.sku !== sku);
      const next = { ...prev, cabinetRows };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const clearCabinets = useCallback(() => {
    commit({ ...data, cabinetRows: [] });
  }, [commit, data]);

  const clearUnits = useCallback(() => {
    commit({ ...data, unitTypes: [], unitNumbers: [] });
  }, [commit, data]);

  const setHandleQty = useCallback((sku: string, qty: number) => {
    setData(prev => {
      const handleQtyPerSku = { ...prev.handleQtyPerSku, [sku]: qty };
      const next = { ...prev, handleQtyPerSku };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const setAdditionalCost = useCallback((unitType: string, cost: number) => {
    setData(prev => {
      const additionalCostPerType = { ...prev.additionalCostPerType, [unitType]: cost };
      const next = { ...prev, additionalCostPerType };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const setBidCost = useCallback((unitType: string, cost: number) => {
    setData(prev => {
      const bidCostPerType = { ...prev.bidCostPerType, [unitType]: cost };
      const next = { ...prev, bidCostPerType };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  // ── Stone (Countertop) imports ──────────────────────────────────────────
  const addStoneUnitTypes = useCallback((types: string[]) => {
    setData(prev => {
      const normalizeKey = (t: string) => t.toUpperCase().replace(/^TYPE\s+/, '').replace(/\s+/g, '').replace(/-/g, '').trim();
      const existingKeys = new Set(prev.stoneUnitTypes.map(t => normalizeKey(t)));
      const newTypes = types.filter(t => {
        const key = normalizeKey(t);
        if (!key || existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      });
      if (!newTypes.length) return prev;
      const stoneUnitTypes = [...prev.stoneUnitTypes, ...newTypes];
      const next = { ...prev, stoneUnitTypes };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const deleteStoneUnitType = useCallback((type: string) => {
    setData(prev => {
      const stoneUnitTypes = prev.stoneUnitTypes.filter(t => t !== type);
      const stoneRows = prev.stoneRows.filter(r => r.unitType !== type);
      const next = { ...prev, stoneUnitTypes, stoneRows };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const addStoneImport = useCallback((rows: PrefinalStoneRow[], unitType: string) => {
    setData(prev => {
      // Replace all rows for this unitType
      const existingOther = prev.stoneRows.filter(r => r.unitType !== unitType);
      const stoneRows = [...existingOther, ...rows.map(r => ({ ...r, unitType }))];
      const next = { ...prev, stoneRows };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const deleteStoneRow = useCallback((unitType: string, index: number) => {
    setData(prev => {
      let typeIdx = 0;
      const stoneRows = prev.stoneRows.filter(r => {
        if (r.unitType !== unitType) return true;
        return typeIdx++ !== index;
      });
      const next = { ...prev, stoneRows };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const clearStone = useCallback(() => {
    commit({ ...data, stoneRows: [], stoneUnitTypes: [] });
  }, [commit, data]);

  const clearAll = useCallback(() => {
    commit({ unitTypes: [], unitNumbers: [], cabinetRows: [], cabinetUnitTypes: [], handleQtyPerSku: {}, bidCostPerType: {}, additionalCostPerType: {}, stoneRows: [], stoneUnitTypes: [] });
  }, [commit]);

  return {
    unitTypes: data.unitTypes,
    unitNumbers: data.unitNumbers,
    cabinetRows: data.cabinetRows,
    cabinetUnitTypes: data.cabinetUnitTypes,
    handleQtyPerSku: data.handleQtyPerSku,
    bidCostPerType: data.bidCostPerType,
    additionalCostPerType: data.additionalCostPerType,
    stoneRows: data.stoneRows,
    stoneUnitTypes: data.stoneUnitTypes,
    addUnitTypes,
    deleteUnitType,
    renameUnitType,
    addUnitNumber,
    updateUnitNumberName,
    updateUnitNumberBldg,
    updateUnitNumberFloor,
    deleteUnitNumber,
    toggleAssignment,
    importUnitMappings,
    addCabinetUnitTypes,
    deleteCabinetUnitType,
    addCabinetImport,
    deleteCabinetRow,
    clearCabinets,
    clearUnits,
    setHandleQty,
    setBidCost,
    setAdditionalCost,
    addStoneUnitTypes,
    deleteStoneUnitType,
    addStoneImport,
    deleteStoneRow,
    clearStone,
    clearAll,
  };
}
