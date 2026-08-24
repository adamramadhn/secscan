/** Badge severity temuan — warna semantik, dipakai panel findings & detail job. */
export default function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    Critical: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300',
    High: 'border-red-500/40 bg-red-500/10 text-red-300',
    Medium: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    Low: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
    Info: 'border-zinc-600 bg-zinc-800/60 text-zinc-400',
  };
  const cls = map[severity] ?? map.Info;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {severity}
    </span>
  );
}
