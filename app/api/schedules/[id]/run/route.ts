import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/require-auth';
import { getSchedule, updateSchedule } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/schedules/[id]/run — jalankan sekarang.
 * Set last_run_at jauh di masa lalu sehingga tick scheduler berikutnya
 * (maks 60 detik) menjalankan job-nya lewat jalur normal (clone+enqueue).
 */
export const POST = withAuth(async (_req: Request, ctx) => {
  const { id } = await ctx!.params;
  if (typeof id !== 'string' || id.length === 0) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }
  const schedule = getSchedule(id);
  if (!schedule) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!schedule.enabled) {
    return NextResponse.json({ error: 'schedule_disabled' }, { status: 409 });
  }
  // Paksa jatuh tempo: last_run_at = 1 hari lalu (interval maks 30 hari,
  // tapi 1 hari lalu aman karena interval ≥30m; edge: interval 43200m —
  // pakai epoch supaya pasti due).
  updateSchedule(id, { last_run_at: 0, updated_at: Date.now() });
  return NextResponse.json({ ok: true, note: 'job akan dijalankan scheduler dalam ≤60 detik' });
});
