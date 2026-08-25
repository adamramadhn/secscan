'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, getJobs, logout, Job } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import Progress from '@/components/Progress';

/** Waktu relatif sederhana dalam Bahasa Indonesia. */
function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}

function truncateRepo(url: string, max = 44): string {
  if (url.length <= max) return url;
  const head = url.slice(0, max - 3);
  return `${head}…`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const hasActiveRef = useRef(false);

  const fetchJobs = useCallback(async () => {
    try {
      const { jobs: data } = await getJobs();
      setJobs(data);
      hasActiveRef.current = data.some((j) => j.status === 'queued' || j.status === 'running');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
      }
    }
  }, [router]);

  useEffect(() => {
    fetchJobs().then(() => setLoading(false));
    // Refetch tiap 5 detik selama masih ada job aktif (queued/running).
    const interval = setInterval(() => {
      if (hasActiveRef.current) fetchJobs();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // abaikan — cookie tetap dibersihkan oleh server
    }
    router.replace('/login');
  }

  const activeCount = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;

  return (
    <main className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-sm font-bold text-emerald-400">
              SH
            </div>
            <h1 className="text-base font-semibold tracking-tight text-zinc-100">SecurityScan Hub</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/schedules"
              className="rounded-lg border border-zinc-800 px-3.5 py-2 text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
            >
              Jadwal
            </Link>
            <Link
              href="/new"
              className="rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
            >
              Scan Baru
            </Link>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-zinc-800 px-3.5 py-2 text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">Riwayat Scan</h2>
          <p className="text-sm text-zinc-500">
            {loading ? 'Memuat…' : `${jobs.length} total`}
            {activeCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1.5 text-emerald-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                {activeCount} aktif
              </span>
            )}
          </p>
        </div>

        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-20 text-center">
            <p className="text-sm text-zinc-500">Belum ada scan.</p>
            <Link
              href="/new"
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
            >
              Mulai Scan Pertama
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-4 py-3 font-medium">Repository</th>
                    <th className="px-4 py-3 font-medium">Branch</th>
                    <th className="px-4 py-3 font-medium">Skills</th>
                    <th className="px-4 py-3 font-medium">Progress</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Waktu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      className="group transition hover:bg-zinc-800/30"
                    >
                      <td className="px-4 py-3.5">
                        <Link
                          href={`/jobs/${job.id}`}
                          className="font-medium text-zinc-200 transition group-hover:text-emerald-400"
                        >
                          {truncateRepo(job.repo_url)}
                        </Link>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="rounded-md bg-zinc-800/70 px-2 py-0.5 font-mono text-xs text-zinc-400">
                          {job.branch}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-zinc-400">{job.skills.length} skill</td>
                      <td className="px-4 py-3.5">
                        <div className="w-28">
                          <Progress value={job.progress} showLabel={false} />
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={job.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-zinc-500">
                        {relativeTime(job.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}