import { createHash } from 'node:crypto';
import { AgentDistributionService } from './agent-distribution.service';

describe('AgentDistributionService', () => {
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
});
