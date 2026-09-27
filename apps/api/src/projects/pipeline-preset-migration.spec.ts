import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Project pipeline preset migration', () => {
  it('defaults existing projects without rewriting environments or deployment history', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260926190000_project_pipeline_presets/migration.sql',
      ),
      'utf8',
    );

    expect(migration).toContain(
      'ADD COLUMN "pipelinePreset" TEXT NOT NULL DEFAULT \'dev-test-prod\'',
    );
    expect(migration).toContain(
      "CHECK (\"pipelinePreset\" IN ('dev-test-prod', 'dev-prod', 'prod-only'))",
    );
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE\s+FROM|ALTER\s+TABLE)\s+"Environment"\b/i);
    expect(migration).not.toMatch(/\b"DeploymentOperation"\b/);
  });
});
