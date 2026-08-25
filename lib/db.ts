import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

export interface JobRow {
  id: string;
  repo_url: string;
  branch: string;
  target_type: string;
  skills_json: string;
  depth: string;
  instructions: string | null;
  severity_counts: string | null;
  share_token: string | null;
  validate: number;
  auto_fix: number;
  diff_base: string | null;
  schedule_id: string | null;
  status: string;
  progress: number;
  current_skill: string | null;
  report_path: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  token: string;
  created_at: number;
}

export interface JobSkillRow {
  job_id: string;
  skill: string;
  status: string;
  started_at: number | null;
  finished_at: number | null;
  output: string | null;
}

export interface AuditRow {
  id: number;
  ts: number;
  action: string;
  detail: string;
}

export interface FindingRow {
  id: number;
  job_id: string;
  skill: string;
  severity: string;
  title: string;
  description: string | null;
  location: string | null;
  recommendation: string | null;
  validation_status: string | null;
  validation_evidence: string | null;
  seen_count?: number;
  created_at: number;
}

export const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low', 'Info'] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

export interface FixRow {
  id: number;
  job_id: string;
  file: string;
  findings_json: string;
  rationale: string | null;
  created_at: number;
}

export interface CreateJobInput {
  repo_url: string;
  branch: string;
  target_type: string;
  skills_json: string;
  depth?: string;
  instructions?: string | null;
  validate?: number;
  auto_fix?: number;
  diff_base?: string | null;
}

export type JobPatch = Partial<
  Pick<JobRow, 'repo_url' | 'branch' | 'target_type' | 'skills_json' | 'depth' | 'instructions' | 'severity_counts' | 'share_token' | 'validate' | 'auto_fix' | 'diff_base' | 'schedule_id' | 'status' | 'progress' | 'current_skill' | 'report_path' | 'error'>
>;

const JOB_COLUMNS = new Set([
  'repo_url', 'branch', 'target_type', 'skills_json', 'depth', 'instructions',
  'severity_counts', 'share_token', 'validate', 'auto_fix', 'diff_base', 'schedule_id',
  'status', 'progress', 'current_skill', 'report_path', 'error',
]);

export type JobSkillPatch = Partial<
  Pick<JobSkillRow, 'status' | 'started_at' | 'finished_at' | 'output'>
>;

const JOB_SKILL_COLUMNS = new Set(['status', 'started_at', 'finished_at', 'output']);

let dbInstance: Database.Database | null = null;

function defaultDbPath(): string {
  return process.env.DB_PATH || '/var/lib/secscan/secscan.db';
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const dbPath = defaultDbPath();
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  dbInstance = db;
  return db;
}

export function initDb(): void {
  const db = getDb();
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
  // Migrasi kolom/ tabel baru (aman dijalankan berulang — cek dulu).
  migrate(db);
}

/** Migrasi ringan: tambah kolom jobs + tabel job_findings bila belum ada. */
function migrate(db: Database.Database): void {
  const jobCols = new Set(
    (db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[]).map((c) => c.name),
  );
  const colDefs: Record<string, string> = {
    instructions: "TEXT",
    severity_counts: "TEXT",
    share_token: "TEXT",
    validate: "INTEGER DEFAULT 0",
    auto_fix: "INTEGER DEFAULT 0",
    diff_base: "TEXT",
    schedule_id: "TEXT",
  };
  for (const [col, def] of Object.entries(colDefs)) {
    if (!jobCols.has(col)) {
      db.prepare(`ALTER TABLE jobs ADD COLUMN ${col} ${def}`).run();
    }
  }
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
  `);
  // ——— Tabel knowledge (continuous learning) ———
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_key TEXT NOT NULL,
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'Info',
      seen_count INTEGER NOT NULL DEFAULT 1,
      last_seen_at INTEGER NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_job_id TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (target_key, key)
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_target ON knowledge(target_key);
  `);
  // ——— Tabel target_knowledge (konteks per target, input ke prompt) ———
  db.exec(`
    CREATE TABLE IF NOT EXISTS target_knowledge (
      target_key TEXT PRIMARY KEY,
      context TEXT,
      findings_learned INTEGER NOT NULL DEFAULT 0,
      jobs_count INTEGER NOT NULL DEFAULT 1,
      first_job_at INTEGER NOT NULL,
      last_job_at INTEGER NOT NULL,
      last_finding_at INTEGER NOT NULL
    );
  `);
  // Kolom validasi (tahap 2 PoC) — tambah bila belum ada.
  const fCols = new Set(
    (db.prepare('PRAGMA table_info(job_findings)').all() as { name: string }[]).map((c) => c.name),
  );
  if (!fCols.has('validation_status')) {
    db.exec(`ALTER TABLE job_findings ADD COLUMN validation_status TEXT`);
  }
  if (!fCols.has('validation_evidence')) {
    db.exec(`ALTER TABLE job_findings ADD COLUMN validation_evidence TEXT`);
  }
  if (!fCols.has('seen_count')) {
    db.exec(`ALTER TABLE job_findings ADD COLUMN seen_count INTEGER NOT NULL DEFAULT 1`);
  }
  db.exec(`
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
}

export function createJob(input: CreateJobInput): JobRow {
  const db = getDb();
  const now = Date.now();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO jobs (id, repo_url, branch, target_type, skills_json, depth, instructions, validate, auto_fix, diff_base, status, progress, created_at, updated_at)
     VALUES (@id, @repo_url, @branch, @target_type, @skills_json, @depth, @instructions, @validate, @auto_fix, @diff_base, 'queued', 0, @now, @now)`
  ).run({ ...input, id, now, depth: input.depth ?? 'medium', instructions: input.instructions ?? null, validate: input.validate ?? 0, auto_fix: input.auto_fix ?? 0, diff_base: input.diff_base ?? null });
  return getJob(id)!;
}

