'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, getJobs, login } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkingRef = useRef(false);

  useEffect(() => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    getJobs()
      .then(() => router.replace('/'))
      .catch(() => {
        // 401 → belum login, tampilkan form
      });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || password.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      await login(password);
      router.replace('/');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Password salah. Coba lagi.');
      } else if (err instanceof ApiError && err.status === 429) {
        setError('Terlalu banyak percobaan. Tunggu beberapa menit.');
      } else {
        setError('Tidak bisa terhubung ke server. Coba lagi.');
      }
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 shadow-2xl shadow-black/40">
          <div className="mb-8 flex flex-col items-center gap-2 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-lg font-bold text-emerald-400">
              SH
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">SecurityScan Hub</h1>
            <p className="text-sm text-zinc-500">Masuk untuk mengelola scan keamanan repository</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoFocus
                disabled={loading}
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 transition focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60"
              />
            </label>

            {error && (
              <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || password.length === 0}
              className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Masuk...' : 'Masuk'}
            </button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-zinc-600">
          Akses terbatas — hanya untuk operator yang berwenang.
        </p>
      </div>
    </main>
  );
}