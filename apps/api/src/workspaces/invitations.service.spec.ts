import { ConflictException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { hashToken } from '../common/token';

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

function baseInvitation(over: Record<string, unknown> = {}) {
  return {
    id: 'inv1', workspaceId: 'ws1', email: 'invitee@example.test', role: 'member',
    status: 'pending', invitedById: 'owner1', acceptedById: null,
    expiresAt: future(), createdAt: new Date(), respondedAt: null,
    invitedBy: { username: 'owner' }, acceptedBy: null, ...over,
  };
}

describe('InvitationsService', () => {
  it('creates a pending invitation and never stores the token in plaintext', async () => {
    let createData: Record<string, unknown> | undefined;
    const prisma = {
      workspace: { findUnique: jest.fn(async () => ({ type: 'team', name: 'Team' })) },
      user: { findFirst: jest.fn(async () => null) },
      workspaceMember: { findUnique: jest.fn(async () => null) },
      workspaceInvitation: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          createData = data;
          return baseInvitation({ ...data });
        }),
      },
    };
    const workspaces = { require: jest.fn(async () => 'admin') };
    const service = new InvitationsService(prisma as never, workspaces as never, {} as never);

    const result = await service.create('owner1', 'ws1', { email: 'Invitee@Example.test', role: 'member' });
    expect(workspaces.require).toHaveBeenCalledWith('owner1', 'ws1', 'admin');
    expect(createData?.email).toBe('invitee@example.test'); // normalised
    expect(createData?.tokenHash).toBe(hashToken(result.token));
    expect(createData?.tokenHash).not.toBe(result.token);
    expect(result.acceptUrl).toContain(`/invite/${result.token}`);
  });

  it('refuses to invite an existing member', async () => {
    const prisma = {
      workspace: { findUnique: jest.fn(async () => ({ type: 'team', name: 'Team' })) },
      user: { findFirst: jest.fn(async () => ({ id: 'u2' })) },
      workspaceMember: { findUnique: jest.fn(async () => ({ workspaceId: 'ws1', userId: 'u2' })) },
      workspaceInvitation: { findFirst: jest.fn() },
    };
    const workspaces = { require: jest.fn(async () => 'admin') };
    const service = new InvitationsService(prisma as never, workspaces as never, {} as never);
    await expect(service.create('owner1', 'ws1', { email: 'u2@example.test', role: 'member' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a duplicate pending invitation', async () => {
    const prisma = {
      workspace: { findUnique: jest.fn(async () => ({ type: 'team', name: 'Team' })) },
      user: { findFirst: jest.fn(async () => null) },
      workspaceMember: { findUnique: jest.fn() },
      workspaceInvitation: { findFirst: jest.fn(async () => baseInvitation()) },
    };
    const workspaces = { require: jest.fn(async () => 'admin') };
    const service = new InvitationsService(prisma as never, workspaces as never, {} as never);
    await expect(service.create('owner1', 'ws1', { email: 'invitee@example.test', role: 'member' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects acceptance when the signed-in e-mail does not match', async () => {
    const token = 'sometoken';
    const prisma = {
      workspaceInvitation: { findUnique: jest.fn(async () => baseInvitation()) },
      user: { findUnique: jest.fn(async () => ({ id: 'u9', username: 'someone', email: 'other@example.test' })) },
    };
    const service = new InvitationsService(prisma as never, {} as never, {} as never);
    await expect(service.accept('u9', token)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts for the matching account and records the acceptance', async () => {
    let updateData: Record<string, unknown> | undefined;
    const prisma = {
      workspaceInvitation: {
        findUnique: jest.fn(async () => baseInvitation()),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { updateData = data; return {}; }),
      },
      user: { findUnique: jest.fn(async () => ({ id: 'u2', username: 'invitee', email: 'invitee@example.test' })) },
      workspaceMember: { findUnique: jest.fn(async () => null) },
    };
    const workspaces = { attachMember: jest.fn(async () => undefined) };
    const service = new InvitationsService(prisma as never, workspaces as never, {} as never);
    await service.accept('u2', 'token');
    expect(workspaces.attachMember).toHaveBeenCalledWith('ws1', 'u2', 'invitee', 'member');
    expect(updateData).toMatchObject({ status: 'accepted', acceptedById: 'u2' });
  });

  it('registers a new account bound to the invited e-mail and accepts', async () => {
    let provisionInput: Record<string, unknown> | undefined;
    const prisma = {
      workspaceInvitation: {
        findUnique: jest.fn(async () => baseInvitation()),
        update: jest.fn(async () => ({})),
      },
      workspaceMember: { findUnique: jest.fn(async () => null) },
    };
    const workspaces = { attachMember: jest.fn(async () => undefined) };
    const auth = {
      provisionManagedUser: jest.fn(async (input: Record<string, unknown>) => {
        provisionInput = input;
        return { id: 'u3', username: input.username, email: input.email, name: null, avatarUrl: null, platformRole: 'user' };
      }),
      createSession: jest.fn((u: Record<string, unknown>) => ({ token: 'jwt', user: u })),
    };
    const service = new InvitationsService(prisma as never, workspaces as never, auth as never);
    const result = await service.registerAndAccept('token', 'newbie', 'brand-new-password-1');
    expect(provisionInput?.email).toBe('invitee@example.test'); // bound to invitation
    expect(provisionInput?.mustChangePassword).toBe(false);
    expect(workspaces.attachMember).toHaveBeenCalledWith('ws1', 'u3', 'newbie', 'member');
    expect(result.token).toBe('jwt');
  });

  it('treats an expired invitation as gone', async () => {
    const prisma = {
      workspaceInvitation: {
        findUnique: jest.fn(async () => baseInvitation({ expiresAt: past() })),
        update: jest.fn(async () => ({})),
      },
    };
    const service = new InvitationsService(prisma as never, {} as never, {} as never);
    await expect(service.preview('token')).rejects.toBeInstanceOf(GoneException);
  });

  it('treats an unknown or used token as not found', async () => {
    const prisma = { workspaceInvitation: { findUnique: jest.fn(async () => null) } };
    const service = new InvitationsService(prisma as never, {} as never, {} as never);
    await expect(service.preview('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
