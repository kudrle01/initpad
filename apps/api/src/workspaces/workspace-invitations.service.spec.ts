import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { config } from '../config';
import { hashToken } from '../common/token';
import type { RecordAuditEvent } from '../audit/audit-events.service';
import { WorkspaceInvitationsService } from './workspace-invitations.service';

type Row = {
  id: string;
  workspaceId: string;
  email: string;
  role: string;
  tokenHash: string;
  invitedById: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedById: string | null;
  revokedAt: Date | null;
  createdAt: Date;
};

function isPending(row: Row) {
  return !row.acceptedAt && !row.revokedAt && row.expiresAt.getTime() > Date.now();
}

function setup(
  options: {
    mail?: boolean;
    workspaceType?: 'team' | 'personal';
    role?: string | null;
    memberRole?: string | null;
    attachFails?: boolean;
  } = {},
) {
  const rows: Row[] = [];
  const events: RecordAuditEvent[] = [];
  const workspace = { id: 'w1', name: 'Platform team', type: options.workspaceType ?? 'team' };
  const withRelations = (row: Row) => ({
    ...row,
    workspace: { name: workspace.name, type: workspace.type },
    invitedBy: { username: 'alice', name: 'Alice' },
  });
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'expiresAt') return row.expiresAt.getTime() > Date.now();
      return (row as Record<string, unknown>)[key] === value;
    });
  const prisma = {
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    workspace: { findUnique: jest.fn(async () => workspace) },
    user: { findUnique: jest.fn(async () => ({ username: 'alice', name: 'Alice' })) },
    workspaceInvitation: {
      findMany: jest.fn(async () => rows.filter(isPending).map(withRelations)),
      findUnique: jest.fn(async ({ where }: { where: { tokenHash?: string; id?: string } }) => {
        const row = rows.find((r) =>
          where.tokenHash ? r.tokenHash === where.tokenHash : r.id === where.id,
        );
        return row ? withRelations(row) : null;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = {
          id: `i${rows.length + 1}`,
          acceptedAt: null,
          acceptedById: null,
          revokedAt: null,
          createdAt: new Date(),
          ...data,
        } as Row;
        rows.push(row);
        return withRelations(row);
      }),
      updateMany: jest.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
          const hit = rows.filter((row) => matches(row, where));
          for (const row of hit) Object.assign(row, data);
          return { count: hit.length };
        },
      ),
    },
  };
  const workspaces = {
    require: jest.fn(async () => {
      if (options.role === null) throw new NotFoundException('Workspace not found');
      if (options.role && !['owner', 'admin'].includes(options.role)) {
        throw new ForbiddenException('Workspace admin access required');
      }
      return options.role ?? 'owner';
    }),
    roleFor: jest.fn(async () => options.memberRole ?? null),
    attachMember: jest.fn(async () => {
      if (options.attachFails) throw new ForbiddenException('Workspace member limit reached');
    }),
    githubAccess: { assertTeamUsesOrganizations: jest.fn(async () => undefined) },
  };
  const mail = {
    isEnabled: () => options.mail ?? true,
    enqueueAuthMail: jest.fn(async () => undefined),
    scheduleDelivery: jest.fn(),
  };
  const audit = {
    record: jest.fn(async (event: RecordAuditEvent) => {
      events.push(event);
    }),
  };
  const service = new WorkspaceInvitationsService(
    prisma as never,
    workspaces as never,
    mail as never,
    audit,
  );
  return { service, rows, events, mail, workspaces };
}

function tokenOf(mail: { enqueueAuthMail: jest.Mock }): string {
  const [, input] = mail.enqueueAuthMail.mock.calls.at(-1) as [unknown, { url: string }];
  return input.url.split('#')[1];
}

