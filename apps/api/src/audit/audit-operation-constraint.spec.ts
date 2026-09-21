import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('AuditEvent operation constraint migration', () => {
  it('keeps every application operation type valid as an atomic pair', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260921130000_agent_job_audit_operations/migration.sql',
      ),
      'utf8',
    );

    expect(migration).toContain("\"operationType\" IN ('deployment', 'provisioning', 'agent-job')");
    expect(migration).toContain('("operationType" IS NULL AND "operationId" IS NULL)');
    expect(migration).toContain('"operationId" IS NOT NULL');
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS "AuditEvent_operation_pair_check"');
  });
});
