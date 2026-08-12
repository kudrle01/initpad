#!/usr/bin/env node
import { parseArgs } from 'node:util';
import {
  loadConfig,
  normalizeControlPlaneUrl,
  preflightConfigStorage,
  saveConfig,
  DEFAULT_CONFIG_PATH,
} from './config.js';
import { enroll } from './control-plane.js';
import { inspectDocker } from './docker.js';
import { heartbeatOnce, runAgent } from './runtime.js';
import { readSecret } from './secret-prompt.js';
import { AGENT_VERSION, PROTOCOL_VERSION } from './types.js';
import type { AgentConfig } from './types.js';

const HELP = `InitPad Agent ${AGENT_VERSION}

Usage:
  initpad-agent enroll --url <control-plane-url> [--allow-insecure-http] [--config <path>]
  initpad-agent run [--config <path>]
  initpad-agent once [--config <path>]
  initpad-agent health [--config <path>]
  initpad-agent version

The enrollment token is requested interactively and is never accepted as a
command-line argument, so it does not enter shell history.
`;

interface CliOptions {
  command: string;
  configPath: string;
  url?: string;
  allowInsecureHttp: boolean;
}

function options(argv: string[]): CliOptions {
  const command = argv[0] || 'help';
  const parsed = parseArgs({
    args: argv.slice(1),
    options: {
      config: { type: 'string' },
      url: { type: 'string' },
      'allow-insecure-http': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  return {
    command: parsed.values.help ? 'help' : command,
    configPath: parsed.values.config || process.env.INITPAD_AGENT_CONFIG || DEFAULT_CONFIG_PATH,
    url: parsed.values.url,
    allowInsecureHttp: parsed.values['allow-insecure-http'] || false,
  };
}

async function enrollAgent(cli: CliOptions): Promise<void> {
  if (!cli.url) throw new Error('enroll requires --url <control-plane-url>');
  const controlPlaneUrl = normalizeControlPlaneUrl(cli.url, cli.allowInsecureHttp);
  const docker = await inspectDocker();
  await preflightConfigStorage(cli.configPath);
  const token = await readSecret('Enrollment token: ');
  if (!/^initpad_enroll_[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error('Enrollment token has an invalid format');
  }
  const response = await enroll(controlPlaneUrl, token);
  const config: AgentConfig = {
    controlPlaneUrl,
    agentId: response.agentId,
    targetId: response.targetId,
    credential: response.credential,
    credentialGeneration: response.credentialGeneration,
    protocolVersion: response.protocolVersion,
    enrolledAt: new Date().toISOString(),
  };
  await saveConfig(cli.configPath, config);
  await heartbeatOnce(config);
  console.log(`Agent enrolled for target ${response.targetId}.`);
  console.log(`Docker ${docker.engineVersion} (${docker.os}/${docker.arch}) is ready.`);
  console.log(`Credential stored in ${cli.configPath} with mode 0600.`);
}

async function main(): Promise<void> {
  const cli = options(process.argv.slice(2));
  if (cli.command === 'help') {
    console.log(HELP);
    return;
  }
  if (cli.command === 'version') {
    console.log(AGENT_VERSION);
    return;
  }
  if (cli.command === 'enroll') {
    await enrollAgent(cli);
    return;
  }
  const config = await loadConfig(cli.configPath);
  if (config.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported stored protocol version ${config.protocolVersion}`);
  }
  if (cli.command === 'health') {
    const docker = await inspectDocker();
    console.log(`ok: Docker ${docker.engineVersion}, target ${config.targetId}`);
    return;
  }
  if (cli.command === 'once') {
    const { response } = await heartbeatOnce(config);
    console.log(`Heartbeat accepted at ${response.acceptedAt}.`);
    return;
  }
  if (cli.command === 'run') {
    const controller = new AbortController();
    process.once('SIGINT', () => controller.abort());
    process.once('SIGTERM', () => controller.abort());
    await runAgent(config, controller.signal);
    return;
  }
  throw new Error(`Unknown command '${cli.command}'\n\n${HELP}`);
}

main().catch((error: unknown) => {
  console.error(`initpad-agent: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exitCode = 1;
});
