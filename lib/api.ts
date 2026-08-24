/**
 * lib/api.ts — client fetch wrapper untuk semua endpoint API SecurityScan Hub.
 * Semua fungsi memakai fetch biasa (cookie secscan_session dikirim otomatis).
 * Fungsi yang menangani JSON melempar Error bila respons bukan 2xx,
 * dengan pesan dari field { error } bawaan backend.
 */

export interface SkillDef {
  name: string;
  category: 'ofensif' | 'scanning' | 'analisis';
  description: string;
  ofensif: boolean;
  /** true = hanya untuk target repo (tidak berlaku utk URL live). */
  requiresRepo: boolean;
}

export interface Groups {
  ofensif: string[];
  scanning: string[];
  analisis: string[];
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type JobSkillStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  repo_url: string;
  branch: string;
  target_type: string;
  skills: string[];
  depth: string;
  instructions: string | null;
  severity_counts: string | null;
  share_token: string | null;
  validate: number;
  status: JobStatus;
  progress: number;
  current_skill: string | null;
  report_path: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface JobSkill {
  job_id: string;
  skill: string;
  status: JobSkillStatus;
  started_at: number | null;
  finished_at: number | null;
  output: string | null;
}

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';

export type ValidationStatus = 'confirmed' | 'refuted' | 'inconclusive';

export interface Finding {
  id: number;
  job_id: string;
  skill: string;
  severity: Severity | string;
  title: string;
  description: string | null;
  location: string | null;
  recommendation: string | null;
  validation_status: ValidationStatus | null;
  validation_evidence: string | null;
  created_at: number;
}

export interface JobDetail {
  job: Job;
  jobSkills: JobSkill[];
  findings: Finding[];
}

export interface CreateJobBody {
  repoUrl: string;
  branch: string;
  skills: string[];
  depth: string;
  instructions?: string | null;
  /** 'github' (default) | 'url' — target URL live black-box. */
  targetType?: 'github' | 'url';
  /** true → jalankan tahap 2 validasi temuan (PoC-lite). */
  validate?: boolean;
  confirmOfensif: boolean;
}

export class ApiError extends Error {
  status: number;
  detail?: string;
  unknown?: string | null;

  constructor(message: string, status: number, detail?: string, unknown?: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.unknown = unknown;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let payload: { error?: string; detail?: string; unknown?: string | null } = {};
    try {
      payload = (await res.json()) as { error?: string; detail?: string; unknown?: string | null };
    } catch {
      // body bukan JSON — biarkan payload kosong
    }
    throw new ApiError(payload.error ?? `request_failed (${res.status})`, res.status, payload.detail, payload.unknown);
  }
  return (await res.json()) as T;
}

/** POST /api/login {password} */
export function login(password: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

/** POST /api/logout */
export function logout(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/logout', { method: 'POST' });
}

/** GET /api/skills → { skills, groups } */
export function getSkills(): Promise<{ skills: SkillDef[]; groups: Groups }> {
  return request<{ skills: SkillDef[]; groups: Groups }>('/api/skills');
}

/** POST /api/jobs → { jobId } (lempar Error dengan pesan dari { error }) */
export function createJob(body: CreateJobBody): Promise<{ jobId: string }> {
  return request<{ jobId: string }>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** GET /api/jobs → { jobs } */
export function getJobs(): Promise<{ jobs: Job[] }> {
  return request<{ jobs: Job[] }>('/api/jobs');
}

/** GET /api/jobs/[id] → { job, jobSkills } */
export function getJob(id: string): Promise<JobDetail> {
  return request<JobDetail>(`/api/jobs/${encodeURIComponent(id)}`);
}

/** URL download report — dipakai sebagai href <a>. */
export function downloadReportUrl(id: string): string {
  return `/api/jobs/${encodeURIComponent(id)}/report`;
}

/** URL EventSource (SSE live) untuk sebuah job. */
export function eventSourceUrl(id: string): string {
  return `/api/jobs/${encodeURIComponent(id)}/stream`;
}