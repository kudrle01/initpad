import { config } from '../config';
import type { TemplateManifest } from '../domain/types';
import { ProjectEnvironmentTargets } from './project-environment-targets';
import type { TargetRow } from '../targets/targets.service';

const template = {
  id: 'node-api',
  name: 'Node API',
  language: 'TypeScript',
  runtime: 'node',
  artifact: 'runtime',
  compatibleProviders: ['docker'],
  description: 'test template',
} satisfies TemplateManifest;

const target: TargetRow = {
  id: 'agent-target',
  name: 'Remote Docker',
  kind: 'docker',
  scope: 'user',
  capabilities: 'static,node',
  host: null,
  port: null,
  username: null,
  auth: null,
  secret: null,
  remotePath: null,
  publicUrl: 'https://apps.example.test',
  verifiedAt: null,
  ownerId: 'owner-1',
  workspaceId: 'workspace-1',
  createdAt: new Date(),
  agent: { credentialHash: 'hash', disabledAt: null, version: '0.4.0' },
};

describe('ProjectEnvironmentTargets Agent readiness', () => {
  const savedStore = { ...config.artifactStore };
  const service = new ProjectEnvironmentTargets({} as never, {
    parseCaps: (value: string) => value.split(','),
  } as never);

  afterEach(() => Object.assign(config.artifactStore, savedStore));

  it('accepts an enrolled compatible Agent when artifact delivery is durable', () => {
    Object.assign(config.artifactStore, {
      bucket: 'test-artifacts',
      accessKeyId: 'test-access',
      secretAccessKey: 'test-secret',
    });

    expect(() => service.assertUsable(target, template)).not.toThrow();
  });

  it('rejects missing durable storage, disabled enrollment and an old Agent', () => {
    Object.assign(config.artifactStore, {
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
    });
    expect(() => service.assertUsable(target, template)).toThrow('durable S3/MinIO');

    Object.assign(config.artifactStore, {
      bucket: 'test-artifacts',
      accessKeyId: 'test-access',
      secretAccessKey: 'test-secret',
    });
    expect(() => service.assertUsable({ ...target, agent: null }, template)).toThrow('Enroll');
    expect(() => service.assertUsable({
      ...target,
      agent: { credentialHash: 'hash', disabledAt: null, version: '0.3.0' },
    }, template)).toThrow('0.4.0');
  });

  it('keeps managed gateway targets unavailable until preflight and reconcile exist', () => {
    Object.assign(config.artifactStore, {
      bucket: 'test-artifacts',
      accessKeyId: 'test-access',
      secretAccessKey: 'test-secret',
    });

    expect(() => service.assertUsable({
      ...target,
      routingMode: 'managed-gateway',
    }, template)).toThrow('gateway preflight and reconcile');
  });
});
