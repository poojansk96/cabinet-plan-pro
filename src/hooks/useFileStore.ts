import { useState, useCallback, useEffect } from 'react';
import type { ProjectFile, FileSection } from '@/types/project';
import { generateId } from '@/lib/calculations';

const STORAGE_KEY = 'takeoff_project_files';

type Listener = () => void;
const listeners = new Set<Listener>();

function loadFiles(): Record<string, ProjectFile[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

let fileStore: Record<string, ProjectFile[]> = loadFiles();

function commit(next: Record<string, ProjectFile[]>) {
  fileStore = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  listeners.forEach(fn => fn());
}

export function useFileStore(projectId: string) {
  const [, rerender] = useState(0);

  useEffect(() => {
    const tick = () => rerender(n => n + 1);
    listeners.add(tick);
    return () => { listeners.delete(tick); };
  }, []);

  const files = fileStore[projectId] ?? [];

  const addFile = useCallback((filename: string, section: FileSection, pageCount?: number): ProjectFile => {
    const file: ProjectFile = {
      id: generateId(),
      filename,
      section,
      uploadedAt: new Date().toISOString(),
      pageCount,
    };
    const current = fileStore[projectId] ?? [];
    commit({ ...fileStore, [projectId]: [...current, file] });
    return file;
  }, [projectId]);

  const moveFile = useCallback((fileId: string, newSection: FileSection) => {
    const current = fileStore[projectId] ?? [];
    commit({
      ...fileStore,
      [projectId]: current.map(f => f.id === fileId ? { ...f, section: newSection } : f),
    });
  }, [projectId]);

  const deleteFile = useCallback((fileId: string) => {
    const current = fileStore[projectId] ?? [];
    commit({ ...fileStore, [projectId]: current.filter(f => f.id !== fileId) });
  }, [projectId]);

  const getFilesBySection = useCallback((section: FileSection) => {
    return (fileStore[projectId] ?? []).filter(f => f.section === section);
  }, [projectId]);

  return { files, addFile, moveFile, deleteFile, getFilesBySection };
}
