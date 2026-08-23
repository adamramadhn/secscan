import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';

/**
 * Tipe konteks route handler Next 15 (params adalah Promise).
 * Dibuat longgar agar wrapper kompatibel dengan route dinamis
 * (app/api/.../[x]/route.ts) maupun route statis tanpa params.
 */
export type RouteCtx = { params: Promise<Record<string, string>> } | undefined;

export function withAuth(
  handler: (req: Request, ctx: RouteCtx) => Promise<Response>,
): (req: Request, ctx?: any) => Promise<Response> {
  return async (req: Request, ctx?: any): Promise<Response> => {
    const ok = await requireSession(req);
    if (!ok) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return handler(req, ctx as RouteCtx);
  };
}
