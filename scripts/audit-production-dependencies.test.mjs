import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateAuditReport } from './audit-production-dependencies.mjs';

const policy = {
  schemaVersion: 1,
  exceptions: [
    {
      id: 'GHSA-reviewed',
      source: 42,
      package: 'cache',
      severity: 'high',
      affectedPackages: ['cache', 'fetcher', 'root'],
      directPackages: ['root'],
      expiresOn: '2026-11-02',
      reason: 'Test-only reviewed exception.',
    },
  ],
};

function report(extra = {}) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      cache: {
        severity: 'high',
        isDirect: false,
        via: [{ source: 42, url: 'https://github.com/advisories/GHSA-reviewed' }],
      },
      fetcher: { severity: 'high', isDirect: false, via: ['cache'] },
      root: { severity: 'high', isDirect: true, via: ['fetcher'] },
      ...extra,
    },
  };
}

test('accepts only the exact reviewed dependency chain before expiry', () => {
  const result = evaluateAuditReport(report(), policy, new Date('2026-10-03T00:00:00Z'));
  assert.deepEqual(result, { ok: true, failures: [], accepted: ['GHSA-reviewed'] });
});

test('rejects a new advisory even when another exception remains valid', () => {
  const result = evaluateAuditReport(
    report({ other: { severity: 'moderate', isDirect: true, via: [] } }),
    policy,
    new Date('2026-10-03T00:00:00Z'),
  );
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /other: unreviewed moderate production vulnerability/);
});

test('rejects an expired exception and a changed dependency root', () => {
  const expired = evaluateAuditReport(report(), policy, new Date('2026-11-03T00:00:00Z'));
  assert.match(expired.failures.join('\n'), /expired on 2026-11-02/);

  const changed = report();
  changed.vulnerabilities.fetcher.isDirect = true;
  const rootChanged = evaluateAuditReport(changed, policy, new Date('2026-10-03T00:00:00Z'));
  assert.match(rootChanged.failures.join('\n'), /direct production dependency roots changed/);
});

test('requires stale exceptions to be removed after an upstream fix', () => {
  const result = evaluateAuditReport(
    { auditReportVersion: 2, vulnerabilities: {} },
    policy,
    new Date('2026-10-03T00:00:00Z'),
  );
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /exception is no longer needed/);
});
