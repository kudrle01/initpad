import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { config } from '../config';

const INSTALLER_PATH = '/api/agent/distribution/install.sh';
// Served by the bundled Caddy over plain HTTP as well, because a new Agent
// server cannot verify HTTPS before it has the CA (ADR-161).
const PRIVATE_CA_PATH = '/initpad-ca.crt';

export interface AgentPrivateCa {
  /** Platform-relative download path of the public root certificate. */
  path: string;
  /** SHA-256 of the exact certificate bytes; the command verifies it. */
  sha256: string;
  /** Registry the Agent server's Docker daemon pulls images from. */
  registryHost: string;
}

export interface AgentDistributionMetadata {
  available: boolean;
  version: string;
  image: string | null;
  unavailableReason: string | null;
  installer: {
    path: string;
    sha256: string;
  };
  privateCa: AgentPrivateCa | null;
}

type StaticMetadata = Omit<AgentDistributionMetadata, 'privateCa'>;

interface DistributionArtifacts {
  installer: Buffer;
  metadata: StaticMetadata;
}

/**
 * The CA is read on every request: install.sh exports it only after Caddy has
 * started, and a reconfiguration may add, replace or remove it without the
 * API process restarting.
 */
async function readPrivateCa(): Promise<AgentPrivateCa | null> {
  const file = config.agentDistribution.privateCaFile;
  if (!file) return null;
  let certificate: Buffer;
  try {
    certificate = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const text = certificate.toString('utf8');
  // Only a public certificate may ever be offered, never key material.
  if (!text.startsWith('-----BEGIN CERTIFICATE-----') || text.includes('PRIVATE KEY')) {
    throw new Error('The private CA file must contain only a PEM certificate');
  }
  return {
    path: PRIVATE_CA_PATH,
    sha256: createHash('sha256').update(certificate).digest('hex'),
    registryHost: config.registry.host,
  };
}

function parseVersion(packageJson: Buffer): string {
  const parsed: unknown = JSON.parse(packageJson.toString('utf8'));
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('version' in parsed) ||
    typeof parsed.version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(parsed.version)
  ) {
    throw new Error('Agent package version is invalid');
  }
  return parsed.version;
}

/** Public, secret-free release metadata and the reviewed Linux installer. */
@Injectable()
export class AgentDistributionService {
  private artifactsPromise: Promise<DistributionArtifacts> | null = null;

  async metadata(): Promise<AgentDistributionMetadata> {
    const [{ metadata }, privateCa] = await Promise.all([this.artifacts(), readPrivateCa()]);
    return { ...metadata, privateCa };
  }

  installer(): Promise<Buffer> {
    return this.artifacts().then(({ installer }) => installer);
  }

  private artifacts(): Promise<DistributionArtifacts> {
    if (!this.artifactsPromise) this.artifactsPromise = this.loadArtifacts();
    return this.artifactsPromise;
  }

  private async loadArtifacts(): Promise<DistributionArtifacts> {
    const [installer, packageJson] = await Promise.all([
      readFile(config.agentDistribution.installerPath),
      readFile(config.agentDistribution.packagePath),
    ]);
    if (!installer.toString('utf8', 0, 10).startsWith('#!/bin/sh')) {
      throw new Error('Agent installer is invalid');
    }

    const image = config.agentDistribution.image || null;
    const sourceVersion = parseVersion(packageJson);
    return {
      installer,
      metadata: {
        available: image !== null,
        // A configured release can intentionally lag the control-plane source.
        // Its operator-confirmed version is therefore authoritative whenever
        // the immutable image is offered to users.
        version: config.agentDistribution.releaseVersion || sourceVersion,
        image,
        unavailableReason: image
          ? null
          : 'This InitPad instance has not configured a published Agent image yet.',
        installer: {
          path: INSTALLER_PATH,
          sha256: createHash('sha256').update(installer).digest('hex'),
        },
      },
    };
  }
}
