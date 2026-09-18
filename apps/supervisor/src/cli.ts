#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runServer } from './server.js';
import { adoptCurrentRelease } from './state.js';
import { PlatformUpdater } from './updater.js';
import { SUPERVISOR_VERSION } from './types.js';

async function health(): Promise<void> {
  const port = Number(process.env.INITPAD_SUPERVISOR_PORT || 7070);
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`Supervisor health returned HTTP ${response.status}`);
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      plan: { type: 'string' },
      version: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = parsed.positionals[0] || 'serve';
  if (parsed.values.help) {
    console.log(
      'Usage: initpad-supervisor <serve|health|version|update-helper|adopt-current-release> [options]',
    );
    return;
  }
  if (command === 'version') {
    console.log(SUPERVISOR_VERSION);
    return;
  }
  if (command === 'health') {
    await health();
    return;
  }
  if (command === 'update-helper') {
    if (!parsed.values.plan) throw new Error('update-helper requires --plan');
    await new PlatformUpdater().applyPlan(parsed.values.plan);
    return;
  }
  if (command === 'adopt-current-release') {
    if (!parsed.values.version) throw new Error('adopt-current-release requires --version');
    await adoptCurrentRelease(parsed.values.version);
    return;
  }
  if (command !== 'serve') throw new Error(`Unknown command '${command}'`);
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  await runServer(controller.signal);
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'supervisor.failed',
      message: error instanceof Error ? error.message : 'Unknown Supervisor failure',
    }),
  );
  process.exitCode = 1;
});
