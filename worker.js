#!/usr/bin/env node
/**
 * worker.js — SecurityScan Hub worker (self-contained, CommonJS).
 *
 * Dibaca oleh `node worker.js` langsung. TIDAK mengimpor lib/*.ts (TypeScript);
 * semua akses DB ditulis ulang sebagai SQL murni di sini, dan spawn hermes
 * diimplementasikan inline (child_process.spawn).
 *
 * Alur:
 *   BullMQ Worker('secscan-jobs', concurrency 1) → processor(job):
 *     load job dari SQLite (data.jobId) → untuk tiap skill di skills_json:
 *       upsert job_skills(running) → updateJob(running, current_skill)
 *       → runSkill (spawn `hermes -z <TASK> -s <skill> --in <workDir> --safe-mode`,
 *         timeout 15 menit, SIGTERM lalu SIGKILL setelah 10s)
 *       → upsert job_skills(done|failed, output ≤200KB)
 *       → progress = round((i+1)/total*100)
 *     tulis REPORT_DIR/<jobId>/report.md (frontmatter + section per skill)
 *     → status akhir 'done' (semua sukses) / 'failed' (ada yang gagal, report tetap ditulis)
 *
 * Env: REDIS_URL, DB_PATH, WORK_DIR, REPORT_DIR — dari process.env atau
 *      .env.local (parse manual; AUTH_* tidak dipakai worker).
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const Database = require('better-sqlite3');

/* ------------------------------------------------------------------ */
/* Env: process.env menang; fallback baca .env.local (parser sederhana) */
/* ------------------------------------------------------------------ */

function loadEnvFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return; // tidak ada .env.local — pakai process.env saja
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue; // komentar/kosong
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // nilai double-quote: strip quote, dukung \$ literal
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\\$/g, '$');
    }
    if (key && value && !(key in process.env)) {
      process.env[key] = value;
    }
  }
  console.log('[worker] .env.local loaded from', filePath);
}

loadEnvFile(path.join(__dirname, '.env.local'));

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/5';
const DB_PATH = process.env.DB_PATH ?? '/var/lib/secscan/secscan.db';
const WORK_DIR = process.env.WORK_DIR ?? '/var/lib/secscan/work';
const REPORT_DIR = process.env.REPORT_DIR ?? '/var/lib/secscan/reports';
const QUEUE_NAME = 'secscan-jobs';
const HERMES_BIN = process.env.HERMES_BIN ?? 'hermes';
const RUN_TIMEOUT_MS = 15 * 60 * 1000; // 15 menit
const KILL_GRACE_MS = 10 * 1000; // setelah SIGTERM, tunggu 10s lalu SIGKILL
const OUTPUT_LIMIT = 200 * 1024; // 200 KB
const HEAD_KEEP = 100 * 1024; // head 100 KB
const HERMES_PATH = '/root/.local/bin:/usr/local/bin:/usr/bin:/bin';

/* ------------------------------------------------------------------ */
/* SQLite (SQL murni — mirror fungsi lib/db.ts yang dibutuhkan worker) */
/* ------------------------------------------------------------------ */

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    repo_url TEXT,
    branch TEXT,
    target_type TEXT,
    skills_json TEXT,
    depth TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'queued',
    progress INTEGER DEFAULT 0,
    current_skill TEXT,
    report_path TEXT,
    error TEXT,
    created_at INTEGER,
    updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS job_skills (
    job_id TEXT,
    skill TEXT,
    status TEXT DEFAULT 'pending',
    started_at INTEGER,
    finished_at INTEGER,
    output TEXT,
    PRIMARY KEY (job_id, skill)
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER,
    action TEXT,
    detail TEXT
  );
