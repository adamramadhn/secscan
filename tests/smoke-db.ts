// Smoke test untuk fix Critical #1 (upsertJobSkill patch diabaikan saat INSERT pertama)
process.env.DB_PATH = '/tmp/test-secscan.db';
import fs from 'fs';
for (const f of ['/tmp/test-secscan.db', '/tmp/test-secscan.db-wal', '/tmp/test-secscan.db-shm']) {
  try { fs.unlinkSync(f); } catch {}
}
import { initDb, createJob, upsertJobSkill, getJobSkills, updateJob, getJob } from '../lib/db';

initDb();
const j = createJob({ repo_url: 'https://github.com/octocat/Hello-World', branch: 'main', target_type: 'github', skills_json: '["sast-scanning"]', depth: 'medium' });

// Tes 1: INSERT pertama dengan patch status running HARUS tersimpan (bug lama: tersimpan pending)
const r1 = upsertJobSkill(j.id, 'sast-scanning', { status: 'running', started_at: 12345 });
console.log('T1 insert-patch status:', r1.status === 'running' ? 'PASS' : 'FAIL', `(got ${r1.status})`);
console.log('T1 started_at:', r1.started_at === 12345 ? 'PASS' : 'FAIL', `(got ${r1.started_at})`);

// Tes 2: update partial (COALESCE dipertahankan)
upsertJobSkill(j.id, 'sast-scanning', { status: 'done', finished_at: 99999 });
const r2 = getJobSkills(j.id)[0];
console.log('T2 status done:', r2.status === 'done' ? 'PASS' : 'FAIL');
console.log('T2 started_at dipertahankan:', r2.started_at === 12345 ? 'PASS' : 'FAIL');

// Tes 3: updateJob dengan nilai undefined tidak boleh membuat SET kolom
const r3 = updateJob(j.id, { status: 'running', error: undefined });
console.log('T3 undefined difilter:', r3 && r3.status === 'running' ? 'PASS' : 'FAIL');

// Tes 4: updateJob patch kosong → no-op aman
const r4 = updateJob(j.id, {});
console.log('T4 patch kosong no-op:', r4 && r4.id === j.id ? 'PASS' : 'FAIL');

// Tes 5: upsert tanpa patch → default pending
upsertJobSkill(j.id, 'threat-modeling', {});
const r5 = getJobSkills(j.id).find((s) => s.skill === 'threat-modeling');
console.log('T5 default pending:', r5 && r5.status === 'pending' ? 'PASS' : 'FAIL');
