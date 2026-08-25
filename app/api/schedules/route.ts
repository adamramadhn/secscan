import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/require-auth';
import { listSchedules, createSchedule } from '@/lib/db';
import { isValidGithubUrl } from '@/lib/clone';
import { isValidLiveUrl } from '@/lib/target';
import { isValidDiffBase } from '@/lib/clone';
import { getSkill } from '@/lib/skills';

interface ScheduleBody {
  name?: unknown;
  repoUrl?: unknown;
  branch?: unknown;
  targetType?: unknown;
  skills?: unknown;
  depth?: unknown;
  instructions?: unknown;
  validate?: unknown;
  autoFix?: unknown;
  diffBase?: unknown;
  intervalMinutes?: unknown;
}

/** GET /api/schedules — daftar semua jadwal. */
export const GET = withAuth(async () => {
  const schedules = listSchedules().map((s) => {
    let skillsParsed: unknown = [];
    try {
      skillsParsed = JSON.parse(s.skills_json);
    } catch {
      skillsParsed = [];
    }
    return { ...s, skills: skillsParsed };
  });
  return NextResponse.json({ schedules });
});

/** POST /api/schedules — buat jadwal dari konfigurasi job. */
export const POST = withAuth(async (req: Request) => {
  let body: ScheduleBody;
  try {
    body = (await req.json()) as ScheduleBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // Nama wajib, masuk akal panjangnya.
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length === 0 || name.length > 120) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
  }

  // Target: sama aturannya dengan job biasa.
  const targetType = body.targetType === 'url' ? 'url' : 'github';
  const repoUrl = typeof body.repoUrl === 'string' ? body.repoUrl.trim() : '';
  if (targetType === 'github') {
    if (!isValidGithubUrl(repoUrl)) {
      return NextResponse.json({ error: 'invalid_repo_url' }, { status: 400 });
    }
  } else {
    const live = isValidLiveUrl(repoUrl);
    if (!live.ok) {
      return NextResponse.json({ error: 'invalid_target_url', detail: live.error }, { status: 400 });
    }
  }

  // Skill: minimal 1, semua harus dikenal & sesuai jenis target.
  let skills: string[] = [];
  if (Array.isArray(body.skills)) {
    skills = body.skills.filter((s): s is string => typeof s === 'string');
  }
  if (skills.length === 0) {
    return NextResponse.json({ error: 'invalid_skills' }, { status: 400 });
  }
  for (const s of skills) {
    const def = getSkill(s);
    if (!def) return NextResponse.json({ error: 'unknown_skill', detail: s }, { status: 400 });
    if (targetType === 'url' && def.requiresRepo) {
      return NextResponse.json({ error: 'skill_requires_repo', detail: s }, { status: 400 });
    }
  }

  // Interval: 30 menit — 30 hari.
  let intervalMinutes = 1440;
  if (body.intervalMinutes !== undefined && body.intervalMinutes !== null) {
    const n = Number(body.intervalMinutes);
    if (!Number.isInteger(n) || n < 30 || n > 43200) {
      return NextResponse.json({ error: 'invalid_interval' }, { status: 400 });
    }
    intervalMinutes = n;
  }

  // Opsi pipeline.
  const validate = body.validate === true ? 1 : 0;
  const autoFix = body.autoFix === true && targetType === 'github' ? 1 : 0;
  let diffBase: string | null = null;
  if (targetType === 'github' && typeof body.diffBase === 'string' && body.diffBase.trim()) {
    if (!isValidDiffBase(body.diffBase.trim())) {
      return NextResponse.json({ error: 'invalid_diff_base' }, { status: 400 });
    }
    diffBase = body.diffBase.trim();
  }

  let instructions: string | null = null;
  if (typeof body.instructions === 'string') {
    const t = body.instructions.trim();
    if (t.length > 4000) return NextResponse.json({ error: 'instructions_too_long' }, { status: 400 });
    if (t) instructions = t.replace(/\r?\n/g, ' ');
  }

  const schedule = createSchedule({
    name,
    repo_url: repoUrl,
    branch: typeof body.branch === 'string' && body.branch.trim() ? body.branch.trim() : 'main',
    target_type: targetType,
    skills_json: JSON.stringify(skills),
    depth: typeof body.depth === 'string' ? body.depth : 'medium',
    instructions,
    validate,
    auto_fix: autoFix,
    diff_base: diffBase,
    interval_minutes: intervalMinutes,
  });
  return NextResponse.json({ schedule }, { status: 201 });
});
