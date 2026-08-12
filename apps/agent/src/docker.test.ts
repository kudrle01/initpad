import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDocker } from './docker.js';

test('reports only the bounded Docker capabilities used by the control plane', async () => {
  const request = async (path: string) => {
    if (path === '/_ping') return 'OK';
    if (path === '/version') {
      return JSON.stringify({
        Version: '27.5.1', ApiVersion: '1.47', Os: 'linux', Arch: 'arm64',
        GitCommit: 'must-not-leave-the-agent',
      });
    }
    if (path === '/info') {
      return JSON.stringify({
        NCPU: 4, MemTotal: 8_589_934_592, SecurityOptions: ['name=rootless'],
        Containers: 123, Images: 456, Name: 'private-hostname',
      });
    }
    throw new Error(`Unexpected Docker request: ${path}`);
  };

  assert.deepEqual(await inspectDocker('tcp://docker:2375', request), {
    engineVersion: '27.5.1',
    apiVersion: '1.47',
    os: 'linux',
    arch: 'arm64',
    rootless: true,
    cpus: 4,
    memoryBytes: 8_589_934_592,
  });
});