describe('WorkspaceInvitationsService (ADR-188)', () => {
  const originalFrontend = config.auth.frontendUrl;
  beforeEach(() => {
    config.auth.frontendUrl = 'https://initpad.example/';
  });
  afterEach(() => {
    config.auth.frontendUrl = originalFrontend;
  });

  it('e-mails a single-use link and stores only its hash', async () => {
    const { service, rows, mail, events, workspaces } = setup();

    const created = await service.create('u-admin', 'w1', {
      email: ' Bob@Example.test ',
      role: 'maintainer',
    });

    expect(created).toMatchObject({
      delivery: 'email',
      invitation: { email: 'bob@example.test', role: 'maintainer', invitedBy: 'Alice' },
    });
    expect(created.inviteUrl).toBeUndefined();
    const token = tokenOf(mail);
    expect(mail.enqueueAuthMail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: null,
        kind: 'workspace_invite',
        recipient: 'bob@example.test',
        workspaceName: 'Platform team',
        url: `https://initpad.example/invite#${token}`,
      }),
    );
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
    // A team still on a personal GitHub account cannot take new members (ADR-189).
    expect(workspaces.githubAccess.assertTeamUsesOrganizations).toHaveBeenCalledWith('w1');
    expect(events[0]).toMatchObject({ action: 'workspace.invitation_created' });
  });

  it('hands the link to the administrator when SMTP is not configured', async () => {
    const { service, mail } = setup({ mail: false });
    const created = await service.create('u-admin', 'w1', {
      email: 'bob@example.test',
      role: 'member',
    });
    expect(created.delivery).toBe('manual');
    expect(created.inviteUrl).toMatch(/^https:\/\/initpad\.example\/invite#.{20,}$/);
    expect(mail.enqueueAuthMail).not.toHaveBeenCalled();
  });

  it('replaces the previous pending invitation to the same address', async () => {
    const { service, rows } = setup();
    await service.create('u-admin', 'w1', { email: 'bob@example.test', role: 'member' });
    await service.create('u-admin', 'w1', { email: 'BOB@example.test', role: 'viewer' });

    expect(rows[0].revokedAt).toBeInstanceOf(Date);
    expect(rows[1].revokedAt).toBeNull();
    await expect(service.list('u-admin', 'w1')).resolves.toEqual([
      expect.objectContaining({ email: 'bob@example.test', role: 'viewer' }),
    ]);
  });

  it('refuses personal workspaces and non-administrators', async () => {
    await expect(
      setup({ workspaceType: 'personal' }).service.create('u', 'w1', {
        email: 'bob@example.test',
        role: 'member',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup({ role: 'member' }).service.create('u', 'w1', {
        email: 'bob@example.test',
        role: 'member',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('previews and accepts once for the signed-in account', async () => {
    const { service, mail, workspaces, rows, events } = setup();
    await service.create('u-admin', 'w1', { email: 'bob@example.test', role: 'maintainer' });
    const token = tokenOf(mail);

    await expect(service.preview(token)).resolves.toMatchObject({
      workspaceName: 'Platform team',
      role: 'maintainer',
      invitedBy: 'Alice',
      email: 'bob@example.test',
    });
    await expect(service.accept('u-bob', token)).resolves.toEqual({
      workspaceId: 'w1',
      workspaceName: 'Platform team',
      role: 'maintainer',
    });
    expect(workspaces.attachMember).toHaveBeenCalledWith('w1', 'u-bob', 'maintainer');
    expect(rows[0]).toMatchObject({ acceptedById: 'u-bob', acceptedAt: expect.any(Date) });
    expect(events.at(-1)).toMatchObject({
      action: 'workspace.invitation_accepted',
      resourceName: 'bob@example.test',
    });

    await expect(service.accept('u-eve', token)).rejects.toThrow('already used');
    await expect(service.preview(token)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired, revoked or unknown link', async () => {
    const { service, mail, rows } = setup();
    await service.create('u-admin', 'w1', { email: 'bob@example.test', role: 'member' });
    const token = tokenOf(mail);

    await expect(service.accept('u-bob', 'x'.repeat(43))).rejects.toThrow('invalid');
    rows[0].expiresAt = new Date(Date.now() - 1);
    await expect(service.accept('u-bob', token)).rejects.toThrow('expired');

    rows[0].expiresAt = new Date(Date.now() + 60_000);
    await service.revoke('u-admin', 'w1', rows[0].id);
    await expect(service.accept('u-bob', token)).rejects.toThrow('invalid');
    await expect(service.revoke('u-admin', 'w1', rows[0].id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('keeps an existing role and does not add the member twice', async () => {
    const { service, mail, workspaces } = setup({ memberRole: 'admin' });
    await service.create('u-admin', 'w1', { email: 'bob@example.test', role: 'viewer' });

    await expect(service.accept('u-bob', tokenOf(mail))).resolves.toMatchObject({ role: 'admin' });
    expect(workspaces.attachMember).not.toHaveBeenCalled();
  });

  it('releases the link when the workspace is full', async () => {
    const { service, mail, rows } = setup({ attachFails: true });
    await service.create('u-admin', 'w1', { email: 'bob@example.test', role: 'member' });

    await expect(service.accept('u-bob', tokenOf(mail))).rejects.toThrow('member limit');
    expect(rows[0]).toMatchObject({ acceptedAt: null, acceptedById: null });
  });
});
