import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';
import { SupervisorClientService, SupervisorRejectedError } from './supervisor-client.service';

const original = { ...config.updates };
const secret = 's'.repeat(48);

describe('SupervisorClientService', () => {
  beforeEach(() => {
    Object.assign(config.updates, {
      supervisorUrl: 'http://supervisor:7070',
      supervisorSharedSecret: secret,
      requestTimeoutMs: 8_000,
    });
  });

  afterEach(() => {
    Object.assign(config.updates, original);
    jest.restoreAllMocks();
  });

  it('authenticates a bounded status request and validates its response', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          currentVersion: '0.2.0',
          currentImages: null,
          operation: null,
        }),
        { status: 200 },
      ),
    );
    await expect(new SupervisorClientService().status()).resolves.toMatchObject({
      currentVersion: '0.2.0',
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    const digest = createHash('sha256').update(Buffer.alloc(0)).digest('hex');
    const signed = `${headers['x-initpad-timestamp']}\n${headers['x-initpad-request-id']}\n${digest}`;
    expect(headers['x-initpad-signature-v2']).toBe(
      createHmac('sha256', secret).update(`v2\nGET\n/v1/status\n${signed}`).digest('hex'),
    );
    // Kept for Supervisors released before ADR-146.
    expect(headers['x-initpad-signature']).toBe(
      createHmac('sha256', secret).update(signed).digest('hex'),
    );
    expect(init.redirect).toBe('error');
  });

  it('rejects malformed Supervisor state instead of trusting it', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ schemaVersion: 1, currentVersion: 'latest' }), {
        status: 200,
      }),
    );
    await expect(new SupervisorClientService().status()).rejects.toThrow('invalid state');
  });

  it('gives /v1/update time for Sigstore verification and marks refusals', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'Signature invalid' }), { status: 400 }),
      );
    const error = await new SupervisorClientService()
      .update('3f04ebec-3299-4ce5-bd02-cf390ca413e9', {})
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SupervisorRejectedError);
    expect(timeout).toHaveBeenCalledWith(60_000);
  });
});
