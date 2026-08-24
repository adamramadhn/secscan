import { NextResponse } from 'next/server';
import fs from 'fs';
import { getJobByShareToken } from '@/lib/db';

/**
 * GET /api/share/[token]/report — download report.md tanpa login (token-based).
 * Link ini dimaksudkan untuk dibagikan; token = capability.
 */
export const GET = async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const job = getJobByShareToken(token);
  if (!job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!job.report_path) {
    return NextResponse.json({ error: 'no_report' }, { status: 404 });
  }
  let content: Buffer;
  try {
    content = fs.readFileSync(job.report_path);
  } catch {
    return NextResponse.json({ error: 'no_report' }, { status: 404 });
  }
  return new Response(new Uint8Array(content), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `inline; filename="report-${job.id}.md"`,
    },
  });
};
