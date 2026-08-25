'use client';

import { buildCompliance, ComplianceItem } from '@/lib/compliance';
import { Finding, Job } from '@/lib/api';

const FLAG_STYLE: Record<string, { label: string; cls: string }> = {
  High: { label: '🔴 Perlu tindakan', cls: 'border-red-500/30 bg-red-500/10 text-red-300' },
  Critical: { label: '🔴 Perlu tindakan', cls: 'border-red-500/30 bg-red-500/10 text-red-300' },
  Medium: { label: '🟡 Tinjau', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  Low: { label: '🟡 Tinjau', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  Info: { label: '🔵 Informasi', cls: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
};

export default function CompliancePanel({ job, findings }: { job: Job; findings: Finding[] }) {
  if (findings.length === 0) return null;
  const summary = buildCompliance(findings);
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Kepatuhan — OWASP Top 10 (2021)</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Pemetaan otomatis {summary.totalFindings} temuan ke kategori OWASP — indikatif, bukan sertifikasi.
          </p>
        </div>
        <a
          href={`/api/jobs/${job.id}/compliance`}
          className="rounded-lg border border-zinc-700 px-3.5 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
        >
          ⬇ Laporan Kepatuhan (.md)
        </a>
      </div>
      <div className="flex flex-col gap-2">
        {summary.items.map((item: ComplianceItem) => {
          const flag = FLAG_STYLE[item.maxSeverity] ?? FLAG_STYLE.Info;
          return (
            <div
              key={item.controlId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-4 py-3"
            >
              <div className="min-w-0">
                <span className="font-mono text-xs text-zinc-500">{item.controlId}</span>{' '}
                <span className="text-sm text-zinc-200">{item.controlName}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-zinc-800/70 px-2 py-0.5 text-xs text-zinc-400">
                  {item.count} temuan
                </span>
                <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${flag.cls}`}>
                  {flag.label} ({item.maxSeverity})
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
