/* eslint-disable no-console */
const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const legacyMigrations = [
  '20260629192020_init',
  '20260630135451_add_user_password_auth',
  '20260701194734_project_name_unique_per_owner',
  '20260701212916_add_env_status_reason',
  '20260705200800_env_allocated_port',
  '20260707120000_env_deploy_target',
  '20260710120000_targets',
];

const currentMigrations = [
  '20260712160000_project_ci_token',
  '20260712163000_deployment_operations',
];

function prisma(args, capture = false) {
  return spawnSync('npx', ['prisma', ...args], {
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
}

async function detectBaseline() {
  const client = new PrismaClient();
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const columns = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
    const requiredLegacy = [
      'User.passwordHash',
      'Project.ownerId',
      'Environment.statusReason',
      'Environment.allocatedPort',
      'Environment.targetId',
      'Target.capabilities',
      'Target.ownerId',
    ];
    if (!requiredLegacy.every((column) => columns.has(column))) {
      throw new Error(
        'The database is non-empty but does not match the last legacy InitPad schema. ' +
          'Refusing to guess a migration baseline; restore a backup or migrate it manually.',
      );
    }

    const hasProjectToken = columns.has('Project.ciDeployTokenHash');
    const hasOperations =
      columns.has('Environment.activeOperationId') &&
      columns.has('DeploymentOperation.status');
    if (hasProjectToken !== hasOperations) {
      throw new Error(
        'The database contains a partially applied deployment-operation upgrade. ' +
          'Restore a backup or finish the migration manually.',
      );
    }
    return hasProjectToken ? [...legacyMigrations, ...currentMigrations] : legacyMigrations;
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  const first = prisma(['migrate', 'deploy'], true);
  const output = `${first.stdout || ''}${first.stderr || ''}`;
  process.stdout.write(output);
  if (first.status === 0) return;
  if (!output.includes('P3005')) process.exit(first.status || 1);

  console.log('Legacy database detected; validating schema before baselining migrations.');
  const baseline = await detectBaseline();
  for (const migration of baseline) {
    const resolved = prisma(['migrate', 'resolve', '--applied', migration]);
    if (resolved.status !== 0) process.exit(resolved.status || 1);
  }
  const deployed = prisma(['migrate', 'deploy']);
  if (deployed.status !== 0) process.exit(deployed.status || 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
