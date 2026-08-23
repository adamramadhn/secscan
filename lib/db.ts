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

export interface CreateJobInput {
  repo_url: string;
  branch: string;
  target_type: string;
  skills_json: string;
  depth?: string;
}

export type JobPatch = Partial<
  Pick<JobRow, 'repo_url' | 'branch' | 'target_type' | 'skills_json' | 'depth' | 'status' | 'progress' | 'current_skill' | 'report_path' | 'error'>
>;

const JOB_COLUMNS = new Set([
  'repo_url', 'branch', 'target_type', 'skills_json', 'depth',
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
}

export function createJob(input: CreateJobInput): JobRow {
  const db = getDb();
  const now = Date.now();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO jobs (id, repo_url, branch, target_type, skills_json, depth, status, progress, created_at, updated_at)
     VALUES (@id, @repo_url, @branch, @target_type, @skills_json, @depth, 'queued', 0, @now, @now)`
  ).run({ id, ...input, depth: input.depth ?? 'medium', now });
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

export function addAudit(action: string, detail: string): void {
  getDb().prepare('INSERT INTO audit_log (ts, action, detail) VALUES (?, ?, ?)').run(Date.now(), action, detail);
}