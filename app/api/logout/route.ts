import { NextResponse } from 'next/server';
import { SESSION_COOKIE, destroySession } from '@/lib/auth';
import { addAudit } from '@/lib/db';

export async function POST(req: Request) {
  // Baca cookie secscan_session dari header request.
  const header = req.headers.get('cookie') ?? '';
  let token: string | undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SESSION_COOKIE) token = rest.join('=');
  }

  if (token) {
    destroySession(token);
  }

  addAudit('logout', '');

  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
