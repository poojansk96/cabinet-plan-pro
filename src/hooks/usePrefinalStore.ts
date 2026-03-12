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

function sanitizeUnitNumber(value: string): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[,:;]+$/g, '')
    .replace(/\.+$/g, '')
    .replace(/-+$/g, '')
    .toUpperCase();
}

function normalizeUnitKeyPart(value: string): string {
  return sanitizeUnitNumber(value);
}

function normalizeTypeKeyPart(value: string): string {
  return String(value || '')
    .toUpperCase()
    .trim()
    .replace(/^TYPE\s+/, '')
    .replace(/[^A-Z0-9]/g, '');
}

function resolveExistingTypeName(type: string, candidates: string[]): string {
  const incomingKey = normalizeTypeKeyPart(type);
  if (!incomingKey) return type;
  const match = candidates.find(c => normalizeTypeKeyPart(c) === incomingKey);
  return match ?? type;
}

function normalizeAssignments(
  assignments: Record<string, boolean>,
  knownTypes: string[]
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(assignments || {})) {
    if (!v) continue;
    const resolved = resolveExistingTypeName(k, knownTypes);
    out[resolved] = true;
  }
  return out;
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

function pickPreferredBldg(a: string, b: string): string {
  const score = (v: string) => {
    const n = normalizeBldgKeyPart(v);
    if (!n) return 0;
    if (n.startsWith('BLDG')) return 3;
    return 1;
  };
  return score(b) > score(a) ? b : a;
}

function mergeAssignments(a: Record<string, boolean>, b: Record<string, boolean>): Record<string, boolean> {
  const out: Record<string, boolean> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v) out[k] = true;
  }
  return out;
}

