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

interface PrefinalData {
  unitTypes: string[];
  unitNumbers: PrefinalUnitNumber[];
  cabinetRows: PrefinalCabinetRow[];
  cabinetUnitTypes: string[];
}

function loadData(projectId: string): PrefinalData {
  try {
    const raw = localStorage.getItem(`prefinal_${projectId}`);
    if (!raw) return { unitTypes: [], unitNumbers: [], cabinetRows: [], cabinetUnitTypes: [] };
    const parsed = JSON.parse(raw);
    // Migration: old format had unitRows
    if (parsed.unitRows && !parsed.unitTypes) {
      return {
        unitTypes: parsed.unitRows.map((r: any) => r.unitType),
        unitNumbers: [],
        cabinetRows: parsed.cabinetRows || [],
        cabinetUnitTypes: parsed.cabinetUnitTypes || [],
      };
    }
    // Deduplicate cabinetUnitTypes (normalize: strip TYPE prefix, uppercase, collapse all whitespace & hyphens)
    const rawCabTypes: string[] = parsed.cabinetUnitTypes || [];
    const seenNorm = new Set<string>();
    const dedupedCabTypes = rawCabTypes.filter(t => {
      const key = t.toUpperCase().replace(/^TYPE\s+/, '').replace(/\s+/g, '').replace(/-/g, '').trim();
      if (seenNorm.has(key)) return false;
      seenNorm.add(key);
      return true;
    });
    const unitNumbers = (parsed.unitNumbers || []).map((u: any) => ({ ...u, floor: u.floor || '' }));
    return { unitTypes: parsed.unitTypes || [], unitNumbers, cabinetRows: parsed.cabinetRows || [], cabinetUnitTypes: dedupedCabTypes };
  } catch {
    return { unitTypes: [], unitNumbers: [], cabinetRows: [], cabinetUnitTypes: [] };
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
      const existingNames = new Set(prev.unitNumbers.map(u => u.name));
      const newUnits: PrefinalUnitNumber[] = [];
      for (const m of mappings) {
        if (existingNames.has(m.unitNumber)) {
          const idx = prev.unitNumbers.findIndex(u => u.name === m.unitNumber);
          if (idx >= 0) {
            prev.unitNumbers[idx] = {
              ...prev.unitNumbers[idx],
              bldg: m.bldg || prev.unitNumbers[idx].bldg || '',
              floor: m.floor || prev.unitNumbers[idx].floor || '',
              assignments: { ...prev.unitNumbers[idx].assignments, [m.unitType]: true },
            };
          }
        } else {
          existingNames.add(m.unitNumber);
          newUnits.push({ name: m.unitNumber, bldg: m.bldg || '', floor: m.floor || '', assignments: { [m.unitType]: true } });
        }
      }
      const unitNumbers = [...prev.unitNumbers, ...newUnits];
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

  const clearAll = useCallback(() => {
    commit({ unitTypes: [], unitNumbers: [], cabinetRows: [], cabinetUnitTypes: [] });
  }, [commit]);

  return {
    unitTypes: data.unitTypes,
    unitNumbers: data.unitNumbers,
    cabinetRows: data.cabinetRows,
    cabinetUnitTypes: data.cabinetUnitTypes,
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
    clearAll,
  };
}
