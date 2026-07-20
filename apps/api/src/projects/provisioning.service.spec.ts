import { ProvisioningService } from './provisioning.service';

describe('ProvisioningService', () => {
  it('starts a running operation at the validate step', async () => {
    let createArgs: { data?: Record<string, unknown> } | undefined;
    const prisma = {
      provisioningOperation: {
        create: jest.fn(async (args: { data?: Record<string, unknown> }) => {
          createArgs = args;
          return { id: 'op1' };
        }),
      },
    };
    const service = new ProvisioningService(prisma as never);
    const id = await service.start('ws1', 'api', 'import');
    expect(id).toBe('op1');
    expect(createArgs?.data).toMatchObject({ workspaceId: 'ws1', projectName: 'api', kind: 'import', status: 'running', step: 'validate' });
  });

  it('records success with the project id and marks it done', async () => {
    let updateArgs: { data?: Record<string, unknown> } | undefined;
    const prisma = {
      provisioningOperation: { update: jest.fn(async (a: { data?: Record<string, unknown> }) => { updateArgs = a; return {}; }) },
    };
    await new ProvisioningService(prisma as never).succeed('op1', 'p1');
    expect(updateArgs?.data).toMatchObject({ status: 'succeeded', step: 'done', projectId: 'p1' });
  });

  it('never throws when recording a step fails', async () => {
    const prisma = { provisioningOperation: { update: jest.fn(async () => { throw new Error('db down'); }) } };
    const service = new ProvisioningService(prisma as never);
    await expect(service.step('op1', 'repository')).resolves.toBeUndefined();
    await expect(service.fail('op1', 'boom')).resolves.toBeUndefined();
  });

  it('truncates long failure messages', async () => {
    let updateArgs: { data?: { message?: string } } | undefined;
    const prisma = { provisioningOperation: { update: jest.fn(async (a: { data?: { message?: string } }) => { updateArgs = a; return {}; }) } };
    await new ProvisioningService(prisma as never).fail('op1', 'x'.repeat(1000));
    expect((updateArgs?.data?.message ?? '').length).toBe(500);
  });

  it('writes intent before allowing an effect to enter applying', async () => {
    const prisma = {
      provisioningEffect: {
        create: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const service = new ProvisioningService(prisma as never);
    await service.planEffect('op1', 'secrets:initpad', 'secrets', { repository: 'acme/api' });
    await service.beginEffect('op1', 'secrets:initpad');
    expect(prisma.provisioningEffect.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ operationId: 'op1', key: 'secrets:initpad', status: 'planned' }),
    });
    expect(prisma.provisioningEffect.updateMany).toHaveBeenCalledWith({
      where: { operationId: 'op1', key: 'secrets:initpad', status: { in: ['planned'] } },
      data: { status: 'applying', error: null },
    });
  });

  it('refuses an invalid effect transition', async () => {
    const prisma = { provisioningEffect: { updateMany: jest.fn(async () => ({ count: 0 })) } };
    await expect(
      new ProvisioningService(prisma as never).completeEffect('op1', 'repository:create'),
    ).rejects.toThrow('not in the expected state');
  });
});
