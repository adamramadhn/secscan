// Env harus diset SEBELUM modul route diimport: lib/auth.ts memanggil initDb()
// di module scope, dan import statis di-hoist esbuild di atas assignment baris
// pertama — jadi semua modul yang menyentuh DB diimport dinamis di dalam run().
process.env.DB_PATH = ':memory:';
process.env.WORK_DIR = `${import.meta.dirname}/.tmp-smoke-work`;
process.env.REPORT_DIR = `${import.meta.dirname}/.tmp-smoke-reports`;

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  PASS: ${name}`);
    pass++;
  } else {
    console.error(`  FAIL: ${name}`, extra ?? '');
    fail++;
  }
}

async function run() {
  console.log('--- Test Schedule Consent & Target Enforcement ---');

  const { initDb } = await import('../lib/db');
  const { createSession, SESSION_COOKIE } = await import('../lib/auth');
  const { POST } = await import('../app/api/schedules/route');
  initDb();

  // withAuth membaca token dari header Cookie — buat sesi valid di DB :memory:.
  const token = createSession();

  // Helper request builder
  const makeReq = (body: Record<string, unknown>) =>
    new Request('http://localhost:3011/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify(body),
    });

  // 1. URL target without confirmOfensif must be rejected
  const res1 = await POST(
    makeReq({
      name: 'Audit Web Berkala',
      repoUrl: 'https://example.com',
      targetType: 'url',
      skills: ['dast-scanning'],
    })
  );
  const data1 = await res1.json();
  check('URL target without consent rejected', res1.status === 400 && data1.error === 'confirm_ofensif_required', data1);

  // 2. URL target pointing to private IP must be blocked by DNS anti-SSRF
  const res2 = await POST(
    makeReq({
      name: 'Internal Network Scan',
      repoUrl: 'http://127.0.0.1:8080',
      targetType: 'url',
      skills: ['dast-scanning'],
      confirmOfensif: true,
    })
  );
  const data2 = await res2.json();
  check('URL target to 127.0.0.1 rejected with invalid_target_url', res2.status === 400 && data2.error === 'invalid_target_url', data2);

  // 3. GitHub target with offensive skill without confirmOfensif must be rejected
  const res3 = await POST(
    makeReq({
      name: 'Fuzzing Scan',
      repoUrl: 'https://github.com/octocat/Hello-World',
      targetType: 'github',
      skills: ['penetration-testing'],
    })
  );
  const data3 = await res3.json();
  check('GitHub target with offensive skill rejected without consent', res3.status === 400 && data3.error === 'confirm_ofensif_required', data3);

  // 4. GitHub target with defensive/passive skills without confirmOfensif should succeed
  const res4 = await POST(
    makeReq({
      name: 'Nightly SAST',
      repoUrl: 'https://github.com/octocat/Hello-World',
      targetType: 'github',
      skills: ['sast-scanning'],
    })
  );
  const data4 = await res4.json();
  check('GitHub target with defensive skill accepted without confirmOfensif', res4.status === 201 && data4.schedule?.id, data4);

  // 5. GitHub target with offensive skill WITH confirmOfensif should succeed
  const res5 = await POST(
    makeReq({
      name: 'Authorized Fuzzing Scan',
      repoUrl: 'https://github.com/octocat/Hello-World',
      targetType: 'github',
      skills: ['penetration-testing'],
      confirmOfensif: true,
    })
  );
  const data5 = await res5.json();
  check('GitHub target with offensive skill accepted when confirmOfensif=true', res5.status === 201 && data5.schedule?.id, data5);

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
