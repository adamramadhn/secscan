process.env.DB_PATH = ':memory:';

import { mapFindingToControls, buildCompliance, renderComplianceReport } from '../lib/compliance';

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
  console.log('--- Test Structured CWE Mapping ---');
  const xssFinding = { title: 'XSS vulnerability in search', cwe_id: 'CWE-79' };
  const xssControls = mapFindingToControls(xssFinding);
  check('CWE-79 maps to A03:2021 Injection', xssControls.length > 0 && xssControls[0].id === 'A03:2021');

  const hstsFinding = { title: 'Missing security header', cwe_id: 'CWE-319' };
  const hstsControls = mapFindingToControls(hstsFinding);
  check('CWE-319 maps to A02:2021 Cryptographic Failures', hstsControls.length > 0 && hstsControls[0].id === 'A02:2021');

  const clickjackFinding = { title: 'Missing X-Frame-Options', cwe_id: 'CWE-1021' };
  const clickjackControls = mapFindingToControls(clickjackFinding);
  check('CWE-1021 maps to A05:2021 Security Misconfiguration', clickjackControls.length > 0 && clickjackControls[0].id === 'A05:2021');

  const secretFinding = { title: 'Hardcoded API secret', cwe_id: 'CWE-798' };
  const secretControls = mapFindingToControls(secretFinding);
  check('CWE-798 maps to A02:2021 Cryptographic Failures', secretControls.length > 0 && secretControls[0].id === 'A02:2021');

  const ssrfFinding = { title: 'Internal server call', cwe_id: 'CWE-918' };
  const ssrfControls = mapFindingToControls(ssrfFinding);
  check('CWE-918 maps to A10:2021 SSRF', ssrfControls.length > 0 && ssrfControls[0].id === 'A10:2021');

  const traversalFinding = { title: 'Directory listing / file read', cwe_id: 'CWE-22' };
  const traversalControls = mapFindingToControls(traversalFinding);
  check('CWE-22 maps to A01:2021 Broken Access Control', traversalControls.length > 0 && traversalControls[0].id === 'A01:2021');

  console.log('--- Test CVE Mapping ---');
  const cveFinding = { title: 'axios vulnerability', cve_id: 'CVE-2023-45853' };
  const cveControls = mapFindingToControls(cveFinding);
  check('cve_id maps directly to A06:2021 Vulnerable Components', cveControls.length > 0 && cveControls[0].id === 'A06:2021');

  const cveInTitle = { title: 'Vulnerability CVE-2021-23337 in lodash' };
  const cveTitleControls = mapFindingToControls(cveInTitle);
  check('CVE in title pattern maps to A06:2021', cveTitleControls.length > 0 && cveTitleControls[0].id === 'A06:2021');

  console.log('--- Test Keyword Fallback ---');
  const keywordFinding = { title: 'Insecure session cookie without encryption' };
  const kwControls = mapFindingToControls(keywordFinding);
  check('Keyword fallback works for un-annotated finding', kwControls.length > 0);

  console.log('--- Test buildCompliance & renderComplianceReport ---');
  const summary = buildCompliance([
    { id: 1, title: 'Reflected XSS', cwe_id: 'CWE-79', severity: 'High' },
    { id: 2, title: 'Outdated package', cve_id: 'CVE-2023-1234', severity: 'Medium' },
    { id: 3, title: 'Missing CSP', cwe_id: 'CWE-1021', severity: 'Low' },
  ]);
  check('buildCompliance aggregates 3 findings', summary.totalFindings === 3);
  check('summary has categorized items', summary.items.length >= 2);

  const report = renderComplianceReport(
    { repo_url: 'https://github.com/example/repo', branch: 'main', target_type: 'github', created_at: Date.now() },
    [
      { id: 1, title: 'Reflected XSS', cwe_id: 'CWE-79', severity: 'High' },
      { id: 2, title: 'Outdated package', cve_id: 'CVE-2023-1234', severity: 'Medium' },
      { id: 3, title: 'Missing CSP', cwe_id: 'CWE-1021', severity: 'Low' },
    ],
    summary
  );
  check('renderComplianceReport mentions OWASP Top 10', report.includes('OWASP Top 10 (2021)'));
  check('renderComplianceReport includes CWE info in detail', report.includes('CWE-79'));

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
