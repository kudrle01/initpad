import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { config } from '../../config';
import { GitHubWebhookController } from './github-webhook.controller';

function sign(raw: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
}

function reqWith(raw: Buffer): RawBodyRequest<Request> {
  return { rawBody: raw } as unknown as RawBodyRequest<Request>;
}

function deliveries(applied: string[] = []) {
  return {
    applied: jest.fn(async (id: string) => applied.includes(id)),
    record: jest.fn(async (id: string) => {
      applied.push(id);
    }),
  };
}

describe('GitHubWebhookController', () => {
  const savedSecret = config.github.webhookSecret;
  afterEach(() => {
    config.github.webhookSecret = savedSecret;
  });

  it('processes an installation event with a valid signature', async () => {
    config.github.webhookSecret = 'whsec';
    const service = { handleEvent: jest.fn(async () => undefined) };
    const controller = new GitHubWebhookController(
      service as never,
      {} as never,
      deliveries() as never,
    );
    const body = { action: 'created', installation: { id: 1, account: { login: 'a' } } };
    const raw = Buffer.from(JSON.stringify(body));
    const res = await controller.handle(
      sign(raw, 'whsec'),
      'installation',
      'delivery-1',
      reqWith(raw),
      body,
    );
    expect(res).toEqual({ accepted: true });
    expect(service.handleEvent).toHaveBeenCalledWith(body);
  });

  it('rejects a bad signature', async () => {
    config.github.webhookSecret = 'whsec';
    const service = { handleEvent: jest.fn() };
    const controller = new GitHubWebhookController(
      service as never,
      {} as never,
      deliveries() as never,
    );
    const raw = Buffer.from('{}');
    await expect(
      controller.handle('sha256=deadbeef', 'installation', 'delivery-1', reqWith(raw), {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.handleEvent).not.toHaveBeenCalled();
  });

  it('refuses everything when no webhook secret is configured', async () => {
    config.github.webhookSecret = '';
    const controller = new GitHubWebhookController(
      { handleEvent: jest.fn() } as never,
      {} as never,
      deliveries() as never,
    );
    const raw = Buffer.from('{}');
    await expect(
      controller.handle(sign(raw, 'whatever'), 'installation', 'delivery-1', reqWith(raw), {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('ignores non-installation events (but accepts them)', async () => {
    config.github.webhookSecret = 'whsec';
    const service = { handleEvent: jest.fn() };
    const controller = new GitHubWebhookController(
      service as never,
      {} as never,
      deliveries() as never,
    );
    const raw = Buffer.from('{}');
    const res = await controller.handle(sign(raw, 'whsec'), 'push', 'delivery-1', reqWith(raw), {});
    expect(res).toEqual({ accepted: true });
    expect(service.handleEvent).not.toHaveBeenCalled();
  });

  it('returns a failure when installation state cannot be persisted so GitHub can retry', async () => {
    config.github.webhookSecret = 'whsec';
    const service = {
      handleEvent: jest.fn(async () => {
        throw new Error('database unavailable');
      }),
    };
    const controller = new GitHubWebhookController(
      service as never,
      {} as never,
      deliveries() as never,
    );
    const body = { action: 'created', installation: { id: 1, account: { login: 'a' } } };
    const raw = Buffer.from(JSON.stringify(body));
    await expect(
      controller.handle(sign(raw, 'whsec'), 'installation', 'delivery-1', reqWith(raw), body),
    ).rejects.toThrow('database unavailable');
  });

  it('forwards an account rename and lets a persistence failure reach GitHub for retry', async () => {
    config.github.webhookSecret = 'whsec';
    const service = { handleEvent: jest.fn(), handleTargetEvent: jest.fn(async () => undefined) };
    const controller = new GitHubWebhookController(
      service as never,
      {} as never,
      deliveries() as never,
    );
    const body = { action: 'renamed', account: { id: 987654, login: 'acme-renamed' } };
    const raw = Buffer.from(JSON.stringify(body));

    await expect(
      controller.handle(
        sign(raw, 'whsec'),
        'installation_target',
        'delivery-1',
        reqWith(raw),
        body,
      ),
    ).resolves.toEqual({ accepted: true });
    expect(service.handleTargetEvent).toHaveBeenCalledWith(body);
    expect(service.handleEvent).not.toHaveBeenCalled();

    service.handleTargetEvent.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      controller.handle(
        sign(raw, 'whsec'),
        'installation_target',
        'delivery-2',
        reqWith(raw),
        body,
      ),
    ).rejects.toThrow('database unavailable');
  });

  it('clears user credentials when GitHub App authorization is revoked', async () => {
    config.github.webhookSecret = 'whsec';
    const credentials = { revokeByProviderUserId: jest.fn(async () => undefined) };
    const controller = new GitHubWebhookController(
      { handleEvent: jest.fn() } as never,
      credentials as never,
      deliveries() as never,
    );
    const body = { action: 'revoked' as const, sender: { id: 987654, login: 'alice' } };
    const raw = Buffer.from(JSON.stringify(body));

    await expect(
      controller.handle(
        sign(raw, 'whsec'),
        'github_app_authorization',
        'delivery-1',
        reqWith(raw),
        body,
      ),
    ).resolves.toEqual({ accepted: true });
    expect(credentials.revokeByProviderUserId).toHaveBeenCalledWith('987654');
  });

  it('applies a delivery once and acknowledges its replay without changing state', async () => {
    config.github.webhookSecret = 'whsec';
    const service = { handleEvent: jest.fn(async () => undefined) };
    const store = deliveries();
    const controller = new GitHubWebhookController(service as never, {} as never, store as never);
    const body = { action: 'created', installation: { id: 1, account: { id: 2, login: 'a' } } };
    const raw = Buffer.from(JSON.stringify(body));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        controller.handle(sign(raw, 'whsec'), 'installation', 'guid-1', reqWith(raw), body),
      ).resolves.toEqual({ accepted: true });
    }

    expect(service.handleEvent).toHaveBeenCalledTimes(1);
    expect(store.record).toHaveBeenCalledWith('guid-1', 'installation');
  });

  it('leaves a failed delivery unrecorded so GitHub can redeliver it', async () => {
    config.github.webhookSecret = 'whsec';
    const service = {
      handleEvent: jest
        .fn()
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockResolvedValueOnce(undefined),
    };
    const store = deliveries();
    const controller = new GitHubWebhookController(service as never, {} as never, store as never);
    const body = { action: 'deleted', installation: { id: 1, account: { id: 2, login: 'a' } } };
    const raw = Buffer.from(JSON.stringify(body));

    await expect(
      controller.handle(sign(raw, 'whsec'), 'installation', 'guid-2', reqWith(raw), body),
    ).rejects.toThrow('database unavailable');
    await expect(
      controller.handle(sign(raw, 'whsec'), 'installation', 'guid-2', reqWith(raw), body),
    ).resolves.toEqual({ accepted: true });
    expect(service.handleEvent).toHaveBeenCalledTimes(2);
    expect(store.record).toHaveBeenCalledTimes(1);
  });

  it('requires the delivery id for events that change state', async () => {
    config.github.webhookSecret = 'whsec';
    const service = { handleEvent: jest.fn() };
    const controller = new GitHubWebhookController(
      service as never,
      {} as never,
      deliveries() as never,
    );
    const raw = Buffer.from('{}');
    await expect(
      controller.handle(sign(raw, 'whsec'), 'installation', '', reqWith(raw), {} as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.handleEvent).not.toHaveBeenCalled();
  });
});
