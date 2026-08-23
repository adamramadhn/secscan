import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/require-auth';
import { getJob, getJobSkills } from '@/lib/db';

export const GET = withAuth(async (_req: Request, ctx) => {
  const { id } = await ctx!.params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let skillsParsed: unknown = [];
  try {
    skillsParsed = JSON.parse(job.skills_json);
  } catch {
    skillsParsed = [];
  }

  return NextResponse.json({ job: { ...job, skills: skillsParsed }, jobSkills: getJobSkills(id) });
});
