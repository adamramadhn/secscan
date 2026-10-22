'use client';

import { useState } from 'react';
import type { Finding, ValidationStatus } from '@/lib/api';
import SeverityBadge from '@/components/SeverityBadge';

const ORDER = ['Critical', 'High', 'Medium', 'Low', 'Info'] as const;

const VALIDATION_STYLE: Record<string, string> = {
  confirmed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  'evidence-backed': 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  candidate: 'border-zinc-600/40 bg-zinc-800/40 text-zinc-400',
  refuted: 'border-zinc-500/40 bg-zinc-700/20 text-zinc-400 line-through',
  inconclusive: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
};

function ValidationBadge({ status }: { status: ValidationStatus }) {
  const cls = VALIDATION_STYLE[status] ?? VALIDATION_STYLE.inconclusive;
  const label =
    status === 'confirmed'
      ? '✓ Confirmed'
      : status === 'evidence-backed'
      ? '✓ Evidence-Backed'
      : status === 'candidate'
      ? '○ Candidate'
      : status === 'refuted'
      ? '✗ Refuted'
      : '? Inconclusive';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function SourceBadge({ tool }: { tool?: string | null }) {
  if (tool === 'trivy') {
    return (
      <span className="inline-flex items-center rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-300">
        Trivy SCA
      </span>
    );
  }
  if (tool === 'passive-web') {
    return (
      <span className="inline-flex items-center rounded-md border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[11px] font-semibold text-purple-300">
        Passive Web
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
      AI (Hermes)
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence?: string | null }) {
  if (!confidence) return null;
  const c = confidence.toLowerCase();
  const cls =
    c === 'high'
      ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
      : c === 'low'
      ? 'border-zinc-700 text-zinc-400 bg-zinc-800/50'
      : 'border-amber-500/30 text-amber-300 bg-amber-500/10';
  const label = c === 'high' ? 'Keyakinan Tinggi' : c === 'low' ? 'Keyakinan Rendah' : 'Keyakinan Sedang';
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

/**
 * Panel temuan terstruktur: filter jalur (Semua / Deterministik / AI),
 * counter severity, badge CVE/CWE, dan daftar expandable.
 */
export default function FindingsPanel({ findings }: { findings: Finding[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'deterministic' | 'ai'>('all');
  const [hideRefuted, setHideRefuted] = useState(false);

  const nDeterministic = findings.filter((f) => f.source_tool === 'trivy' || f.source_tool === 'passive-web').length;
  const nAi = findings.filter((f) => f.source_tool !== 'trivy' && f.source_tool !== 'passive-web').length;

  const counts: Record<string, number> = {};
  for (const sev of ORDER) counts[sev] = 0;
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }

  const nConfirmed = findings.filter((f) => f.validation_status === 'confirmed').length;
  const nRefuted = findings.filter((f) => f.validation_status === 'refuted').length;
  const hasValidation = findings.some((f) => f.validation_status);

  const shown = findings
    .filter((f) => {
      if (sourceFilter === 'deterministic') return f.source_tool === 'trivy' || f.source_tool === 'passive-web';
      if (sourceFilter === 'ai') return f.source_tool !== 'trivy' && f.source_tool !== 'passive-web';
      return true;
    })
    .filter((f) => (filter ? f.severity === filter : true))
    .filter((f) => (hideRefuted ? f.validation_status !== 'refuted' : true));

  return (
    <div className="flex flex-col gap-4">
      {/* Header & View Switcher Tabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Temuan ({findings.length})
          </h2>
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
            <button
              onClick={() => setSourceFilter('all')}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                sourceFilter === 'all' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Semua ({findings.length})
            </button>
            <button
              onClick={() => setSourceFilter('deterministic')}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                sourceFilter === 'deterministic'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Deterministik ({nDeterministic})
            </button>
            <button
              onClick={() => setSourceFilter('ai')}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                sourceFilter === 'ai' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Analisis AI ({nAi})
            </button>
          </div>
        </div>

        {/* Severity & Validation Status Badges */}
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
                    <SourceBadge tool={f.source_tool} />
                    {f.cve_id && (
                      <span className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-mono text-xs font-medium text-rose-300">
                        {f.cve_id}
                      </span>
                    )}
                    {f.cwe_id && (
                      <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-xs font-medium text-amber-300">
                        {f.cwe_id.length > 25 ? `${f.cwe_id.slice(0, 25)}…` : f.cwe_id}
                      </span>
                    )}
                    <span className={`truncate text-sm font-medium ${refuted ? 'text-zinc-400 line-through' : 'text-zinc-200'}`}>
                      {f.title}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2.5">
                    {f.validation_status && <ValidationBadge status={f.validation_status} />}
                    {f.seen_count != null && f.seen_count >= 2 && (
                      <span
                        className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300"
                        title="Terulang di beberapa scan — kemungkinan belum diperbaiki / regresi"
                      >
                        berulang ×{f.seen_count}
                      </span>
                    )}
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
                    {/* Metadata Header */}
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <ConfidenceBadge confidence={f.confidence} />
                      {f.cve_id && (
                        <span className="text-zinc-400">
                          CVE: <strong className="font-mono text-rose-300">{f.cve_id}</strong>
                        </span>
                      )}
                      {f.cwe_id && (
                        <span className="text-zinc-400">
                          CWE: <strong className="font-mono text-amber-300">{f.cwe_id}</strong>
                        </span>
                      )}
                      {f.source_tool && (
                        <span className="text-zinc-400">
                          Sumber deteksi: <strong className="text-zinc-200">{f.source_tool}</strong>
                        </span>
                      )}
                    </div>

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
                    {f.validation_evidence && (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                          {f.source_tool === 'trivy' || f.source_tool === 'passive-web'
                            ? 'Bukti Teknis Deterministik'
                            : `Bukti Validasi (${f.validation_status ?? 'candidate'})`}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-300">
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
