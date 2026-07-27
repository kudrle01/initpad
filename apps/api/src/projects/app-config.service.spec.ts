import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { AppConfigService } from './app-config.service';
import { decryptSecret, encryptSecret } from '../common/secret';

function make(prisma: Record<string, unknown>, requireProject = jest.fn(async () => ({}))) {
  const workspaces = { requireProject } as never;
  return { service: new AppConfigService(prisma as never, workspaces), requireProject };
}

const envLookup = { findUnique: jest.fn(async () => ({ id: 'env-1' })) };

describe('AppConfigService (ADR-061 FC.3)', () => {
  it('stores a secret encrypted and masks it in the response', async () => {
    let saved: { value: string; isSecret: boolean } | null = null;
    const prisma = {
      environment: envLookup,
      appConfigVar: {
        upsert: jest.fn(async (args: { create: { value: string; isSecret: boolean } }) => {
          saved = args.create;
          return { key: 'DATABASE_URL', value: args.create.value, isSecret: true, updatedAt: new Date() };
        }),
      },
    };
    const { service } = make(prisma);

    const res = await service.upsert('u1', 'p1', 'dev', 'DATABASE_URL', {
      value: 'postgres://secret',
      isSecret: true,
    });

    expect(saved!.value).not.toBe('postgres://secret'); // encrypted at rest
    expect(decryptSecret(saved!.value)).toBe('postgres://secret');
    expect(res.value).toBeNull(); // masked
    expect(res.isSecret).toBe(true);
    expect(res.hasValue).toBe(true);
  });

  it('stores a non-secret in clear and returns its value', async () => {
    const prisma = {
      environment: envLookup,
      appConfigVar: {
        upsert: jest.fn(async () => ({
          key: 'GREETING', value: 'ahoj', isSecret: false, updatedAt: new Date(),
        })),
      },
    };
    const { service } = make(prisma);
    const res = await service.upsert('u1', 'p1', 'dev', 'GREETING', { value: 'ahoj' });
    expect(res.value).toBe('ahoj');
    expect(res.isSecret).toBe(false);
  });

  it('rejects an invalid key', async () => {
    const { service } = make({ environment: envLookup, appConfigVar: {} });
    await expect(
      service.upsert('u1', 'p1', 'dev', 'lower-case', { value: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a reserved platform key', async () => {
    const { service } = make({ environment: envLookup, appConfigVar: {} });
    await expect(
      service.upsert('u1', 'p1', 'dev', 'PORT', { value: '3000' }),
    ).rejects.toThrow(/reserved/);
  });

  it('requires project-write to manage', async () => {
    const requireProject = jest.fn(async () => {
      throw new ForbiddenException('nope');
    });
    const { service } = make({ appConfigVar: {}, environment: envLookup }, requireProject);
    await expect(
      service.upsert('viewer', 'p1', 'dev', 'GREETING', { value: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('masks secrets when listing', async () => {
    const prisma = {
      environment: envLookup,
      appConfigVar: {
        findMany: jest.fn(async () => [
          { key: 'A', value: 'clear', isSecret: false, updatedAt: new Date() },
          { key: 'B', value: 'cipher', isSecret: true, updatedAt: new Date() },
        ]),
      },
    };
    const { service } = make(prisma);
    const list = await service.list('u1', 'p1', 'dev');
    expect(list.find((v) => v.key === 'A')?.value).toBe('clear');
    expect(list.find((v) => v.key === 'B')?.value).toBeNull();
  });

  it('builds a decrypted injection map for deploy', async () => {
    const prisma = {
      appConfigVar: {
        findMany: jest.fn(async () => [
          { key: 'GREETING', value: 'ahoj', isSecret: false },
          { key: 'TOKEN', value: encryptSecret('s3cr3t'), isSecret: true },
        ]),
      },
    };
    const { service } = make(prisma);
    const map = await service.configVarsForDeploy('env-1');
    expect(map).toEqual({ GREETING: 'ahoj', TOKEN: 's3cr3t' });
  });
});
