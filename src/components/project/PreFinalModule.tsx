import type { Project, Unit, Cabinet } from '@/types/project';
import CabinetModule from './CabinetModule';

interface Props {
  project: Project;
  selectedUnit?: Unit;
  selectedUnitId?: string | null;
  setSelectedUnitId?: (id: string) => void;
  addCabinet: (projectId: string, unitId: string, data: Omit<Cabinet, 'id'>) => Cabinet;
  updateCabinet: (projectId: string, unitId: string, cabinetId: string, data: Partial<Cabinet>) => void;
  deleteCabinet: (projectId: string, unitId: string, cabinetId: string) => void;
  [key: string]: unknown;
}

export default function PreFinalModule({ project, selectedUnit, selectedUnitId, setSelectedUnitId, addCabinet, updateCabinet, deleteCabinet }: Props) {
  return (
    <CabinetModule
      project={project}
      selectedUnit={selectedUnit}
      selectedUnitId={selectedUnitId ?? null}
      setSelectedUnitId={setSelectedUnitId ?? (() => {})}
      addCabinet={addCabinet}
      updateCabinet={updateCabinet}
      deleteCabinet={deleteCabinet}
    />
  );
}
