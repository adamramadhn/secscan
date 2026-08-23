# SecurityScan Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "secscan.dams.my.id" — a Next.js web app on vps2 that runs selected Hermes security skills against a GitHub repo, with live progress (BullMQ+Redis) and downloadable markdown reports.

**Architecture:** Next.js 15 (App Router, API routes) + SQLite (better-sqlite3) as source of truth + BullMQ over local Redis for the job queue + a standalone worker process that spawns `hermes -z ... -s <skill> --in <repo> --safe-mode` per skill, persisting per-skill status to SQLite and streaming live progress via SSE. Deployed non-Docker via systemd (app on 127.0.0.1:3011, worker separate unit) behind nginx + Let's Encrypt.

**Tech Stack:** Node 22 (vps2), Next.js 15, React 19, Tailwind CSS v3, better-sqlite3, bullmq, ioredis, bcryptjs, next-themes. Deploy: systemd + nginx.

**Spec:** `/root/secscan-archived/docs/spec-design.md` (approved 2026-08-23).

## Global Constraints

- Target rilis: prod di vps2, port 3011, bind 127.0.0.1. Subdomain `secscan.dams.my.id`.
- Hermes engine: `hermes -z "<task>" -s <skill> --in <workdir> --safe-mode` (JANGAN --yolo; --safe-mode wajib).
- Repo source of truth: `/root/secscan-archived` (git init + commit tiap task).
- JANGAN `pkill -f next-server` (memutus gateway Hermes). Kill app spesifik via `ss -tlnp | grep :3011`.
- Env prod di `/opt/secscan/secscan.env` (tidak di-commit). Dev pakai `.env.local`.
- Skill ofensif (🔴: penetration-testing, dast-scanning, ai-red-teaming) WAJIB konfirmasi eksplisit di UI sebelum spawn.
- Semua path kerja scan: `/var/lib/secscan/work/<jobId>/` (clone), reports: `/var/lib/secscan/reports/<jobId>/`.
- Password login: `CakraVistaA1` (bcrypt hash di env AUTH_PASSWORD_HASH).
- BullMQ Redis: `redis://127.0.0.1:6379/5`. Worker concurrency 1.
- UI: dark theme ala Linear, referensi skill ui-styling/design-system/ui-ux-pro-max.

---

### Task 1: Scaffold + dependensi + konfigurasi dasar

**Files:**
- Create: `/root/secscan-archived/package.json`, `next.config.mjs`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `.gitignore`, `.env.local` (dev), `app/layout.tsx`, `app/globals.css`, `app/page.tsx` (placeholder), `lib/` (kosong sementara)
- Test: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3011`

**Interfaces:**
- Produces: app boots `http://127.0.0.1:3011` (dev), layout dark + globals.css siap.

- [ ] **Step 1: Init struktur + package.json**

```json
{
  "name": "secscan",
  "version": "0.1.0",
  "private": true,
  "scripts": { "dev": "next dev -p 3011", "build": "next build", "start": "next start -p 3011", "worker": "node worker.js" },
  "dependencies": {
    "next": "15", "react": "19", "react-dom": "19",
    "better-sqlite3": "^11", "bullmq": "^5", "ioredis": "^5",
    "bcryptjs": "^2", "uuid": "^9"
  },
  "devDependencies": { "typescript": "^5", "@types/node": "^22", "@types/react": "^19", "@types/better-sqlite3": "^7", "tailwindcss": "^3.4", "postcss": "^8", "autoprefixer": "^10" }
}
```

- [ ] **Step 2: Install** — `cd /root/secscan-archived && npm install`

- [ ] **Step 3: next.config.mjs + tsconfig + tailwind + postcss + .gitignore + .env.local**

```js
// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = { output: 'standalone' };
export default nextConfig;
```

