/**
 * lib/validation.ts — parser output tahap validasi temuan (PoC-lite).
 *
 * Konvensi: validator (hermes) diakhiri jawaban dengan blok JSON:
 *   ```json
 *   [ { "id": 12, "status": "confirmed", "evidence": "..." }, ... ]
 *   ```
 * Parser mengambil blok json TERAKHIR yang valid berisi array objek
 * dengan field id (integer) + status (string). Status dinormalisasi:
 * confirmed | refuted | inconclusive (alias diterima, unknown → inconclusive).
 */

export const VALIDATION_STATUSES = ['candidate', 'evidence-backed', 'confirmed', 'refuted', 'inconclusive'] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export interface ValidatedItem {
  id: number;
  status: ValidationStatus;
  evidence: string | null;
}

/** Batas temuan yang divalidasi per job (sisanya dibiarkan null). */
export const MAX_VALIDATED = 25;

const STATUS_ALIASES: Record<string, ValidationStatus> = {
  candidate: 'candidate',
  kandidat: 'candidate',
  'evidence-backed': 'evidence-backed',
  'evidence_backed': 'evidence-backed',
  evidencebacked: 'evidence-backed',
  'terbukti-kode': 'evidence-backed',
  confirmed: 'confirmed',
  confirm: 'confirmed',
  valid: 'confirmed',
  validated: 'confirmed',
  terkonfirmasi: 'confirmed',
  benar: 'confirmed',
  refuted: 'refuted',
  refute: 'refuted',
  invalid: 'refuted',
  false_positive: 'refuted',
  falsepositive: 'refuted',
  salah: 'refuted',
  ditolak: 'refuted',
  inconclusive: 'inconclusive',
  undetermined: 'inconclusive',
  unknown: 'inconclusive',
  ragu: 'inconclusive',
};

export function normalizeValidationStatus(raw: unknown): ValidationStatus {
  if (typeof raw !== 'string') return 'inconclusive';
  return STATUS_ALIASES[raw.trim().toLowerCase()] ?? 'inconclusive';
}

/**
 * Ambil blok ```json terakhir dari output lalu parse sebagai array item validasi.
 * Mengembalikan array (bisa kosong bila tidak ada blok valid).
 */
export function parseValidationOutput(output: string | null | undefined): ValidatedItem[] {
  if (!output) return [];
  const blocks = [...output.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(blocks[i][1]);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const items = parsed
      .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
      .filter((x) => Number.isInteger(x.id))
      .map((x) => ({
        id: x.id as number,
        status: normalizeValidationStatus(x.status),
        evidence: typeof x.evidence === 'string' ? x.evidence.slice(0, 2000) : null,
      }));
    if (items.length > 0) return items;
  }
  return [];
}

/** Pilih temuan yang layak divalidasi: non-Info dulu, maksimum MAX_VALIDATED. */
export function eligibleForValidation<T extends { severity: string }>(findings: T[]): T[] {
  const order: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 };
  return [...findings]
    .sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
    .filter((f) => (order[f.severity] ?? 9) < 4) // semua kecuali Info
    .slice(0, MAX_VALIDATED);
}
