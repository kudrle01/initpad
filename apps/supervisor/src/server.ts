import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { authenticateRequest } from './auth.js';
import { verifyPlatformRelease } from './release.js';
import { loadState, saveState } from './state.js';
import type { SignedPlatformRelease, UpdateOperation } from './types.js';
import { PlatformUpdater, writePlan } from './updater.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function json(response: http.ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readBody(request: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new Error('Supervisor request body is too large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function header(request: http.IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? undefined : value;
}

export function createSupervisorServer(
  secret = process.env.INITPAD_SUPERVISOR_SHARED_SECRET || '',
  updater: Pick<PlatformUpdater, 'launchHelper'> = new PlatformUpdater(),
  verifyRelease: typeof verifyPlatformRelease = verifyPlatformRelease,
): http.Server {
  let accepting = false;
  const handle = async (request: http.IncomingMessage, response: http.ServerResponse) => {
    let ownsAcceptingLock = false;
    try {
      const url = new URL(request.url || '/', 'http://supervisor.invalid');
      if (request.method === 'GET' && url.pathname === '/health') {
        json(response, 200, { ok: true });
        return;
      }
      if (url.pathname !== '/v1/status' && url.pathname !== '/v1/update') {
        json(response, 404, { error: 'Not found' });
        return;
      }
      const body = await readBody(request);
      authenticateRequest(secret, {
        timestamp: header(request, 'x-initpad-timestamp'),
        requestId: header(request, 'x-initpad-request-id'),
        signature: header(request, 'x-initpad-signature'),
        body,
      });
      if (request.method === 'GET' && url.pathname === '/v1/status') {
        json(response, 200, await loadState());
        return;
      }
      if (request.method !== 'POST' || url.pathname !== '/v1/update') {
        json(response, 405, { error: 'Method not allowed' });
        return;
      }
      const requestId = header(request, 'x-initpad-request-id')!;
      const state = await loadState();
      if (state.operation?.requestId === requestId) {
        json(response, 200, state.operation);
        return;
      }
      if (
        accepting ||
        (state.operation && ['accepted', 'running'].includes(state.operation.status))
      ) {
        json(response, 409, { error: 'Another platform update is already running' });
        return;
      }
      accepting = true;
      ownsAcceptingLock = true;
      let release: SignedPlatformRelease;
      try {
        release = JSON.parse(body.toString('utf8')) as SignedPlatformRelease;
      } catch {
        throw new Error('Platform update request is not valid JSON');
      }
      const manifest = await verifyRelease(release, state.currentVersion);
      const operation: UpdateOperation = {
        id: randomUUID(),
        requestId,
        fromVersion: state.currentVersion,
        toVersion: manifest.version,
        status: 'accepted',
        stage: 'accepted',
        message: `InitPad ${manifest.version} update accepted`,
        backupPath: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      };
      state.operation = operation;
      await saveState(state);
      const path = await writePlan(operation.id, release);
      try {
        await updater.launchHelper(path);
      } catch (error) {
        operation.status = 'failed';
        operation.stage = 'failed';
        operation.message = (
          error instanceof Error ? error.message : 'Updater could not start'
        ).slice(0, 500);
        operation.finishedAt = new Date().toISOString();
        state.operation = operation;
        await saveState(state);
        throw error;
      }
      json(response, 202, operation);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Supervisor request failed';
      const status = /already running/.test(message)
        ? 409
        : /signature|timestamp|request id|shared secret/.test(message)
          ? 401
          : 400;
      json(response, status, { error: message.slice(0, 500) });
    } finally {
      if (ownsAcceptingLock) accepting = false;
    }
  };
  return http.createServer((request, response) => {
    void handle(request, response);
  });
}

export async function runServer(signal: AbortSignal): Promise<void> {
  const port = Number(process.env.INITPAD_SUPERVISOR_PORT || 7070);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('INITPAD_SUPERVISOR_PORT is invalid');
  }
  const updater = new PlatformUpdater();
  await updater.launchRecoveryHelper();
  const server = createSupervisorServer(undefined, updater);
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', reject);
      resolveListen();
    });
  });
  await new Promise<void>((resolveStop) => {
    if (signal.aborted) resolveStop();
    else signal.addEventListener('abort', () => resolveStop(), { once: true });
  });
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}
