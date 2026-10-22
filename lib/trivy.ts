import { spawnSync } from 'node:child_process';
import type { NewFinding } from './db';

const SEVERITY_MAP: Record<string, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  UNKNOWN: 'Info',
};

export interface TrivyVulnerability {
  VulnerabilityID: string;
  PkgName: string;
  InstalledVersion: string;
  FixedVersion?: string;
  Title?: string;
  Description?: string;
  Severity: string;
  CweIDs?: string[];
  PrimaryURL?: string;
}

export interface TrivySecret {
  RuleID: string;
  Category?: string;
  Severity: string;
  Title?: string;
  StartLine?: number;
  EndLine?: number;
  Match?: string;
}

export interface TrivyResult {
  Target: string;
  Class?: string;
  Type?: string;
  Vulnerabilities?: TrivyVulnerability[];
  Secrets?: TrivySecret[];
}

export interface TrivyReport {
  SchemaVersion?: number;
  Results?: TrivyResult[];
}

/**
 * Memeriksa apakah binary trivy tersedia di sistem host.
 */
export function isTrivyAvailable(binPath = process.env.TRIVY_BIN ?? 'trivy'): boolean {
  try {
    const res = spawnSync(binPath, ['--version'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: 'pipe',
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Melakukan parsing output JSON dari Trivy (baik kerentanan paket maupun secret)
 * menjadi daftar NewFinding terstruktur dengan bukti dan metadata CVE/CWE.
 */
export function parseTrivyOutput(rawInput: string | TrivyReport): NewFinding[] {
  let report: TrivyReport;
  if (typeof rawInput === 'string') {
    if (!rawInput.trim()) return [];
    try {
      report = JSON.parse(rawInput) as TrivyReport;
    } catch (err) {
      console.warn('[trivy] Gagal mem-parse output JSON Trivy:', err);
      return [];
    }
  } else {
    report = rawInput;
  }

  if (!report || !Array.isArray(report.Results)) {
    return [];
  }

  const findings: NewFinding[] = [];

  for (const res of report.Results) {
    const target = res.Target || 'repository';

    // 1. Kerentanan Dependensi (Vulnerabilities)
    if (Array.isArray(res.Vulnerabilities)) {
      for (const v of res.Vulnerabilities) {
        const cve = v.VulnerabilityID;
        const cwe = Array.isArray(v.CweIDs) && v.CweIDs.length > 0 ? v.CweIDs.join(', ') : 'CWE-937';
        const sev = SEVERITY_MAP[v.Severity.toUpperCase()] ?? 'Medium';
        const fix = v.FixedVersion ? `ke versi ${v.FixedVersion}` : 'ke rilis terbaru yang aman';

        findings.push({
          skill: 'dependency-scanning',
          source_tool: 'trivy',
          severity: sev,
          confidence: 'high',
          validation_status: 'confirmed',
          cve_id: cve,
          cwe_id: cwe,
          title: `${v.PkgName}@${v.InstalledVersion} — ${cve}${v.Title ? `: ${v.Title}` : ''}`,
          description: v.Description || `Kerentanan teridentifikasi pada paket dependensi ${v.PkgName}. Referensi: ${v.PrimaryURL ?? cve}`,
          location: `${target}:${v.PkgName}@${v.InstalledVersion}`,
          recommendation: `Upgrade dependensi ${v.PkgName} ${fix}.`,
          validation_evidence: `Manifes ${target} memuat paket rentan ${v.PkgName}@${v.InstalledVersion} (ID: ${cve}). Terdeteksi secara deterministik oleh Trivy.`,
        });
      }
    }

    // 2. Kredensial / Token Bocor (Secrets)
    if (Array.isArray(res.Secrets)) {
      for (const s of res.Secrets) {
        const sev = SEVERITY_MAP[s.Severity.toUpperCase()] ?? 'High';
        const line = s.StartLine ?? 1;

        findings.push({
          skill: 'vulnerability-scanning',
          source_tool: 'trivy',
          severity: sev,
          confidence: 'high',
          validation_status: 'confirmed',
          cwe_id: 'CWE-798',
          title: `Hardcoded Secret: ${s.Title || s.RuleID}`,
          description: `Terdeteksi token/kredensial statis (${s.Category ?? 'Secret'}: ${s.RuleID}) di dalam berkas kode repositori.`,
          location: `${target}:${line}`,
          recommendation: 'Hapus nilai rahasia dari repositori git, gunakan secret manager atau environment variables, dan lakukan rotasi kredensial tersebut.',
          validation_evidence: `Berkas ${target} baris ${line} cocok dengan pola aturan deteksi secret '${s.RuleID}'.`,
        });
      }
    }
  }

  return findings;
}
