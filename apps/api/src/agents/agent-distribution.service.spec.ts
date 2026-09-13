import { createHash } from 'node:crypto';
import { config } from '../config';
import { AgentDistributionService } from './agent-distribution.service';

describe('AgentDistributionService', () => {
  const originalDistribution = { ...config.agentDistribution };

  afterEach(() => Object.assign(config.agentDistribution, originalDistribution));

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
