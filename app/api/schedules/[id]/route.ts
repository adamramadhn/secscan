import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/require-auth';
import { getSchedule, updateSchedule, deleteSchedule } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/schedules/[id] — toggle enabled / ubah interval / nama. */
export const PATCH = withAuth(async (req: Request, ctx) => {
  const { id } = await ctx!.params;
  if (typeof id !== 'string' || id.length === 0) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }
  const existing = getSchedule(id);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled ? 1 : 0;
  if (typeof body.name === 'string' && body.name.trim() && body.name.trim().length <= 120) {
    patch.name = body.name.trim();
  }
  if (body.intervalMinutes !== undefined) {
    const n = Number(body.intervalMinutes);
    if (!Number.isInteger(n) || n < 30 || n > 43200) {
      return NextResponse.json({ error: 'invalid_interval' }, { status: 400 });
    }
    patch.interval_minutes = n;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
  }
  patch.updated_at = Date.now();

  const schedule = updateSchedule(id, patch);
  return NextResponse.json({ schedule });
});

/** DELETE /api/schedules/[id] — hapus jadwal (job lama tetap ada). */
export const DELETE = withAuth(async (_req: Request, ctx) => {
  const { id } = await ctx!.params;
  if (typeof id !== 'string' || id.length === 0) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }
  const existing = getSchedule(id);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  deleteSchedule(id);
  return NextResponse.json({ ok: true });
});
