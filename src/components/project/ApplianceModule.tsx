import type { Project, Unit } from '@/types/project';

interface Props {
  project: Project;
  selectedUnit: Unit | undefined;
  selectedUnitId: string | null;
  setSelectedUnitId: (id: string) => void;
}

export default function ApplianceModule({ project }: Props) {
  return (
    <div className="space-y-4">
      <div className="text-center py-10 text-muted-foreground text-sm">
        <p className="font-semibold text-foreground mb-1">Appliance Summary</p>
        <p>Coming soon — track appliances per unit type.</p>
      </div>
    </div>
  );
}
