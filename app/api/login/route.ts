import { NextResponse } from 'next/server';
import { verifyPassword } from '@/lib/password';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSession,
  rateLimit,
  recordFailure,
  clientKeyFromRequest,
  auditLoginOk,
} from '@/lib/auth';
import { addAudit } from '@/lib/db';

export async function POST(req: Request) {
  const key = clientKeyFromRequest(req);

  if (!rateLimit(key)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let password = '';
  try {
    const body = (await req.json()) as { password?: unknown };
    if (typeof body.password === 'string') password = body.password;
  } catch {
    // body tidak valid → dianggap password kosong → gagal verifikasi
  }

  if (password.length === 0 || !verifyPassword(password)) {
    recordFailure(key);
    addAudit('login', 'failed');
    return NextResponse.json({ error: 'invalid' }, { status: 401 });
  }

  const token = createSession();
  auditLoginOk();

  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
