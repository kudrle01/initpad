import { describe, expect, it } from 'vitest';
import { deploymentProgress } from './deployment-progress';

describe('deploymentProgress', () => {
  it('maps known lifecycle messages without claiming completion', () => {
    expect(deploymentProgress('Preparing deployment')).toBe(25);
    expect(deploymentProgress('Verifying deployment')).toBe(94);
  });

  it('scales upload counters into the upload phase', () => {
    expect(deploymentProgress('Uploading files 0 / 10')).toBe(42);
    expect(deploymentProgress('Uploading files 5 / 10')).toBe(55);
    expect(deploymentProgress('Uploading files 10 / 10')).toBe(68);
  });

  it('keeps unknown counters below the final success state', () => {
    expect(deploymentProgress('Processing 9 / 10')).toBe(90);
    expect(deploymentProgress('Processing 10 / 10')).toBe(94);
    expect(deploymentProgress(null)).toBeNull();
  });
});
