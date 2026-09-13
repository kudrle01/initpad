import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { config } from '../config';

const INSTALLER_PATH = '/api/agent/distribution/install.sh';

export interface AgentDistributionMetadata {
  available: boolean;
  version: string;
  image: string | null;
  unavailableReason: string | null;
  installer: {
    path: string;
    sha256: string;
  };
}

interface DistributionArtifacts {
  installer: Buffer;
  metadata: AgentDistributionMetadata;
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

  metadata(): Promise<AgentDistributionMetadata> {
    return this.artifacts().then(({ metadata }) => metadata);
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
