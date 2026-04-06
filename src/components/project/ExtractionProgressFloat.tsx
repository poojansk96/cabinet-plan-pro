import { useAllExtractionJobs, clearExtractionJob, type ExtractionJob } from '@/hooks/useExtractionStore';
import { Loader2, CheckCircle, AlertCircle, X, Sparkles } from 'lucide-react';

function JobCard({ job }: { job: ExtractionJob }) {
  const isDone = job.status === 'done';
  const isError = job.status === 'error';
  const isProcessing = job.status === 'processing';

  return (
    <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/50">
        <div className="flex items-center gap-1.5">
          {isProcessing && <Loader2 size={13} className="animate-spin text-primary" />}
          {isDone && <CheckCircle size={13} className="text-green-500" />}
          {isError && <AlertCircle size={13} className="text-destructive" />}
          <span className="text-xs font-semibold text-foreground">
            {isProcessing ? `Extracting ${job.label}…` : isDone ? `${job.label} Complete` : `${job.label} Failed`}
          </span>
        </div>
        {(isDone || isError) && (
          <button onClick={() => clearExtractionJob(job.type)} className="text-muted-foreground hover:text-foreground p-0.5">
            <X size={12} />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1.5">
        {isProcessing && (
          <>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{job.statusText.length > 40 ? job.statusText.slice(0, 40) + '…' : job.statusText}</span>
              <span className="font-bold tabular-nums text-primary">{job.progress}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden bg-secondary">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${job.progress}%`,
                  background: 'hsl(var(--primary))',
                }}
              />
            </div>
            {job.totalPages > 0 && (
              <p className="text-[10px] text-muted-foreground">
                Page {job.processedPages}/{job.totalPages} · {job.fileNames.length} file{job.fileNames.length !== 1 ? 's' : ''}
              </p>
            )}
            <p className="text-[9px] text-muted-foreground/60 flex items-center gap-1">
              <Sparkles size={8} /> You can close this dialog & keep working
            </p>
          </>
        )}

        {isDone && (
          <p className="text-xs text-muted-foreground">
            Extraction complete — open the import dialog to review.
          </p>
        )}

        {isError && (
          <p className="text-xs text-destructive">{job.error}</p>
        )}
      </div>
    </div>
  );
}

export default function ExtractionProgressFloat() {
  const jobs = useAllExtractionJobs();

  if (jobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-72 space-y-2">
      {jobs.map(job => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
}
