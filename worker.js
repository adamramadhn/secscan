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

const { spawn, execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');

const { Worker, Queue } = require('bullmq');
const IORedis = require('ioredis');
const Database = require('better-sqlite3');

/** Normalisasi judul menjadi fingerprint stabil untuk knowledge. */
function knowledgeKey(title) {
  return String(title).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
}
/** Key deterministik per target (sama dgn lib/db.ts). */
function targetKey(job) {
  return `${job.target_type}:${String(job.repo_url).trim().toLowerCase().replace(/\/+$/, '')}`;
}
/** Belajar dari temuan: upsert ke knowledge (counter + timestamp). */
function learnFindings(jobId, job, findings) {
  const now = Date.now();
  const tKey = targetKey(job);
  const upsert = db.prepare(
    `INSERT INTO knowledge (target_key, key, title, severity, seen_count, last_seen_at, first_seen_at, last_job_id, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT (target_key, key) DO UPDATE SET
       seen_count = seen_count + 1,
       last_seen_at = excluded.last_seen_at,
       last_job_id = excluded.last_job_id,
       title = excluded.title,
       severity = excluded.severity`
  );
  for (const f of findings) {
    const key = knowledgeKey(f.title);
    if (!key) continue;
    upsert.run(tKey, key, String(f.title).trim(), f.severity ?? 'Info', now, now, jobId, now);
  }
  const prev = db.prepare('SELECT findings_learned FROM target_knowledge WHERE target_key = ?').get(tKey);
  db.prepare(
    `INSERT INTO target_knowledge (target_key, findings_learned, jobs_count, first_job_at, last_job_at, last_finding_at)
     VALUES (?, ?, 1, ?, ?, ?)
     ON CONFLICT (target_key) DO UPDATE SET
       findings_learned = excluded.findings_learned,
       jobs_count = jobs_count + 1,
       last_job_at = excluded.last_job_at,
       last_finding_at = excluded.last_finding_at`
  ).run(tKey, (prev?.findings_learned ?? 0) + findings.length, now, now, now);
}
/** Konteks pembelajaran per target utk prompt scan berikutnya. */
function getTargetKnowledge(tKey) {
  return db.prepare('SELECT * FROM target_knowledge WHERE target_key = ?').get(tKey) ?? null;
}

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

/* ------------------------------------------------------------------ */
/* Migrasi (mirror lib/db.ts migrate())                                */
/* ------------------------------------------------------------------ */

function migrate() {
  const cols = db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
  if (!cols.includes('instructions')) db.prepare("ALTER TABLE jobs ADD COLUMN instructions TEXT").run();
  if (!cols.includes('severity_counts')) db.prepare("ALTER TABLE jobs ADD COLUMN severity_counts TEXT").run();
  if (!cols.includes('share_token')) db.prepare("ALTER TABLE jobs ADD COLUMN share_token TEXT").run();
  if (!cols.includes('validate')) db.prepare("ALTER TABLE jobs ADD COLUMN validate INTEGER DEFAULT 0").run();
  if (!cols.includes('auto_fix')) db.prepare("ALTER TABLE jobs ADD COLUMN auto_fix INTEGER DEFAULT 0").run();
  if (!cols.includes('diff_base')) db.prepare("ALTER TABLE jobs ADD COLUMN diff_base TEXT").run();
  if (!cols.includes('schedule_id')) db.prepare("ALTER TABLE jobs ADD COLUMN schedule_id TEXT").run();
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      target_type TEXT NOT NULL DEFAULT 'github',
      skills_json TEXT NOT NULL,
      depth TEXT NOT NULL DEFAULT 'medium',
      instructions TEXT,
      validate INTEGER NOT NULL DEFAULT 0,
      auto_fix INTEGER NOT NULL DEFAULT 0,
      diff_base TEXT,
      interval_minutes INTEGER NOT NULL DEFAULT 1440,
      last_run_at INTEGER,
      last_job_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      skill TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'Info',
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      recommendation TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_job_findings_job ON job_findings(job_id);
    CREATE TABLE IF NOT EXISTS job_fixes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      file TEXT NOT NULL,
      findings_json TEXT NOT NULL DEFAULT '[]',
      rationale TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_job_fixes_job ON job_fixes(job_id);
  `);
  const fCols = db.prepare('PRAGMA table_info(job_findings)').all().map((c) => c.name);
  if (!fCols.includes('validation_status')) db.exec(`ALTER TABLE job_findings ADD COLUMN validation_status TEXT`);
  if (!fCols.includes('validation_evidence')) db.exec(`ALTER TABLE job_findings ADD COLUMN validation_evidence TEXT`);
  if (!fCols.includes('seen_count')) db.exec(`ALTER TABLE job_findings ADD COLUMN seen_count INTEGER NOT NULL DEFAULT 1`);
  if (!fCols.includes('cve_id')) db.exec(`ALTER TABLE job_findings ADD COLUMN cve_id TEXT`);
  if (!fCols.includes('cwe_id')) db.exec(`ALTER TABLE job_findings ADD COLUMN cwe_id TEXT`);
  if (!fCols.includes('confidence')) db.exec(`ALTER TABLE job_findings ADD COLUMN confidence TEXT DEFAULT 'medium'`);
  if (!fCols.includes('source_tool')) db.exec(`ALTER TABLE job_findings ADD COLUMN source_tool TEXT DEFAULT 'hermes'`);
}
migrate();

function getJob(id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) ?? null;
}

function updateJob(id, patch) {
  const allowed = new Set(['repo_url', 'branch', 'target_type', 'skills_json', 'depth',
    'instructions', 'severity_counts', 'share_token', 'validate', 'auto_fix', 'diff_base', 'schedule_id',
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

function buildTaskPrompt(skill, depth, workDir, instructions, targetUrl, diffScope, repoUrl) {
  const extra = instructions && instructions.trim()
    ? `Instruksi khusus dari operator (WAJIB diikuti): ${instructions.trim()}`
    : '';
  const diffScopePart = diffScope
    ? `MODE DIFF-SCOPE: ini adalah review pre-merge yang CEPAT dan TERFOKUS. ` +
      `File yang berubah tersimpan di <workDir>/secscan-changed.txt (daftar) dan ` +
      `<workDir>/secscan-diff.patch (diff unified penuh vs ${diffScope.base}). ` +
      `Analisis HANYA perubahan tersebut: baca file yang berubah secara utuh bila perlu untuk konteks, ` +
      `tapi temuan yang tidak berhubungan dengan diff ini DI LUAR SCOPE — jangan dilaporkan. ` +
      `Kedalaman analisis: 'light' efektif. `
    : '';
  const learnCtx = (() => {
    try {
      const url = repoUrl || targetUrl;
      if (!url) return '';
      const tKey = `${targetUrl ? 'url' : 'github'}:${String(url).trim().toLowerCase().replace(/\/+$/, '')}`;
      const tk = getTargetKnowledge(tKey);
      if (!tk || tk.jobs_count < 2) return '';
      const known = db
        .prepare('SELECT title, severity, seen_count FROM knowledge WHERE target_key = ? ORDER BY seen_count DESC LIMIT 10')
        .all(tKey);
      const list = known.map((k) => `- [${k.severity}] ${k.title} (muncul ${k.seen_count}×)`).join('\n');
      if (!list) return '';
      return (
        `\nKONTEKS PEMBELAJARAN (continuous learning): target ini sudah di-scan ${tk.jobs_count} kali. ` +
        `Temuan yang berulang muncul (historis):\n${list}\n` +
        `Catatan: temuan berulang perlu perhatian ekstra — area tersebut kemungkinan belum diperbaiki, ` +
        `atau ada regresi. Laporkan kembali dengan fresh evidence. Bila tidak ada perubahan vs sebelumnya, ` +
        `tetap laporkan (severity sesuai kondisi saat ini).\n`
      );
    } catch {
      return '';
    }
  })();
  const findingFormat =
    `Format setiap temuan WAJIB konsisten agar bisa diparse otomatis: ` +
    `- **[Severity]** Judul singkat — deskripsi. Baris berikutnya: \`Lokasi: <file:baris atau URL>\` dan \`Rekomendasi: <perbaikan>\`. ` +
    `Jika tidak ada temuan, tulis "Tidak ada temuan." di bawah ## Temuan. `;

  if (targetUrl) {
    // Target live (black-box): worker mengirim permintaan jaringan ke URL ini.
    return (
      `Kamu adalah auditor keamanan yang diberi izin eksplisit oleh operator untuk menguji target live berikut. ` +
      `Target URL (satu-satunya yang boleh diuji): ${targetUrl} ` +
      `Jangan menguji host/domain/IP lain di luar ${targetUrl}. ` +
      `Jalankan skill '${skill}' dengan kedalaman analisis '${depth}' terhadap aplikasi live tersebut. ` +
      extra +
      `Selesaikan langkah-langkah di SKILL.md skill tersebut (baca via tool skill_view jika tersedia, ` +
      `atau ikuti prosedur standar). Gunakan tool web yang tersedia untuk memeriksa target ` +
      `(response header, robots, endpoint umum, form) secara non-destruktif — tidak ada payload perusak, ` +
      `tidak ada brute-force besar-besaran, hormati rate limit target. ` +
      `Hasil akhir WAJIB berupa laporan markdown dengan struktur: ` +
      `## Ringkasan, ## Temuan (setiap temuan: severity [Critical/High/Medium/Low/Info], deskripsi, ` +
      `lokasi (URL/endpoint) jika relevan, rekomendasi perbaikan), ## Rekomendasi Prioritas. ` +
      findingFormat +
      `Akhiri jawaban dengan laporan markdown lengkap.`
    );
  }

  return (
    `Kamu adalah auditor keamanan. Target repositori sudah di-clone di direktori kerja ini. ` +
    `Direktori target (absolut): ${workDir} — analisis HANYA repositori di direktori tersebut; ` +
    `abaikan repo/direktori lain di luar ${workDir} meskipun tampak lebih relevan. ` +
    diffScopePart +
    learnCtx +
    `Jalankan skill '${skill}' dengan kedalaman analisis '${depth}' terhadap repo ini. ` +
    extra +
    `Selesaikan langkah-langkah di SKILL.md skill tersebut (baca via tool skill_view jika tersedia, ` +
    `atau ikuti prosedur standar). Hasil akhir WAJIB berupa laporan markdown dengan struktur: ` +
    `## Ringkasan, ## Temuan (setiap temuan: severity [Critical/High/Medium/Low/Info], deskripsi, ` +
    `lokasi file jika relevan, rekomendasi perbaikan), ## Rekomendasi Prioritas. ` +
    findingFormat +
    `Jangan memodifikasi file repo. Jangan menjalankan perintah destruktif. ` +
    `Fokus analisis statis/analitis. Akhiri jawaban dengan laporan markdown lengkap.`
  );
}

/**
 * Runner hermes generik (dipakai skill scan, validator, dan fixer).
 * @param {{prompt: string, skill: string|null, workDir: string, label: string,
 *          timeoutMs?: number}} opts
 * @returns {Promise<{status:'done'|'failed', output: string}>}
 */
function runHermes({ prompt, skill, workDir, label, timeoutMs }) {
  const args = ['-z', prompt, '--in', workDir, '--safe-mode'];
  if (skill) args.splice(2, 0, '-s', skill);
  const env = { ...process.env, PATH: `${HERMES_PATH}:${process.env.PATH ?? ''}` };
  const timeout = timeoutMs ?? RUN_TIMEOUT_MS;
  console.log(`[worker] spawn hermes -z "<TASK>"${skill ? ` -s ${skill}` : ''} --in ${workDir} --safe-mode (timeout ${timeout}ms) [${label}]`);
  return new Promise((resolve) => {
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
      if (stdout.length > OUTPUT_LIMIT * 4) stdout = stdout.subarray(stdout.length - OUTPUT_LIMIT * 4);
    });
    child.stderr.on('data', (chunk) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > OUTPUT_LIMIT * 4) stderr = stderr.subarray(stderr.length - OUTPUT_LIMIT * 4);
    });

    const timeoutId = setTimeout(() => {
      if (settled) return;
      console.log(`[worker] TIMEOUT ${timeout}ms untuk hermes (${label}) — SIGTERM`);
      killedByTimeout = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, KILL_GRACE_MS);
    }, timeout);

    child.on('error', (err) => {
      finish('failed', `[spawn error] ${err.message}`);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeoutId);
      const combined = Buffer.concat([stdout, Buffer.from('\n'), stderr]).toString('utf8');
      if (killedByTimeout) {
        finish('failed', `TIMEOUT setelah ${timeout / 60000} menit.\n${combined}`);
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

/**
 * @returns {Promise<{status: 'done'|'failed', output: string}>}
 */
function runSkill(skill, workDir, depth, instructions, targetUrl, diffScope, repoUrl) {
  const taskPrompt = buildTaskPrompt(skill, depth, workDir, instructions, targetUrl, diffScope, repoUrl);
  return runHermes({ prompt: taskPrompt, skill, workDir, label: skill });
}

/* ------------------------------------------------------------------ */
/* Parser findings (port CommonJS dari lib/findings.ts — jaga sinkron) */
/* ------------------------------------------------------------------ */

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info'];
const MAX_FINDINGS = 200;

function normalizeSeverity(raw) {
  const s = String(raw).trim().toLowerCase();
  for (const sev of SEVERITIES) {
    if (sev.toLowerCase() === s) return sev;
  }
  return null;
}

function clean(text) {
  return String(text)
    .replace(/\*\*/g, '')
    .replace(/\[(Critical|High|Medium|Low|Info)\]\s*/gi, '')
    .replace(/`/g, '')
    .trim();
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function extractFindingsSection(markdown) {
  if (typeof markdown !== 'string' || markdown.length === 0) return '';
  const sectionRe = /^#{2,3}[ \t]*(Temuan|Findings)[ \t]*:?[ \t]*$/im;
  const m = markdown.match(sectionRe);
  if (!m || m.index === undefined) return '';
  const rest = markdown.slice(m.index + m[0].length);
  const next = rest.match(/^#{1,3}[ \t]+(?!\d+[.)])[^\n]*$/m);
  return next && next.index !== undefined ? rest.slice(0, next.index) : rest;
}

function parseFindings(output) {
  if (!output) return [];
  const section = extractFindingsSection(output);
  if (!section) return [];

  const findings = [];
  const lines = section.split(/\r?\n/);

  const itemRe = /^\s*(?:[-*+]|\d+[.)])[ \t]+/;
  const headingItemRe = /^\s*#{3,6}[ \t]+\d+[.)][ \t]+/;
  const bareBracketRe = /^\s*(?:\*\*)?\[(Critical|High|Medium|Low|Info)\](?:\*\*)?[ \t]+/i;
  const locRe = /^\s*(?:\*\*)?(lokasi|location|file|berkas)(?:\*\*)?[ \t]*[:：][ \t]*(.+)$/i;
  const recRe = /^\s*(?:\*\*)?(rekomendasi|recommendation|perbaikan|remediasi|fix|solusi)(?:\*\*)?[ \t]*[:：][ \t]*(.+)$/i;
  const severityBracket = /\[(Critical|High|Medium|Low|Info)\]/i;
  const severityLabel = /^\s*(?:\*\*)?(?:severity|severitas|tingkat)(?:\*\*)?[ \t]*[:：][ \t]*(Critical|High|Medium|Low|Info)/i;
  const severityParen = /[ \t]*\((?:severity|severitas|tingkat)[ \t]*[:：]?[ \t]*(Critical|High|Medium|Low|Info)\)[ \t]*$/i;

  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    current.title = clip(clean(current.title), 300) || '(tanpa judul)';
    if (current.description) current.description = clip(clean(current.description), 4000);
    if (current.location) current.location = clip(clean(current.location), 500);
    if (current.recommendation) current.recommendation = clip(clean(current.recommendation), 4000);
    findings.push(current);
  };

  for (const line of lines) {
    let body = null;
    let prefixSeverity = null;
    if (itemRe.test(line)) body = line.replace(itemRe, '');
    else if (headingItemRe.test(line)) body = line.replace(headingItemRe, '');
    else if (bareBracketRe.test(line)) {
      prefixSeverity = normalizeSeverity(line.match(bareBracketRe)[1]);
      body = line.replace(bareBracketRe, '');
    }

    if (body !== null) {
      pushCurrent();
      if (findings.length >= MAX_FINDINGS) break;

      let severity = null;
      const paren = body.match(severityParen);
      if (paren) {
        severity = normalizeSeverity(paren[1]);
        body = body.replace(severityParen, '');
      }
      const bracket = body.match(severityBracket);
      if (bracket) {
        severity = normalizeSeverity(bracket[1]);
        body = body.replace(severityBracket, '');
      } else if (prefixSeverity) {
        severity = prefixSeverity;
      } else {
        const label = body.match(severityLabel);
        if (label) {
          severity = normalizeSeverity(label[1]);
          body = body.slice(label[0].length);
        }
      }

      let title = body;
      let description = null;
      const sep = title.match(/\s+—\s+|\s+-\s+|\s*[:：]\s+/);
      if (sep && sep.index !== undefined && sep.index > 0) {
        description = title.slice(sep.index + sep[0].length).trim() || null;
        title = title.slice(0, sep.index);
      }
      title = clean(title);
      if (!title) {
        current = null;
        continue;
      }
      current = { severity: severity ?? 'Info', title, description, location: null, recommendation: null };
      continue;
    }

    if (!current) continue;

    const loc = line.match(locRe);
    if (loc) {
      current.location = current.location ? `${current.location} ${loc[2].trim()}` : loc[2].trim();
      continue;
    }
    const rec = line.match(recRe);
    if (rec) {
      current.recommendation = current.recommendation ? `${current.recommendation} ${rec[2].trim()}` : rec[2].trim();
      continue;
    }

    const text = line.trim();
    if (text) {
      const desc = clean(text);
      current.description = current.description ? `${current.description} ${desc}` : desc;
    }
  }
  pushCurrent();

  return findings.slice(0, MAX_FINDINGS);
}

/** Hitung agregat severity dari kumpulan { severity } (atau string severity). */
function countSeverities(items) {
  const counts = {};
  for (const sev of SEVERITIES) counts[sev] = 0;
  for (const item of items) {
    const sev = typeof item === 'string' ? item : item.severity;
    counts[sev] = (counts[sev] ?? 0) + 1;
  }
  return counts;
}

/** Token share acak 32 hex char. */
function randomToken() {
  return crypto.randomBytes(16).toString('hex');
}

/* ------------------------------------------------------------------ */
/* Tahap 2: validasi temuan (PoC-lite)                                  */
/* ------------------------------------------------------------------ */

const VAL_STATUSES = ['candidate', 'evidence-backed', 'confirmed', 'refuted', 'inconclusive'];
const MAX_VALIDATED = 25;

function normalizeValStatus(raw) {
  const aliases = {
    candidate: 'candidate', kandidat: 'candidate',
    'evidence-backed': 'evidence-backed', 'evidence_backed': 'evidence-backed',
    evidencebacked: 'evidence-backed', 'terbukti-kode': 'evidence-backed',
    confirmed: 'confirmed', confirm: 'confirmed', valid: 'confirmed', validated: 'confirmed',
    terkonfirmasi: 'confirmed', benar: 'confirmed',
    refuted: 'refuted', refute: 'refuted', invalid: 'refuted', false_positive: 'refuted',
    falsepositive: 'refuted', salah: 'refuted', ditolak: 'refuted',
    inconclusive: 'inconclusive', undetermined: 'inconclusive', unknown: 'inconclusive', ragu: 'inconclusive',
  };
  if (typeof raw !== 'string') return 'inconclusive';
  return aliases[raw.trim().toLowerCase()] ?? 'inconclusive';
}

/** Ambil blok ```json terakhir yang berupa array {id,status,evidence}. */
function parseValidationOutput(output) {
  if (!output) return [];
  const blocks = [...String(output).matchAll(/```json\s*([\s\S]*?)```/g)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    let parsed;
    try {
      parsed = JSON.parse(blocks[i][1]);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const items = parsed
      .filter((x) => x && typeof x === 'object' && Number.isInteger(x.id))
      .map((x) => ({
        id: x.id,
        status: normalizeValStatus(x.status),
        evidence: typeof x.evidence === 'string' ? x.evidence.slice(0, 2000) : null,
      }));
    if (items.length > 0) return items;
  }
  return [];
}

/** Prompt validator: uji ulang tiap temuan dengan bukti konkret. */
function buildValidatorPrompt(findings, workDir, targetUrl) {
  const list = findings
    .map((f) =>
      `- id=${f.id} [${f.severity}] ${f.title}\n  deskripsi: ${(f.description ?? '').slice(0, 500)}\n  lokasi: ${f.location ?? '—'}`
    )
    .join('\n');
  const targetDesc = targetUrl
    ? `Target live (satu-satunya yang boleh diuji, izin operator ada): ${targetUrl}. Gunakan permintaan non-destruktif ke sana untuk membuktikan/menolak tiap temuan (mis. cek header respons, endpoint, perilaku). Jangan menyentuh host lain.`
    : `Repositori target sudah di-clone di ${workDir} — baca file yang dirujuk untuk membuktikan/menolak tiap temuan.`;
  return (
    `Kamu adalah validator temuan keamanan senior (tahap verifikasi PoC-lite). ` +
    `Di bawah ini daftar temuan dari audit tahap pertama yang harus kamu UJI ULANG SATU PER SATU dengan bukti konkret. ` +
    `${targetDesc} ` +
    `Untuk tiap temuan, tentukan status:\n` +
    `- "confirmed": temuan TERBUKTI nyata didukung manifest/respons/eksekusi — sertakan bukti spesifik (respons HTTP riil atau manifest).\n` +
    `- "evidence-backed": temuan didukung bukti kode/konfigurasi riil di repositori (file:baris yang diverifikasi langsung).\n` +
    `- "refuted": temuan TERBUKTI keliru/false positive — jelaskan kenapa (mis. file tidak ada, mitigasi sudah ada di tempat lain).\n` +
    `- "inconclusive": tidak bisa dibuktikan tanpa runtime/data tambahan — sebutkan apa yang kurang.\n` +
    `DAFTAR TEMUAN:\n${list}\n\n` +
    `WAJIB akhiri jawaban dengan blok json (dan hanya itu blok json terakhir) berisi array — satu objek per temuan:\n` +
    '```json\n[{"id": <id temuan>, "status": "confirmed|evidence-backed|refuted|inconclusive", "evidence": "<bukti ringkas maks 2-3 kalimat>"}]\n```\n' +
    `Jangan memodifikasi file repo. Non-destruktif saja.`
  );
}

/**
 * Jalankan hermes validator untuk daftar temuan.
 * @returns {Promise<{status:'done'|'failed', output: string}>}
 */
function runValidator(findings, workDir, targetUrl) {
  const taskPrompt = buildValidatorPrompt(findings, workDir, targetUrl);
  return runHermes({ prompt: taskPrompt, skill: null, workDir, label: 'validator-poc' });
}

/** Ambil temuan job yang layak divalidasi (non-Info, max 25, urut severity). */
function getEligibleFindings(jobId) {
  const rows = db
    .prepare(
      `SELECT id, severity, title, description, location FROM job_findings
       WHERE job_id = ? AND severity != 'Info' AND (validation_status IS NULL OR validation_status = 'candidate')
       ORDER BY CASE severity
         WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2
         WHEN 'Low' THEN 3 ELSE 4 END, id
       LIMIT ${MAX_VALIDATED}`
    )
    .all(jobId);
  return rows;
}

/** Terapkan hasil validasi ke job_findings. */
function applyValidation(jobId, items) {
  const stmt = db.prepare(
    'UPDATE job_findings SET validation_status = ?, validation_evidence = ? WHERE id = ? AND job_id = ?'
  );
  const tx = db.transaction((rows) => {
    for (const it of rows) {
      stmt.run(it.status, it.evidence ?? null, it.id, jobId);
    }
  });
  tx(items);
}

/* ------------------------------------------------------------------ */
/* Tahap 3: auto-fix (perbaikan minimal + patch)                        */
/* ------------------------------------------------------------------ */

const MAX_FIX_FINDINGS = 10;

/** Parser metadata fix per file (port dari lib/fixes.ts). */
function parseFixesOutput(output) {
  if (!output) return [];
  const blocks = [...String(output).matchAll(/```json\s*([\s\S]*?)```/g)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    let parsed;
    try {
      parsed = JSON.parse(blocks[i][1]);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const items = parsed
      .filter((x) => x && typeof x === 'object' && typeof x.file === 'string' && x.file.trim().length > 0)
      .map((x) => ({
        file: String(x.file).slice(0, 500),
        findings: Array.isArray(x.findings)
          ? x.findings.filter((n) => Number.isInteger(n)).slice(0, 50)
          : [],
        rationale: typeof x.rationale === 'string' ? x.rationale.slice(0, 2000) : null,
      }));
    if (items.length > 0) return items;
  }
  return [];
}

/** Prompt fixer: terapkan perbaikan minimal untuk daftar temuan. */
function buildFixerPrompt(findings, workDir) {
  const list = findings
    .map((f) =>
      `- id=${f.id} [${f.severity}] ${f.title}\n  deskripsi: ${(f.description ?? '').slice(0, 500)}\n  lokasi: ${f.location ?? '—'}\n  rekomendasi auditor: ${(f.recommendation ?? f.validation_evidence ?? '').slice(0, 500)}`
    )
    .join('\n');
  return (
    `Kamu adalah engineer keamanan senior yang menulis perbaikan kode minimal dan aman. ` +
    `Repositori target sudah di-clone di ${workDir}. Terapkan perbaikan MINIMAL untuk tiap temuan di bawah ini ` +
    `(satu perubahan sekecil mungkin yang menutup temuan — jangan refactor, jangan restyle, jangan sentuh hal lain):\n` +
    `- Prioritaskan: temuan terkonfirmasi validasi, lalu severity tertinggi.\n` +
    `- Hanya file yang relevan dengan temuan. Jangan menambah dependensi baru kecuali benar-benar wajib.\n` +
    `- Jika temuan tidak bisa diperbaiki dengan suntingan kode (mis. butuh konfigurasi infra), LEWATI dan jangan dipaksakan.\n` +
    `DAFTAR TEMUAN:\n${list}\n\n` +
    `Setelah selesai mengedit, WAJIB akhiri jawaban dengan blok json array — satu objek per file yang kamu ubah:\n` +
    '```json\n[{"file": "<path relatif>", "findings": [<id temuan yang ditutup>], "rationale": "<kenapa perubahan ini menutup temuan>"}]\n```\n' +
    `Jangan commit; biarkan perubahan sebagai working-tree diff.`
  );
}

/** Jalankan hermes fixer (boleh menulis file di workdir). */
function runFixer(findings, workDir) {
  const taskPrompt = buildFixerPrompt(findings, workDir);
  return runHermes({ prompt: taskPrompt, skill: null, workDir, label: 'auto-fix' });
}

/** Capture git diff workdir (unified, termasuk file baru untracked). */
function captureGitDiff(workDir) {
  try {
    execFileSync('git', ['-C', workDir, 'add', '-A', '-N'], { stdio: 'ignore', timeout: 30_000 });
    const diff = execFileSync('git', ['-C', workDir, 'diff'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
    // Normalisasi trailing newline: git apply butuh baris terakhir diakhiri \n,
    // tapi jangan biarkan multiple blank lines menempel di akhir.
    return diff.replace(/\n*$/, '\n');
  } catch (err) {
    console.error('[worker] captureGitDiff gagal:', err?.message ?? err);
    return null;
  }
}

/** Simpan metadata fix + patch ke DB/disk. */
function persistFixes(jobId, fixMetas, patchText) {
  const dir = path.join(REPORT_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });
  const stmt = db.prepare(
    'INSERT INTO job_fixes (job_id, file, findings_json, rationale, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const tx = db.transaction((metas) => {
    for (const m of metas) {
      stmt.run(jobId, m.file, JSON.stringify(m.findings), m.rationale, Date.now());
    }
  });
  tx(fixMetas);
  if (patchText) {
    fs.writeFileSync(path.join(dir, 'fixes.patch'), patchText, 'utf8');
    return path.join(dir, 'fixes.patch');
  }
  return null;
}

/** Ambil temuan yang layak difix (confirmed dulu bila ada, sisanya non-Info, max 10). */
function getEligibleFixFindings(jobId) {
  const rows = db
    .prepare(
      `SELECT id, severity, title, description, location, recommendation, validation_status, validation_evidence
       FROM job_findings
       WHERE job_id = ? AND severity != 'Info' AND (validation_status IS NULL OR validation_status != 'refuted')
       ORDER BY CASE WHEN validation_status = 'confirmed' THEN 0 ELSE 1 END,
         CASE severity WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END,
         id
       LIMIT ${MAX_FIX_FINDINGS}`
    )
    .all(jobId);
  return rows;
}

/* ------------------------------------------------------------------ */
/* Diff-scope (review pre-merge vs base ref)                            */
/* ------------------------------------------------------------------ */

/**
 * Siapkan artefak diff-scope di workdir: resolve base ref → SHA, tulis
 * secscan-diff.patch + secscan-changed.txt untuk dipakai prompt skill.
 * Urutan resolve: fetch ref langsung (branch/tag/SHA penuh) → GitHub API
 * (repo publik, SHA singkat) → unshallow lokal + rev-parse (repo private).
 * @returns {{base: string, sha: string, changedCount: number, diffBytes: number}|null}
 */
async function prepareDiffScope(workDir, base, repoUrl) {
  const git = (args, opts = {}) =>
    execFileSync('git', ['-C', workDir, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000, ...opts });
  try {
    let sha = null;
    // 1) fetch ref langsung — bekerja untuk branch/tag/SHA penuh.
    try {
      git(['fetch', '--depth', '1', 'origin', base, '--no-tags'], { stdio: 'pipe' });
      sha = git(['rev-parse', 'FETCH_HEAD']).trim();
    } catch {
      // 2) SHA singkat → resolve via GitHub API (hanya repo publik).
      if (/^[0-9a-f]{7,39}$/i.test(base)) {
        let apiRef = null;
        try {
          const res = await fetch(`https://api.github.com/repos/${repoUrl.replace('https://github.com/', '')}/commits/${base}`, {
            headers: { 'User-Agent': 'secscan-worker', Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(15_000),
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.sha && /^[0-9a-f]{40}$/.test(data.sha)) apiRef = data.sha;
          }
        } catch { /* lanjut fallback lokal */ }
        if (apiRef) {
          try {
            git(['fetch', '--depth', '1', 'origin', apiRef, '--no-tags'], { stdio: 'pipe' });
            sha = git(['rev-parse', 'FETCH_HEAD']).trim();
          } catch { /* lanjut fallback lokal */ }
        }
        // 3) Fallback lokal (repo private): unshallow lalu rev-parse SHA singkat.
        if (!sha) {
          try {
            git(['fetch', '--unshallow', 'origin', '--no-tags'], { stdio: 'pipe', timeout: 180_000 });
          } catch { /* mungkin sudah lengkap */ }
          try {
            sha = git(['rev-parse', '--verify', `${base}^{commit}`]).trim();
          } catch {
            throw new Error(`base ref '${base}' tidak ditemukan (lokal maupun remote)`);
          }
        }
      } else {
        throw new Error(`base ref '${base}' tidak bisa di-fetch`);
      }
    }
    if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) throw new Error('sha tidak valid');
    // diff workdir (kondisi branch HEAD) vs SHA base.
    git(['add', '-A', '-N'], { stdio: 'ignore' });
    const diff = git(['diff', sha]);
    const norm = diff.replace(/\n*$/, '\n');
    fs.writeFileSync(path.join(workDir, 'secscan-diff.patch'), norm, 'utf8');
    const changed = git(['diff', '--name-only', sha]);
    const files = changed.split('\n').map((s) => s.trim()).filter(Boolean);
    fs.writeFileSync(path.join(workDir, 'secscan-changed.txt'), files.join('\n') + (files.length ? '\n' : ''), 'utf8');
    console.log(`[worker] diff-scope siap: base ${base} (${sha.slice(0, 8)}), ${files.length} file berubah, diff ${norm.length} byte`);
    return { base, sha, changedCount: files.length, diffBytes: norm.length };
  } catch (err) {
    console.error('[worker] prepareDiffScope gagal:', err?.message ?? err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Baseline Deterministik (Trivy SCA & Passive Web Inspection)         */
/* ------------------------------------------------------------------ */

const TRIVY_SEV_MAP = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  UNKNOWN: 'Info',
};

function isTrivyAvailable(binPath = process.env.TRIVY_BIN || 'trivy') {
  try {
    const res = spawnSync(binPath, ['--version'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: 'pipe',
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

function parseTrivyOutput(rawInput) {
  let report;
  if (typeof rawInput === 'string') {
    if (!rawInput.trim()) return [];
    try {
      report = JSON.parse(rawInput);
    } catch {
      return [];
    }
  } else {
    report = rawInput;
  }

  if (!report || !Array.isArray(report.Results)) return [];

  const findings = [];
  for (const res of report.Results) {
    const target = res.Target || 'repository';

    // 1. Vulnerabilities
    if (Array.isArray(res.Vulnerabilities)) {
      for (const v of res.Vulnerabilities) {
        const cve = v.VulnerabilityID;
        const cwe = Array.isArray(v.CweIDs) && v.CweIDs.length > 0 ? v.CweIDs.join(', ') : 'CWE-937';
        const sev = TRIVY_SEV_MAP[String(v.Severity).toUpperCase()] || 'Medium';
        const fix = v.FixedVersion ? `ke versi ${v.FixedVersion}` : 'ke rilis terbaru yang aman';

        findings.push({
          skill: 'dependency-scanning',
          source_tool: 'trivy',
          severity: sev,
          confidence: 'high',
          validation_status: 'confirmed',
          cve_id: cve,
          cwe_id: cwe,
          title: `${v.PkgName}@${v.InstalledVersion} — ${cve}${v.Title ? `: ${v.Title}` : ''}`,
          description: v.Description || `Kerentanan teridentifikasi pada paket dependensi ${v.PkgName}. Referensi: ${v.PrimaryURL || cve}`,
          location: `${target}:${v.PkgName}@${v.InstalledVersion}`,
          recommendation: `Upgrade dependensi ${v.PkgName} ${fix}.`,
          validation_evidence: `Manifes ${target} memuat paket rentan ${v.PkgName}@${v.InstalledVersion} (ID: ${cve}). Terdeteksi secara deterministik oleh Trivy.`,
        });
      }
    }

    // 2. Secrets
    if (Array.isArray(res.Secrets)) {
      for (const s of res.Secrets) {
        const sev = TRIVY_SEV_MAP[String(s.Severity).toUpperCase()] || 'High';
        const line = s.StartLine || 1;

        findings.push({
          skill: 'vulnerability-scanning',
          source_tool: 'trivy',
          severity: sev,
          confidence: 'high',
          validation_status: 'confirmed',
          cwe_id: 'CWE-798',
          title: `Hardcoded Secret: ${s.Title || s.RuleID}`,
          description: `Terdeteksi token/kredensial statis (${s.Category || 'Secret'}: ${s.RuleID}) di dalam berkas kode repositori.`,
          location: `${target}:${line}`,
          recommendation: 'Hapus nilai rahasia dari repositori git, gunakan secret manager atau environment variables, dan lakukan rotasi kredensial tersebut.',
          validation_evidence: `Berkas ${target} baris ${line} cocok dengan pola aturan deteksi secret '${s.RuleID}'.`,
        });
      }
    }
  }

  return findings;
}

function runTrivyBaseline(workDir) {
  const bin = process.env.TRIVY_BIN || 'trivy';
  if (!isTrivyAvailable(bin)) {
    return { status: 'skipped', reason: 'trivy_not_installed', findings: [] };
  }

  try {
    const res = spawnSync(bin, ['fs', workDir, '--format', 'json', '--scanners', 'vuln,secret'], {
      encoding: 'utf-8',
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (res.error) {
      return { status: 'failed', reason: res.error.message, findings: [] };
    }

    const stdout = res.stdout || '';
    const findings = parseTrivyOutput(stdout);
    return { status: 'done', findings };
  } catch (err) {
    return { status: 'failed', reason: err.message, findings: [] };
  }
}

// Anti-SSRF DNS Pre-flight Check
function isPrivateOrBlockedIp(ip) {
  const cleanIp = String(ip).trim().toLowerCase();
  if (cleanIp.startsWith('::ffff:')) {
    const rest = cleanIp.slice(7);
    if (net.isIPv4(rest)) return isPrivateOrBlockedIp(rest);
  }

  const family = net.isIP(cleanIp);
  if (family === 4) {
    const parts = cleanIp.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return { blocked: true, reason: 'invalid_ipv4_format' };
    }
    const [a, b] = parts;
    if (a === 127) return { blocked: true, reason: 'loopback_ipv4' };
    if (a === 10) return { blocked: true, reason: 'private_rfc1918_10' };
    if (a === 172 && b >= 16 && b <= 31) return { blocked: true, reason: 'private_rfc1918_172' };
    if (a === 192 && b === 168) return { blocked: true, reason: 'private_rfc1918_192' };
    if (a === 169 && b === 254) return { blocked: true, reason: 'link_local_169_254' };
    if (a === 100 && b >= 64 && b <= 127) return { blocked: true, reason: 'cgnat_rfc6598' };
    if (a === 0) return { blocked: true, reason: 'unspecified_zero_ipv4' };
    if (cleanIp === '255.255.255.255') return { blocked: true, reason: 'broadcast_ipv4' };
    if (a === 192 && b === 0 && parts[2] === 2) return { blocked: true, reason: 'documentation_ipv4' };
    if (a === 198 && b === 51 && parts[2] === 100) return { blocked: true, reason: 'documentation_ipv4' };
    if (a === 203 && b === 0 && parts[2] === 113) return { blocked: true, reason: 'documentation_ipv4' };
    if (a >= 224) return { blocked: true, reason: 'multicast_or_reserved_ipv4' };
    return { blocked: false };
  }

  if (family === 6) {
    if (cleanIp === '::1') return { blocked: true, reason: 'loopback_ipv6' };
    if (cleanIp === '::' || cleanIp === '0:0:0:0:0:0:0:0') return { blocked: true, reason: 'unspecified_ipv6' };
    if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) return { blocked: true, reason: 'unique_local_ipv6' };
    if (/^fe[89ab]/i.test(cleanIp)) return { blocked: true, reason: 'link_local_ipv6' };
    if (cleanIp.startsWith('ff')) return { blocked: true, reason: 'multicast_ipv6' };
    if (cleanIp.startsWith('2001:db8:') || cleanIp.startsWith('2001:0db8:')) return { blocked: true, reason: 'documentation_ipv6' };
    return { blocked: false };
  }

  return { blocked: true, reason: 'not_an_ip' };
}

async function checkSafeDns(hostname) {
  const cleanHost = String(hostname).trim().toLowerCase();
  if (net.isIP(cleanHost)) {
    const check = isPrivateOrBlockedIp(cleanHost);
    return check.blocked
      ? { ok: false, error: 'blocked_ip', reason: check.reason, addresses: [cleanHost] }
      : { ok: true, addresses: [cleanHost] };
  }

  try {
    const resolved = await dns.lookup(cleanHost, { all: true });
    if (!resolved || resolved.length === 0) {
      return { ok: false, error: 'dns_resolution_failed', reason: 'no_addresses' };
    }
    const addresses = resolved.map((r) => r.address);
    for (const addr of addresses) {
      const check = isPrivateOrBlockedIp(addr);
      if (check.blocked) {
        return { ok: false, error: 'blocked_ip', reason: `Resolved IP ${addr} is prohibited: ${check.reason}`, addresses };
      }
    }
    return { ok: true, addresses };
  } catch (err) {
    return { ok: false, error: 'dns_resolution_failed', reason: err.message };
  }
}

function inspectHttpHeaders(input) {
  const findings = [];
  const { url, statusCode, headers } = input;
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return findings;
  }

  const isHttps = parsedUrl.protocol === 'https:';
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (v === undefined || v === null) continue;
    h[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  }

  if (isHttps) {
    const hsts = h['strict-transport-security'];
    if (!hsts) {
      findings.push({
        skill: 'passive-web',
        source_tool: 'passive-web',
        severity: 'Medium',
        confidence: 'high',
        validation_status: 'confirmed',
        cwe_id: 'CWE-319',
        title: 'Missing Strict-Transport-Security (HSTS) Header',
        description: 'Aplikasi HTTPS tidak mengirimkan header Strict-Transport-Security. Hal ini memungkinkan pengguna menjadi rentan terhadap serangan SSL stripping atau downgrade ke HTTP.',
        location: `${parsedUrl.origin}/ (HTTP ${statusCode})`,
        recommendation: 'Tambahkan header HTTP: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
        validation_evidence: `Respons HTTP ${statusCode} dari ${parsedUrl.origin}/ tidak memuat header 'Strict-Transport-Security'.`,
      });
    } else {
      const maxAgeMatch = hsts.match(/max-age\s*=\s*(\d+)/i);
      const maxAge = maxAgeMatch ? Number.parseInt(maxAgeMatch[1], 10) : 0;
      if (maxAge < 15724800) {
        findings.push({
          skill: 'passive-web',
          source_tool: 'passive-web',
          severity: 'Low',
          confidence: 'high',
          validation_status: 'confirmed',
          cwe_id: 'CWE-319',
          title: 'HSTS Duration Terlalu Pendek',
          description: `Durasi HSTS max-age terdeteksi hanya ${maxAge} detik (kurang dari 15.724.800 detik / 6 bulan).`,
          location: `${parsedUrl.origin}/`,
          recommendation: 'Tingkatkan nilai max-age HSTS menjadi minimal 31536000 (1 tahun).',
          validation_evidence: `Header Strict-Transport-Security: '${hsts}'`,
        });
      }
    }
  }

  const csp = h['content-security-policy'];
  if (!csp) {
    findings.push({
      skill: 'passive-web',
      source_tool: 'passive-web',
      severity: 'Medium',
      confidence: 'high',
      validation_status: 'confirmed',
      cwe_id: 'CWE-1021',
      title: 'Missing Content-Security-Policy (CSP) Header',
      description: 'Aplikasi tidak mengonfigurasikan header Content-Security-Policy. Ketiadaan CSP meningkatkan risiko eksploitasi Cross-Site Scripting (XSS) dan pemuatan resource berbahaya.',
      location: `${parsedUrl.origin}/ (HTTP ${statusCode})`,
      recommendation: 'Terapkan header Content-Security-Policy yang membatasi sumber script, style, dan koneksi eksternal.',
      validation_evidence: `Respons HTTP ${statusCode} dari ${parsedUrl.origin}/ tidak memuat header 'Content-Security-Policy'.`,
    });
  }

  const xfo = h['x-frame-options'];
  const hasFrameAncestors = csp && /frame-ancestors/i.test(csp);
  if (!xfo && !hasFrameAncestors) {
    findings.push({
      skill: 'passive-web',
      source_tool: 'passive-web',
      severity: 'Low',
      confidence: 'high',
      validation_status: 'confirmed',
      cwe_id: 'CWE-1021',
      title: 'Missing X-Frame-Options Header (Clickjacking Risk)',
      description: 'Aplikasi dapat di-embed ke dalam iframe di domain lain tanpa pembatasan frame-ancestors atau X-Frame-Options, menimbulkan risiko serangan clickjacking.',
      location: `${parsedUrl.origin}/`,
      recommendation: 'Tambahkan header X-Frame-Options: DENY atau SAMEORIGIN, atau gunakan CSP frame-ancestors.',
      validation_evidence: `Respons HTTP ${statusCode} tidak memuat 'X-Frame-Options' maupun CSP 'frame-ancestors'.`,
    });
  }

  const xcto = h['x-content-type-options'];
  if (!xcto || !xcto.toLowerCase().includes('nosniff')) {
    findings.push({
      skill: 'passive-web',
      source_tool: 'passive-web',
      severity: 'Low',
      confidence: 'high',
      validation_status: 'confirmed',
      cwe_id: 'CWE-116',
      title: 'Missing or Incomplete X-Content-Type-Options Header',
      description: 'Browser dapat mencoba menebak (MIME-sniffing) tipe konten file, yang berpotensi mengeksekusi file non-script sebagai JavaScript.',
      location: `${parsedUrl.origin}/`,
      recommendation: 'Tambahkan header: X-Content-Type-Options: nosniff',
      validation_evidence: `Header X-Content-Type-Options bernilai: '${xcto || 'tidak ada'}'`,
    });
  }

  const rp = h['referrer-policy'];
  if (!rp) {
    findings.push({
      skill: 'passive-web',
      source_tool: 'passive-web',
      severity: 'Low',
      confidence: 'high',
      validation_status: 'confirmed',
      cwe_id: 'CWE-200',
      title: 'Missing Referrer-Policy Header',
      description: 'Aplikasi tidak mengontrol pengiriman informasi Referer pada navigasi lintas situs.',
      location: `${parsedUrl.origin}/`,
      recommendation: 'Tambahkan header: Referrer-Policy: strict-origin-when-cross-origin',
      validation_evidence: `Respons HTTP ${statusCode} tidak memuat header 'Referrer-Policy'.`,
    });
  }

  const server = h['server'];
  const xPoweredBy = h['x-powered-by'];
  const bannerLeak = [
    server && /\d+\.\d+/.test(server) ? `Server: ${server}` : null,
    xPoweredBy ? `X-Powered-By: ${xPoweredBy}` : null,
  ].filter(Boolean).join('; ');

  if (bannerLeak) {
    findings.push({
      skill: 'passive-web',
      source_tool: 'passive-web',
      severity: 'Low',
      confidence: 'high',
      validation_status: 'confirmed',
      cwe_id: 'CWE-200',
      title: 'Technology & Version Information Disclosure',
      description: `Aplikasi membocorkan versi teknologi backend melalui respon header (${bannerLeak}), memudahkan penyerang memetakan kerentanan spesifik versi.`,
      location: `${parsedUrl.origin}/`,
      recommendation: 'Sembunyikan atau samarkan header Server dan hapus header X-Powered-By pada konfigurasi server/framework.',
      validation_evidence: `Header respon membocorkan: ${bannerLeak}`,
    });
  }

  return findings;
}

async function runPassiveWebBaseline(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { status: 'skipped', reason: 'invalid_url', findings: [] };
  }

  const dnsRes = await checkSafeDns(parsed.hostname);
  if (!dnsRes.ok) {
    return { status: 'skipped', reason: `anti_ssrf_blocked: ${dnsRes.reason}`, findings: [] };
  }

  try {
    const res = await fetch(parsed.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'SecScan-Hub-Auditor/1.0 (Authorized Security Baseline Check)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
    });

    const headersRecord = {};
    res.headers.forEach((value, key) => {
      headersRecord[key.toLowerCase()] = value;
    });

    const findings = inspectHttpHeaders({
      url: targetUrl,
      statusCode: res.status,
      headers: headersRecord,
    });

    return { status: 'done', findings };
  } catch (err) {
    return { status: 'failed', reason: err.message, findings: [] };
  }
}

/** Simpan temuan hasil parse ke job_findings + update severity_counts job. */
function persistFindings(jobId, skill, parsed) {
  if (!parsed || !parsed.length) return;
  const stmt = db.prepare(
    `INSERT INTO job_findings (
      job_id, skill, severity, title, description, location, recommendation,
      validation_status, validation_evidence, cve_id, cwe_id, confidence, source_tool, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const now = Date.now();
  const tx = db.transaction((rows) => {
    for (const f of rows) {
      const srcTool = f.source_tool || (skill === 'trivy' ? 'trivy' : skill === 'passive-web' ? 'passive-web' : 'hermes');
      const isDet = srcTool === 'trivy' || srcTool === 'passive-web';
      const valStatus = f.validation_status || (isDet ? 'confirmed' : 'candidate');
      const conf = f.confidence || (isDet ? 'high' : 'medium');
      stmt.run(
        jobId,
        skill,
        f.severity,
        f.title,
        f.description ?? null,
        f.location ?? null,
        f.recommendation ?? null,
        valStatus,
        f.validation_evidence ?? null,
        f.cve_id ?? null,
        f.cwe_id ?? null,
        conf,
        srcTool,
        now
      );
    }
  });
  tx(parsed);
  const all = db.prepare('SELECT severity FROM job_findings WHERE job_id = ?').all(jobId);
  updateJob(jobId, { severity_counts: JSON.stringify(countSeverities(all.map((r) => r.severity))) });
}

/* ------------------------------------------------------------------ */
/* Report                                                                 */
/* ------------------------------------------------------------------ */

function buildReport(job, skillResults, finalStatus, allFindings, validationInfo, fixInfo) {
  const lines = [];
  const counts = countSeverities(allFindings);
  const totalFindings = allFindings.length;
  lines.push('---');
  lines.push(`jobId: ${job.id}`);
  lines.push(`repo_url: ${job.repo_url}`);
  lines.push(`branch: ${job.branch}`);
  lines.push(`depth: ${job.depth}`);
  lines.push(`tanggal: ${new Date().toISOString()}`);
  lines.push(`total_skills: ${skillResults.length}`);
  lines.push(`total_temuan: ${totalFindings}`);
  lines.push(`severity: Critical=${counts.Critical} High=${counts.High} Medium=${counts.Medium} Low=${counts.Low} Info=${counts.Info}`);
  lines.push(`status: ${finalStatus}`);
  lines.push('---');
  lines.push('');

  // Ringkasan eksekutif — temuan terurut severity, dengan pemisahan deterministik vs AI.
  if (totalFindings > 0) {
    lines.push('# Ringkasan Temuan');
    lines.push('');
    lines.push(`Total **${totalFindings}** temuan — **${counts.Critical}** Critical, **${counts.High}** High, **${counts.Medium}** Medium, **${counts.Low}** Low, **${counts.Info}** Info.`);
    lines.push('');

    const order = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 };
    const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

    const detFindings = allFindings.filter((f) => f.source_tool === 'trivy' || f.source_tool === 'passive-web');
    const aiFindings = allFindings.filter((f) => f.source_tool !== 'trivy' && f.source_tool !== 'passive-web');

    if (detFindings.length > 0) {
      lines.push('## Hasil Pemindaian Deterministik (Trivy & Web Baseline)');
      lines.push('');
      lines.push(`Ditemukan **${detFindings.length}** temuan berbasis bukti deterministik langsung.`);
      lines.push('');
      lines.push('| # | Severity | Judul | Alat | CVE / CWE | Lokasi / Bukti |');
      lines.push('|---|---|---|---|---|---|');
      const detSorted = [...detFindings].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
      detSorted.forEach((f, i) => {
        const ref = [f.cve_id, f.cwe_id].filter(Boolean).join(' / ') || '—';
        const loc = f.location || f.validation_evidence || '—';
        lines.push(`| ${i + 1} | **${f.severity}** | ${esc(f.title)} | \`${esc(f.source_tool || f.skill)}\` | ${esc(ref)} | ${esc(loc)} |`);
      });
      lines.push('');
    }

    if (aiFindings.length > 0) {
      lines.push('## Analisis Keamanan Berbasis AI (Hermes Skills)');
      lines.push('');
      lines.push(`Ditemukan **${aiFindings.length}** temuan kontekstual dari evaluasi kelemahan logika dan arsitektur kode.`);
      lines.push('');
      lines.push('| # | Severity | Judul | Skill | Lokasi | Validasi |');
      lines.push('|---|---|---|---|---|---|');
      const aiSorted = [...aiFindings].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
      const valMap = new Map((validationInfo?.validatedRows ?? []).map((r) => [r.id, r]));
      aiSorted.forEach((f, i) => {
        const val = validationInfo?.validatedRows ? (valMap.get(f.id)?.status ?? f.validation_status ?? 'candidate') : (f.validation_status ?? '—');
        lines.push(`| ${i + 1} | **${f.severity}** | ${esc(f.title)} | ${esc(f.skill)} | ${esc(f.location) ?? '—'} | ${val} |`);
      });
      lines.push('');
    }
  }

  // Ringkasan validasi (tahap PoC) bila dijalankan.
  if (validationInfo) {
    lines.push('# Validasi Temuan (PoC-lite)');
    lines.push('');
    if (validationInfo.status === 'done') {
      lines.push(`**${validationInfo.validated}** temuan diverifikasi: **${validationInfo.confirmed}** confirmed, **${validationInfo.refuted}** refuted, sisanya inconclusive.`);
      lines.push('');
      const valRows = validationInfo.validatedRows ?? [];
      if (valRows.length > 0) {
        lines.push('| ID | Status | Bukti |');
        lines.push('|---|---|---|');
        const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
        for (const r of valRows) {
          lines.push(`| ${r.id} | **${r.status}** | ${esc(r.evidence).slice(0, 300)} |`);
        }
        lines.push('');
      }
    } else if (validationInfo.status === 'skipped') {
      lines.push('Dilewati — tidak ada temuan non-Info yang layak divalidasi.');
      lines.push('');
    } else {
      lines.push(`Gagal: ${validationInfo.reason ?? 'unknown'}. Temuan tetap dilaporkan tanpa status validasi.`);
      lines.push('');
    }
  }

  // Ringkasan auto-fix (tahap 3) bila dijalankan.
  if (fixInfo) {
    lines.push('# Auto-Fix Patch');
    lines.push('');
    if (fixInfo.status === 'done') {
      lines.push(`**${fixInfo.files}** file diubah — patch tersimpan sebagai \`fixes.patch\` (dapat di-apply dengan \`git apply\`).`);
      lines.push('');
      const fixRows = fixInfo.fixRows ?? [];
      if (fixRows.length > 0) {
        lines.push('| File | Temuan ditutup | Alasan |');
        lines.push('|---|---|---|');
        const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
        for (const r of fixRows) {
          let ids = r.findings_json;
          try { ids = JSON.parse(r.findings_json).join(', '); } catch { /* biarkan */ }
          lines.push(`| \`${esc(r.file)}\` | ${ids} | ${esc(r.rationale).slice(0, 200)} |`);
        }
        lines.push('');
      }
    } else if (fixInfo.status === 'skipped') {
      lines.push(`Dilewati (${fixInfo.reason === 'url_target' ? 'target URL live tidak punya kode untuk diperbaiki' : 'tidak ada temuan yang layak diperbaiki'}).`);
      lines.push('');
    } else {
      lines.push(`Gagal: ${fixInfo.reason ?? 'unknown'}. Temuan tetap dilaporkan tanpa patch.`);
      lines.push('');
    }
  }

  if (job.instructions && job.instructions.trim()) {
    lines.push('# Instruksi Operator');
    lines.push('');
    lines.push(job.instructions.trim());
    lines.push('');
  }

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

function writeReport(job, skillResults, finalStatus, allFindings, validationInfo, fixInfo) {
  const dir = path.join(REPORT_DIR, job.id);
  fs.mkdirSync(dir, { recursive: true });
  const reportPath = path.join(dir, 'report.md');
  // Baca ulang rows validasi dari DB (applyValidation sudah menulis status di sana).
  let enriched = validationInfo;
  if (validationInfo && validationInfo.status === 'done') {
    try {
      const rows = db
        .prepare('SELECT id, validation_status AS status, validation_evidence AS evidence FROM job_findings WHERE job_id = ? AND validation_status IS NOT NULL ORDER BY id')
        .all(job.id);
      enriched = { ...validationInfo, validatedRows: rows };
    } catch {
      enriched = validationInfo; // biarkan tanpa rows
    }
  }
  // Baca ulang metadata fix dari DB bila ada.
  let fixEnriched = fixInfo;
  if (fixInfo && fixInfo.status === 'done') {
    try {
      const frows = db
        .prepare('SELECT file, findings_json, rationale FROM job_fixes WHERE job_id = ? ORDER BY rowid')
        .all(job.id);
      fixEnriched = { ...fixInfo, fixRows: frows };
    } catch {
      fixEnriched = fixInfo;
    }
  }
  fs.writeFileSync(reportPath, buildReport(job, skillResults, finalStatus, allFindings, enriched, fixEnriched), 'utf8');
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

  console.log(`[worker] mulai job ${jobId}: ${skills.length} skill (${skills.join(', ')}) depth=${job.depth} target=${job.target_type}`);
  const workDir = path.join(WORK_DIR, jobId);
  const targetUrl = job.target_type === 'url' ? job.repo_url : null;
  if (!fs.existsSync(workDir)) {
    updateJob(jobId, { status: 'failed', error: 'workdir_missing' });
    addAudit('job_error', jobId);
    console.log(`[worker] job ${jobId} workdir tidak ada — failed`);
    return;
  }

  const total = skills.length;
  const skillResults = [];
  const allFindings = [];

  // ——— Persiapan diff-scope (bila job.mode diff-scope) ———
  let diffScope = null;
  if (job.target_type === 'github' && job.diff_base && String(job.diff_base).trim()) {
    diffScope = await prepareDiffScope(workDir, String(job.diff_base).trim(), job.repo_url);
    if (!diffScope) {
      updateJob(jobId, { status: 'failed', error: `diff_base_fetch_failed: ${job.diff_base}` });
      addAudit('job_error', jobId);
      console.log(`[worker] job ${jobId} — fetch/resolve diff base gagal — failed`);
      return;
    }
  }

  // ——— Tahap 1: Baseline Deterministik (Trivy SCA / Passive Web) ———
  if (job.target_type === 'github') {
    console.log(`[worker] job ${jobId} — menjalankan baseline deterministik: Trivy SCA & Secrets`);
    try {
      const trivyRes = runTrivyBaseline(workDir);
      if (trivyRes.status === 'done' && trivyRes.findings.length > 0) {
        persistFindings(jobId, 'trivy', trivyRes.findings);
        for (const f of trivyRes.findings) allFindings.push({ ...f, skill: 'trivy' });
        console.log(`[worker] job ${jobId} — Trivy menemukan ${trivyRes.findings.length} temuan deterministik`);
      } else if (trivyRes.status === 'skipped') {
        console.log(`[worker] job ${jobId} — Trivy dilewati: ${trivyRes.reason}`);
      }
    } catch (err) {
      console.warn(`[worker] job ${jobId} — eksekusi Trivy baseline error (non-fatal):`, err?.message ?? err);
    }
  } else if (job.target_type === 'url' && targetUrl) {
    console.log(`[worker] job ${jobId} — menjalankan baseline deterministik: Passive Web Inspection`);
    try {
      const webRes = await runPassiveWebBaseline(targetUrl);
      if (webRes.status === 'done' && webRes.findings.length > 0) {
        persistFindings(jobId, 'passive-web', webRes.findings);
        for (const f of webRes.findings) allFindings.push({ ...f, skill: 'passive-web' });
        console.log(`[worker] job ${jobId} — Passive Web menemukan ${webRes.findings.length} temuan deterministik`);
      } else if (webRes.status === 'skipped') {
        console.log(`[worker] job ${jobId} — Passive Web dilewati: ${webRes.reason}`);
      }
    } catch (err) {
      console.warn(`[worker] job ${jobId} — eksekusi Passive Web baseline error (non-fatal):`, err?.message ?? err);
    }
  }

  for (let i = 0; i < total; i++) {
    const skill = skills[i];
    console.log(`[worker] job ${jobId} — skill ${i + 1}/${total}: ${skill} (running)`);
    upsertJobSkill(jobId, skill, { status: 'running', started_at: Date.now() });
    updateJob(jobId, { status: 'running', current_skill: skill });

    let result;
    try {
      result = await runSkill(skill, workDir, job.depth, job.instructions, targetUrl, diffScope, job.repo_url);
    } catch (err) {
      result = { status: 'failed', output: `internal_error: ${err.message}` };
    }

    upsertJobSkill(jobId, skill, {
      status: result.status === 'done' ? 'done' : 'failed',
      finished_at: Date.now(),
      output: result.output,
    });

    // Parse + persist temuan hanya dari skill yang sukses (output failed = noise).
    if (result.status === 'done') {
      try {
        const parsed = parseFindings(result.output);
        const mapped = parsed.map((f) => ({
          ...f,
          source_tool: 'hermes',
          confidence: 'medium',
          validation_status: 'candidate',
        }));
        persistFindings(jobId, skill, mapped);
        for (const f of mapped) allFindings.push({ ...f, skill });
        if (parsed.length > 0) {
          console.log(`[worker] job ${jobId} — ${parsed.length} temuan diparse dari ${skill}`);
        }
      } catch (err) {
        console.error(`[worker] gagal parse/persist findings ${skill}:`, err?.message ?? err);
      }
    }

    console.log(`[worker] job ${jobId} — skill ${skill}: ${result.status} (${(result.output ?? '').length} bytes output)`);

    const progress = Math.round(((i + 1) / total) * 100);
    updateJob(jobId, { progress });
    skillResults.push({ skill, status: result.status === 'done' ? 'done' : 'failed', output: result.output });
  }

  const allDone = skillResults.every((r) => r.status === 'done');
  const failedSkills = skillResults.filter((r) => r.status === 'failed').map((r) => r.skill);

  // ——— Tahap 2: validasi temuan (PoC-lite) ———
  let validationInfo = null;
  if (Number(job.validate) === 1 && allDone) {
    const eligible = getEligibleFindings(jobId);
    if (eligible.length === 0) {
      console.log(`[worker] job ${jobId} — validasi dilewati (tidak ada temuan non-Info)`);
      validationInfo = { status: 'skipped', reason: 'no_findings', validated: 0 };
    } else {
      console.log(`[worker] job ${jobId} — tahap validasi: ${eligible.length} temuan akan diverifikasi`);
      updateJob(jobId, { status: 'running', current_skill: 'validasi-poc' });
      let valResult;
      try {
        valResult = await runValidator(eligible, workDir, targetUrl);
      } catch (err) {
        valResult = { status: 'failed', output: `internal_error: ${err.message}` };
      }
      if (valResult.status === 'done') {
        const items = parseValidationOutput(valResult.output);
        if (items.length > 0) {
          try {
            applyValidation(jobId, items);
            const nConf = items.filter((i) => i.status === 'confirmed').length;
            const nRef = items.filter((i) => i.status === 'refuted').length;
            console.log(`[worker] job ${jobId} — validasi selesai: ${items.length} diproses (${nConf} confirmed, ${nRef} refuted)`);
            validationInfo = { status: 'done', validated: items.length, confirmed: nConf, refuted: nRef, output: valResult.output, validatedRows: items };
          } catch (err) {
            console.error(`[worker] job ${jobId} — gagal apply validation:`, err?.message ?? err);
            validationInfo = { status: 'failed', reason: err?.message ?? 'apply_error', validated: 0 };
          }
        } else {
          console.log(`[worker] job ${jobId} — output validator tanpa blok json valid`);
          validationInfo = { status: 'failed', reason: 'no_json_block', validated: 0 };
        }
      } else {
        console.log(`[worker] job ${jobId} — validator gagal: ${(valResult.output ?? '').slice(0, 200)}`);
        validationInfo = { status: 'failed', reason: 'validator_failed', validated: 0 };
      }
    }
  }

  // ——— Tahap 3: auto-fix (hanya target repo) ———
  let fixInfo = null;
  if (Number(job.auto_fix) === 1 && allDone && job.target_type === 'github') {
    const eligible = getEligibleFixFindings(jobId);
    if (eligible.length === 0) {
      console.log(`[worker] job ${jobId} — auto-fix dilewati (tidak ada temuan yang layak)`);
      fixInfo = { status: 'skipped', reason: 'no_findings', files: 0 };
    } else {
      console.log(`[worker] job ${jobId} — tahap auto-fix: ${eligible.length} temuan kandidat`);
      updateJob(jobId, { status: 'running', current_skill: 'auto-fix' });
      let fixResult;
      try {
        fixResult = await runFixer(eligible, workDir);
      } catch (err) {
        fixResult = { status: 'failed', output: `internal_error: ${err.message}` };
      }
      if (fixResult.status === 'done') {
        const metas = parseFixesOutput(fixResult.output);
        const patchText = captureGitDiff(workDir);
        if (metas.length > 0 && patchText && patchText.length > 0) {
          try {
            const patchPath = persistFixes(jobId, metas, patchText);
            console.log(`[worker] job ${jobId} — auto-fix selesai: ${metas.length} file diubah, patch ${patchText.length} byte → ${patchPath}`);
            fixInfo = { status: 'done', files: metas.length, patch_path: patchPath, patch_bytes: patchText.length };
          } catch (err) {
            console.error(`[worker] job ${jobId} — gagal persist fixes:`, err?.message ?? err);
            fixInfo = { status: 'failed', reason: err?.message ?? 'persist_error', files: 0 };
          }
        } else if (metas.length === 0 && (!patchText || patchText.length === 0)) {
          console.log(`[worker] job ${jobId} — fixer tidak mengubah apa pun (tidak ada fix yang layak)`);
          fixInfo = { status: 'skipped', reason: 'no_changes', files: 0 };
        } else {
          console.log(`[worker] job ${jobId} — auto-fix inkonsisten (metas=${metas.length}, patch=${patchText ? patchText.length : 0} byte) — diff tetap disimpan bila ada`);
          fixInfo = { status: 'failed', reason: 'inconsistent', files: metas.length };
        }
      } else {
        console.log(`[worker] job ${jobId} — fixer gagal: ${(fixResult.output ?? '').slice(0, 200)}`);
        fixInfo = { status: 'failed', reason: 'fixer_failed', files: 0 };
      }
    }
  } else if (Number(job.auto_fix) === 1 && allDone && job.target_type !== 'github') {
    console.log(`[worker] job ${jobId} — auto-fix tidak tersedia untuk target URL live`);
    fixInfo = { status: 'skipped', reason: 'url_target', files: 0 };
  }

  // Share token: generate saat job terminal dengan report (untuk link /r/<token>).
  if (!job.share_token) {
    try {
      updateJob(jobId, { share_token: randomToken() });
    } catch (err) {
      console.error('[worker] gagal set share_token:', err?.message ?? err);
    }
  }

  if (allDone) {
    // ——— Continuous learning: belajar dari temuan job ini ———
    const tKey = targetKey(job);
    try {
      learnFindings(jobId, job, allFindings);
      const prevKnowledge = getTargetKnowledge(tKey);
      const seenKeys = new Set();
      const totalJobs = prevKnowledge?.jobs_count ?? 1;
      // Annotate temuan berulang: seen_count naik / turun (dari knowledge).
      const upsert = db.prepare(
        `INSERT INTO knowledge (target_key, key, title, severity, seen_count, last_seen_at, first_seen_at, last_job_id, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
         ON CONFLICT (target_key, key) DO UPDATE SET
           seen_count = seen_count + 1,
           last_seen_at = excluded.last_seen_at,
           last_job_id = excluded.last_job_id`
      );
      for (const f of allFindings) {
        const key = knowledgeKey(f.title);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const row = db.prepare('SELECT seen_count FROM knowledge WHERE target_key = ? AND key = ?').get(tKey, key);
        upsert.run(tKey, key, String(f.title).trim(), f.severity ?? 'Info', Date.now(), Date.now(), jobId, Date.now());
        // seen_count sekarang sudah +1 (upsert di atas) → berulang bila >= 2
        const count = row ? row.seen_count + 1 : 1;
        if (count >= 2) {
          db.prepare('UPDATE job_findings SET seen_count = ? WHERE job_id = ? AND title = ?').run(
            count,
            jobId,
            f.title,
          );
        }
      }
      console.log(`[worker] job ${jobId} — knowledge diperbarui (${allFindings.length} temuan, total ${totalJobs} job utk target)`);
    } catch (err) {
      console.error('[worker] learnFindings gagal (non-fatal):', err?.message ?? err);
    }

    const freshJob = getJob(jobId);
    const reportPath = writeReport(freshJob ?? job, skillResults, 'done', allFindings, validationInfo, fixInfo);
    updateJob(jobId, { status: 'done', progress: 100, report_path: reportPath, current_skill: null });
    addAudit('job_done', jobId);
    console.log(`[worker] job ${jobId} SELESAI (done), report: ${reportPath}`);
  } else {
    const errorSummary = `skills gagal: ${failedSkills.join(', ')}`;
    const freshJob = getJob(jobId);
    const reportPath = writeReport(freshJob ?? job, skillResults, 'failed', allFindings, null);
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
const scanQueue = new Queue(QUEUE_NAME, { connection });
const WORKER_CONCURRENCY = Math.max(1, Math.min(Number(process.env.WORKER_CONCURRENCY ?? 2), 5));
const worker = new Worker(QUEUE_NAME, processJob, {
  connection,
  concurrency: WORKER_CONCURRENCY,
});

/* ------------------------------------------------------------------ */
/* Scheduler — jadwal scan berkala (tabel schedules)                    */
/* ------------------------------------------------------------------ */

const SCHEDULER_TICK_MS = 60_000;

/** Query jadwal jatuh tempo. */
function dueSchedules(now) {
  return db
    .prepare(
      `SELECT * FROM schedules
       WHERE enabled = 1
         AND (last_run_at IS NULL OR last_run_at <= ? - interval_minutes * 60000)`
    )
    .all(now);
}

/** Job aktif milik schedule (queued/running). */
function activeJobOfSchedule(scheduleId) {
  return (
    db
      .prepare(
        `SELECT * FROM jobs WHERE schedule_id = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`
      )
      .get(scheduleId) ?? null
  );
}

/** Clone shallow untuk job scheduled (port lib/clone.ts). */
function cloneRepoSync(repoUrl, branch, destDir) {
  try {
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    execFileSync('git', ['clone', '--depth', '1', '--branch', branch || 'main', repoUrl, destDir], {
      stdio: 'pipe',
      timeout: 120_000,
      killSignal: 'SIGKILL',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err).slice(0, 500) };
  }
}

/** Jalankan satu job scheduled: buat row job → clone → enqueue. */
async function runScheduledJob(schedule) {
  const jobId = crypto.randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO jobs (id, repo_url, branch, target_type, skills_json, depth, instructions, validate, auto_fix, diff_base, schedule_id, status, progress, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`
  ).run(jobId, schedule.repo_url, schedule.branch, schedule.target_type, schedule.skills_json,
    schedule.depth, schedule.instructions, schedule.validate, schedule.auto_fix, schedule.diff_base,
    schedule.id, now, now);
  db.prepare('UPDATE schedules SET last_run_at = ?, last_job_id = ?, updated_at = ? WHERE id = ?')
    .run(now, jobId, now, schedule.id);
  addAudit('schedule_run', jobId);
  console.log(`[scheduler] jadwal '${schedule.name}' → job ${jobId}`);

  if (schedule.target_type === 'github') {
    const workDir = path.join(WORK_DIR, jobId);
    const clone = cloneRepoSync(schedule.repo_url, schedule.branch, workDir);
    if (!clone.ok) {
      updateJob(jobId, { status: 'failed', error: `clone_failed: ${clone.error}` });
      addAudit('job_clone_failed', jobId);
      console.error(`[scheduler] clone gagal utk jadwal '${schedule.name}': ${clone.error}`);
      return null;
    }
  } else {
    // Target URL live: worker butuh workdir ada (meski tanpa clone).
    try {
      fs.mkdirSync(path.join(WORK_DIR, jobId), { recursive: true });
    } catch (err) {
      updateJob(jobId, { status: 'failed', error: `mkdir_failed: ${err?.message ?? err}` });
      return null;
    }
  }
  try {
    await scanQueue.add('scan', { jobId }, { jobId, attempts: 3, backoff: { type: 'exponential', delay: 15_000 } });
    return jobId;
  } catch (err) {
    updateJob(jobId, { status: 'failed', error: `enqueue_failed: ${err?.message ?? err}` });
    console.error(`[scheduler] enqueue gagal utk jadwal '${schedule.name}':`, err?.message ?? err);
    return null;
  }
}

let schedulerTimer = null;

async function schedulerTick() {
  try {
    const due = dueSchedules(Date.now());
    for (const s of due) {
      const active = activeJobOfSchedule(s.id);
      if (active) {
        console.log(`[scheduler] jadwal '${s.name}' dilewati — job ${active.id} masih ${active.status}`);
        continue;
      }
      await runScheduledJob(s);
    }
  } catch (err) {
    console.error('[scheduler] tick error:', err?.message ?? err);
  }
}

function startScheduler() {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(schedulerTick, SCHEDULER_TICK_MS);
  // tick pertama setelah 5 detik (biar worker siap)
  setTimeout(schedulerTick, 5_000).unref?.();
  console.log(`[scheduler] aktif — cek jadwal tiap ${SCHEDULER_TICK_MS / 1000}s`);
}

worker.on('ready', () => {
  console.log(`[worker] ready — queue '${QUEUE_NAME}' concurrency=${WORKER_CONCURRENCY} (redis ${REDIS_URL})`);
  startScheduler();
});
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