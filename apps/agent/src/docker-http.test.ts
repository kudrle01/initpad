import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type http from 'node:http';
import test from 'node:test';
import { dockerHttpRequest, writeRequestStream } from './docker-http.js';

class BackpressuredRequest extends EventEmitter {
  writes = 0;
  ended = false;

  write(): boolean {
    this.writes += 1;
    queueMicrotask(() => this.emit('drain'));
    return false;
  }

  end(): void {
    this.ended = true;
  }
}

test('streaming request body removes transient listeners after every drain', async () => {
  const request = new BackpressuredRequest();
  const chunks = Array.from({ length: 32 }, () => Buffer.alloc(1));

  await writeRequestStream(
    request as unknown as http.ClientRequest,
    (async function* () {
      yield* chunks;
    })(),
  );

  assert.equal(request.writes, chunks.length);
  assert.equal(request.ended, true);
  assert.equal(request.listenerCount('drain'), 0);
  assert.equal(request.listenerCount('error'), 0);
});

test('streaming request body removes listeners when a write fails', async () => {
  const request = new BackpressuredRequest();
  request.write = function write(): boolean {
    queueMicrotask(() => this.emit('error', new Error('socket failed')));
    return false;
  };

  await assert.rejects(
    writeRequestStream(
      request as unknown as http.ClientRequest,
      (async function* () {
        yield Buffer.alloc(1);
      })(),
    ),
    /socket failed/,
  );

  assert.equal(request.listenerCount('drain'), 0);
  assert.equal(request.listenerCount('error'), 0);
});

async function hangingServer(): Promise<{
  server: http.Server;
  port: number;
  seen: Promise<void>;
}> {
  const { createServer } = await import('node:http');
  let markSeen!: () => void;
  const seen = new Promise<void>((resolve) => (markSeen = resolve));
  const server = createServer((_request, response) => {
    // Send headers and part of a body, then hang like a stuck Docker stream.
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.write('partial');
    markSeen();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { server, port: address.port, seen };
}

test('aborting an in-flight Docker request rejects instead of crashing the Agent', async () => {
  const { server, port, seen } = await hangingServer();
  const uncaught: unknown[] = [];
  const onUncaught = (error: unknown) => uncaught.push(error);
  process.on('uncaughtException', onUncaught);
  try {
    const controller = new AbortController();
    const pending = dockerHttpRequest(
      { method: 'GET', path: '/containers/json', signal: controller.signal },
      `tcp://127.0.0.1:${port}`,
    );
    await seen;
    controller.abort();
    await assert.rejects(pending, /aborted/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(uncaught, []);
  } finally {
    process.off('uncaughtException', onUncaught);
    server.closeAllConnections();
    server.close();
  }
});

test('an already aborted signal rejects before any Docker request is sent', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    dockerHttpRequest(
      { method: 'GET', path: '/version', signal: controller.signal },
      'tcp://127.0.0.1:9',
    ),
    /aborted/,
  );
});
