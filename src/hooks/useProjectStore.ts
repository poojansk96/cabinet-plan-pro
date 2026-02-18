import { useState, useEffect, useCallback } from 'react';
import type { Project, Unit, Cabinet, Accessory, CountertopSection } from '@/types/project';
import { generateId } from '@/lib/calculations';

const STORAGE_KEY = 'takeoff_projects';

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function useProjectStore() {
  const [projects, setProjects] = useState<Project[]>(loadProjects);

  useEffect(() => {
    saveProjects(projects);
  }, [projects]);

  const createProject = useCallback((data: Omit<Project, 'id' | 'units' | 'createdAt' | 'updatedAt'>): Project => {
    const project: Project = {
      ...data,
      id: generateId(),
      units: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setProjects(prev => [project, ...prev]);
    return project;
  }, []);

  const updateProject = useCallback((id: string, data: Partial<Project>) => {
    setProjects(prev => prev.map(p =>
      p.id === id ? { ...p, ...data, updatedAt: new Date().toISOString() } : p
    ));
  }, []);

  const deleteProject = useCallback((id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id));
  }, []);

  const getProject = useCallback((id: string) => {
    return projects.find(p => p.id === id);
  }, [projects]);

  // Unit operations
  const addUnit = useCallback((projectId: string, data: Omit<Unit, 'id' | 'cabinets' | 'accessories' | 'countertops'>): Unit => {
    const unit: Unit = {
      ...data,
      id: generateId(),
      cabinets: [],
      accessories: [],
      countertops: [],
    };
    setProjects(prev => prev.map(p =>
      p.id === projectId
        ? { ...p, units: [...p.units, unit], updatedAt: new Date().toISOString() }
        : p
    ));
    return unit;
  }, []);

  const updateUnit = useCallback((projectId: string, unitId: string, data: Partial<Unit>) => {
    setProjects(prev => prev.map(p =>
      p.id === projectId
        ? {
          ...p,
          units: p.units.map(u => u.id === unitId ? { ...u, ...data } : u),
          updatedAt: new Date().toISOString(),
        }
        : p
    ));
  }, []);

  const deleteUnit = useCallback((projectId: string, unitId: string) => {
    setProjects(prev => prev.map(p =>
      p.id === projectId
        ? { ...p, units: p.units.filter(u => u.id !== unitId), updatedAt: new Date().toISOString() }
        : p
    ));
  }, []);

  const duplicateUnit = useCallback((projectId: string, unitId: string) => {
    setProjects(prev => prev.map(p => {
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

  // Cabinet operations
  const addCabinet = useCallback((projectId: string, unitId: string, data: Omit<Cabinet, 'id'>): Cabinet => {
    const cabinet: Cabinet = { ...data, id: generateId() };
    setProjects(prev => prev.map(p =>
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

  const updateCabinet = useCallback((projectId: string, unitId: string, cabinetId: string, data: Partial<Cabinet>) => {
    setProjects(prev => prev.map(p =>
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

  const deleteCabinet = useCallback((projectId: string, unitId: string, cabinetId: string) => {
    setProjects(prev => prev.map(p =>
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

  // Accessory operations
  const addAccessory = useCallback((projectId: string, unitId: string, data: Omit<Accessory, 'id'>): Accessory => {
    const accessory: Accessory = { ...data, id: generateId() };
    setProjects(prev => prev.map(p =>
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

  const updateAccessory = useCallback((projectId: string, unitId: string, accId: string, data: Partial<Accessory>) => {
    setProjects(prev => prev.map(p =>
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

  const deleteAccessory = useCallback((projectId: string, unitId: string, accId: string) => {
    setProjects(prev => prev.map(p =>
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

  // Countertop operations
  const addCountertop = useCallback((projectId: string, unitId: string, data: Omit<CountertopSection, 'id'>): CountertopSection => {
    const ct: CountertopSection = { ...data, id: generateId() };
    setProjects(prev => prev.map(p =>
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

  const updateCountertop = useCallback((projectId: string, unitId: string, ctId: string, data: Partial<CountertopSection>) => {
    setProjects(prev => prev.map(p =>
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

  const deleteCountertop = useCallback((projectId: string, unitId: string, ctId: string) => {
    setProjects(prev => prev.map(p =>
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
    projects,
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
