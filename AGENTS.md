# AGENTS.md — Caranya deploy & mengoperasikan SecurityScan Hub

Ditujukan untuk AI agent (Hermes, Claude Code, dll) yang mengintegrasikan SecurityScan Hub ke VPS pengguna. Semua nilai `<...>` adalah placeholder yang harus diganti agent, jangan ditebak.

## 1. Apa ini

Web platform untuk menjalankan skill keamanan Hermes terhadap repo GitHub publik: pilih skill (scanning / ofensif / analisis), pantau progres live via SSE, unduh laporan Markdown per job. Ada juga scheduler scan berkala dan learning ringan dari temuan (tabel `knowledge` per target).

## 2. Arsitektur

```
Browser ──(HTTPS)── nginx ──► 127.0.0.1:3011 (Next.js web + API + SSE)
                                 │
                          SQLite (DB_PATH — source of truth, semua tabel auto-create)
                                 │ enqueue
                          BullMQ queue di Redis (REDIS_URL, index terpisah)
                                 │ consume (concurrency = WORKER_CONCURRENCY)
                          worker.js (proses terpisah, unit systemd terpisah)
                                 │ per skill: spawn hermes -z "<TASK>" [-s <skill>]
                                 │           --in <workDir> --safe-mode  ← JANGAN --yolo
                                 │ timeout per skill 15 menit (SIGTERM, +10s baru SIGKILL)
                                  state per skill & progress → SQLite; report.md → REPORT_DIR
```

Alur worker per skill: upsert `job_skills(running)` → spawn hermes → upsert `done|failed` (output dipotong ≤ 200 KB) → progress = (i+1)/total → setelah semua skill selesai tulis `REPORT_DIR/<jobId>/report.md` → status job `done` / `failed` (report tetap ditulis meski ada skill gagal). Scheduler di dalam worker cek tabel `schedules` tiap 60 detik dan enqueue job saat jadwal jatuh tempo.

## 3. Prasyarat

| Komponen | Catatan |
| --- | --- |
| Node.js | v22 yang dipakai pengembangan (v20 kemungkinan besar jalan) |
| Redis | `apt-get install -y redis-server`; bind 127.0.0.1 default; `redis-cli ping` → PONG. Pilih DB index yang tidak dipakai app lain (default `5`) |
| Hermes CLI | Terpasang & terlihat dari unit systemd worker (PATH unit minima — isi `HERMES_BIN`/`HERMES_PATH` bila perlu). Worker spawn `hermes -z ... --safe-mode`; config provider/OAuth Hermes harus sudah beres di host |
| Skills Hermes | Sumber kebenaran daftar skill = `lib/skills.ts` — 13 skill: sast-scanning, dependency-scanning, container-scanning, vulnerability-scanning, supply-chain-attack-response, penetration-testing, dast-scanning, ai-red-teaming, threat-modeling, incident-response, ai-agent-security, mcp-server-security, prompt-injection-defense. Skill yang tidak terpasang tidak mematikan aplikasi — job skill itu akan `failed` — tapi pastikan tersedia sebelum menawarkan ke pengguna |
| nginx + certbot | Untuk HTTPS; app boleh jalan tanpa nginx pada 127.0.0.1:3011 |

## 4. Environment variables

Sysadmin memberi nilai via `EnvironmentFile` systemd; worker punya fallback `.env.local` di folder yang sama dengan `worker.js` (process.env menang).

| Var | Dipakai | Default | Keterangan |
| --- | --- | --- | --- |
| `AUTH_PASSWORD_HASH` | web | wajib | bcrypt hash password login. Buat: `node -e "console.log(require('bcryptjs').hashSync('password', 10))"` |
| `SESSION_SECRET` | web | wajib | `uuidgen` atau `openssl rand -hex 32` |
| `REDIS_URL` | web+worker | `redis://127.0.0.1:6379/5` | samakan di kedua proses; beda index = job tidak pernah diproses |
| `DB_PATH` | web+worker | `/var/lib/secscan/secscan.db` | direktori dibuat otomatis; skema auto-create (CREATE TABLE IF NOT EXISTS) |
| `WORK_DIR` | web+worker | `/var/lib/secscan/work` | clone shallow repo target per job → `<WORK_DIR>/<jobId>` |
| `REPORT_DIR` | web+worker | `/var/lib/secscan/reports` | laporan markdown per job |
| `MAX_JOBS` | web | `5` | batas job aktif (queued+running); job baru ditolak sampai slot bebas |
| `PORT` | web | `3011` | port listener |
| `HOSTNAME` | web | `127.0.0.1` | jangan `0.0.0.0` di VPS publik — expose lewat nginx |
| `HERMES_BIN` | worker | `hermes` | path absolut bila hermes tidak ada di PATH unit |
| `HERMES_PATH` | worker | — | prefix tambahan PATH saat spawn hermes |
| `TRIVY_BIN` | worker | `trivy` | path ke binary Trivy bila tidak ada di PATH standar; fallback otomatis bila tidak terpasang |
| `WORKER_CONCURRENCY` | worker | `2` | clamp 1–5; tiap skill = satu proses Hermes utuh, naikkan bertahap |

