import { NextResponse } from 'next/server';
import { getJobByShareToken } from '@/lib/db';

/**
 * GET /api/share/[token]
 * Akses report job via token (tanpa login) — untuk membagikan laporan.
 * Hanya mengekspos report.md; tidak membuka data job lain.
 */
export const GET = async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const job = getJobByShareToken(token);
  if (!job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({
    job: {
      id: job.id,
      repo_url: job.repo_url,
      branch: job.branch,
      depth: job.depth,
      status: job.status,
      severity_counts: job.severity_counts,
      created_at: job.created_at,
    },
    share_token: job.share_token,
  });
};
