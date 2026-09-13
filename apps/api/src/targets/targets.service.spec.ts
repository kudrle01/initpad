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
    hostKeyFingerprint: 'SHA256:OQnj8QkyP0DwPcCH2RppMp1ARe0QOs/7G8aFAdhEErg',
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

  it('refuses a user-managed host until its identity is pinned', () => {
    expect(() => svc.connectionForTarget({ ...base, hostKeyFingerprint: null })).toThrow(
      'no trusted SSH host-key fingerprint',
    );
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

  it('uses Agent heartbeat instead of probing the control-plane Docker daemon', async () => {
    const prisma = {
      target: {
        findUnique: jest.fn(async () => ({
          id: 'agent-docker',
          scope: 'user',
          kind: 'docker',
          workspaceId: 'w1',
        })),
      },
    };
    const deployment = { verify: jest.fn() };
    const workspaces = { require: jest.fn(async () => 'maintainer') };
    const service = new TargetsService(prisma as never, deployment as never, workspaces as never);

    await expect(service.verify('agent-docker', 'u1')).rejects.toThrow('Agent heartbeat');
    expect(deployment.verify).not.toHaveBeenCalled();
  });
});

describe('Agent-backed Docker target creation', () => {
  function setup() {
    const create = jest.fn(async ({ data }: { data: Record<string, any> }) => {
      const { allocations: _allocations, ...targetData } = data;
      return {
        id: 'target-agent',
        verifiedAt: null,
        createdAt: new Date(),
        ...targetData,
        allocations: [
          {
            id: 'allocation-default',
            capabilities: targetData.capabilities,
            maxEnvironments: 50,
          },
        ],
      };
    });
    const prisma = {
      target: { findFirst: jest.fn(async () => null), create },
      workspace: { findUniqueOrThrow: jest.fn(async () => ({ slug: 'team-alpha' })) },
    };
    const workspaces = {
      resolve: jest.fn(async () => ({ id: 'workspace-1', role: 'owner' })),
      require: jest.fn(async () => 'owner'),
    };
    const audit = { record: jest.fn(async () => undefined) };
    return {
      service: new TargetsService(
        prisma as never,
        {} as never,
        workspaces as never,
        audit as never,
      ),
      create,
      audit,
    };
  }

  it('creates an outbound-only Docker target without inbound credentials', async () => {
    const { service, create, audit } = setup();

    await expect(
      service.create(
        'owner-1',
        {
          name: 'Office Docker',
          kind: 'docker',
          capabilities: ['static', 'node', 'php', 'python'],
          publicUrl: 'http://192.168.1.50',
        },
        'workspace-1',
      ),
    ).resolves.toMatchObject({
      id: 'target-agent',
      kind: 'docker',
      routingMode: 'direct-port',
      host: null,
      verifiedAt: null,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'docker',
          host: null,
          port: null,
          username: null,
          auth: null,
          secret: null,
          remotePath: null,
          workspaceId: 'workspace-1',
          allocations: {
            create: expect.objectContaining({
              workspaceId: 'workspace-1',
              namespace: 'team-alpha',
              capabilities: 'node,php,python,static',
            }),
          },
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      actorUserId: 'owner-1',
      action: 'target.created',
      resourceType: 'target',
      resourceId: 'target-agent',
      resourceName: 'Office Docker',
      details: {
        kind: 'docker',
        routingMode: 'direct-port',
        capabilities: 'node,php,python,static',
      },
    });
    expect(audit.record).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      actorUserId: 'owner-1',
      action: 'allocation.created',
      resourceType: 'allocation',
      resourceId: 'allocation-default',
      resourceName: 'Office Docker',
      details: {
        targetId: 'target-agent',
        capabilities: 'node,php,python,static',
        maxEnvironments: 50,
        source: 'target-default',
      },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('publicUrl');
  });

  it('rejects inbound credentials on an Agent-backed Docker target', async () => {
    const { service, create } = setup();

    await expect(
      service.create(
        'owner-1',
        {
          name: 'Unsafe Docker',
          kind: 'docker',
          capabilities: ['node'],
          publicUrl: 'https://apps.example.test',
          host: 'server.example.test',
        },
        'workspace-1',
      ),
    ).rejects.toThrow('must not contain inbound host credentials');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects creation of the deprecated source-based SSH runtime', async () => {
    const { service, create } = setup();

    await expect(
      service.create(
        'owner-1',
        {
          name: 'Legacy VPS',
          kind: 'ssh',
          capabilities: ['node'],
          publicUrl: 'https://apps.example.test',
          host: 'vps.example.test',
          port: 22,
          username: 'deploy',
          auth: 'password',
          secret: 'secret',
          remotePath: '/srv/apps',
        },
        'workspace-1',
      ),
    ).rejects.toThrow('no longer supported');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects malformed and link-local remote target hosts', async () => {
    const base = {
      name: 'Shared hosting',
      kind: 'sftp' as const,
      capabilities: ['static'],
      port: 22,
      username: 'deploy',
      auth: 'password' as const,
      secret: 'secret',
      hostKeyFingerprint: 'SHA256:OQnj8QkyP0DwPcCH2RppMp1ARe0QOs/7G8aFAdhEErg',
      remotePath: '/www',
      publicUrl: 'https://apps.example.test',
    };

    for (const host of ['bad..example.test', '999.999.999.999', 'fe80::1']) {
      const { service, create } = setup();
      await expect(service.create('owner-1', { ...base, host }, 'workspace-1')).rejects.toThrow(
        'reserved or unsafe',
      );
      expect(create).not.toHaveBeenCalled();
    }
  });

  it('rejects private SFTP destinations from the hosted control plane', async () => {
    const previousEdition = config.edition;
    config.edition = 'saas';
    const { service, create } = setup();
    try {
      await expect(
        service.create(
          'owner-1',
          {
            name: 'Private network pivot',
            kind: 'sftp',
            capabilities: ['static'],
            host: '10.20.30.40',
            port: 22,
            username: 'deploy',
            auth: 'password',
            secret: 'secret',
            hostKeyFingerprint: 'SHA256:OQnj8QkyP0DwPcCH2RppMp1ARe0QOs/7G8aFAdhEErg',
            remotePath: '/www',
            publicUrl: 'http://10.20.30.40',
          },
          'workspace-1',
        ),
      ).rejects.toThrow('resolve only to public internet addresses');
      expect(create).not.toHaveBeenCalled();
    } finally {
      config.edition = previousEdition;
    }
  });

  it('keeps private LAN SFTP targets available in the self-hosted edition', async () => {
    const previousEdition = config.edition;
    config.edition = 'self-hosted';
    const { service, create } = setup();
    try {
      await expect(
        service.create(
          'owner-1',
          {
            name: 'School LAN hosting',
            kind: 'sftp',
            capabilities: ['static', 'php'],
            host: '192.168.1.50',
            port: 22,
            username: 'deploy',
            auth: 'password',
            secret: 'secret',
            hostKeyFingerprint: 'SHA256:OQnj8QkyP0DwPcCH2RppMp1ARe0QOs/7G8aFAdhEErg',
            remotePath: '/www',
            publicUrl: 'http://192.168.1.50',
          },
          'workspace-1',
        ),
      ).resolves.toMatchObject({ kind: 'sftp', publicUrl: 'http://192.168.1.50' });
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      config.edition = previousEdition;
    }
  });

  it('rejects a public target URL containing credentials', async () => {
    const { service, create } = setup();

    await expect(
      service.create(
        'owner-1',
        {
          name: 'Shared hosting',
          kind: 'sftp',
          capabilities: ['static'],
          host: 'sftp.example.test',
          port: 22,
          username: 'deploy',
          auth: 'password',
          secret: 'secret',
          hostKeyFingerprint: 'SHA256:OQnj8QkyP0DwPcCH2RppMp1ARe0QOs/7G8aFAdhEErg',
          remotePath: '/www',
          publicUrl: 'https://user:password@apps.example.test',
        },
        'workspace-1',
      ),
    ).rejects.toThrow('safe HTTP(S) address');
    expect(create).not.toHaveBeenCalled();
  });

  it('requires a clean HTTPS DNS origin for managed gateway routing', async () => {
    const { service, create } = setup();

    await expect(
      service.create(
        'owner-1',
        {
          name: 'Production gateway',
          kind: 'docker',
          routingMode: 'managed-gateway',
          capabilities: ['node'],
          publicUrl: 'http://apps.example.test/path',
        },
        'workspace-1',
      ),
    ).rejects.toThrow('HTTPS DNS origin');
    expect(create).not.toHaveBeenCalled();

    await expect(
      service.create(
        'owner-1',
        {
          name: 'Production gateway',
          kind: 'docker',
          routingMode: 'managed-gateway',
          capabilities: ['node'],
          publicUrl: 'https://apps.example.test/',
        },
        'workspace-1',
      ),
    ).resolves.toMatchObject({
      routingMode: 'managed-gateway',
      publicUrl: 'https://apps.example.test',
      agentReady: false,
    });
  });

  it('marks a preflighted Agent 0.8 managed gateway target ready for the picker', async () => {
    const savedStore = { ...config.artifactStore };
    Object.assign(config.artifactStore, {
      bucket: 'test-artifacts',
      accessKeyId: 'test-access',
      secretAccessKey: 'test-secret',
    });
    const prisma = {
      target: {
        findMany: jest.fn(async () => [
          {
            id: 'managed-target',
            name: 'Production gateway',
            kind: 'docker',
            scope: 'user',
            capabilities: 'node',
            host: null,
            port: null,
            username: null,
            auth: null,
            secret: null,
            remotePath: null,
            publicUrl: 'https://apps.example.test',
            routingMode: 'managed-gateway',
            gatewayAdapter: 'caddy',
            gatewayPreflightStatus: 'passed',
            gatewayPreflightAt: new Date(),
            gatewayPreflightError: null,
            verifiedAt: null,
            ownerId: 'owner-1',
            workspaceId: 'workspace-1',
            createdAt: new Date(),
            agent: { credentialHash: 'hash', disabledAt: null, version: '0.8.0' },
          },
        ]),
      },
      environment: { findMany: jest.fn(async () => []) },
    };
    const workspaces = { resolve: jest.fn(async () => ({ id: 'workspace-1' })) };
    const service = new TargetsService(prisma as never, {} as never, workspaces as never);

    try {
      await expect(service.listForUser('owner-1', 'workspace-1')).resolves.toEqual([
        expect.objectContaining({
          id: 'managed-target',
          routingMode: 'managed-gateway',
          agentReady: true,
          gatewayPreflight: expect.objectContaining({ status: 'passed' }),
        }),
      ]);
    } finally {
      Object.assign(config.artifactStore, savedStore);
    }
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
    hostKeyFingerprint: 'SHA256:OQnj8QkyP0DwPcCH2RppMp1ARe0QOs/7G8aFAdhEErg',
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
        update: jest.fn(async ({ data }: { data: Partial<TargetRow> }) => ({
          ...current,
          ...data,
        })),
        delete: jest.fn(async () => current),
      },
      environment: {
        count: jest.fn(async ({ where }: { where: { activeOperationId?: unknown } }) =>
          where.activeOperationId ? 0 : 2,
        ),
        updateMany: jest.fn(),
      },
    };
    const workspaces = { require: jest.fn(async () => 'maintainer') };
    const audit = { record: jest.fn(async () => undefined) };
    return {
      service: new TargetsService(
        prisma as never,
        {} as never,
        workspaces as never,
        audit as never,
      ),
      prisma,
      audit,
    };
  }

  it('allows adding PHP to a static target that already hosts environments', async () => {
    const { service, prisma, audit } = serviceWithTarget();

    await expect(
      service.update('target-1', 'u1', { capabilities: ['static', 'php'] }),
    ).resolves.toMatchObject({ capabilities: ['php', 'static'], verifiedAt: null });
    expect(prisma.environment.count).toHaveBeenCalledWith({
      where: { targetId: 'target-1', activeOperationId: { not: null } },
    });
    expect(audit.record).toHaveBeenCalledWith({
      workspaceId: 'w1',
      actorUserId: 'u1',
      action: 'target.updated',
      resourceType: 'target',
      resourceId: 'target-1',
      resourceName: 'ESO',
      details: { changedFields: 'capabilities' },
    });
  });

  it('records a credential rotation without persisting the credential value in audit details', async () => {
    const { service, audit } = serviceWithTarget();

    await service.update('target-1', 'u1', {
      auth: 'password',
      secret: 'rotated-password',
      publicUrl: row.publicUrl!,
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'target.updated',
        details: { changedFields: 'authenticationCredentials' },
      }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('rotated-password');
  });

  it('does not create an audit event when submitted values are unchanged', async () => {
    const { service, audit } = serviceWithTarget();

    await service.update('target-1', 'u1', { name: row.name, capabilities: ['static'] });

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('keeps the target snapshot when a target is deleted', async () => {
    const { service, prisma, audit } = serviceWithTarget();
    prisma.environment.count.mockResolvedValue(0);

    await service.remove('target-1', 'u1');

    expect(prisma.target.delete).toHaveBeenCalledWith({ where: { id: 'target-1' } });
    expect(audit.record).toHaveBeenCalledWith({
      workspaceId: 'w1',
      actorUserId: 'u1',
      action: 'target.deleted',
      resourceType: 'target',
      resourceId: 'target-1',
      resourceName: 'ESO',
      details: { kind: 'sftp' },
    });
  });

  it('blocks removing a capability from a target that is in use', async () => {
    const { service } = serviceWithTarget('static,php');

    await expect(service.update('target-1', 'u1', { capabilities: ['php'] })).rejects.toThrow(
      'cannot remove runtime capabilities',
    );
  });

  it('does not move a managed gateway DNS origin while environments hold stable routes', async () => {
    const current: TargetRow = {
      ...row,
      kind: 'docker',
      capabilities: 'node',
      host: null,
      port: null,
      username: null,
      auth: null,
      secret: null,
      remotePath: null,
      publicUrl: 'https://apps.example.test',
      routingMode: 'managed-gateway',
      gatewayAdapter: 'caddy',
      gatewayPreflightStatus: 'passed',
      agent: { credentialHash: 'hash', disabledAt: null, version: '0.7.0' },
    };
    const prisma = {
      target: { findUnique: jest.fn(async () => current), update: jest.fn() },
      environment: {
        count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1),
      },
    };
    const workspaces = { require: jest.fn(async () => 'maintainer') };
    const service = new TargetsService(prisma as never, {} as never, workspaces as never);

    await expect(
      service.update('target-1', 'u1', {
        publicUrl: 'https://new-apps.example.test',
      }),
    ).rejects.toThrow('cannot change its DNS origin');
    expect(prisma.target.update).not.toHaveBeenCalled();
  });
});

describe('target management lifecycle', () => {
  const remote: TargetRow = {
    id: 'target-1',
    name: 'Retained server',
    kind: 'sftp',
    scope: 'user',
    capabilities: 'static,php',
    host: 'deploy.example.test',
    port: 22,
    username: 'deploy',
    auth: 'password',
    secret: encryptSecret('secret'),
    hostKeyFingerprint: 'SHA256:OQnj8QkyP0DwPcCH2RppMp1ARe0QOs/7G8aFAdhEErg',
    remotePath: '/srv/apps',
    publicUrl: 'https://apps.example.test',
    managementState: 'active',
    managementStateChangedAt: null,
    verifiedAt: new Date(),
    ownerId: 'owner-1',
    workspaceId: 'workspace-1',
    createdAt: new Date(),
  };

  function setup(activeOperations = 0, current: TargetRow = remote) {
    const targetUpdate = jest.fn(async () => current);
    const prisma: Record<string, any> = {
      target: {
        findUnique: jest.fn(async () => current),
        update: targetUpdate,
      },
      environment: {
        count: jest.fn().mockResolvedValueOnce(activeOperations).mockResolvedValueOnce(2),
      },
      agent: {
        findUnique: jest.fn(async () => null),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      workloadDiagnostic: { updateMany: jest.fn(async () => ({ count: 0 })) },
      agentJob: { updateMany: jest.fn(async () => ({ count: 0 })) },
    };
    prisma.$transaction = jest.fn(async (queries: Promise<unknown>[]) => Promise.all(queries));
    const workspaces = { require: jest.fn(async () => 'admin') };
    const audit = { record: jest.fn(async () => undefined) };
    return {
      service: new TargetsService(
        prisma as never,
        {} as never,
        workspaces as never,
        audit as never,
      ),
      prisma,
      targetUpdate,
      audit,
    };
  }

  it('disconnects management and erases the credential without deleting environment bindings', async () => {
    const { service, prisma, targetUpdate, audit } = setup();

    await service.disconnect(remote.id, 'owner-1');

    expect(targetUpdate).toHaveBeenCalledWith({
      where: { id: remote.id },
      data: expect.objectContaining({
        managementState: 'disconnected',
        verifiedAt: null,
        secret: null,
      }),
    });
    expect(prisma.environment.deleteMany).toBeUndefined();
    expect(prisma.environment.updateMany).toBeUndefined();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'target.disconnected',
        details: { kind: 'sftp', boundEnvironments: 2 },
      }),
    );
  });

  it('does not revoke management while an environment operation is in progress', async () => {
    const { service, targetUpdate } = setup(1);

    await expect(service.retire(remote.id, 'owner-1')).rejects.toThrow('operation(s) in progress');
    expect(targetUpdate).not.toHaveBeenCalled();
  });

  it('rejects management commands after a target is disconnected', () => {
    const { service } = setup();
    expect(() =>
      service.connectionForTarget({
        ...remote,
        managementState: 'disconnected',
      }),
    ).toThrow('cannot receive management commands');
  });

  it('restores a retired target as disconnected so fresh trust is still required', async () => {
    const { service, targetUpdate, audit } = setup(0, {
      ...remote,
      managementState: 'retired',
      secret: null,
    });

    await service.restore(remote.id, 'owner-1');

    expect(targetUpdate).toHaveBeenCalledWith({
      where: { id: remote.id },
      data: expect.objectContaining({
        managementState: 'disconnected',
        verifiedAt: null,
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'target.restored',
        details: { kind: 'sftp', state: 'disconnected' },
      }),
    );
  });
});

