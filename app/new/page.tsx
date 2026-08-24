'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, createJob, getSkills, Groups, SkillDef } from '@/lib/api';

const STEPS = ['Target', 'Skill', 'Konfirmasi'] as const;

const DEPTHS: { value: string; label: string; desc: string }[] = [
  { value: 'light', label: 'Light', desc: 'Cepat — pemeriksaan dasar saja' },
  { value: 'medium', label: 'Medium', desc: 'Seimbang antara kecepatan dan cakupan' },
  { value: 'deep', label: 'Deep', desc: 'Menyeluruh — butuh waktu lebih lama' },
];

const GROUP_META: Record<string, { title: string; tint: string }> = {
  ofensif: {
    title: 'Ofensif — butuh konfirmasi',
    tint: 'text-red-400 border-red-500/30 bg-red-500/10',
  },
  scanning: {
    title: 'Scanning',
    tint: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  },
  analisis: {
    title: 'Analisis',
    tint: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  },
};

function isValidGitHubUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.trim());
}

export default function NewScanPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Step 1
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [depth, setDepth] = useState('medium');
  const [instructions, setInstructions] = useState('');
  const repoValid = isValidGitHubUrl(repoUrl);

  // Step 2
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [groups, setGroups] = useState<Groups | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Step 3
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    getSkills()
      .then((res) => {
        setSkills(res.skills);
        setGroups(res.groups);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/login');
        else setError('Gagal memuat daftar skill.');
      });
  }, [router]);

  function toggleSkill(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setConfirmed(false); // pilihan berubah → konfirmasi harus diulang
  }

  const selectedSkills = skills.filter((s) => selected.has(s.name));
  const hasOfensif = selectedSkills.some((s) => s.ofensif);

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { jobId } = await createJob({
        repoUrl: repoUrl.trim(),
        branch: branch.trim() || 'main',
        skills: Array.from(selected),
        depth,
        instructions: instructions.trim() || null,
        confirmOfensif: hasOfensif ? confirmed : false,
      });
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      let message = 'Gagal membuat scan. Coba lagi.';
      if (err instanceof ApiError) {
        if (err.status === 401) {
          router.replace('/login');
          return;
        }
        switch (err.message) {
          case 'invalid_repo_url':
            message = 'URL repository tidak valid.';
            break;
          case 'invalid_skills':
            message = 'Daftar skill tidak valid.';
            break;
          case 'confirm_ofensif_required':
            message = 'Konfirmasi izin untuk skill ofensif wajib dicentang.';
            break;
          case 'too_many_jobs':
            message = 'Terlalu banyak scan aktif. Tunggu sampai ada yang selesai, lalu coba lagi.';
            break;
          case 'instructions_too_long':
            message = 'Instruksi terlalu panjang (maks 4000 karakter).';
            break;
          case 'clone_failed':
            message = err.detail
              ? `Gagal meng-clone repository: ${err.detail}`
              : 'Gagal meng-clone repository. Pastikan URL dapat diakses publik.';
            break;
          default:
            message = 'Gagal membuat scan. Coba lagi.';
        }
      }
      setError(message);
      setSubmitting(false);
    }
  }

  function goNext() {
    setError(null);
    if (step === 1 && selected.size === 0) return;
    setStep((s) => Math.min(s + 1, 2));
  }

  function goBack() {
    setError(null);
    setSubmitting(false);
    setStep((s) => Math.max(s - 1, 0));
  }

  return (
    <main className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-sm font-bold text-emerald-400">
              SH
            </div>
            <h1 className="text-base font-semibold tracking-tight text-zinc-100">Scan Baru</h1>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-zinc-800 px-3.5 py-2 text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
          >
            Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        {/* Stepper */}
        <ol className="mb-10 flex items-center gap-2">
          {STEPS.map((label, i) => {
            const active = i === step;
            const done = i < step;
            return (
              <li key={label} className="flex flex-1 items-center gap-2">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition ${
                    done
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                      : active
                        ? 'border-emerald-500 bg-emerald-500 text-zinc-950'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-600'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </div>
                <span
                  className={`text-sm font-medium ${
                    active || done ? 'text-zinc-200' : 'text-zinc-600'
                  }`}
                >
                  {label}
                </span>
                {i < STEPS.length - 1 && (
                  <div
                    className={`mx-1 h-px flex-1 ${
                      done ? 'bg-emerald-500/40' : 'bg-zinc-800'
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 shadow-2xl shadow-black/30">
          <div className="p-6 sm:p-8">
            {step === 0 && (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-1.5">
                  <h2 className="text-lg font-semibold text-zinc-100">Target Repository</h2>
                  <p className="text-sm text-zinc-500">
                    Repository GitHub publik yang akan di-scan.
                  </p>
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Repo URL
                  </span>
                  <input
                    type="text"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className="rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 font-mono text-sm text-zinc-100 placeholder-zinc-600 transition focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                  {repoUrl.trim().length > 0 && !repoValid && (
                    <span className="text-xs text-red-400">
                      Format harus https://github.com/owner/repo
                    </span>
                  )}
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Branch
                  </span>
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
                    className="rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 font-mono text-sm text-zinc-100 placeholder-zinc-600 transition focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </label>

                <fieldset className="flex flex-col gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Kedalaman Scan
                  </span>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {DEPTHS.map((d) => {
                      const activeDepth = depth === d.value;
                      return (
                        <label
                          key={d.value}
                          className={`cursor-pointer rounded-lg border p-3.5 transition ${
                            activeDepth
                              ? 'border-emerald-500/50 bg-emerald-500/10'
                              : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
                          }`}
                        >
                          <input
                            type="radio"
                            name="depth"
                            value={d.value}
                            checked={activeDepth}
                            onChange={() => setDepth(d.value)}
                            className="sr-only"
                          />
                          <span
                            className={`block text-sm font-semibold ${
                              activeDepth ? 'text-emerald-400' : 'text-zinc-200'
                            }`}
                          >
                            {d.label}
                          </span>
                          <span className="mt-1 block text-xs leading-relaxed text-zinc-500">
                            {d.desc}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Instruksi Khusus{' '}
                    <span className="normal-case text-zinc-600">(opsional)</span>
                  </span>
                  <textarea
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value.slice(0, 4000))}
                    rows={3}
                    placeholder="Contoh: fokus pada business logic flaw dan IDOR; abaikan folder docs/; sertakan contoh PoC tiap temuan."
                    className="resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm leading-relaxed text-zinc-100 placeholder-zinc-600 transition focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <span className="text-right text-[11px] text-zinc-600">
                    {instructions.length}/4000 — diteruskan ke setiap skill
                  </span>
                </label>
              </div>
            )}

            {step === 1 && (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-1">
                  <h2 className="text-lg font-semibold text-zinc-100">Pilih Skill</h2>
                  <p className="text-sm text-zinc-500">
                    {selected.size} skill dipilih — jalankan minimal 1.
                  </p>
                </div>

                {groups &&
                  (['ofensif', 'scanning', 'analisis'] as const).map((key) => (
                    <section key={key} className="flex flex-col gap-2.5">
                      <h3
                        className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${GROUP_META[key].tint}`}
                      >
                        {GROUP_META[key].title}
                      </h3>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {groups[key]
                          .map((name) => skills.find((s) => s.name === name))
                          .filter((s): s is SkillDef => Boolean(s))
                          .map((skill) => {
                            const checked = selected.has(skill.name);
                            return (
                              <label
                                key={skill.name}
                                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition ${
                                  checked
                                    ? 'border-emerald-500/50 bg-emerald-500/10'
                                    : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleSkill(skill.name)}
                                  className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-emerald-500"
                                />
                                <span className="flex flex-col gap-1">
                                  <span className="text-sm font-medium text-zinc-200">
                                    {skill.name}
                                    {skill.ofensif && (
                                      <span className="ml-2 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
                                        Ofensif
                                      </span>
                                    )}
                                  </span>
                                  <span className="text-xs leading-relaxed text-zinc-500">
                                    {skill.description}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                      </div>
                    </section>
                  ))}
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-1">
                  <h2 className="text-lg font-semibold text-zinc-100">Konfirmasi Scan</h2>
                  <p className="text-sm text-zinc-500">Periksa kembali sebelum menjalankan.</p>
                </div>

                <div className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-xs uppercase tracking-wide text-zinc-500">Repository</span>
                    <span className="break-all text-right font-mono text-sm text-zinc-200">
                      {repoUrl.trim()}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-xs uppercase tracking-wide text-zinc-500">Branch</span>
                    <span className="font-mono text-sm text-zinc-200">{branch.trim() || 'main'}</span>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-xs uppercase tracking-wide text-zinc-500">Kedalaman</span>
                    <span className="text-sm capitalize text-zinc-200">{depth}</span>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-xs uppercase tracking-wide text-zinc-500">Skill</span>
                    <span className="text-right text-sm text-zinc-200">{selected.size} skill</span>
                  </div>
                  {instructions.trim() && (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-wide text-zinc-500">Instruksi</span>
                      <p className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm leading-relaxed text-zinc-300">
                        {instructions.trim()}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {selectedSkills.map((s) => (
                    <span
                      key={s.name}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${
                        s.ofensif
                          ? 'border-red-500/30 bg-red-500/10 text-red-300'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-300'
                      }`}
                    >
                      {s.name}
                      {s.ofensif && <span className="text-red-400">•</span>}
                    </span>
                  ))}
                </div>

                {hasOfensif && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                    <p className="text-sm font-semibold text-red-300">
                      ⚠️ Scan ini mencakup skill ofensif
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-red-300/80">
                      Skill ofensif menjalankan uji penetrasi aktif terhadap target. Pastikan Anda
                      memiliki hak dan izin tertulis sebelum melanjutkan.
                    </p>
                    <label className="mt-3 flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-emerald-500"
                      />
                      <span className="text-sm text-zinc-200">
                        Saya mengonfirmasi target ini milik saya / saya punya izin untuk pentest
                      </span>
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="border-t border-zinc-800 px-6 py-3 sm:px-8">
              <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-4 sm:px-8">
            <button
              onClick={goBack}
              disabled={step === 0 || submitting}
              className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Kembali
            </button>

            {step < 2 ? (
              <button
                onClick={goNext}
                disabled={step === 0 ? !repoValid : selected.size === 0}
                className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Lanjut
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitting || (hasOfensif && !confirmed)}
                className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Menjalankan…' : 'Jalankan Scan'}
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}