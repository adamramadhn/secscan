process.env.DB_PATH = ':memory:';

import { isPrivateOrBlockedIp, checkSafeDns } from '../lib/dns-check';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  PASS: ${name}`);
    pass++;
  } else {
    console.error(`  FAIL: ${name}`, extra ?? '');
    fail++;
  }
}

async function run() {
  console.log('--- Test isPrivateOrBlockedIp (IPv4) ---');
  check('127.0.0.1 is blocked (loopback)', isPrivateOrBlockedIp('127.0.0.1').blocked);
  check('127.1.2.3 is blocked (loopback /8)', isPrivateOrBlockedIp('127.1.2.3').blocked);
  check('10.0.0.1 is blocked (RFC1918 10/8)', isPrivateOrBlockedIp('10.0.0.1').blocked);
  check('172.16.0.1 is blocked (RFC1918 172.16/12)', isPrivateOrBlockedIp('172.16.0.1').blocked);
  check('172.31.255.254 is blocked (RFC1918 172.16/12)', isPrivateOrBlockedIp('172.31.255.254').blocked);
  check('172.32.0.1 is NOT blocked (outside 172.16/12)', !isPrivateOrBlockedIp('172.32.0.1').blocked);
  check('192.168.1.1 is blocked (RFC1918 192.168/16)', isPrivateOrBlockedIp('192.168.1.1').blocked);
  check('169.254.169.254 is blocked (link-local/cloud metadata)', isPrivateOrBlockedIp('169.254.169.254').blocked);
  check('100.64.0.1 is blocked (CGNAT)', isPrivateOrBlockedIp('100.64.0.1').blocked);
  check('100.127.255.254 is blocked (CGNAT)', isPrivateOrBlockedIp('100.127.255.254').blocked);
  check('100.128.0.1 is NOT blocked (outside CGNAT)', !isPrivateOrBlockedIp('100.128.0.1').blocked);
  check('0.0.0.0 is blocked (unspecified)', isPrivateOrBlockedIp('0.0.0.0').blocked);
  check('255.255.255.255 is blocked (broadcast)', isPrivateOrBlockedIp('255.255.255.255').blocked);
  check('8.8.8.8 is NOT blocked (public Google DNS)', !isPrivateOrBlockedIp('8.8.8.8').blocked);
  check('1.1.1.1 is NOT blocked (public Cloudflare DNS)', !isPrivateOrBlockedIp('1.1.1.1').blocked);

  console.log('--- Test isPrivateOrBlockedIp (IPv6) ---');
  check('::1 is blocked (IPv6 loopback)', isPrivateOrBlockedIp('::1').blocked);
  check(':: is blocked (IPv6 unspecified)', isPrivateOrBlockedIp('::').blocked);
  check('fc00::1 is blocked (IPv6 ULA)', isPrivateOrBlockedIp('fc00::1').blocked);
  check('fd12:3456::1 is blocked (IPv6 ULA)', isPrivateOrBlockedIp('fd12:3456::1').blocked);
  check('fe80::1 is blocked (IPv6 link-local)', isPrivateOrBlockedIp('fe80::1').blocked);
  check('::ffff:127.0.0.1 is blocked (IPv4-mapped loopback)', isPrivateOrBlockedIp('::ffff:127.0.0.1').blocked);
  check('::ffff:192.168.0.1 is blocked (IPv4-mapped private)', isPrivateOrBlockedIp('::ffff:192.168.0.1').blocked);
  check('::ffff:8.8.8.8 is NOT blocked (IPv4-mapped public)', !isPrivateOrBlockedIp('::ffff:8.8.8.8').blocked);

  console.log('--- Test checkSafeDns ---');
  const localhostCheck = await checkSafeDns('localhost');
  check('localhost resolves to blocked IP', !localhostCheck.ok && localhostCheck.error === 'blocked_ip');

  const cloudflareCheck = await checkSafeDns('one.one.one.one');
  check('one.one.one.one resolves to valid public IP', cloudflareCheck.ok && (cloudflareCheck.addresses?.length ?? 0) > 0);

  const nonExistentCheck = await checkSafeDns('this-domain-definitely-does-not-exist-xyz-12345.com');
  check('Non-existent domain fails DNS resolution safely', !nonExistentCheck.ok && nonExistentCheck.error === 'dns_resolution_failed');

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