export function getJob(id: string): JobRow | null {
  const row = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ?? null;
}

export interface ScheduleRow {
  id: string;
  name: string;
  repo_url: string;
  branch: string;
  target_type: string;
  skills_json: string;
  depth: string;
  instructions: string | null;
  validate: number;
  auto_fix: number;
  diff_base: string | null;
  interval_minutes: number;
  last_run_at: number | null;
  last_job_id: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface CreateScheduleInput {
  name: string;
  repo_url: string;
  branch: string;
  target_type: string;
  skills_json: string;
  depth?: string;
  instructions?: string | null;
  validate?: number;
  auto_fix?: number;
  diff_base?: string | null;
  interval_minutes?: number;
}

/** Buat jadwal berkala (scheduled scan). */
export function createFromSchedule(s: ScheduleRow, jobId: string): JobRow {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO jobs (id, repo_url, branch, target_type, skills_json, depth, instructions, validate, auto_fix, diff_base, schedule_id, status, progress, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`
  ).run(
    jobId, s.repo_url, s.branch, s.target_type, s.skills_json, s.depth,
    s.instructions, s.validate, s.auto_fix, s.diff_base, s.id, now, now,
  );
  return getJob(jobId)!;
}

export function listSchedules(): ScheduleRow[] {
  return getDb().prepare('SELECT * FROM schedules ORDER BY created_at DESC').all() as ScheduleRow[];
}

export function getSchedule(id: string): ScheduleRow | null {
  return (getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow) ?? null;
}

export function createSchedule(input: CreateScheduleInput): ScheduleRow {
  const db = getDb();
  const now = Date.now();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO schedules (id, name, repo_url, branch, target_type, skills_json, depth, instructions, validate, auto_fix, diff_base, interval_minutes, enabled, created_at, updated_at)
     VALUES (@id, @name, @repo_url, @branch, @target_type, @skills_json, @depth, @instructions, @validate, @auto_fix, @diff_base, @interval_minutes, 1, @now, @now)`
  ).run({
    ...input,
    id,
    now,
    depth: input.depth ?? 'medium',
    instructions: input.instructions ?? null,
    validate: input.validate ?? 0,
    auto_fix: input.auto_fix ?? 0,
    diff_base: input.diff_base ?? null,
    interval_minutes: input.interval_minutes ?? 1440,
  });
  return getSchedule(id)!;
}

const SCHEDULE_COLUMNS = new Set([
  'name', 'repo_url', 'branch', 'target_type', 'skills_json', 'depth', 'instructions',
  'validate', 'auto_fix', 'diff_base', 'interval_minutes', 'last_run_at', 'last_job_id',
  'enabled', 'updated_at',
]);

export function updateSchedule(id: string, patch: Partial<ScheduleRow>): ScheduleRow | null {
  const db = getDb();
  const entries = Object.entries(patch).filter(([k, v]) => SCHEDULE_COLUMNS.has(k) && v !== undefined);
  if (entries.length === 0) return getSchedule(id);
  const set = entries.map(([k]) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE schedules SET ${set} WHERE id = @id`).run({ ...Object.fromEntries(entries), id });
  return getSchedule(id);
}

export function deleteSchedule(id: string): boolean {
  const res = getDb().prepare('DELETE FROM schedules WHERE id = ?').run(id);
  return res.changes > 0;
}

export interface KnowledgeRow {
  id: number;
  target_key: string;
  key: string;
  title: string;
  severity: string;
  seen_count: number;
  last_seen_at: number;
  first_seen_at: number;
  last_job_id: string | null;
  created_at: number;
}

export interface TargetKnowledgeRow {
  target_key: string;
  context: string | null;
  findings_learned: number;
  jobs_count: number;
  first_job_at: number;
  last_job_at: number;
  last_finding_at: number;
}

/** Key deterministik per target: `${target_type}:${normalized_url}`. */
export function targetKey(job: { repo_url: string; target_type: string }): string {
  const norm = job.repo_url.trim().toLowerCase().replace(/\/+$/, '');
  return `${job.target_type}:${norm}`;
}

/** Belajar dari temuan job: upsert fingerprint per (target, judul) + stats target. */
export function learnFindings(
  jobId: string,
  job: { repo_url: string; target_type: string },
  findings: { title: string; severity: string }[],
): void {
  const db = getDb();
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
    const key = f.title.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
    if (!key) continue;
    upsert.run(tKey, key, f.title.trim(), f.severity, now, now, jobId, now);
  }
  const prev = db
    .prepare('SELECT findings_learned FROM target_knowledge WHERE target_key = ?')
    .get(tKey) as { findings_learned: number } | undefined;
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

/** Riwayat knowledge per target — urut jumlah kemunculan. */
export function getKnowledgeForTarget(tKey: string): KnowledgeRow[] {
  return getDb()
    .prepare('SELECT * FROM knowledge WHERE target_key = ? ORDER BY seen_count DESC, last_seen_at DESC LIMIT 100')
    .all(tKey) as KnowledgeRow[];
}

/** Konteks pembelajaran per target untuk prompt scan. */
export function getTargetKnowledge(tKey: string): TargetKnowledgeRow | null {
  return (getDb().prepare('SELECT * FROM target_knowledge WHERE target_key = ?').get(tKey) as TargetKnowledgeRow) ?? null;
}

/** Amati knowledge semua target (analisis). */
export function listAllKnowledge(): KnowledgeRow[] {
  return getDb().prepare('SELECT * FROM knowledge ORDER BY seen_count DESC LIMIT 200').all() as KnowledgeRow[];
}

/** Jadwal yang sudah jatuh tempo (enabled, belum pernah jalan atau lewat interval). */
export function dueSchedules(now: number): ScheduleRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM schedules
       WHERE enabled = 1
         AND (last_run_at IS NULL OR last_run_at <= ? - interval_minutes * 60000)`
    )
    .all(now) as ScheduleRow[];
}

/** Job aktif terakhir milik sebuah schedule (queued/running). */
export function activeJobOfSchedule(scheduleId: string): JobRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT j.* FROM jobs j WHERE j.schedule_id = ? AND j.status IN ('queued','running') ORDER BY j.created_at DESC LIMIT 1`
      )
      .get(scheduleId) as JobRow) ?? null
  );
}

export function listJobs(): JobRow[] {
  return getDb().prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as JobRow[];
}

export function updateJob(id: string, patch: JobPatch): JobRow | null {
  const entries = Object.entries(patch).filter(([k, v]) => JOB_COLUMNS.has(k) && v !== undefined);
  if (entries.length === 0) return getJob(id);
  const sets = entries.map(([k]) => `${k} = @${k}`).join(', ');
  const params: Record<string, unknown> = { ...patch, id, now: Date.now() };
  getDb().prepare(`UPDATE jobs SET ${sets}, updated_at = @now WHERE id = @id`).run(params);
  return getJob(id);
}

export function upsertJobSkill(jobId: string, skill: string, patch: JobSkillPatch = {}): JobSkillRow {
  const db = getDb();
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
  return db.prepare('SELECT * FROM job_skills WHERE job_id = ? AND skill = ?').get(jobId, skill) as JobSkillRow;
}

export function getJobSkills(jobId: string): JobSkillRow[] {
  return getDb().prepare('SELECT * FROM job_skills WHERE job_id = ? ORDER BY rowid').all(jobId) as JobSkillRow[];
}

export function getJobFixes(jobId: string): FixRow[] {
  return getDb().prepare('SELECT * FROM job_fixes WHERE job_id = ? ORDER BY rowid').all(jobId) as FixRow[];
}

export function getJobByShareToken(token: string): JobRow | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 128) return null;
  const row = getDb().prepare('SELECT * FROM jobs WHERE share_token = ?').get(token) as JobRow | undefined;
  return row ?? null;
}

export interface NewFinding {
  skill: string;
  severity: string;
  title: string;
  description?: string | null;
  location?: string | null;
  recommendation?: string | null;
}

export function insertFindings(jobId: string, findings: NewFinding[]): void {
  if (findings.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO job_findings (job_id, skill, severity, title, description, location, recommendation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const now = Date.now();
  const tx = db.transaction((rows: NewFinding[]) => {
    for (const f of rows) {
      stmt.run(
        jobId,
        f.skill,
        f.severity,
        f.title,
        f.description ?? null,
        f.location ?? null,
        f.recommendation ?? null,
        now,
      );
    }
  });
  tx(findings);
}

export function getJobFindings(jobId: string): FindingRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM job_findings WHERE job_id = ?
       ORDER BY CASE severity
         WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2
         WHEN 'Low' THEN 3 ELSE 4 END, id`
    )
    .all(jobId) as FindingRow[];
}

export function severityCounts(findings: { severity: string }[]): string {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return JSON.stringify(counts);
}

export function addAudit(action: string, detail: string): void {
  getDb().prepare('INSERT INTO audit_log (ts, action, detail) VALUES (?, ?, ?)').run(Date.now(), action, detail);
}