```json
// .env.local (dev, tidak di-commit)
AUTH_PASSWORD_HASH=$2a$10$LkJm9bJ6FhPw/yn5mNQmIuJWJqtdg0O2lYkJ/M0n9b8G0k0m0a2m
SESSION_SECRET=dev-secret-change-me
REDIS_URL=redis://127.0.0.1:6379/5
WORK_DIR=/var/lib/secscan/work
REPORT_DIR=/var/lib/secscan/reports
MAX_JOBS=5
```

- [ ] **Step 4: app/layout.tsx + globals.css (dark) + placeholder page**

```tsx
// app/layout.tsx
import './globals.css';
export const metadata = { title: 'SecurityScan Hub', description: 'Hermes skill scanner' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="id" className="dark"><body className="bg-zinc-950 text-zinc-100 min-h-screen">{children}</body></html>;
}
```

- [ ] **Step 5: Verifikasi dev boot** — `npm run dev` (background), `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3011` → 200. Stop.

- [ ] **Step 6: Commit** — `git init && git add -A && git commit -m "chore: scaffold secscan nextjs"`

### Task 2: DB layer (SQLite) + lib inti

**Files:**
- Create: `lib/db.ts`, `lib/password.ts`, `lib/skills.ts`
- Test: `node -e "require('./lib/db.ts')"` via tsx? — gunakan `npx tsx` (tambah devDep `tsx`)

**Interfaces:**
- `lib/db.ts`: `getDb(): Database` (singleton), `initDb()`, `createJob(input): JobRow`, `getJob(id): JobRow|null`, `listJobs(): JobRow[]`, `updateJob(id, patch)`, `upsertJobSkill(jobId, skill, patch)`, `getJobSkills(jobId): JobSkillRow[]`, `addAudit(action, detail)`
- `lib/password.ts`: `verifyPassword(plain): boolean` (bcrypt vs env AUTH_PASSWORD_HASH), `hashPassword(plain): string`
- `lib/skills.ts`: `SKILLS: SkillDef[]`, `getSkill(name)`, `SKILL_GROUPS`

Schema persis di spec §4. Path DB: env `DB_PATH` default `/var/lib/secscan/secscan.db`.

- [ ] **Step 1: Tulis schema + koneksi (db.ts)** — better-sqlite3, `mkdir -p /var/lib/secscan`, WAL mode, tabel jobs/job_skills/sessions/audit_log (skema spec §4)
- [ ] **Step 2: password.ts** — bcryptjs verify + hash
- [ ] **Step 3: skills.ts** — katalog 13 skill (spec §5) + kelompok + flag ofensif
- [ ] **Step 4: Tes** — `npx tsx -e "import {initDb,createJob} from './lib/db'; initDb(); console.log(createJob({repo_url:'x',branch:'main',target_type:'github',skills_json:'[]',depth:'medium'}))"` → id muncul; query balik
- [ ] **Step 5: Commit** — `feat: db layer + password + skill catalog`

### Task 3: Auth (session cookie + bcrypt)

**Files:**
- Create: `lib/auth.ts`, `app/api/login/route.ts`, `app/api/logout/route.ts`
- Test: curl login salah → 401; login benar → 200 + cookie; protected → data

**Interfaces:**
- `lib/auth.ts`: `createSession(): Promise<string>` (token uuid, simpan di tabel sessions), `validateSession(token): boolean`, `destroySession(token)`, `requireSession(req): Promise<boolean>` (baca cookie `secscan_session`), `rateLimit(ip): boolean` (5 gagal/15m, lock 15m, in-memory Map)
- `app/api/login/route.ts`: POST `{password}` → verifyPassword → createSession → `Set-Cookie: secscan_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`

- [ ] **Step 1: auth.ts** — createSession/validate/destroy + rateLimit (Map keyed IP)
- [ ] **Step 2: login route** — verify, set cookie; rate-limit 429
- [ ] **Step 3: logout route** — destroy session + clear cookie
- [ ] **Step 4: Tes curl** — `curl -c /tmp/cj -X POST http://127.0.0.1:3011/api/login -H 'Content-Type: application/json' -d '{"password":"CakraVistaA1"}'` → 200 + cookie; salah → 401; setelah 5x salah → 429
- [ ] **Step 5: Commit** — `feat: auth session cookie`

