// Smoke test validator target live (lib/target.ts)
process.env.DB_PATH = ':memory:';
import { isValidLiveUrl } from '../lib/target';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}

// Valid
let r = isValidLiveUrl('https://example.com');
check('https domain valid', r.ok === true);
r = isValidLiveUrl('http://app.target.co.id:3000/login');
check('http + port 3000 + path valid', r.ok === true, r.error);
r = isValidLiveUrl(' https://example.com ');
check('trim spasi', r.ok === true && r.normalized === 'https://example.com/');

// Invalid — format
check('bukan URL', isValidLiveUrl('bukan url').ok === false);
check('scheme ftp ditolak', isValidLiveUrl('ftp://example.com').ok === false);
check('kosong', isValidLiveUrl('').ok === false);

// Invalid — SSRF
check('localhost ditolak', isValidLiveUrl('http://localhost:3000').ok === false);
check('127.0.0.1 ditolak', isValidLiveUrl('http://127.0.0.1/admin').ok === false);
check('IP literal publik ditolak (konservatif)', isValidLiveUrl('http://8.8.8.8').ok === false);
check('.internal ditolak', isValidLiveUrl('http://db.internal/x').ok === false);
check('.local ditolak', isValidLiveUrl('http://nas.local').ok === false);
check('port 6379 (redis) ditolak', isValidLiveUrl('http://victim.com:6379').ok === false);
check('port 5432 (postgres) ditolak', isValidLiveUrl('http://victim.com:5432').ok === false);
check('userinfo ditolak', isValidLiveUrl('http://user:pass@victim.com').ok === false);
check('metadata GCP ditolak', isValidLiveUrl('http://metadata.google.internal/computeMetadata/').ok === false);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
