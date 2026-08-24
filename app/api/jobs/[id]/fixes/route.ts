import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { withAuth } from '@/lib/require-auth';
import { getJob } from '@/lib/db';

/**
 * GET /api/jobs/[id]/fixes.patch — unduh patch hasil auto-fix.
 * Hanya bila job terminal (done) dan patch ada di report dir.
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
  // Patch disimpan di <REPORT_DIR>/<jobId>/fixes.patch oleh worker.
  const reportDir = process.env.REPORT_DIR ?? '/var/lib/secscan/reports';
  const patchPath = path.join(reportDir, id, 'fixes.patch');
  if (!fs.existsSync(patchPath)) {
    return NextResponse.json({ error: 'no_patch' }, { status: 404 });
  }
  const data = fs.readFileSync(patchPath, 'utf8');
  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type': 'text/x-diff; charset=utf-8',
      'Content-Disposition': `attachment; filename="secscan-${id.slice(0, 8)}-fixes.patch"`,
    },
  });
});
