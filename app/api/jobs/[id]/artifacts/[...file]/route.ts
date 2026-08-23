import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { withAuth } from '@/lib/require-auth';
import { getJob } from '@/lib/db';

const REPORT_DIR = process.env.REPORT_DIR ?? '/var/lib/secscan/reports';

const MIME_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export const GET = withAuth(async (_req: Request, ctx) => {
  const params = (await ctx!.params) as unknown as { id: string; file?: string[] };
  const { id, file } = params;

  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (!Array.isArray(file) || file.length === 0) {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
  }

  const jobRoot = path.resolve(REPORT_DIR, id);
  const requested = path.resolve(jobRoot, ...file);

  // Anti path-traversal: hasil resolve harus tetap di dalam <REPORT_DIR>/<id>/
  if (requested !== jobRoot && !requested.startsWith(jobRoot + path.sep)) {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(requested);
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (!stat.isFile()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ext = path.extname(requested).toLowerCase();
  const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  const filename = path.basename(requested);

  const nodeStream = fs.createReadStream(requested);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});