function dedupeUnitNumbers(unitNumbers: PrefinalUnitNumber[]): PrefinalUnitNumber[] {
  const map = new Map<string, PrefinalUnitNumber>();

  for (const unit of unitNumbers) {
    const key = makeUnitCompositeKey(unit.name, unit.bldg);
    const existing = map.get(key);

      if (!existing) {
        map.set(key, {
          ...unit,
          name: sanitizeUnitNumber(unit.name),
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
        name: sanitizeUnitNumber(existing.name || unit.name),
        bldg: pickPreferredBldg(existing.bldg, String(unit.bldg || '').trim()),
        floor: pickedFloor,
        assignments: mergeAssignments(existing.assignments, unit.assignments),
      });
  }

  return Array.from(map.values());
}

function dedupeSameTypeSameUnit(unitNumbers: PrefinalUnitNumber[]): PrefinalUnitNumber[] {
  const byTypeAndUnit = new Map<string, PrefinalUnitNumber>();

  for (const row of unitNumbers) {
    const activeTypes = Object.entries(row.assignments)
      .filter(([, enabled]) => !!enabled)
      .map(([type]) => type);

    let merged = false;
    for (const type of activeTypes) {
      const key = `${normalizeUnitKeyPart(row.name)}__${normalizeBldgKeyPart(row.bldg)}__${normalizeTypeKeyPart(type)}`;
      const existing = byTypeAndUnit.get(key);
      if (!existing) continue;

      const existingFloorNum = parseFloorNumber(existing.floor);
      const incomingFloorNum = parseFloorNumber(row.floor);
      existing.floor = (() => {
        if (existingFloorNum !== null && incomingFloorNum !== null) return String(Math.min(existingFloorNum, incomingFloorNum));
        if (existingFloorNum !== null) return existing.floor;
        return row.floor || existing.floor;
      })();
      existing.bldg = pickPreferredBldg(existing.bldg, row.bldg);
      existing.assignments = mergeAssignments(existing.assignments, row.assignments);
      merged = true;
      break;
    }

    if (!merged) {
      const copy: PrefinalUnitNumber = {
        name: row.name,
        bldg: row.bldg,
        floor: row.floor,
        assignments: { ...row.assignments },
      };
      for (const type of activeTypes) {
        const key = `${normalizeUnitKeyPart(copy.name)}__${normalizeBldgKeyPart(copy.bldg)}__${normalizeTypeKeyPart(type)}`;
        if (!byTypeAndUnit.has(key)) byTypeAndUnit.set(key, copy);
      }
      if (activeTypes.length === 0) {
        const fallbackKey = `${normalizeUnitKeyPart(copy.name)}__UNASSIGNED`;
        if (!byTypeAndUnit.has(fallbackKey)) byTypeAndUnit.set(fallbackKey, copy);
      }
    }
  }

  return Array.from(new Set(byTypeAndUnit.values()));
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
    // Normalize + deduplicate unit types preserving first-seen order
    const rawUnitTypes: string[] = parsed.unitTypes || [];
    const seenUnitTypeKeys = new Set<string>();
    const dedupedUnitTypes: string[] = [];
    for (const t of rawUnitTypes) {
      const key = normalizeTypeKeyPart(t);
      if (!key || seenUnitTypeKeys.has(key)) continue;
      seenUnitTypeKeys.add(key);
      dedupedUnitTypes.push(String(t).trim());
    }

    // Normalize + deduplicate cabinetUnitTypes and align aliases with unitTypes when possible
    const rawCabTypes: string[] = parsed.cabinetUnitTypes || [];
    const seenCabTypeKeys = new Set<string>();
    const dedupedCabTypes: string[] = [];
    for (const t of rawCabTypes) {
      const resolved = resolveExistingTypeName(String(t).trim(), [...dedupedCabTypes, ...dedupedUnitTypes]);
      const key = normalizeTypeKeyPart(resolved);
      if (!key || seenCabTypeKeys.has(key)) continue;
      seenCabTypeKeys.add(key);
      dedupedCabTypes.push(resolved);
    }

    // Normalize cabinetRows unitType values to canonical type names
    const cabinetRows = (parsed.cabinetRows || []).map((r: any) => ({
      ...r,
      unitType: resolveExistingTypeName(String(r.unitType || '').trim(), [...dedupedCabTypes, ...dedupedUnitTypes]),
    }));

    const rawUnitNumbers = (parsed.unitNumbers || []).map((u: any) => ({
      ...u,
      name: sanitizeUnitNumber(u.name),
      bldg: String(u.bldg || '').trim(),
      floor: String(u.floor || '').trim(),
      assignments: normalizeAssignments(u.assignments || {}, dedupedUnitTypes),
    }));

    const unitNumbers = dedupeSameTypeSameUnit(dedupeUnitNumbers(rawUnitNumbers));

    return {
      unitTypes: dedupedUnitTypes,
      unitNumbers,
      cabinetRows,
      cabinetUnitTypes: dedupedCabTypes,
      handleQtyPerSku: parsed.handleQtyPerSku || {},
      bidCostPerType: parsed.bidCostPerType || {},
      additionalCostPerType: parsed.additionalCostPerType || {},
      stoneRows: parsed.stoneRows || [],
      stoneUnitTypes: parsed.stoneUnitTypes || [],
    };
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
      const existingKeys = new Set(prev.unitTypes.map(t => normalizeTypeKeyPart(t)));
      const newTypes: string[] = [];
      for (const t of types) {
        const trimmed = String(t || '').trim();
        const key = normalizeTypeKeyPart(trimmed);
        if (!key || existingKeys.has(key)) continue;
        existingKeys.add(key);
        newTypes.push(trimmed);
      }
      if (!newTypes.length) return prev;
      const unitTypes = [...prev.unitTypes, ...newTypes];
      const unitNumbers = prev.unitNumbers.map(u => ({
        ...u,
        assignments: normalizeAssignments(u.assignments, unitTypes),
      }));
      const next = { ...prev, unitTypes, unitNumbers };
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
      const unitNumbers = [...prev.unitNumbers, { name: sanitizeUnitNumber(name), bldg, floor, assignments: {} }];
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
      const unitNumbers = prev.unitNumbers.map((u, i) => i === index ? { ...u, name: sanitizeUnitNumber(name) } : u);
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
        prev.unitNumbers.map(u => ({ ...u, assignments: normalizeAssignments({ ...u.assignments }, prev.unitTypes) }))
      );

      const existingKeys = new Map<string, number>();
      baseUnits.forEach((u, i) => existingKeys.set(makeUnitCompositeKey(u.name, u.bldg), i));

      const updatedNumbers = [...baseUnits];
      for (const m of mappings) {
        const resolvedType = resolveExistingTypeName(String(m.unitType || '').trim(), prev.unitTypes);
        const key = makeUnitCompositeKey(sanitizeUnitNumber(m.unitNumber), m.bldg || '');
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
            name: current.name || sanitizeUnitNumber(m.unitNumber),
            bldg: current.bldg || String(m.bldg || '').trim(),
            floor: mergedFloor,
            assignments: normalizeAssignments({ ...current.assignments, [resolvedType]: true }, prev.unitTypes),
          };
        } else {
          updatedNumbers.push({
            name: sanitizeUnitNumber(m.unitNumber),
            bldg: String(m.bldg || '').trim(),
            floor: String(m.floor || '').trim(),
            assignments: normalizeAssignments({ [resolvedType]: true }, prev.unitTypes),
          });
          existingKeys.set(key, updatedNumbers.length - 1);
        }
      }

      const unitNumbers = dedupeSameTypeSameUnit(dedupeUnitNumbers(updatedNumbers));
      const next = { ...prev, unitNumbers };
      saveData(projectId, next);
      return next;
    });
  }, [projectId]);

  // ── Cabinet Unit Types (independent columns for cabinet section) ────────
  const addCabinetUnitTypes = useCallback((types: string[], reorderToMatch = false) => {
    setData(prev => {
      const allRef = [...prev.cabinetUnitTypes, ...prev.unitTypes];
      const resolvedInput: string[] = [];
      const seenKeys = new Set<string>();
      for (const t of types) {
        const trimmed = String(t || '').trim();
        const resolved = resolveExistingTypeName(trimmed, allRef);
        const key = normalizeTypeKeyPart(resolved);
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        resolvedInput.push(resolved);
      }

      if (reorderToMatch) {
        // Reorder: put input types first (in given order), then any existing types not in input
        const inputKeys = new Set(resolvedInput.map(t => normalizeTypeKeyPart(t)));
        const remaining = prev.cabinetUnitTypes.filter(t => !inputKeys.has(normalizeTypeKeyPart(t)));
        const cabinetUnitTypes = [...resolvedInput, ...remaining];
        const cabinetRows = prev.cabinetRows.map(r => ({
          ...r,
          unitType: resolveExistingTypeName(r.unitType, [...cabinetUnitTypes, ...prev.unitTypes]),
        }));
        const next = { ...prev, cabinetUnitTypes, cabinetRows };
        saveData(projectId, next);
        return next;
      }

      // Default append behavior: only add truly new types
      const existingKeys = new Set(prev.cabinetUnitTypes.map(t => normalizeTypeKeyPart(t)));
      const newTypes = resolvedInput.filter(t => !existingKeys.has(normalizeTypeKeyPart(t)));
      if (!newTypes.length) return prev;
      const cabinetUnitTypes = [...prev.cabinetUnitTypes, ...newTypes];
      const cabinetRows = prev.cabinetRows.map(r => ({
        ...r,
        unitType: resolveExistingTypeName(r.unitType, [...cabinetUnitTypes, ...prev.unitTypes]),
      }));
      const next = { ...prev, cabinetUnitTypes, cabinetRows };
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
      const canonicalType = resolveExistingTypeName(unitType, [...prev.cabinetUnitTypes, ...prev.unitTypes]);
      const merged: Record<string, PrefinalCabinetRow> = {};
      const isCornerLazySusan = (sku: string) => /^(LS|LSB)\d+/i.test(sku);

      for (const r of prev.cabinetRows) {
        const resolvedType = resolveExistingTypeName(r.unitType, [...prev.cabinetUnitTypes, ...prev.unitTypes]);
        const normSku = String(r.sku || '').toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
        const key = `${normSku}__${r.room}__${resolvedType}`;
        merged[key] = { ...r, sku: normSku, unitType: resolvedType };
      }

      for (const r of rows) {
        const normSku = String(r.sku || '').toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
        const key = `${normSku}__${r.room}__${canonicalType}`;
        const incomingQty = Number(r.quantity) || 1;

        if (merged[key]) {
          merged[key].quantity = isCornerLazySusan(normSku)
            ? Math.max(merged[key].quantity, incomingQty)
            : merged[key].quantity + incomingQty;
        } else {
          merged[key] = { ...r, sku: normSku, quantity: incomingQty, unitType: canonicalType };
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
