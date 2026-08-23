export type SkillCategory = 'ofensif' | 'scanning' | 'analisis';

export interface SkillDef {
  name: string;
  category: SkillCategory;
  description: string;
  ofensif: boolean;
}

export const SKILLS: SkillDef[] = [
  // scanning
  { name: 'sast-scanning', category: 'scanning', description: 'Static analysis kode sumber untuk mendeteksi kerentanan.', ofensif: false },
  { name: 'dependency-scanning', category: 'scanning', description: 'Pemindaian dependency untuk CVE dan versi rentan.', ofensif: false },
  { name: 'container-scanning', category: 'scanning', description: 'Pemindaian image container terhadap kerentanan.', ofensif: false },
  { name: 'vulnerability-scanning', category: 'scanning', description: 'Pemindaian kerentanan umum pada target.', ofensif: false },
  { name: 'supply-chain-attack-response', category: 'scanning', description: 'Deteksi dan respons serangan rantai pasok software.', ofensif: false },
  // ofensif
  { name: 'penetration-testing', category: 'ofensif', description: 'Uji penetrasi aktif untuk mengeksploitasi kelemahan.', ofensif: true },
  { name: 'dast-scanning', category: 'ofensif', description: 'Dynamic analysis aplikasi berjalan untuk menemukan celah.', ofensif: true },
  { name: 'ai-red-teaming', category: 'ofensif', description: 'Serangan terkendali pada sistem AI untuk menguji ketahanan.', ofensif: true },
  // analisis
  { name: 'threat-modeling', category: 'analisis', description: 'Pemodelan ancaman sistematis untuk memahami risiko.', ofensif: false },
  { name: 'incident-response', category: 'analisis', description: 'Analisis dan penanganan insiden keamanan.', ofensif: false },
  { name: 'ai-agent-security', category: 'analisis', description: 'Analisis keamanan untuk agen AI dan tooling-nya.', ofensif: false },
  { name: 'mcp-server-security', category: 'analisis', description: 'Analisis keamanan server MCP dan permukaan serangnya.', ofensif: false },
  { name: 'prompt-injection-defense', category: 'analisis', description: 'Analisis pertahanan terhadap serangan prompt injection.', ofensif: false },
];

const skillIndex = new Map<string, SkillDef>(SKILLS.map((s) => [s.name, s]));

export function getSkill(name: string): SkillDef | undefined {
  return skillIndex.get(name);
}

export const SKILL_GROUPS: Record<SkillCategory, string[]> = {
  ofensif: ['penetration-testing', 'dast-scanning', 'ai-red-teaming'],
  scanning: ['sast-scanning', 'dependency-scanning', 'container-scanning', 'vulnerability-scanning', 'supply-chain-attack-response'],
  analisis: ['threat-modeling', 'incident-response', 'ai-agent-security', 'mcp-server-security', 'prompt-injection-defense'],
};