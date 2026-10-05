import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Legacy SSH runtime removal migration', () => {
  it('refuses to remove a target while any environment still references SSH', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20261006100000_remove_legacy_ssh_runtime/migration.sql',
      ),
      'utf8',
    );

    const guard = migration.indexOf('IF EXISTS');
    const failure = migration.indexOf('RAISE EXCEPTION');
    const deleteAllocations = migration.indexOf('DELETE FROM "TargetAllocation"');
    const deleteTargets = migration.indexOf('DELETE FROM "Target"');
    const dropPort = migration.indexOf('DROP COLUMN "allocatedPort"');

    expect(migration).toContain('environment."provider" = \'ssh\'');
    expect(migration).toContain('target."kind" = \'ssh\'');
    expect(migration).toContain('allocation_target."kind" = \'ssh\'');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(failure).toBeGreaterThan(guard);
    expect(deleteAllocations).toBeGreaterThan(failure);
    expect(deleteTargets).toBeGreaterThan(deleteAllocations);
    expect(dropPort).toBeGreaterThan(deleteTargets);
  });
});
