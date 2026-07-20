import { TargetsService, TargetRow } from './targets.service';
import { encryptSecret } from '../common/secret';
import { ForbiddenException } from '@nestjs/common';
import { config } from '../config';

// parseCaps and connectionForTarget are pure — no Prisma/Deployment needed.
const svc = new TargetsService({} as never, {} as never, {} as never);

describe('parseCaps', () => {
  it('splits, trims and drops empty entries', () => {
    expect(svc.parseCaps('static, php , ,node')).toEqual(['static', 'php', 'node']);
  });
  it('returns [] for an empty string', () => {
    expect(svc.parseCaps('')).toEqual([]);
  });
});

describe('connectionForTarget', () => {
  const base: TargetRow = {
    id: 't1',
    name: 'ESO',
    kind: 'sftp',
    scope: 'user',
    capabilities: 'static,php',
    host: 'eso.example.edu',
    port: 22,
    username: 'kudj05',
    auth: 'password',
    secret: encryptSecret('pw'),
    remotePath: '/www',
    publicUrl: 'https://eso.example.edu/~kudj05',
    verifiedAt: null,
    ownerId: 'u1',
    workspaceId: 'w1',
    createdAt: new Date(),
  };

  it('returns undefined for a built-in target (uses config demo path)', () => {
    expect(svc.connectionForTarget({ ...base, scope: 'builtin' })).toBeUndefined();
  });

  it('builds a password connection for a user target', () => {
    const c = svc.connectionForTarget(base)!;
    expect(c.host).toBe('eso.example.edu');
    expect(c.password).toBe('pw');
    expect(c.privateKey).toBeUndefined();
    expect(c.remoteRoot).toBe('/www');
    expect(c.publicUrl).toBe('https://eso.example.edu/~kudj05');
  });

  it('uses a private key when auth is "key"', () => {
    const c = svc.connectionForTarget({ ...base, auth: 'key', secret: encryptSecret('PEMKEY') })!;
    expect(c.privateKey).toBe('PEMKEY');
    expect(c.password).toBeUndefined();
  });
});

describe('target authorization', () => {
  it('requires maintainer access before testing a built-in target', async () => {
    const prisma = {
      target: {
        findUnique: jest.fn(async () => ({
          id: 'builtin-docker',
          scope: 'builtin',
          kind: 'docker',
        })),
      },
    };
    const deployment = { verify: jest.fn() };
    const workspaces = {
      resolve: jest.fn(async () => ({ id: 'w1', role: 'viewer' })),
      require: jest.fn(async () => {
        throw new ForbiddenException();
      }),
    };
    const service = new TargetsService(prisma as never, deployment as never, workspaces as never);

    await expect(service.verify('builtin-docker', 'u1', 'w1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(deployment.verify).not.toHaveBeenCalled();
  });
});

describe('target capability updates', () => {
  const row: TargetRow = {
    id: 'target-1',
    name: 'ESO',
    kind: 'sftp',
    scope: 'user',
    capabilities: 'static',
    host: 'eso.example.edu',
    port: 22,
    username: 'student',
    auth: 'password',
    secret: encryptSecret('pw'),
    remotePath: '/www',
    publicUrl: 'https://eso.example.edu/~student',
    verifiedAt: new Date(),
    ownerId: 'u1',
    workspaceId: 'w1',
    createdAt: new Date(),
  };

  function serviceWithTarget(capabilities = row.capabilities) {
    const current = { ...row, capabilities };
    const prisma = {
      target: {
        findUnique: jest.fn(async () => current),
        update: jest.fn(async ({ data }: { data: Partial<TargetRow> }) => ({ ...current, ...data })),
      },
      environment: { count: jest.fn(async () => 2), updateMany: jest.fn() },
    };
    const workspaces = { require: jest.fn(async () => 'maintainer') };
    return {
      service: new TargetsService(prisma as never, {} as never, workspaces as never),
      prisma,
    };
  }

  it('allows adding PHP to a static target that already hosts environments', async () => {
    const { service, prisma } = serviceWithTarget();

    await expect(
      service.update('target-1', 'u1', { capabilities: ['static', 'php'] }),
    ).resolves.toMatchObject({ capabilities: ['php', 'static'], verifiedAt: null });
    expect(prisma.environment.count).not.toHaveBeenCalled();
  });

  it('blocks removing a capability from a target that is in use', async () => {
    const { service } = serviceWithTarget('static,php');

    await expect(
      service.update('target-1', 'u1', { capabilities: ['php'] }),
    ).rejects.toThrow('cannot change kind or remove runtime capabilities');
  });
});

describe('edition-aware target visibility', () => {
  const savedEdition = config.edition;
  afterEach(() => { config.edition = savedEdition; });

  it('does not expose self-hosted built-ins from the public SaaS control plane', async () => {
    config.edition = 'saas';
    const prisma = {
      target: { findMany: jest.fn(async () => []) },
      environment: { groupBy: jest.fn(async () => []) },
    };
    const workspaces = { resolve: jest.fn(async () => ({ id: 'workspace-1' })) };
    const service = new TargetsService(prisma as never, {} as never, workspaces as never);

    await service.listForUser('user-1', 'workspace-1');

    expect(prisma.target.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId: 'workspace-1' },
    }));
  });
});
