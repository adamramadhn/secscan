'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ApiError,
  downloadReportUrl,
  eventSourceUrl,
  getJob,
  Job,
  JobSkill,
  Finding,
  Fix,
} from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import Progress from '@/components/Progress';
import FindingsPanel from '@/components/FindingsPanel';
import FixesPanel from '@/components/FixesPanel';

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

function formatDuration(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';

  const [job, setJob] = useState<Job | null>(null);
  const [jobSkills, setJobSkills] = useState<JobSkill[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState(false);

  // Sinkronkan state dari snapshot { job, jobSkills, findings }.
  const applySnapshot = useCallback((data: { job: Job; jobSkills: JobSkill[]; findings?: Finding[]; fixes?: Fix[] }) => {
    setJob(data.job);
    setJobSkills(data.jobSkills);
    setFindings(data.findings ?? []);
    setFixes(data.fixes ?? []);
    setLoading(false);
    setNotFound(false);
  }, []);

  // Fetch awal + fallback polling.
  const fetchDetail = useCallback(async () => {
    try {
      const data = await getJob(id);
      applySnapshot(data);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = '/login';
      } else if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
        setLoading(false);
      }
      return false;
    }
  }, [id, applySnapshot]);

  // ——— SSE live updates ———
  // Backend mengirim event bernama `data` (event: data\ndata: {...}) tiap 2s,
  // event `end` saat status terminal, dan event `error` bila job hilang —
  // jadi pakai addEventListener, bukan onmessage.
  useEffect(() => {
    if (!id) return;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let finished = false;

    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(fetchDetail, 5000);
    };

    fetchDetail().then((ok) => {
      if (!ok || finished) return;

      es = new EventSource(eventSourceUrl(id));
      setLive(true);

      es.addEventListener('data', (ev) => {
        try {
          applySnapshot(JSON.parse((ev as MessageEvent).data));
        } catch {
          // payload tidak valid — biarkan polling fallback menutup
        }
      });

      es.addEventListener('end', () => {
        finished = true;
        es?.close();
        setLive(false);
        fetchDetail(); // fetch final
      });

      es.addEventListener('error', () => {
        // job hilang / stream error → tutup & fallback poll
        es?.close();
        setLive(false);
        startPolling();
      });

      es.onerror = () => {
        // koneksi SSE putus (mis. dev reload) → tutup & poll tiap 5s
        es?.close();
        setLive(false);
        startPolling();
      };
    });

    return () => {
      finished = true;
      es?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [id, applySnapshot, fetchDetail]);

  const terminal = job?.status === 'done' || job?.status === 'failed';
  const canDownload = Boolean(job?.report_path) && terminal;
  const criticalCount = findings.filter((f) => f.severity === 'Critical' || f.severity === 'High').length;
  const hasFindings = criticalCount > 0 || jobSkills.some((js) => (js.output ?? '').includes('## Temuan'));
  const activeSkill = jobSkills.find((js) => js.status === 'running');

  async function copyShareLink() {
    if (!job?.share_token) return;
    const url = `${window.location.origin}/api/share/${job.share_token}/report`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API gagal (mis. non-secure context) — fallback prompt
      window.prompt('Salin link report:', url);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950">
        <p className="text-sm text-zinc-500">Memuat…</p>
      </main>
    );
  }

  if (notFound || !job) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 px-4">
        <p className="text-sm text-red-400">Job tidak ditemukan.</p>
        <Link
          href="/"
          className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
        >
          Kembali ke Dashboard
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-zinc-400 transition hover:text-zinc-200"
          >
            <span aria-hidden>←</span> Dashboard
          </Link>
          <a
            href={canDownload ? downloadReportUrl(id) : undefined}
            aria-disabled={!canDownload}
            onClick={(e) => {
              if (!canDownload) e.preventDefault();
            }}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              canDownload
                ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
                : 'cursor-not-allowed bg-zinc-800 text-zinc-500'
            }`}
          >
            Download Report
          </a>
          {job.share_token && terminal && (
            <button
              onClick={copyShareLink}
              className="rounded-lg border border-zinc-800 px-3.5 py-2 text-sm text-zinc-300 transition hover:border-zinc-700 hover:text-zinc-100"
            >
              {copied ? '✓ Tersalin' : 'Share Link'}
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        {/* Ringkasan job */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <h1 className="break-all font-mono text-base font-medium text-zinc-100">
                {job.repo_url}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                {job.target_type === 'url' && (
                  <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 font-medium text-red-300">
                    URL Live
                  </span>
                )}
                {job.target_type !== 'url' && (
                  <span className="rounded-md bg-zinc-800/70 px-2 py-0.5 font-mono text-zinc-400">
                    {job.branch}
                  </span>
                )}
                <span className="rounded-md bg-zinc-800/70 px-2 py-0.5 capitalize text-zinc-400">
                  {job.depth}
                </span>
                <span>{relativeTime(job.created_at)}</span>
              </div>
            </div>
          <div className="flex flex-wrap items-center gap-2">
            {criticalCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-300">
                {criticalCount} Critical/High
              </span>
            )}
            {hasFindings && criticalCount === 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400">
                Ada temuan
              </span>
            )}
            <StatusBadge status={job.status} />
          </div>
          </div>

          <Progress value={job.progress} />

          <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
            <span>
              {activeSkill ? (
                <>
                  Menjalankan <span className="font-mono text-zinc-400">{activeSkill.skill}</span>
                </>
              ) : terminal ? (
                'Selesai'
              ) : (
                `${jobSkills.length} skill dalam antrean`
              )}
            </span>
            <span className="flex items-center gap-1.5">
              {live && !terminal && (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              )}
              {live && !terminal ? 'Live' : terminal ? 'Selesai' : 'Menunggu'}
            </span>
          </div>

          {job.error && (
            <p className="mt-4 break-all rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {job.error}
            </p>
          )}

          {job.instructions && (
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Instruksi operator</p>
              <p className="mt-1 break-words text-sm leading-relaxed text-zinc-300">{job.instructions}</p>
            </div>
          )}
        </div>

        {/* Temuan terstruktur (muncul live saat skill selesai) */}
        <FindingsPanel findings={findings} />
        {fixes.length > 0 && <FixesPanel fixes={fixes} jobId={id} />}

        {/* Daftar skill */}
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Skills ({jobSkills.length})
          </h2>
          {jobSkills.map((js) => {
            const duration = formatDuration(
              js.started_at !== null && js.finished_at !== null ? js.finished_at - js.started_at : null,
            );
            const hasOutput = Boolean(js.output && js.output.trim().length > 0);
            const skillFindings = (js.output ?? '').includes('## Temuan');
            return (
              <div
                key={js.skill}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 transition hover:border-zinc-700"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-mono text-sm text-zinc-200">{js.skill}</span>
                    {skillFindings && (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                        Ada temuan
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {duration && <span className="text-xs text-zinc-500">{duration}</span>}
                    <StatusBadge status={js.status} />
                  </div>
                </div>
                {hasOutput && (
                  <div className="border-t border-zinc-800 px-5 py-4">
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-400">
                      {js.output}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
          {jobSkills.length === 0 && (
            <p className="rounded-xl border border-dashed border-zinc-800 px-5 py-8 text-center text-sm text-zinc-500">
              Skill akan muncul saat worker mulai memproses job ini.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}