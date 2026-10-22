process.env.DB_PATH = ':memory:';

import { parseTrivyOutput, isTrivyAvailable } from '../lib/trivy';

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
  console.log('--- Test Trivy JSON Parser with Vulnerabilities & Secrets ---');

  const sampleReport = {
    SchemaVersion: 2,
    ArtifactName: 'secscan',
    ArtifactType: 'filesystem',
    Results: [
      {
        Target: 'package-lock.json',
        Class: 'lang-pkgs',
        Type: 'npm',
        Vulnerabilities: [
          {
            VulnerabilityID: 'CVE-2023-45853',
            PkgName: 'zlib',
            InstalledVersion: '1.2.11',
            FixedVersion: '1.2.12',
            Title: 'MiniZip integer overflow',
            Description: 'MiniZip in zlib through 1.2.13 has an integer overflow...',
            Severity: 'CRITICAL',
            CweIDs: ['CWE-190', 'CWE-122'],
            PrimaryURL: 'https://avd.aquasec.com/nvd/cve-2023-45853',
          },
          {
            VulnerabilityID: 'CVE-2021-23337',
            PkgName: 'lodash',
            InstalledVersion: '4.17.20',
            FixedVersion: '4.17.21',
            Title: 'Command Injection in lodash',
            Severity: 'HIGH',
            CweIDs: ['CWE-78'],
          },
        ],
      },
      {
        Target: 'config/aws.env',
        Class: 'config',
        Secrets: [
          {
            RuleID: 'aws-access-key-id',
            Category: 'AWS',
            Severity: 'CRITICAL',
            Title: 'AWS Access Key ID',
            StartLine: 12,
            EndLine: 12,
            Match: 'AKIAIOSFODNN7EXAMPLE',
          },
        ],
      },
    ],
  };

  const findings = parseTrivyOutput(sampleReport);
  check('Extracted 3 total findings from Trivy report', findings.length === 3);

  const vulnFinding = findings.find((f) => f.cve_id === 'CVE-2023-45853');
  check('Parsed vulnerability has correct CVE ID', vulnFinding?.cve_id === 'CVE-2023-45853');
  check('Parsed vulnerability has mapped CWE IDs', Boolean(vulnFinding?.cwe_id?.includes('CWE-190') && vulnFinding?.cwe_id?.includes('CWE-122')));
  check('Parsed vulnerability has Critical severity', vulnFinding?.severity === 'Critical');
  check('Parsed vulnerability has source_tool = trivy', vulnFinding?.source_tool === 'trivy');
  check('Parsed vulnerability has confidence = high', vulnFinding?.confidence === 'high');
  check('Parsed vulnerability has validation_status = confirmed', vulnFinding?.validation_status === 'confirmed');
  check('Parsed vulnerability has manifest evidence', Boolean(vulnFinding?.validation_evidence?.includes('package-lock.json')));

  const secretFinding = findings.find((f) => f.title.includes('AWS Access Key ID'));
  check('Parsed secret has CWE-798', secretFinding?.cwe_id === 'CWE-798');
  check('Parsed secret has location with line number', secretFinding?.location === 'config/aws.env:12');
  check('Parsed secret has source_tool = trivy', secretFinding?.source_tool === 'trivy');
  check('Parsed secret has validation_status = confirmed', secretFinding?.validation_status === 'confirmed');

  console.log('--- Test Graceful Handling of Empty or Corrupt JSON ---');
  check('Empty string produces 0 findings', parseTrivyOutput('').length === 0);
  check('Invalid JSON produces 0 findings without crash', parseTrivyOutput('{ corrupt json').length === 0);
  check('Empty Results array produces 0 findings', parseTrivyOutput({ Results: [] }).length === 0);

  console.log('--- Test isTrivyAvailable ---');
  const available = isTrivyAvailable('definitely-not-installed-binary-xyz');
  check('Missing binary returns false cleanly', !available);

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
