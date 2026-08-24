// Smoke test parser findings (lib/findings.ts)
process.env.DB_PATH = ':memory:';
import { parseFindings, extractFindingsSection, SEVERITIES, Severity } from '../lib/findings';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}

// ——— Format kanonik dari prompt worker ———
const canonical = `## Ringkasan
Ringkasan singkat.

## Temuan

- **[High]** Hardcoded API key di client — kredensial terekspos di bundle publik.
  Lokasi: src/lib/api.ts:12
  Rekomendasi: Pindahkan ke server-side proxy dan rotasi key.

- **[Critical]** SQL injection di endpoint pencarian.
  Lokasi: app/api/search/route.ts:40
  Rekomendasi: Gunakan prepared statement.

## Rekomendasi Prioritas
1. Perbaiki SQL injection.`;

const sec = extractFindingsSection(canonical);
check('section terpotong sebelum section berikutnya', !sec.includes('Rekomendasi Prioritas'));

const f = parseFindings(canonical);
check('2 temuan ditemukan', f.length === 2, `got ${f.length}`);
check('severity High pertama (urutan sumber)', f[0]?.severity === 'High');
check('severity Critical kedua', f[1]?.severity === 'Critical');
check('judul critical', f[1]?.title.includes('SQL injection') ?? false, f[1]?.title);
check('lokasi critical', f[1]?.location === 'app/api/search/route.ts:40', f[1]?.location ?? 'null');
check('rekomendasi critical', f[1]?.recommendation?.includes('prepared statement') ?? false);
check('deskripsi high', f[0]?.description?.includes('bundle publik') ?? false);

// ——— Variasi format ———
const variants = `### Temuan
### 1. XSS tersimpan di komentar (Severity: Medium)
Lokasi: components/Comment.tsx
* Item tanpa severity → info
**[LOW]** Rate limiting tidak ada
Rekomendasi: tambah rate limit di /api/comment`;
const v = parseFindings(variants);
check('variasi: 3 temuan', v.length === 3, `got ${v.length}`);
check('variasi: heading dengan (Severity: Medium)', v[0]?.severity === 'Medium');
check('variasi: item tanpa severity → Info', v[1]?.severity === 'Info');
check('variasi: [LOW] case-insensitive → Low', v[2]?.severity === 'Low');
check('variasi: rekomendasi multi-item', v[2]?.recommendation?.includes('rate limit') ?? false);

// ——— Tidak ada section Temuan ———
check('tanpa section → kosong', parseFindings('## Ringkasan\naman semua.').length === 0);
check('output null → kosong', parseFindings(null).length === 0);

// ——— Reflow / overflow ———
const longTitle = 'A'.repeat(500);
const many = '- **[Info]** ' + longTitle + '\n' + Array.from({ length: 300 }, (_, i) => `- **[Low]** Temuan ${i}`).join('\n');
const m = parseFindings(`## Temuan\n${many}`);
check('batas 200 temuan', m.length === 200, `got ${m.length}`);
check('judul dipotong ≤300', (m[0]?.title.length ?? 0) <= 300);

// ——— Severity enum konsisten ———
check('SEVERITIES lengkap', SEVERITIES.join(',') === 'Critical,High,Medium,Low,Low'.replace(/Low$/, 'Info'));

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