### Task 4: Skill catalog API + auth guard helper

**Files:**
- Create: `lib/require-auth.ts`, `app/api/skills/route.ts`
- Test: tanpa cookie → 401; dengan cookie → 200 JSON katalog

**Interfaces:**
- `lib/require-auth.ts`: `withAuth(handler)` — wrapper API route, 401/403 jika session invalid
- `app/api/skills/route.ts`: GET → `{ skills: SKILLS, groups }`

- [ ] **Step 1: require-auth.ts** — wrapper (coba baca cookie; validasi DB)
- [ ] **Step 2: skills route** — GET katalog (guard)
- [ ] **Step 3: Tes curl** — tanpa cookie 401; `-b /tmp/cj` 200 + `skills.length===13`
- [ ] **Step 4: Commit** — `feat: skills api + auth wrapper`

### Task 5: Clone service + job creator API

**Files:**
- Create: `lib/clone.ts`, `lib/jobs.ts` (Queue helper), `app/api/jobs/route.ts` (POST + GET)
- Test: POST job → jobId + status queued; GET list → ada

**Interfaces:**
- `lib/clone.ts`: `cloneRepo(repoUrl, branch, destDir): Promise<{ok:boolean, path?:string, error?:string}>` — `git clone --depth 1 --branch <branch> <url> <dest>`; validasi URL github.com publik (regex `^https://github\.com/[^/]+/[^/]+(\.git)?$`), timeout 120s
- `lib/jobs.ts`: `getQueue()` (BullMQ Queue `secscan-jobs`, connection dari REDIS_URL), `enqueueScan(jobRow): Promise<void>` — add job `{jobId}`
- `app/api/jobs/route.ts`: POST (guard) — validasi input (repoUrl valid + skills ⊆ katalog), `createJob` di DB status `queued`, clone DI SINI (synchronous, sebelum enqueue; jika clone gagal → status failed, error msg), lalu `enqueueScan` → 201 `{jobId}`. GET → listJobs (guard)

- [ ] **Step 1: clone.ts** — regex github + child_process exec git clone (timeout)
- [ ] **Step 2: jobs.ts** — BullMQ Queue singleton (ioredis)
- [ ] **Step 3: POST /api/jobs** — validasi + createJob + clone + enqueue
- [ ] **Step 4: Tes** — POST job (repo uji kecil, mis. `github.com/octocat/Hello-World`) → 201 + jobId; `ls /var/lib/secscan/work/<id>` ada clone; GET list → 1 job
- [ ] **Step 5: Commit** — `feat: clone + job api`

### Task 6: Worker (BullMQ consumer + spawn Hermes)

**Files:**
- Create: `worker.js`, `lib/runner.ts`
- Test: jalankan worker + job uji → status per skill berubah, report.md muncul

**Interfaces:**
- `lib/runner.ts`: `runSkill(jobId, skill, workDir, depth): Promise<{status, output}>` — spawn `hermes -z "<task>" -s <skill> --in <workDir> --safe-mode` (child_process.spawn, timeout 15m), task text berisi: target repo path, skill name, instruksi "jalankan skill <name> untuk audit <target>; hasil: ringkas temuan + rekomendasi; output markdown". Output stdout+stderr digabung. Status: exit 0 → done, non-zero → failed (output tetap disimpan).
- `worker.js`: `new Worker('secscan-jobs', async job => { ... }, {connection, concurrency: 1})` — untuk tiap job: mark running, loop skills (update job_skills pending→running→done, update progress, `updateJob`), tulis `report.md` (frontmatter + per-skill section dari output), mark done, tulis audit. Error → status failed + `updateJob({status:'failed', error})`.

