import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exceptionPath = resolve(root, 'security/npm-audit-exceptions.json');

function dateOnly(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid audit exception date: ${value}`);
  return parsed.toISOString().slice(0, 10);
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameValues(left, right) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function exceptionAccepts(exception, name, vulnerability) {
  if (!exception.affectedPackages.includes(name)) return false;
  if (!Array.isArray(vulnerability.via) || vulnerability.via.length === 0) return false;
  return vulnerability.via.every((via) => {
    if (typeof via === 'string') return exception.affectedPackages.includes(via);
    return via.source === exception.source && via.url?.endsWith(exception.id);
  });
}

export function evaluateAuditReport(report, policy, now = new Date()) {
  if (report?.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object') {
    return { ok: false, failures: ['npm returned an unsupported audit report'], accepted: [] };
  }
  if (policy?.schemaVersion !== 1 || !Array.isArray(policy.exceptions)) {
    return { ok: false, failures: ['npm audit exception policy is invalid'], accepted: [] };
  }

  const failures = [];
  const accepted = [];
  const vulnerabilities = report.vulnerabilities;
  const currentDate = dateOnly(now);

  for (const exception of policy.exceptions) {
    const expected = exception.affectedPackages ?? [];
    const present = expected.filter((name) => vulnerabilities[name]);
    if (present.length === 0) {
      failures.push(`${exception.id}: exception is no longer needed and must be removed`);
      continue;
    }
    if (dateOnly(exception.expiresOn) < currentDate) {
      failures.push(`${exception.id}: reviewed exception expired on ${exception.expiresOn}`);
      continue;
    }
    if (!sameValues(present, expected)) {
      failures.push(`${exception.id}: affected dependency chain changed and requires review`);
      continue;
    }
    if (expected.some((name) => vulnerabilities[name].severity !== exception.severity)) {
      failures.push(`${exception.id}: advisory severity changed and requires review`);
      continue;
    }
    const primary = vulnerabilities[exception.package];
    const hasAdvisory = primary?.via.some(
      (via) =>
        typeof via === 'object' &&
        via.source === exception.source &&
        via.url?.endsWith(exception.id),
    );
    if (!hasAdvisory) {
      failures.push(`${exception.id}: advisory identity or primary package changed`);
      continue;
    }
    const direct = expected.filter((name) => vulnerabilities[name]?.isDirect);
    if (!sameValues(direct, exception.directPackages ?? [])) {
      failures.push(`${exception.id}: direct production dependency roots changed`);
      continue;
    }
    accepted.push(exception.id);
  }

  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    if (!policy.exceptions.some((exception) => exceptionAccepts(exception, name, vulnerability))) {
      failures.push(`${name}: unreviewed ${vulnerability.severity} production vulnerability`);
    }
  }

  return { ok: failures.length === 0, failures, accepted };
}

function main() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const audit = spawnSync(npm, ['audit', '--omit=dev', '--audit-level=low', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    console.error('Production dependency audit failed: npm did not return a JSON report');
    if (audit.error) console.error(audit.error.message);
    if (audit.stderr?.trim()) console.error(audit.stderr.trim());
    process.exitCode = 1;
    return;
  }
  if (report.error) {
    console.error(
      `Production dependency audit failed: ${report.error.summary ?? 'npm audit error'}`,
    );
    process.exitCode = 1;
    return;
  }

  const policy = JSON.parse(readFileSync(exceptionPath, 'utf8'));
  const result = evaluateAuditReport(report, policy);
  if (!result.ok) {
    for (const failure of result.failures)
      console.error(`Production dependency audit failed: ${failure}`);
    process.exitCode = 1;
    return;
  }
  if (result.accepted.length === 0) {
    console.log('Production dependency audit passed with no known vulnerabilities.');
  } else {
    console.log(
      `Production dependency audit passed with reviewed time-bound exception(s): ${result.accepted.join(', ')}.`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