`);

function getJob(id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) ?? null;
}

function updateJob(id, patch) {
  const allowed = new Set(['repo_url', 'branch', 'target_type', 'skills_json', 'depth',
    'status', 'progress', 'current_skill', 'report_path', 'error']);
  const entries = Object.entries(patch).filter(([k, v]) => allowed.has(k) && v !== undefined);
  if (entries.length === 0) return getJob(id);
  const sets = entries.map(([k]) => `${k} = @${k}`).join(', ');
  const params = { ...patch, id, now: Date.now() };
  db.prepare(`UPDATE jobs SET ${sets}, updated_at = @now WHERE id = @id`).run(params);
  return getJob(id);
}

function upsertJobSkill(jobId, skill, patch = {}) {
  db.prepare(
    `INSERT INTO job_skills (job_id, skill, status, started_at, finished_at, output)
     VALUES (@job_id, @skill, COALESCE(@status, 'pending'), @started_at, @finished_at, @output)
     ON CONFLICT(job_id, skill) DO UPDATE SET
       status = COALESCE(@status, job_skills.status),
       started_at = COALESCE(@started_at, job_skills.started_at),
       finished_at = COALESCE(@finished_at, job_skills.finished_at),
       output = COALESCE(@output, job_skills.output)`
  ).run({
    job_id: jobId,
    skill,
    status: patch.status ?? null,
    started_at: patch.started_at ?? null,
    finished_at: patch.finished_at ?? null,
    output: patch.output ?? null,
  });
  return db.prepare('SELECT * FROM job_skills WHERE job_id = ? AND skill = ?').get(jobId, skill);
}

function addAudit(action, detail) {
  db.prepare('INSERT INTO audit_log (ts, action, detail) VALUES (?, ?, ?)').run(Date.now(), action, detail);
}

/* ------------------------------------------------------------------ */
/* Helper output truncation (head + tail, marker tengah)               */
/* ------------------------------------------------------------------ */

function truncateOutput(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
  if (buf.length <= OUTPUT_LIMIT) return buf.toString('utf8');
  const head = buf.subarray(0, HEAD_KEEP);
  const tail = buf.subarray(buf.length - HEAD_KEEP);
  const marker = '\n...[terpotong]...\n';
  return head.toString('utf8') + marker + tail.toString('utf8');
}

/* ------------------------------------------------------------------ */
/* runSkill: spawn `hermes -z <TASK> -s <skill> --in <workDir> --safe-mode` */
/* ------------------------------------------------------------------ */

function buildTaskPrompt(skill, depth, workDir) {
  return (
    `Kamu adalah auditor keamanan. Target repositori sudah di-clone di direktori kerja ini. ` +
    `Direktori target (absolut): ${workDir} — analisis HANYA repositori di direktori tersebut; ` +
    `abaikan repo/direktori lain di luar ${workDir} meskipun tampak lebih relevan. ` +
    `Jalankan skill '${skill}' dengan kedalaman analisis '${depth}' terhadap repo ini. ` +
    `Selesaikan langkah-langkah di SKILL.md skill tersebut (baca via tool skill_view jika tersedia, ` +
    `atau ikuti prosedur standar). Hasil akhir WAJIB berupa laporan markdown dengan struktur: ` +
    `## Ringkasan, ## Temuan (setiap temuan: severity [Critical/High/Medium/Low/Info], deskripsi, ` +
    `lokasi file jika relevan, rekomendasi perbaikan), ## Rekomendasi Prioritas. ` +
    `Jangan memodifikasi file repo. Jangan menjalankan perintah destruktif. ` +
    `Fokus analisis statis/analitis. Akhiri jawaban dengan laporan markdown lengkap.`
  );
}

/**
 * @returns {Promise<{status: 'done'|'failed', output: string}>}
 */
