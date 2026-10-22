/**
 * lib/target.ts — validasi target scan: repo GitHub publik atau URL live.
 *
 * URL live = aplikasi yang sedang berjalan (black-box). Karena worker akan
 * mengirim permintaan jaringan nyata ke host tersebut, URL validator ini
 * juga bertugas sebagai lapisan anti-SSRF pertama:
 *   - wajib http/https, host wajib hostname publik (bukan IP literal)
 *   - tolak host local/loopback/internal & port portabel berbahaya
 *   - batasi panjang
 *
 * (Lapisan kedua ada di prompt worker: hanya tools di-safe-mode Hermes
 *  yang boleh dipakai.)
 */

const MAX_URL_LENGTH = 2048;

// Port yang jelas-jelas infrastruktur internal — tolak sejak awal.
const BLOCKED_PORTS = new Set([
  '22', // ssh
  '23', // telnet
  '25', // smtp
  '135', // msrpc
  '139', '445', // samba
  '3306', // mysql
  '5432', // postgres
  '6379', // redis
  '8001', // cognee (internal vps2)
  '8080', // alt http internal umum
  '9200', // elasticsearch
  '27017', // mongodb
]);

// Bentuk IP literal IPv4/IPv6 sederhana (untuk deteksi host berbasis IP).
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  'metadata.google.internal',
  '169.254.169.254',
];

export interface UrlValidation {
  ok: boolean;
  error?: string;
  detail?: string;
  normalized?: string;
  resolvedIps?: string[];
}

import { checkSafeDns } from './dns-check';

export async function validateLiveUrlWithDns(raw: string): Promise<UrlValidation> {
  const syncCheck = isValidLiveUrl(raw);
  if (!syncCheck.ok) return syncCheck;

  try {
    const u = new URL(syncCheck.normalized!);
    const dnsCheck = await checkSafeDns(u.hostname);
    if (!dnsCheck.ok) {
      return {
        ok: false,
        error: dnsCheck.error ?? 'dns_check_failed',
        detail: dnsCheck.reason,
      };
    }
    return {
      ok: true,
      normalized: syncCheck.normalized,
      resolvedIps: dnsCheck.addresses,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: 'dns_check_failed', detail: message };
  }
}


export function isValidLiveUrl(raw: string): UrlValidation {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, error: 'empty' };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, error: 'too_long' };

  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'invalid_url' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'bad_scheme' };
  }
  if (u.username || u.password) return { ok: false, error: 'userpass' };
  if (!u.hostname) return { ok: false, error: 'no_host' };

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.lan')) {
    return { ok: false, error: 'internal_host' };
  }
  if (BLOCKED_HOSTS.includes(host)) return { ok: false, error: 'blocked_host' };

  // Tolak host berupa IP literal (v4 maupun v6 bentuk sederhana) —
  // target live harus domain publik yang resolve ke publik.
  if (IPV4_RE.test(host)) return { ok: false, error: 'ip_literal' };
  if (host.includes(':')) return { ok: false, error: 'ip_literal' };

  if (u.port && BLOCKED_PORTS.has(u.port)) {
    return { ok: false, error: 'blocked_port' };
  }

  return { ok: true, normalized: u.toString() };
}
