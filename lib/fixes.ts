/**
 * lib/fixes.ts — parser output tahap auto-fix (stage 3).
 *
 * Konvensi: fixer (hermes) mengubah file di workdir lalu WAJIB mengakhiri
 * jawaban dengan blok JSON array per file yang diubah:
 *   ```json
 *   [ { "file": "app/api/x.ts", "findings": [3, 5], "rationale": "..." } ]
 *   ```
 * Worker juga men-capture `git diff` di workdir sebagai fixes.patch —
 * sumber kebenaran perubahan sebenarnya; JSON ini hanya metadata per file.
 */

export interface FixMeta {
  file: string;
  findings: number[]; // id job_findings yang dicover
  rationale: string | null;
}

/** Batas temuan yang difix per job. */
export const MAX_FIX_FINDINGS = 10;

export function parseFixesOutput(output: string | null | undefined): FixMeta[] {
  if (!output) return [];
  const blocks = [...String(output).matchAll(/```json\s*([\s\S]*?)```/g)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(blocks[i][1]);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const items = parsed
      .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && typeof x.file === 'string' && x.file.trim().length > 0)
      .map((x) => ({
        file: String(x.file).slice(0, 500),
        findings: Array.isArray(x.findings)
          ? x.findings.filter((n): n is number => Number.isInteger(n)).slice(0, 50)
          : [],
        rationale: typeof x.rationale === 'string' ? x.rationale.slice(0, 2000) : null,
      }));
    if (items.length > 0) return items;
  }
  return [];
}