describe('edition-aware target visibility', () => {
  const savedEdition = config.edition;
  afterEach(() => {
    config.edition = savedEdition;
  });

  it('does not expose self-hosted built-ins from the public SaaS control plane', async () => {
    config.edition = 'saas';
    const prisma = {
      target: { findMany: jest.fn(async () => []) },
      environment: { findMany: jest.fn(async () => []) },
    };
    const workspaces = { resolve: jest.fn(async () => ({ id: 'workspace-1' })) };
    const service = new TargetsService(prisma as never, {} as never, workspaces as never);

    await service.listForUser('user-1', 'workspace-1');

    expect(prisma.target.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'workspace-1' },
      }),
    );
  });

  it('hides a known built-in id from direct SaaS access', async () => {
    config.edition = 'saas';
    const prisma = {
      target: {
        findUnique: jest.fn(async () => ({
          id: 'builtin-docker',
          scope: 'builtin',
          kind: 'docker',
        })),
      },
    };
    const service = new TargetsService(prisma as never, {} as never, {} as never);

    await expect(service.getVisibleTarget('builtin-docker', 'user-1')).rejects.toThrow(
      "Target 'builtin-docker' not found",
    );
  });

  it('does not seed local built-ins while running as SaaS', async () => {
    config.edition = 'saas';
    const upsert = jest.fn();
    const service = new TargetsService({ target: { upsert } } as never, {} as never, {} as never);

    await service.onModuleInit();

    expect(upsert).not.toHaveBeenCalled();
  });
});
