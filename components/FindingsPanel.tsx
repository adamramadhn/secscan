'use client';

import { useState } from 'react';
import type { Finding } from '@/lib/api';
import SeverityBadge from '@/components/SeverityBadge';

const ORDER = ['Critical', 'High', 'Medium', 'Low', 'Info'] as const;

/**
 * Panel temuan terstruktur: counter severity + daftar expandable,
 * terurut dari severity tertinggi (server sudah mengurutkan).
 */
export default function FindingsPanel({ findings }: { findings: Finding[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  const counts: Record<string, number> = {};
  for (const sev of ORDER) counts[sev] = 0;
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }

  const shown = filter ? findings.filter((f) => f.severity === filter) : findings;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Temuan ({findings.length})
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {ORDER.map((sev) => (
            <button
              key={sev}
              onClick={() => setFilter(filter === sev ? null : sev)}
              disabled={counts[sev] === 0}
              className={`transition ${filter === sev ? 'ring-1 ring-emerald-500/50' : ''} ${
                counts[sev] === 0 ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:opacity-80'
              }`}
            >
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-300">
                <SeverityBadge severity={sev} />
                <span className="tabular-nums">{counts[sev]}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 px-5 py-8 text-center text-sm text-zinc-500">
          {findings.length === 0
            ? 'Belum ada temuan terstruktur. Temuan muncul otomatis saat skill selesai dan output laporannya diparse.'
            : 'Tidak ada temuan dengan severity ini.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((f) => {
            const open = openId === f.id;
            return (
              <div
                key={f.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 transition hover:border-zinc-700"
              >
                <button
                  onClick={() => setOpenId(open ? null : f.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-left"
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-2.5">
                    <SeverityBadge severity={f.severity} />
                    <span className="truncate text-sm font-medium text-zinc-200">{f.title}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2.5">
                    <span className="rounded-md bg-zinc-800/70 px-2 py-0.5 font-mono text-xs text-zinc-400">
                      {f.skill}
                    </span>
                    <span aria-hidden className="text-xs text-zinc-500">
                      {open ? '▲' : '▼'}
                    </span>
                  </span>
                </button>
                {open && (
                  <div className="flex flex-col gap-3 border-t border-zinc-800 px-5 py-4">
                    {f.location && (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Lokasi</p>
                        <p className="mt-1 break-all font-mono text-xs text-zinc-300">{f.location}</p>
                      </div>
                    )}
                    {f.description && (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Deskripsi</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                          {f.description}
                        </p>
                      </div>
                    )}
                    {f.recommendation && (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Rekomendasi</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-emerald-300/90">
                          {f.recommendation}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
