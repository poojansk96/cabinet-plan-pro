import { useState, useEffect, useCallback } from 'react';

export interface PrefinalUnitRow {
  unitType: string;
  count: number;
}

export interface PrefinalCabinetRow {
  sku: string;
  type: string;
  room: string;
  quantity: number;
  unitType: string; // which unit type this was imported for
}

interface PrefinalData {
  unitRows: PrefinalUnitRow[];
  cabinetRows: PrefinalCabinetRow[];
}

function loadData(projectId: string): PrefinalData {
  try {
    const raw = localStorage.getItem(`prefinal_${projectId}`);
    return raw ? JSON.parse(raw) : { unitRows: [], cabinetRows: [] };
  } catch {
    return { unitRows: [], cabinetRows: [] };
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

  const addUnitImport = useCallback((unitType: string, count: number) => {
    setData(prev => {
      const existing = prev.unitRows.find(r => r.unitType === unitType);
      const unitRows = existing
        ? prev.unitRows.map(r => r.unitType === unitType ? { ...r, count: r.count + count } : r)
        : [...prev.unitRows, { unitType, count }];
      const next = { ...prev, unitRows };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const updateUnitRow = useCallback((unitType: string, count: number) => {
    setData(prev => {
      const unitRows = prev.unitRows.map(r => r.unitType === unitType ? { ...r, count } : r);
      const next = { ...prev, unitRows };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const deleteUnitRow = useCallback((unitType: string) => {
    setData(prev => {
      const next = { ...prev, unitRows: prev.unitRows.filter(r => r.unitType !== unitType) };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const addManualUnitRow = useCallback((unitType: string, count: number) => {
    setData(prev => {
      const existing = prev.unitRows.find(r => r.unitType === unitType);
      const unitRows = existing
        ? prev.unitRows.map(r => r.unitType === unitType ? { ...r, count: r.count + count } : r)
        : [...prev.unitRows, { unitType, count }];
      const next = { ...prev, unitRows };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  const addCabinetImport = useCallback((rows: Omit<PrefinalCabinetRow, never>[], unitType: string) => {
    setData(prev => {
      // Merge by sku+type+room+unitType
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
    commit({ ...data, unitRows: [] });
  }, [commit, data]);

  const clearAll = useCallback(() => {
    commit({ unitRows: [], cabinetRows: [] });
  }, [commit]);

  return {
    unitRows: data.unitRows,
    cabinetRows: data.cabinetRows,
    addUnitImport,
    updateUnitRow,
    deleteUnitRow,
    addManualUnitRow,
    addCabinetImport,
    clearCabinets,
    clearUnits,
    clearAll,
  };
}
