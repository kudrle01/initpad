import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { config } from '../config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_RESPONSE = 512 * 1024;

export interface SupervisorOperation {
  id: string;
  requestId: string;
  fromVersion: string;
  toVersion: string;
  status: 'accepted' | 'running' | 'succeeded' | 'failed' | 'rolled-back';
  stage: string;
  message: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface SupervisorState {
  schemaVersion: 1;
  currentVersion: string;
  currentImages: Record<'api' | 'web' | 'supervisor', string> | null;
  operation: SupervisorOperation | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function operation(value: unknown): SupervisorOperation | null {
  if (value === null) return null;
  const item = record(value);
  if (
    !item ||
    typeof item.id !== 'string' ||
    !UUID.test(item.id) ||
    typeof item.requestId !== 'string' ||
    !UUID.test(item.requestId) ||
    typeof item.fromVersion !== 'string' ||
    !VERSION.test(item.fromVersion) ||
    typeof item.toVersion !== 'string' ||
    !VERSION.test(item.toVersion) ||
    typeof item.status !== 'string' ||
    !['accepted', 'running', 'succeeded', 'failed', 'rolled-back'].includes(item.status) ||
    typeof item.stage !== 'string' ||
    item.stage.length > 80 ||
    typeof item.message !== 'string' ||
    item.message.length > 500 ||
    typeof item.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(item.startedAt)) ||
    (item.finishedAt !== null &&
      (typeof item.finishedAt !== 'string' || !Number.isFinite(Date.parse(item.finishedAt))))
  ) {
    throw new Error('Supervisor returned an invalid operation');
  }
  return item as unknown as SupervisorOperation;
}

function state(value: unknown): SupervisorState {
  const item = record(value);
  const images = item ? record(item.currentImages) : null;
  if (
    !item ||
    item.schemaVersion !== 1 ||
    typeof item.currentVersion !== 'string' ||
    !VERSION.test(item.currentVersion) ||
    (item.currentImages !== null &&
      (!images ||
        !['api', 'web', 'supervisor'].every(
          (key) =>
            typeof images[key] === 'string' &&
            /^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/.test(images[key]),
        )))
  ) {
    throw new Error('Supervisor returned an invalid state');
  }
  return {
    schemaVersion: 1,
    currentVersion: item.currentVersion,
    currentImages: item.currentImages as SupervisorState['currentImages'],
    operation: operation(item.operation),
  };
}

@Injectable()
export class SupervisorClientService {
  get configured(): boolean {
    return Boolean(config.updates.supervisorUrl && config.updates.supervisorSharedSecret);
  }

  status(): Promise<SupervisorState> {
    return this.request('GET', '/v1/status', undefined, randomUUID()).then(state);
  }

  update(requestId: string, release: unknown): Promise<SupervisorOperation> {
    if (!UUID.test(requestId)) throw new Error('Platform update request id is invalid');
    return this.request('POST', '/v1/update', release, requestId).then((value) => {
      const parsed = operation(value);
      if (!parsed) throw new Error('Supervisor returned no update operation');
      return parsed;
    });
  }

  private async request(method: 'GET' | 'POST', path: string, value: unknown, requestId: string) {
    if (!this.configured) throw new Error('Platform update Supervisor is not configured');
    const body = value === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value));
    const timestamp = String(Date.now());
    const bodyHash = createHash('sha256').update(body).digest('hex');
    const signature = createHmac('sha256', config.updates.supervisorSharedSecret)
      .update(`${timestamp}\n${requestId}\n${bodyHash}`)
      .digest('hex');
    const response = await fetch(`${config.updates.supervisorUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-initpad-timestamp': timestamp,
        'x-initpad-request-id': requestId,
        'x-initpad-signature': signature,
      },
      body: method === 'POST' ? body : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(config.updates.requestTimeoutMs),
    });
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_RESPONSE) throw new Error('Supervisor response is too large');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_RESPONSE) throw new Error('Supervisor response is too large');
    let result: unknown;
    try {
      result = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      throw new Error('Supervisor response is not valid JSON');
    }
    if (!response.ok) {
      const error = record(result)?.error;
      throw new Error(
        typeof error === 'string' && error.length <= 500
          ? error
          : `Supervisor returned HTTP ${response.status}`,
      );
    }
    return result;
  }
}
