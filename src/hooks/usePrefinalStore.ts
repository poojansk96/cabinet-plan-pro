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
  stoneRows: PrefinalStoneRow[];
  stoneUnitTypes: string[];
}

function loadData(projectId: string): PrefinalData {
  try {
    const raw = localStorage.getItem(`prefinal_${projectId}`);
    if (!raw) return { unitTypes: [], unitNumbers: [], cabinetRows: [], cabinetUnitTypes: [], handleQtyPerSku: {}, bidCostPerType: {} };
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
    const unitNumbers = (parsed.unitNumbers || []).map((u: any) => ({ ...u, floor: u.floor || '' }));
    return { unitTypes: parsed.unitTypes || [], unitNumbers, cabinetRows, cabinetUnitTypes: dedupedCabTypes, handleQtyPerSku: parsed.handleQtyPerSku || {}, bidCostPerType: parsed.bidCostPerType || {} };
  } catch {
    return { unitTypes: [], unitNumbers: [], cabinetRows: [], cabinetUnitTypes: [], handleQtyPerSku: {}, bidCostPerType: {} };
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
      // Use composite key: unitNumber + bldg to differentiate same unit# across buildings
      const makeKey = (name: string, bldg: string) => `${name.toUpperCase().trim()}__${bldg.toUpperCase().trim()}`;
      const existingKeys = new Map<string, number>();
      prev.unitNumbers.forEach((u, i) => existingKeys.set(makeKey(u.name, u.bldg), i));
      const newUnits: PrefinalUnitNumber[] = [];
      // Clone to avoid mutating prev directly
      const updatedNumbers = prev.unitNumbers.map(u => ({ ...u, assignments: { ...u.assignments } }));
      for (const m of mappings) {
        const key = makeKey(m.unitNumber, m.bldg || '');
        const existingIdx = existingKeys.get(key);
        if (existingIdx !== undefined) {
          updatedNumbers[existingIdx] = {
            ...updatedNumbers[existingIdx],
            bldg: m.bldg || updatedNumbers[existingIdx].bldg || '',
            floor: m.floor || updatedNumbers[existingIdx].floor || '',
            assignments: { ...updatedNumbers[existingIdx].assignments, [m.unitType]: true },
          };
        } else {
          const newUnit: PrefinalUnitNumber = { name: m.unitNumber, bldg: m.bldg || '', floor: m.floor || '', assignments: { [m.unitType]: true } };
          existingKeys.set(key, updatedNumbers.length + newUnits.length);
          newUnits.push(newUnit);
        }
      }
      const unitNumbers = [...updatedNumbers, ...newUnits];
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

  const setBidCost = useCallback((unitType: string, cost: number) => {
    setData(prev => {
      const bidCostPerType = { ...prev.bidCostPerType, [unitType]: cost };
      const next = { ...prev, bidCostPerType };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const clearAll = useCallback(() => {
    commit({ unitTypes: [], unitNumbers: [], cabinetRows: [], cabinetUnitTypes: [], handleQtyPerSku: {}, bidCostPerType: {} });
  }, [commit]);

  return {
    unitTypes: data.unitTypes,
    unitNumbers: data.unitNumbers,
    cabinetRows: data.cabinetRows,
    cabinetUnitTypes: data.cabinetUnitTypes,
    handleQtyPerSku: data.handleQtyPerSku,
    bidCostPerType: data.bidCostPerType,
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
    clearAll,
  };
}
