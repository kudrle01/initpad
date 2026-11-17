import { describe, expect, it } from 'vitest';
import { environmentActivity } from './environment-activity';

describe('environmentActivity', () => {
  it('names removal, stop and start instead of deploying', () => {
    expect(environmentActivity({ status: 'deploying', statusReason: 'Removing deployment' })).toBe(
      'removing',
    );
    expect(environmentActivity({ status: 'deploying', statusReason: 'Stopping environment' })).toBe(
      'stopping',
    );
    expect(environmentActivity({ status: 'deploying', statusReason: 'Starting environment' })).toBe(
      'starting',
    );
  });

  it('keeps the status otherwise', () => {
    expect(environmentActivity({ status: 'deploying', statusReason: 'Preparing deployment' })).toBe(
      'deploying',
    );
    expect(environmentActivity({ status: 'running', statusReason: null })).toBe('running');
  });
});
