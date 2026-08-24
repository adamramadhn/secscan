// Smoke test parser validasi (lib/validation.ts)
process.env.DB_PATH = ':memory:';
import { parseValidationOutput, normalizeValidationStatus, eligibleForValidation } from '../lib/validation';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}

// Kanonik
const out = `Analisis selesai. Beberapa catatan awal.

\`\`\`json
[{"id":1,"status":"confirmed","evidence":"api.ts:12 berisi hardcoded key"},
 {"id":2,"status":"refuted","evidence":"file tidak ada di repo"},
 {"id":3,"status":"inconclusive","evidence":"butuh runtime"}]
\`\`\``;
const v = parseValidationOutput(out);
check('3 item terparse', v.length === 3, `got ${v.length}`);
check('id/Status/evidence item1', v[0]?.id === 1 && v[0]?.status === 'confirmed' && Boolean(v[0]?.evidence?.includes('api.ts')));

// Blok json terakhir menang (jika ada dua)
const two = '```json\n[{"id":9,"status":"confirmed","evidence":"lama"}]\n```\nn tengah\n```json\n[{"id":1,"status":"refuted","evidence":"final"}]\n```';
check('blok terakhir dipakai', parseValidationOutput(two)[0]?.evidence === 'final');

// Alias & normalisasi
check('alias validated → confirmed', normalizeValidationStatus('Validated') === 'confirmed');
check('alias false_positive → refuted', normalizeValidationStatus('False_Positive') === 'refuted');
check('unknown → inconclusive', normalizeValidationStatus('apapun') === 'inconclusive');
check('non-string → inconclusive', normalizeValidationStatus(42) === 'inconclusive');

// Item cacat difilter
const dirty = '```json\n[{"id":"x","status":"confirmed"},{"id":5,"status":"confirmed","evidence":"ok"},{"status":"confirmed"}]\n```';
const d = parseValidationOutput(dirty);
check('item tanpa id integer dibuang', d.length === 1 && d[0]?.id === 5);

// Tidak ada blok json
check('tanpa blok → kosong', parseValidationOutput('laporan saja tanpa json').length === 0);
check('null → kosong', parseValidationOutput(null).length === 0);

// Eligible: non-Info, urut severity, cap 25
const findings = Array.from({ length: 30 }, (_, i) => ({ severity: i % 2 ? 'Low' : 'Info' }));
findings.push({ severity: 'Critical' }, { severity: 'High' });
const elig = eligibleForValidation(findings);
check('Info dikecualikan', elig.every((f) => f.severity !== 'Info'));
check('urut severity (Critical pertama)', elig[0]?.severity === 'Critical' && elig[1]?.severity === 'High');
check('jumlah tepat (15 Low + Critical + High)', elig.length === 17, `got ${elig.length}`);
const big = Array.from({ length: 40 }, () => ({ severity: 'Medium' as const }));
check('cap 25 aktif saat >25', eligibleForValidation(big).length === 25);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
