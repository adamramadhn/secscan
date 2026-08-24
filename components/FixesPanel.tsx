'use client';

import { useState } from 'react';
import type { Fix } from '@/lib/api';

function parseIds(json: string): number[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

/**
 * Panel hasil auto-fix: daftar file yang diubah, temuan yang ditutup,
 * rationale, dan tombol download patch.
 */
export default function FixesPanel({ fixes, jobId }: { fixes: Fix[]; jobId: string }) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (fixes.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Perbaikan Otomatis ({fixes.length} file)
        </h2>
        <a
          href={`/api/jobs/${jobId}/fixes`}
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
        >
          ↓ Download fixes.patch
        </a>
      </div>
      <div className="flex flex-col gap-2">
        {fixes.map((fx) => {
          const open = openId === fx.id;
          const ids = parseIds(fx.findings_json);
          return (
            <div key={fx.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 transition hover:border-zinc-700">
              <button
                onClick={() => setOpenId(open ? null : fx.id)}
                className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-left"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="rounded-md bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                    FIX
                  </span>
                  <span className="truncate font-mono text-sm text-zinc-200">{fx.file}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2.5">
                  {ids.length > 0 && (
                    <span className="text-xs text-zinc-500">
                      menutup temuan #{ids.join(', #')}
                    </span>
                  )}
                  <span aria-hidden className="text-xs text-zinc-500">{open ? '▲' : '▼'}</span>
                </span>
              </button>
              {open && (
                <div className="border-t border-zinc-800 px-5 py-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Alasan</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                    {fx.rationale ?? '—'}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-zinc-600">
        Terapkan dengan <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-400">git apply fixes.patch</code> di repo target — review dulu sebelum commit.
      </p>
    </div>
  );
}
