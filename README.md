# SecurityScan Hub

Platform web untuk menjalankan scan keamanan terhadap repository GitHub publik: pilih skill (scanning, ofensif, analisis), pantau progres live via SSE, dan unduh laporan Markdown per job.

## Menjalankan (development)

```bash
npm install
npm run dev        # Next.js di http://localhost:3011
npm run worker     # terminal terpisah — worker BullMQ yang mengeksekusi skill
```

Login memakai password yang di-hash di `AUTH_PASSWORD_HASH`. Buat hash dengan:

```bash
node -e "console.log(require('bcryptjs').hashSync('passwordkamu', 10))"
```

## Environment variables (`.env.local`)

| Variabel | Keterangan |
| --- | --- |
| `AUTH_PASSWORD_HASH` | Hash bcrypt password login (wajib) |
| `SESSION_SECRET` | Secret aplikasi |
| `REDIS_URL` | Redis untuk antrean BullMQ, default `redis://127.0.0.1:6379/5` |
| `WORK_DIR` | Direktori clone repo per job, default `/var/lib/secscan/work` |
| `REPORT_DIR` | Direktori laporan `.md`, default `/var/lib/secscan/reports` |
| `DB_PATH` | File SQLite, default `/var/lib/secscan/secscan.db` |
| `MAX_JOBS` | Batas job aktif (queued/running), default `5` |

## Arsitektur

Satu aplikasi Next.js 15 (App Router) melayani UI dark-theme dan API (`/api/login`, `/api/skills`, `/api/jobs`, `/api/jobs/[id]/stream` SSE). Job baru disimpan ke SQLite (better-sqlite3) lalu di-clone shallow ke `WORK_DIR/<jobId>` dan dimasukkan ke antrean BullMQ di Redis; proses worker terpisah (`node worker.js`) mengambil job, menjalankan tiap skill lewat Hermes CLI, memperbarui status/progress/output per skill di SQLite, dan menulis laporan Markdown ke `REPORT_DIR`. UI memantau progres secara live melalui endpoint SSE yang membaca snapshot dari SQLite setiap 2 detik; sesi login disimpan sebagai cookie `secscan_session`.

## Struktur utama

- `app/login` — halaman login (password)
- `app/` — dashboard riwayat scan (auto-refresh 5s saat ada job aktif)
- `app/new` — wizard 3 langkah: target → skill → konfirmasi (checkbox wajib untuk skill ofensif)
- `app/jobs/[id]` — detail job live via SSE + download report
- `worker.js` — worker BullMQ (proses terpisah)
- `lib/api.ts` — client fetch wrapper untuk semua endpoint
