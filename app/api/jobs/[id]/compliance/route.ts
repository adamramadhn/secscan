import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/require-auth';
import { getJob, getJobFindings } from '@/lib/db';
import { buildCompliance, renderComplianceReport } from '@/lib/compliance';

/**
 * GET /api/jobs/[id]/compliance — unduh laporan kepatuhan OWASP Top 10 (markdown).
 * Dihitung on-demand dari findings; hanya job terminal.
 */
export const GET = withAuth(async (_req: Request, ctx) => {
  const { id } = await ctx!.params;
  if (typeof id !== 'string' || id.length === 0) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (job.status !== 'done') {
    return NextResponse.json({ error: 'job_not_done' }, { status: 409 });
  }
  const findings = getJobFindings(id);
  const summary = buildCompliance(findings);
  const md = renderComplianceReport(job, findings, summary);
  return new NextResponse(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="compliance-${id.slice(0, 8)}.md"`,
    },
  });
});
