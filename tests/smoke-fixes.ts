// Smoke test parser fixes (lib/fixes.ts)
process.env.DB_PATH = ':memory:';
import { parseFixesOutput } from '../lib/fixes';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}

// Kanonik
const out = `Saya sudah memperbaiki file berikut.

\`\`\`json
[{"file":"lib/auth.ts","findings":[3,5],"rationale":"tambah validasi input"},
 {"file":"app/api/login/route.ts","findings":[7],"rationale":"rate limit"}]
\`\`\``;
const f = parseFixesOutput(out);
check('2 file terparse', f.length === 2, `got ${f.length}`);
check('file pertama benar', f[0]?.file === 'lib/auth.ts' && f[0]?.findings.length === 2);
check('findings integer', f[0]?.findings.every((n) => Number.isInteger(n)) === true);
check('rationale ada', Boolean(f[0]?.rationale?.includes('validasi')));

// Blok terakhir menang
const two = '```json\n[{"file":"a.ts","findings":[1],"rationale":"lama"}]\n```\ntengah\n```json\n[{"file":"b.ts","findings":[2],"rationale":"final"}]\n```';
check('blok terakhir dipakai', parseFixesOutput(two)[0]?.file === 'b.ts');

// Item cacat dibuang (tanpa file)
const dirty = '```json\n[{"findings":[1]},{"file":"ok.ts","findings":[2],"rationale":null},{"file":"","findings":[3]}]\n```';
const d = parseFixesOutput(dirty);
check('item tanpa file dibuang', d.length === 1 && d[0]?.file === 'ok.ts');

// findings non-integer dibuang
const dirty2 = '```json\n[{"file":"x.ts","findings":[1,"a",3.5],"rationale":null}]\n```';
const d2 = parseFixesOutput(dirty2);
check('findings non-integer difilter', d2[0]?.findings.length === 1);

// Tidak ada blok json
check('tanpa blok → kosong', parseFixesOutput('laporan biasa').length === 0);
check('null → kosong', parseFixesOutput(null).length === 0);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
