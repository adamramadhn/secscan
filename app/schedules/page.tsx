'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  createScheduleApi,
  deleteScheduleApi,
  getSchedules,
  patchSchedule,
  runScheduleNow,
  Schedule,
} from '@/lib/api';

function formatInterval(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} hari`;
  if (min % 60 === 0) return `${min / 60} jam`;
  return `${min} menit`;
}

function timeAgo(ts: number | null): string {
  if (!ts) return 'belum pernah';
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

const INTERVAL_OPTIONS = [
  { value: 360, label: '6 jam' },
  { value: 720, label: '12 jam' },
  { value: 1440, label: '1 hari' },
  { value: 10080, label: '7 hari' },
];

export default function SchedulesPage() {
  const router = useRouter();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchSchedules = useCallback(async () => {
    try {
      const { schedules: data } = await getSchedules();
      setSchedules(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push('/login');
    }
  }, [router]);

  useEffect(() => {
    fetchSchedules().then(() => setLoading(false));
    const t = setInterval(fetchSchedules, 30_000);
    return () => clearInterval(t);
  }, [fetchSchedules]);

  async function handleToggle(s: Schedule) {
    setBusy(s.id);
    setMessage(null);
    try {
      await patchSchedule(s.id, { enabled: !(s.enabled === 1) });
      await fetchSchedules();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal mengubah jadwal');
    } finally {
      setBusy(null);
    }
  }

  async function handleRun(s: Schedule) {
    setBusy(s.id);
    setMessage(null);
    try {
      await runScheduleNow(s.id);
      setMessage(`"${s.name}" akan dijalankan dalam ≤60 detik — pantau di daftar job.`);
      setTimeout(fetchSchedules, 65_000);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal memicu jadwal');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(s: Schedule) {
    if (!confirm(`Hapus jadwal "${s.name}"? Job yang sudah jalan tidak ikut terhapus.`)) return;
    setBusy(s.id);
    setMessage(null);
    try {
      await deleteScheduleApi(s.id);
      await fetchSchedules();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal menghapus jadwal');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-zinc-400 transition hover:text-zinc-200">
              ← Job
            </Link>
            <h1 className="text-base font-semibold tracking-tight text-zinc-100">Jadwal Scan</h1>
          </div>
          <Link
            href="/new"
            className="rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
          >
            Scan Baru
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        {message && (
          <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {message}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-zinc-500">Memuat…</p>
        ) : schedules.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 p-10 text-center">
            <p className="text-sm text-zinc-400">Belum ada jadwal.</p>
            <p className="mt-2 text-xs leading-relaxed text-zinc-600">
              Buka salah satu job yang sudah selesai, klik <span className="text-zinc-400">Jadwalkan</span> untuk
              membuat scan berkala dari konfigurasi job itu.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {schedules.map((s) => (
              <div
                key={s.id}
                className={`flex flex-col gap-4 rounded-xl border p-5 ${
                  s.enabled === 1 ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-800/50 bg-zinc-900/20 opacity-60'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${s.enabled === 1 ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                      />
                      <h2 className="truncate text-sm font-semibold text-zinc-100">{s.name}</h2>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-zinc-500">{s.repo_url}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                      <span className="rounded-md bg-zinc-800/70 px-2 py-0.5">
                        {s.target_type === 'url' ? 'LIVE URL' : s.branch}
                      </span>
                      <span className="rounded-md bg-zinc-800/70 px-2 py-0.5">{s.skills.join(', ')}</span>
                      <span className="rounded-md bg-zinc-800/70 px-2 py-0.5">{s.depth}</span>
                      {s.validate === 1 && (
                        <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-sky-300">validasi</span>
                      )}
                      {s.auto_fix === 1 && (
                        <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-emerald-300">auto-fix</span>
                      )}
                      {s.diff_base && (
                        <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-sky-300">diff-scope vs {s.diff_base}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRun(s)}
                      disabled={busy === s.id || s.enabled !== 1}
                      className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-40"
                    >
                      ▶ Jalankan
                    </button>
                    <button
                      onClick={() => handleToggle(s)}
                      disabled={busy === s.id}
                      className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-500 disabled:opacity-40"
                    >
                      {s.enabled === 1 ? 'Pause' : 'Aktifkan'}
                    </button>
                    <button
                      onClick={() => handleDelete(s)}
                      disabled={busy === s.id}
                      className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 transition hover:bg-red-500/10 disabled:opacity-40"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/60 pt-3 text-xs text-zinc-500">
                  <span>
                    Setiap <span className="text-zinc-300">{formatInterval(s.interval_minutes)}</span> · terakhir{' '}
                    {timeAgo(s.last_run_at)}
                  </span>
                  <div className="flex items-center gap-2">
                    {INTERVAL_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        onClick={async () => {
                          setBusy(s.id);
                          try {
                            await patchSchedule(s.id, { intervalMinutes: o.value });
                            await fetchSchedules();
                          } finally {
                            setBusy(null);
                          }
                        }}
                        disabled={busy === s.id}
                        className={`rounded-md px-2 py-1 transition ${
                          s.interval_minutes === o.value
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'text-zinc-500 hover:text-zinc-300'
                        } disabled:opacity-40`}
                      >
                        {o.label}
                      </button>
                    ))}
                    {s.last_job_id && (
                      <Link
                        href={`/jobs/${s.last_job_id}`}
                        className="rounded-md border border-zinc-800 px-2 py-1 text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
                      >
                        Job terakhir →
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
