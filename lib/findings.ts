/**
 * lib/findings.ts — parser temuan terstruktur dari output skill Hermes.
 *
 * Konvensi laporan skill (dijanjikan oleh prompt di worker):
 *   ## Temuan
 *   - **[High]** Judul temuan — deskripsi singkat.
 *     Lokasi: src/file.ts:12
 *     Rekomendasi: lakukan X.
 *
 * Parser toleran: menerima `-`/`*`/`+`/`### ` sebagai awal item,
 * severity dalam kurung siku atau "Severity: X", field Lokasi/Rekomendasi
 * dalam ID/EN, dan item multi-baris (baris lanjutan berindentasi).
 *
 * Catatan: logika yang sama ada ALSO di worker.js (CommonJS, self-contained) —
 * ubah keduanya bersamaan bila format berubah.
 */

export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface ParsedFinding {
  severity: Severity;
  title: string;
  description: string | null;
  location: string | null;
  recommendation: string | null;
}

const MAX_FINDINGS = 200;
const MAX_TITLE = 300;
const MAX_FIELD = 4000;
const MAX_LOCATION = 500;

function normalizeSeverity(raw: string): Severity | null {
  const s = raw.trim().toLowerCase();
  for (const sev of SEVERITIES) {
    if (sev.toLowerCase() === s) return sev;
  }
  return null;
}

function clean(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/\[(Critical|High|Medium|Low|Info)\]\s*/gi, '')
    .replace(/`/g, '')
    .trim();
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Ambil blok "## Temuan" (atau "## Findings") dari laporan markdown.
 * Heading bertingkat yang berawalan angka (mis. "### 1. Judul") dianggap
 * ITEM temuan, bukan batas section.
 * Mengembalikan string kosong bila tidak ada.
 */
export function extractFindingsSection(markdown: string): string {
  if (typeof markdown !== 'string' || markdown.length === 0) return '';
  const sectionRe = /^#{2,3}[ \t]*(Temuan|Findings)[ \t]*:?[ \t]*$/im;
  const m = markdown.match(sectionRe);
  if (!m || m.index === undefined) return '';
  const rest = markdown.slice(m.index + m[0].length);
  // Batas section: heading h1–h3 yang BUKAN item bernomor ("### 1. ...").
  const next = rest.match(/^#{1,3}[ \t]+(?!\d+[.)])[^\n]*$/m);
  return next && next.index !== undefined ? rest.slice(0, next.index) : rest;
}

/**
 * Parse semua temuan dari output skill. Mengembalikan array (bisa kosong).
 */
export function parseFindings(output: string | null | undefined): ParsedFinding[] {
  if (!output) return [];
  const section = extractFindingsSection(output);
  if (!section) return [];

  const findings: ParsedFinding[] = [];
  const lines = section.split(/\r?\n/);

  const itemRe = /^\s*(?:[-*+]|\d+[.)])[ \t]+/;
  const headingItemRe = /^\s*#{3,6}[ \t]+\d+[.)][ \t]+/;
  const bareBracketRe = /^\s*(?:\*\*)?\[(Critical|High|Medium|Low|Info)\](?:\*\*)?[ \t]+/i;
  const locRe = /^\s*(?:\*\*)?(lokasi|location|file|berkas)(?:\*\*)?[ \t]*[:：][ \t]*(.+)$/i;
  const recRe = /^\s*(?:\*\*)?(rekomendasi|recommendation|perbaikan|remediasi|fix|solusi)(?:\*\*)?[ \t]*[:：][ \t]*(.+)$/i;
  const severityBracket = /\[(Critical|High|Medium|Low|Info)\]/i;
  const severityLabel = /^\s*(?:\*\*)?(?:severity|severitas|tingkat)(?:\*\*)?[ \t]*[:：][ \t]*(Critical|High|Medium|Low|Info)/i;
  const severityParen = /[ \t]*\((?:severity|severitas|tingkat)[ \t]*[:：]?[ \t]*(Critical|High|Medium|Low|Info)\)[ \t]*$/i;

  let current: ParsedFinding | null = null;

  const pushCurrent = () => {
    if (!current) return;
    current.title = clip(clean(current.title), MAX_TITLE) || '(tanpa judul)';
    if (current.description) current.description = clip(clean(current.description), MAX_FIELD);
    if (current.location) current.location = clip(clean(current.location), MAX_LOCATION);
    if (current.recommendation) current.recommendation = clip(clean(current.recommendation), MAX_FIELD);
    findings.push(current);
  };

  for (const line of lines) {
    let body: string | null = null;
    let prefixSeverity: Severity | null = null;
    if (itemRe.test(line)) body = line.replace(itemRe, '');
    else if (headingItemRe.test(line)) body = line.replace(headingItemRe, '');
    else if (bareBracketRe.test(line)) {
      prefixSeverity = normalizeSeverity(line.match(bareBracketRe)![1]);
      body = line.replace(bareBracketRe, '');
    }

    if (body !== null) {
      pushCurrent();
      if (findings.length >= MAX_FINDINGS) break;

      // Severity: [High] / **[High]** / Severity: High / (Severity: High) di akhir judul.
      let severity: Severity | null = null;
      const paren = body.match(severityParen);
      if (paren) {
        severity = normalizeSeverity(paren[1]);
        body = body.replace(severityParen, '');
      }
      const bracket = body.match(severityBracket);
      if (bracket) {
        severity = normalizeSeverity(bracket[1]);
        body = body.replace(severityBracket, '');
      } else if (prefixSeverity) {
        severity = prefixSeverity;
      } else {
        const label = body.match(severityLabel);
        if (label) {
          severity = normalizeSeverity(label[1]);
          body = body.slice(label[0].length);
        }
      }

      // Judul = teks sampai pemisah (— / - / : ) atau akhir baris.
      let title = body;
      let description: string | null = null;
      const sep = title.match(/\s+—\s+|\s+-\s+|\s*[:：]\s+/);
      if (sep && sep.index !== undefined && sep.index > 0) {
        description = title.slice(sep.index + sep[0].length).trim() || null;
        title = title.slice(0, sep.index);
      }
      title = clean(title);
      if (!title) {
        // item tanpa judul jelas — jangan jadikan temuan
        current = null;
        continue;
      }
      current = {
        severity: severity ?? 'Info',
        title,
        description,
        location: null,
        recommendation: null,
      };
      continue;
    }

    if (!current) continue;

    const loc = line.match(locRe);
    if (loc) {
      current.location = (current.location ? `${current.location} ${loc[2].trim()}` : loc[2].trim());
      continue;
    }
    const rec = line.match(recRe);
    if (rec) {
      current.recommendation = (current.recommendation ? `${current.recommendation} ${rec[2].trim()}` : rec[2].trim());
      continue;
    }

    // Baris lanjutan → deskripsi.
    const text = line.trim();
    if (text) {
      const desc = clean(text);
      current.description = current.description ? `${current.description} ${desc}` : desc;
    }
  }
  pushCurrent();

  return findings.slice(0, MAX_FINDINGS);
}
