process.env.DB_PATH = ':memory:';

import { inspectHttpHeaders } from '../lib/web-check';

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
  console.log('--- Test Insecure Headers (Default Plain Response) ---');
  const badHeaders = {
    'content-type': 'text/html; charset=UTF-8',
    'server': 'Apache/2.4.41 (Ubuntu)',
    'x-powered-by': 'Express',
  };

  const findings = inspectHttpHeaders({
    url: 'https://example.com/',
    statusCode: 200,
    headers: badHeaders,
  });

  check('Detects missing HSTS', findings.some((f) => f.title.includes('Strict-Transport-Security')));
  check('Detects missing CSP', findings.some((f) => f.title.includes('Content-Security-Policy')));
  check('Detects missing X-Frame-Options', findings.some((f) => f.title.includes('X-Frame-Options')));
  check('Detects missing X-Content-Type-Options', findings.some((f) => f.title.includes('X-Content-Type-Options')));
  check('Detects technology banner disclosure', findings.some((f) => f.title.includes('Information Disclosure')));

  const hstsFinding = findings.find((f) => f.title.includes('Strict-Transport-Security'));
  check('Finding has source_tool = passive-web', hstsFinding?.source_tool === 'passive-web');
  check('Finding has confidence = high', hstsFinding?.confidence === 'high');
  check('Finding has validation_status = confirmed', hstsFinding?.validation_status === 'confirmed');
  check('Finding includes CWE-319', hstsFinding?.cwe_id === 'CWE-319');
  check('Finding has concrete evidence string', (hstsFinding?.validation_evidence?.length ?? 0) > 0);

  console.log('--- Test Hardened Headers (Secure Response) ---');
  const goodHeaders = {
    'content-type': 'text/html; charset=UTF-8',
    'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
    'content-security-policy': "default-src 'self'",
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  };

  const cleanFindings = inspectHttpHeaders({
    url: 'https://example.com/',
    statusCode: 200,
    headers: goodHeaders,
  });

  check('No security header findings on properly configured site', cleanFindings.length === 0, cleanFindings);

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
