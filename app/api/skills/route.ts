import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/require-auth';
import { SKILLS, SKILL_GROUPS } from '@/lib/skills';

export const GET = withAuth(async (_req: Request) => {
  return NextResponse.json({ skills: SKILLS, groups: SKILL_GROUPS });
});