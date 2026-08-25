/**
 * Pemetaan temuan → kontrol OWASP Top 10 (2021) untuk laporan kepatuhan.
 * Mapping berbasis keyword (judul + deskripsi, case-insensitive).
 */

export interface OwaspControl {
  id: string;
  name: string;
  keywords: string[];
}

export const OWASP_TOP10: OwaspControl[] = [
  {
    id: 'A01:2021',
    name: 'Broken Access Control',
    keywords: [
      'akses', 'access control', 'otorisasi', 'authorization', 'unauthorized', 'idor',
      'privilege', 'privilige', 'bypass', 'case-sensitive', 'gerbang', 'gate', 'public-safety',
      'path traversal', 'directory traversal', 'exposure', 'ter-ekspos', 'ekspos',
    ],
  },
  {
    id: 'A02:2021',
    name: 'Cryptographic Failures',
    keywords: [
      'kripto', 'crypto', 'tls', 'ssl', 'hsts', 'sertifikat', 'certificate', 'https',
      'hash', 'md5', 'sha1', 'enkripsi', 'encryption', 'plaintext', 'secret', 'kredensial',
      'password', 'token', 'api key',
    ],
  },
  {
    id: 'A03:2021',
    name: 'Injection',
    keywords: [
      'injection', 'xss', 'cross-site', 'sql', 'nosql', 'ssti', 'command injection',
      'code injection', 'template', 'eval', 'render', 'escape', 'sanitize', 'html', 'markdown',
    ],
  },
  {
    id: 'A04:2021',
    name: 'Insecure Design',
    keywords: [
      'desain', 'design', 'threat model', 'abuse case', 'rate limit', 'throttl',
      'validasi input', 'input validation', 'sanitasi', 'soft-404', '404',
      'arsitektur', 'architecture', 'business logic', 'logic flaw',
    ],
  },
  {
    id: 'A05:2021',
    name: 'Security Misconfiguration',
    keywords: [
      'konfigurasi', 'configuration', 'misconfig', 'header', 'csp', 'content-security',
      'x-frame', 'x-content-type', 'referrer-policy', 'server:', 'server banner',
      'server_tokens', 'verbose', 'debug', 'default credential', 'directory listing',
      'hardening', 'permissions', 'izin file', 'file permission', 'world-writable',
    ],
  },
  {
    id: 'A06:2021',
    name: 'Vulnerable and Outdated Components',
    keywords: [
      'dependency', 'dependensi', 'komponen', 'component', 'outdated', 'out-of-date',
      'versi', 'version', 'lockfile', 'package', 'paket', 'npm', 'pypi', 'cve',
      'patch', 'update', 'upgrade', 'terkunci',
    ],
  },
  {
    id: 'A07:2021',
    name: 'Identification and Authentication Failures',
    keywords: [
      'autentikasi', 'authentication', 'auth', 'session', 'login', 'mfa', '2fa',
      'otp', 'brute force', 'credential stuffing', 'sesi', 'jwt',
    ],
  },
  {
    id: 'A08:2021',
    name: 'Software and Data Integrity Failures',
    keywords: [
      'integritas', 'integrity', 'signature', 'tanda tangan', 'checksum', 'supply chain',
      'rantai pasok', 'ci/cd', 'pipeline', 'provenance', 'attestation', 'mirror',
      'http://', 'unsigned', 'unverified', 'postinstall', 'typosquat',
    ],
  },
  {
    id: 'A09:2021',
    name: 'Security Logging and Monitoring Failures',
    keywords: [
      'logging', 'monitoring', 'audit', 'log', 'deteksi', 'detection', 'alerting',
      'alert', 'observabilitas', 'observability', 'siem', 'trail', 'telemetri',
    ],
  },
  {
    id: 'A10:2021',
    name: 'Server-Side Request Forgery (SSRF)',
    keywords: ['ssrf', 'request forgery', 'private ip', 'localhost', '169.254', 'metadata'],
  },
];

export const UNMAPPED: OwaspControl = {
  id: 'LAINNYA',
  name: 'Temuan Lainnya (tidak terpetakan ke OWASP Top 10)',
  keywords: [],
};

const SEVERITY_ORDER: Record<string, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
  Info: 0,
};

export interface ComplianceItem {
  controlId: string;
  controlName: string;
  count: number;
  maxSeverity: string;
  findingIds: number[];
}

export interface ComplianceSummary {
  items: ComplianceItem[];
  totalFindings: number;
  mappedCount: number;
  generatedAt: number;
}

