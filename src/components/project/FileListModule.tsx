import { useState } from 'react';
import { FileText, MoreVertical, ArrowRight, Trash2, DoorOpen, Refrigerator, Package } from 'lucide-react';
import type { ProjectFile, FileSection } from '@/types/project';
import { useFileStore } from '@/hooks/useFileStore';
import { toast } from '@/hooks/use-toast';

const SECTION_META: Record<FileSection, { label: string; color: string; lightColor: string; icon: React.ReactNode }> = {
  cabinet_takeoff: {
    label: 'Cabinet Takeoff',
    color: 'hsl(var(--section-cabinet))',
    lightColor: 'hsl(var(--section-cabinet-light))',
    icon: <DoorOpen size={12} />,
  },
  appliance_takeoff: {
    label: 'Appliance Takeoff',
    color: 'hsl(var(--section-appliance))',
    lightColor: 'hsl(var(--section-appliance-light))',
    icon: <Refrigerator size={12} />,
  },
  prefinal: {
    label: 'Prefinal – 2020 Shops',
    color: 'hsl(var(--section-prefinal))',
    lightColor: 'hsl(var(--section-prefinal-light))',
    icon: <Package size={12} />,
  },
};

const ALL_SECTIONS: FileSection[] = ['cabinet_takeoff', 'appliance_takeoff', 'prefinal'];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface Props {
  projectId: string;
  section: FileSection;
}

export default function FileListModule({ projectId, section }: Props) {
  const { getFilesBySection, moveFile, deleteFile } = useFileStore(projectId);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ file: ProjectFile; to: FileSection } | null>(null);

  const files = getFilesBySection(section);
  const meta = SECTION_META[section];
  const otherSections = ALL_SECTIONS.filter(s => s !== section);

  const handleMove = () => {
    if (!moveTarget) return;
    moveFile(moveTarget.file.id, moveTarget.to);
    toast({
      title: '✔ File moved',
      description: `${moveTarget.file.filename} moved to ${SECTION_META[moveTarget.to].label}`,
    });
    setMoveTarget(null);
  };

  const handleDelete = (file: ProjectFile) => {
    deleteFile(file.id);
    setMenuOpen(null);
    toast({ title: 'File removed', description: `${file.filename} has been deleted.` });
  };

  if (files.length === 0) {
    return (
      <div className="text-center py-8">
        <FileText size={32} className="mx-auto mb-2 text-muted-foreground opacity-40" />
        <p className="text-sm text-muted-foreground">No files uploaded to this section yet.</p>
        <p className="text-xs text-muted-foreground mt-1">Upload a PDF from the Units tab to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
        Uploaded Files ({files.length})
      </div>

      {files.map(file => (
        <div
          key={file.id}
          className="rounded-lg border p-3 flex items-center gap-3 bg-card relative"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: meta.lightColor }}>
            <FileText size={18} style={{ color: meta.color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate text-foreground">{file.filename}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                style={{ background: meta.lightColor, color: meta.color }}
              >
                {meta.icon}
                {meta.label}
              </span>
              <span className="text-[10px] text-muted-foreground">{timeAgo(file.uploadedAt)}</span>
              {file.pageCount && <span className="text-[10px] text-muted-foreground">{file.pageCount} pages</span>}
            </div>
          </div>

          {/* Three-dot menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(menuOpen === file.id ? null : file.id)}
              className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="File actions"
            >
              <MoreVertical size={16} />
            </button>

            {menuOpen === file.id && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(null)} />
                <div className="absolute right-0 top-full mt-1 z-40 bg-card rounded-lg border shadow-lg py-1 min-w-[220px]" style={{ borderColor: 'hsl(var(--border))' }}>
                  {otherSections.map(s => {
                    const targetMeta = SECTION_META[s];
                    return (
                      <button
                        key={s}
                        onClick={() => { setMenuOpen(null); setMoveTarget({ file, to: s }); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted transition-colors text-left"
                      >
                        <ArrowRight size={13} style={{ color: targetMeta.color }} />
                        <span>Move file to <strong>{targetMeta.label}</strong></span>
                      </button>
                    );
                  })}
                  <div className="border-t my-1" style={{ borderColor: 'hsl(var(--border))' }} />
                  <button
                    onClick={() => handleDelete(file)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 transition-colors text-left"
                  >
                    <Trash2 size={13} />
                    <span>Delete File</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ))}

      {/* Move Confirmation Modal */}
      {moveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-card rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-bold text-foreground mb-4">Move File</h3>
            <div className="flex items-center gap-2 mb-4">
              <FileText size={16} className="text-muted-foreground" />
              <span className="text-sm font-medium truncate">{moveTarget.file.filename}</span>
            </div>

            <div className="space-y-3 mb-6">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Move from</div>
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold"
                  style={{ background: meta.lightColor, color: meta.color }}
                >
                  {meta.icon}
                  {meta.label}
                </span>
              </div>
              <div className="flex justify-center">
                <ArrowRight size={16} className="text-muted-foreground" style={{ transform: 'rotate(90deg)' }} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Move to</div>
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold"
                  style={{ background: SECTION_META[moveTarget.to].lightColor, color: SECTION_META[moveTarget.to].color }}
                >
                  {SECTION_META[moveTarget.to].icon}
                  {SECTION_META[moveTarget.to].label}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setMoveTarget(null)}
                className="flex-1 py-2 rounded-lg text-sm font-medium border text-muted-foreground hover:text-foreground transition-colors"
                style={{ borderColor: 'hsl(var(--border))' }}
              >
                Cancel
              </button>
              <button
                onClick={handleMove}
                className="flex-1 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
                style={{ background: SECTION_META[moveTarget.to].color }}
              >
                Confirm Move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
