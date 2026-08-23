import type { JobSkillStatus, JobStatus } from '@/lib/api';

const STATUS_STYLES: Record<string, { label: string; className: string; dot: string; pulse?: boolean }> = {
  queued: {
    label: 'Queued',
    className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    dot: 'bg-amber-400',
  },
  running: {
    label: 'Running',
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    dot: 'bg-emerald-400',
    pulse: true,
  },
  done: {
    label: 'Done',
    className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-500/10 text-red-400 border-red-500/20',
    dot: 'bg-red-400',
  },
  pending: {
    label: 'Pending',
    className: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    dot: 'bg-zinc-500',
  },
};

export default function StatusBadge({ status }: { status: JobStatus | JobSkillStatus }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.className}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${style.dot} ${style.pulse ? 'animate-pulse' : ''}`}
      />
      {style.label}
    </span>
  );
}