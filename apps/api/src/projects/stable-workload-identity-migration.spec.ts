import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deploymentSlug } from './project-deployment-identity';

describe('Stable workload identity migration (ADR-155)', () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20261011100000_stable_workload_identity/migration.sql',
    ),
    'utf8',
  );

  it('stores the key every existing workload already runs under', () => {
    expect(migration).toContain('ALTER TABLE "Project" ADD COLUMN "deploymentKey" TEXT;');
    expect(migration).toMatch(/UPDATE "Project"\s+SET "deploymentKey" = /);

    // The SQL has to give the value deploymentSlug() derived until now.
    const expression =
      /lower\("scmOwner" \|\| '-' \|\| "scmRepositoryName"\), '(.+?)', '-', 'g'\),\s+'(.+?)',\s+'',\s+'g'/s.exec(
        migration,
      );
    expect(expression).not.toBeNull();
    const [, replaced, trimmed] = expression!;
    const sql = (owner: string, name: string) =>
      `${owner}-${name}`
        .toLowerCase()
        .replace(new RegExp(replaced, 'g'), '-')
        .replace(new RegExp(trimmed, 'g'), '');
    for (const [owner, name] of [
      ['acme', 'api'],
      ['Acme-Team', 'customer.api'],
      ['_user_', 'my_app.v2'],
      ['a.b', '-c-'],
    ]) {
      expect(sql(owner, name)).toBe(deploymentSlug({ owner, name }));
    }
  });

  it('stays compatible with an older image and touches no running deployment', () => {
    // An older image inserts rows without the new columns.
    expect(migration).not.toMatch(/"deploymentKey"[^;]*NOT NULL/);
    expect(migration).toContain('ALTER TABLE "BuildArtifact" ADD COLUMN "imageRef" TEXT;');
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE\s+FROM)\s+"(?:Environment|BuildArtifact)"/i);
    expect(migration).not.toMatch(/\bDROP\b/i);
  });
});