Sebagai referensi deployment prod yang pernah dipakai: app built standalone di `/opt/secscan/app` (dipakai custom `server.js` hasil `next build`), worker di `/opt/secscan/worker.js` — tapi `next start` polos dari repo pun cukup.

## 5. Deploy step-by-step (untuk agent)

```bash
REPO=<git-url-repo-ini>          # clone dari repo
BASE=/opt/secscan                # sesuai selera pengguna
VAR=/var/lib/secscan             # data runtime

# 0) deps
apt-get install -y redis-server nginx certbot python3-certbot-nginx

# 1) source + build
git clone "$REPO" "$BASE/src"
cd "$BASE/src" && npm ci && npm run build

# 2) runtime dirs + env file (chmod 600; tidak pernah di-commit)
install -d -m 700 "$VAR/work" "$VAR/reports"
# worker.js butuh node_modules (bullmq, ioredis, better-sqlite3):
# taruh worker.js + node_modules dari repo di $BASE (atau jalankan worker dari $BASE/src)
cp "$BASE/src/worker.js" "$BASE/" 2>/dev/null || true
cp -r "$BASE/src/node_modules" "$BASE/" 2>/dev/null || true

cat > "$BASE/secscan.env" <<'EOF_BASE'
PORT=3011
HOSTNAME=127.0.0.1
REDIS_URL=redis://127.0.0.1:6379/5
DB_PATH=/var/lib/secscan/secscan.db
WORK_DIR=/var/lib/secscan/work
REPORT_DIR=/var/lib/secscan/reports
MAX_JOBS=5
EOF_BASE

# dua baris rahasia diketik manual saat edit file (bukan lewat chat):
nano "$BASE/secscan.env"
#   AUTH_PASSWORD_HASH=<bcrypt-hash>
#   SESSION_SECRET=<uuid>
chmod 600 "$BASE/secscan.env"

# 3) systemd units
# /etc/systemd/system/secscan.service:
#   [Service] WorkingDirectory=$BASE/src ; EnvironmentFile=$BASE/secscan.env
#             ExecStart=$BASE/src/node_modules/.bin/next start -H 127.0.0.1   # atau node server.js bila pakai build standalone
#             Restart=always ; RestartSec=3 ; User=<user>
# /etc/systemd/system/secscan-worker.service:
#   [Service] WorkingDirectory=$BASE ; EnvironmentFile=$BASE/secscan.env
#             ExecStart=/usr/bin/node $BASE/worker.js
#             Restart=always ; RestartSec=5
systemctl daemon-reload && systemctl enable --now secscan secscan-worker

# 4) nginx site → proxy_pass http://127.0.0.1:3011 → nginx -t → reload
#    → DNS A record <subdomain> → IP server → certbot --nginx -d <subdomain>

# 5) verifikasi
curl -sI http://127.0.0.1:3011/     # HTTP 200 (render HTML) — UI butuh login via /login
```

## 6. Verifikasi wajib sebelum diserahkan ke pengguna

1. `systemctl is-active secscan secscan-worker` → keduanya `active`.
2. `curl -sI http://127.0.0.1:3011/` → 200; login dengan password di browser berhasil.
3. Buat scan pertama dari UI: repo GitHub publik kecil + 2 skill non-ofensif → progress jalan → report bisa diunduh di halaman job.
4. `sqlite3 "$DB_PATH" "SELECT id,status,current_skill FROM jobs ORDER BY created_at DESC LIMIT 3;"` — job tidak boleh mentok di `queued`.
5. Kalau Hermes terpasang: pastikan log `journalctl -u secscan-worker -f` menampilkan `hermes -z "<TASK>" ... --safe-mode` saat skill berjalan.
6. Password 5x salah dalam 15 menit → HTTP 429 (rate limit per IP; nginx harus set header `X-Real-IP`).

## 7. Troubleshooting

| Gejala | Pengecekan |
| --- | --- |
| Job `queued` tidak pernah berubah | Worker mati atau REDIS_URL beda (ini paling sering: web di Redis DB 5, worker di DB 0). Cek `journalctl -u secscan-worker` |
| `spawn_error` / `hermes not found` | PATH unit systemd minima; set `HERMES_BIN` absolut atau `HERMES_PATH` |
| Semua skill langsung `failed` dengan output auth error Hermes | Hermes di unit tak membaca config yang sama dengan CLI user (env unit ≠ env user). Contoh: `HOME` unit salah, atau config OAuth Hermes tidak memuat provider LLM yang perlu |
| Clone GitHub 403/rate-limited | Target repo harus publik (anonim; GitHub anonim 60 req/jam). Repo private tidak didukung UI |
| URL live ditolak waktu membuat job | Bisa jadi wajar: `lib/target.ts` + `lib/validation.ts` menolak IP literal dan host privat (guard SSRF), termasuk port internal umum (redis/postgres/consul dll) dan 169.254.169.254 |
| Job skill timeout di 15 menit | Timeout per skill hard-coded di `RUN_TIMEOUT_MS` (`worker.js`) — naikkan bila perlu |
| Web error 500 semua endpoint | File SQLite lama tidak cocok dengan skema baru (tidak ada framework migration). Amankan DB lama (rename/backup), biarkan app membuat file baru — skema auto-create |

