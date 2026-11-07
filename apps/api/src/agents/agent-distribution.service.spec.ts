import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config';
import { AgentDistributionService } from './agent-distribution.service';

// Public half of a throwaway self-signed root; its key was never kept.
const TEST_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIBbTCCARKgAwIBAgIUFkqhp7bScIYp8O/MmNAkqFz1i5swCgYIKoZIzj0EAwIw
HDEaMBgGA1UEAwwRSW5pdFBhZCBUZXN0IFJvb3QwHhcNMjYxMTA3MTgwNzEzWhcN
MzYxMTA0MTgwNzEzWjAcMRowGAYDVQQDDBFJbml0UGFkIFRlc3QgUm9vdDBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABLXIWhKs9NYYebkPvIKcFxid/cyRP4aHODdU
4iLqO37o8PfuZsBDb6Nd0B64ua0fikozJiKctpwhUrFahy/ttV+jMjAwMB0GA1Ud
DgQWBBTzz/pkbB4rUHYBK45WcRDi35YZnjAPBgNVHRMBAf8EBTADAQH/MAoGCCqG
SM49BAMCA0kAMEYCIQDqgKzySIilHZPNFkuz6V5Jpb4v2lm+uUZlQOxrNuCLCgIh
AMSqHfeH4SEr+9RS8RYdgNcHc5s2sROuZoeEmxSPeJDi
-----END CERTIFICATE-----
`;

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
      fingerprintSha256: createHash('sha256').update(Buffer.from('MIIB', 'base64')).digest('hex'),
      registryHost: 'git.lab.example',
    });
  });

  it('reports the fingerprint browsers show, which hashes the DER bytes', async () => {
    // A real self-signed root, so the value can be compared with Node's parser.
    const { X509Certificate } = await import('node:crypto');
    const file = join(dir, 'initpad-root-ca.crt');
    config.agentDistribution.privateCaFile = file;
    writeFileSync(file, TEST_ROOT_CA);

    const ca = (await new AgentDistributionService().metadata()).privateCa;

    expect(ca?.fingerprintSha256).toBe(
      new X509Certificate(TEST_ROOT_CA).fingerprint256.replace(/:/g, '').toLowerCase(),
    );
    expect(ca?.fingerprintSha256).not.toBe(ca?.sha256);
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