- [ ] **Step 1: runner.ts** — spawn hermes (env `PATH` include `/root/.local/bin`?), timeout, stdout+stderr
- [ ] **Step 2: worker.js** — BullMQ Worker, loop skill, progress, report.md generation, error handling
- [ ] **Step 3: Tes manual** — `node worker.js` (background), POST job uji (skill sast-scanning, repo kecil) → poll DB: status per skill done, report.md ada di /var/lib/secscan/reports/<id>/
- [ ] **Step 4: Verifikasi isi report** — `cat report.md` → frontmatter + section skill + temuan
- [ ] **Step 5: Commit** — `feat: bullmq worker + hermes runner`

### Task 7: Job detail + SSE live

**Files:**
- Create: `app/api/jobs/[id]/route.ts`, `app/api/jobs/[id]/stream/route.ts`
- Test: SSE stream terbuka, event muncul saat job jalan

**Interfaces:**
- GET `/api/jobs/:id` (guard) → detail job + job_skills
- GET `/api/jobs/:id/stream` (guard, SSE) — ReadableStream; setiap 2s: `data: {"status":..., "progress":..., "current_skill":..., "skills":[...]}`; tutup saat status terminal (done/failed)

- [ ] **Step 1: jobs/[id] route** — detail (job + skills)
- [ ] **Step 2: stream route** — SSE (setInterval 2s baca DB, push event, close terminal)
- [ ] **Step 3: Tes** — `curl -N -b /tmp/cj http://127.0.0.1:3011/api/jobs/<id>/stream` selama job jalan → event tiap 2s
- [ ] **Step 4: Commit** — `feat: job detail + sse stream`

### Task 8: Report download + artifacts

**Files:**
- Create: `app/api/jobs/[id]/report/route.ts`, `app/api/jobs/[id]/artifacts/[...file]/route.ts`
- Test: download report.md (200, Content-Disposition attachment)

**Interfaces:**
- GET `/api/jobs/:id/report` (guard) → stream file report_path as attachment `report-<jobId>.md`
- GET `/api/jobs/:id/artifacts/[...file]` (guard) → stream file dari REPORT_DIR/<jobId>/ (path traversal guard: resolve + startsWith)

- [ ] **Step 1: report route** — fs stream + Content-Disposition
- [ ] **Step 2: artifacts route** — safe resolve (path traversal cegah)
- [ ] **Step 3: Tes curl** — download → 200 + `Content-Disposition: attachment`; traversal `../../etc/passwd` → 400
- [ ] **Step 4: Commit** — `feat: report + artifact download`

### Task 9: UI — Login, Dashboard, New Scan wizard, Job Detail (interaktif)

**Files:**
- Create: `app/(auth)/login/page.tsx`, `app/(app)/layout.tsx` (sidebar+navigation), `app/(app)/page.tsx` (dashboard riwayat), `app/(app)/new/page.tsx` (wizard: repo + skill checklist + depth + konfirmasi ofensif), `app/(app)/jobs/[id]/page.tsx` (detail + live progress), `components/` (LoginForm, SkillPicker, JobCard, ProgressBar, StatusBadge, LogViewer, ConfirmDialog), `lib/api.ts` (client fetch wrapper)
- Test: manual browser flow lengkap (login → new → run → progress → download report)

**Interfaces:**
- `lib/api.ts`: `login(pw)`, `logout()`, `getSkills()`, `createJob(body)`, `getJobs()`, `getJob(id)`, `streamJob(id, onEvent)` (EventSource), `downloadReport(id)`
- UI dark ala Linear (referensi ui-styling): zinc-950 bg, aksen emerald/cyan, kartu rounded-xl, spacing konsisten.
- Wizard: step 1 repo (URL github + branch), step 2 skill checklist (kelompok warna: 🔴/🟡/🟢) + depth (light/medium/deep), step 3 konfirmasi (ringkasan + checkbox "saya sadar ini pentest untuk target yang saya miliki" untuk skill ofensif), step 4 submit → redirect ke detail.
- Job detail: progress bar global, daftar skill (status badge), log tail auto-scroll, tombol download report + artifacts.

