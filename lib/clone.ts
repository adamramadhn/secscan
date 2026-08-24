import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execFileAsync = promisify(execFile);

const CLONE_TIMEOUT_MS = 120000;

// Regex: https://github.com/<owner>/<repo> — owner/repo hanya [A-Za-z0-9_.-],
// maksimal satu level path (opsional trailing slash, opsional ekstensi .git
// yang sudah tercakup karena '.' termasuk dalam karakter class).
const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/;

/**
 * Validasi URL GitHub publik. Anti SSRF sederhana:
 * - wajib scheme https dan host github.com (regex mengikat sejak awal string)
 * - tolak URL mengandung '@' (userinfo / gaya SSH: git@github.com:...)
 * - tolak '://' kedua (URL bertingkat/nested — '://' pertama milik https,
 *   yang di string 'https://' selalu berada di index 5)
 */
export function isValidGithubUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return false;
  if (!url.startsWith('https://')) return false;
  if (url.includes('@')) return false;
  if (url.indexOf('://') !== 5) return false;
  return GITHUB_URL_RE.test(url);
}

/** URL PR GitHub: https://github.com/<owner>/<repo>/pull/<n> */
export const PR_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)\/?$/;

/**
 * Validasi ref base diff-scope (branch / SHA / tag).
 * Charset ketat + tanpa '..'/'@' — aman dilempar ke execFile tanpa shell.
 */
export function isValidDiffBase(ref: string): boolean {
  if (typeof ref !== 'string') return false;
  const s = ref.trim();
  if (s.length === 0 || s.length > 200) return false;
  return /^[A-Za-z0-9._/-]+$/.test(s) && !s.includes('..') && !s.includes('@');
}

/**
 * Clone repo publik dengan shallow clone (--depth 1) ke destDir.
 * Branch kosong → default 'main'.
 * Mengembalikan {ok: true, path} atau {ok: false, error}.
 */
export async function cloneRepo(
  repoUrl: string,
  branch: string,
  destDir: string,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (!isValidGithubUrl(repoUrl)) {
    return { ok: false, error: 'invalid_github_url' };
  }
  const targetBranch = branch && branch.trim().length > 0 ? branch.trim() : 'main';
  try {
    fs.mkdirSync(destDir, { recursive: true });
    // execFile (bukan exec) agar branch/url tidak melalui shell → bebas injection.
    await execFileAsync('git', ['clone', '--depth', '1', '--branch', targetBranch, repoUrl, destDir], {
      timeout: CLONE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, path: destDir };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = (e.stderr ?? '').trim() || e.message || String(err);
    return { ok: false, error: detail.slice(0, 2000) };
  }
}