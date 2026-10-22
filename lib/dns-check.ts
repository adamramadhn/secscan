import dns from 'node:dns/promises';
import net from 'node:net';

export interface IpCheckResult {
  blocked: boolean;
  reason?: string;
}

export interface DnsCheckResult {
  ok: boolean;
  error?: string;
  reason?: string;
  addresses?: string[];
}

/**
 * Memeriksa apakah suatu alamat IP (v4 atau v6) termasuk dalam kategori
 * alamat privat, loopback, link-local, CGNAT, atau rentang terlarang lainnya.
 */
export function isPrivateOrBlockedIp(ip: string): IpCheckResult {
  const cleanIp = ip.trim().toLowerCase();

  // Handle IPv4-mapped IPv6 (::ffff:192.0.2.128 atau ::ffff:7f00:1)
  if (cleanIp.startsWith('::ffff:')) {
    const rest = cleanIp.slice(7);
    if (net.isIPv4(rest)) {
      return isPrivateOrBlockedIp(rest);
    }
  }

  const family = net.isIP(cleanIp);
  if (family === 4) {
    const parts = cleanIp.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return { blocked: true, reason: 'invalid_ipv4_format' };
    }

    const [a, b] = parts;

    // Loopback 127.0.0.0/8
    if (a === 127) {
      return { blocked: true, reason: 'loopback_ipv4' };
    }

    // RFC 1918 Private ranges:
    // 10.0.0.0/8
    if (a === 10) {
      return { blocked: true, reason: 'private_rfc1918_10' };
    }
    // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) {
      return { blocked: true, reason: 'private_rfc1918_172' };
    }
    // 192.168.0.0/16
    if (a === 192 && b === 168) {
      return { blocked: true, reason: 'private_rfc1918_192' };
    }

    // Link-local / Cloud metadata: 169.254.0.0/16
    if (a === 169 && b === 254) {
      return { blocked: true, reason: 'link_local_169_254' };
    }

    // CGNAT RFC 6598: 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
    if (a === 100 && b >= 64 && b <= 127) {
      return { blocked: true, reason: 'cgnat_rfc6598' };
    }

    // Current network / Zero: 0.0.0.0/8
    if (a === 0) {
      return { blocked: true, reason: 'unspecified_zero_ipv4' };
    }

    // Broadcast: 255.255.255.255
    if (cleanIp === '255.255.255.255') {
      return { blocked: true, reason: 'broadcast_ipv4' };
    }

    // Documentation / Test ranges:
    // 192.0.2.0/24 (TEST-NET-1), 198.51.100.0/24 (TEST-NET-2), 203.0.113.0/24 (TEST-NET-3)
    if (a === 192 && b === 0 && parts[2] === 2) {
      return { blocked: true, reason: 'documentation_ipv4' };
    }
    if (a === 198 && b === 51 && parts[2] === 100) {
      return { blocked: true, reason: 'documentation_ipv4' };
    }
    if (a === 203 && b === 0 && parts[2] === 113) {
      return { blocked: true, reason: 'documentation_ipv4' };
    }

    // Multicast (224.0.0.0/4) & Reserved (240.0.0.0/4)
    if (a >= 224) {
      return { blocked: true, reason: 'multicast_or_reserved_ipv4' };
    }

    return { blocked: false };
  }

  if (family === 6) {
    // Loopback ::1
    if (cleanIp === '::1') {
      return { blocked: true, reason: 'loopback_ipv6' };
    }

    // Unspecified ::
    if (cleanIp === '::' || cleanIp === '0:0:0:0:0:0:0:0') {
      return { blocked: true, reason: 'unspecified_ipv6' };
    }

    // Unique Local Address (ULA) fc00::/7 (fc00:: - fdff::)
    if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) {
      return { blocked: true, reason: 'unique_local_ipv6' };
    }

    // Link-local unicast fe80::/10 (fe80:: - febf::)
    if (/^fe[89ab]/i.test(cleanIp)) {
      return { blocked: true, reason: 'link_local_ipv6' };
    }

    // Multicast ff00::/8
    if (cleanIp.startsWith('ff')) {
      return { blocked: true, reason: 'multicast_ipv6' };
    }

    // Documentation 2001:db8::/32
    if (cleanIp.startsWith('2001:db8:') || cleanIp.startsWith('2001:0db8:')) {
      return { blocked: true, reason: 'documentation_ipv6' };
    }

    return { blocked: false };
  }

  return { blocked: true, reason: 'not_an_ip' };
}

/**
 * Melakukan resolusi DNS terhadap hostname target dan memastikan
 * semua alamat IP yang dihasilkan merupakan IP publik (bukan privat/loopback).
 */
export async function checkSafeDns(hostname: string): Promise<DnsCheckResult> {
  const cleanHost = hostname.trim().toLowerCase();

  // Jika hostname itu sendiri adalah literal IP, langsung periksa
  if (net.isIP(cleanHost)) {
    const check = isPrivateOrBlockedIp(cleanHost);
    if (check.blocked) {
      return {
        ok: false,
        error: 'blocked_ip',
        reason: check.reason,
        addresses: [cleanHost],
      };
    }
    return { ok: true, addresses: [cleanHost] };
  }

  try {
    const resolved = await dns.lookup(cleanHost, { all: true });
    if (!resolved || resolved.length === 0) {
      return { ok: false, error: 'dns_resolution_failed', reason: 'no_addresses' };
    }

    const addresses = resolved.map((r) => r.address);
    for (const addr of addresses) {
      const check = isPrivateOrBlockedIp(addr);
      if (check.blocked) {
        return {
          ok: false,
          error: 'blocked_ip',
          reason: `Resolved IP ${addr} is prohibited: ${check.reason}`,
          addresses,
        };
      }
    }

    return { ok: true, addresses };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: 'dns_resolution_failed',
      reason: message,
    };
  }
}