function runSkill(skill, workDir, depth) {
  return new Promise((resolve) => {
    const taskPrompt = buildTaskPrompt(skill, depth, workDir);
    const args = ['-z', taskPrompt, '-s', skill, '--in', workDir, '--safe-mode'];
    const env = { ...process.env, PATH: `${HERMES_PATH}:${process.env.PATH ?? ''}` };

    console.log(`[worker] spawn hermes -z "<TASK>" -s ${skill} --in ${workDir} --safe-mode (timeout ${RUN_TIMEOUT_MS}ms)`);

    let child;
    try {
      child = spawn(HERMES_BIN, args, {
        cwd: workDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ status: 'failed', output: `spawn_error: ${err.message}` });
      return;
    }

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let killedByTimeout = false;
    let killTimer = null;

    const finish = (status, output) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      resolve({ status, output: truncateOutput(output) });
    };

    child.stdout.on('data', (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      // batasi akumulasi memori — simpan cukup untuk head+tail
      if (stdout.length > OUTPUT_LIMIT * 4) stdout = stdout.subarray(stdout.length - OUTPUT_LIMIT * 4);
    });
    child.stderr.on('data', (chunk) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > OUTPUT_LIMIT * 4) stderr = stderr.subarray(stderr.length - OUTPUT_LIMIT * 4);
    });

    const timeoutId = setTimeout(() => {
      if (settled) return;
      console.log(`[worker] TIMEOUT ${RUN_TIMEOUT_MS}ms untuk hermes (${skill}) — SIGTERM`);
      killedByTimeout = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, KILL_GRACE_MS);
    }, RUN_TIMEOUT_MS);

    child.on('error', (err) => {
      finish('failed', `[spawn error] ${err.message}`);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeoutId);
      const combined = Buffer.concat([stdout, Buffer.from('\n'), stderr]).toString('utf8');
      if (killedByTimeout) {
        finish('failed', `TIMEOUT setelah ${RUN_TIMEOUT_MS / 60000} menit.\n${combined}`);
        return;
      }
      if (code === 0) {
        finish('done', combined);
      } else {
        const why = signal ? ` killed by signal ${signal}` : '';
        finish('failed', `exit code ${code}${why}\n${combined}`);
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* Report                                                                 */
/* ------------------------------------------------------------------ */

function buildReport(job, skillResults, finalStatus) {
  const lines = [];
  lines.push('---');
  lines.push(`jobId: ${job.id}`);
  lines.push(`repo_url: ${job.repo_url}`);
  lines.push(`branch: ${job.branch}`);
  lines.push(`depth: ${job.depth}`);
  lines.push(`tanggal: ${new Date().toISOString()}`);
  lines.push(`total_skills: ${skillResults.length}`);
  lines.push(`status: ${finalStatus}`);
  lines.push('---');
  lines.push('');
  for (const r of skillResults) {
    lines.push(`## Skill: ${r.skill}`);
    lines.push('');
    lines.push(`Status: ${r.status}`);
    lines.push('');
    if (r.output) {
      lines.push('```');
      lines.push(r.output);
      lines.push('```');
    } else {
      lines.push('(tanpa output)');
    }
    lines.push('');
  }
  return lines.join('\n');
}

function writeReport(job, skillResults, finalStatus) {
  const dir = path.join(REPORT_DIR, job.id);
  fs.mkdirSync(dir, { recursive: true });
  const reportPath = path.join(dir, 'report.md');
  fs.writeFileSync(reportPath, buildReport(job, skillResults, finalStatus), 'utf8');
  console.log(`[worker] report ditulis: ${reportPath}`);
  return reportPath;
}

/* ------------------------------------------------------------------ */
/* Processor                                                             */
/* ------------------------------------------------------------------ */

async function processJob(bullJob) {
  const jobId = bullJob?.data?.jobId;
  if (!jobId) {
    console.log('[worker] job tanpa jobId — skip');
    return;
  }
  const job = getJob(jobId);
  if (!job) {
    console.log(`[worker] job ${jobId} tidak ada di DB — skip`);
    return;
  }
  if (job.status !== 'queued') {
    console.log(`[worker] job ${jobId} status '${job.status}' bukan 'queued' — skip`);
    return;
  }

  let skills = [];
  try {
    skills = JSON.parse(job.skills_json);
  } catch (err) {
    updateJob(jobId, { status: 'failed', error: `invalid_skills_json: ${err.message}` });
    addAudit('job_error', jobId);
    console.log(`[worker] job ${jobId} skills_json tidak valid — failed`);
    return;
  }
  if (!Array.isArray(skills) || skills.length === 0) {
    updateJob(jobId, { status: 'failed', error: 'no_skills' });
    addAudit('job_error', jobId);
    return;
  }

  console.log(`[worker] mulai job ${jobId}: ${skills.length} skill (${skills.join(', ')}) depth=${job.depth}`);
  const workDir = path.join(WORK_DIR, jobId);
  if (!fs.existsSync(workDir)) {
    updateJob(jobId, { status: 'failed', error: 'workdir_missing' });
    addAudit('job_error', jobId);
    console.log(`[worker] job ${jobId} workdir tidak ada — failed`);
    return;
  }

  const total = skills.length;
  const skillResults = [];

  for (let i = 0; i < total; i++) {
    const skill = skills[i];
    console.log(`[worker] job ${jobId} — skill ${i + 1}/${total}: ${skill} (running)`);
    upsertJobSkill(jobId, skill, { status: 'running', started_at: Date.now() });
    updateJob(jobId, { status: 'running', current_skill: skill });

    let result;
    try {
      result = await runSkill(skill, workDir, job.depth);
    } catch (err) {
      result = { status: 'failed', output: `internal_error: ${err.message}` };
    }

    upsertJobSkill(jobId, skill, {
      status: result.status === 'done' ? 'done' : 'failed',
      finished_at: Date.now(),
      output: result.output,
    });
    console.log(`[worker] job ${jobId} — skill ${skill}: ${result.status} (${(result.output ?? '').length} bytes output)`);

    const progress = Math.round(((i + 1) / total) * 100);
    updateJob(jobId, { progress });
    skillResults.push({ skill, status: result.status === 'done' ? 'done' : 'failed', output: result.output });
  }

  const allDone = skillResults.every((r) => r.status === 'done');
  const failedSkills = skillResults.filter((r) => r.status === 'failed').map((r) => r.skill);

  if (allDone) {
    const reportPath = writeReport(job, skillResults, 'done');
    updateJob(jobId, { status: 'done', progress: 100, report_path: reportPath, current_skill: null });
    addAudit('job_done', jobId);
    console.log(`[worker] job ${jobId} SELESAI (done), report: ${reportPath}`);
  } else {
    const errorSummary = `skills gagal: ${failedSkills.join(', ')}`;
    const reportPath = writeReport(job, skillResults, 'failed');
    updateJob(jobId, {
      status: 'failed',
      progress: 100,
      report_path: reportPath,
      current_skill: null,
      error: errorSummary,
    });
    addAudit('job_error', jobId);
    console.log(`[worker] job ${jobId} selesai dengan kegagalan: ${errorSummary} — report tetap ditulis`);
  }
}

/* ------------------------------------------------------------------ */
/* Worker + event log                                                    */
/* ------------------------------------------------------------------ */

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const worker = new Worker(QUEUE_NAME, processJob, {
  connection,
  concurrency: 1,
});

worker.on('ready', () => console.log(`[worker] ready — listening queue '${QUEUE_NAME}' (redis ${REDIS_URL})`));
worker.on('completed', (j) => console.log(`[worker] bullmq completed: ${j.id}`));
worker.on('failed', (j, err) => {
  const jobId = j?.data?.jobId;
  console.error(`[worker] bullmq FAILED: ${j?.id} — ${err?.message ?? err}`);
  if (jobId) {
    try {
      updateJob(jobId, { status: 'failed', error: `worker_error: ${err?.message ?? String(err)}` });
      addAudit('job_error', jobId);
    } catch (e) {
      console.error('[worker] gagal update job saat bullmq failed:', e.message);
    }
  }
});
worker.on('error', (err) => console.error('[worker] queue error:', err?.message ?? err));
worker.on('closing', () => console.log('[worker] closing…'));

// Jangan crash diam-diam: log lalu exit 1 agar systemd restart.
process.on('uncaughtException', (err) => {
  console.error('[worker] UNCAUGHT EXCEPTION:', err);
  try { worker.close(); } catch { /* ignore */ }
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[worker] UNHANDLED REJECTION:', reason);
  try { worker.close(); } catch { /* ignore */ }
  process.exit(1);
});

// Graceful shutdown untuk systemd/SIGTERM.
function shutdown(signal) {
  console.log(`[worker] ${signal} diterima — menutup worker…`);
  worker
    .close()
    .then(() => {
      console.log('[worker] worker ditutup, exit 0');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[worker] error saat close:', err);
      process.exit(1);
    });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));