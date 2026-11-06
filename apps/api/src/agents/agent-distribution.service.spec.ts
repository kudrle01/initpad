import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config';
import { AgentDistributionService } from './agent-distribution.service';

describe('AgentDistributionService', () => {
  const originalDistribution = { ...config.agentDistribution };
  const originalRegistryHost = config.registry.host;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'initpad-ca-'));
  });

  afterEach(() => {
    Object.assign(config.agentDistribution, originalDistribution);
    config.registry.host = originalRegistryHost;
    rmSync(dir, { recursive: true, force: true });
  });

  it('offers no private CA when the instance does not use one', async () => {
    config.agentDistribution.privateCaFile = '';
    expect((await new AgentDistributionService().metadata()).privateCa).toBeNull();

    config.agentDistribution.privateCaFile = join(dir, 'missing.crt');
    expect((await new AgentDistributionService().metadata()).privateCa).toBeNull();
  });

  it('pins the exported CA bytes and the registry its Docker daemon must trust', async () => {
    const certificate = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
    const file = join(dir, 'initpad-root-ca.crt');
    config.agentDistribution.privateCaFile = file;
    config.registry.host = 'git.lab.example';
    const service = new AgentDistributionService();

    // Exported after the API started: a cached "no CA" answer would be wrong.
    expect((await service.metadata()).privateCa).toBeNull();
    writeFileSync(file, certificate);

    expect((await service.metadata()).privateCa).toEqual({
      path: '/initpad-ca.crt',
      sha256: createHash('sha256').update(certificate).digest('hex'),
      registryHost: 'git.lab.example',
    });
  });

  it('refuses to publish anything but a public certificate', async () => {
    const file = join(dir, 'initpad-root-ca.crt');
    config.agentDistribution.privateCaFile = file;
    writeFileSync(
      file,
      '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n-----BEGIN EC PRIVATE KEY-----\n',
    );

    await expect(new AgentDistributionService().metadata()).rejects.toThrow(
      'only a PEM certificate',
    );
  });

  it('publishes secret-free release metadata tied to the reviewed installer bytes', async () => {
    const service = new AgentDistributionService();
    const [metadata, installer] = await Promise.all([service.metadata(), service.installer()]);

    expect(metadata.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(metadata.installer.path).toBe('/api/agent/distribution/install.sh');
    expect(metadata.installer.sha256).toBe(createHash('sha256').update(installer).digest('hex'));
    expect(installer.toString('utf8')).toContain('#!/bin/sh');
    expect(installer.toString('utf8')).not.toContain('initpad_enroll_');
    expect(JSON.stringify(metadata)).not.toContain('credential');
  });

  it('keeps installation unavailable until an immutable release image is configured', async () => {
    const metadata = await new AgentDistributionService().metadata();

    expect(metadata.available).toBe(metadata.image !== null);
    if (!metadata.available) {
      expect(metadata.unavailableReason).toContain('has not configured');
    }
  });

  it('labels a configured digest with its release version, not bundled source version', async () => {
    config.agentDistribution.image = `ghcr.io/example/initpad-agent@sha256:${'a'.repeat(64)}`;
    config.agentDistribution.releaseVersion = '0.10.0';

    const metadata = await new AgentDistributionService().metadata();

    expect(metadata.available).toBe(true);
    expect(metadata.version).toBe('0.10.0');
    expect(metadata.image).toBe(config.agentDistribution.image);
  });
});
