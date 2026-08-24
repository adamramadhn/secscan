import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/require-auth';
import { cloneRepo, isValidGithubUrl } from '@/lib/clone';
import { enqueueScan } from '@/lib/jobs';
import { getSkill } from '@/lib/skills';
import { createJob, listJobs, updateJob, addAudit } from '@/lib/db';
import fs from 'fs';
import path from 'path';

// Future-compat untuk deployment serverless/long-running.
export const maxDuration = 300;

const VALID_DEPTHS = new Set(['light', 'medium', 'deep']);

interface JobBody {
  repoUrl?: unknown;
  branch?: unknown;
  skills?: unknown;
  depth?: unknown;
  instructions?: unknown;
  confirmOfensif?: unknown;
}

export const POST = withAuth(async (req: Request) => {
  let body: JobBody;
  try {
    body = (await req.json()) as JobBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const repoUrl = typeof body.repoUrl === 'string' ? body.repoUrl.trim() : '';
  if (!isValidGithubUrl(repoUrl)) {
    return NextResponse.json({ error: 'invalid_repo_url' }, { status: 400 });
  }

  const skills = Array.isArray(body.skills) ? body.skills.filter((s): s is string => typeof s === 'string') : [];
  const unknownSkill = skills.find((s) => !getSkill(s));
  if (skills.length === 0 || unknownSkill) {
    return NextResponse.json({ error: 'invalid_skills', unknown: unknownSkill ?? null }, { status: 400 });
  }

  const depth = typeof body.depth === 'string' && VALID_DEPTHS.has(body.depth) ? body.depth : 'medium';

  const hasOfensif = skills.some((s) => getSkill(s)?.ofensif === true);
  if (hasOfensif && body.confirmOfensif !== true) {
    return NextResponse.json({ error: 'confirm_ofensif_required' }, { status: 400 });
  }

  // Batasi job aktif (queued|running). Hitung dari DB — state single source of truth.
  const maxJobs = Number(process.env.MAX_JOBS ?? 5);
  const activeCount = listJobs().filter((j) => j.status === 'queued' || j.status === 'running').length;
  if (activeCount >= maxJobs) {
    return NextResponse.json({ error: 'too_many_jobs' }, { status: 429 });
  }

  const branch = typeof body.branch === 'string' && body.branch.trim().length > 0 ? body.branch.trim() : 'main';

  // Instruksi kustom operator (opsional, max 4000 char, satu baris).
  let instructions: string | null = null;
  if (typeof body.instructions === 'string') {
    const cleaned = body.instructions.replace(/[\r\n\t]+/g, ' ').trim();
    if (cleaned.length > 4000) {
      return NextResponse.json({ error: 'instructions_too_long' }, { status: 400 });
    }
    instructions = cleaned.length > 0 ? cleaned : null;
  }

  // Persist job dulu (status 'queued'), lalu clone source.
  const job = createJob({
    repo_url: repoUrl,
    branch,
    target_type: 'github',
    skills_json: JSON.stringify(skills),
    depth,
    instructions,
  });

  const workDir = process.env.WORK_DIR ?? '/var/lib/secscan/work';
  const destDir = path.join(workDir, job.id);
  try {
    fs.mkdirSync(destDir, { recursive: true });
  } catch {
    // mkdir gagal → job tidak bisa diproses; tandai failed.
    updateJob(job.id, { status: 'failed', error: 'clone_failed: cannot create workdir' });
    addAudit('job_clone_failed', job.id);
    return NextResponse.json(
      { error: 'clone_failed', detail: 'cannot create workdir' },
      { status: 502 },
    );
  }

  const clone = await cloneRepo(repoUrl, branch, destDir);
  if (!clone.ok) {
    updateJob(job.id, { status: 'failed', error: `clone_failed: ${clone.error}` });
    addAudit('job_clone_failed', job.id);
    return NextResponse.json({ error: 'clone_failed', detail: clone.error }, { status: 502 });
  }

  try {
    await enqueueScan(job.id);
  } catch (err) {
    // Redis down → job tidak akan pernah dieksekusi worker; tandai failed.
    const msg = err instanceof Error ? err.message : String(err);
    updateJob(job.id, { status: 'failed', error: `enqueue_failed: ${msg}` });
    addAudit('job_clone_failed', job.id);
    return NextResponse.json({ error: 'clone_failed', detail: `enqueue_failed: ${msg}` }, { status: 502 });
  }

  addAudit('job_created', job.id);
  return NextResponse.json({ jobId: job.id }, { status: 201 });
});

export const GET = withAuth(async () => {
  const jobs = listJobs().map((j) => {
    let skillsParsed: unknown = [];
    try {
      skillsParsed = JSON.parse(j.skills_json);
    } catch {
      skillsParsed = [];
    }
    return { ...j, skills: skillsParsed };
  });
  return NextResponse.json({ jobs });
});