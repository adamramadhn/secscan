// Smoke test pemetaan kepatuhan OWASP (lib/compliance.ts).
process.env.DB_PATH = '/tmp/test-secscan-compliance.db';
import {
  buildCompliance,
  mapFindingToControls,
  OWASP_TOP10,
  renderComplianceReport,
  UNMAPPED,
} from '../lib/compliance';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`PASS: ${name}`);
  } else {
    fail++;
    console.log(`FAIL: ${name}`);
  }
}

// ——— Pemetaan tunggal ———
const hsts = mapFindingToControls({ title: 'HSTS tidak aktif', description: 'Header Strict-Transport-Security tidak dikirim' });
check('HSTS → A02 (crypto)', hsts.some((c) => c.id === 'A02:2021'));

const csp = mapFindingToControls({ title: 'Tidak ada Content-Security-Policy', description: null });
check('CSP → A05 (misconfig)', csp.some((c) => c.id === 'A05:2021'));

const dep = mapFindingToControls({ title: 'Dependency tidak terkunci (lockfile out-of-date)', description: 'package-lock.json tertinggal' });
check('lockfile → A06 (outdated)', dep.some((c) => c.id === 'A06:2021'));

const gate = mapFindingToControls({ title: 'Cakupan public-safety gate tidak lengkap', description: 'Gerbang case-sensitive bisa bypass' });
check('gate → A01 atau A03', gate.some((c) => c.id === 'A01:2021' || c.id === 'A03:2021'));

const mirror = mapFindingToControls({ title: 'Mirror npm HTTP', description: 'registry via http:// tidak signed' });
check('mirror http → A08 (integrity)', mirror.some((c) => c.id === 'A08:2021'));

const unknown = mapFindingToControls({ title: 'Warna kontras rendah', description: 'aksibilitas visual' });
check('temuan tak terpetakan → kosong', unknown.length === 0);

// ——— Ringkasan ———
const findings = [
  { id: 1, severity: 'Medium', title: 'HSTS tidak aktif', description: null },
  { id: 2, severity: 'Low', title: 'Tidak ada Content-Security-Policy', description: null },
  { id: 3, severity: 'High', title: 'Cakupan public-safety gate tidak lengkap', description: 'bypass case-sensitive' },
  { id: 4, severity: 'Info', title: 'Warna kontras rendah', description: 'aksibilitas' },
  { id: 5, severity: 'Low', title: 'Tidak ada logging aktivitas admin', description: null },
];
const s = buildCompliance(findings);
check('total = 5', s.totalFindings === 5);
check('items >= 3 kategori', s.items.length >= 3);
const a01 = s.items.find((i) => i.controlId === 'A01:2021');
check('A01 ada dgn 1 temuan High', a01?.count === 1 && a01?.maxSeverity === 'High');
const lain = s.items.find((i) => i.controlId === UNMAPPED.id);
check('LAINNYA menampung kontras', lain?.count === 1);
check('urut severity maks turun', (s.items[0]?.maxSeverity === 'High'));

// ——— Render markdown ———
const md = renderComplianceReport(
  { repo_url: 'https://github.com/x/y', branch: 'main', target_type: 'github', created_at: Date.now(), severity_counts: null },
  findings.map((f) => ({ ...f, location: null, recommendation: null, validation_status: null })),
  s,
);
check('report ada judul OWASP', md.includes('OWASP Top 10 (2021)'));
check('report ada tabel ringkasan', md.includes('## Ringkasan per Kategori'));
check('report menyebut kategori kosong', md.includes('⚪ Tidak ada temuan terpetakan'));
check('report menyebut target', md.includes('https://github.com/x/y'));
check('report menyebut disclaimer', md.includes('indikatif'));

console.log(`\n${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);