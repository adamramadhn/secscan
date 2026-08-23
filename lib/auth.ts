import { v4 as uuidv4 } from 'uuid';
import { cookies } from 'next/headers';
import { getDb, initDb, addAudit } from '@/lib/db';

export const SESSION_COOKIE = 'secscan_session';
export const SESSION_MAX_AGE = 86400; // 1 hari (detik)
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari

interface RateEntry {
  count: number;
  firstAt: number;
  lockedUntil: number;
}

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_FAILURES = 5;
const rateBuckets = new Map<string, RateEntry>();

function clientKey(req: Request): string {
  // x-real-ip diset oleh nginx kita (bisa dipercaya). Fallback: entry TERAKHIR
  // x-forwarded-for (yang ditambahkan proxy tepercaya kita), BUKAN entry pertama
  // (entry pertama bisa dipalsukan client untuk bypass rate limit).
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const parts = fwd.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return 'unknown';
}

/**
 * Inisialisasi DB sekali saat modul auth pertama kali diimport.
 */
initDb();

export function createSession(): string {
  const db = getDb();
  const token = uuidv4();
  db.prepare('INSERT INTO sessions (token, created_at) VALUES (?, ?)').run(token, Date.now());
  return token;
}

export function validateSession(token: string): boolean {
  const db = getDb();
  // Cleanup ringan: hapus session berumur > 7 hari.
  db.prepare('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - SESSION_TTL_MS);
  const row = db.prepare('SELECT token FROM sessions WHERE token = ?').get(token);
  return Boolean(row);
}

export function destroySession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export async function requireSession(req: Request): Promise<boolean> {
  const header = req.headers.get('cookie') ?? '';
  let token: string | undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SESSION_COOKIE) token = rest.join('=');
  }
  if (!token) {
    const fromCookiesApi = (await cookies()).get(SESSION_COOKIE)?.value;
    token = fromCookiesApi;
  }
  if (!token) return false;
  return validateSession(token);
}

/**
 * Rate limiter in-memory: maksimal 5 percobaan gagal per 15 menit per key.
 * Return true jika key masih boleh mencoba.
 */
export function rateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateBuckets.get(key);
  if (!entry) return true;
  if (entry.lockedUntil > now) return false;
  if (now - entry.firstAt > RATE_WINDOW_MS) return true; // window reset
  return true;
}

export function recordFailure(key: string): void {
  const now = Date.now();
  const entry = rateBuckets.get(key);
  if (!entry || now - entry.firstAt > RATE_WINDOW_MS) {
    rateBuckets.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
    return;
  }
  entry.count += 1;
  if (entry.count >= RATE_MAX_FAILURES) {
    entry.lockedUntil = now + RATE_WINDOW_MS;
  }
}

export function clientKeyFromRequest(req: Request): string {
  return clientKey(req);
}

export function auditLoginOk(): void {
  addAudit('login', 'ok');
}
