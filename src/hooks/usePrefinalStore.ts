import { useState, useEffect, useCallback } from 'react';

export interface PrefinalUnitNumber {
  name: string;
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
}

function loadData(projectId: string): PrefinalData {
  try {
    const raw = localStorage.getItem(`prefinal_${projectId}`);
    if (!raw) return { unitTypes: [], unitNumbers: [], cabinetRows: [] };
    const parsed = JSON.parse(raw);
    // Migration: old format had unitRows
    if (parsed.unitRows && !parsed.unitTypes) {
      return {
        unitTypes: parsed.unitRows.map((r: any) => r.unitType),
        unitNumbers: [],
        cabinetRows: parsed.cabinetRows || [],
      };
    }
    return { unitTypes: parsed.unitTypes || [], unitNumbers: parsed.unitNumbers || [], cabinetRows: parsed.cabinetRows || [] };
  } catch {
    return { unitTypes: [], unitNumbers: [], cabinetRows: [] };
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

  // ── Unit Numbers (rows) ───────────────────────────────────────────────
  const addUnitNumber = useCallback((name: string) => {
    setData(prev => {
      const unitNumbers = [...prev.unitNumbers, { name, assignments: {} }];
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
  const importUnitMappings = useCallback((mappings: { unitNumber: string; unitType: string }[]) => {
    setData(prev => {
      const existingNames = new Set(prev.unitNumbers.map(u => u.name));
      const newUnits: PrefinalUnitNumber[] = [];
      for (const m of mappings) {
        if (existingNames.has(m.unitNumber)) {
          // Update existing unit's assignment
          const idx = prev.unitNumbers.findIndex(u => u.name === m.unitNumber);
          if (idx >= 0) {
            prev.unitNumbers[idx] = {
              ...prev.unitNumbers[idx],
              assignments: { ...prev.unitNumbers[idx].assignments, [m.unitType]: true },
            };
          }
        } else {
          existingNames.add(m.unitNumber);
          newUnits.push({ name: m.unitNumber, assignments: { [m.unitType]: true } });
        }
      }
      const unitNumbers = [...prev.unitNumbers, ...newUnits];
      const next = { ...prev, unitNumbers };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  // ── Cabinet imports ───────────────────────────────────────────────────
  const addCabinetImport = useCallback((rows: Omit<PrefinalCabinetRow, never>[], unitType: string) => {
    setData(prev => {
      const merged: Record<string, PrefinalCabinetRow> = {};
      for (const r of prev.cabinetRows) {
        const key = `${r.sku}__${r.type}__${r.room}__${r.unitType}`;
        merged[key] = { ...r };
      }
      for (const r of rows) {
        const key = `${r.sku}__${r.type}__${r.room}__${unitType}`;
        if (merged[key]) merged[key].quantity += r.quantity;
        else merged[key] = { ...r, unitType };
      }
      const cabinetRows = Object.values(merged).sort((a, b) =>
        a.sku.localeCompare(b.sku, undefined, { numeric: true })
      );
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
    commit({ unitTypes: [], unitNumbers: [], cabinetRows: [] });
  }, [commit]);

  return {
    unitTypes: data.unitTypes,
    unitNumbers: data.unitNumbers,
    cabinetRows: data.cabinetRows,
    addUnitTypes,
    deleteUnitType,
    addUnitNumber,
    updateUnitNumberName,
    deleteUnitNumber,
    toggleAssignment,
    importUnitMappings,
    addCabinetImport,
    clearCabinets,
    clearUnits,
    clearAll,
  };
}