/** Petakan satu temuan ke daftar kontrol (bisa >1; maks 2 utk hindari noise). */
export function mapFindingToControls(
  finding: { title: string; description?: string | null },
): OwaspControl[] {
  const text = `${finding.title} ${finding.description ?? ''}`.toLowerCase();
  const scored: { control: OwaspControl; score: number }[] = [];
  for (const control of OWASP_TOP10) {
    let score = 0;
    for (const kw of control.keywords) {
      if (text.includes(kw)) score += kw.length > 6 ? 2 : 1;
    }
    if (score > 0) scored.push({ control, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 2).map((s) => s.control);
}

/** Ringkasan kepatuhan dari daftar temuan. */
export function buildCompliance(
  findings: { id: number; severity: string; title: string; description?: string | null; validation_status?: string | null }[],
): ComplianceSummary {
  const byControl = new Map<string, ComplianceItem>();
  let mapped = 0;
  for (const f of findings) {
    const controls = mapFindingToControls(f);
    if (controls.length === 0) {
      mapped++;
      const item = byControl.get(UNMAPPED.id) ?? {
        controlId: UNMAPPED.id,
        controlName: UNMAPPED.name,
        count: 0,
        maxSeverity: 'Info',
        findingIds: [],
      };
      item.count += 1;
      item.findingIds.push(f.id);
      if ((SEVERITY_ORDER[f.severity] ?? 0) > (SEVERITY_ORDER[item.maxSeverity] ?? 0)) {
        item.maxSeverity = f.severity;
      }
      byControl.set(UNMAPPED.id, item);
      continue;
    }
    mapped++;
    // Temuan dipetakan ke kontrol terkuat saja utk ringkasan (hindari double-count).
    const primary = controls[0];
    const item = byControl.get(primary.id) ?? {
      controlId: primary.id,
      controlName: primary.name,
      count: 0,
      maxSeverity: 'Info',
      findingIds: [],
    };
    item.count += 1;
    item.findingIds.push(f.id);
    if ((SEVERITY_ORDER[f.severity] ?? 0) > (SEVERITY_ORDER[item.maxSeverity] ?? 0)) {
      item.maxSeverity = f.severity;
    }
    byControl.set(primary.id, item);
  }
  const items = [...byControl.values()].sort(
    (a, b) => (SEVERITY_ORDER[b.maxSeverity] ?? 0) - (SEVERITY_ORDER[a.maxSeverity] ?? 0) || b.count - a.count,
  );
  return { items, totalFindings: findings.length, mappedCount: mapped, generatedAt: Date.now() };
}

/** Render laporan kepatuhan markdown (Bahasa Indonesia). */
export function renderComplianceReport(
  job: { repo_url: string; branch: string; target_type: string; created_at: number; severity_counts?: string | null },
  findings: { id: number; severity: string; title: string; location?: string | null; recommendation?: string | null; validation_status?: string | null }[],
  summary: ComplianceSummary,
): string {
  const date = new Date(job.created_at).toISOString().replace('T', ' ').slice(0, 16);
  const lines: string[] = [];
  lines.push(`# Laporan Kepatuhan Keamanan — OWASP Top 10 (2021)`);
  lines.push('');
  lines.push(`- **Target**: ${job.repo_url}${job.target_type === 'github' ? ` (branch \`${job.branch}\`)` : ' (URL live)'}`);
  lines.push(`- **Tanggal scan**: ${date} UTC`);
  lines.push(`- **Total temuan**: ${summary.totalFindings}`);
  lines.push(`- **Dibuat**: ${new Date(summary.generatedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  lines.push('');
  lines.push(`> Pemetaan otomatis berbasis keyword — indikatif, bukan sertifikasi. `);
  lines.push(`> Kategori tanpa temuan bukan jaminan kepatuhan (bukan berarti diuji).`);
  lines.push('');
  lines.push(`## Ringkasan per Kategori`);
  lines.push('');
  lines.push(`| Kategori | Temuan | Severity Maks | Status |`);
  lines.push(`|---|---|---|---|`);
  for (const item of summary.items) {
    const flag = (SEVERITY_ORDER[item.maxSeverity] ?? 0) >= 3 ? '🔴 Perlu tindakan' : (SEVERITY_ORDER[item.maxSeverity] ?? 0) >= 1 ? '🟡 Tinjau' : '🔵 Informasi';
    lines.push(`| ${item.controlId} ${item.controlName} | ${item.count} | ${item.maxSeverity} | ${flag} |`);
  }
  // Kategori tanpa temuan — tampil juga utk kelengkapan.
  const mapped = new Set(summary.items.map((i) => i.controlId));
  for (const c of OWASP_TOP10) {
    if (!mapped.has(c.id)) {
      lines.push(`| ${c.id} ${c.name} | 0 | — | ⚪ Tidak ada temuan terpetakan |`);
    }
  }
  lines.push('');
  lines.push(`## Detail Temuan per Kategori`);
  lines.push('');
  for (const item of summary.items) {
    lines.push(`### ${item.controlId} — ${item.controlName}`);
    lines.push('');
    for (const fid of item.findingIds) {
      const f = findings.find((x) => x.id === fid);
      if (!f) continue;
      const val = f.validation_status ? ` (validasi: ${f.validation_status})` : '';
      lines.push(`- **[${f.severity}]** ${f.title}${val}`);
      if (f.location) lines.push(`  - Lokasi: \`${f.location}\``);
      if (f.recommendation) lines.push(`  - Rekomendasi: ${f.recommendation}`);
    }
    lines.push('');
  }
  lines.push(`## Catatan Metodologi`);
  lines.push('');
  lines.push(`- Pemetaan memakai pencocokan keyword pada judul dan deskripsi temuan (maks 2 kandidat, diambil terkuat).`);
  lines.push(`- Temuan yang tidak cocok kategori mana pun dikelompokkan di "${UNMAPPED.name}".`);
  lines.push(`- Severity mengikuti laporan skill audit; status validasi (bila ada) dicantumkan per temuan.`);
  lines.push(`- Laporan ini dihasilkan SecScan Hub secara otomatis dari hasil scan terstruktur.`);
  lines.push('');
  return lines.join('\n');
}
