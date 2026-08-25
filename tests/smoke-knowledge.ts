// Smoke test continuous learning (tabel knowledge + target_knowledge).
process.env.DB_PATH = '/tmp/test-secscan-knowledge.db';
import fs from 'fs';
for (const f of ['/tmp/test-secscan-knowledge.db', '/tmp/test-secscan-knowledge.db-wal', '/tmp/test-secscan-knowledge.db-shm']) {
  try { fs.unlinkSync(f); } catch {}
}
import {
  initDb,
  createJob,
  learnFindings,
  getKnowledgeForTarget,
  getTargetKnowledge,
  targetKey,
} from '../lib/db';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`PASS: ${name}`);
  } else {
    fail++;
    console.log(`FAIL: ${name}`);
  }
}

initDb();
const job1 = createJob({ repo_url: 'https://github.com/adamramadhn/dams-index', branch: 'main', target_type: 'github', skills_json: '["threat-modeling"]', depth: 'medium' });
const job2 = createJob({ repo_url: 'https://github.com/adamramadhn/dams-index', branch: 'main', target_type: 'github', skills_json: '["threat-modeling"]', depth: 'medium' });

const findings = [
  { title: 'HSTS tidak aktif', severity: 'Low' },
  { title: 'Tidak ada Content-Security-Policy', severity: 'Low' },
  { title: 'Banner server ter-ekspos', severity: 'Info' },
];

// Scan 1 → semua baru
learnFindings(job1.id, { repo_url: job1.repo_url, target_type: 'github' }, findings);
let k1 = getKnowledgeForTarget(targetKey(job1));
check('scan1: 3 knowledge', k1.length === 3);
check('scan1: seen_count = 1', k1.every((x) => x.seen_count === 1));

// Scan 2 → 2 temuan sama, 1 baru
learnFindings(job2.id, { repo_url: job2.repo_url, target_type: 'github' }, [
  { title: 'HSTS tidak aktif', severity: 'Low' },
  { title: 'Tidak ada Content-Security-Policy', severity: 'Low' },
  { title: 'Temuan baru', severity: 'High' },
]);
k1 = getKnowledgeForTarget(targetKey(job2));
const hsts = k1.find((x) => x.title === 'HSTS tidak aktif');
check('scan2: knowledge = 4', k1.length === 4);
check('scan2: HSTS seen_count = 2', hsts?.seen_count === 2);
check('scan2: temuan baru seen_count = 1', k1.find((x) => x.title === 'Temuan baru')?.seen_count === 1);

// Stats target
const tk = getTargetKnowledge(targetKey(job2));
check('target_knowledge: jobs_count = 2', tk?.jobs_count === 2);
check('target_knowledge: findings_learned = 6', tk?.findings_learned === 6); // 3 (scan1) + 3 (scan2)

console.log(`\n${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);