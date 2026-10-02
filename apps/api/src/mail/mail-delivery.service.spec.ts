import nodemailer from 'nodemailer';
import { config } from '../config';
import { encryptSecret } from '../common/secret';
import { MailDeliveryService } from './mail-delivery.service';

describe('MailDeliveryService', () => {
  const originalMail = { ...config.mail };

  beforeEach(() => {
    Object.assign(config.mail, {
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      requireTls: true,
      username: 'initpad',
      password: 'smtp-password',
      from: 'InitPad <no-reply@example.test>',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.assign(config.mail, originalMail);
  });

  it('queues only an encrypted authentication link', async () => {
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ close: jest.fn() } as never);
    let created: Record<string, unknown> | undefined;
    const prisma = {
      emailOutbox: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created = data;
          return data;
        }),
      },
    };
    const service = new MailDeliveryService(prisma as never);

    await service.enqueueAuthMail(prisma as never, {
      userId: 'user-1',
      kind: 'email_verify',
      recipient: 'alice@example.test',
      displayName: 'Alice',
      url: 'https://initpad.example/verify-email/private-token',
    });

    expect(created).toMatchObject({
      userId: 'user-1',
      kind: 'email_verify',
      recipient: 'alice@example.test',
    });
    expect(created?.payloadEncrypted).toMatch(/^enc:v1:/);
    expect(created?.payloadEncrypted).not.toContain('private-token');
  });

  it('claims, delivers and erases a queued link', async () => {
    const sendMail = jest.fn(async () => ({ messageId: 'accepted' }));
    jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail, close: jest.fn() } as never);
    let row = {
      id: 'mail-1',
      userId: 'user-1',
      kind: 'password_reset',
      recipient: 'alice@example.test',
      payloadEncrypted: encryptSecret(
        JSON.stringify({
          displayName: 'Alice <Admin>',
          url: 'https://initpad.example/reset-password/private-token?a=1&b=2',
        }),
      ),
      status: 'pending',
      attempts: 0,
      availableAt: new Date(0),
      lockedAt: null as Date | null,
      lockOwner: null as string | null,
      sentAt: null as Date | null,
      lastError: null as string | null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const prisma = {
      emailOutbox: {
        findFirst: jest.fn(async () => (row.status === 'pending' ? { ...row } : null)),
        findUnique: jest.fn(async () => ({ ...row })),
        updateMany: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const { attempts, ...rest } = data;
          if (typeof attempts === 'object') row.attempts += 1;
          row = { ...row, ...rest } as typeof row;
          return { count: 1 };
        }),
      },
    };
    const service = new MailDeliveryService(prisma as never);

    await service.flushPending();

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@example.test',
        subject: 'Reset your InitPad password',
        messageId: '<mail-1@smtp.example.test>',
        html: expect.stringContaining('Alice &lt;Admin&gt;'),
      }),
    );
    expect(row.status).toBe('sent');
    expect(row.payloadEncrypted).toBe('');
    expect(row.sentAt).toBeInstanceOf(Date);
  });

  it('returns a failed send to the queue without storing the secret in the error', async () => {
    const sendMail = jest.fn(async () => {
      throw new Error('temporary SMTP outage');
    });
    jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail, close: jest.fn() } as never);
    let row = {
      id: 'mail-2',
      userId: 'user-1',
      kind: 'activation',
      recipient: 'alice@example.test',
      payloadEncrypted: encryptSecret(
        JSON.stringify({ displayName: 'Alice', url: 'https://initpad.example/activate/secret' }),
      ),
      status: 'pending',
      attempts: 0,
      availableAt: new Date(0),
      lockedAt: null as Date | null,
      lockOwner: null as string | null,
      sentAt: null as Date | null,
      lastError: null as string | null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const prisma = {
      emailOutbox: {
        findFirst: jest.fn(async () =>
          row.status === 'pending' && row.availableAt.getTime() <= Date.now() ? { ...row } : null,
        ),
        findUnique: jest.fn(async () => ({ ...row })),
        updateMany: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const { attempts, ...rest } = data;
          if (typeof attempts === 'object') row.attempts += 1;
          row = { ...row, ...rest } as typeof row;
          return { count: 1 };
        }),
      },
    };
    const service = new MailDeliveryService(prisma as never);

    await service.flushPending();

    expect(row.status).toBe('pending');
    expect(row.lastError).toBe('temporary SMTP outage');
    expect(row.lastError).not.toContain('/activate/secret');
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not send when another replica wins the database lease', async () => {
    const sendMail = jest.fn();
    jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail, close: jest.fn() } as never);
    const candidate = {
      id: 'mail-race',
      userId: 'user-1',
      kind: 'activation',
      recipient: 'alice@example.test',
      payloadEncrypted: encryptSecret(
        JSON.stringify({ displayName: 'Alice', url: 'https://initpad.example/activate/secret' }),
      ),
      status: 'pending',
      attempts: 0,
      availableAt: new Date(0),
      lockedAt: null,
      lockOwner: null,
      sentAt: null,
      lastError: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const prisma = {
      emailOutbox: {
        findFirst: jest.fn(async () => candidate),
        updateMany: jest.fn(async () => ({ count: 0 })),
        findUnique: jest.fn(),
      },
    };
    const service = new MailDeliveryService(prisma as never);

    await service.flushPending();

    expect(sendMail).not.toHaveBeenCalled();
    expect(prisma.emailOutbox.findUnique).not.toHaveBeenCalled();
  });
});