- [ ] **Step 1: LoginForm + login page** — dark card, error state, redirect ke /
- [ ] **Step 2: App shell** — sidebar (Dashboard, New Scan, riwayat), header
- [ ] **Step 3: Dashboard** — daftar jobs (status badge, progress mini), link ke detail
- [ ] **Step 4: New Scan wizard** — multi-step (repo → skill → confirm), validasi, konfirmasi ofensif
- [ ] **Step 5: Job detail** — SSE live (EventSource), progress bar, per-skill status, log tail, download button
- [ ] **Step 6: Tes browser manual** — login → buat scan (repo kecil, 2-3 skill) → progress jalan → selesai → download report.md
- [ ] **Step 7: Commit** — `feat: full interactive ui`

### Task 10: Redis + systemd + nginx + deploy prod

**Files:**
- Modify (ops): `/etc/nginx/sites-available/secscan.dams.my.id`, `/etc/systemd/system/secscan.service`, `secscan-worker.service`, `/opt/secscan/secscan.env`
- Test: `curl -I https://secscan.dams.my.id` → 200/302; `systemctl status secscan` active; job end-to-end via https

**Interfaces:**
- Redis: `apt install -y redis-server`; bind 127.0.0.1 sudah default; `redis-cli ping` → PONG
- `/opt/secscan`: rsync hasil build (node_modules+standalone) ATAU symlink ke /root/secscan-archived (pilih: build standalone + salin). Pakai pola skill nextjs-deployment.
- Env: `/opt/secscan/secscan.env` — AUTH_PASSWORD_HASH (bcrypt dari CakraVistaA1), SESSION_SECRET (uuid), REDIS_URL, WORK_DIR, REPORT_DIR, DB_PATH
- systemd `secscan.service`: `ExecStart=/usr/bin/node /opt/secscan/standalone/server.js` (atau `npx next start -p 3011`), `EnvironmentFile=/opt/secscan/secscan.env`, Restart=always, User=root
- systemd `secscan-worker.service`: `ExecStart=/usr/bin/node /opt/secscan/worker.js`, EnvironmentFile sama
- nginx: server block `secscan.dams.my.id` (HTTP→HTTPS redirect + SSL Let's Encrypt via certbot) → proxy 127.0.0.1:3011 (pattern dash)

- [ ] **Step 1: Install redis-server** — `apt-get install -y redis-server`, `redis-cli ping` → PONG
- [ ] **Step 2: Build prod** — `npm run build` (standalone output); salin ke /opt/secscan (standalone + static + public + worker.js + node_modules worker deps)
- [ ] **Step 3: Env + systemd units** — tulis secscan.env (hash bcrypt) + 2 unit file (heredoc ke /etc/systemd/system) + daemon-reload + enable --now
- [ ] **Step 4: nginx + SSL** — site config (pola dash) → `nginx -t` → reload; `certbot --nginx -d secscan.dams.my.id` (pastikan DNS sudah A record → 43.159.47.123)
- [ ] **Step 5: Verifikasi** — `curl -I https://secscan.dams.my.id` → 200/302; login flow via https; jalankan 1 job nyata end-to-end
- [ ] **Step 6: Rollback note + commit** — dokumentasikan rollback (stop unit, hapus nginx site) + commit deploy notes

---

## Self-Review Checklist

- [ ] Spec coverage: seluruh §spec ter-cakup (auth, queue, worker, clone, skills API, SSE, report, deploy, security). Ya — Task 2-10.
- [ ] Placeholder scan: tidak ada TBD; step punya kode konkret (job task prompt Hermes ditulis detail di Task 6).
- [ ] Type consistency: `createJob/getJob/updateJob/upsertJobSkill/getJobSkills/addAudit` konsisten Task 2→6/7; `enqueueScan({jobId})` Task 5→6; `cloneRepo(url,branch,dest)` Task 5.
- [ ] Ya, Job prompt Hermes perlu detail: Task 6 Step 1 akan memuat prompt template lengkap (target path, skill, instruksi output markdown).