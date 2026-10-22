/**
 * Pemetaan temuan → kontrol OWASP Top 10 (2021) untuk laporan kepatuhan.
 * Mendukung pemetaan terstruktur berbasis CWE ID dan CVE ID resmi,
 * dengan fallback pencocokan kata kunci (judul + deskripsi).
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

const CONTROL_BY_ID = new Map<string, OwaspControl>(OWASP_TOP10.map((c) => [c.id, c]));

/** Kamus pemetaan taksonomi resmi CWE → OWASP Top 10 (2021) */
export const CWE_TO_OWASP_MAP: Record<string, string> = {
  // A01:2021 - Broken Access Control
  'CWE-22': 'A01:2021',
  'CWE-23': 'A01:2021',
  'CWE-264': 'A01:2021',
  'CWE-276': 'A01:2021',
  'CWE-284': 'A01:2021',
  'CWE-285': 'A01:2021',
  'CWE-352': 'A01:2021',
  'CWE-639': 'A01:2021',
  'CWE-862': 'A01:2021',
  'CWE-863': 'A01:2021',

  // A02:2021 - Cryptographic Failures
  'CWE-259': 'A02:2021',
  'CWE-295': 'A02:2021',
  'CWE-310': 'A02:2021',
  'CWE-319': 'A02:2021',
  'CWE-321': 'A02:2021',
  'CWE-326': 'A02:2021',
  'CWE-327': 'A02:2021',
  'CWE-328': 'A02:2021',
  'CWE-330': 'A02:2021',
  'CWE-798': 'A02:2021',

  // A03:2021 - Injection
  'CWE-20': 'A03:2021',
  'CWE-74': 'A03:2021',
  'CWE-77': 'A03:2021',
  'CWE-78': 'A03:2021',
  'CWE-79': 'A03:2021',
  'CWE-89': 'A03:2021',
  'CWE-94': 'A03:2021',
  'CWE-116': 'A03:2021',
  'CWE-917': 'A03:2021',

  // A04:2021 - Insecure Design
  'CWE-209': 'A04:2021',
  'CWE-501': 'A04:2021',
  'CWE-522': 'A04:2021',
  'CWE-653': 'A04:2021',
  'CWE-799': 'A04:2021',
  'CWE-840': 'A04:2021',
  'CWE-1059': 'A04:2021',

  // A05:2021 - Security Misconfiguration
  'CWE-16': 'A05:2021',
  'CWE-200': 'A05:2021',
  'CWE-215': 'A05:2021',
  'CWE-548': 'A05:2021',
  'CWE-611': 'A05:2021',
  'CWE-614': 'A05:2021',
  'CWE-693': 'A05:2021',
  'CWE-1004': 'A05:2021',
  'CWE-1021': 'A05:2021',
  'CWE-1174': 'A05:2021',

  // A06:2021 - Vulnerable and Outdated Components
  'CWE-937': 'A06:2021',
  'CWE-1035': 'A06:2021',
  'CWE-1104': 'A06:2021',

  // A07:2021 - Identification and Authentication Failures
  'CWE-287': 'A07:2021',
  'CWE-294': 'A07:2021',
  'CWE-300': 'A07:2021',
  'CWE-307': 'A07:2021',
  'CWE-384': 'A07:2021',
  'CWE-613': 'A07:2021',
  'CWE-620': 'A07:2021',
  'CWE-640': 'A07:2021',

  // A08:2021 - Software and Data Integrity Failures
  'CWE-345': 'A08:2021',
  'CWE-353': 'A08:2021',
  'CWE-426': 'A08:2021',
  'CWE-494': 'A08:2021',
  'CWE-502': 'A08:2021',
  'CWE-565': 'A08:2021',
  'CWE-829': 'A08:2021',

  // A09:2021 - Security Logging and Monitoring Failures
  'CWE-117': 'A09:2021',
  'CWE-223': 'A09:2021',
  'CWE-532': 'A09:2021',
  'CWE-778': 'A09:2021',

  // A10:2021 - Server-Side Request Forgery (SSRF)
  'CWE-918': 'A10:2021',
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

export interface FindingForCompliance {
  id?: number;
  title: string;
  description?: string | null;
  severity?: string;
  cwe_id?: string | null;
  cve_id?: string | null;
  validation_status?: string | null;
  location?: string | null;
  recommendation?: string | null;
}

const CWE_REGEX = /\bCWE-(\d+)\b/gi;
const CVE_REGEX = /\bCVE-\d{4}-\d+\b/i;

/**
 * Petakan satu temuan ke daftar kontrol OWASP Top 10 (2021).
 * Prioritas:
 * 1. Taksonomi terstruktur via CWE ID (cwe_id atau teks CWE-xxx)
 * 2. Taksonomi CVE (dipetakan langsung ke A06:2021)
 * 3. Fallback pencocokan kata kunci judul & deskripsi
 */
export function mapFindingToControls(finding: FindingForCompliance): OwaspControl[] {
  const result: OwaspControl[] = [];
  const seenControls = new Set<string>();

  // Prioritas 1: Evaluasi CWE
  const cweSources = [finding.cwe_id, finding.title, finding.description].filter(Boolean).join(' ');
  const cweMatches = cweSources.match(CWE_REGEX);
  if (cweMatches) {
    for (const rawCwe of cweMatches) {
      const normalizedCwe = rawCwe.toUpperCase();
      const controlId = CWE_TO_OWASP_MAP[normalizedCwe];
      if (controlId && !seenControls.has(controlId)) {
        const ctrl = CONTROL_BY_ID.get(controlId);
        if (ctrl) {
          result.push(ctrl);
          seenControls.add(controlId);
        }
      }
    }
  }

  // Jika sudah terpetakan dari CWE, kembalikan kontrol teratas (maks 2)
  if (result.length > 0) {
    return result.slice(0, 2);
  }

  // Prioritas 2: Evaluasi CVE (jika ada cve_id atau pola CVE pada judul/deskripsi)
  const isCve = Boolean(
    finding.cve_id ||
    (finding.title && CVE_REGEX.test(finding.title)) ||
    (finding.description && CVE_REGEX.test(finding.description))
  );
  if (isCve) {
    const a06 = CONTROL_BY_ID.get('A06:2021');
    if (a06) return [a06];
  }

  // Prioritas 3: Fallback pencocokan kata kunci heuristik
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
export function buildCompliance(findings: FindingForCompliance[]): ComplianceSummary {
  const byControl = new Map<string, ComplianceItem>();
  let mapped = 0;

  for (const f of findings) {
    const controls = mapFindingToControls(f);
    const fid = f.id ?? 0;
    const sev = f.severity ?? 'Info';

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
      item.findingIds.push(fid);
      if ((SEVERITY_ORDER[sev] ?? 0) > (SEVERITY_ORDER[item.maxSeverity] ?? 0)) {
        item.maxSeverity = sev;
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
    item.findingIds.push(fid);
    if ((SEVERITY_ORDER[sev] ?? 0) > (SEVERITY_ORDER[item.maxSeverity] ?? 0)) {
      item.maxSeverity = sev;
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
  findings: FindingForCompliance[],
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
  lines.push(`> Pemetaan terstruktur memprioritaskan taksonomi resmi CWE dan CVE, dengan fallback pencocokan kata kunci.`);
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
      const cweInfo = f.cwe_id ? ` [${f.cwe_id}]` : '';
      const cveInfo = f.cve_id ? ` [${f.cve_id}]` : '';
      lines.push(`- **[${f.severity ?? 'Info'}]** ${f.title}${cweInfo}${cveInfo}${val}`);
      if (f.location) lines.push(`  - Lokasi: \`${f.location}\``);
      if (f.recommendation) lines.push(`  - Rekomendasi: ${f.recommendation}`);
    }
    lines.push('');
  }
  lines.push(`## Catatan Metodologi`);
  lines.push('');
  lines.push(`- Pemetaan memprioritaskan taksonomi terstruktur resmi: identifier CWE (misal CWE-79, CWE-89) dan CVE.`);
  lines.push(`- Temuan tanpa metadata terstruktur dievaluasi melalui analisis kata kunci heuristik pada judul dan deskripsi.`);
  lines.push(`- Temuan yang tidak cocok kategori mana pun dikelompokkan di "${UNMAPPED.name}".`);
  lines.push(`- Severity mengikuti laporan skill audit; status validasi (bila ada) dicantumkan per temuan.`);
  lines.push(`- Laporan ini bersifat indikatif dan dihasilkan SecScan Hub secara otomatis dari hasil scan terstruktur.`);
  lines.push('');
  return lines.join('\n');
}
