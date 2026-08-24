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
  severity: string; // Critical|High|Medium|Low|Info
  title: string;
  description: string | null;
  location: string | null;
  recommendation: string | null;
  created_at: number;
}

export const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low', 'Info'] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

export interface CreateJobInput {
  repo_url: string;
  branch: string;
  target_type: string;
  skills_json: string;
  depth?: string;
  instructions?: string | null;
}

export type JobPatch = Partial<
  Pick<JobRow, 'repo_url' | 'branch' | 'target_type' | 'skills_json' | 'depth' | 'status' | 'progress' | 'current_skill' | 'report_path' | 'error'>
>;

const JOB_COLUMNS = new Set([
  'repo_url', 'branch', 'target_type', 'skills_json', 'depth', 'instructions',
  'severity_counts', 'share_token',
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
  };
  for (const [col, def] of Object.entries(colDefs)) {
    if (!jobCols.has(col)) {
      db.prepare(`ALTER TABLE jobs ADD COLUMN ${col} ${def}`).run();
    }
  }
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
}

export function createJob(input: CreateJobInput): JobRow {
  const db = getDb();
  const now = Date.now();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO jobs (id, repo_url, branch, target_type, skills_json, depth, instructions, status, progress, created_at, updated_at)
     VALUES (@id, @repo_url, @branch, @target_type, @skills_json, @depth, @instructions, 'queued', 0, @now, @now)`
  ).run({ id, ...input, depth: input.depth ?? 'medium', instructions: input.instructions ?? null, now });
  return getJob(id)!;
}

export function getJob(id: string): JobRow | null {
  const row = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ?? null;
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