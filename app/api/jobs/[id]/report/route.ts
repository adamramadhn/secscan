import { NextResponse } from 'next/server';
import fs from 'fs';
import { withAuth } from '@/lib/require-auth';
import { getJob } from '@/lib/db';

const REPORT_DIR = process.env.REPORT_DIR ?? '/var/lib/secscan/reports';

export const GET = withAuth(async (_req: Request, ctx) => {
  const { id } = await ctx!.params;
  const job = getJob(id);
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
      'Content-Disposition': `attachment; filename="report-${id}.md"`,
    },
  });
});
