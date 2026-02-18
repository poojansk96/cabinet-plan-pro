import { useState, useCallback, useEffect } from 'react';
import type { Project, Unit, Cabinet, Accessory, CountertopSection } from '@/types/project';
import { generateId } from '@/lib/calculations';

const STORAGE_KEY = 'takeoff_projects';

// ── Singleton state shared across all hook instances ──────────────────────────
type Listener = () => void;
const listeners = new Set<Listener>();

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Mutable singleton
let store: Project[] = loadProjects();

function commit(next: Project[]) {
  store = next;
  // Persist synchronously BEFORE notifying so navigating components read fresh data
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  listeners.forEach(fn => fn());
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useProjectStore() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const tick = () => rerender(n => n + 1);
    listeners.add(tick);
    return () => { listeners.delete(tick); };
  }, []);

  // ── Project CRUD ────────────────────────────────────────────────────────────
  const createProject = useCallback(
    (data: Omit<Project, 'id' | 'units' | 'createdAt' | 'updatedAt'>): Project => {
      const project: Project = {
        ...data,
        id: generateId(),
        units: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      commit([project, ...store]);
      return project;
    }, []);

  const updateProject = useCallback((id: string, data: Partial<Project>) => {
    commit(store.map(p =>
      p.id === id ? { ...p, ...data, updatedAt: new Date().toISOString() } : p
    ));
  }, []);

  const deleteProject = useCallback((id: string) => {
    commit(store.filter(p => p.id !== id));
  }, []);

  const getProject = useCallback((id: string) => {
    return store.find(p => p.id === id);
  }, []);

  // ── Unit CRUD ───────────────────────────────────────────────────────────────
  const addUnit = useCallback(
    (projectId: string, data: Omit<Unit, 'id' | 'cabinets' | 'accessories' | 'countertops'>): Unit => {
      const unit: Unit = { ...data, id: generateId(), cabinets: [], accessories: [], countertops: [] };
      commit(store.map(p =>
        p.id === projectId
          ? { ...p, units: [...p.units, unit], updatedAt: new Date().toISOString() }
          : p
      ));
      return unit;
    }, []);

  const updateUnit = useCallback((projectId: string, unitId: string, data: Partial<Unit>) => {
    commit(store.map(p =>
      p.id === projectId
        ? { ...p, units: p.units.map(u => u.id === unitId ? { ...u, ...data } : u), updatedAt: new Date().toISOString() }
        : p
    ));
  }, []);

  const deleteUnit = useCallback((projectId: string, unitId: string) => {
    commit(store.map(p =>
      p.id === projectId
        ? { ...p, units: p.units.filter(u => u.id !== unitId), updatedAt: new Date().toISOString() }
        : p
    ));
  }, []);

  const duplicateUnit = useCallback((projectId: string, unitId: string) => {
    commit(store.map(p => {
      if (p.id !== projectId) return p;
      const unit = p.units.find(u => u.id === unitId);
      if (!unit) return p;
      const newUnit: Unit = {
        ...unit,
        id: generateId(),
        unitNumber: unit.unitNumber + '-COPY',
        cabinets: unit.cabinets.map(c => ({ ...c, id: generateId() })),
        accessories: unit.accessories.map(a => ({ ...a, id: generateId() })),
        countertops: unit.countertops.map(ct => ({ ...ct, id: generateId() })),
      };
      return { ...p, units: [...p.units, newUnit], updatedAt: new Date().toISOString() };
    }));
  }, []);

  // ── Cabinet CRUD ────────────────────────────────────────────────────────────
  const addCabinet = useCallback(
    (projectId: string, unitId: string, data: Omit<Cabinet, 'id'>): Cabinet => {
      const cabinet: Cabinet = { ...data, id: generateId() };
      commit(store.map(p =>
        p.id === projectId
          ? {
            ...p,
            units: p.units.map(u =>
              u.id === unitId ? { ...u, cabinets: [...u.cabinets, cabinet] } : u
            ),
            updatedAt: new Date().toISOString(),
          }
          : p
      ));
      return cabinet;
    }, []);

  const updateCabinet = useCallback(
    (projectId: string, unitId: string, cabinetId: string, data: Partial<Cabinet>) => {
      commit(store.map(p =>
        p.id === projectId
          ? {
            ...p,
            units: p.units.map(u =>
              u.id === unitId
                ? { ...u, cabinets: u.cabinets.map(c => c.id === cabinetId ? { ...c, ...data } : c) }
                : u
            ),
            updatedAt: new Date().toISOString(),
          }
          : p
      ));
    }, []);

  const deleteCabinet = useCallback(
    (projectId: string, unitId: string, cabinetId: string) => {
      commit(store.map(p =>
        p.id === projectId
          ? {
            ...p,
            units: p.units.map(u =>
              u.id === unitId
                ? { ...u, cabinets: u.cabinets.filter(c => c.id !== cabinetId) }
                : u
            ),
            updatedAt: new Date().toISOString(),
          }
          : p
      ));
    }, []);

  // ── Accessory CRUD ──────────────────────────────────────────────────────────
  const addAccessory = useCallback(
    (projectId: string, unitId: string, data: Omit<Accessory, 'id'>): Accessory => {
      const accessory: Accessory = { ...data, id: generateId() };
      commit(store.map(p =>
        p.id === projectId
          ? {
            ...p,
            units: p.units.map(u =>
              u.id === unitId ? { ...u, accessories: [...u.accessories, accessory] } : u
            ),
            updatedAt: new Date().toISOString(),
          }
          : p
      ));
      return accessory;
    }, []);

  const updateAccessory = useCallback(
    (projectId: string, unitId: string, accId: string, data: Partial<Accessory>) => {
      commit(store.map(p =>
        p.id === projectId
          ? {
            ...p,
            units: p.units.map(u =>
              u.id === unitId
                ? { ...u, accessories: u.accessories.map(a => a.id === accId ? { ...a, ...data } : a) }
                : u
            ),
            updatedAt: new Date().toISOString(),
          }
          : p
      ));
    }, []);

  const deleteAccessory = useCallback(
    (projectId: string, unitId: string, accId: string) => {
      commit(store.map(p =>
        p.id === projectId
          ? {
            ...p,
            units: p.units.map(u =>
              u.id === unitId
                ? { ...u, accessories: u.accessories.filter(a => a.id !== accId) }
                : u
            ),
            updatedAt: new Date().toISOString(),
          }
          : p
      ));
    }, []);

  // ── Countertop CRUD ─────────────────────────────────────────────────────────
  const addCountertop = useCallback(
    (projectId: string, unitId: string, data: Omit<CountertopSection, 'id'>): CountertopSection => {
      const ct: CountertopSection = { ...data, id: generateId() };
      commit(store.map(p =>
        p.id === projectId
          ? {
            ...p,
            units: p.units.map(u =>
              u.id === unitId ? { ...u, countertops: [...u.countertops, ct] } : u
            ),
            updatedAt: new Date().toISOString(),
          }
          : p
      ));
      return ct;
    }, []);

  const updateCountertop = useCallback(
    (projectId: string, unitId: string, ctId: string, data: Partial<CountertopSection>) => {
      commit(store.map(p =>
        p.id === projectId
          ? {
            ...p,
            units: p.units.map(u =>
              u.id === unitId
                ? { ...u, countertops: u.countertops.map(c => c.id === ctId ? { ...c, ...data } : c) }
                : u
            ),
            updatedAt: new Date().toISOString(),
          }
          : p
      ));
    }, []);

  const deleteCountertop = useCallback(
    (projectId: string, unitId: string, ctId: string) => {
      commit(store.map(p =>
        p.id === projectId
          ? {
            ...p,
            units: p.units.map(u =>
              u.id === unitId
                ? { ...u, countertops: u.countertops.filter(c => c.id !== ctId) }
                : u
            ),
            updatedAt: new Date().toISOString(),
          }
          : p
      ));
    }, []);

  return {
    projects: store,
    createProject,
    updateProject,
    deleteProject,
    getProject,
    addUnit,
    updateUnit,
    deleteUnit,
    duplicateUnit,
    addCabinet,
    updateCabinet,
    deleteCabinet,
    addAccessory,
    updateAccessory,
    deleteAccessory,
    addCountertop,
    updateCountertop,
    deleteCountertop,
  };
}
