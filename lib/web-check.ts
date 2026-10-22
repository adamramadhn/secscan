import { checkSafeDns } from './dns-check';
import type { NewFinding } from './db';

export interface HeaderInspectionInput {
  url: string;
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Memeriksa kumpulan header HTTP dan menghasilkan temuan keamanan terstruktur
 * dengan bukti nyata dan tingkat keyakinan tinggi.
 */
export function inspectHttpHeaders(input: HeaderInspectionInput): NewFinding[] {
  const findings: NewFinding[] = [];
  const { url, statusCode, headers } = input;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return findings;
  }

  const isHttps = parsedUrl.protocol === 'https:';

  // Normalisasi header keys ke lowercase
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || v === null) continue;
    h[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  }

  // 1. HSTS (hanya relevan untuk HTTPS)
  if (isHttps) {
    const hsts = h['strict-transport-security'];
    if (!hsts) {
      findings.push({
        skill: 'passive-web',
        source_tool: 'passive-web',
        severity: 'Medium',
        confidence: 'high',
        validation_status: 'confirmed',
        cwe_id: 'CWE-319',
        title: 'Missing Strict-Transport-Security (HSTS) Header',
        description: 'Aplikasi HTTPS tidak mengirimkan header Strict-Transport-Security. Hal ini memungkinkan pengguna menjadi rentan terhadap serangan SSL stripping atau downgrade ke HTTP.',
        location: `${parsedUrl.origin}/ (HTTP ${statusCode})`,
        recommendation: 'Tambahkan header HTTP: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
        validation_evidence: `Respons HTTP ${statusCode} dari ${parsedUrl.origin}/ tidak memuat header 'Strict-Transport-Security'.`,
      });
    } else {
      const maxAgeMatch = hsts.match(/max-age\s*=\s*(\d+)/i);
      const maxAge = maxAgeMatch ? Number.parseInt(maxAgeMatch[1], 10) : 0;
      if (maxAge < 15724800) { // kurang dari 6 bulan
        findings.push({
          skill: 'passive-web',
          source_tool: 'passive-web',
          severity: 'Low',
          confidence: 'high',
          validation_status: 'confirmed',
          cwe_id: 'CWE-319',
          title: 'HSTS Duration Terlalu Pendek',
          description: `Durasi HSTS max-age terdeteksi hanya ${maxAge} detik (kurang dari 15.724.800 detik / 6 bulan).`,
          location: `${parsedUrl.origin}/`,
          recommendation: 'Tingkatkan nilai max-age HSTS menjadi minimal 31536000 (1 tahun).',
          validation_evidence: `Header Strict-Transport-Security: '${hsts}'`,
        });
      }
    }
  }

  // 2. Content-Security-Policy (CSP)
  const csp = h['content-security-policy'];
  if (!csp) {
    findings.push({
      skill: 'passive-web',
      source_tool: 'passive-web',
      severity: 'Medium',
      confidence: 'high',
      validation_status: 'confirmed',
      cwe_id: 'CWE-1021',
      title: 'Missing Content-Security-Policy (CSP) Header',
      description: 'Aplikasi tidak mengonfigurasikan header Content-Security-Policy. Ketiadaan CSP meningkatkan risiko eksploitasi Cross-Site Scripting (XSS) dan pemuatan resource berbahaya.',
      location: `${parsedUrl.origin}/ (HTTP ${statusCode})`,
      recommendation: 'Terapkan header Content-Security-Policy yang membatasi sumber script, style, dan koneksi eksternal.',
      validation_evidence: `Respons HTTP ${statusCode} dari ${parsedUrl.origin}/ tidak memuat header 'Content-Security-Policy'.`,
    });
  }

  // 3. X-Frame-Options (Clickjacking Protection)
  const xfo = h['x-frame-options'];
  const hasFrameAncestors = csp && /frame-ancestors/i.test(csp);
  if (!xfo && !hasFrameAncestors) {
    findings.push({
      skill: 'passive-web',
      source_tool: 'passive-web',
      severity: 'Low',
      confidence: 'high',
      validation_status: 'confirmed',
      cwe_id: 'CWE-1021',
      title: 'Missing X-Frame-Options Header (Clickjacking Risk)',
      description: 'Aplikasi dapat di-embed ke dalam iframe di domain lain tanpa pembatasan frame-ancestors atau X-Frame-Options, menimbulkan risiko serangan clickjacking.',
      location: `${parsedUrl.origin}/`,
      recommendation: 'Tambahkan header X-Frame-Options: DENY atau SAMEORIGIN, atau gunakan CSP frame-ancestors.',
      validation_evidence: `Respons HTTP ${statusCode} tidak memuat 'X-Frame-Options' maupun CSP 'frame-ancestors'.`,
    });
  }

  // 4. X-Content-Type-Options
  const xcto = h['x-content-type-options'];
  if (!xcto || !xcto.toLowerCase().includes('nosniff')) {
    findings.push({
      skill: 'passive-web',
      source_tool: 'passive-web',
      severity: 'Low',
      confidence: 'high',
      validation_status: 'confirmed',
      cwe_id: 'CWE-116',
      title: 'Missing or Incomplete X-Content-Type-Options Header',
      description: 'Browser dapat mencoba menebak (MIME-sniffing) tipe konten file, yang berpotensi mengeksekusi file non-script sebagai JavaScript.',
      location: `${parsedUrl.origin}/`,
      recommendation: 'Tambahkan header: X-Content-Type-Options: nosniff',
      validation_evidence: `Header X-Content-Type-Options bernilai: '${xcto ?? 'tidak ada'}'`,
    });
  }

  // 5. Referrer-Policy
  const rp = h['referrer-policy'];
  if (!rp) {
    findings.push({
      skill: 'passive-web',
      source_tool: 'passive-web',
      severity: 'Low',
      confidence: 'high',
      validation_status: 'confirmed',
      cwe_id: 'CWE-200',
      title: 'Missing Referrer-Policy Header',
      description: 'Aplikasi tidak mengontrol pengiriman informasi Referer pada navigasi lintas situs.',
      location: `${parsedUrl.origin}/`,
      recommendation: 'Tambahkan header: Referrer-Policy: strict-origin-when-cross-origin',
      validation_evidence: `Respons HTTP ${statusCode} tidak memuat header 'Referrer-Policy'.`,
    });
  }

  // 6. Server Banner / Version Leakage
  const server = h['server'];
  const xPoweredBy = h['x-powered-by'];
  const bannerLeak = [
    server && /\d+\.\d+/.test(server) ? `Server: ${server}` : null,
    xPoweredBy ? `X-Powered-By: ${xPoweredBy}` : null,
  ].filter(Boolean).join('; ');

  if (bannerLeak) {
    findings.push({
      skill: 'passive-web',
      source_tool: 'passive-web',
      severity: 'Low',
      confidence: 'high',
      validation_status: 'confirmed',
      cwe_id: 'CWE-200',
      title: 'Technology & Version Information Disclosure',
      description: `Aplikasi membocorkan versi teknologi backend melalui respon header (${bannerLeak}), memudahkan penyerang memetakan kerentanan spesifik versi.`,
      location: `${parsedUrl.origin}/`,
      recommendation: 'Sembunyikan atau samarkan header Server dan hapus header X-Powered-By pada konfigurasi server/framework.',
      validation_evidence: `Header respon membocorkan: ${bannerLeak}`,
    });
  }

  return findings;
}

/**
 * Menjalankan pemeriksaan pasif live web via HTTP GET non-destruktif
 * dengan verifikasi anti-SSRF DNS pre-flight.
 */
export async function runPassiveWebCheck(targetUrl: string): Promise<NewFinding[]> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return [];
  }

  // 1. Verifikasi anti-SSRF DNS pre-flight
  const dnsRes = await checkSafeDns(parsed.hostname);
  if (!dnsRes.ok) {
    console.warn(`[web-check] Target ${parsed.hostname} diblokir oleh anti-SSRF: ${dnsRes.reason}`);
    return [];
  }

  // 2. Kirim request pasif non-destruktif dengan timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(parsed.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'SecScan-Hub-Auditor/1.0 (Authorized Security Baseline Check)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'manual', // tangani redirect secara eksplisit
    });

    clearTimeout(timer);

    const headersRecord: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headersRecord[key.toLowerCase()] = value;
    });

    return inspectHttpHeaders({
      url: targetUrl,
      statusCode: res.status,
      headers: headersRecord,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[web-check] Gagal mengambil respon dari ${targetUrl}: ${msg}`);
    return [];
  }
}
