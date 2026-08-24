'use client';

import { useState } from 'react';
import type { Finding, ValidationStatus } from '@/lib/api';
import SeverityBadge from '@/components/SeverityBadge';

const ORDER = ['Critical', 'High', 'Medium', 'Low', 'Info'] as const;

const VALIDATION_STYLE: Record<string, string> = {
  confirmed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  refuted: 'border-zinc-500/40 bg-zinc-700/20 text-zinc-400 line-through',
  inconclusive: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
};

function ValidationBadge({ status }: { status: ValidationStatus }) {
  const cls = VALIDATION_STYLE[status] ?? VALIDATION_STYLE.inconclusive;
  const label = status === 'confirmed' ? '✓ Confirmed' : status === 'refuted' ? '✗ Refuted' : '? Inconclusive';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

/**
 * Panel temuan terstruktur: counter severity + daftar expandable,
 * terurut dari severity tertinggi (server sudah mengurutkan).
 */
export default function FindingsPanel({ findings }: { findings: Finding[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [hideRefuted, setHideRefuted] = useState(false);

  const counts: Record<string, number> = {};
  for (const sev of ORDER) counts[sev] = 0;
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }

  const nConfirmed = findings.filter((f) => f.validation_status === 'confirmed').length;
  const nRefuted = findings.filter((f) => f.validation_status === 'refuted').length;
  const hasValidation = findings.some((f) => f.validation_status);

  const shown = findings
    .filter((f) => (filter ? f.severity === filter : true))
    .filter((f) => (hideRefuted ? f.validation_status !== 'refuted' : true));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Temuan ({findings.length})
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {hasValidation && (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                {nConfirmed} confirmed
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-xs font-medium text-zinc-400">
                {nRefuted} refuted
              </span>
              <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-zinc-700">
                <input
                  type="checkbox"
                  checked={hideRefuted}
                  onChange={(e) => setHideRefuted(e.target.checked)}
                  className="h-3 w-3 rounded border-zinc-700 bg-zinc-900 accent-emerald-500"
                />
                Sembunyikan refuted
              </label>
            </>
          )}
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
            : 'Tidak ada temuan dengan filter ini.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((f) => {
            const open = openId === f.id;
            const refuted = f.validation_status === 'refuted';
            return (
              <div
                key={f.id}
                className={`rounded-xl border bg-zinc-900/50 transition hover:border-zinc-700 ${
                  refuted ? 'border-zinc-800/60 opacity-60' : 'border-zinc-800'
                }`}
              >
                <button
                  onClick={() => setOpenId(open ? null : f.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-left"
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-2.5">
                    <SeverityBadge severity={f.severity} />
                    <span className={`truncate text-sm font-medium ${refuted ? 'text-zinc-400 line-through' : 'text-zinc-200'}`}>
                      {f.title}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2.5">
                    {f.validation_status && <ValidationBadge status={f.validation_status} />}
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
                    {f.validation_status && f.validation_evidence && (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Bukti validasi ({f.validation_status})
                        </p>
                        <p className="mt-1 whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-relaxed text-zinc-300">
                          {f.validation_evidence}
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