## 8. Catatan keamanan (relevan utk agent)

- **Skill ofensif** (penetration-testing, dast-scanning, ai-red-teaming) wajib konfirmasi checkbox eksplisit di wizard UI — jangan bypass di kode/API.
- Target hanya repo publik GitHub + URL live yang lolos validasi SSRF. Tidak ada input lain (upload zip / path lokal ada di spesifikasi sebagai bonus, belum diimplementasi).
- Session cookie `secscan_session`: HttpOnly, sameSite=lax, maxAge 24 jam (sesi di DB TTL 7 hari). Ada audit_log tiap login.
- Report bisa dibagikan via share token: `/api/share/<token>` — akses capability tanpa login; treat seperti password link.
- Data runtime (SQLite, work, reports, env) hidup di luar repo dan tidak pernah di-commit. Password tidak melewati chat — agent tulis sendiri ke env file (chmod 600) dan simpan hanya hash bcrypt-nya.
- Worker berjalan dengan izin user systemd-nya (biasanya root) dan mem-clone repo target yang belum diaudit ke WORK_DIR; mitigasinya, Hermes selalu dijalankan dengan `--safe-mode`.

## 9. Testing lokal (dev)

```bash
npm install
npm run dev &        # :3011
npm run worker &     # worker BullMQ (butuh redis + dsb)
npx tsx tests/smoke-db.ts          # smoke db
npx tsx tests/smoke-target.ts      # validasi target
npx tsx tests/smoke-validation.ts  # validasi URL SSRF
npx tsx tests/smoke-dns-check.ts   # anti-SSRF & resolusi DNS
npx tsx tests/smoke-cwe-compliance.ts # taksonomi CWE & OWASP Top 10
npx tsx tests/smoke-web-check.ts   # baseline header HTTP pasif
npx tsx tests/smoke-trivy.ts       # parser Trivy SCA & Secrets
npx tsx tests/smoke-schedule-consent.ts # otorisasi target pada jadwal
npx tsx tests/smoke-knowledge.ts   # learning temuan
npx tsx tests/smoke-findings.ts
npx tsx tests/smoke-fixes.ts
npx tsx tests/smoke-compliance.ts
```

Semua smoke test di atas tidak butuh Hermes; tidak ada test terpadu untuk worker.js (integrasi ditest manual via UI).

## 10. Struktur kode (cukup untuk modifikasi tanpa membaca repo sepenuhnya)

- `app/` — Next.js 15 App Router. `app/login`, dashboard `app/`, wizard `app/new`, detail job `app/jobs/[id]`, `app/schedules`.
- `app/api/` — REST: `login`/`logout`, `skills`, `jobs` + `jobs/[id]` (+ `stream` = SSE, `report`, `findings`, `fixes`, `compliance`), `share/[token]`.
- `components/` — komponen UI (login form, skill picker, job card, progress bar, status badge, log viewer, confirm dialog).
- `lib/` — domain logic (TypeScript): `db.ts` (skema + akses), `jobs.ts` (validasi + enqueue), `skills.ts` (katalog 13 skill), `target.ts` + `validation.ts` (validasi target / guard SSRF), `findings.ts` / `fixes.ts` / `compliance.ts` (post-processing temuan → OWASP mapping dll), `auth.ts` / `password.ts` / `require-auth.ts` (session & rate limit).
- `worker.js` — worker; CommonJS self-contained, TIDAK import `lib/*.ts`. Semua SQL di sana ditulis ulang sebagai string SQL — bila skema di `lib/db.ts` berubah, selaraskan `worker.js` juga.
- `tests/smoke-*.ts` — smoke test via `npx tsx`.

## 11. Konvensi penting saat memodifikasi kode

1. Kesesuaian skema: tambah kolom tabel → enumerasi di `lib/db.ts` + semua `INSERT`/`SELECT` yang menyentuh kolom itu, termasuk di `worker.js`.
2. `worker.js` tidak mengimpor `lib/*.ts` — SQL dan parsing output skill digandakan di sana; bila mengubah logika domain, ubah dua-duanya sekaligus.
3. Output skill dipotong 200 KB (OUTPUT_LIMIT) — jangan berharap menerima log panjang penuh.
4. Rate limit login disimpan in-memory per proses web — restart web menghapus throttling.
5. Jangan `pkill -f next-server` di VPS yang juga menjalankan bot gateway Hermes (kill generik bisa memotong proses lain). Gunakan unit spesifik: `systemctl stop secscan`.

## Agent skills

### Issue tracker

Issue dan spesifikasi dilacak di GitHub Issues (`adamramadhn/secscan`). Lihat `docs/agents/issue-tracker.md`.

### Triage labels

Gunakan label default: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, dan `wontfix`. Lihat `docs/agents/triage-labels.md`.

### Domain docs

Layout single-context: `GLOSSARY.md` di root dan ADR di `docs/adr/`. Lihat `docs/agents/domain.md`.
