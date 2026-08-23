# SecurityScan Hub — Design Spec

> Dibuat: 2026-08-23. Status: Approved oleh user. Path: /root/secscan-archived/.

## 1. Ringkasan

Web app "secscan.dams.my.id" di vps2 (43.159.47.123) untuk menjalankan skill-skill security/DevOps Hermes terhadap target repo, dengan UI interaktif, progress live, dan report markdown yang bisa di-download.

## 2. Keputusan yang sudah disetujui user

| Aspek | Keputusan |
|---|---|
| Eksekusi | Hermes headless selalu (`hermes -z ... -s <skill> --in <repo> --safe-mode`) |
| Stack | Next.js + API route + auth sederhana |
| Auth | Session cookie + bcrypt password (`CakraVistaA1`) |
| Target | GitHub repo (clone) — utama; upload zip & path lokal sebagai bonus |
| Queue | BullMQ + Redis — worker terpisah, progress tidak hilang jika tab ditutup/refresh |
| Deploy | /opt/secscan + systemd (app + worker) + nginx SSL + subdomain secscan.dams.my.id |
| UI | Interaktif dark; pakai referensi skill `ui-styling`/`design-system`/`ui-ux-pro-max` |

## 3. Arsitektur

```
Browser ⇄ Next.js UI + API (127.0.0.1:3011, systemd secscan.service)
                │ push job
                ▼
        BullMQ Queue ──► Redis lokaldb 5 (127.0.0.1:6379)
                ▲
                │ consume
        worker.js (systemd secscan-worker.service, concurrency 1)
                │ per skill: spawn
                ▼
        hermes -z "<task>" -s <skill> --in <repo> --safe-mode
                │
                ▼
        SQLite /var/lib/secscan/secscan.db (jobs, status per skill, report path)
        + report.md + artifacts /var/lib/secscan/reports/<jobId>/
```

- SQLite = source of truth (riwayat). Redis = live status (bisa di-rebuild dari SQLite).
- Worker restart → lanjut job pending/active. UI refresh/close → job tetap jalan.

## 4. Data model (SQLite)

```sql
CREATE TABLE sessions (token TEXT PRIMARY KEY, created_at INTEGER);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,           -- uuid
  repo_url TEXT, branch TEXT, target_type TEXT,  -- github|upload|local
  skills_json TEXT,              -- ["sast-scanning", ...]
  depth TEXT DEFAULT 'medium',   -- light|medium|deep
  status TEXT DEFAULT 'queued',  -- queued|running|done|failed|cancelled
  progress INTEGER DEFAULT 0,    -- 0-100
  current_skill TEXT,            -- skill yang sedang jalan
  report_path TEXT,              -- path report.md final
  error TEXT, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE job_skills (
  job_id TEXT, skill TEXT, status TEXT DEFAULT 'pending',  -- pending|running|done|failed|skipped
  started_at INTEGER, finished_at INTEGER, output TEXT
);
CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, action TEXT, detail TEXT);
```

## 5. Katalog skill (13) — kelompok 🔴 ofensif / 🟡 scanning / 🟢 analisis

| Skill | Kategori | Hermes skill name |
|---|---|---|
| sast-scanning | 🟡 | sast-scanning |
| dependency-scanning | 🟡 | dependency-scanning |
| container-scanning | 🟡 | container-scanning |
| vulnerability-scanning | 🟡 | vulnerability-scanning |
| supply-chain-attack-response | 🟡 | supply-chain-attack-response |
| penetration-testing | 🔴 | penetration-testing |
| dast-scanning | 🔴 | dast-scanning |
| ai-red-teaming | 🔴 | ai-red-teaming |
| threat-modeling | 🟢 | threat-modeling |
| incident-response | 🟢 | incident-response |
| ai-agent-security | 🟢 | ai-agent-security |
| mcp-server-security | 🟢 | mcp-server-security |
| prompt-injection-defense | 🟢 | prompt-injection-defense |

- Skill ofensif (🔴) butuh konfirmasi eksplisit di UI sebelum jalan.
- Hermes dijalankan `--safe-mode` → command berbahaya tetap kena blocklist Hermes.

## 6. API

```
POST /api/login            {password} -> set cookie secscan_session (HttpOnly, 24h)
POST /api/logout           -> hapus cookie
GET  /api/skills           -> katalog skill (name, kategori, deskripsi, ofensif)
POST /api/jobs             {repoUrl, branch, skills[], depth} -> {jobId}
GET  /api/jobs             -> riwayat jobs
GET  /api/jobs/:id         -> detail job + status per skill
GET  /api/jobs/:id/stream  -> SSE live (status, current_skill, progress, log tail)
GET  /api/jobs/:id/report  -> download report.md (attachment)
GET  /api/jobs/:id/artifacts/:file -> download artifact
```

## 7. Deploy & akses

- `apt install redis-server` (bind 127.0.0.1, protected-mode). REDIS_URL=redis://127.0.0.1:6379/5
- `/opt/secscan/` + `secscan.env` (AUTH_PASSWORD_HASH=bcrypt, SESSION_SECRET, REDIS_URL, ...)
- Docker? Tidak — pola **non-Docker Next.js** skill `nextjs-deployment` (build → systemd → nginx) lebih ringan & sudah terbukti di dash.
  - Build: `/opt/secscan` production build (`next build`)
  - `secscan.service` → `next start -p 3011` ; `secscan-worker.service` → `node worker.js`
- nginx `secscan.dams.my.id` (Let's Encrypt, pola yang sama dengan dash) → 127.0.0.1:3011
- Akses: https://secscan.dams.my.id (login password). Cloudflare optional (DNS proxied).
- Rollback: stop service baru, nginx balik ke port lama (tidak ada app lama — rollback = hapus service + nginx site).

## 8. Keamanan

- Bind 127.0.0.1 saja; nginx SSL; cookie HttpOnly+SameSite=Lax; bcrypt verify; rate-limit login (5 gagal/15m → lock 15m)
- Hermes --safe-mode; target clone terbatas repo publik; audit log; konfirmasi ofensif eksplisit
- Tidak menyimpan credential GitHub