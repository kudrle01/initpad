import { rm } from 'node:fs/promises';
import { loadConfig, normalizeControlPlaneUrl, saveConfig } from './config.js';
import { heartbeatOnce } from './runtime.js';
import type { AgentConfig } from './types.js';

type VerifyCandidate = (config: AgentConfig, configPath: string) => Promise<unknown>;

export interface ControlPlaneMigration {
  changed: boolean;
  from: string;
  to: string;
}

/**
 * Moves an existing identity to another public URL of the same control plane.
 * The saved credential is sent to the candidate endpoint and the durable
 * config is replaced only after that endpoint accepts a heartbeat.
 */
export async function migrateControlPlaneUrl(
  configPath: string,
  requestedUrl: string,
  allowInsecureHttp = false,
  verify: VerifyCandidate = (config, candidatePath) =>
    heartbeatOnce(config, undefined, candidatePath),
): Promise<ControlPlaneMigration> {
  const current = await loadConfig(configPath);
  const nextUrl = normalizeControlPlaneUrl(requestedUrl, allowInsecureHttp);
  if (current.controlPlaneUrl === nextUrl) {
    return { changed: false, from: current.controlPlaneUrl, to: nextUrl };
  }

  const candidate: AgentConfig = { ...current, controlPlaneUrl: nextUrl };
  const candidatePath = `${configPath}.url-migration-${process.pid}`;
  try {
    await saveConfig(candidatePath, candidate);
    await verify(candidate, candidatePath);
    await saveConfig(configPath, candidate);
  } finally {
    await rm(candidatePath, { force: true });
  }

  return { changed: true, from: current.controlPlaneUrl, to: nextUrl };
}
